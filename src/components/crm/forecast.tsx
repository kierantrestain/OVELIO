'use client';

// Sales › Forecast: weighted pipeline, best case and committed (estimates) against closed won (measured), by month
// and by owner, with drill-down to the deals behind each row.
import '@/styles/crm.css';
import NextLink from 'next/link';
import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Selector } from '@astryxdesign/core/Selector';
import { Table } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import type { Deal, Forecast, ForecastRow, Pipeline } from '@/contracts/crm';
import { useResource } from '../client';
import { AsyncState, Empty, Metric, PageHeader, Panel, SlideDrawer, StatusBadge } from '../ui';
import { Estimate, OwnerChip, money, shortDate, statusLabel, statusTone } from './common';

const pad = (value: number) => String(value).padStart(2, '0');
function periodStart(period: string) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  if (period === 'this_quarter') return { from: `${year}-${pad(Math.floor(month / 3) * 3 + 1)}`, months: 3 };
  if (period === 'next_quarter') {
    const start = new Date(year, Math.floor(month / 3) * 3 + 3, 1);
    return { from: `${start.getFullYear()}-${pad(start.getMonth() + 1)}`, months: 3 };
  }
  if (period === 'last_6') {
    const start = new Date(year, month - 5, 1);
    return { from: `${start.getFullYear()}-${pad(start.getMonth() + 1)}`, months: 6 };
  }
  return { from: `${year}-${pad(month + 1)}`, months: period === 'next_12' ? 12 : 6 };
}

function Bar({ row, max }: { row: ForecastRow; max: number }) {
  return <div className="ov-crm-bar" role="img" aria-label={`Closed won ${row.closedWon}, weighted open ${row.weighted}`}>
    <span style={{ width: `${(row.closedWon / max) * 100}%` }} />
    <span style={{ width: `${(row.weighted / max) * 100}%` }} />
  </div>;
}

