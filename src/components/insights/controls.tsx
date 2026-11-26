'use client';

// Shared analytics controls: URL-backed date range, comparison and filters; KPI tiles with provenance labels and
// deltas; the drill-down drawer; CSV export links.
import { ArrowDownRight, ArrowRight, ArrowUpRight, Download } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { DateInput } from '@astryxdesign/core/DateInput';
import { InfoTip } from '@astryxdesign/core/InfoTip';
import { Link } from '@astryxdesign/core/Link';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import type { DrillParams, DrillResult, InsightsMeta, InsightsOptions, Metric, Provenance, ReportKey } from '@/contracts/insights';
import { useResource } from '../client';
import { usePreview } from '../shell';
import { AsyncState, Empty, FormActions, Modal, Pager, SlideDrawer } from '../ui';
import { change, formatDate, formatMoney, formatValue } from './format';
import '@/styles/insights.css';

const DAY = 86_400_000;

const presets = [
  { value: '7d', label: 'Last 7 days' }, { value: '30d', label: 'Last 30 days' }, { value: '90d', label: 'Last 90 days' },
  { value: 'mtd', label: 'This month' }, { value: 'lastMonth', label: 'Last month' }, { value: 'qtd', label: 'This quarter' },
  { value: 'ytd', label: 'Year to date' }, { value: '12m', label: 'Last 12 months' }, { value: 'custom', label: 'Custom range…' },
] as const;

function rangeFor(preset: string, from: string | null, to: string | null, now: number) {
  const today = Math.floor(now / DAY) * DAY;
  const date = new Date(today);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  switch (preset) {
    case '7d': return { startAt: today - 6 * DAY, endAt: now };
    case '90d': return { startAt: today - 89 * DAY, endAt: now };
    case 'mtd': return { startAt: Date.UTC(year, month, 1), endAt: now };
    case 'lastMonth': return { startAt: Date.UTC(year, month - 1, 1), endAt: Date.UTC(year, month, 1) };
    case 'qtd': return { startAt: Date.UTC(year, Math.floor(month / 3) * 3, 1), endAt: now };
    case 'ytd': return { startAt: Date.UTC(year, 0, 1), endAt: now };
    case '12m': return { startAt: today - 364 * DAY, endAt: now };
    case 'custom': {
      const start = Date.parse(from ?? '');
      const end = Date.parse(to ?? '');
      if (Number.isFinite(start) && Number.isFinite(end) && end >= start) return { startAt: start, endAt: Math.min(end + DAY, now) };
      return { startAt: today - 29 * DAY, endAt: now };
    }
    default: return { startAt: today - 29 * DAY, endAt: now };
  }
}

export type InsightsState = ReturnType<typeof useInsightsState>;

/** Date range, comparison and filters live in the URL, so links between analytics pages keep them. */
export function useInsightsState() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [now] = useState(() => Date.now());
  const preset = params.get('range') ?? '30d';
  const compare = (params.get('compare') ?? 'previous') as 'none' | 'previous' | 'year';
  const range = rangeFor(preset, params.get('from'), params.get('to'), now);
  const filters = { pipelineId: params.get('pipeline') ?? '', ownerId: params.get('owner') ?? '', campaignId: params.get('campaign') ?? '', source: params.get('source') ?? '' };
  const api = new URLSearchParams({ startAt: String(range.startAt), endAt: String(range.endAt), compare });
  for (const [key, value] of Object.entries(filters)) if (value) api.set(key, value);
  const apiQuery = api.toString();
  const pageQuery = params.toString();
  function set(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    router.replace(`${pathname}${next.size ? '?' + next : ''}`, { scroll: false });
  }
  const comparisonLabel = compare === 'previous' ? 'Previous period' : compare === 'year' ? 'Same period last year' : null;
  const presetLabel = preset === 'custom' ? `${formatDate(range.startAt)} – ${formatDate(range.endAt - 1)}` : presets.find(item => item.value === preset)?.label ?? 'Last 30 days';
  return { range, compare, filters, apiQuery, pageQuery, set, comparisonLabel, presetLabel, preset };
}

export const withQuery = (href: string, query: string) => (query ? `${href}?${query}` : href);

