'use client';

import {
  Activity, ArrowRight, BookmarkPlus, CalendarDays, CodeXml, Copy, Download,
  Eye, Filter, Link2, MousePointerClick, Pencil, Plus, RefreshCw, RotateCcw,
  Save, Search, Settings2, Share2, Sparkles, Target, Trash2, TrendingUp, Users,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import type { ISODateString } from '@astryxdesign/core/Calendar';
import { DateInput } from '@astryxdesign/core/DateInput';
import { Heading } from '@astryxdesign/core/Heading';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Link } from '@astryxdesign/core/Link';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Selector } from '@astryxdesign/core/Selector';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Switch } from '@astryxdesign/core/Switch';
import { Table } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import { Token } from '@astryxdesign/core/Token';
import type {
  Annotation,
  ApiKeySummary,
  AttributionResult,
  BreakdownRow,
  ChannelReport,
  ChannelRule,
  CreatedApiKey,
  Campaign,
  Dashboard,
  DateRange,
  EntityChartSeries,
  EventPropertyStat,
  EventPropertyValue,
  ExpandedMetricRow,
  FunnelResult,
  FunnelStep,
  Goal,
  GoalStats,
  JourneyPath,
  MarketingReport,
  MarketingReportData,
  Page,
  PerformanceBreakdownType,
  PerformanceMetricKey,
  PerformanceReport,
  Point,
  RealtimeReport,
  ReportDimension,
  ReportFilters,
  RetentionRow,
  RevenueMetricType,
  RevenueReport,
  RevenueUtmDimension,
  RevenueUtmReport,
  SavedFunnel,
  SnippetOptions,
  SnippetPreferences,
  SessionActivityItem,
  SessionPropertyEntry,
  SessionPropertyStat,
  SessionStats,
  TrackedLink,
  TrackingPixel,
  Website,
  WebsiteEventRow,
  WebsiteReport,
  WebsiteSegment,
  WebsiteSegmentFilter,
  WebsiteSession,
  WebsiteShare,
  WeeklyTraffic,
} from '@/contracts';
import {
  ANALYTICS_LIMITS, CHANNEL_FIELDS, CHANNEL_OPERATORS, DEFAULT_SNIPPET_OPTIONS, FILTER_DIMENSIONS, FILTER_DIMENSION_LABELS, PROPERTY_OPERATORS, SEGMENT_DIMENSION_OPERATORS,
  UNFILTERABLE_DIMENSIONS, describeFilterRule, describePropertyFilter, equalityRule, filterQueryParams, goalMatchKind,
  hasFilters, operatorLabel,
} from '@/contracts/analytics';
import type { DimensionOperator, FilterDimension, FilterRule, PropertyDataType, PropertyFilter } from '@/contracts/analytics';

// ANA-04: Umami 3.5.0 has no filter column for these report dimensions, so their rows are not clickable filters.
const isFilterable = (dimension: ReportDimension) => !(UNFILTERABLE_DIMENSIONS as readonly string[]).includes(dimension);
import { api, date, duration, message, number, saveFile, useAction, useFields, useResource } from './client';
import { EmailMetrics } from './overview';
import { useUser } from './shell';
import {
  AsyncState, Bars, ConfirmDialog, Distribution, Empty, Feedback,
  FormActions, Metric, Modal, PageHeader, Pager, Panel, Rows, SlideDrawer,
  Snippet, StatusBadge, Tabs, WeeklyHeatmap,
} from './ui';
import type { Tone } from './ui';

const websitesPath = '/websites';
const day = 86_400_000;

const viewTabs = [
  'Traffic',
  'Realtime',
  'Sessions',
  'Goals & Funnels',
  'Insights',
  'Links & Pixels',
  'Email reports',
  'Marketing reports',
] as const;
type AnalyticsTab = typeof viewTabs[number];

const websiteScopedTabs = new Set<AnalyticsTab>([
  'Traffic',
  'Realtime',
  'Sessions',
  'Goals & Funnels',
  'Insights',
]);

const breakdownTabs = ['Pages', 'Sources', 'Location', 'Technology', 'Events'] as const;
type BreakdownTab = typeof breakdownTabs[number];

const breakdownGroups: Record<Exclude<BreakdownTab, 'Events'>, ReadonlyArray<readonly [ReportDimension, string]>> = {
  Pages: [
    ['path', 'Paths'],
    ['entry', 'Entry pages'],
    ['exit', 'Exit pages'],
    ['title', 'Page titles'],
    ['query', 'Query params'],
  ],
  Sources: [
    ['referrer', 'Referrers'],
    ['channel', 'Channels'],
    ['utmSource', 'UTM source'],
    ['utmMedium', 'UTM medium'],
    ['utmCampaign', 'UTM campaign'],
    ['utmContent', 'UTM content'],
    ['utmTerm', 'UTM term'],
  ],
  Location: [
    ['country', 'Countries'],
    ['region', 'Regions'],
    ['city', 'Cities'],
    ['language', 'Languages'],
  ],
  Technology: [
    ['browser', 'Browsers'],
    ['os', 'Operating systems'],
    ['device', 'Devices'],
    ['screen', 'Screen sizes'],
    ['hostname', 'Hostnames'],
  ],
};

const dimensionLabels: Record<ReportDimension, string> = {
  path: 'Path',
  entry: 'Entry page',
  exit: 'Exit page',
  title: 'Page title',
  query: 'Query',
  hostname: 'Hostname',
  referrer: 'Referrer',
  channel: 'Channel',
  device: 'Device',
  browser: 'Browser',
  os: 'OS',
  screen: 'Screen',
  country: 'Country',
  region: 'Region',
  city: 'City',
  language: 'Language',
  event: 'Event',
  utmSource: 'UTM source',
  utmMedium: 'UTM medium',
  utmCampaign: 'UTM campaign',
  utmContent: 'UTM content',
  utmTerm: 'UTM term',
};

const breakdownDimensionOptions: { value: ReportDimension; label: string }[] = [
  { value: 'path', label: 'Page path' },
  { value: 'country', label: 'Country' },
  { value: 'device', label: 'Device' },
  { value: 'browser', label: 'Browser' },
  { value: 'os', label: 'Operating system' },
  { value: 'referrer', label: 'Referrer' },
  { value: 'utmSource', label: 'UTM source' },
  { value: 'utmMedium', label: 'UTM medium' },
  { value: 'utmCampaign', label: 'UTM campaign' },
  { value: 'event', label: 'Custom event' },
  { value: 'title', label: 'Page title' },
  { value: 'region', label: 'Region' },
  { value: 'city', label: 'City' },
  { value: 'language', label: 'Language' },
  { value: 'hostname', label: 'Hostname' },
];

const stepTypes = [
  { value: 'path', label: 'Page path' },
  { value: 'event', label: 'Custom event' },
];

const segmentFilterDimensionOptions: { value: string; label: string }[] = FILTER_DIMENSIONS
  .map(value => ({ value, label: FILTER_DIMENSION_LABELS[value] }));

const segmentOperatorOptions = SEGMENT_DIMENSION_OPERATORS.map(value => ({ value, label: operatorLabel(value) }));

const cohortDateRangeOptions = [
  { value: '24hour', label: 'Last 24 hours' },
  { value: '7day', label: 'Last 7 days' },
  { value: '30day', label: 'Last 30 days' },
  { value: '90day', label: 'Last 90 days' },
  { value: '180day', label: 'Last 180 days' },
  { value: '1year', label: 'Last 12 months' },
] as const;

const cohortDateRangeLabels: Record<string, string> = Object.fromEntries(
  cohortDateRangeOptions.map(option => [option.value, option.label]),
);

const currencyOptions = [
  { value: 'USD', label: 'USD — US Dollar' },
  { value: 'GBP', label: 'GBP — British Pound' },
  { value: 'EUR', label: 'EUR — Euro' },
  { value: 'CAD', label: 'CAD — Canadian Dollar' },
  { value: 'AUD', label: 'AUD — Australian Dollar' },
] as const;

const revenueBreakdownOptions: { value: RevenueMetricType; label: string }[] = [
  { value: 'country', label: 'Country' },
  { value: 'region', label: 'Region' },
  { value: 'referrer', label: 'Referrer' },
  { value: 'channel', label: 'Channel' },
];

const performanceMetricOptions: { value: PerformanceMetricKey; label: string }[] = [
  { value: 'lcp', label: 'LCP — Largest Contentful Paint' },
  { value: 'inp', label: 'INP — Interaction to Next Paint' },
  { value: 'cls', label: 'CLS — Cumulative Layout Shift' },
  { value: 'fcp', label: 'FCP — First Contentful Paint' },
  { value: 'ttfb', label: 'TTFB — Time to First Byte' },
];

const performanceMetricInfo: Record<PerformanceMetricKey, { short: string; description: string }> = {
  lcp: { short: 'LCP', description: 'Largest Contentful Paint at p75 (good target ≤ 2.5 s).' },
  inp: { short: 'INP', description: 'Interaction to Next Paint at p75 (good target ≤ 200 ms).' },
  cls: { short: 'CLS', description: 'Cumulative Layout Shift at p75 (good target ≤ 0.100).' },
  fcp: { short: 'FCP', description: 'First Contentful Paint at p75 (good target ≤ 1.8 s).' },
  ttfb: { short: 'TTFB', description: 'Time to First Byte at p75 (good target ≤ 800 ms).' },
};

const performanceBreakdownOptions: { value: PerformanceBreakdownType; label: string }[] = [
  { value: 'path', label: 'Page path' },
  { value: 'title', label: 'Page title' },
  { value: 'device', label: 'Device' },
  { value: 'browser', label: 'Browser' },
];

const campaignStatusTone: Record<string, Tone> = {
  finished: 'success',
  running: 'success',
  scheduled: 'info',
  paused: 'warning',
  cancelled: 'error',
};

const recent = (days: number): DateRange => ({ startAt: Date.now() - day * days, endAt: Date.now() });
const isoDay = (value: number) => new Date(value).toISOString().slice(0, 10) as ISODateString;

function normalizeTab(value?: string): AnalyticsTab {
  if (!value) return 'Traffic';
  const trimmed = value.trim().replace(/\+/g, ' ');
  const exact = viewTabs.find(item => item === trimmed);
  if (exact) return exact;
  const lower = trimmed.toLowerCase();
  return viewTabs.find(item => item.toLowerCase() === lower) ?? 'Traffic';
}

function resolveOrigin(trackingOrigin?: string) {
  const raw = trackingOrigin || (typeof window !== 'undefined' ? window.location.origin : '');
  return raw.replace(/\/+$/, '');
}

function rangeQuery(range: DateRange, filters?: ReportFilters, extra?: Record<string, string | undefined>) {
  const params = new URLSearchParams({ startAt: String(range.startAt), endAt: String(range.endAt) });
  try {
    for (const [key, val] of Object.entries(filterQueryParams(filters))) params.set(key, val);
  } catch {
    // The filter editor validates every filter before it is kept, so this only guards against a stale state.
  }
  if (extra) {
    for (const [key, val] of Object.entries(extra)) {
      if (val?.trim()) params.set(key, val.trim());
    }
  }
  return params;
}

function formatPercent(ratio: number | null | undefined) {
  if (ratio == null || !Number.isFinite(ratio)) return '—';
  return Intl.NumberFormat('en-GB', { style: 'percent', maximumFractionDigits: 1 }).format(ratio);
}