export function SalesForecast() {
  const pipelines = useResource<{ items: Pipeline[] }>('/sales/pipelines');
  const [pipelineId, setPipelineId] = useState('');
  const [period, setPeriod] = useState('next_6');
  const [threshold, setThreshold] = useState(75);
  const [currency, setCurrency] = useState('');
  const [drill, setDrill] = useState<{ title: string; from: string; to: string; ownerId?: string } | null>(null);
  const range = periodStart(period);
  const params = new URLSearchParams({ from: range.from, months: String(range.months), threshold: String(threshold) });
  if (pipelineId) params.set('pipelineId', pipelineId);
  if (currency) params.set('currency', currency);
  const forecast = useResource<Forecast>(`/sales/forecast?${params}`);
  const data = forecast.data;
  const max = Math.max(1, ...(data?.months ?? []).map(row => row.closedWon + row.weighted), ...(data?.owners ?? []).map(row => row.closedWon + row.weighted));
  const cur = data?.currency ?? 'GBP';
  const drillParams = drill && data ? new URLSearchParams({ from: drill.from, to: drill.to, currency: cur, pipelineId: data.pipelineId ?? 'all', ...(drill.ownerId ? { ownerId: drill.ownerId } : {}) }) : null;
  const deals = useResource<Deal[]>(drillParams ? `/sales/forecast/deals?${drillParams}` : null);
  const columns = (kind: 'month' | 'owner') => [
    { key: 'label', header: kind === 'month' ? 'Expected close' : 'Owner', renderCell: (row: ForecastRow) => <Button variant="ghost" size="sm" label={row.label}
      onClick={() => data && setDrill(kind === 'month'
        ? { title: row.label, from: `${row.key}-01`, to: new Date(Date.UTC(Number(row.key.slice(0, 4)), Number(row.key.slice(5, 7)), 0)).toISOString().slice(0, 10) }
        : { title: row.label, from: data.from, to: data.to, ownerId: row.key })} /> },
    { key: 'closedWon', header: 'Closed won', renderCell: (row: ForecastRow) => <span className="ov-cell"><Text weight="medium">{money(row.closedWon, cur)}</Text><Text type="supporting" color="secondary">{row.wonCount} won · {row.lostCount} lost</Text></span> },
    { key: 'weighted', header: 'Weighted (estimate)', renderCell: (row: ForecastRow) => money(row.weighted, cur) },
    { key: 'committed', header: `Committed ≥ ${data?.threshold ?? threshold}%`, renderCell: (row: ForecastRow) => money(row.committed, cur) },
    { key: 'bestCase', header: 'Best case', renderCell: (row: ForecastRow) => <span className="ov-cell"><span>{money(row.bestCase, cur)}</span><Text type="supporting" color="secondary">{row.openCount} open</Text></span> },
    { key: 'bar', header: 'Won vs weighted', renderCell: (row: ForecastRow) => <Bar row={row} max={max} /> },
  ];

  return <div className="ov-stack">
    <PageHeader title="Forecast" description="Expected revenue from open deals, set against what has actually closed."
      actions={<>
        <Selector label="Pipeline" isLabelHidden width={200} value={pipelineId || 'default'} onChange={value => setPipelineId(value === 'default' ? '' : value ?? '')}
          options={[{ value: 'default', label: 'Default pipeline' }, { value: 'all', label: 'All pipelines' }, ...(pipelines.data?.items ?? []).filter(item => !item.isDefault).map(item => ({ value: item.id, label: item.name }))]} />
        <Selector label="Period" isLabelHidden width={190} value={period} onChange={value => setPeriod(value ?? 'next_6')} options={[
          { value: 'this_quarter', label: 'This quarter' }, { value: 'next_quarter', label: 'Next quarter' }, { value: 'next_6', label: 'Next 6 months' },
          { value: 'next_12', label: 'Next 12 months' }, { value: 'last_6', label: 'Last 6 months' },
        ]} />
        {data && data.currencies.length > 1 ? <Selector label="Currency" isLabelHidden width={110} value={cur} onChange={value => setCurrency(value ?? '')}
          options={data.currencies.map(item => ({ value: item, label: item }))} /> : null}
         <NumberInput label="Commit threshold %" isLabelHidden width={150} min={0} max={100} isIntegerOnly units="% commit" value={threshold} onChange={value => setThreshold(value ?? 75)} />
      </>} />
    {!data ? <Panel><AsyncState loading={forecast.loading} error={forecast.error} retry={forecast.refresh} /></Panel> : <>
      <Text color="secondary">{shortDate(data.from)} – {shortDate(data.to)} · {cur}. Weighted, committed and best case are <Estimate>estimates</Estimate> from open deals’ values and probabilities; closed won is measured from deals marked won.</Text>
      <div className="ov-crm-metrics">
        <Metric label="Weighted pipeline" formatted={money(data.totals.weighted, cur)} hint="Estimate · value × probability" info="Each open deal's value multiplied by its win probability (the deal's own, or its stage's)." />
        <Metric label="Committed" formatted={money(data.totals.committed, cur)} hint={`Estimate · deals at ≥ ${data.threshold}%`} />
        <Metric label="Best case" formatted={money(data.totals.bestCase, cur)} hint={`Estimate · all ${data.totals.openCount} open deals`} />
        <Metric label="Closed won" formatted={money(data.totals.closedWon, cur)} hint={`Measured · ${data.totals.wonCount} deals`} />
        <Metric label="Win rate" formatted={data.totals.winRate == null ? '—' : `${Math.round(data.totals.winRate)}%`} hint={data.totals.winRate == null ? 'No deals closed in this period' : `${data.totals.wonCount} won of ${data.totals.wonCount + data.totals.lostCount} closed`} />
        <Metric label="Average deal size" formatted={money(data.totals.averageDealSize, cur)} hint="Won deals" />
        <Metric label="Average sales cycle" formatted={data.totals.averageCycleDays == null ? '—' : `${data.totals.averageCycleDays} days`} hint="Created to won" />
      </div>
      <Panel title="By expected close month" description="Open deals by expected close date; won deals by the date they closed. Select a month to see its deals."
        action={<div className="ov-crm-legend"><span><i style={{ background: '#1d7a45' }} />Closed won</span><span><i style={{ background: 'var(--ov-chart)' }} />Weighted open</span></div>}>
        <Table data={data.months} idKey="key" columns={columns('month')} />
      </Panel>
      <Panel title="By owner">
        {data.owners.length ? <Table data={data.owners} idKey="key" columns={columns('owner')} /> : <Empty title="No deals close in this period" description="Set expected close dates on open deals to forecast them." />}
      </Panel>
    </>}
    {drill ? <SlideDrawer title={`Deals · ${drill.title}`} subtitle={`${shortDate(drill.from)} – ${shortDate(drill.to)}`} onClose={() => setDrill(null)} width={620}>
      {!deals.data ? <AsyncState loading={deals.loading} error={deals.error} retry={deals.refresh} /> : deals.data.length ? <ul className="ov-rows">
        {deals.data.map(deal => <li key={deal.id}>
          <span><NextLink href={`/sales/deals/${deal.id}`}><Text weight="medium">{deal.name}</Text></NextLink>
            <Text type="supporting" color="secondary">{deal.stageName} · {deal.status === 'open' ? `closes ${shortDate(deal.expectedCloseDate)} · ${deal.effectiveProbability}%` : `closed ${shortDate(deal.closedAt)}`}</Text>
            <OwnerChip name={deal.ownerName} /></span>
          <span className="ov-cell" style={{ textAlign: 'right' }}><Text weight="medium">{money(deal.amount, deal.currency)}</Text>
            <StatusBadge label={statusLabel[deal.status]} tone={statusTone[deal.status]} /></span>
        </li>)}
      </ul> : <Empty title="No deals in this cell" />}
    </SlideDrawer> : null}
  </div>;
}