export function InsightsToolbar({ state, filters = ['pipeline', 'owner', 'campaign', 'source'], extra }: {
  state: InsightsState; filters?: ('pipeline' | 'owner' | 'campaign' | 'source')[]; extra?: ReactNode;
}) {
  const options = useResource<InsightsOptions>('/insights/options');
  const [custom, setCustom] = useState(false);
  const all = (label: string) => ({ value: '', label });
  const data = options.data;
  return <div className="ov-insights-toolbar" role="region" aria-label="Report filters">
    <Selector label="Date range" size="sm" width={190} value={state.preset} options={[...presets]}
      onChange={value => value === 'custom' ? setCustom(true) : state.set({ range: value ?? '30d', from: null, to: null })} />
    <Selector label="Compare to" size="sm" width={200} value={state.compare}
      options={[{ value: 'previous', label: 'Previous period' }, { value: 'year', label: 'Same period last year' }, { value: 'none', label: 'No comparison' }]}
      onChange={value => state.set({ compare: value === 'previous' ? null : value })} />
    {filters.includes('pipeline') && (data?.pipelines.length ?? 0) > 1 ? <Selector label="Pipeline" size="sm" width={180} value={state.filters.pipelineId}
      options={[all('All pipelines'), ...(data?.pipelines ?? []).map(item => ({ value: item.id, label: item.name }))]}
      onChange={value => state.set({ pipeline: value || null })} /> : null}
    {filters.includes('owner') ? <Selector label="Owner" size="sm" width={170} value={state.filters.ownerId}
      options={[all('Anyone'), ...(data?.owners ?? []).map(item => ({ value: item.id, label: item.name }))]}
      onChange={value => state.set({ owner: value || null })} /> : null}
    {filters.includes('campaign') ? <Selector label="Campaign" size="sm" width={200} value={state.filters.campaignId}
      options={[all('All campaigns'), ...(data?.campaigns ?? []).map(item => ({ value: item.id, label: item.name }))]}
      onChange={value => state.set({ campaign: value || null })} /> : null}
    {filters.includes('source') ? <Selector label="Source" size="sm" width={170} value={state.filters.source}
      options={[all('All sources'), ...(data?.sources ?? []).map(item => ({ value: item, label: item }))]}
      onChange={value => state.set({ source: value || null })} /> : null}
    {extra}
    {custom ? <CustomRange state={state} onClose={() => setCustom(false)} /> : null}
  </div>;
}

function CustomRange({ state, onClose }: { state: InsightsState; onClose: () => void }) {
  type DateValue = NonNullable<ComponentProps<typeof DateInput>['value']>;
  const iso = (value: number) => new Date(value).toISOString().slice(0, 10) as DateValue;
  const [start, setStart] = useState(iso(state.range.startAt));
  const [end, setEnd] = useState(iso(state.range.endAt - 1));
  const [error, setError] = useState('');
  return <Modal title="Custom date range" onClose={onClose}>
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      const from = Date.parse(start);
      const to = Date.parse(end);
      if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return setError('Choose an end date on or after the start date.');
      if (to - from > 730 * DAY) return setError('Choose a range of up to two years.');
      state.set({ range: 'custom', from: start, to: end });
      onClose();
    }}>
      <div className="ov-form-grid">
        <DateInput label="Start date" value={start} onChange={value => value && setStart(value)} />
        <DateInput label="End date" value={end} onChange={value => value && setEnd(value)} />
      </div>
      <Text type="supporting" color="secondary">Days run midnight to midnight UTC. The end date is included.</Text>
      {error ? <Text color="secondary" role="alert">{error}</Text> : null}
      <FormActions>
        <Button label="Cancel" onClick={onClose} />
        <Button type="submit" variant="primary" label="Apply" />
      </FormActions>
    </form>
  </Modal>;
}

const provenanceLabel: Record<Provenance, { label: string; tone: 'neutral' | 'info' | 'warning'; help: string }> = {
  measured: { label: 'Measured', tone: 'neutral', help: 'Counted from recorded events and closed records in the period.' },
  snapshot: { label: 'Now', tone: 'neutral', help: 'The current state, not tied to the date range.' },
  estimate: { label: 'Estimate', tone: 'warning', help: 'A projection from probabilities or averages, not a measured result.' },
  model: { label: 'Model', tone: 'info', help: 'Measured revenue or leads allocated to campaigns by an attribution model.' },
};

export function ProvenanceBadge({ provenance }: { provenance: Provenance }) {
  const item = provenanceLabel[provenance];
  return <span title={item.help} className="ov-insights-provenance"><Badge label={item.label} variant={item.tone} /></span>;
}

export function Delta({ value, previous, unit, betterWhen, currency, comparisonLabel }: {
  value: number | null; previous: number | null; unit: Metric['unit']; betterWhen: Metric['betterWhen']; currency: string; comparisonLabel: string | null;
}) {
  const delta = change(value, previous, unit);
  if (!comparisonLabel) return null;
  if (!delta) return <Text type="supporting" color="secondary">No comparison value</Text>;
  const good = betterWhen === 'neutral' || delta.direction === 0 ? 'flat' : (delta.direction > 0) === (betterWhen === 'up') ? 'good' : 'bad';
  const Icon = delta.direction > 0 ? ArrowUpRight : delta.direction < 0 ? ArrowDownRight : ArrowRight;
  return <span className={`ov-insights-delta ov-insights-delta--${good}`}>
    <Icon size={14} aria-hidden="true" />
    <span>{delta.text}</span>
    <span className="ov-insights-delta-base">vs {formatValue(previous, unit, currency)} {comparisonLabel.toLowerCase()}</span>
  </span>;
}