function formatCurrency(value: number | null | undefined, currency: string) {
  if (value == null || !Number.isFinite(value)) return '—';
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currency} ${number(value)}`;
  }
}

function formatVital(metric: PerformanceMetricKey, value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '—';
  if (metric === 'cls') {
    return new Intl.NumberFormat('en-GB', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(value);
  }
  if (value >= 1000) {
    return `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(value / 1000)} s`;
  }
  return `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 }).format(value)} ms`;
}

function comparison(current: number | undefined, previous: number | undefined) {
  if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous)) return undefined;
  if (!previous) return current ? 'Previously 0' : 'No change';
  const formatted = Intl.NumberFormat('en-GB', {
    style: 'percent',
    maximumFractionDigits: 1,
    signDisplay: 'exceptZero',
  }).format((current - previous) / previous);
  return `${formatted} vs previous period`;
}

function bounceRateInfo(current?: WebsiteReport['current'], previous?: WebsiteReport['previous']) {
  if (!current) return { formatted: '—', hint: undefined };
  if (current.visits <= 0) return { formatted: '0%', hint: '0 bounces' };
  const currentRate = Math.min(1, current.bounces / current.visits);
  const prevRate = previous && previous.visits > 0 ? Math.min(1, previous.bounces / previous.visits) : undefined;
  let diff = '';
  if (prevRate != null) {
    const pts = (currentRate - prevRate) * 100;
    const formattedPts = Intl.NumberFormat('en-GB', { maximumFractionDigits: 1, signDisplay: 'exceptZero' }).format(pts);
    diff = ` · ${pts === 0 ? 'No change' : `${formattedPts} pts vs prev`}`;
  }
  return {
    formatted: formatPercent(currentRate),
    hint: `${number(current.bounces)} bounces${diff}`,
  };
}

function avgDurationInfo(current?: WebsiteReport['current'], previous?: WebsiteReport['previous']) {
  if (!current || current.totaltime == null) return { formatted: '—', hint: undefined };
  const currentAvg = current.visits > 0 ? current.totaltime / current.visits : 0;
  const prevAvg = previous && previous.totaltime != null && previous.visits > 0
    ? previous.totaltime / previous.visits
    : undefined;
  return {
    formatted: duration(currentAvg),
    hint: comparison(currentAvg, prevAvg),
  };
}

/** Applying a saved segment or cohort sends its id; Umami reads the stored rules itself. */
function savedFilters(segment: WebsiteSegment, current: ReportFilters): ReportFilters {
  return segment.type === 'cohort' ? { ...current, cohort: segment.id } : { ...current, segment: segment.id };
}

function isSavedApplied(segment: WebsiteSegment, filters: ReportFilters) {
  return (segment.type === 'cohort' ? filters.cohort : filters.segment) === segment.id;
}

function sumPoints(points?: Point[] | null) {
  if (!points) return null;
  return points.reduce((total, point) => total + point.value, 0);
}

function formatColumnHeader(key: string) {
  const clean = key.includes('.') ? key.split('.').slice(1).join(' ') : key;
  if (clean.toLowerCase() === 'id') return 'ID';
  return clean
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, char => char.toUpperCase());
}

function formatReportSource(source: string) {
  if (!source) return 'Marketing data';
  return source
    .replace(/\bleads?\b/gi, match => (match.toLowerCase().endsWith('s') ? 'contacts' : 'contact'))
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

function csvCell(value: string | number | null | undefined) {
  if (value == null) return '';
  const raw = String(value);
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

function buildCsv(columns: string[], rows: Record<string, string | number | null>[]) {
  const header = columns.map(col => csvCell(col)).join(',');
  const lines = rows.map(row => columns.map(col => csvCell(row[col])).join(','));
  return [header, ...lines].join('\n') + '\n';
}

function slugifyFilename(value: string) {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return slug || 'report';
}

/* ── Shared Modals ─────────────────────────────────────────────────────────── */

function WebsiteForm({ onClose, onDone }: { onClose: () => void; onDone: (website: Website) => void }) {
  const action = useAction();
  const { values, field } = useFields({ name: '', domain: '' });
  return <Modal title="Add website" onClose={onClose}>
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        onDone(await api<Website>(websitesPath, 'POST', { name: values.name.trim(), domain: values.domain.trim() }));
      });
    }}>
      <TextInput label="Website name" isRequired {...field('name')} />
      <TextInput label="Website domain" description="Enter a hostname such as www.example.com." placeholder="www.example.com" isRequired {...field('domain')} />
      <Feedback error={action.error} />
      <FormActions>
        <Button label="Cancel" onClick={onClose} />
        <Button type="submit" variant="primary" label="Add website" isLoading={action.busy} />
      </FormActions>
    </form>
  </Modal>;
}

function CustomRange({ range, onClose, onDone }: { range: DateRange; onClose: () => void; onDone: (value: DateRange) => void }) {
  const [start, setStart] = useState(isoDay(range.startAt));
  const [end, setEnd] = useState(isoDay(range.endAt));
  const [today] = useState(() => isoDay(Date.now()));
  const [error, setError] = useState('');
  return <Modal title="Date range" onClose={onClose}>
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      const startAt = Date.parse(start);
      const endAt = Math.min(Date.parse(end) + day - 1, Date.now());
      if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || startAt >= endAt) {
        return setError('Choose an end date on or after the start date.');
      }
      if (endAt - startAt > 366 * day) {
        return setError('Choose a date range of up to one year.');
      }
      onDone({ startAt, endAt });
    }}>
      <div className="ov-form-grid">
        <DateInput label="Start date" value={start} max={today} onChange={value => value && setStart(value)} />
        <DateInput label="End date" value={end} max={today} onChange={value => value && setEnd(value)} />
      </div>
      <Text type="supporting" color="secondary">Dates use UTC. The comparison covers the immediately preceding period of equal length.</Text>
      <Feedback error={error} />
      <FormActions>
        <Button label="Cancel" onClick={onClose} />
        <Button variant="primary" type="submit" label="Apply dates" />
      </FormActions>
    </form>
  </Modal>;
}

function TrackingCode({ website, origin, onClose }: { website: Website; origin: string; onClose: () => void }) {
  const action = useAction();
  const base = `${websitesPath}/${website.id}/snippet`;
  const saved = useResource<SnippetPreferences & { snippet: string }>(`${base}?origin=${encodeURIComponent(origin)}`);
  const [draft, setDraft] = useState<SnippetOptions>();
  const [snippet, setSnippet] = useState<string>();
  const options = draft ?? saved.data?.options ?? DEFAULT_SNIPPET_OPTIONS;
  const code = snippet ?? saved.data?.snippet ?? '';
  const set = (patch: Partial<SnippetOptions>) => setDraft({ ...options, ...patch });
  return <Modal title="Tracking code" size="large" onClose={onClose}>
    <Text>Place this script in the &lt;head&gt; of each page on <strong>{website.domain}</strong> you want to measure.</Text>
    <AsyncState loading={saved.loading} error={saved.error} retry={saved.refresh} />
    <Snippet code={code} />
    <Heading level={3}>Options</Heading>
    <div className="ov-form-grid">
      <TextInput label="Only track these domains" placeholder="example.com, shop.example.com" value={options.domains.join(', ')}
        onChange={value => set({ domains: value.split(',').map(item => item.trim()).filter(Boolean) })} />
      <TextInput label="Tag" placeholder="spring-test" value={options.tag} onChange={tag => set({ tag })} />
      <TextInput label="Send data to another address" placeholder="https://analytics.example.com" value={options.hostUrl} onChange={hostUrl => set({ hostUrl })} />
      <TextInput label="Before-send function name" placeholder="beforeSend" value={options.beforeSend} onChange={beforeSend => set({ beforeSend })} />
    </div>
    <Switch label="Respect Do Not Track" value={options.doNotTrack} onChange={doNotTrack => set({ doNotTrack })} />
    <Switch label="Leave out the query string from page URLs" value={options.excludeSearch} onChange={excludeSearch => set({ excludeSearch })} />
    <Switch label="Leave out the #hash from page URLs" value={options.excludeHash} onChange={excludeHash => set({ excludeHash })} />
    <Switch label="Track page views and clicks automatically" value={options.autoTrack} onChange={autoTrack => set({ autoTrack })} />
    <Switch label="Record page speed (Core Web Vitals)" value={options.performance} onChange={performance => set({ performance })} />
    <Switch label="Wait for consent before loading" value={options.consentMode} onChange={consentMode => set({ consentMode })} />
    {options.consentMode ? <Banner
      status="info"
      title="Consent mode"
      description="This snippet loads nothing and stores nothing until your site calls ovelioConsent.grant(), for example from your cookie banner's Accept button. Call ovelioConsent.revoke() when a visitor withdraws consent. Use it if you want consent before any measurement, which is the safer choice for UK PECR and EU GDPR if you cannot show your analytics is strictly necessary or exempt. Visitors who never consent are not counted at all."
    /> : null}
    <Text type="supporting" color="secondary">Track a custom event by adding <Text type="code">{'data-umami-event="signed_up"'}</Text> to a button or link.</Text>
    <Text type="supporting" color="secondary">Website visitors are anonymous. OVELIO does not link visits to contacts unless an attribution has been established.</Text>
    <Feedback error={action.error} notice={action.notice} />
    <FormActions>
      <Button label="Save options" isLoading={action.busy} onClick={() => void action.run(async () => {
        const result = await api<SnippetPreferences & { snippet: string }>(base, 'PUT', { options, origin });
        setDraft(result.options);
        setSnippet(result.snippet);
      }, 'Tracking options saved.')} />
      <Button
        label="Copy tracking code"
        icon={<Copy size={15} />}
        onClick={() => void action.run(async () => navigator.clipboard.writeText(code), 'Tracking code copied. Save options first if you changed them.')}
      />
    </FormActions>
  </Modal>;
}

function ApiKeysSection() {
  const keys = useResource<ApiKeySummary[]>('/api-keys');
  const action = useAction();
  const [name, setName] = useState('');
  const [created, setCreated] = useState<CreatedApiKey>();
  return <div className="ov-stack-sm">
    <Heading level={3}>Server events API keys</Heading>
    <Text type="supporting" color="secondary">Send purchases and sign-ups from your server with POST /api/v1/events and an Authorization: Bearer key. Each event needs an idempotency key so a retry is never counted twice. Keys are shown once.</Text>
    {created ? <Banner status="warning" title="Copy this key now" description={created.key} /> : null}
    <AsyncState loading={keys.loading} error={keys.error} retry={keys.refresh} />
    {keys.data?.length ? <Rows>{keys.data.map(key => <li key={key.id}>
      <span><strong>{key.name}</strong> <Text type="code">{key.prefix}…</Text> {key.revokedAt ? <Badge label="Revoked" variant="neutral" /> : null}</span>
      <span>{key.rateLimitPerMinute}/min
        {key.revokedAt ? null : <IconButton label={`Revoke ${key.name}`} icon={<Trash2 size={14} />} onClick={() => void action.run(async () => {
          await api(`/api-keys/${key.id}`, 'DELETE');
          keys.refresh();
        }, 'API key revoked.')} />}
      </span>
    </li>)}</Rows> : null}
    <form className="ov-actions" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        setCreated(await api<CreatedApiKey>('/api-keys', 'POST', { name: name.trim() }));
        setName('');
        keys.refresh();
      }, 'API key created.');
    }}>
      <TextInput label="Key name" placeholder="Checkout server" value={name} onChange={setName} isRequired />
      <Button type="submit" label="Create key" icon={<Plus size={14} />} isDisabled={!name.trim()} />
    </form>
    <Feedback error={action.error} notice={action.notice} />
  </div>;
}

function WebsiteSettingsModal({
  website,
  range,
  isAdmin,
  onClose,
  onUpdated,
  onRequestReset,
  onRequestDelete,
}: {
  website: Website;
  range: DateRange;
  isAdmin: boolean;
  onClose: () => void;
  onUpdated: (website: Website) => void;
  onRequestReset: () => void;
  onRequestDelete: () => void;
}) {
  const saveAction = useAction();
  const shareAction = useAction();
  const exportAction = useAction();
  const { values, field, setValues } = useFields({ name: website.name, domain: website.domain, shareName: '' });
  const shares = useResource<WebsiteShare[]>(`${websitesPath}/${website.id}/shares`);

  return <Modal title="Website settings" size="large" onClose={onClose}>
    <div className="ov-stack">
      <form className="ov-stack-sm" onSubmit={event => {
        event.preventDefault();
        void saveAction.run(async () => {
          const updated = await api<Website>(`${websitesPath}/${website.id}`, 'PATCH', {
            name: values.name.trim(),
            domain: values.domain.trim(),
          });
          onUpdated(updated);
        }, 'Website settings saved.');
      }}>
        <Heading level={3}>Details</Heading>
        <div className="ov-form-grid">
          <TextInput label="Website name" isRequired {...field('name')} />
          <TextInput label="Website domain" isRequired {...field('domain')} />
        </div>
        <Feedback error={saveAction.error} notice={saveAction.notice} />
        <FormActions>
          <Button type="submit" variant="primary" label="Save changes" isLoading={saveAction.busy} />
        </FormActions>
      </form>

      <div className="ov-stack-sm">
        <Heading level={3}>Share links</Heading>
        <Text type="supporting" color="secondary">Create read-only public links for stakeholders to view aggregated traffic metrics.</Text>
        <form className="ov-toolbar" onSubmit={event => {
          event.preventDefault();
          void shareAction.run(async () => {
            if (!values.shareName.trim()) throw new Error('Enter a label for the share link.');
            await api<WebsiteShare>(`${websitesPath}/${website.id}/shares`, 'POST', { name: values.shareName.trim() });
            setValues(current => ({ ...current, shareName: '' }));
            shares.refresh();
          }, 'Share link created.');
        }}>
          <TextInput label="Share link name" placeholder="Executive monthly view" width={280} {...field('shareName')} />
          <Button type="submit" label="Create share link" icon={<Share2 size={14} />} isLoading={shareAction.busy} />
        </form>
        <Feedback error={shareAction.error} notice={shareAction.notice} />
        {!shares.data ? <AsyncState loading={shares.loading} error={shares.error} retry={shares.refresh} />
          : shares.data.length ? <Rows>{shares.data.map(share => {
            return <li key={share.id}>
              <span>
                <Text weight="medium">{share.name}</Text>
                <Text type="supporting" color="secondary">The public page is served by the analytics engine and is not available on this site&apos;s address yet.</Text>
              </span>
              <span className="ov-actions">
                <IconButton
                  size="sm"
                  variant="ghost"
                  label={`Delete share link ${share.name}`}
                  icon={<Trash2 size={14} />}
                  onClick={() => void shareAction.run(async () => {
                    await api(`${websitesPath}/${website.id}/shares/${share.id}`, 'DELETE');
                    shares.refresh();
                  }, 'Share link deleted.')}
                />
              </span>
            </li>;
          })}</Rows> : <Text type="supporting" color="secondary">No active share links for this website.</Text>}
      </div>

      {isAdmin ? <ApiKeysSection /> : null}

      {isAdmin ? <div className="ov-stack-sm">
        <Heading level={3}>Administration</Heading>
        <Text type="supporting" color="secondary">Export analytics data for the active date range, reset recorded history, or disconnect this website.</Text>
        <Feedback error={exportAction.error} notice={exportAction.notice} />
        <div className="ov-actions">
          <Button
            label="Export JSON"
            icon={<Download size={14} />}
            isLoading={exportAction.busy}
            onClick={() => void exportAction.run(async () => {
              const exported = await api<unknown>(`${websitesPath}/${website.id}/export?${rangeQuery(range)}`);
              const text = typeof exported === 'string' ? exported : JSON.stringify(exported, null, 2);
              saveFile(text, `ovelio-analytics-${website.domain}-${isoDay(range.startAt)}.json`, 'application/json');
            }, 'Analytics export downloaded.')}
          />
          <Button label="Reset data" variant="destructive" icon={<RotateCcw size={14} />} onClick={onRequestReset} />
          <Button label="Delete website" variant="destructive" icon={<Trash2 size={14} />} onClick={onRequestDelete} />
        </div>
      </div> : null}

      <FormActions>
        <Button label="Close" onClick={onClose} />
      </FormActions>
    </div>
  </Modal>;
}

/* ── Tab 1: Traffic Overview ───────────────────────────────────────────────── */

function AnnotationModal({
  websiteId,
  defaultDate,
  onClose,
  onDone,
}: {
  websiteId: string;
  defaultDate: ISODateString;
  onClose: () => void;
  onDone: () => void;
}) {
  const action = useAction();
  const [noteDate, setNoteDate] = useState<ISODateString>(defaultDate);
  const [note, setNote] = useState('');
  return <Modal title="Add annotation" onClose={onClose}>
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        await api<Annotation>(`${websitesPath}/${websiteId}/annotations`, 'POST', {
          date: noteDate,
          allDay: true,
          note: note.trim(),
        });
        onDone();
      }, 'Annotation added.');
    }}>
      <DateInput label="Date" value={noteDate} onChange={value => value && setNoteDate(value)} />
      <TextArea label="Milestone note" placeholder="Product launch, press mention, or campaign release" rows={3} isRequired value={note} onChange={setNote} />
      <Feedback error={action.error} />
      <FormActions>
        <Button label="Cancel" onClick={onClose} />
        <Button type="submit" variant="primary" label="Add annotation" isLoading={action.busy} isDisabled={!note.trim()} />
      </FormActions>
    </form>
  </Modal>;
}

function EventPropertiesInspector({
  websiteId,
  range,
  filters,
}: {
  websiteId: string;
  range: DateRange;
  filters: ReportFilters;
}) {
  const propsResource = useResource<EventPropertyStat[]>(
    `${websitesPath}/${websiteId}/events/properties?${rangeQuery(range, filters)}`,
  );
  const [selectedProp, setSelectedProp] = useState<EventPropertyStat>();
  const valuesResource = useResource<EventPropertyValue[]>(
    selectedProp
      ? `${websitesPath}/${websiteId}/events/values?${rangeQuery(range, undefined, {
        event: selectedProp.eventName,
        propertyName: selectedProp.propertyName,
      })}`
      : null,
  );

  return <section className="ov-stack-sm">
    <Heading level={3}>Event properties inspector</Heading>
    {!propsResource.data ? <AsyncState loading={propsResource.loading} error={propsResource.error} retry={propsResource.refresh} />
      : !propsResource.data.length ? <Empty title="No custom event properties recorded" description="Attach key-value data to custom events to inspect top property values." />
        : <div className="ov-split">
          <div className="ov-stack-sm">
            <Text type="supporting" color="secondary">Select a property to inspect its top recorded values.</Text>
            <Rows>{propsResource.data.slice(0, 20).map(item => {
              const active = selectedProp?.eventName === item.eventName && selectedProp?.propertyName === item.propertyName;
              return <li key={`${item.eventName}:${item.propertyName}`}>
                <span>
                  <Link
                    onClick={() => setSelectedProp(current =>
                      current?.eventName === item.eventName && current?.propertyName === item.propertyName ? undefined : item,
                    )}
                    weight={active ? 'semibold' : 'medium'}
                  >
                    {item.propertyName}
                  </Link>
                  <Text type="supporting" color="secondary">{item.eventName}</Text>
                </span>
                <Badge variant={active ? 'info' : 'neutral'} label={number(item.total)} />
              </li>;
            })}</Rows>
          </div>
          <div className="ov-stack-sm">
            {selectedProp ? <>
              <div className="ov-actions ov-actions--between">
                <Text weight="semibold">{selectedProp.eventName} · {selectedProp.propertyName}</Text>
                <Button size="sm" variant="ghost" label="Clear" onClick={() => setSelectedProp(undefined)} />
              </div>
              {!valuesResource.data ? <AsyncState loading={valuesResource.loading} error={valuesResource.error} retry={valuesResource.refresh} />
                : <Distribution points={valuesResource.data.map(entry => ({ label: entry.value || 'Empty', value: entry.total }))} />}
            </> : <Empty title="Select a property" description="Choose an event property on the left to inspect its value distribution." />}
          </div>
        </div>}
  </section>;
}

type ExpandedMetricTableRow = ExpandedMetricRow & { _id: string };

const propertyTypeOptions: { value: PropertyDataType; label: string }[] = [
  { value: 'string', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'True or false' },
  { value: 'date', label: 'Date' },
  { value: 'array', label: 'List' },
];

type FilterEdit =
  | { kind: 'rule'; index?: number; rule?: FilterRule }
  | { kind: 'property'; index?: number; property?: PropertyFilter };

/** Add or change one filter: a traffic dimension rule, or a session or event property rule. */
function FilterEditorModal({ edit, onClose, onSave }: {
  edit: FilterEdit;
  onClose: () => void;
  onSave: (next: { rule: FilterRule } | { property: PropertyFilter }) => void;
}) {
  const [kind, setKind] = useState<'rule' | 'session' | 'event'>(
    edit.kind === 'rule' ? 'rule' : edit.property?.scope ?? 'session',
  );
  const initialRule = edit.kind === 'rule' ? edit.rule : undefined;
  const initialProperty = edit.kind === 'property' ? edit.property : undefined;
  const [dimension, setDimension] = useState<FilterDimension>(initialRule?.dimension ?? 'path');
  const [operator, setOperator] = useState<string>(initialRule?.operator ?? initialProperty?.operator ?? 'eq');
  const [value, setValue] = useState(initialRule?.values.join(', ') ?? initialProperty?.value ?? '');
  const [propertyName, setPropertyName] = useState(initialProperty?.name ?? '');
  const [dataType, setDataType] = useState<PropertyDataType>(initialProperty?.dataType ?? 'string');
  const [error, setError] = useState<string>();

  const operators = kind === 'rule' ? [...SEGMENT_DIMENSION_OPERATORS] : [...PROPERTY_OPERATORS[dataType]];
  const listValue = kind === 'rule' && (operator === 'eq' || operator === 'neq');
  const isNew = edit.index === undefined;

  function submit() {
    try {
      if (kind === 'rule') {
        const values = operator === 'eq' || operator === 'neq'
          ? value.split(',').map(item => item.trim()).filter(Boolean)
          : [value.trim()].filter(Boolean);
        const rule: FilterRule = { dimension, operator: operator as DimensionOperator, values };
        filterQueryParams({ rules: [rule] });
        onSave({ rule });
      } else {
        const property: PropertyFilter = { scope: kind, name: propertyName.trim(), dataType, operator, value: value.trim() };
        filterQueryParams({ properties: [property] });
        onSave({ property });
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'This filter is not valid.');
    }
  }

  return <Modal title={isNew ? 'Add filter' : 'Edit filter'} onClose={onClose}>
    <form className="ov-stack-sm" onSubmit={event => { event.preventDefault(); submit(); }}>
      {isNew ? <SegmentedControl
        label="Filter on"
        size="sm"
        value={kind}
        onChange={next => {
          const target = next === 'session' || next === 'event' ? next : 'rule';
          setKind(target);
          setOperator('eq');
          setError(undefined);
        }}
      >
        <SegmentedControlItem value="rule" label="Traffic" />
        <SegmentedControlItem value="session" label="Session property" />
        <SegmentedControlItem value="event" label="Event property" />
      </SegmentedControl> : null}

      {kind === 'rule' ? <Selector
        label="Dimension"
        value={dimension}
        options={segmentFilterDimensionOptions}
        onChange={next => next && setDimension(next as FilterDimension)}
      /> : <div className="ov-form-grid">
        <TextInput
          label="Property name"
          placeholder={kind === 'session' ? 'plan' : 'order_value'}
          isRequired
          value={propertyName}
          onChange={setPropertyName}
        />
        <Selector
          label="Value type"
          value={dataType}
          options={propertyTypeOptions}
          onChange={next => {
            const type = (next ?? 'string') as PropertyDataType;
            setDataType(type);
            if (!PROPERTY_OPERATORS[type].includes(operator)) setOperator(PROPERTY_OPERATORS[type][0]);
          }}
        />
      </div>}

      <Selector
        label="Condition"
        value={operator}
        options={operators.map(item => ({ value: item, label: operatorLabel(item) }))}
        onChange={next => next && setOperator(next)}
      />

      {kind !== 'rule' && dataType === 'boolean' ? <Selector
        label="Value"
        value={value === 'false' ? 'false' : 'true'}
        options={[{ value: 'true', label: 'True' }, { value: 'false', label: 'False' }]}
        onChange={next => setValue(next ?? 'true')}
      /> : <TextInput
        label="Value"
        description={listValue
          ? 'Separate several values with commas to match any of them.'
          : kind !== 'rule' && dataType === 'date' ? 'Use the form YYYY-MM-DD.' : undefined}
        placeholder={kind === 'rule' ? (dimension === 'path' ? '/blog' : 'Value') : 'Value'}
        isRequired
        value={value}
        onChange={setValue}
      />}

      {kind === 'rule' && (operator === 'c' || operator === 'dnc') ? <Text type="supporting" color="secondary">
        Matching ignores upper and lower case.
      </Text> : null}
      <Feedback error={error} />
      <FormActions>
        <Button label="Cancel" onClick={onClose} />
        <Button type="submit" variant="primary" label={isNew ? 'Add filter' : 'Save filter'} />
      </FormActions>
    </form>
  </Modal>;
}

/** Active filters as plain sentences ("Path contains /blog") that can be edited, removed, or combined with OR. */
function ReportFilterBar({ filters, savedNames, onChange }: {
  filters: ReportFilters;
  savedNames: Record<string, string>;
  onChange: (next: ReportFilters) => void;
}) {
  const [edit, setEdit] = useState<FilterEdit>();
  const rules = filters.rules ?? [];
  const properties = filters.properties ?? [];
  const active = hasFilters(filters);

  function patch(next: ReportFilters) {
    const cleaned: ReportFilters = { ...next };
    if (!cleaned.rules?.length) delete cleaned.rules;
    if (!cleaned.properties?.length) delete cleaned.properties;
    if (!cleaned.segment) delete cleaned.segment;
    if (!cleaned.cohort) delete cleaned.cohort;
    if ((cleaned.rules?.length ?? 0) < 2) delete cleaned.match;
    onChange(cleaned);
  }

  function save(next: { rule: FilterRule } | { property: PropertyFilter }) {
    if ('rule' in next) {
      const index = edit?.index;
      patch({
        ...filters,
        rules: index === undefined ? [...rules, next.rule] : rules.map((item, pos) => pos === index ? next.rule : item),
      });
    } else {
      const index = edit?.index;
      patch({
        ...filters,
        properties: index === undefined ? [...properties, next.property] : properties.map((item, pos) => pos === index ? next.property : item),
      });
    }
    setEdit(undefined);
  }

  const chip = (key: string, label: string, onRemove: () => void, onEdit?: () => void) => <span className="ov-actions" key={key}>
    <Token label={label} color="blue" size="sm" onRemove={onRemove} />
    {onEdit ? <IconButton size="sm" variant="ghost" label={`Edit filter: ${label}`} icon={<Pencil size={12} />} onClick={onEdit} /> : null}
  </span>;

  return <div className="ov-filter-bar" role="region" aria-label="Active filters">
    <Text type="label" color="secondary">Filters:</Text>
    {rules.map((rule, index) => chip(
      `rule-${index}`,
      describeFilterRule(rule),
      () => patch({ ...filters, rules: rules.filter((_, pos) => pos !== index) }),
      () => setEdit({ kind: 'rule', index, rule }),
    ))}
    {properties.map((property, index) => chip(
      `property-${index}`,
      describePropertyFilter(property),
      () => patch({ ...filters, properties: properties.filter((_, pos) => pos !== index) }),
      () => setEdit({ kind: 'property', index, property }),
    ))}
    {filters.segment ? chip('segment', `Segment: ${savedNames[filters.segment] ?? 'saved segment'}`, () => patch({ ...filters, segment: undefined })) : null}
    {filters.cohort ? chip('cohort', `Cohort: ${savedNames[filters.cohort] ?? 'saved cohort'}`, () => patch({ ...filters, cohort: undefined })) : null}
    {rules.length > 1 ? <SegmentedControl
      label="How filters combine"
      size="sm"
      value={filters.match === 'any' ? 'any' : 'all'}
      onChange={next => patch({ ...filters, match: next === 'any' ? 'any' : 'all' })}
    >
      <SegmentedControlItem value="all" label="Match all" />
      <SegmentedControlItem value="any" label="Match any" />
    </SegmentedControl> : null}
    <Button size="sm" label="Add filter" icon={<Filter size={14} />} onClick={() => setEdit({ kind: 'rule' })} />
    {active ? <Button size="sm" variant="ghost" label="Clear all" onClick={() => onChange({})} /> : null}
    {edit ? <FilterEditorModal key={`${edit.kind}:${edit.index ?? 'new'}`} edit={edit} onClose={() => setEdit(undefined)} onSave={save} /> : null}
  </div>;
}

function WebsiteSegmentModal({
  websiteId,
  initialType,
  activeFilters,
  onClose,
  onDone,
}: {
  websiteId: string;
  initialType: 'segment' | 'cohort';
  activeFilters: ReportFilters;
  onClose: () => void;
  onDone: (createdType: 'segment' | 'cohort') => void;
}) {
  const action = useAction();
  const activeFilterRules = useMemo<WebsiteSegmentFilter[]>(
    () => (activeFilters.rules ?? []).map(rule => ({ name: rule.dimension, operator: rule.operator, value: rule.values.join(',') })),
    [activeFilters],
  );
  const activeSessionProperties = useMemo(
    () => (activeFilters.properties ?? []).filter(item => item.scope === 'session'),
    [activeFilters],
  );

  const [kind, setKind] = useState<'segment' | 'cohort'>(initialType);
  const [name, setName] = useState('');
  const [match, setMatch] = useState<'all' | 'any'>(activeFilters.match ?? 'all');
  const [includeProperties, setIncludeProperties] = useState(activeSessionProperties.length > 0);
  const [rules, setRules] = useState<WebsiteSegmentFilter[]>(() =>
    activeFilterRules.length ? activeFilterRules : [{ name: 'country', operator: 'eq', value: '' }],
  );
  const [actionType, setActionType] = useState<'path' | 'event'>('event');
  const [actionValue, setActionValue] = useState('');
  const [dateRange, setDateRange] = useState('30day');
  const [includeActiveFilters, setIncludeActiveFilters] = useState(activeFilterRules.length > 0);

  function updateRule(index: number, patch: Partial<WebsiteSegmentFilter>) {
    setRules(current => current.map((rule, pos) => pos === index ? { ...rule, ...patch } : rule));
  }

  return <Modal title={kind === 'cohort' ? 'Create visitor cohort' : 'Save traffic segment'} size="large" onClose={onClose}>
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        const trimmedName = name.trim();
        if (!trimmedName) throw new Error('Enter a name.');

        if (kind === 'segment') {
          const cleanRules = rules
            .map(rule => ({ name: rule.name.trim(), operator: rule.operator, value: rule.value.trim() }))
            .filter(rule => rule.name && rule.value);
          if (!cleanRules.length) throw new Error('Add at least one traffic filter rule with a value.');
          await api<WebsiteSegment>(`${websitesPath}/${websiteId}/segments`, 'POST', {
            name: trimmedName,
            type: 'segment',
            match,
            filters: cleanRules,
            ...(includeProperties && activeSessionProperties.length
              ? { sessionPropertyFilters: activeSessionProperties.map(item => ({ scope: 'session' as const, name: item.name, dataType: item.dataType, operator: item.operator, value: item.value })) }
              : {}),
          });
          onDone('segment');
          return;
        }

        const trimmedAction = actionValue.trim();
        if (!trimmedAction) throw new Error('Enter a page path or custom event for this cohort.');
        await api<WebsiteSegment>(`${websitesPath}/${websiteId}/segments`, 'POST', {
          name: trimmedName,
          type: 'cohort',
          action: { type: actionType, value: trimmedAction },
          dateRange,
          ...(includeActiveFilters && activeFilterRules.length ? { filters: activeFilterRules, match: 'all' as const } : {}),
        });
        onDone('cohort');
      }, kind === 'cohort' ? 'Cohort created.' : 'Traffic segment saved.');
    }}>
      <div className="ov-actions">
        <SegmentedControl label="Saved filter type" size="sm" value={kind} onChange={v => setKind(v === 'cohort' ? 'cohort' : 'segment')}>
          <SegmentedControlItem value="segment" label="Segment" />
          <SegmentedControlItem value="cohort" label="Cohort" />
        </SegmentedControl>
      </div>

      <TextInput
        label={kind === 'cohort' ? 'Cohort name' : 'Segment name'}
        placeholder={kind === 'cohort' ? 'Pricing visitors (30 days)' : 'UK mobile traffic'}
        isRequired
        value={name}
        onChange={setName}
      />

      {kind === 'segment' ? <div className="ov-stack-sm">
        <Selector
          label="Rule matching"
          value={match}
          onChange={v => setMatch(v === 'any' ? 'any' : 'all')}
          options={[
            { value: 'all', label: 'Match all filters' },
            { value: 'any', label: 'Match any filter' },
          ]}
        />
        {rules.map((rule, index) => <div className="ov-step" key={index}>
          <div className="ov-step-heading">
            <Text weight="semibold">Filter {index + 1}</Text>
            {rules.length > 1 ? <IconButton
              size="sm"
              variant="ghost"
              label={`Remove filter ${index + 1}`}
              icon={<Trash2 size={14} />}
              onClick={() => setRules(current => current.filter((_, pos) => pos !== index))}
            /> : null}
          </div>
          <div className="ov-form-grid ov-form-grid--three">
            <Selector
              label="Dimension"
              value={rule.name}
              options={segmentFilterDimensionOptions}
              onChange={v => v && updateRule(index, { name: v })}
            />
            <Selector
              label="Operator"
              value={rule.operator}
              options={[...segmentOperatorOptions]}
              onChange={v => v && updateRule(index, { operator: v })}
            />
            <TextInput
              label="Value"
              description={rule.operator === 'eq' || rule.operator === 'neq' ? 'Separate several values with commas.' : undefined}
              placeholder={rule.name === 'path' ? '/pricing' : rule.name === 'country' ? 'GB' : 'Value'}
              isRequired
              value={rule.value}
              onChange={value => updateRule(index, { value })}
            />
          </div>
        </div>)}
        {activeSessionProperties.length ? <Switch
          label={`Include ${activeSessionProperties.length} active session ${activeSessionProperties.length === 1 ? 'property filter' : 'property filters'}`}
          value={includeProperties}
          onChange={setIncludeProperties}
        /> : null}
        {rules.length < ANALYTICS_LIMITS.filterRules ? <div>
          <Button
            size="sm"
            label="Add filter rule"
            icon={<Plus size={14} />}
            onClick={() => setRules(current => [...current, { name: 'path', operator: 'eq', value: '' }])}
          />
        </div> : null}
      </div> : <div className="ov-stack-sm">
        <div className="ov-form-grid ov-form-grid--three">
          <Selector
            label="Cohort action"
            value={actionType}
            options={stepTypes}
            onChange={v => setActionType(v === 'path' ? 'path' : 'event')}
          />
          <TextInput
            label="Matching value"
            placeholder={actionType === 'path' ? '/pricing' : 'signed_up'}
            isRequired
            value={actionValue}
            onChange={setActionValue}
          />
          <Selector
            label="Cohort window"
            value={dateRange}
            options={[...cohortDateRangeOptions]}
            onChange={v => v && setDateRange(v)}
          />
        </div>
        {activeFilterRules.length ? <Switch
          label={`Include ${activeFilterRules.length} active traffic ${activeFilterRules.length === 1 ? 'filter' : 'filters'}`}
          value={includeActiveFilters}
          onChange={setIncludeActiveFilters}
        /> : null}
      </div>}

      <Text type="supporting" color="secondary">
        Segments and cohorts group anonymous website traffic only and are separate from identified contacts.
      </Text>
      <Feedback error={action.error} />
      <FormActions>
        <Button label="Cancel" onClick={onClose} />
        <Button type="submit" variant="primary" label={kind === 'cohort' ? 'Create cohort' : 'Save segment'} isLoading={action.busy} />
      </FormActions>
    </form>
  </Modal>;
}

function SavedSegmentsPanel({
  websiteId,
  filters,
  canEdit,
  onApplyFilters,
}: {
  websiteId: string;
  filters: ReportFilters;
  canEdit: boolean;
  onApplyFilters: (next: ReportFilters, savedName?: { id: string; name: string }) => void;
}) {
  const segments = useResource<WebsiteSegment[]>(`${websitesPath}/${websiteId}/segments?type=segment`);
  const cohorts = useResource<WebsiteSegment[]>(`${websitesPath}/${websiteId}/segments?type=cohort`);
  const deleteAction = useAction();

  const [view, setView] = useState<'segment' | 'cohort'>('segment');
  const [createKind, setCreateKind] = useState<'segment' | 'cohort'>();
  const [deleteTarget, setDeleteTarget] = useState<WebsiteSegment>();

  const activeFilterCount = (filters.rules?.length ?? 0) + (filters.properties?.length ?? 0);
  const activeResource = view === 'cohort' ? cohorts : segments;

  function refreshAll() {
    segments.refresh();
    cohorts.refresh();
  }

  function describeSegment(item: WebsiteSegment) {
    const parts: string[] = [];
    if (item.action?.value) {
      parts.push(`${item.action.type === 'event' ? 'Event' : 'Path'}: ${item.action.value}`);
    }
    for (const rule of item.filters) {
      const dim = FILTER_DIMENSION_LABELS[rule.name as FilterDimension] ?? dimensionLabels[rule.name as ReportDimension] ?? rule.name;
      const op = operatorLabel(rule.operator);
      parts.push(`${dim} ${op} ${rule.value.split(',').join(' or ')}`);
    }
    for (const property of item.sessionPropertyFilters ?? []) parts.push(describePropertyFilter(property));
    return parts.join(' · ') || 'No filter rules recorded';
  }

  return <Panel
    title="Saved segments & cohorts"
    description="Reusable anonymous traffic filter presets and visitor cohorts — click any item to apply its filters"
    action={<div className="ov-actions">
      <SegmentedControl label="Saved segment view" size="sm" value={view} onChange={v => setView(v === 'cohort' ? 'cohort' : 'segment')}>
        <SegmentedControlItem value="segment" label={`Segments${segments.data ? ` (${segments.data.length})` : ''}`} />
        <SegmentedControlItem value="cohort" label={`Cohorts${cohorts.data ? ` (${cohorts.data.length})` : ''}`} />
      </SegmentedControl>
      <IconButton
        size="sm"
        label="Refresh saved segments and cohorts"
        icon={<RefreshCw size={14} />}
        onClick={refreshAll}
        isLoading={segments.loading || cohorts.loading}
      />
      {canEdit ? <>
        <Button
          size="sm"
          label={activeFilterCount ? `Save active filters (${activeFilterCount})` : 'New segment'}
          icon={<Filter size={14} />}
          onClick={() => setCreateKind('segment')}
        />
        <Button
          size="sm"
          label="New cohort"
          icon={<Plus size={14} />}
          onClick={() => setCreateKind('cohort')}
        />
      </> : null}
    </div>}
  >
    <Feedback error={deleteAction.error} notice={deleteAction.notice} />
    {!activeResource.data ? <AsyncState loading={activeResource.loading} error={activeResource.error} retry={activeResource.refresh} />
      : activeResource.data.length ? <Rows>{activeResource.data.map(item => {
        const isApplied = isSavedApplied(item, filters);
        const apply = () => onApplyFilters(savedFilters(item, filters), { id: item.id, name: item.name });
        return <li key={item.id}>
          <span>
            <span className="ov-actions">
              <Link onClick={apply} weight={isApplied ? 'semibold' : 'medium'}>{item.name}</Link>
              {isApplied ? <StatusBadge label="Active" tone="info" /> : null}
              {item.dateRange ? <Badge variant="neutral" label={cohortDateRangeLabels[item.dateRange] ?? item.dateRange} /> : null}
              {item.type === 'segment' && item.match ? <Badge variant="neutral" label={item.match === 'any' ? 'Match any' : 'Match all'} /> : null}
            </span>
            <Text type="supporting" color="secondary">{describeSegment(item)}</Text>
          </span>
          <span className="ov-actions">
            <Button
              size="sm"
              variant="ghost"
              label={isApplied ? 'Applied' : 'Apply'}
              isDisabled={isApplied}
              onClick={apply}
            />
            {canEdit ? <IconButton
              size="sm"
              variant="ghost"
              label={`Delete ${item.type} ${item.name}`}
              icon={<Trash2 size={14} />}
              onClick={() => setDeleteTarget(item)}
            /> : null}
          </span>
        </li>;
      })}</Rows> : <Empty
        title={view === 'cohort' ? 'No saved visitor cohorts yet' : 'No saved traffic segments yet'}
        description={view === 'cohort'
          ? 'Create a cohort based on a page path or custom event and rolling window.'
          : 'Apply filters on the Traffic report and save them here for one-click reuse.'}
      />}

    {createKind && canEdit ? <WebsiteSegmentModal
      websiteId={websiteId}
      initialType={createKind}
      activeFilters={filters}
      onClose={() => setCreateKind(undefined)}
      onDone={createdType => {
        setCreateKind(undefined);
        setView(createdType);
        refreshAll();
      }}
    /> : null}

    {deleteTarget && canEdit ? <ConfirmDialog
      title={`Delete ${deleteTarget.type}`}
      description={`Remove "${deleteTarget.name}" from this website? Recorded analytics events are not affected.`}
      actionLabel={`Delete ${deleteTarget.type}`}
      busy={deleteAction.busy}
      onClose={() => setDeleteTarget(undefined)}
      onConfirm={() => void deleteAction.run(async () => {
        await api(`${websitesPath}/${websiteId}/segments/${deleteTarget.id}`, 'DELETE');
        setDeleteTarget(undefined);
        refreshAll();
      }, deleteTarget.type === 'cohort' ? 'Cohort deleted.' : 'Traffic segment deleted.')}
    /> : null}
  </Panel>;
}

function RecentEventsPanel({
  websiteId,
  range,
  filters,
  onAddFilter,
}: {
  websiteId: string;
  range: DateRange;
  filters: ReportFilters;
  onAddFilter: (dimension: ReportDimension, value: string) => void;
}) {
  const [queryInput, setQueryInput] = useState('');
  const [search, setSearch] = useState('');

  const filterSig = `${websiteId}:${range.startAt}:${range.endAt}:${JSON.stringify(filters)}:${search}`;
  const [pageState, setPageState] = useState({ sig: filterSig, page: 1 });
  const page = pageState.sig === filterSig ? pageState.page : 1;
  const setPage = (next: number) => setPageState({ sig: filterSig, page: next });

  const events = useResource<Page<WebsiteEventRow>>(
    `${websitesPath}/${websiteId}/events?${rangeQuery(range, filters, {
      page: String(page),
      q: search || undefined,
    })}`,
  );

  return <Panel
    title="Recent events feed"
    description={events.data ? `${number(events.data.total)} chronological anonymous page views and custom events` : 'Chronological page views and custom events recorded in this period'}
    action={<IconButton size="sm" label="Refresh recent events" icon={<RefreshCw size={14} />} onClick={events.refresh} isLoading={events.loading} />}
  >
    <div className="ov-toolbar">
      <form onSubmit={event => { event.preventDefault(); setSearch(queryInput.trim()); setPage(1); }}>
        <TextInput
          label="Search events"
          isLabelHidden
          type="search"
          startIcon="search"
          placeholder="Filter by path, event name, referrer, country…"
          value={queryInput}
          onChange={setQueryInput}
          width={320}
        />
        <Button type="submit" label="Search" icon={<Search size={15} />} />
        {search ? <Button variant="ghost" label="Clear" onClick={() => { setQueryInput(''); setSearch(''); setPage(1); }} /> : null}
      </form>
    </div>

    {!events.data ? <AsyncState loading={events.loading} error={events.error} retry={events.refresh} /> : <>
      <Table
        data={events.data.items}
        idKey="id"
        hasHover
        emptyState={<Empty title={search ? 'No events match your search' : 'No recorded events in this period'} />}
        columns={[
          {
            key: 'eventType',
            header: 'Type',
            renderCell: row => {
              const isEvent = Boolean(row.eventName) || row.eventType === 2;
              return <Badge label={isEvent ? 'Event' : 'Page view'} variant={isEvent ? 'info' : 'neutral'} />;
            },
          },
          {
            key: 'urlPath',
            header: 'Path / Event',
            renderCell: row => row.eventName ? <span className="ov-cell">
              <Link onClick={() => onAddFilter('event', row.eventName!)} weight="medium">{row.eventName}</Link>
              {row.urlPath ? <Text type="supporting" color="secondary">{row.urlPath}</Text> : null}
            </span> : <span className="ov-cell">
              <Link onClick={() => onAddFilter('path', row.urlPath || '/')} weight="medium">{row.urlPath || '/'}</Link>
              {row.pageTitle ? <Text type="supporting" color="secondary">{row.pageTitle}</Text> : null}
            </span>,
          },
          {
            key: 'referrerDomain',
            header: 'Referrer',
            renderCell: row => row.referrerDomain
              ? <Link onClick={() => onAddFilter('referrer', row.referrerDomain!)}>{row.referrerDomain}</Link>
              : <Text color="secondary">Direct</Text>,
          },
          { key: 'country', header: 'Country', renderCell: row => row.country || '—' },
          { key: 'device', header: 'Device', renderCell: row => row.device || '—' },
          { key: 'browser', header: 'Browser', renderCell: row => row.browser || '—' },
          {
            key: 'createdAt',
            header: 'Time',
            renderCell: row => <Timestamp value={row.createdAt} format="date_time" />,
          },
        ]}
      />
      <Pager {...events.data} onPage={setPage} />
    </>}
  </Panel>;
}

function TrafficTab({
  website,
  range,
  filters,
  canEdit,
  onAddFilter,
  onApplyFilters,
  refreshRange,
}: {
  website: Website;
  range: DateRange;
  filters: ReportFilters;
  canEdit: boolean;
  onAddFilter: (dimension: ReportDimension, value: string) => void;
  onApplyFilters: (next: ReportFilters, savedName?: { id: string; name: string }) => void;
  refreshRange?: () => void;
}) {
  const report = useResource<WebsiteReport>(`${websitesPath}/${website.id}/report?${rangeQuery(range, filters)}`);
  const annotations = useResource<Annotation[]>(`${websitesPath}/${website.id}/annotations?${rangeQuery(range)}`);
  const deleteAction = useAction();
  const [chart, setChart] = useState('pageviews');
  const [breakdown, setBreakdown] = useState<BreakdownTab>('Pages');
  const [breakdownMode, setBreakdownMode] = useState<'compact' | 'expanded'>('compact');
  const [expandedDim, setExpandedDim] = useState<ReportDimension>('path');
  const [addNoteOpen, setAddNoteOpen] = useState(false);
  const [deleteNote, setDeleteNote] = useState<Annotation>();

  const activeExpandedDim: ReportDimension = breakdown === 'Events'
    ? 'event'
    : breakdownGroups[breakdown].some(([key]) => key === expandedDim)
      ? expandedDim
      : breakdownGroups[breakdown][0][0];

  const expanded = useResource<ExpandedMetricRow[]>(
    breakdownMode === 'expanded'
      ? `${websitesPath}/${website.id}/metrics/expanded?${rangeQuery(range, filters, { type: activeExpandedDim })}`
      : null,
  );

  const expandedRows: ExpandedMetricTableRow[] = useMemo(
    () => (expanded.data ?? []).map((row, idx) => ({ ...row, _id: `${row.name}-${idx}` })),
    [expanded.data],
  );

  function handleBreakdownTabChange(next: BreakdownTab) {
    setBreakdown(next);
    setExpandedDim(next === 'Events' ? 'event' : breakdownGroups[next][0][0]);
  }

  const current = report.data?.current;
  const previous = report.data?.previous;
  const bounce = bounceRateInfo(current, previous);
  const avgDuration = avgDurationInfo(current, previous);

  const seriesPoints = chart === 'visitors'
    ? report.data?.visitors
    : chart === 'events'
      ? report.data?.eventsSeries
      : report.data?.pageviews;
  const seriesLabel = chart === 'visitors'
    ? 'Unique visitors over time'
    : chart === 'events'
      ? 'Custom events over time'
      : 'Page views over time';

  return <div className="ov-stack">
    {!report.data ? <Panel><AsyncState loading={report.loading} error={report.error} retry={report.refresh} /></Panel> : <>
      {report.data.activeVisitors != null ? <div className="ov-actions">
        <StatusDot
          variant={report.data.activeVisitors > 0 ? 'success' : 'neutral'}
          isPulsing={report.data.activeVisitors > 0}
          label="Active visitors"
        />
        <Text type="supporting" weight="medium">
          {number(report.data.activeVisitors)} active {report.data.activeVisitors === 1 ? 'visitor' : 'visitors'} right now
        </Text>
      </div> : null}

      <div className="ov-metrics">
        <Metric label="Page views" value={current?.pageviews} hint={comparison(current?.pageviews, previous?.pageviews)} />
        <Metric label="Unique visitors" value={current?.visitors} hint={comparison(current?.visitors, previous?.visitors)} />
        <Metric label="Visits" value={current?.visits} hint={comparison(current?.visits, previous?.visits)} />
        <Metric label="Bounce rate" formatted={bounce.formatted} hint={bounce.hint} />
        <Metric label="Avg. visit duration" formatted={avgDuration.formatted} hint={avgDuration.hint} />
      </div>

      <SavedSegmentsPanel
        websiteId={website.id}
        filters={filters}
        canEdit={canEdit}
        onApplyFilters={onApplyFilters}
      />

      <Panel
        title="Traffic"
        description="Website activity compared with the preceding period"
        action={<div className="ov-actions" style={{ flexWrap: 'nowrap' }}>
          <SegmentedControl label="Traffic measure" size="sm" value={chart} onChange={setChart}>
            <SegmentedControlItem value="pageviews" label="Page views" />
            <SegmentedControlItem value="visitors" label="Unique visitors" />
            <SegmentedControlItem value="events" label="Events" />
          </SegmentedControl>
          <IconButton size="sm" label="Refresh metrics" icon={<RefreshCw size={14} />} onClick={refreshRange || report.refresh} isLoading={report.loading} />
        </div>}
      >
        <Bars points={seriesPoints} label={seriesLabel} />
      </Panel>

      <Panel
        title="Traffic breakdown"
        description="Click any row to add it as an active filter."
        action={<div className="ov-actions">
          <SegmentedControl
            label="Breakdown mode"
            size="sm"
            value={breakdownMode}
            onChange={v => setBreakdownMode(v === 'expanded' ? 'expanded' : 'compact')}
          >
            <SegmentedControlItem value="compact" label="Compact" />
            <SegmentedControlItem value="expanded" label="Expanded" />
          </SegmentedControl>
          {breakdownMode === 'expanded' ? <IconButton
            size="sm"
            label="Refresh expanded metrics"
            icon={<RefreshCw size={14} />}
            onClick={expanded.refresh}
            isLoading={expanded.loading}
          /> : null}
        </div>}
      >
        <Tabs label="Traffic breakdown" items={breakdownTabs} value={breakdown} onChange={handleBreakdownTabChange} />
        {breakdownMode === 'expanded' ? <div className="ov-stack">
          {breakdown !== 'Events' ? <div className="ov-actions">
            <Selector
              label="Dimension"
              isLabelHidden
              width={220}
              value={activeExpandedDim}
              onChange={value => value && setExpandedDim(value as ReportDimension)}
              options={breakdownGroups[breakdown].map(([value, label]) => ({ value, label }))}
            />
          </div> : null}

          {!expanded.data ? <AsyncState loading={expanded.loading} error={expanded.error} retry={expanded.refresh} />
            : <Table
              data={expandedRows}
              idKey="_id"
              hasHover
              emptyState={<Empty title="No metrics recorded in this period" />}
              columns={[
                {
                  key: 'name',
                  header: dimensionLabels[activeExpandedDim] ?? 'Name',
                  renderCell: row => isFilterable(activeExpandedDim)
                    ? <Link onClick={() => onAddFilter(activeExpandedDim, row.name)} weight="medium">
                      {row.name || 'Unknown'}
                    </Link>
                    : <span>{row.name || 'Unknown'}</span>,
                },
                { key: 'visitors', header: 'Visitors', align: 'end', renderCell: row => number(row.visitors) },
                { key: 'visits', header: 'Visits', align: 'end', renderCell: row => number(row.visits) },
                { key: 'pageviews', header: 'Pageviews', align: 'end', renderCell: row => number(row.pageviews) },
                {
                  key: 'bounces',
                  header: 'Bounce rate',
                  align: 'end',
                  renderCell: row => row.visits > 0 ? formatPercent(Math.min(1, row.bounces / row.visits)) : '0%',
                },
                {
                  key: 'totaltime',
                  header: 'Avg visit time',
                  align: 'end',
                  renderCell: row => row.visits > 0 ? duration(row.totaltime / row.visits) : '0s',
                },
              ]}
            />}

          {breakdown === 'Events' ? <EventPropertiesInspector websiteId={website.id} range={range} filters={filters} /> : null}
        </div> : breakdown === 'Events' ? <div className="ov-stack">
          <section className="ov-stack-sm">
            <Heading level={3}>Custom events</Heading>
            <Distribution
              points={report.data.dimensions.event}
              onSelect={value => onAddFilter('event', value)}
            />
          </section>
          <EventPropertiesInspector websiteId={website.id} range={range} filters={filters} />
        </div> : <div className="ov-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          {breakdownGroups[breakdown].map(([key, title]) => <section key={key} className="ov-stack-sm">
            <Heading level={3}>{title}</Heading>
            <Distribution
              points={report.data?.dimensions[key]}
              onSelect={value => onAddFilter(key, value)}
            />
          </section>)}
        </div>}
      </Panel>

      <RecentEventsPanel
        websiteId={website.id}
        range={range}
        filters={filters}
        onAddFilter={onAddFilter}
      />

      <Panel
        title="Annotations"
        description="Dated campaign launches and milestones recorded in this period"
        action={canEdit ? <Button size="sm" label="Add annotation" icon={<BookmarkPlus size={14} />} onClick={() => setAddNoteOpen(true)} /> : undefined}
      >
        <Feedback error={deleteAction.error} notice={deleteAction.notice} />
        {!annotations.data ? <AsyncState loading={annotations.loading} error={annotations.error} retry={annotations.refresh} />
          : annotations.data.length ? <Rows>{annotations.data.map(item => <li key={item.id}>
            <span>
              <Text weight="medium">{item.note}</Text>
              <Text type="supporting" color="secondary">{date(item.date)}</Text>
            </span>
            {canEdit ? <IconButton
              size="sm"
              variant="ghost"
              label={`Delete annotation ${item.note}`}
              icon={<Trash2 size={14} />}
              onClick={() => setDeleteNote(item)}
            /> : null}
          </li>)}</Rows> : <Text type="supporting" color="secondary">No milestones annotated in this date range.</Text>}
      </Panel>
    </>}

    {addNoteOpen && canEdit ? <AnnotationModal
      websiteId={website.id}
      defaultDate={isoDay(range.endAt)}
      onClose={() => setAddNoteOpen(false)}
      onDone={() => { setAddNoteOpen(false); annotations.refresh(); }}
    /> : null}

    {deleteNote && canEdit ? <ConfirmDialog
      title="Delete annotation"
      description={`Remove "${deleteNote.note}" (${date(deleteNote.date)}) from this website?`}
      actionLabel="Delete annotation"
      busy={deleteAction.busy}
      onClose={() => setDeleteNote(undefined)}
      onConfirm={() => void deleteAction.run(async () => {
        await api(`${websitesPath}/${website.id}/annotations/${deleteNote.id}`, 'DELETE');
        setDeleteNote(undefined);
        annotations.refresh();
      }, 'Annotation deleted.')}
    /> : null}
  </div>;
}

/* ── Tab 2: Realtime ───────────────────────────────────────────────────────── */

function RealtimeTab({ website }: { website: Website }) {
  const realtime = useResource<RealtimeReport>(`${websitesPath}/${website.id}/realtime`);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const refreshRef = useRef(realtime.refresh);

  useEffect(() => {
    refreshRef.current = realtime.refresh;
  }, [realtime.refresh]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => refreshRef.current(), 15_000);
    return () => window.clearInterval(timer);
  }, [autoRefresh]);

  const data = realtime.data;

  return <div className="ov-stack">
    <Panel
      title="Live activity"
      description="Real-time anonymous visitor activity across the last 30 minutes"
      action={<div className="ov-actions">
        <StatusDot variant={data && data.visitors > 0 ? 'success' : 'neutral'} isPulsing={Boolean(data && data.visitors > 0)} label="Realtime stream" />
        <Switch label="Auto-refresh (15s)" value={autoRefresh} onChange={setAutoRefresh} />
        <Button size="sm" label="Refresh" icon={<RefreshCw size={14} />} onClick={realtime.refresh} isLoading={realtime.loading && !!data} />
      </div>}
    >
      {!data ? <AsyncState loading={realtime.loading} error={realtime.error} retry={realtime.refresh} /> : <div className="ov-stack">
        <div className="ov-metrics">
          <Metric flat label="Active visitors" value={data.visitors} icon={<Users size={16} />} />
          <Metric flat label="Views (30m)" value={data.pageviews} icon={<Eye size={16} />} />
          <Metric flat label="Events (30m)" value={data.events} icon={<MousePointerClick size={16} />} />
        </div>
        <Bars points={data.series} label="Live website activity over the last 30 minutes" />
      </div>}
    </Panel>

    {data ? <>
      <div className="ov-grid ov-grid--three">
        <Panel title="Active pages"><Distribution points={data.urls} /></Panel>
        <Panel title="Active countries"><Distribution points={data.countries} /></Panel>
        <Panel title="Active referrers"><Distribution points={data.referrers} /></Panel>
      </div>

      <Panel title="Recent anonymous events" description="Latest page views and custom events recorded on this website" action={<Activity size={17} aria-hidden="true" />}>
        {data.recent.length ? <Rows>{data.recent.slice(0, 30).map((item, index) => <li key={`${item.createdAt}-${item.path}-${index}`}>
          <span>
            <span className="ov-actions">
              <Badge label={item.eventName ? 'Event' : 'Page view'} variant={item.eventName ? 'info' : 'neutral'} />
              <Text weight="medium">{item.eventName || item.path || '/'}</Text>
            </span>
            <Text type="supporting" color="secondary">
              {[item.eventName ? item.path : null, item.country, item.browser, item.device].filter(Boolean).join(' · ') || 'Anonymous visitor'}
            </Text>
          </span>
          <Timestamp value={item.createdAt} format="relative_short" />
        </li>)}</Rows> : <Empty title="No recent live events" description="Activity will appear here as visitors browse your site." />}
      </Panel>
    </> : null}
  </div>;
}

/* ── Tab 3: Sessions & Weekly Heatmap ──────────────────────────────────────── */

const dataTypeByCode: Record<number, PropertyDataType> = { 1: 'string', 2: 'number', 3: 'boolean', 4: 'date', 5: 'array' };

/** "Filter by this" for a recorded session property: an `is` filter, or `contains` for list values. */
function sessionPropertyFilter(entry: SessionPropertyEntry): PropertyFilter | undefined {
  const dataType = dataTypeByCode[entry.dataType] ?? 'string';
  if (entry.value === '' || (dataType === 'string' && entry.value.includes(','))) return undefined;
  const value = dataType === 'date' ? entry.value.slice(0, 10) : entry.value;
  return { scope: 'session', name: entry.propertyName, dataType, operator: dataType === 'array' ? 'c' : 'eq', value };
}

function SessionActivityDrawer({
  websiteId,
  session,
  range,
  onAddProperty,
  onClose,
}: {
  websiteId: string;
  session: WebsiteSession;
  range: DateRange;
  onAddProperty: (property: PropertyFilter) => void;
  onClose: () => void;
}) {
  const activity = useResource<SessionActivityItem[]>(
    `${websitesPath}/${websiteId}/sessions/${session.id}/activity?${rangeQuery(range)}`,
  );
  const properties = useResource<SessionPropertyEntry[]>(
    `${websitesPath}/${websiteId}/sessions/${session.id}/properties`,
  );
  const locationText = [session.city, session.region, session.country].filter(Boolean).join(', ') || 'Unknown';
  const subtitle = [session.browser, session.os, session.device].filter(Boolean).join(' · ') || 'Anonymous session';

  return <SlideDrawer title="Session activity" subtitle={subtitle} onClose={onClose} width={580}>
    <MetadataList>
      <MetadataListItem label="Location">{locationText}</MetadataListItem>
      <MetadataListItem label="Device & screen">{[session.device, session.screen].filter(Boolean).join(' · ') || '—'}</MetadataListItem>
      <MetadataListItem label="Language">{session.language || '—'}</MetadataListItem>
      <MetadataListItem label="Hostname">{session.hostname || '—'}</MetadataListItem>
      <MetadataListItem label="Totals">{`${number(session.views)} views · ${number(session.visits)} visits · ${number(session.events)} events`}</MetadataListItem>
      <MetadataListItem label="First seen"><Timestamp value={session.firstAt} format="date_time" /></MetadataListItem>
      <MetadataListItem label="Last seen"><Timestamp value={session.lastAt} format="date_time" /></MetadataListItem>
    </MetadataList>

    <div className="ov-stack-sm">
      <Heading level={3}>Session properties</Heading>
      <Text type="supporting" color="secondary">Custom details sent with identify calls, shown as recorded.</Text>
      {!properties.data ? <AsyncState loading={properties.loading} error={properties.error} retry={properties.refresh} />
        : properties.data.length ? <MetadataList>
          {properties.data.map((entry, idx) => (
            <MetadataListItem key={`${entry.propertyName}-${idx}`} label={entry.propertyName}>
              <span className="ov-actions">
                <Text>{entry.value || '—'}</Text>
                {sessionPropertyFilter(entry) ? <Button
                  size="sm"
                  variant="ghost"
                  label="Filter by this"
                  icon={<Filter size={12} />}
                  onClick={() => {
                    const filter = sessionPropertyFilter(entry);
                    if (filter) onAddProperty(filter);
                  }}
                /> : null}
              </span>
            </MetadataListItem>
          ))}
        </MetadataList> : <Text type="supporting" color="secondary">No custom properties recorded for this anonymous session.</Text>}
    </div>

    <div className="ov-stack-sm">
      <Heading level={3}>Chronological activity</Heading>
      {!activity.data ? <AsyncState loading={activity.loading} error={activity.error} retry={activity.refresh} />
        : activity.data.length ? <Rows>{activity.data.map(item => {
          const isEvent = Boolean(item.eventName) || item.eventType === 2;
          const pathWithQuery = item.urlPath ? `${item.urlPath}${item.urlQuery ? `?${item.urlQuery}` : ''}` : null;
          return <li key={item.id}>
            <span>
              <span className="ov-actions">
                <Badge label={isEvent ? 'Event' : 'Page view'} variant={isEvent ? 'info' : 'neutral'} />
                <Text weight="medium">{item.eventName || pathWithQuery || '/'}</Text>
              </span>
              <Text type="supporting" color="secondary">
                {[isEvent ? pathWithQuery : null, item.pageTitle, item.referrerDomain ? `Ref: ${item.referrerDomain}` : null]
                  .filter(Boolean)
                  .join(' · ') || 'Recorded event'}
              </Text>
            </span>
            <Timestamp value={item.createdAt} format="date_time" />
          </li>;
        })}</Rows> : <Empty title="No events recorded in this period" />}
    </div>
  </SlideDrawer>;
}

function SessionPropertiesPanel({ websiteId, range, filters, onAddProperty }: {
  websiteId: string;
  range: DateRange;
  filters: ReportFilters;
  onAddProperty: (property: PropertyFilter) => void;
}) {
  const properties = useResource<SessionPropertyStat[]>(
    `${websitesPath}/${websiteId}/sessions/properties?${rangeQuery(range, filters)}`,
  );
  const [selectedProperty, setSelectedProperty] = useState<string>();
  const selectedType = dataTypeByCode[properties.data?.find(item => item.propertyName === selectedProperty)?.dataType ?? 1] ?? 'string';
  const values = useResource<EventPropertyValue[]>(
    selectedProperty
      ? `${websitesPath}/${websiteId}/sessions/properties/values?${rangeQuery(range, filters, {
        propertyName: selectedProperty,
        dataType: selectedType === 'array' ? '5' : undefined,
      })}`
      : null,
  );

  return <Panel
    title="Session properties"
    description="Custom key-value attributes recorded across anonymous website sessions"
    action={<IconButton size="sm" label="Refresh session properties" icon={<RefreshCw size={14} />} onClick={properties.refresh} isLoading={properties.loading} />}
  >
    {!properties.data ? <AsyncState loading={properties.loading} error={properties.error} retry={properties.refresh} />
      : !properties.data.length ? <Empty title="No session properties recorded" description="Custom session attributes recorded by the tracking script will appear here." />
        : <div className="ov-split">
          <div className="ov-stack-sm">
            <Text type="supporting" color="secondary">Select a property to inspect its top recorded values.</Text>
            <Rows>{properties.data.slice(0, 25).map(item => {
              const active = selectedProperty === item.propertyName;
              return <li key={item.propertyName}>
                <span>
                  <Link
                    onClick={() => setSelectedProperty(current => current === item.propertyName ? undefined : item.propertyName)}
                    weight={active ? 'semibold' : 'medium'}
                  >
                    {item.propertyName}
                  </Link>
                </span>
                <Badge variant={active ? 'info' : 'neutral'} label={number(item.total)} />
              </li>;
            })}</Rows>
          </div>
          <div className="ov-stack-sm">
            {selectedProperty ? <>
              <div className="ov-actions ov-actions--between">
                <Text weight="semibold">{selectedProperty}</Text>
                <Button size="sm" variant="ghost" label="Clear" onClick={() => setSelectedProperty(undefined)} />
              </div>
              {!values.data ? <AsyncState loading={values.loading} error={values.error} retry={values.refresh} />
                : <>
                  <Distribution points={values.data.map(entry => ({ label: entry.value || 'Empty', value: entry.total }))} />
                  <div className="ov-actions">
                    {selectedType !== 'date' ? values.data.filter(entry => entry.value && !entry.value.includes(',')).slice(0, 6).map(entry => <Button
                      key={entry.value}
                      size="sm"
                      label={`Only ${entry.value}`}
                      icon={<Filter size={12} />}
                      onClick={() => onAddProperty({
                        scope: 'session',
                        name: selectedProperty,
                        dataType: selectedType,
                        operator: selectedType === 'array' ? 'c' : 'eq',
                        value: entry.value,
                      })}
                    />) : null}
                  </div>
                </>}
            </> : <Empty title="Select a property" description="Choose a session property on the left to inspect its top values." />}
          </div>
        </div>}
  </Panel>;
}

function SessionsTab({
  website,
  range,
  filters,
  onAddProperty,
}: {
  website: Website;
  range: DateRange;
  filters: ReportFilters;
  onAddProperty: (property: PropertyFilter) => void;
}) {
  const [queryInput, setQueryInput] = useState('');
  const [search, setSearch] = useState('');
  const [selectedSession, setSelectedSession] = useState<WebsiteSession>();

  const filterSig = `${range.startAt}:${range.endAt}:${JSON.stringify(filters)}:${search}`;
  const [pageState, setPageState] = useState({ sig: filterSig, page: 1 });
  const page = pageState.sig === filterSig ? pageState.page : 1;
  const setPage = (next: number) => setPageState({ sig: filterSig, page: next });

  const stats = useResource<SessionStats>(`${websitesPath}/${website.id}/sessions/stats?${rangeQuery(range, filters)}`);
  const weekly = useResource<WeeklyTraffic>(`${websitesPath}/${website.id}/sessions/weekly?${rangeQuery(range, filters)}`);
  const sessions = useResource<Page<WebsiteSession>>(
    `${websitesPath}/${website.id}/sessions?${rangeQuery(range, filters, {
      page: String(page),
      q: search || undefined,
    })}`,
  );

  return <div className="ov-stack">
    <Banner
      status="info"
      title="Anonymous sessions"
      description="Website sessions remain anonymous and are never linked to individual contacts without established attribution."
    />

    {!stats.data ? <Panel><AsyncState loading={stats.loading} error={stats.error} retry={stats.refresh} /></Panel>
      : <div className="ov-metrics">
        <Metric label="Pageviews" value={stats.data.pageviews} />
        <Metric label="Visitors" value={stats.data.visitors} />
        <Metric label="Visits" value={stats.data.visits} />
        <Metric label="Countries" value={stats.data.countries} />
        <Metric label="Events" value={stats.data.events} />
      </div>}

    <Panel
      title="Weekly traffic heatmap"
      description="Recorded views by day of week and hour (UTC)"
      action={<IconButton size="sm" label="Refresh heatmap" icon={<RefreshCw size={14} />} onClick={weekly.refresh} isLoading={weekly.loading} />}
    >
      {!weekly.data ? <AsyncState loading={weekly.loading} error={weekly.error} retry={weekly.refresh} />
        : <WeeklyHeatmap matrix={weekly.data} />}
    </Panel>

    <SessionPropertiesPanel websiteId={website.id} range={range} filters={filters} onAddProperty={onAddProperty} />

    <Panel
      title="Anonymous sessions"
      description={sessions.data ? `${number(sessions.data.total)} sessions in this period` : 'Click any session to inspect its chronological activity'}
      action={<IconButton size="sm" label="Refresh sessions" icon={<RefreshCw size={14} />} onClick={sessions.refresh} isLoading={sessions.loading} />}
    >
      <div className="ov-toolbar">
        <form onSubmit={event => { event.preventDefault(); setSearch(queryInput.trim()); setPage(1); }}>
          <TextInput
            label="Search sessions"
            isLabelHidden
            type="search"
            startIcon="search"
            placeholder="Filter by browser, OS, country, city…"
            value={queryInput}
            onChange={setQueryInput}
            width={300}
          />
          <Button type="submit" label="Search" icon={<Search size={15} />} />
          {search ? <Button variant="ghost" label="Clear" onClick={() => { setQueryInput(''); setSearch(''); setPage(1); }} /> : null}
        </form>
      </div>

      {!sessions.data ? <AsyncState loading={sessions.loading} error={sessions.error} retry={sessions.refresh} /> : <>
        <Table
          data={sessions.data.items}
          idKey="id"
          hasHover
          emptyState={<Empty title={search ? 'No sessions match your search' : 'No anonymous sessions in this period'} />}
          columns={[
            {
              key: 'browser',
              header: 'Browser',
              renderCell: session => <span className="ov-cell">
                <Link onClick={() => setSelectedSession(session)}>{session.browser || 'Unknown'}</Link>
                {session.hostname ? <Text type="supporting" color="secondary">{session.hostname}</Text> : null}
              </span>,
            },
            { key: 'os', header: 'OS', renderCell: session => session.os || '—' },
            { key: 'device', header: 'Device', renderCell: session => session.device || '—' },
            {
              key: 'country',
              header: 'Location',
              renderCell: session => [session.city, session.country].filter(Boolean).join(', ') || '—',
            },
            { key: 'views', header: 'Views', align: 'end', renderCell: session => number(session.views) },
            { key: 'visits', header: 'Visits', align: 'end', renderCell: session => number(session.visits) },
            { key: 'lastAt', header: 'Last seen', renderCell: session => <Timestamp value={session.lastAt} format="relative_short" /> },
            {
              key: 'id',
              header: 'Activity',
              align: 'end',
              renderCell: session => <Button size="sm" variant="ghost" label="Inspect" onClick={() => setSelectedSession(session)} />,
            },
          ]}
        />
        <Pager {...sessions.data} onPage={setPage} />
      </>}
    </Panel>

    {selectedSession ? <SessionActivityDrawer
      websiteId={website.id}
      session={selectedSession}
      range={range}
      onAddProperty={property => { onAddProperty(property); setSelectedSession(undefined); }}
      onClose={() => setSelectedSession(undefined)}
    /> : null}
  </div>;
}

/* ── Tab 4: Goals & Funnels ────────────────────────────────────────────────── */

function GoalModal({
  websiteId,
  goal,
  onClose,
  onDone,
}: {
  websiteId: string;
  goal?: Goal;
  onClose: () => void;
  onDone: () => void;
}) {
  const action = useAction();
  const { values, field } = useFields({ name: goal?.name ?? '', value: goal?.value ?? '' });
  const [type, setType] = useState<'event' | 'path'>(goal?.type ?? 'event');
  const path = goal ? `${websitesPath}/${websiteId}/goals/${goal.id}` : `${websitesPath}/${websiteId}/goals`;

  return <Modal title={goal ? 'Edit conversion goal' : 'Create conversion goal'} onClose={onClose}>
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        await api<Goal>(path, goal ? 'PATCH' : 'POST', {
          name: values.name.trim(),
          type,
          value: values.value.trim(),
        });
        onDone();
      }, goal ? 'Conversion goal updated.' : 'Conversion goal created.');
    }}>
      <TextInput label="Goal name" isRequired {...field('name')} />
      <Selector
        label="Goal type"
        value={type}
        onChange={value => setType(value === 'path' ? 'path' : 'event')}
        options={[{ value: 'event', label: 'Custom event' }, { value: 'path', label: 'Page path' }]}
      />
      <TextInput
        label="Matching value"
        description="Enter the exact event name or page path. Use * as a wildcard, for example /blog/* matches every page under /blog."
        placeholder={type === 'event' ? 'signed_up' : '/thank-you'}
        isRequired
        {...field('value')}
      />
      <Feedback error={action.error} />
      <FormActions>
        <Button label="Cancel" onClick={onClose} />
        <Button type="submit" variant="primary" label={goal ? 'Save goal' : 'Create goal'} isLoading={action.busy} />
      </FormActions>
    </form>
  </Modal>;
}

function SaveFunnelModal({
  websiteId,
  steps,
  windowMinutes,
  onClose,
  onSaved,
}: {
  websiteId: string;
  steps: FunnelStep[];
  windowMinutes: number;
  onClose: () => void;
  onSaved: (saved: SavedFunnel) => void;
}) {
  const action = useAction();
  const { values, field } = useFields({ name: '', description: '' });
  return <Modal title="Save conversion funnel" onClose={onClose}>
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        const saved = await api<SavedFunnel>(`${websitesPath}/${websiteId}/funnels`, 'POST', {
          name: values.name.trim(),
          description: values.description.trim() || undefined,
          steps: steps.map(step => ({ type: step.type, value: step.value.trim() })),
          windowMinutes,
        });
        onSaved(saved);
      }, 'Funnel saved.');
    }}>
      <TextInput label="Funnel name" placeholder="Checkout conversion" isRequired {...field('name')} />
      <TextArea label="Description" rows={2} isOptional {...field('description')} />
      <Text type="supporting" color="secondary">
        Saves {steps.length} steps with a {windowMinutes}-minute conversion window.
      </Text>
      <Feedback error={action.error} />
      <FormActions>
        <Button label="Cancel" onClick={onClose} />
        <Button type="submit" variant="primary" label="Save funnel" isLoading={action.busy} isDisabled={!values.name.trim()} />
      </FormActions>
    </form>
  </Modal>;
}

function GoalsSection({ website, range, canEdit }: { website: Website; range: DateRange; canEdit: boolean }) {
  const path = `${websitesPath}/${website.id}/goals`;
  const goals = useResource<Goal[]>(path);
  const deleteAction = useAction();
  const [editGoal, setEditGoal] = useState<Goal | 'new'>();
  const [deleteGoal, setDeleteGoal] = useState<Goal>();
  const [statsRevision, setStatsRevision] = useState(0);

  const goalsKey = goals.data?.map(g => `${g.id}:${g.type}:${g.value}`).join(',') ?? '';
  const fetchKey = `${website.id}:${range.startAt}:${range.endAt}:${goalsKey}:${statsRevision}`;
  const [statsState, setStatsState] = useState<{ key: string; map: Record<string, GoalStats | null> }>();

  useEffect(() => {
    const items = goals.data;
    if (!items?.length) return;
    let active = true;
    const qs = rangeQuery(range);
    void Promise.all(items.map(async goal => {
      try {
        const result = await api<GoalStats>(`${path}/${goal.id}?${qs}`);
        return [goal.id, result] as const;
      } catch {
        return [goal.id, null] as const;
      }
    })).then(entries => {
      if (active) setStatsState({ key: fetchKey, map: Object.fromEntries(entries) });
    });
    return () => { active = false; };
  }, [fetchKey, goals.data, path, range]);

  const statsMap = statsState?.key === fetchKey ? statsState.map : undefined;
  const loadingStats = Boolean(goals.data?.length) && !statsMap;

  function refreshAllGoals() {
    goals.refresh();
    setStatsRevision(v => v + 1);
  }

  return <Panel
    title="Conversion goals"
    description="Track specific page paths or custom events as website conversion milestones"
    action={<div className="ov-actions">
      <IconButton size="sm" label="Refresh goals" icon={<RefreshCw size={14} />} onClick={refreshAllGoals} isLoading={goals.loading || loadingStats} />
      {canEdit ? <Button size="sm" variant="primary" label="Create goal" icon={<Plus size={14} />} onClick={() => setEditGoal('new')} /> : null}
    </div>}
  >
    <Feedback error={deleteAction.error} notice={deleteAction.notice} />
    {!goals.data ? <AsyncState loading={goals.loading} error={goals.error} retry={goals.refresh} />
      : <Table
        data={goals.data}
        idKey="id"
        hasHover
        emptyState={<Empty title="No conversion goals yet" description="Track a page path or custom event as a conversion goal." />}
        columns={[
          { key: 'name', header: 'Goal name', renderCell: item => <Text weight="medium">{item.name}</Text> },
          {
            key: 'type',
            header: 'Type',
            renderCell: item => <Badge label={item.type === 'event' ? 'Custom event' : 'Page path'} variant={item.type === 'event' ? 'info' : 'neutral'} />,
          },
          {
            key: 'value',
            header: 'Match value',
            renderCell: item => <span className="ov-actions">
              <Text type="code">{item.value}</Text>
              {goalMatchKind(item.value) === 'wildcard' ? <Badge label="Wildcard" variant="neutral" /> : null}
            </span>,
          },
          {
            key: 'unique',
            header: 'Converting sessions',
            align: 'end',
            renderCell: item => loadingStats ? '…' : number(statsMap?.[item.id]?.unique),
          },
          {
            key: 'rate',
            header: 'Conversion rate',
            align: 'end',
            renderCell: item => {
              const stats = statsMap?.[item.id];
              if (loadingStats) return '…';
              return stats ? `${formatPercent(stats.rate)} of ${number(stats.total)} sessions` : '—';
            },
          },
          ...(canEdit ? [{
            key: 'id',
            header: 'Actions',
            align: 'end' as const,
            renderCell: (item: Goal) => <span className="ov-actions ov-actions--end">
              <IconButton size="sm" variant="ghost" label={`Edit ${item.name}`} icon={<Pencil size={14} />} onClick={() => setEditGoal(item)} />
              <IconButton size="sm" variant="ghost" label={`Delete ${item.name}`} icon={<Trash2 size={14} />} onClick={() => setDeleteGoal(item)} />
            </span>,
          }] : []),
        ]}
      />}

    {editGoal && canEdit ? <GoalModal
      websiteId={website.id}
      goal={editGoal === 'new' ? undefined : editGoal}
      onClose={() => setEditGoal(undefined)}
      onDone={() => { setEditGoal(undefined); goals.refresh(); }}
    /> : null}

    {deleteGoal && canEdit ? <ConfirmDialog
      title="Delete conversion goal"
      description={`Delete the conversion goal "${deleteGoal.name}"? Recorded analytics events will not be deleted.`}
      actionLabel="Delete goal"
      busy={deleteAction.busy}
      onClose={() => setDeleteGoal(undefined)}
      onConfirm={() => void deleteAction.run(async () => {
        await api(`${path}/${deleteGoal.id}`, 'DELETE');
        setDeleteGoal(undefined);
        goals.refresh();
      }, 'Conversion goal deleted.')}
    /> : null}
  </Panel>;
}

function FunnelsSection({ website, range, canEdit }: { website: Website; range: DateRange; canEdit: boolean }) {
  const funnelsPath = `${websitesPath}/${website.id}/funnels`;
  const savedFunnels = useResource<SavedFunnel[]>(funnelsPath);
  const runAction = useAction();
  const deleteAction = useAction();

  const [steps, setSteps] = useState<FunnelStep[]>([{ type: 'path', value: '/' }, { type: 'event', value: '' }]);
  const [windowMinutes, setWindowMinutes] = useState(60);
  const [activeSaved, setActiveSaved] = useState<SavedFunnel>();
  const [adhocResult, setAdhocResult] = useState<FunnelResult>();
  const [saveOpen, setSaveOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SavedFunnel>();

  const savedStats = useResource<FunnelResult>(
    activeSaved ? `${funnelsPath}/${activeSaved.id}/stats?${rangeQuery(range)}` : null,
  );

  const displayedResult = activeSaved ? savedStats.data : adhocResult;
  const firstVisitors = displayedResult?.[0]?.visitors ?? 0;
  const lastVisitors = displayedResult?.at(-1)?.visitors ?? 0;
  const overallConversion = firstVisitors > 0 ? lastVisitors / firstVisitors : null;

  function updateStep(index: number, parts: Partial<FunnelStep>) {
    setSteps(values => values.map((step, pos) => pos === index ? { ...step, ...parts } : step));
    setActiveSaved(undefined);
    setAdhocResult(undefined);
  }

  function loadSavedFunnel(funnel: SavedFunnel) {
    setSteps(funnel.steps.length >= 2 ? funnel.steps.map(step => ({ ...step })) : [{ type: 'path', value: '/' }, { type: 'event', value: '' }]);
    setWindowMinutes(Math.min(1440, Math.max(1, funnel.windowMinutes)));
    setAdhocResult(undefined);
    setActiveSaved(funnel);
  }

  const allStepsFilled = steps.length >= 2 && steps.every(step => step.value.trim().length > 0);

  return <Panel
    title="Conversion funnels"
    description="Analyse multi-step progression and drop-off within a conversion window"
    action={<IconButton size="sm" label="Refresh saved funnels" icon={<RefreshCw size={14} />} onClick={savedFunnels.refresh} isLoading={savedFunnels.loading} />}
  >
    <Feedback error={deleteAction.error} notice={deleteAction.notice} />

    {!savedFunnels.data ? <AsyncState loading={savedFunnels.loading} error={savedFunnels.error} retry={savedFunnels.refresh} />
      : savedFunnels.data.length ? <div className="ov-stack-sm">
        <Heading level={3}>Saved funnels</Heading>
        <Rows>{savedFunnels.data.map(funnel => {
          const isSelected = activeSaved?.id === funnel.id;
          return <li key={funnel.id}>
            <span>
              <span className="ov-actions">
                <Link onClick={() => loadSavedFunnel(funnel)} weight={isSelected ? 'semibold' : 'medium'}>{funnel.name}</Link>
                {isSelected ? <StatusBadge label="Active" tone="info" /> : null}
              </span>
              <Text type="supporting" color="secondary">
                {funnel.steps.map(s => s.value).join(' → ')} · {funnel.windowMinutes}m window
              </Text>
            </span>
            <span className="ov-actions">
              <Button size="sm" label="Run" onClick={() => loadSavedFunnel(funnel)} />
              {canEdit ? <IconButton
                size="sm"
                variant="ghost"
                label={`Delete funnel ${funnel.name}`}
                icon={<Trash2 size={14} />}
                onClick={() => setDeleteTarget(funnel)}
              /> : null}
            </span>
          </li>;
        })}</Rows>
      </div> : null}

    <div className="ov-grid">
      <form className="ov-stack-sm" onSubmit={event => {
        event.preventDefault();
        void runAction.run(async () => {
          if (steps.some(step => !step.value.trim())) throw new Error('Enter a value for every funnel step.');
          setActiveSaved(undefined);
          const result = await api<FunnelResult>(`${websitesPath}/${website.id}/funnel`, 'POST', {
            ...range,
            steps: steps.map(step => ({ type: step.type, value: step.value.trim() })),
            windowMinutes,
          });
          setAdhocResult(result);
        });
      }}>
        <Heading level={3}>{activeSaved ? `Funnel steps · ${activeSaved.name}` : 'Build funnel'}</Heading>
        {steps.map((step, index) => <div className="ov-step" key={index}>
          <div className="ov-step-heading">
            <Text weight="semibold">Step {index + 1}</Text>
            {steps.length > 2 ? <IconButton
              variant="ghost"
              size="sm"
              label={`Remove step ${index + 1}`}
              icon={<Trash2 size={15} />}
              onClick={() => {
                setSteps(values => values.filter((_, pos) => pos !== index));
                setActiveSaved(undefined);
                setAdhocResult(undefined);
              }}
            /> : null}
          </div>
          <div className="ov-form-grid">
            <Selector
              label={`Step ${index + 1} type`}
              value={step.type}
              options={stepTypes}
              onChange={value => updateStep(index, { type: value === 'path' ? 'path' : 'event' })}
            />
            <TextInput
              label={`Step ${index + 1} value`}
              placeholder={step.type === 'path' ? '/pricing' : 'signed_up'}
              isRequired
              value={step.value}
              onChange={value => updateStep(index, { value })}
            />
          </div>
        </div>)}

        <NumberInput
          label="Conversion window"
          units="minutes"
          min={1}
          max={1440}
          isIntegerOnly
          value={windowMinutes}
          onChange={value => { setWindowMinutes(value); setActiveSaved(undefined); setAdhocResult(undefined); }}
        />

        <Feedback error={runAction.error} />

        <div className="ov-actions ov-actions--between">
          {steps.length < 8 ? <Button
            label="Add step"
            icon={<Plus size={15} />}
            onClick={() => {
              setSteps(values => [...values, { type: 'event', value: '' }]);
              setActiveSaved(undefined);
              setAdhocResult(undefined);
            }}
          /> : <span />}
          <div className="ov-actions">
            {canEdit ? <Button
              label="Save funnel"
              icon={<Save size={15} />}
              isDisabled={!allStepsFilled}
              onClick={() => setSaveOpen(true)}
            /> : null}
            <Button type="submit" variant="primary" label="Run funnel" isLoading={runAction.busy} />
          </div>
        </div>
      </form>

      <div className="ov-stack-sm">
        <div className="ov-actions ov-actions--between">
          <Heading level={3}>Step-by-step drop-off</Heading>
          {overallConversion != null ? <StatusBadge label={`${formatPercent(overallConversion)} completion`} tone="info" /> : null}
        </div>
        {activeSaved && !savedStats.data
          ? <AsyncState loading={savedStats.loading} error={savedStats.error} retry={savedStats.refresh} />
          : displayedResult
            ? <Distribution
              points={displayedResult.map((item, idx) => ({ label: `${idx + 1}. ${item.label}`, value: item.visitors }))}
              showPercent
            />
            : <Empty title="No funnel results yet" description="Run an ad-hoc funnel or click a saved funnel to view step-by-step conversion drop-off." />}
      </div>
    </div>

    {saveOpen && canEdit ? <SaveFunnelModal
      websiteId={website.id}
      steps={steps}
      windowMinutes={windowMinutes}
      onClose={() => setSaveOpen(false)}
      onSaved={created => {
        setSaveOpen(false);
        savedFunnels.refresh();
        loadSavedFunnel(created);
      }}
    /> : null}

    {deleteTarget && canEdit ? <ConfirmDialog
      title="Delete saved funnel"
      description={`Delete the saved funnel "${deleteTarget.name}"?`}
      actionLabel="Delete funnel"
      busy={deleteAction.busy}
      onClose={() => setDeleteTarget(undefined)}
      onConfirm={() => void deleteAction.run(async () => {
        await api(`${funnelsPath}/${deleteTarget.id}`, 'DELETE');
        if (activeSaved?.id === deleteTarget.id) setActiveSaved(undefined);
        setDeleteTarget(undefined);
        savedFunnels.refresh();
      }, 'Saved funnel deleted.')}
    /> : null}
  </Panel>;
}

function GoalsAndFunnelsTab({ website, range, canEdit }: { website: Website; range: DateRange; canEdit: boolean }) {
  return <div className="ov-stack">
    <GoalsSection website={website} range={range} canEdit={canEdit} />
    <FunnelsSection key={website.id} website={website} range={range} canEdit={canEdit} />
  </div>;
}

/* ── Tab 5: Insights (Journeys, Retention, Attribution, Breakdown) ─────────── */

function JourneysView({ website, range, filters }: { website: Website; range: DateRange; filters: ReportFilters }) {
  const [stepsInput, setStepsInput] = useState(3);
  const [startInput, setStartInput] = useState('');
  const [endInput, setEndInput] = useState('');
  const [applied, setApplied] = useState({ steps: 3, startStep: '', endStep: '' });

  const qs = rangeQuery(range, filters, {
    steps: String(applied.steps),
    startStep: applied.startStep || undefined,
    endStep: applied.endStep || undefined,
  });
  const journeys = useResource<JourneyPath[]>(`${websitesPath}/${website.id}/journeys?${qs}`);

  return <Panel
    title="User journeys"
    description="Top multi-step navigation sequences across pages and custom events"
    action={<IconButton size="sm" label="Refresh journeys" icon={<RefreshCw size={14} />} onClick={journeys.refresh} isLoading={journeys.loading} />}
  >
    <form className="ov-form-grid ov-form-grid--three" onSubmit={event => {
      event.preventDefault();
      setApplied({ steps: stepsInput, startStep: startInput.trim(), endStep: endInput.trim() });
    }}>
      <NumberInput label="Journey steps" min={2} max={7} isIntegerOnly value={stepsInput} onChange={setStepsInput} />
      <TextInput label="Start path or event" placeholder="/" isOptional value={startInput} onChange={setStartInput} />
      <TextInput label="End path or event" placeholder="/thank-you" isOptional value={endInput} onChange={setEndInput} />
      <div className="ov-actions">
        <Button type="submit" variant="primary" label="Update journeys" />
      </div>
    </form>

    {!journeys.data ? <AsyncState loading={journeys.loading} error={journeys.error} retry={journeys.refresh} />
      : journeys.data.length ? <Rows>{journeys.data.slice(0, 30).map((journey, idx) => <li key={`${journey.items.join('>')}-${idx}`}>
        <div className="ov-journey-path">
          {journey.items.map((step, stepIndex) => <span key={`${step}-${stepIndex}`} className="ov-actions">
            {stepIndex > 0 ? <ArrowRight size={13} aria-hidden="true" /> : null}
            <Token label={step} size="sm" color={stepIndex === 0 ? 'blue' : stepIndex === journey.items.length - 1 ? 'green' : 'default'} />
          </span>)}
        </div>
        <Text weight="semibold">{number(journey.count)} visitors</Text>
      </li>)}</Rows> : <Empty title="No matching journeys found" description="Try reducing the step count or broadening the date range." />}
  </Panel>;
}

function RetentionView({ website, range, filters }: { website: Website; range: DateRange; filters: ReportFilters }) {
  const retention = useResource<RetentionRow[]>(`${websitesPath}/${website.id}/retention?${rangeQuery(range, filters)}`);

  const matrix = useMemo(() => {
    if (!retention.data?.length) return null;
    const daysSet = new Set<number>();
    const cohorts = new Map<string, { date: string; visitors: number; byDay: Map<number, RetentionRow> }>();
    for (const row of retention.data) {
      const existing = cohorts.get(row.date) ?? { date: row.date, visitors: row.visitors, byDay: new Map() };
      if (row.day === 0 || existing.visitors === 0) existing.visitors = row.visitors;
      if (row.day > 0) {
        daysSet.add(row.day);
        existing.byDay.set(row.day, row);
      }
      cohorts.set(row.date, existing);
    }
    const days = [...daysSet].sort((a, b) => a - b);
    const rows = [...cohorts.values()].sort((a, b) => a.date.localeCompare(b.date));
    return { days, rows };
  }, [retention.data]);

  return <Panel
    title="Retention cohorts"
    description="Percentage of anonymous visitors returning in subsequent days"
    action={<IconButton size="sm" label="Refresh retention" icon={<RefreshCw size={14} />} onClick={retention.refresh} isLoading={retention.loading} />}
  >
    {!retention.data ? <AsyncState loading={retention.loading} error={retention.error} retry={retention.refresh} />
      : !matrix || !matrix.rows.length ? <Empty title="No retention cohorts yet" description="Returning visitor data will populate here as multi-day traffic accumulates." />
        : <div className="ov-cohort-wrap">
          <table className="ov-cohort">
            <thead>
              <tr>
                <th>Cohort date</th>
                <th>Day 0 visitors</th>
                {matrix.days.map(dayNum => <th key={dayNum}>Day {dayNum}</th>)}
              </tr>
            </thead>
            <tbody>
              {matrix.rows.map(cohort => <tr key={cohort.date}>
                <td>{date(cohort.date)}</td>
                <td><strong>{number(cohort.visitors)}</strong></td>
                {matrix.days.map(dayNum => {
                  const cell = cohort.byDay.get(dayNum);
                  if (!cell) return <td key={dayNum}><Text color="secondary">—</Text></td>;
                  const pct = Math.max(0, Math.min(100, cell.percentage));
                  const tint = Math.round(Math.max(10, pct * 0.45));
                  return <td key={dayNum}>
                    <span
                      className="ov-cohort-pill"
                      title={`${number(cell.returnVisitors)} of ${number(cell.visitors)} visitors returned on Day ${dayNum}`}
                      style={pct > 0 ? { background: `color-mix(in srgb, var(--ov-chart) ${tint}%, transparent)` } : undefined}
                    >
                      {pct.toFixed(0)}%
                    </span>
                  </td>;
                })}
              </tr>)}
            </tbody>
          </table>
        </div>}
  </Panel>;
}

function AttributionView({ website, range, filters }: { website: Website; range: DateRange; filters: ReportFilters }) {
  const [model, setModel] = useState<'first-click' | 'last-click'>('first-click');
  const [type, setType] = useState<'path' | 'event'>('path');
  const [step, setStep] = useState('');
  const [lookback, setLookback] = useState('0');
  const [submitted, setSubmitted] = useState<{ model: 'first-click' | 'last-click'; type: 'path' | 'event'; step: string; lookback: string }>();

  const attribution = useResource<AttributionResult>(
    submitted
      ? `${websitesPath}/${website.id}/attribution?${rangeQuery(range, filters, {
        lookbackDays: submitted.lookback,
        model: submitted.model,
        type: submitted.type,
        step: submitted.step,
      })}`
      : null,
  );

  return <div className="ov-stack">
    <Panel title="Conversion attribution" description="Understand which referrers and campaign UTMs drove a target page or custom event">
      <form className="ov-form-grid ov-form-grid--three" onSubmit={event => {
        event.preventDefault();
        if (!step.trim()) return;
        setSubmitted({ model, type, step: step.trim(), lookback });
      }}>
        <Selector
          label="Attribution model"
          value={model}
          onChange={value => setModel(value === 'last-click' ? 'last-click' : 'first-click')}
          options={[
            { value: 'first-click', label: 'First-click' },
            { value: 'last-click', label: 'Last-click' },
          ]}
        />
        <Selector
          label="Conversion type"
          value={type}
          onChange={value => setType(value === 'event' ? 'event' : 'path')}
          options={stepTypes}
        />
        <TextInput
          label="Conversion target"
          placeholder={type === 'path' ? '/thank-you' : 'signed_up'}
          isRequired
          value={step}
          onChange={setStep}
        />
        <TextInput label="Lookback days (0 to 90)" value={lookback} onChange={value => setLookback(value.replace(/\D/g, '').slice(0, 2) || '0')} />
        <div className="ov-actions">
          <Button type="submit" variant="primary" label="Run attribution" icon={<Target size={15} />} isDisabled={!step.trim()} />
        </div>
      </form>
    </Panel>

    {!submitted ? <Panel>
      <Empty title="Configure an attribution target" description="Choose first-click or last-click attribution and enter a conversion page path or custom event." />
    </Panel> : !attribution.data ? <Panel>
      <AsyncState loading={attribution.loading} error={attribution.error} retry={attribution.refresh} />
    </Panel> : <>
      <div className="ov-metrics">
        <Metric label="Attributed visitors" value={attribution.data.total.visitors} />
        <Metric label="Attributed visits" value={attribution.data.total.visits} />
        <Metric label="Attributed page views" value={attribution.data.total.pageviews} />
        <Metric
          label="Revenue in range"
          formatted={attribution.data.revenue ? formatCurrency(attribution.data.revenue.sum, attribution.data.revenue.currency) : 'None recorded'}
          hint={attribution.data.lookbackDays ? `Visits are searched ${attribution.data.lookbackDays} days before the range start, so conversions in that stretch are included. Revenue covers the chosen range only.` : 'Revenue recorded under the same filters. Umami does not split it by source here; see Revenue by UTM.'}
        />
      </div>
      <div className="ov-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
        <Panel title="Referrers"><Distribution points={attribution.data.referrer} /></Panel>
        <Panel title="Paid ads"><Distribution points={attribution.data.paidAds} /></Panel>
        <Panel title="UTM source"><Distribution points={attribution.data.utmSource} /></Panel>
        <Panel title="UTM medium"><Distribution points={attribution.data.utmMedium} /></Panel>
        <Panel title="UTM campaign"><Distribution points={attribution.data.utmCampaign} /></Panel>
        {attribution.data.utmContent.length ? <Panel title="UTM content"><Distribution points={attribution.data.utmContent} /></Panel> : null}
        {attribution.data.utmTerm.length ? <Panel title="UTM term"><Distribution points={attribution.data.utmTerm} /></Panel> : null}
      </div>
    </>}
  </div>;
}

type BreakdownTableRow = BreakdownRow & { _id: string };

const metricColumnLabels: Record<string, string> = {
  views: 'Views',
  visitors: 'Visitors',
  visits: 'Visits',
  bounces: 'Bounces',
  totaltime: 'Total time',
};

function BreakdownView({ website, range, filters }: { website: Website; range: DateRange; filters: ReportFilters }) {
  const [dim1, setDim1] = useState<ReportDimension>('path');
  const [dim2, setDim2] = useState<ReportDimension>('country');
  const [dim3, setDim3] = useState<string>('none');
  const [activeFields, setActiveFields] = useState<ReportDimension[]>(['path', 'country']);
  const [revision, setRevision] = useState(0);

  const filterKey = JSON.stringify(filters);
  const requestKey = `${website.id}:${range.startAt}:${range.endAt}:${activeFields.join(',')}:${filterKey}:${revision}`;
  const [state, setState] = useState<{ key: string; rows?: BreakdownRow[]; error?: string }>();

  useEffect(() => {
    let active = true;
    const appliedFilters = hasFilters(filters) ? filters : undefined;
    api<BreakdownRow[]>(`${websitesPath}/${website.id}/breakdown`, 'POST', {
      ...range,
      fields: activeFields,
      filters: appliedFilters,
    }).then(
      rows => { if (active) setState({ key: requestKey, rows }); },
      err => { if (active) setState({ key: requestKey, error: message(err) }); },
    );
    return () => { active = false; };
  }, [activeFields, filters, range, requestKey, website.id]);

  const current = state?.key === requestKey ? state : undefined;
  const loading = !current;

  const tableRows: BreakdownTableRow[] = useMemo(
    () => (current?.rows ?? []).map((row, idx) => ({ ...row, _id: `${idx}` })),
    [current?.rows],
  );

  const metricKeys = useMemo(() => {
    const sample = current?.rows?.[0];
    if (!sample) return ['views', 'visitors', 'visits'];
    const fieldSet = new Set<string>(activeFields);
    return Object.keys(sample).filter(key => !fieldSet.has(key));
  }, [activeFields, current?.rows]);

  const thirdOptions = [{ value: 'none', label: 'None' }, ...breakdownDimensionOptions];

  return <Panel
    title="Multi-dimensional breakdown"
    description="Cross-tabulate 2 to 3 website dimensions with active filters applied"
    action={<IconButton size="sm" label="Refresh breakdown" icon={<RefreshCw size={14} />} onClick={() => setRevision(v => v + 1)} isLoading={loading} />}
  >
    <form className="ov-form-grid ov-form-grid--three" onSubmit={event => {
      event.preventDefault();
      const chosen = [dim1, dim2, ...(dim3 !== 'none' ? [dim3 as ReportDimension] : [])];
      const unique = [...new Set(chosen)];
      setActiveFields(unique);
      setRevision(v => v + 1);
    }}>
      <Selector label="Dimension 1" value={dim1} options={breakdownDimensionOptions} onChange={v => v && setDim1(v as ReportDimension)} />
      <Selector label="Dimension 2" value={dim2} options={breakdownDimensionOptions} onChange={v => v && setDim2(v as ReportDimension)} />
      <Selector label="Dimension 3 (optional)" value={dim3} options={thirdOptions} onChange={v => setDim3(v || 'none')} />
      <div className="ov-actions">
        <Button type="submit" variant="primary" label="Run breakdown" icon={<Sparkles size={15} />} isLoading={loading} />
      </div>
    </form>

    {!current?.rows ? <AsyncState loading={loading} error={current?.error} retry={() => setRevision(v => v + 1)} />
      : <Table
        data={tableRows}
        idKey="_id"
        hasHover
        emptyState={<Empty title="No breakdown rows in this period" />}
        columns={[
          ...activeFields.map(field => ({
            key: field,
            header: dimensionLabels[field] ?? field,
            renderCell: (row: BreakdownTableRow) => {
              const raw = row[field];
              return raw == null || raw === '' ? <Text color="secondary">Unknown</Text> : String(raw);
            },
          })),
          ...metricKeys.map(metricKey => ({
            key: metricKey,
            header: metricColumnLabels[metricKey] ?? metricKey,
            align: 'end' as const,
            renderCell: (row: BreakdownTableRow) => {
              const raw = row[metricKey];
              if (typeof raw !== 'number') return raw == null ? '—' : String(raw);
              return metricKey === 'totaltime' ? duration(raw) : number(raw);
            },
          })),
        ]}
      />}
  </Panel>;
}

type RevenueTableRow = RevenueReport['metrics'][number] & { _id: string };

function RevenueView({ website, range, filters }: { website: Website; range: DateRange; filters: ReportFilters }) {
  const [currency, setCurrency] = useState('USD');
  const [breakdownType, setBreakdownType] = useState<RevenueMetricType>('country');

  const revenue = useResource<RevenueReport>(
    `${websitesPath}/${website.id}/revenue?${rangeQuery(range, filters, { currency, type: breakdownType })}`,
  );

  const tableRows: RevenueTableRow[] = useMemo(
    () => (revenue.data?.metrics ?? []).map((row, idx) => ({ ...row, _id: `${row.name}-${idx}` })),
    [revenue.data?.metrics],
  );

  const [utmType, setUtmType] = useState<RevenueUtmDimension>('utmSource');
  const utmRevenue = useResource<RevenueUtmReport>(
    `${websitesPath}/${website.id}/revenue/utm?${rangeQuery(range, filters, { currency, type: utmType })}`,
  );
  const breakdownLabel = revenueBreakdownOptions.find(option => option.value === breakdownType)?.label ?? 'Dimension';
  const stats = revenue.data?.stats;
  const prev = revenue.data?.comparison;
  const activeCurrency = revenue.data?.currency ?? currency;

  return <div className="ov-stack">
    <Panel
      title="Revenue overview"
      description="Anonymous website revenue events by currency and acquisition dimension"
      action={<IconButton size="sm" label="Refresh revenue" icon={<RefreshCw size={14} />} onClick={revenue.refresh} isLoading={revenue.loading} />}
    >
      <div className="ov-form-grid">
        <Selector
          label="Currency"
          value={currency}
          options={[...currencyOptions]}
          onChange={value => value && setCurrency(value)}
        />
        <Selector
          label="Breakdown"
          value={breakdownType}
          options={revenueBreakdownOptions}
          onChange={value => value && setBreakdownType(value as RevenueMetricType)}
        />
      </div>
    </Panel>

    {!revenue.data || !stats ? <Panel>
      <AsyncState loading={revenue.loading} error={revenue.error} retry={revenue.refresh} />
    </Panel> : <>
      <div className="ov-metrics">
        <Metric
          label="Total revenue"
          formatted={formatCurrency(stats.sum, activeCurrency)}
          hint={comparison(stats.sum, prev?.sum)}
        />
        <Metric
          label="Transactions"
          value={stats.count}
          hint={comparison(stats.count, prev?.count)}
        />
        <Metric
          label="Unique buyers"
          value={stats.uniqueCount}
          hint={comparison(stats.uniqueCount, prev?.uniqueCount)}
          info="Unique anonymous sessions with at least one recorded revenue event."
        />
        <Metric
          label="Average value"
          formatted={formatCurrency(stats.average, activeCurrency)}
          hint={comparison(stats.average, prev?.average)}
        />
        <Metric
          label="ARPU"
          formatted={formatCurrency(stats.arpu, activeCurrency)}
          hint={comparison(stats.arpu, prev?.arpu)}
          info="Average revenue per anonymous session across this period."
        />
      </div>

      <Panel
        title="Revenue over time"
        description={`Recorded revenue (${activeCurrency}) across the selected period`}
      >
        <Bars points={revenue.data.chart} label={`Revenue (${activeCurrency}) over time`} />
      </Panel>

      <Panel
        title={`Top revenue by ${breakdownLabel.toLowerCase()}`}
        description="Revenue totals and transaction counts grouped by the selected breakdown"
      >
        <Table
          data={tableRows}
          idKey="_id"
          hasHover
          emptyState={<Empty title="No revenue recorded in this period" description="Send currency and amount data on revenue events to populate this breakdown." />}
          columns={[
            {
              key: 'name',
              header: breakdownLabel,
              renderCell: row => <Text weight="medium">{row.name || 'Unknown'}</Text>,
            },
            {
              key: 'count',
              header: 'Transactions',
              align: 'end',
              renderCell: row => number(row.count),
            },
            {
              key: 'sum',
              header: 'Revenue',
              align: 'end',
              renderCell: row => formatCurrency(row.sum, activeCurrency),
            },
            {
              key: 'average',
              header: 'Average value',
              align: 'end',
              renderCell: row => row.count > 0 ? formatCurrency(row.sum / row.count, activeCurrency) : '—',
            },
          ]}
        />
      </Panel>
      <Panel
        title="Revenue by UTM"
        description="Revenue for the ten busiest values of the chosen UTM field, in the selected currency. Each value is a separate query, so values outside the top ten are not listed."
      >
        <Selector label="UTM field" value={utmType} onChange={value => setUtmType(value as RevenueUtmDimension)} options={[
          { value: 'utmSource', label: 'UTM source' }, { value: 'utmMedium', label: 'UTM medium' }, { value: 'utmCampaign', label: 'UTM campaign' },
        ]} />
        <AsyncState loading={utmRevenue.loading} error={utmRevenue.error} retry={utmRevenue.refresh} />
        {utmRevenue.data ? <Table
          data={utmRevenue.data.rows.map(row => ({ ...row, _id: row.name }))}
          idKey="_id"
          emptyState={<Empty title="No revenue tied to a UTM value in this period" />}
          columns={[
            { key: 'name', header: 'Value', renderCell: row => <Text weight="medium">{row.name}</Text> },
            { key: 'count', header: 'Transactions', align: 'end', renderCell: row => number(row.count) },
            { key: 'sum', header: 'Revenue', align: 'end', renderCell: row => formatCurrency(row.sum, utmRevenue.data?.currency ?? currency) },
          ]}
        /> : null}
      </Panel>
    </>}
  </div>;
}

type PerformanceTableRow = PerformanceReport['metrics'][number] & { _id: string };
const vitalMetricKeys: readonly PerformanceMetricKey[] = ['lcp', 'inp', 'cls', 'fcp', 'ttfb'];

function PerformanceView({ website, range, filters }: { website: Website; range: DateRange; filters: ReportFilters }) {
  const [metric, setMetric] = useState<PerformanceMetricKey>('lcp');
  const [breakdownType, setBreakdownType] = useState<PerformanceBreakdownType>('path');

  const perf = useResource<PerformanceReport>(
    `${websitesPath}/${website.id}/performance?${rangeQuery(range, filters, { metric, type: breakdownType })}`,
  );

  const tableRows: PerformanceTableRow[] = useMemo(
    () => (perf.data?.metrics ?? []).map((row, idx) => ({ ...row, _id: `${row.name}-${idx}` })),
    [perf.data?.metrics],
  );

  const breakdownLabel = performanceBreakdownOptions.find(option => option.value === breakdownType)?.label ?? 'Dimension';
  const activeMetric = perf.data?.metric ?? metric;
  const stats = perf.data?.stats;

  return <div className="ov-stack">
    <Panel
      title="Core Web Vitals"
      description="Real-user loading, interactivity, and visual stability metrics across anonymous page views"
      action={<IconButton size="sm" label="Refresh performance" icon={<RefreshCw size={14} />} onClick={perf.refresh} isLoading={perf.loading} />}
    >
      <div className="ov-form-grid">
        <Selector
          label="Vital metric"
          value={metric}
          options={performanceMetricOptions}
          onChange={value => value && setMetric(value as PerformanceMetricKey)}
        />
        <Selector
          label="Breakdown"
          value={breakdownType}
          options={performanceBreakdownOptions}
          onChange={value => value && setBreakdownType(value as PerformanceBreakdownType)}
        />
      </div>
    </Panel>

    {!perf.data || !stats ? <Panel>
      <AsyncState loading={perf.loading} error={perf.error} retry={perf.refresh} />
    </Panel> : <>
      <div className="ov-metrics">
        {vitalMetricKeys.map(key => {
          const percentiles = stats[key];
          const hasData = stats.count > 0 || percentiles.p50 > 0 || percentiles.p75 > 0 || percentiles.p95 > 0;
          const info = performanceMetricInfo[key];
          return <Metric
            key={key}
            label={`${info.short} (p75)`}
            formatted={hasData ? formatVital(key, percentiles.p75) : '—'}
            hint={hasData ? `p50 ${formatVital(key, percentiles.p50)} · p95 ${formatVital(key, percentiles.p95)}` : 'No samples'}
            info={info.description}
          />;
        })}
      </div>

      <Panel
        title={`${performanceMetricInfo[activeMetric].short} trend`}
        description={`${number(stats.count)} real-user performance ${stats.count === 1 ? 'sample' : 'samples'} recorded in this period`}
      >
        <Bars points={perf.data.chart} label={`${performanceMetricInfo[activeMetric].short} trend over time`} />
      </Panel>

      <Panel
        title={`${performanceMetricInfo[activeMetric].short} by ${breakdownLabel.toLowerCase()}`}
        description="Percentile distribution (p50, p75, p95) for the selected breakdown"
      >
        <Table
          data={tableRows}
          idKey="_id"
          hasHover
          emptyState={<Empty title="No performance samples recorded" description="Enable Core Web Vitals reporting on your site to view page and device timings." />}
          columns={[
            {
              key: 'name',
              header: breakdownLabel,
              renderCell: row => <Text weight="medium">{row.name || 'Unknown'}</Text>,
            },
            {
              key: 'count',
              header: 'Samples',
              align: 'end',
              renderCell: row => number(row.count),
            },
            {
              key: 'p50',
              header: 'p50',
              align: 'end',
              renderCell: row => formatVital(activeMetric, row.p50),
            },
            {
              key: 'p75',
              header: 'p75',
              align: 'end',
              renderCell: row => <Text weight="semibold">{formatVital(activeMetric, row.p75)}</Text>,
            },
            {
              key: 'p95',
              header: 'p95',
              align: 'end',
              renderCell: row => formatVital(activeMetric, row.p95),
            },
          ]}
        />
      </Panel>
    </>}
  </div>;
}

const channelOperatorLabels: Record<string, string> = { contains: 'contains', equals: 'is', present: 'is set', absent: 'is empty' };
const channelFieldLabels: Record<string, string> = { referrer: 'Referrer domain', utmSource: 'UTM source', utmMedium: 'UTM medium', query: 'URL query' };

function ChannelsView({ website, range, filters, canEdit }: { website: Website; range: DateRange; filters: ReportFilters; canEdit: boolean }) {
  const report = useResource<ChannelReport & { customRules: boolean }>(`${websitesPath}/${website.id}/channels?${rangeQuery(range, filters)}`);
  const rulesResource = useResource<{ rules: ChannelRule[]; custom: boolean }>('/channel-rules');
  const action = useAction();
  const [draft, setDraft] = useState<ChannelRule[]>();
  const [editing, setEditing] = useState(false);
  const [sample, setSample] = useState({ referrer: '', utmSource: '', utmMedium: '', query: '' });
  const [tested, setTested] = useState<{ channel: string; rule?: string }>();
  const rules = draft ?? rulesResource.data?.rules ?? [];
  const move = (index: number, by: number) => {
    const next = [...rules];
    const [item] = next.splice(index, 1);
    next.splice(Math.max(0, Math.min(next.length, index + by)), 0, item);
    setDraft(next);
  };
  return <div className="ov-stack">
    <Panel title="Channels" description="Visits grouped by OVELIO channel rules">
      <Text type="supporting" color="secondary">
        Umami sorts channels with fixed rules: it counts e-mail only from webmail referrers or a medium containing &ldquo;mail&rdquo;, and does not treat fbclid as paid.
        OVELIO classifies the referrer, UTM source, UTM medium and URL query combinations Umami reports, using the rules below, so the totals can differ from Umami&apos;s Channels list.
        This is a breakdown-level estimate, not a per-session classification: a visitor&apos;s later pages are not re-classified.
      </Text>
      <AsyncState loading={report.loading} error={report.error} retry={report.refresh} />
      {report.data ? <Table
        data={report.data.rows.map(row => ({ ...row, _id: row.channel }))}
        idKey="_id"
        emptyState={<Empty title="No visits in this period" />}
        columns={[
          { key: 'channel', header: 'Channel', renderCell: row => <Text weight="medium">{row.channel}</Text> },
          { key: 'visits', header: 'Visits', align: 'end', renderCell: row => number(row.visits) },
          { key: 'visitors', header: 'Visitors', align: 'end', renderCell: row => number(row.visitors) },
          { key: 'share', header: 'Share', align: 'end', renderCell: row => formatPercent(row.share) },
        ]}
      /> : null}
    </Panel>
    <Panel title="Channel rules" description="The first rule that matches decides the channel. Use the arrows to reorder.">
      {rulesResource.data && !rulesResource.data.custom && !draft ? <Text type="supporting" color="secondary">Showing the default rules. Edit them to save your own.</Text> : null}
      <Rows>{rules.map((rule, index) => <li key={rule.id ?? `${index}-${rule.name}`}>
        <span>
          <strong>{index + 1}. {rule.name}</strong> sends to <Badge label={rule.channel} variant="info" />{' '}
          <Text type="supporting" color="secondary">
            {rule.conditions.map(c => `${channelFieldLabels[c.field]} ${channelOperatorLabels[c.operator]}${c.values.length ? ` ${c.values.slice(0, 4).join(' / ')}${c.values.length > 4 ? '…' : ''}` : ''}`).join(' and ')}
          </Text>
        </span>
        {editing && canEdit ? <span className="ov-actions">
          <Button label="Up" onClick={() => move(index, -1)} isDisabled={index === 0} />
          <Button label="Down" onClick={() => move(index, 1)} isDisabled={index === rules.length - 1} />
          <IconButton label={`Remove ${rule.name}`} icon={<Trash2 size={14} />} onClick={() => setDraft(rules.filter((_, i) => i !== index))} />
        </span> : null}
      </li>)}</Rows>
      {editing && canEdit ? <ChannelRuleForm onAdd={rule => setDraft([...rules, rule])} /> : null}
      <Feedback error={action.error} notice={action.notice} />
      {canEdit ? <FormActions>
        {editing
          ? <>
            <Button label="Discard changes" onClick={() => { setDraft(undefined); setEditing(false); }} />
            <Button variant="primary" label="Save rules" isLoading={action.busy} onClick={() => void action.run(async () => {
              await api('/channel-rules', 'PUT', { rules: rules.map(({ name, channel, conditions }) => ({ name, channel, conditions })) });
              setDraft(undefined);
              setEditing(false);
              rulesResource.refresh();
              report.refresh();
            }, 'Channel rules saved.')} />
          </>
          : <Button label="Edit rules" icon={<Pencil size={14} />} onClick={() => setEditing(true)} />}
      </FormActions> : null}
    </Panel>
    <Panel title="Test a visit" description="See which channel a sample visit would get with the rules above, including unsaved edits.">
      <div className="ov-form-grid">
        <TextInput label="Referrer domain" placeholder="news.ycombinator.com" value={sample.referrer} onChange={referrer => setSample({ ...sample, referrer })} />
        <TextInput label="UTM source" value={sample.utmSource} onChange={utmSource => setSample({ ...sample, utmSource })} />
        <TextInput label="UTM medium" placeholder="newsletter" value={sample.utmMedium} onChange={utmMedium => setSample({ ...sample, utmMedium })} />
        <TextInput label="URL query" placeholder="fbclid=abc" value={sample.query} onChange={query => setSample({ ...sample, query })} />
      </div>
      <div className="ov-actions">
        <Button label="Test visit" onClick={() => void action.run(async () => {
          setTested(await api<{ channel: string; rule?: string }>('/channel-rules/test', 'POST', {
            visit: sample,
            ...(draft ? { rules: rules.map(({ name, channel, conditions }) => ({ name, channel, conditions })) } : {}),
          }));
        })} />
        {tested ? <Text>Channel: <strong>{tested.channel}</strong>{tested.rule ? ` (rule: ${tested.rule})` : ' (no rule matched)'}</Text> : null}
      </div>
    </Panel>
  </div>;
}

function ChannelRuleForm({ onAdd }: { onAdd: (rule: ChannelRule) => void }) {
  const [name, setName] = useState('');
  const [channel, setChannel] = useState('');
  const [field, setField] = useState<(typeof CHANNEL_FIELDS)[number]>('utmMedium');
  const [operator, setOperator] = useState<(typeof CHANNEL_OPERATORS)[number]>('equals');
  const [values, setValues] = useState('');
  const needsValues = operator === 'contains' || operator === 'equals';
  const list = values.split(',').map(item => item.trim()).filter(Boolean);
  return <div className="ov-stack-sm">
    <Heading level={3}>Add a rule</Heading>
    <div className="ov-form-grid ov-form-grid--three">
      <TextInput label="Rule name" value={name} onChange={setName} />
      <TextInput label="Channel" placeholder="Affiliate" value={channel} onChange={setChannel} />
      <Selector label="Field" value={field} onChange={value => setField(value as typeof field)}
        options={CHANNEL_FIELDS.map(value => ({ value, label: channelFieldLabels[value] }))} />
      <Selector label="Condition" value={operator} onChange={value => setOperator(value as typeof operator)}
        options={CHANNEL_OPERATORS.map(value => ({ value, label: channelOperatorLabels[value] }))} />
      {needsValues ? <TextInput label="Values (comma separated)" value={values} onChange={setValues} /> : null}
    </div>
    <div className="ov-actions">
      <Button label="Add rule" icon={<Plus size={14} />} isDisabled={!name.trim() || !channel.trim() || (needsValues && !list.length)}
        onClick={() => {
          onAdd({ name: name.trim(), channel: channel.trim(), conditions: [{ field, operator, values: needsValues ? list : [] }] });
          setName(''); setChannel(''); setValues('');
        }} />
    </div>
  </div>;
}

function InsightsTab({ website, range, filters, canEdit }: { website: Website; range: DateRange; filters: ReportFilters; canEdit: boolean }) {
  const [subview, setSubview] = useState('journeys');
  return <div className="ov-stack">
    <div className="ov-actions">
      <SegmentedControl label="Insights view" value={subview} onChange={setSubview}>
        <SegmentedControlItem value="journeys" label="User journeys" />
        <SegmentedControlItem value="retention" label="Retention cohorts" />
        <SegmentedControlItem value="attribution" label="Attribution" />
        <SegmentedControlItem value="channels" label="Channels" />
        <SegmentedControlItem value="breakdown" label="Breakdown" />
        <SegmentedControlItem value="revenue" label="Revenue" />
        <SegmentedControlItem value="performance" label="Performance" />
      </SegmentedControl>
    </div>
    {subview === 'journeys' ? <JourneysView website={website} range={range} filters={filters} /> : null}
    {subview === 'retention' ? <RetentionView website={website} range={range} filters={filters} /> : null}
    {subview === 'attribution' ? <AttributionView website={website} range={range} filters={filters} /> : null}
    {subview === 'channels' ? <ChannelsView website={website} range={range} filters={filters} canEdit={canEdit} /> : null}
    {subview === 'breakdown' ? <BreakdownView website={website} range={range} filters={filters} /> : null}
    {subview === 'revenue' ? <RevenueView website={website} range={range} filters={filters} /> : null}
    {subview === 'performance' ? <PerformanceView website={website} range={range} filters={filters} /> : null}
  </div>;
}

/* ── Tab 6: Links & Pixels ─────────────────────────────────────────────────── */

function LinkModal({ link, onClose, onDone }: { link?: TrackedLink; onClose: () => void; onDone: () => void }) {
  const action = useAction();
  const { values, field } = useFields({
    name: link?.name ?? '',
    url: link?.url ?? '',
    slug: link?.slug ?? '',
  });
  return <Modal title={link ? 'Edit tracked short link' : 'Create tracked short link'} onClose={onClose}>
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        const slug = values.slug.trim();
        if (slug && slug.length < 8) throw new Error('Custom slugs must be at least 8 characters, or leave blank to auto-generate.');
        await api<TrackedLink>(link ? `/links/${link.id}` : '/links', link ? 'PATCH' : 'POST', {
          name: values.name.trim(),
          url: values.url.trim(),
          ...(slug ? { slug } : {}),
        });
        onDone();
      }, link ? 'Tracked link updated.' : 'Tracked link created.');
    }}>
      <TextInput label="Link name" placeholder="Spring launch banner" isRequired {...field('name')} />
      <TextInput label="Destination URL" type="url" placeholder="https://example.com/launch" isRequired {...field('url')} />
      <TextInput
        label="Custom slug"
        description={link
          ? '8–100 letters, numbers, hyphens, or underscores. Updating the slug changes the short URL.'
          : '8–100 letters, numbers, hyphens, or underscores. Leave blank to auto-generate.'}
        isOptional={!link}
        {...field('slug')}
      />
      <Feedback error={action.error} />
      <FormActions>
        <Button label="Cancel" onClick={onClose} />
        <Button type="submit" variant="primary" label={link ? 'Save link' : 'Create link'} isLoading={action.busy} />
      </FormActions>
    </form>
  </Modal>;
}

function PixelModal({ pixel, onClose, onDone }: { pixel?: TrackingPixel; onClose: () => void; onDone: () => void }) {
  const action = useAction();
  const { values, field } = useFields({
    name: pixel?.name ?? '',
    slug: pixel?.slug ?? '',
  });
  return <Modal title={pixel ? 'Edit tracking pixel' : 'Create tracking pixel'} onClose={onClose}>
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        const slug = values.slug.trim();
        if (slug && slug.length < 8) throw new Error('Custom slugs must be at least 8 characters, or leave blank to auto-generate.');
        await api<TrackingPixel>(pixel ? `/pixels/${pixel.id}` : '/pixels', pixel ? 'PATCH' : 'POST', {
          name: values.name.trim(),
          ...(slug ? { slug } : {}),
        });
        onDone();
      }, pixel ? 'Tracking pixel updated.' : 'Tracking pixel created.');
    }}>
      <TextInput label="Pixel name" placeholder="Partner newsletter placement" isRequired {...field('name')} />
      <TextInput
        label="Custom slug"
        description={pixel
          ? '8–100 letters, numbers, hyphens, or underscores. Updating the slug changes the image URL.'
          : '8–100 letters, numbers, hyphens, or underscores. Leave blank to auto-generate.'}
        isOptional={!pixel}
        {...field('slug')}
      />
      <Feedback error={action.error} />
      <FormActions>
        <Button label="Cancel" onClick={onClose} />
        <Button type="submit" variant="primary" label={pixel ? 'Save pixel' : 'Create pixel'} isLoading={action.busy} />
      </FormActions>
    </form>
  </Modal>;
}

type TrendTarget =
  | { kind: 'link'; item: TrackedLink }
  | { kind: 'pixel'; item: TrackingPixel };

function EntityTrendDrawer({
  target,
  origin,
  inBulkBatch,
  bulkPoints,
  bulkLoading,
  bulkError,
  onRefreshBulk,
  onClose,
}: {
  target: TrendTarget;
  origin: string;
  inBulkBatch: boolean;
  bulkPoints?: Point[];
  bulkLoading: boolean;
  bulkError?: string;
  onRefreshBulk: () => void;
  onClose: () => void;
}) {
  const [periodKey, setPeriodKey] = useState<'default' | '7' | '30' | '90'>('default');
  const [customRange, setCustomRange] = useState<DateRange>();

  const useSingleFetch = periodKey !== 'default' || !inBulkBatch;
  const endpoint = target.kind === 'link' ? '/links/charts' : '/pixels/charts';
  const query = periodKey !== 'default' && customRange
    ? `ids=${encodeURIComponent(target.item.id)}&${rangeQuery(customRange)}`
    : `ids=${encodeURIComponent(target.item.id)}`;
  const singleChart = useResource<EntityChartSeries>(useSingleFetch ? `${endpoint}?${query}` : null);

  const points = useSingleFetch ? singleChart.data?.[target.item.id] : bulkPoints;
  const loading = useSingleFetch ? singleChart.loading : bulkLoading;
  const error = useSingleFetch ? singleChart.error : bulkError;
  const refresh = useSingleFetch ? singleChart.refresh : onRefreshBulk;

  const isLink = target.kind === 'link';
  const totalHits = sumPoints(points);
  const trackingUrl = isLink ? `${origin}/q/${target.item.slug}` : `${origin}/p/${target.item.slug}`;

  return <SlideDrawer
    title={target.item.name}
    subtitle={isLink ? 'Tracked short link trend' : 'Tracking pixel trend'}
    onClose={onClose}
    width={580}
  >
    <MetadataList>
      <MetadataListItem label="Slug"><Text type="code">{target.item.slug}</Text></MetadataListItem>
      <MetadataListItem label={isLink ? 'Short URL' : 'Beacon URL'}><Text type="code">{trackingUrl}</Text></MetadataListItem>
      {isLink ? <MetadataListItem label="Destination URL">
        <Link href={target.item.url} isExternalLink>{target.item.url}</Link>
      </MetadataListItem> : null}
      <MetadataListItem label="Created">{date(target.item.createdAt)}</MetadataListItem>
      <MetadataListItem label={isLink ? 'Total clicks' : 'Total impressions'}>
        {loading && points === undefined ? '…' : number(totalHits ?? 0)}
      </MetadataListItem>
    </MetadataList>

    <div className="ov-stack-sm">
      <div className="ov-actions ov-actions--between">
        <Heading level={3}>{isLink ? 'Clicks over time' : 'Impressions over time'}</Heading>
        <div className="ov-actions">
          <SegmentedControl
            label="Trend window"
            size="sm"
            value={periodKey}
            onChange={value => {
              if (value === '7' || value === '30' || value === '90') {
                setPeriodKey(value);
                setCustomRange(recent(Number(value)));
              } else {
                setPeriodKey('default');
                setCustomRange(undefined);
              }
            }}
          >
            <SegmentedControlItem value="default" label="Page range" />
            <SegmentedControlItem value="7" label="7d" />
            <SegmentedControlItem value="30" label="30d" />
            <SegmentedControlItem value="90" label="90d" />
          </SegmentedControl>
          <IconButton size="sm" label="Refresh trend chart" icon={<RefreshCw size={14} />} onClick={refresh} isLoading={loading} />
        </div>
      </div>

      {points === undefined && (loading || error)
        ? <AsyncState loading={loading} error={error} retry={refresh} />
        : <Bars
          points={points ?? []}
          label={`${target.item.name} ${isLink ? 'clicks' : 'impressions'} over time`}
        />}
    </div>
  </SlideDrawer>;
}

/** Click or hit counts for every link or pixel over one range; Umami's charts endpoint takes 20 ids at a time. */
function useEntityCharts(endpoint: '/links/charts' | '/pixels/charts', ids: string[], range: DateRange) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ key: string; data?: EntityChartSeries; error?: string }>();
  const key = `${endpoint}:${ids.join(',')}:${range.startAt}:${range.endAt}:${revision}`;

  useEffect(() => {
    if (!ids.length) return;
    let active = true;
    const chunks: string[][] = [];
    for (let index = 0; index < ids.length; index += 20) chunks.push(ids.slice(index, index + 20));
    const qs = rangeQuery(range).toString();
    void Promise.all(chunks.map(chunk => api<EntityChartSeries>(`${endpoint}?ids=${encodeURIComponent(chunk.join(','))}&${qs}`)))
      .then(parts => { if (active) setState({ key, data: Object.assign({}, ...parts) as EntityChartSeries }); })
      .catch((caught: unknown) => { if (active) setState({ key, error: message(caught) }); });
    return () => { active = false; };
  }, [endpoint, ids, key, range]);

  const current = state?.key === key ? state : undefined;
  return {
    data: current?.data,
    error: current?.error,
    loading: ids.length > 0 && !current,
    refresh: () => setRevision(value => value + 1),
  };
}

function LinksAndPixelsTab({ canEdit, trackingOrigin }: { canEdit: boolean; trackingOrigin?: string }) {
  const links = useResource<TrackedLink[]>('/links');
  const pixels = useResource<TrackingPixel[]>('/pixels');
  const action = useAction();

  const [days, setDays] = useState<7 | 30 | 90>(7);
  const [range, setRange] = useState(() => recent(7));
  const linkBatchIds = useMemo(() => (links.data ?? []).map(item => item.id), [links.data]);
  const pixelBatchIds = useMemo(() => (pixels.data ?? []).map(item => item.id), [pixels.data]);
  const linkBatchSet = useMemo(() => new Set(linkBatchIds), [linkBatchIds]);
  const pixelBatchSet = useMemo(() => new Set(pixelBatchIds), [pixelBatchIds]);

  const linkCharts = useEntityCharts('/links/charts', linkBatchIds, range);
  const pixelCharts = useEntityCharts('/pixels/charts', pixelBatchIds, range);
  const windowLabel = `last ${days} days`;

  const [editLink, setEditLink] = useState<TrackedLink | 'new'>();
  const [editPixel, setEditPixel] = useState<TrackingPixel | 'new'>();
  const [deleteLink, setDeleteLink] = useState<TrackedLink>();
  const [deletePixel, setDeletePixel] = useState<TrackingPixel>();
  const [trendTarget, setTrendTarget] = useState<TrendTarget>();

  function refreshLinks() {
    links.refresh();
    linkCharts.refresh();
  }

  function refreshPixels() {
    pixels.refresh();
    pixelCharts.refresh();
  }

  return <div className="ov-stack">
    <Feedback error={action.error} notice={action.notice} />
    <div className="ov-actions">
      <SegmentedControl
        label="Counting window"
        size="sm"
        value={String(days)}
        onChange={value => {
          const next = value === '90' ? 90 : value === '30' ? 30 : 7;
          setDays(next);
          setRange(recent(next));
        }}
      >
        <SegmentedControlItem value="7" label="7 days" />
        <SegmentedControlItem value="30" label="30 days" />
        <SegmentedControlItem value="90" label="90 days" />
      </SegmentedControl>
      <Text type="supporting" color="secondary">Clicks and impressions are counted over the {windowLabel}.</Text>
    </div>
    <div className="ov-grid">
      <Panel
        title="Tracked short links"
        description="Create redirecting campaign URLs with anonymous click measurement"
        action={<div className="ov-actions">
          <IconButton size="sm" label="Refresh links" icon={<RefreshCw size={14} />} onClick={refreshLinks} isLoading={links.loading || linkCharts.loading} />
          {canEdit ? <Button size="sm" variant="primary" label="Create link" icon={<Link2 size={14} />} onClick={() => setEditLink('new')} /> : null}
        </div>}
      >
        {!links.data ? <AsyncState loading={links.loading} error={links.error} retry={links.refresh} />
          : <Table
            data={links.data}
            idKey="id"
            hasHover
            emptyState={<Empty title="No tracked links yet" description="Create a tracked short link to measure campaign click-throughs." />}
            columns={[
              { key: 'name', header: 'Name', renderCell: item => <Text weight="medium">{item.name}</Text> },
              {
                key: 'url',
                header: 'Destination URL',
                renderCell: item => <Link href={item.url} isExternalLink>{item.url}</Link>,
              },
              { key: 'slug', header: 'Short URL', renderCell: item => <Text type="code">{`/q/${item.slug}`}</Text> },
              {
                key: 'hits',
                header: `Clicks (${days}d)`,
                align: 'end',
                renderCell: item => {
                  if (!linkBatchSet.has(item.id)) return '—';
                  if (linkCharts.loading && !linkCharts.data) return '…';
                  return number(sumPoints(linkCharts.data?.[item.id]) ?? 0);
                },
              },
              { key: 'createdAt', header: 'Created', renderCell: item => date(item.createdAt) },
              {
                key: 'id',
                header: 'Actions',
                align: 'end',
                renderCell: item => <span className="ov-actions ov-actions--end">
                  <Button
                    size="sm"
                    variant="ghost"
                    label="Trend"
                    icon={<TrendingUp size={14} />}
                    onClick={() => setTrendTarget({ kind: 'link', item })}
                  />
                  <IconButton
                    size="sm"
                    variant="ghost"
                    label={`Copy tracked link ${item.name}`}
                    icon={<Copy size={14} />}
                    onClick={() => {
                      const shortUrl = `${resolveOrigin(trackingOrigin)}/q/${item.slug}`;
                      void action.run(async () => navigator.clipboard.writeText(shortUrl), 'Tracked link URL copied.');
                    }}
                  />
                  {canEdit ? <>
                    <IconButton
                      size="sm"
                      variant="ghost"
                      label={`Edit link ${item.name}`}
                      icon={<Pencil size={14} />}
                      onClick={() => setEditLink(item)}
                    />
                    <IconButton
                      size="sm"
                      variant="ghost"
                      label={`Delete link ${item.name}`}
                      icon={<Trash2 size={14} />}
                      onClick={() => setDeleteLink(item)}
                    />
                  </> : null}
                </span>,
              },
            ]}
          />}
      </Panel>

      <Panel
        title="Tracking pixels"
        description="Lightweight image beacons for measuring impressions on external placements"
        action={<div className="ov-actions">
          <IconButton size="sm" label="Refresh pixels" icon={<RefreshCw size={14} />} onClick={refreshPixels} isLoading={pixels.loading || pixelCharts.loading} />
          {canEdit ? <Button size="sm" variant="primary" label="Create pixel" icon={<Plus size={14} />} onClick={() => setEditPixel('new')} /> : null}
        </div>}
      >
        {!pixels.data ? <AsyncState loading={pixels.loading} error={pixels.error} retry={pixels.refresh} />
          : <Table
            data={pixels.data}
            idKey="id"
            hasHover
            emptyState={<Empty title="No tracking pixels yet" description="Create a tracking pixel to count impressions across external pages." />}
            columns={[
              { key: 'name', header: 'Name', renderCell: item => <Text weight="medium">{item.name}</Text> },
              { key: 'slug', header: 'Image URL', renderCell: item => <Text type="code">{`/p/${item.slug}`}</Text> },
              {
                key: 'hits',
                header: `Impressions (${days}d)`,
                align: 'end',
                renderCell: item => {
                  if (!pixelBatchSet.has(item.id)) return '—';
                  if (pixelCharts.loading && !pixelCharts.data) return '…';
                  return number(sumPoints(pixelCharts.data?.[item.id]) ?? 0);
                },
              },
              { key: 'createdAt', header: 'Created', renderCell: item => date(item.createdAt) },
              {
                key: 'id',
                header: 'Actions',
                align: 'end',
                renderCell: item => <span className="ov-actions ov-actions--end">
                  <Button
                    size="sm"
                    variant="ghost"
                    label="Trend"
                    icon={<TrendingUp size={14} />}
                    onClick={() => setTrendTarget({ kind: 'pixel', item })}
                  />
                  <IconButton
                    size="sm"
                    variant="ghost"
                    label={`Copy pixel URL ${item.name}`}
                    icon={<Link2 size={14} />}
                    onClick={() => {
                      const imageUrl = `${resolveOrigin(trackingOrigin)}/p/${item.slug}`;
                      void action.run(async () => navigator.clipboard.writeText(imageUrl), 'Tracking pixel URL copied.');
                    }}
                  />
                  <IconButton
                    size="sm"
                    variant="ghost"
                    label={`Copy pixel snippet ${item.name}`}
                    icon={<Copy size={14} />}
                    onClick={() => {
                      const tag = `<img src="${resolveOrigin(trackingOrigin)}/p/${item.slug}" alt="" width="1" height="1" />`;
                      void action.run(async () => navigator.clipboard.writeText(tag), 'Tracking pixel HTML copied.');
                    }}
                  />
                  {canEdit ? <>
                    <IconButton
                      size="sm"
                      variant="ghost"
                      label={`Edit pixel ${item.name}`}
                      icon={<Pencil size={14} />}
                      onClick={() => setEditPixel(item)}
                    />
                    <IconButton
                      size="sm"
                      variant="ghost"
                      label={`Delete pixel ${item.name}`}
                      icon={<Trash2 size={14} />}
                      onClick={() => setDeletePixel(item)}
                    />
                  </> : null}
                </span>,
              },
            ]}
          />}
      </Panel>
    </div>

    {editLink && canEdit ? <LinkModal
      link={editLink === 'new' ? undefined : editLink}
      onClose={() => setEditLink(undefined)}
      onDone={() => { setEditLink(undefined); refreshLinks(); }}
    /> : null}

    {editPixel && canEdit ? <PixelModal
      pixel={editPixel === 'new' ? undefined : editPixel}
      onClose={() => setEditPixel(undefined)}
      onDone={() => { setEditPixel(undefined); refreshPixels(); }}
    /> : null}

    {trendTarget ? <EntityTrendDrawer
      key={`${trendTarget.kind}:${trendTarget.item.id}`}
      target={trendTarget}
      origin={resolveOrigin(trackingOrigin)}
      inBulkBatch={trendTarget.kind === 'link' ? linkBatchSet.has(trendTarget.item.id) : pixelBatchSet.has(trendTarget.item.id)}
      bulkPoints={trendTarget.kind === 'link' ? linkCharts.data?.[trendTarget.item.id] : pixelCharts.data?.[trendTarget.item.id]}
      bulkLoading={trendTarget.kind === 'link' ? linkCharts.loading : pixelCharts.loading}
      bulkError={trendTarget.kind === 'link' ? linkCharts.error : pixelCharts.error}
      onRefreshBulk={trendTarget.kind === 'link' ? linkCharts.refresh : pixelCharts.refresh}
      onClose={() => setTrendTarget(undefined)}
    /> : null}

    {deleteLink && canEdit ? <ConfirmDialog
      title="Delete tracked link"
      description={`Delete "${deleteLink.name}" (${deleteLink.slug})? Existing short links using this slug will stop redirecting.`}
      actionLabel="Delete link"
      busy={action.busy}
      onClose={() => setDeleteLink(undefined)}
      onConfirm={() => void action.run(async () => {
        await api(`/links/${deleteLink.id}`, 'DELETE');
        if (trendTarget?.kind === 'link' && trendTarget.item.id === deleteLink.id) setTrendTarget(undefined);
        setDeleteLink(undefined);
        refreshLinks();
      }, 'Tracked link deleted.')}
    /> : null}

    {deletePixel && canEdit ? <ConfirmDialog
      title="Delete tracking pixel"
      description={`Delete "${deletePixel.name}" (${deletePixel.slug})?`}
      actionLabel="Delete pixel"
      busy={action.busy}
      onClose={() => setDeletePixel(undefined)}
      onConfirm={() => void action.run(async () => {
        await api(`/pixels/${deletePixel.id}`, 'DELETE');
        if (trendTarget?.kind === 'pixel' && trendTarget.item.id === deletePixel.id) setTrendTarget(undefined);
        setDeletePixel(undefined);
        refreshPixels();
      }, 'Tracking pixel deleted.')}
    /> : null}
  </div>;
}

/* ── Tab 7: Email Reports ──────────────────────────────────────────────────── */

function EmailReportsTab({ canViewCampaignDetail }: { canViewCampaignDetail: boolean }) {
  const overview = useResource<Dashboard>('/overview');
  const campaigns = useResource<Page<Campaign>>('/campaigns?page=1');
  const [trendMetric, setTrendMetric] = useState('opens');

  const trendSeries = trendMetric === 'clicks'
    ? overview.data?.emailClicksTrend
    : trendMetric === 'bounces'
      ? overview.data?.emailBouncesTrend
      : overview.data?.emailTrend;

  function refreshAll() {
    overview.refresh();
    campaigns.refresh();
  }

  return <div className="ov-stack">
    <Panel
      title="Email performance"
      description="Unified newsletter delivery and engagement metrics"
      action={<Button size="sm" label="Refresh metrics" icon={<RefreshCw size={14} />} onClick={refreshAll} isLoading={overview.loading || campaigns.loading} />}
    >
      {overview.data ? <EmailMetrics metrics={overview.data.email} />
        : <AsyncState loading={overview.loading} error={overview.error} retry={overview.refresh} />}
    </Panel>

    {overview.data ? <Panel
      title="Campaign activity trend"
      description="Tracked newsletter engagement over time"
      action={<SegmentedControl label="Email trend metric" size="sm" value={trendMetric} onChange={setTrendMetric}>
        <SegmentedControlItem value="opens" label="Opens" />
        <SegmentedControlItem value="clicks" label="Clicks" />
        <SegmentedControlItem value="bounces" label="Bounces" />
      </SegmentedControl>}
    >
      <Bars points={trendSeries} label={`Tracked newsletter ${trendMetric} over time`} />
    </Panel> : null}

    <Panel title="Recent campaigns" description="Delivery, opens, clicks and open rates for recent newsletters">
      {!campaigns.data ? <AsyncState loading={campaigns.loading} error={campaigns.error} retry={campaigns.refresh} />
        : <Table
          data={campaigns.data.items}
          idKey="id"
          hasHover
          emptyState={<Empty title="No newsletters recorded yet" description="Campaign delivery performance will appear here once newsletters are created." />}
          columns={[
            {
              key: 'name',
              header: 'Campaign',
              renderCell: item => <span className="ov-cell">
                {canViewCampaignDetail
                  ? <Link href={`/campaigns/${item.id}`}>{item.name}</Link>
                  : <Text weight="medium">{item.name}</Text>}
                <Text type="supporting" color="secondary">{item.subject}</Text>
              </span>,
            },
            {
              key: 'status',
              header: 'Status',
              renderCell: item => {
                const label = item.status === 'running' ? 'Sending' : item.status ? item.status[0].toUpperCase() + item.status.slice(1) : 'Unknown';
                return <StatusBadge label={label} tone={campaignStatusTone[item.status] ?? 'neutral'} />;
              },
            },
            { key: 'sent', header: 'Sent', align: 'end', renderCell: item => number(item.metrics.sent) },
            { key: 'opens', header: 'Opens', align: 'end', renderCell: item => number(item.metrics.opens) },
            { key: 'clicks', header: 'Clicks', align: 'end', renderCell: item => number(item.metrics.clicks) },
            {
              key: 'openRate',
              header: 'Open rate',
              align: 'end',
              renderCell: item => {
                const { opens, sent } = item.metrics;
                return opens != null && sent != null && sent > 0 ? formatPercent(opens / sent) : '—';
              },
            },
          ]}
        />}
    </Panel>

    <Banner
      status="info"
      title="Privacy & attribution boundary"
      description="Email engagement and website traffic are reported separately. Website visits remain anonymous and are never linked to individual recipients unless a campaign UTM link establishes attribution."
    />
  </div>;
}

/* ── Tab 8: Marketing Reports ──────────────────────────────────────────────── */

type MarketingReportTableRow = Record<string, string | number | null> & { _id: string };

function MarketingReportsTab() {
  const reports = useResource<MarketingReport[]>('/reports');
  const exportAction = useAction();
  const [selectedId, setSelectedId] = useState('');

  const activeReport = reports.data?.find(item => String(item.id) === selectedId) ?? reports.data?.[0];
  const detail = useResource<MarketingReportData>(activeReport ? `/reports/${activeReport.id}?limit=100` : null);

  const columns = useMemo(() => {
    if (!detail.data) return [];
    if (detail.data.columns.length) return detail.data.columns;
    const first = detail.data.rows[0];
    return first ? Object.keys(first) : [];
  }, [detail.data]);

  const tableRows: MarketingReportTableRow[] = useMemo(
    () => (detail.data?.rows ?? []).map((row, idx) => ({ ...row, _id: String(idx) })),
    [detail.data?.rows],
  );

  function refreshAll() {
    reports.refresh();
    detail.refresh();
  }

  function handleExportCsv() {
    if (!activeReport || !detail.data || !columns.length) return;
    const csv = buildCsv(columns, detail.data.rows);
    const filename = `ovelio-report-${slugifyFilename(activeReport.name || String(activeReport.id))}.csv`;
    void exportAction.run(async () => {
      saveFile(csv, filename, 'text/csv;charset=utf-8');
    }, 'Marketing report exported as CSV.');
  }

  const rowSummary = detail.data
    ? detail.data.totalResults > detail.data.rows.length
      ? `Showing ${number(detail.data.rows.length)} of ${number(detail.data.totalResults)} rows`
      : `${number(detail.data.totalResults)} ${detail.data.totalResults === 1 ? 'row' : 'rows'}`
    : undefined;

  return <div className="ov-stack">
    <Feedback error={exportAction.error} notice={exportAction.notice} />

    {!reports.data ? <Panel>
      <AsyncState loading={reports.loading} error={reports.error} retry={reports.refresh} />
    </Panel> : !reports.data.length || !activeReport ? <Panel>
      <Empty
        title="No marketing reports available"
        description="Audience, email, form, asset, and landing page reports will appear here once configured."
      />
    </Panel> : <>
      <Panel
        title="Marketing reports"
        description="Audience, email, form, asset, and landing page performance reports"
        action={<div className="ov-actions">
          <IconButton
            size="sm"
            label="Refresh marketing reports"
            icon={<RefreshCw size={14} />}
            onClick={refreshAll}
            isLoading={reports.loading || detail.loading}
          />
          <Button
            size="sm"
            label="Export CSV"
            icon={<Download size={14} />}
            isDisabled={!detail.data?.rows.length || !columns.length || exportAction.busy}
            onClick={handleExportCsv}
          />
        </div>}
      >
        <div className="ov-toolbar">
          <Selector
            label="Select report"
            width={360}
            value={String(activeReport.id)}
            onChange={value => value && setSelectedId(value)}
            options={reports.data.map(item => ({
              value: String(item.id),
              label: item.name || `Report #${item.id}`,
              description: formatReportSource(item.source),
            }))}
          />
          <div className="ov-actions">
            <Badge variant="neutral" label={formatReportSource(activeReport.source)} />
            {activeReport.system ? <Badge variant="info" label="System report" /> : null}
            {rowSummary ? <Text type="supporting" color="secondary">{rowSummary}</Text> : null}
          </div>
        </div>

        {activeReport.description ? (
          <Text type="supporting" color="secondary">{activeReport.description}</Text>
        ) : null}

        {!detail.data ? <AsyncState loading={detail.loading} error={detail.error} retry={detail.refresh} />
          : !columns.length ? <Empty
            title="No rows returned"
            description="This marketing report currently has no matching records."
          /> : <Table
            data={tableRows}
            idKey="_id"
            hasHover
            emptyState={<Empty title="No rows returned" description="This marketing report currently has no matching records." />}
            columns={columns.map(col => {
              const isIdentifier = /(^|_|\.)id$/i.test(col);
              const isNumeric = !isIdentifier && detail.data!.rows.some(row => typeof row[col] === 'number');
              return {
                key: col,
                header: formatColumnHeader(col),
                align: isNumeric ? ('end' as const) : undefined,
                renderCell: (row: MarketingReportTableRow) => {
                  const raw = row[col];
                  if (raw == null || raw === '') return <Text color="secondary">—</Text>;
                  if (typeof raw === 'number') return isNumeric ? number(raw) : String(raw);
                  return String(raw);
                },
              };
            })}
          />}
      </Panel>
    </>}

    <Banner
      status="info"
      title="Audience & marketing data boundary"
      description="Marketing reports summarize contacts, emails, forms, assets, and landing pages separately from anonymous website analytics."
    />
  </div>;
}

