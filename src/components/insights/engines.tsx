'use client';

// Email and website panels read the existing engine-backed console endpoints: newsletters (/campaigns, the newsletter
// engine) and websites (/websites/:id/report, the website analytics engine). OVELIO's own sends come from insights.
import { useEffect, useState } from 'react';
import type { Campaign, DateRange, Page, Website, WebsiteReport } from '@/contracts';
import { message, request, useResource } from '../client';
import { Empty } from '../ui';
import { BarList } from './charts';
import { formatCount, formatPercent } from './format';

export function useStable<T>(path: string | null) {
  const result = useResource<T>(path);
  const [last, setLast] = useState<T>();
  if (result.data !== undefined && result.data !== last) setLast(result.data);
  return { ...result, data: result.data ?? (path ? last : undefined), stale: result.data === undefined && last !== undefined };
}

type NewsletterState = { key: string; items?: Campaign[]; complete?: boolean; error?: string };

/** Every newsletter (up to 150), read page by page from the newsletter engine endpoint. */
export function useNewsletters() {
  const [state, setState] = useState<NewsletterState>({ key: '' });
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      const items: Campaign[] = [];
      let total = 0;
      for (let page = 1; page <= 5; page++) {
        const batch = await request<Page<Campaign>>(`/api/console/campaigns?status=all&page=${page}`, { signal: controller.signal });
        items.push(...batch.items);
        total = batch.total;
        if (!batch.items.length || items.length >= total) break;
      }
      return { items, complete: items.length >= total };
    })().then(
      result => { if (!controller.signal.aborted) setState({ key: 'done', ...result }); },
      error => { if (!controller.signal.aborted) setState({ key: 'done', error: message(error) }); },
    );
    return () => controller.abort();
  }, []);
  return { ...state, loading: state.key !== 'done' };
}

const sentStatuses = new Set(['finished', 'running', 'paused', 'cancelled']);

export function newsletterTotals(items: Campaign[], range: DateRange) {
  const inRange = items.filter(item => {
    const anchor = Date.parse(item.sendAt ?? item.createdAt ?? '');
    return sentStatuses.has(item.status) && (item.metrics.sent ?? 0) > 0 && anchor >= range.startAt && anchor < range.endAt;
  });
  const sum = (key: 'sent' | 'opens' | 'clicks' | 'bounces' | 'unsubscribes') =>
    inRange.some(item => item.metrics[key] == null) ? null : inRange.reduce((total, item) => total + (item.metrics[key] ?? 0), 0);
  return { newsletters: inRange.length, sent: sum('sent'), opens: sum('opens'), clicks: sum('clicks'), bounces: sum('bounces'), unsubscribes: sum('unsubscribes'), items: inRange };
}

export function EmailPerformance({ range, ovelioSent }: { range: DateRange; ovelioSent: number | null }) {
  const newsletters = useNewsletters();
  if (newsletters.loading) return <Empty title="Loading email engine statistics…" />;
  if (newsletters.error) return <Empty title="Newsletter statistics are unavailable" description={`${newsletters.error} Check the email engine in Settings › Connections.`} />;
  const totals = newsletterTotals(newsletters.items ?? [], range);
  const rate = (value: number | null) => value == null || !totals.sent ? 'Not tracked' : `${formatPercent(value / totals.sent)} of sent`;
  const tile = (label: string, value: number | null, hint: string) => <div><span className="ov-insights-mini-label">{label}</span><strong>{value == null ? '—' : formatCount(value)}</strong><small>{hint}</small></div>;
  return <div className="ov-stack-sm">
    <div className="ov-insights-mini ov-insights-mini--labelled">
      {tile('Newsletters sent', totals.newsletters, newsletters.complete ? 'By send date' : 'Latest 150 checked')}
      {tile('Recipients', totals.sent, 'Measured by the email engine')}
      {tile('Opens', totals.opens, rate(totals.opens))}
      {tile('Clicks', totals.clicks, rate(totals.clicks))}
      {tile('Bounces', totals.bounces, rate(totals.bounces))}
      {tile('Unsubscribes', totals.unsubscribes, rate(totals.unsubscribes))}
      {tile('Sent by OVELIO', ovelioSent, 'Sales and automation emails')}
    </div>
    {!totals.newsletters ? <small className="ov-insights-footnote">No newsletter was sent in this period.</small> : null}
  </div>;
}

export function useWebsite(range: DateRange) {
  const websites = useResource<Website[]>('/websites');
  const site = websites.data?.[0];
  const report = useStable<WebsiteReport>(site ? `/websites/${site.id}/report?startAt=${range.startAt}&endAt=${range.endAt}` : null);
  return { websites, site, report };
}

export function WebsiteSummary({ range, compare }: { range: DateRange; compare: string }) {
  const { websites, site, report } = useWebsite(range);
  if (websites.error) return <Empty title="Website statistics are unavailable" description={`${websites.error} Check website tracking in Settings › Connections.`} />;
  if (websites.loading && !websites.data) return <Empty title="Loading website statistics…" />;
  if (!site) return <Empty title="No website is tracked yet" description="Add your website and its tracking snippet to measure visitors and sources." />;
  if (report.error) return <Empty title="Website statistics are unavailable" description={report.error} />;
  const data = report.data;
  if (!data) return <Empty title="Loading website statistics…" />;
  const current = data.current;
  const previous = compare === 'previous' ? data.previous : null;
  const bounce = (traffic: typeof current) => (traffic && traffic.visits ? traffic.bounces / traffic.visits : null);
  const delta = (now: number | null | undefined, before: number | null | undefined) => {
    if (now == null || before == null || !before) return 'Measured by website analytics';
    const value = (now - before) / before;
    return `${value >= 0 ? '+' : '−'}${Math.abs(value * 100).toFixed(0)}% vs previous period`;
  };
  const sources = data.dimensions.channel ?? data.dimensions.referrer ?? [];
  const max = Math.max(1, ...sources.map(row => row.value));
  return <div className="ov-stack-sm">
    <div className="ov-insights-mini ov-insights-mini--labelled">
      <div><span className="ov-insights-mini-label">Visitors</span><strong>{formatCount(current?.visitors)}</strong><small>{delta(current?.visitors, previous?.visitors)}</small></div>
      <div><span className="ov-insights-mini-label">Visits</span><strong>{formatCount(current?.visits)}</strong><small>{delta(current?.visits, previous?.visits)}</small></div>
      <div><span className="ov-insights-mini-label">Page views</span><strong>{formatCount(current?.pageviews)}</strong><small>{delta(current?.pageviews, previous?.pageviews)}</small></div>
      <div><span className="ov-insights-mini-label">Bounce rate</span><strong>{formatPercent(bounce(current))}</strong><small>Single-page visits ÷ visits</small></div>
    </div>
    <BarList max={max} rows={sources.slice(0, 5).map(row => ({ key: row.label, label: row.label || 'Unknown', value: row.value, display: formatCount(row.value) }))}
      empty={<Empty title="No traffic sources recorded in this period" />} />
    <small className="ov-insights-footnote">{site.name}{compare === 'year' ? ' · website comparison uses the previous period only' : ''}</small>
  </div>;
}
