import { z } from 'zod';
import { CHANNEL_FIELDS, CHANNEL_OPERATORS } from '@/contracts/analytics';
import type { BreakdownRow, ChannelReport, ChannelRow, ChannelRule, ChannelVisit } from '@/contracts/analytics';
import { db } from '@/server/db';
import type { Sql } from '@/server/db';

export const UNCLASSIFIED = 'Unclassified';

const clickIds = ['gclid=', 'fbclid=', 'msclkid=', 'ttclid=', 'li_fat_id=', 'twclid=', 'dclid='];
const searchSites = ['google.', 'bing.com', 'duckduckgo.com', 'ecosia.org', 'search.brave.com', 'yandex.', 'baidu.com', 'search.yahoo.', 'startpage.com'];
const socialSites = [
  'facebook.com', 'fb.com', 'instagram.com', 'linkedin.', 'pinterest.', 'reddit.', 't.co', 'twitter.com', 'x.com',
  'threads.net', 'bsky.app', 'snapchat.', 'tiktok.com', 'news.ycombinator.com', 'mastodon.',
];
const webmail = ['mail.google.', 'gmail.', 'hotmail.', 'outlook.', 'mail.yahoo.', 'proton.me', 'protonmail.'];

const contains = (field: ChannelRule['conditions'][number]['field'], ...values: string[]) => ({ field, operator: 'contains' as const, values });
const equals = (field: ChannelRule['conditions'][number]['field'], ...values: string[]) => ({ field, operator: 'equals' as const, values });
const absent = (field: ChannelRule['conditions'][number]['field']) => ({ field, operator: 'absent' as const, values: [] as string[] });
const present = (field: ChannelRule['conditions'][number]['field']) => ({ field, operator: 'present' as const, values: [] as string[] });

/** Where OVELIO differs from Umami 3.5.0's getChannelMetrics CASE: e-mail and paid media are decided first. */
export const DEFAULT_CHANNEL_RULES: ChannelRule[] = [
  { name: 'Email campaigns', channel: 'Email', conditions: [equals('utmMedium', 'email', 'e-mail', 'newsletter', 'mail')] },
  { name: 'Ad click IDs', channel: 'Paid', conditions: [contains('query', ...clickIds)] },
  { name: 'Paid media', channel: 'Paid', conditions: [equals('utmMedium', 'cpc', 'ppc', 'paid', 'paidsocial', 'paid-social', 'paid_social', 'retargeting', 'display', 'cpm')] },
  { name: 'Webmail referrers', channel: 'Email', conditions: [contains('referrer', ...webmail)] },
  { name: 'Search engines', channel: 'Organic search', conditions: [contains('referrer', ...searchSites)] },
  { name: 'Organic search medium', channel: 'Organic search', conditions: [equals('utmMedium', 'organic')] },
  { name: 'Social networks', channel: 'Organic social', conditions: [contains('referrer', ...socialSites)] },
  { name: 'Social medium', channel: 'Organic social', conditions: [equals('utmMedium', 'social', 'social-media', 'sm')] },
  { name: 'Referral medium', channel: 'Referral', conditions: [equals('utmMedium', 'referral', 'link', 'app')] },
  { name: 'Direct visits', channel: 'Direct', conditions: [absent('referrer'), absent('utmSource'), absent('utmMedium')] },
  { name: 'Other referrers', channel: 'Referral', conditions: [present('referrer')] },
];

const conditionSchema = z.object({
  field: z.enum(CHANNEL_FIELDS),
  operator: z.enum(CHANNEL_OPERATORS),
  values: z.array(z.string().trim().min(1).max(100)).max(30),
}).refine(c => ['present', 'absent'].includes(c.operator) || c.values.length > 0, 'Add at least one value to match.');

export const channelRulesSchema = z.array(z.object({
  name: z.string().trim().min(1).max(60),
  channel: z.string().trim().min(1).max(40),
  conditions: z.array(conditionSchema).min(1).max(5),
}).transform((rule): ChannelRule => rule)).max(50);

const norm = (value: string | undefined | null) => (value ?? '').trim().toLowerCase();

function conditionMatches(condition: ChannelRule['conditions'][number], visit: ChannelVisit): boolean {
  const actual = norm(visit[condition.field]);
  if (condition.operator === 'present') return actual !== '';
  if (condition.operator === 'absent') return actual === '';
  const wanted = condition.values.map(norm).filter(Boolean);
  if (!actual) return false;
  return condition.operator === 'equals' ? wanted.includes(actual) : wanted.some(value => actual.includes(value));
}

/** The first rule whose conditions all match decides the channel (the same first-match-wins order Umami uses). */
export function classifyVisit(rules: ChannelRule[], visit: ChannelVisit): { channel: string; rule?: string } {
  for (const rule of rules) {
    if (rule.conditions.every(condition => conditionMatches(condition, visit))) return { channel: rule.channel, rule: rule.name };
  }
  return { channel: UNCLASSIFIED };
}

export async function loadChannelRules(sql: Sql = db): Promise<{ rules: ChannelRule[]; custom: boolean }> {
  const rows = (await sql.query<{ id: string; name: string; channel: string; conditions: ChannelRule['conditions'] }>(
    'SELECT id, name, channel, conditions FROM analytics_channel_rules ORDER BY position, created_at',
  )).rows;
  if (!rows.length) return { rules: DEFAULT_CHANNEL_RULES.map(rule => ({ ...rule })), custom: false };
  return { rules: rows.map(row => ({ id: row.id, name: row.name, channel: row.channel, conditions: row.conditions })), custom: true };
}

/** Replaces the whole ordered list in one statement. An empty list restores the defaults. */
export async function saveChannelRules(input: unknown, sql: Sql = db) {
  const rules = channelRulesSchema.parse(input);
  await sql.query(
    `WITH removed AS (DELETE FROM analytics_channel_rules)
     INSERT INTO analytics_channel_rules (position, name, channel, conditions)
     SELECT ordinality, item->>'name', item->>'channel', item->'conditions'
     FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY AS t(item, ordinality)`,
    [JSON.stringify(rules)],
  );
  return loadChannelRules(sql);
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/** Classifies each referrer / UTM / query combination the engine reports. This is breakdown-level, not per session. */
export function channelReport(rules: ChannelRule[], rows: BreakdownRow[]): ChannelReport {
  const totals = new Map<string, { visits: number; visitors: number }>();
  for (const row of rows) {
    const { channel } = classifyVisit(rules, {
      referrer: text(row.referrer), utmSource: text(row.utmSource), utmMedium: text(row.utmMedium), query: text(row.query),
    });
    const entry = totals.get(channel) ?? { visits: 0, visitors: 0 };
    entry.visits += count(row.visits) || count(row.visitors);
    entry.visitors += count(row.visitors);
    totals.set(channel, entry);
  }
  const total = [...totals.values()].reduce((sum, item) => sum + item.visits, 0);
  const out: ChannelRow[] = [...totals.entries()]
    .map(([channel, item]) => ({ channel, visits: item.visits, visitors: item.visitors, share: total ? item.visits / total : 0 }))
    .sort((a, b) => b.visits - a.visits);
  return { rows: out, total, precision: 'breakdown', truncated: rows.length >= 1000 };
}