/* ── Root Analytics Workspace ──────────────────────────────────────────────── */

export function Analytics({ trackingOrigin, initialTab }: { trackingOrigin?: string; initialTab?: string }) {
  const user = useUser();
  const canEdit = user.role !== 'analyst';
  const isAdmin = user.role === 'admin';

  const [tab, setTab] = useState<AnalyticsTab>(() => normalizeTab(initialTab));
  const [range, setRange] = useState(() => recent(30));
  const [period, setPeriod] = useState('30');
  const [selected, setSelected] = useState('');
  const [filters, setFilters] = useState<ReportFilters>({});
  const [modal, setModal] = useState<'website' | 'tracking' | 'dates' | 'settings'>();
  const [confirmAction, setConfirmAction] = useState<'reset' | 'delete'>();
  const [siteRevision, setSiteRevision] = useState(0);
  const adminAction = useAction();

  const isWebsiteScoped = websiteScopedTabs.has(tab);
  const websites = useResource<Website[]>(isWebsiteScoped ? websitesPath : null);
  const website = websites.data?.find(item => item.id === selected) || websites.data?.[0];

  const [savedNames, setSavedNames] = useState<Record<string, string>>({});

  function addFilter(dimension: ReportDimension, value: string) {
    const trimmed = value.trim();
    if (!trimmed || !isFilterable(dimension)) return;
    const target = (dimension === 'entry' || dimension === 'exit' ? 'path' : dimension) as FilterDimension;
    if (!(FILTER_DIMENSIONS as readonly string[]).includes(target)) return;
    // A clicked row replaces any earlier filter on the same dimension with a plain "is" filter.
    setFilters(current => ({
      ...current,
      rules: [...(current.rules ?? []).filter(rule => rule.dimension !== target), equalityRule(target, trimmed)],
    }));
  }

  function addPropertyFilter(property: PropertyFilter) {
    setFilters(current => ({ ...current, properties: [...(current.properties ?? []), property] }));
  }

  function applySaved(next: ReportFilters, saved?: { id: string; name: string }) {
    setFilters(next);
    if (saved) setSavedNames(current => ({ ...current, [saved.id]: saved.name }));
  }

  const refreshRange = period === 'custom' ? undefined : () => setRange(recent(Number(period)));

  return <>
    <PageHeader
      title="Analytics"
      description="Measure website activity, live visitors, sessions, conversions, newsletters and marketing reports."
      actions={isWebsiteScoped && canEdit
        ? <Button variant="primary" icon={<Plus size={16} />} label="Add website" onClick={() => setModal('website')} />
        : undefined}
    />

    <Tabs label="Analytics view" items={viewTabs} value={tab} onChange={setTab} />
    <Feedback error={adminAction.error} notice={adminAction.notice} />

    {tab === 'Email reports' ? <EmailReportsTab canViewCampaignDetail={canEdit} />
      : tab === 'Marketing reports' ? <MarketingReportsTab />
        : tab === 'Links & Pixels' ? <LinksAndPixelsTab canEdit={canEdit} trackingOrigin={trackingOrigin} />
          : !websites.data ? <Panel><AsyncState loading={websites.loading} error={websites.error} retry={websites.refresh} /></Panel>
            : !website ? <Panel>
              <Empty
                title="No websites connected"
                description={canEdit ? 'Add a website to view its activity and get a tracking snippet.' : 'Ask a marketer or administrator to connect a website.'}
              />
            </Panel> : <div className="ov-stack">
              <div className="ov-toolbar">
                <div className="ov-actions">
                  <Selector
                    label="Website"
                    isLabelHidden
                    width={260}
                    value={website.id}
                    onChange={value => {
                      setSelected(value ?? '');
                      setFilters({});
                    }}
                    options={websites.data.map(item => ({ value: item.id, label: item.name, description: item.domain }))}
                  />
                  {canEdit ? <Button label="Website settings" icon={<Settings2 size={15} />} onClick={() => setModal('settings')} /> : null}
                  <Selector
                    label="Reporting period"
                    isLabelHidden
                    width={190}
                    value={period}
                    onChange={value => {
                      if (value === 'custom') return setModal('dates');
                      if (value) {
                        setPeriod(value);
                        setRange(recent(Number(value)));
                      }
                    }}
                    options={[
                      { value: '1', label: 'Last 24 hours' },
                      { value: '7', label: 'Last 7 days' },
                      { value: '30', label: 'Last 30 days' },
                      { value: '90', label: 'Last 90 days' },
                      { value: '365', label: 'Last 365 days' },
                      { value: 'custom', label: period === 'custom' ? `${isoDay(range.startAt)} – ${isoDay(range.endAt)}` : 'Custom dates' },
                    ]}
                  />
                  <Button label="Dates" icon={<CalendarDays size={15} />} onClick={() => setModal('dates')} />
                </div>
                {canEdit ? <Button label="Tracking code" icon={<CodeXml size={16} />} onClick={() => setModal('tracking')} /> : null}
              </div>

              <ReportFilterBar filters={filters} savedNames={savedNames} onChange={setFilters} />

              {tab === 'Traffic' ? <TrafficTab
                key={`${website.id}:${siteRevision}`}
                website={website}
                range={range}
                filters={filters}
                canEdit={canEdit}
                onAddFilter={addFilter}
                onApplyFilters={applySaved}
                refreshRange={refreshRange}
              /> : null}
              {tab === 'Realtime' ? <RealtimeTab key={`${website.id}:${siteRevision}`} website={website} /> : null}
              {tab === 'Sessions' ? <SessionsTab key={`${website.id}:${siteRevision}`} website={website} range={range} filters={filters} onAddProperty={addPropertyFilter} /> : null}
              {tab === 'Goals & Funnels' ? <GoalsAndFunnelsTab key={`${website.id}:${siteRevision}`} website={website} range={range} canEdit={canEdit} /> : null}
              {tab === 'Insights' ? <InsightsTab key={`${website.id}:${siteRevision}`} website={website} range={range} filters={filters} canEdit={canEdit} /> : null}
            </div>}

    {modal === 'website' && canEdit ? <WebsiteForm
      onClose={() => setModal(undefined)}
      onDone={value => {
        setSelected(value.id);
        setFilters({});
        websites.refresh();
        setModal(undefined);
      }}
    /> : null}

    {modal === 'tracking' && website && canEdit ? <TrackingCode
      website={website}
      origin={resolveOrigin(trackingOrigin)}
      onClose={() => setModal(undefined)}
    /> : null}

    {modal === 'dates' ? <CustomRange
      range={range}
      onClose={() => setModal(undefined)}
      onDone={value => { setPeriod('custom'); setRange(value); setModal(undefined); }}
    /> : null}

    {modal === 'settings' && website && canEdit ? <WebsiteSettingsModal
      website={website}
      range={range}
      isAdmin={isAdmin}
      onClose={() => setModal(undefined)}
      onUpdated={updated => {
        setSelected(updated.id);
        websites.refresh();
      }}
      onRequestReset={() => { setModal(undefined); setConfirmAction('reset'); }}
      onRequestDelete={() => { setModal(undefined); setConfirmAction('delete'); }}
    /> : null}

    {confirmAction === 'reset' && website && isAdmin ? <ConfirmDialog
      title="Reset website analytics data"
      description={`Permanently erase all recorded page views, sessions and events for "${website.name}" (${website.domain})? The website and tracking code will remain active.`}
      actionLabel="Reset data"
      busy={adminAction.busy}
      onClose={() => setConfirmAction(undefined)}
      onConfirm={() => void adminAction.run(async () => {
        await api(`${websitesPath}/${website.id}/reset`, 'POST');
        setConfirmAction(undefined);
        setSiteRevision(value => value + 1);
      }, 'Website analytics data reset.')}
    /> : null}

    {confirmAction === 'delete' && website && isAdmin ? <ConfirmDialog
      title="Delete website"
      description={`Disconnect and delete "${website.name}" (${website.domain}) along with all its analytics history? This cannot be undone.`}
      actionLabel="Delete website"
      busy={adminAction.busy}
      onClose={() => setConfirmAction(undefined)}
      onConfirm={() => void adminAction.run(async () => {
        await api(`${websitesPath}/${website.id}`, 'DELETE');
        setConfirmAction(undefined);
        setSelected('');
        setFilters({});
        websites.refresh();
      }, 'Website deleted.')}
    /> : null}
  </>;
}