export function KpiTile({ metric, currency, comparisonLabel, onDrill, hint }: {
  metric: Metric; currency: string; comparisonLabel: string | null; onDrill?: (params: DrillParams) => void; hint?: string;
}) {
  const ignored = metric.ignoredFilters.length ? ` Not filtered by ${metric.ignoredFilters.join(' or ')}.` : '';
  return <Card>
    <div className="ov-insights-kpi">
      <span className="ov-insights-kpi-label">
        <Text type="label" color="secondary">{metric.label}</Text>
        <InfoTip content={metric.definition + ignored} label={`How ${metric.label} is calculated`} size="sm" />
      </span>
      <span className="ov-insights-kpi-value">{formatValue(metric.value, metric.unit, currency)}</span>
      {metric.value == null && metric.unavailable ? <Text type="supporting" color="secondary">{metric.unavailable}</Text>
        : metric.provenance === 'measured' ? <Delta value={metric.value} previous={metric.previous} unit={metric.unit} betterWhen={metric.betterWhen} currency={currency} comparisonLabel={comparisonLabel} />
          : <Text type="supporting" color="secondary">{hint ?? (metric.provenance === 'snapshot' ? 'As of now' : 'Projection, not a result')}</Text>}
      <div className="ov-insights-kpi-foot">
        {metric.drill && onDrill ? <button type="button" className="ov-insights-kpi-link" onClick={() => onDrill(metric.drill!)}>View records</button> : <span />}
        <ProvenanceBadge provenance={metric.provenance} />
      </div>
    </div>
  </Card>;
}

/** A plain download link (not a client-side route, so nothing prefetches the export). */
export function ExportLink({ report, state, label = 'Export CSV', extra = '' }: { report: ReportKey | 'drill'; state: InsightsState; label?: string; extra?: string }) {
  return <a className="ov-insights-export" href={`/api/console/insights/export/${report}?${state.apiQuery}${extra}`} download>
    <Download size={15} aria-hidden="true" />{label}
  </a>;
}

/** The drawer listing the records behind a number. */
export function useDrill(state: InsightsState, extra = '') {
  const [params, setParams] = useState<DrillParams | null>(null);
  const [page, setPage] = useState(1);
  const query = params ? new URLSearchParams(Object.entries(params).filter(([, value]) => value != null && value !== '').map(([key, value]) => [key, String(value)])).toString() : '';
  const result = useResource<DrillResult>(params ? `/insights/drill?${state.apiQuery}&${query}&page=${page}${extra}` : null);
  const element = params ? <SlideDrawer title={result.data?.title ?? 'Records'} subtitle={`${state.presetLabel}${result.data ? ` · ${result.data.total.toLocaleString('en-GB')} records` : ''}`}
    onClose={() => { setParams(null); setPage(1); }} width={560}>
    {result.data ? <>
      <Text type="supporting" color="secondary">{result.data.definition}</Text>
      {result.data.rows.length ? <ul className="ov-insights-drill">
        {result.data.rows.map(row => <li key={row.id}>
          <span className="ov-cell">
            {row.href ? <Link href={row.href}>{row.title}</Link> : <Text weight="medium">{row.title}</Text>}
            <Text type="supporting" color="secondary">{row.subtitle}</Text>
          </span>
          <span className="ov-insights-drill-meta">
            {row.amount != null ? <strong>{formatMoney(row.amount, result.data!.currency)}</strong> : null}
            <Text type="supporting" color="secondary">{row.date ? formatDate(row.date) : ''}</Text>
          </span>
        </li>)}
      </ul> : <Empty title="No records behind this number" description="Nothing matches the period and filters." />}
      <Pager page={page} limit={result.data.limit} total={result.data.total} onPage={setPage} />
      {result.data.total ? <div><ExportLink report="drill" state={state} label="Export these records" extra={`&${query}${extra}`} /></div> : null}
    </> : <AsyncState loading={result.loading} error={result.error} retry={result.refresh} />}
  </SlideDrawer> : null;
  return { open: (next: DrillParams) => { setPage(1); setParams(next); }, element };
}

/** Notes shown above every report: sample data in the preview, and deals left out of money totals. */
export function DataNotes({ meta }: { meta?: InsightsMeta }) {
  const preview = usePreview();
  if (!meta) return null;
  const notes: string[] = [];
  if (preview || meta.dataset === 'preview_sample') notes.push('Sample data: every record in the developer preview is demonstration data.');
  if (meta.otherCurrencyDeals) notes.push(`${meta.otherCurrencyDeals} deal${meta.otherCurrencyDeals === 1 ? ' is' : 's are'} in another currency and left out of ${meta.currency} totals.`);
  if (!notes.length) return null;
  return <div className="ov-insights-notes" role="note">{notes.map(note => <Text key={note} type="supporting" color="secondary">{note}</Text>)}</div>;
}

export function SectionLink({ href, state, label }: { href: string; state: InsightsState; label: string }) {
  return <Link href={withQuery(href, state.pageQuery)} type="supporting">{label}</Link>;
}
