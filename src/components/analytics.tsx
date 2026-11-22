'use client';

import {
  Activity, ArrowRight, BookmarkPlus, CalendarDays, CodeXml, Copy, Download,
  Eye, Link2, MousePointerClick, Pencil, Plus, RefreshCw, RotateCcw,
  Save, Search, Settings2, Share2, Sparkles, Target, Trash2, Users,
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
  AttributionResult,
  BreakdownRow,
  Campaign,
  Dashboard,
  DateRange,
  EventPropertyStat,
  EventPropertyValue,
  FunnelResult,
  FunnelStep,
  Goal,
  GoalStats,
  JourneyPath,
  Page,
  RealtimeReport,
  ReportDimension,
  ReportFilters,
  RetentionRow,
  SavedFunnel,
  SessionActivityItem,
  TrackedLink,
  TrackingPixel,
  Website,
  WebsiteReport,
  WebsiteSession,
  WebsiteShare,
  WeeklyTraffic,
} from '@/contracts';
import { api, date, duration, message, number, saveFile, useAction, useFields, useResource } from './client';
import { EmailMetrics } from './overview';
import { useUser } from './shell';
import {
  AsyncState, Bars, ConfirmDialog, Distribution, Empty, Feedback, FilterBar,
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
  const trimmed = value.trim();
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
  if (filters) {
    for (const [key, val] of Object.entries(filters)) {
      if (val?.trim()) params.set(key, val.trim());
    }
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

function filterKeyForDimension(dimension: ReportDimension): ReportDimension {
  if (dimension === 'entry' || dimension === 'exit') return 'path';
  return dimension;
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
  const snippet = `<script defer src="${origin.replace(/\/$/, '')}/script.js" data-website-id="${website.id}"></script>`;
  return <Modal title="Tracking code" size="large" onClose={onClose}>
    <Text>Place this script in the &lt;head&gt; of each page on <strong>{website.domain}</strong> you want to measure.</Text>
    <Snippet code={snippet} />
    <Text type="supporting" color="secondary">Track a custom event by adding <Text type="code">{'data-umami-event="signed_up"'}</Text> to a button or link.</Text>
    <Text type="supporting" color="secondary">Website visitors are anonymous. OVELIO does not link visits to contacts unless an attribution has been established.</Text>
    <Feedback error={action.error} notice={action.notice} />
    <FormActions>
      <Button
        label="Copy tracking code"
        icon={<Copy size={15} />}
        onClick={() => void action.run(async () => navigator.clipboard.writeText(snippet), 'Tracking code copied.')}
      />
    </FormActions>
  </Modal>;
}

function WebsiteSettingsModal({
  website,
  range,
  origin,
  isAdmin,
  onClose,
  onUpdated,
  onRequestReset,
  onRequestDelete,
}: {
  website: Website;
  range: DateRange;
  origin: string;
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
            const shareUrl = `${origin}/share/${share.slug}`;
            return <li key={share.id}>
              <span>
                <Text weight="medium">{share.name}</Text>
                <Text type="supporting" color="secondary">{shareUrl}</Text>
              </span>
              <span className="ov-actions">
                <IconButton
                  size="sm"
                  variant="ghost"
                  label={`Copy share link ${share.name}`}
                  icon={<Copy size={14} />}
                  onClick={() => void shareAction.run(async () => navigator.clipboard.writeText(shareUrl), 'Share link copied.')}
                />
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

function TrafficTab({
  website,
  range,
  filters,
  canEdit,
  onAddFilter,
  refreshRange,
}: {
  website: Website;
  range: DateRange;
  filters: ReportFilters;
  canEdit: boolean;
  onAddFilter: (dimension: ReportDimension, value: string) => void;
  refreshRange?: () => void;
}) {
  const report = useResource<WebsiteReport>(`${websitesPath}/${website.id}/report?${rangeQuery(range, filters)}`);
  const annotations = useResource<Annotation[]>(`${websitesPath}/${website.id}/annotations?${rangeQuery(range)}`);
  const deleteAction = useAction();
  const [chart, setChart] = useState('pageviews');
  const [breakdown, setBreakdown] = useState<BreakdownTab>('Pages');
  const [addNoteOpen, setAddNoteOpen] = useState(false);
  const [deleteNote, setDeleteNote] = useState<Annotation>();

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

      <Panel title="Traffic breakdown" description="Click any row to add it as an active filter.">
        <Tabs label="Traffic breakdown" items={breakdownTabs} value={breakdown} onChange={setBreakdown} />
        {breakdown === 'Events' ? <div className="ov-stack">
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

function SessionActivityDrawer({
  websiteId,
  session,
  range,
  onClose,
}: {
  websiteId: string;
  session: WebsiteSession;
  range: DateRange;
  onClose: () => void;
}) {
  const activity = useResource<SessionActivityItem[]>(
    `${websitesPath}/${websiteId}/sessions/${session.id}/activity?${rangeQuery(range)}`,
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

function SessionsTab({
  website,
  range,
  filters,
}: {
  website: Website;
  range: DateRange;
  filters: ReportFilters;
}) {
  const [queryInput, setQueryInput] = useState('');
  const [search, setSearch] = useState('');
  const [selectedSession, setSelectedSession] = useState<WebsiteSession>();

  const filterSig = `${range.startAt}:${range.endAt}:${JSON.stringify(filters)}:${search}`;
  const [pageState, setPageState] = useState({ sig: filterSig, page: 1 });
  const page = pageState.sig === filterSig ? pageState.page : 1;
  const setPage = (next: number) => setPageState({ sig: filterSig, page: next });

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

    <Panel
      title="Weekly traffic heatmap"
      description="Recorded views by day of week and hour (UTC)"
      action={<IconButton size="sm" label="Refresh heatmap" icon={<RefreshCw size={14} />} onClick={weekly.refresh} isLoading={weekly.loading} />}
    >
      {!weekly.data ? <AsyncState loading={weekly.loading} error={weekly.error} retry={weekly.refresh} />
        : <WeeklyHeatmap matrix={weekly.data} />}
    </Panel>

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
        description="Enter the exact event name or page path."
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
          { key: 'value', header: 'Match value', renderCell: item => <Text type="code">{item.value}</Text> },
          {
            key: 'unique',
            header: 'Converting sessions',
            align: 'end',
            renderCell: item => loadingStats ? '…' : number(statsMap?.[item.id]?.unique),
          },
          {
            key: 'total',
            header: 'Total conversions',
            align: 'end',
            renderCell: item => loadingStats ? '…' : number(statsMap?.[item.id]?.total),
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

function AttributionView({ website, range }: { website: Website; range: DateRange }) {
  const [model, setModel] = useState<'first-click' | 'last-click'>('first-click');
  const [type, setType] = useState<'path' | 'event'>('path');
  const [step, setStep] = useState('');
  const [submitted, setSubmitted] = useState<{ model: 'first-click' | 'last-click'; type: 'path' | 'event'; step: string }>();

  const attribution = useResource<AttributionResult>(
    submitted
      ? `${websitesPath}/${website.id}/attribution?${rangeQuery(range, undefined, {
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
        setSubmitted({ model, type, step: step.trim() });
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
    const appliedFilters = Object.keys(filters).length ? filters : undefined;
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

function InsightsTab({ website, range, filters }: { website: Website; range: DateRange; filters: ReportFilters }) {
  const [subview, setSubview] = useState('journeys');
  return <div className="ov-stack">
    <div className="ov-actions">
      <SegmentedControl label="Insights view" value={subview} onChange={setSubview}>
        <SegmentedControlItem value="journeys" label="User journeys" />
        <SegmentedControlItem value="retention" label="Retention cohorts" />
        <SegmentedControlItem value="attribution" label="Attribution" />
        <SegmentedControlItem value="breakdown" label="Breakdown" />
      </SegmentedControl>
    </div>
    {subview === 'journeys' ? <JourneysView website={website} range={range} filters={filters} /> : null}
    {subview === 'retention' ? <RetentionView website={website} range={range} filters={filters} /> : null}
    {subview === 'attribution' ? <AttributionView website={website} range={range} /> : null}
    {subview === 'breakdown' ? <BreakdownView website={website} range={range} filters={filters} /> : null}
  </div>;
}

/* ── Tab 6: Links & Pixels ─────────────────────────────────────────────────── */

function CreateLinkModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const action = useAction();
  const { values, field } = useFields({ name: '', url: '', slug: '' });
  return <Modal title="Create tracked short link" onClose={onClose}>
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        const slug = values.slug.trim();
        if (slug && slug.length < 8) throw new Error('Custom slugs must be at least 8 characters, or leave blank to auto-generate.');
        await api<TrackedLink>('/links', 'POST', {
          name: values.name.trim(),
          url: values.url.trim(),
          ...(slug ? { slug } : {}),
        });
        onDone();
      }, 'Tracked link created.');
    }}>
      <TextInput label="Link name" placeholder="Spring launch banner" isRequired {...field('name')} />
      <TextInput label="Destination URL" type="url" placeholder="https://example.com/launch" isRequired {...field('url')} />
      <TextInput
        label="Custom slug"
        description="8–100 letters, numbers, hyphens, or underscores. Leave blank to auto-generate."
        isOptional
        {...field('slug')}
      />
      <Feedback error={action.error} />
      <FormActions>
        <Button label="Cancel" onClick={onClose} />
        <Button type="submit" variant="primary" label="Create link" isLoading={action.busy} />
      </FormActions>
    </form>
  </Modal>;
}

function CreatePixelModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const action = useAction();
  const { values, field } = useFields({ name: '', slug: '' });
  return <Modal title="Create tracking pixel" onClose={onClose}>
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        const slug = values.slug.trim();
        if (slug && slug.length < 8) throw new Error('Custom slugs must be at least 8 characters, or leave blank to auto-generate.');
        await api<TrackingPixel>('/pixels', 'POST', {
          name: values.name.trim(),
          ...(slug ? { slug } : {}),
        });
        onDone();
      }, 'Tracking pixel created.');
    }}>
      <TextInput label="Pixel name" placeholder="Partner newsletter placement" isRequired {...field('name')} />
      <TextInput
        label="Custom slug"
        description="8–100 letters, numbers, hyphens, or underscores. Leave blank to auto-generate."
        isOptional
        {...field('slug')}
      />
      <Feedback error={action.error} />
      <FormActions>
        <Button label="Cancel" onClick={onClose} />
        <Button type="submit" variant="primary" label="Create pixel" isLoading={action.busy} />
      </FormActions>
    </form>
  </Modal>;
}

function LinksAndPixelsTab({ canEdit, trackingOrigin }: { canEdit: boolean; trackingOrigin?: string }) {
  const links = useResource<TrackedLink[]>('/links');
  const pixels = useResource<TrackingPixel[]>('/pixels');
  const action = useAction();

  const [createLink, setCreateLink] = useState(false);
  const [createPixel, setCreatePixel] = useState(false);
  const [deleteLink, setDeleteLink] = useState<TrackedLink>();
  const [deletePixel, setDeletePixel] = useState<TrackingPixel>();

  return <div className="ov-stack">
    <Feedback error={action.error} notice={action.notice} />
    <div className="ov-grid">
      <Panel
        title="Tracked short links"
        description="Create redirecting campaign URLs with anonymous click measurement"
        action={<div className="ov-actions">
          <IconButton size="sm" label="Refresh links" icon={<RefreshCw size={14} />} onClick={links.refresh} isLoading={links.loading} />
          {canEdit ? <Button size="sm" variant="primary" label="Create link" icon={<Link2 size={14} />} onClick={() => setCreateLink(true)} /> : null}
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
              { key: 'slug', header: 'Slug', renderCell: item => <Text type="code">{item.slug}</Text> },
              { key: 'createdAt', header: 'Created', renderCell: item => date(item.createdAt) },
              {
                key: 'id',
                header: 'Actions',
                align: 'end',
                renderCell: item => <span className="ov-actions ov-actions--end">
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
                  {canEdit ? <IconButton
                    size="sm"
                    variant="ghost"
                    label={`Delete link ${item.name}`}
                    icon={<Trash2 size={14} />}
                    onClick={() => setDeleteLink(item)}
                  /> : null}
                </span>,
              },
            ]}
          />}
      </Panel>

      <Panel
        title="Tracking pixels"
        description="Lightweight image beacons for measuring impressions on external placements"
        action={<div className="ov-actions">
          <IconButton size="sm" label="Refresh pixels" icon={<RefreshCw size={14} />} onClick={pixels.refresh} isLoading={pixels.loading} />
          {canEdit ? <Button size="sm" variant="primary" label="Create pixel" icon={<Plus size={14} />} onClick={() => setCreatePixel(true)} /> : null}
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
              { key: 'slug', header: 'Slug', renderCell: item => <Text type="code">{item.slug}</Text> },
              { key: 'createdAt', header: 'Created', renderCell: item => date(item.createdAt) },
              {
                key: 'id',
                header: 'Actions',
                align: 'end',
                renderCell: item => <span className="ov-actions ov-actions--end">
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
                  {canEdit ? <IconButton
                    size="sm"
                    variant="ghost"
                    label={`Delete pixel ${item.name}`}
                    icon={<Trash2 size={14} />}
                    onClick={() => setDeletePixel(item)}
                  /> : null}
                </span>,
              },
            ]}
          />}
      </Panel>
    </div>

    {createLink && canEdit ? <CreateLinkModal
      onClose={() => setCreateLink(false)}
      onDone={() => { setCreateLink(false); links.refresh(); }}
    /> : null}

    {createPixel && canEdit ? <CreatePixelModal
      onClose={() => setCreatePixel(false)}
      onDone={() => { setCreatePixel(false); pixels.refresh(); }}
    /> : null}

    {deleteLink && canEdit ? <ConfirmDialog
      title="Delete tracked link"
      description={`Delete "${deleteLink.name}" (${deleteLink.slug})? Existing short links using this slug will stop redirecting.`}
      actionLabel="Delete link"
      busy={action.busy}
      onClose={() => setDeleteLink(undefined)}
      onConfirm={() => void action.run(async () => {
        await api(`/links/${deleteLink.id}`, 'DELETE');
        setDeleteLink(undefined);
        links.refresh();
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
        setDeletePixel(undefined);
        pixels.refresh();
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

  const activeFilterItems = useMemo(
    () => (Object.entries(filters) as [ReportDimension, string][])
      .filter(([, value]) => Boolean(value))
      .map(([key, value]) => ({ key, label: `${dimensionLabels[key] ?? key}: ${value}` })),
    [filters],
  );

  function addFilter(dimension: ReportDimension, value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    const filterKey = filterKeyForDimension(dimension);
    setFilters(current => ({ ...current, [filterKey]: trimmed }));
  }

  function removeFilter(key: string) {
    setFilters(current => {
      const next = { ...current };
      delete next[key as ReportDimension];
      return next;
    });
  }

  const refreshRange = period === 'custom' ? undefined : () => setRange(recent(Number(period)));

  return <>
    <PageHeader
      title="Analytics"
      description="Measure website activity, live visitors, sessions, conversions and newsletter performance."
      actions={isWebsiteScoped && canEdit
        ? <Button variant="primary" icon={<Plus size={16} />} label="Add website" onClick={() => setModal('website')} />
        : undefined}
    />

    <Tabs label="Analytics view" items={viewTabs} value={tab} onChange={setTab} />
    <Feedback error={adminAction.error} notice={adminAction.notice} />

    {tab === 'Email reports' ? <EmailReportsTab canViewCampaignDetail={canEdit} />
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

            <FilterBar items={activeFilterItems} onRemove={removeFilter} onClear={() => setFilters({})} />

            {tab === 'Traffic' ? <TrafficTab
              key={`${website.id}:${siteRevision}`}
              website={website}
              range={range}
              filters={filters}
              canEdit={canEdit}
              onAddFilter={addFilter}
              refreshRange={refreshRange}
            /> : null}
            {tab === 'Realtime' ? <RealtimeTab key={`${website.id}:${siteRevision}`} website={website} /> : null}
            {tab === 'Sessions' ? <SessionsTab key={`${website.id}:${siteRevision}`} website={website} range={range} filters={filters} /> : null}
            {tab === 'Goals & Funnels' ? <GoalsAndFunnelsTab key={`${website.id}:${siteRevision}`} website={website} range={range} canEdit={canEdit} /> : null}
            {tab === 'Insights' ? <InsightsTab key={`${website.id}:${siteRevision}`} website={website} range={range} filters={filters} /> : null}
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
      origin={resolveOrigin(trackingOrigin)}
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
