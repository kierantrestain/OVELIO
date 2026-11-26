'use client';

// The analytics detail pages: sales, marketing, attribution, funnels and the report catalogue.
import { useState } from 'react';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { Link } from '@astryxdesign/core/Link';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import type {
  AttributionModel, AttributionReport, BreakdownRow, DrillParams, FunnelsReport, InsightsSummary, MarketingReport, SalesReport,
} from '@/contracts/insights';
import { attributionModels, reportCatalogue } from '@/contracts/insights';
import { AsyncState, Empty, PageHeader, Panel } from '../ui';
import { BarList, ChartTable, FunnelBars, Legend, Meter, TrendChart } from './charts';
import { DataNotes, ExportLink, InsightsToolbar, ProvenanceBadge, SectionLink, useDrill, useInsightsState, withQuery } from './controls';
import type { InsightsState } from './controls';
import { useStable } from './engines';
import { KpiGrid, PipelineStages } from './executive';
import { formatCount, formatDays, formatMoney, formatPercent, monthLabel } from './format';

type Open = (params: DrillParams) => void;

function Loading({ resource }: { resource: { loading: boolean; error?: string; refresh: () => void } }) {
  return <AsyncState loading={resource.loading} error={resource.error} retry={resource.refresh} />;
}

function Frame({ title, description, state, actions, children, filters, extra, meta }: {
  title: string; description: string; state: InsightsState; actions?: React.ReactNode; children: React.ReactNode;
  filters?: Parameters<typeof InsightsToolbar>[0]['filters']; extra?: React.ReactNode; meta?: InsightsSummary['meta'];
}) {
  return <div className="ov-insights-root ov-wide">
    <PageHeader title={title} description={description} actions={actions} />
    <InsightsToolbar state={state} filters={filters} extra={extra} />
    <DataNotes meta={meta} />
    {children}
  </div>;
}

/* ── Sales ──────────────────────────────────────────────────────────────────── */

export function SalesAnalytics() {
  const state = useInsightsState();
  const summary = useStable<InsightsSummary>('/insights/summary?' + state.apiQuery);
  const report = useStable<SalesReport>('/insights/sales?' + state.apiQuery);
  const drill = useDrill(state);
  const [by, setBy] = useState<'owner' | 'source' | 'campaign'>('owner');
  const data = report.data;
  const cur = data?.meta.currency ?? 'GBP';
  return <Frame title="Sales analytics" description="Pipeline, revenue, win rates, stage conversion and forecast." state={state} meta={data?.meta}
    actions={<><ExportLink report="revenue-trend" state={state} label="Revenue CSV" /><ExportLink report="forecast" state={state} label="Forecast CSV" /></>}>
    {summary.data ? <KpiGrid summary={summary.data} state={state} onDrill={drill.open}
      keys={['wonRevenue', 'wonDeals', 'lostDeals', 'winRate', 'avgDealSize', 'avgSalesCycleDays', 'openPipeline', 'weightedPipeline']} /> : <Loading resource={summary} />}
    {!data ? <Loading resource={report} /> : <>
      <div className="ov-insights-split">
        <Panel title="Won revenue" description={`By ${data.revenue.interval} · ${state.presetLabel}`} action={<ProvenanceBadge provenance="measured" />}>
          <TrendChart points={data.revenue.points} interval={data.revenue.interval} label="Won revenue over time" yLabel={`Revenue (${cur})`}
            format={value => formatMoney(value, cur)} formatAxis={value => formatMoney(value, cur, true)} comparisonLabel={state.comparisonLabel} empty="No deals were won in this period" />
        </Panel>
        <Panel title="Sales velocity" description="Expected revenue per day from the current pipeline" action={<ProvenanceBadge provenance="estimate" />}>
          <div className="ov-insights-mini ov-insights-mini--labelled">
            <div><span className="ov-insights-mini-label">Per day</span><strong>{formatMoney(data.velocity.perDay, cur)}</strong><small>Estimate</small></div>
            <div><span className="ov-insights-mini-label">Per 30 days</span><strong>{formatMoney(data.velocity.perDay == null ? null : data.velocity.perDay * 30, cur)}</strong><small>Estimate</small></div>
          </div>
          <Text type="supporting" color="secondary">
            {formatCount(data.velocity.openDeals)} open deals × {formatPercent(data.velocity.winRate)} win rate × {formatMoney(data.velocity.avgDealSize, cur)} average deal ÷ {formatDays(data.velocity.cycleDays)} average cycle.
            {data.velocity.unavailable ? ` ${data.velocity.unavailable}` : ' Win rate, deal size and cycle come from deals closed in the period.'}
          </Text>
        </Panel>
      </div>
      <div className="ov-grid">
        <Panel title="Pipeline by stage" description={data.pipeline ? `${data.pipeline.name} · open deals now` : 'No pipeline'}
          action={<ExportLink report="pipeline-stages" state={state} label="CSV" />}>
          <PipelineStages report={data} onDrill={drill.open} />
        </Panel>
        <Panel title="Stage conversion" description="Deals created in the period that reached each stage" action={<ExportLink report="stage-conversion" state={state} label="CSV" />}>
          {data.conversion.length && data.conversion[0].reached ? <ChartTable head={['Stage', 'Reached', 'To next stage', 'Avg. days in stage']}
            rows={data.conversion.map(row => [row.name, <span key="r">{formatCount(row.reached)}<Meter value={row.reached} max={data.conversion[0].reached} /></span>,
              formatPercent(row.conversionToNext), formatDays(row.avgDaysInStage)])} />
            : <Empty title="No deals were created in this period" />}
        </Panel>
      </div>
      <div className="ov-grid">
        <Panel title="Win rate" description="Deals closed in the period" action={<span className="ov-actions">
          <SegmentedControl label="Break down win rate by" size="sm" value={by} onChange={value => setBy(value as typeof by)}>
            <SegmentedControlItem value="owner" label="Owner" /><SegmentedControlItem value="source" label="Source" /><SegmentedControlItem value="campaign" label="Campaign" />
          </SegmentedControl>
          <ExportLink report="win-rate" state={state} label="CSV" /></span>}>
          {data.winRate[by].length ? <ChartTable head={[by === 'owner' ? 'Owner' : by === 'source' ? 'Deal source' : 'Campaign', 'Won', 'Lost', 'Win rate', 'Won revenue']}
            rows={data.winRate[by].map(row => [row.label, formatCount(row.won), formatCount(row.lost),
              <span key="w">{formatPercent(row.winRate)}<Meter value={row.winRate ?? 0} max={1} /></span>, formatMoney(row.wonRevenue, cur)])} />
            : <Empty title="No deals were closed in this period" />}
        </Panel>
        <Panel title="Forecast by expected close month" description="Open deals now · value and weighted value" action={<span className="ov-actions"><ProvenanceBadge provenance="estimate" /></span>}>
          {data.forecast.length ? <ChartTable head={['Close month', 'Deals', 'Value', 'Weighted (estimate)']}
            rows={data.forecast.map(row => [
              <button key="m" type="button" className="ov-insights-kpi-link" onClick={() => drill.open({ metric: 'open_deals', closeMonth: row.month ?? 'none' })}>
                {monthLabel(row.month)}{row.overdue ? ' · date passed' : ''}
              </button>,
              formatCount(row.count), formatMoney(row.value, cur), formatMoney(row.weighted, cur)])} />
            : <Empty title="No open deals to forecast" />}
        </Panel>
      </div>
    </>}
    {drill.element}
  </Frame>;
}

/* ── Marketing ──────────────────────────────────────────────────────────────── */

function Breakdown({ rows, open, drill }: { rows: BreakdownRow[]; open: Open; drill: (row: BreakdownRow) => DrillParams }) {
  return <BarList rows={rows.slice(0, 8).map(row => ({ key: row.key ?? 'none', label: row.label, value: row.value, display: formatCount(row.value), onSelect: () => open(drill(row)) }))}
    empty={<Empty title="No leads in this period" />} />;
}

export function MarketingAnalytics() {
  const state = useInsightsState();
  const summary = useStable<InsightsSummary>('/insights/summary?' + state.apiQuery);
  const report = useStable<MarketingReport>('/insights/marketing?' + state.apiQuery);
  const drill = useDrill(state);
  const data = report.data;
  const cur = data?.meta.currency ?? 'GBP';
  return <Frame title="Marketing analytics" description="Leads by campaign, source, form and page, and what each campaign returned." state={state} meta={data?.meta}
    actions={<ExportLink report="campaigns" state={state} label="Campaigns CSV" />}>
    {summary.data ? <KpiGrid summary={summary.data} state={state} onDrill={drill.open} keys={['leads', 'newDeals', 'wonRevenue', 'emailsSent']} /> : <Loading resource={summary} />}
    {!data ? <Loading resource={report} /> : <>
      <Panel title="Leads over time" description={`New leads by ${data.leads.series.interval} (each contact counted once, on their first lead event)`} action={<ProvenanceBadge provenance="measured" />}>
        <TrendChart points={data.leads.series.points} interval={data.leads.series.interval} label="Leads over time" yLabel="Leads" format={value => formatCount(value)}
          formatAxis={value => formatCount(value)} comparisonLabel={state.comparisonLabel} empty="No leads in this period" />
      </Panel>
      <div className="ov-grid">
        <Panel title="Leads by campaign" action={<ExportLink report="leads-by-campaign" state={state} label="CSV" />}>
          <Breakdown rows={data.byCampaign} open={drill.open} drill={row => ({ metric: 'leads', campaign: row.key ?? 'none' })} />
        </Panel>
        <Panel title="Leads by source" description="UTM source on the lead event" action={<ExportLink report="leads-by-source" state={state} label="CSV" />}>
          <Breakdown rows={data.bySource} open={drill.open} drill={row => ({ metric: 'leads', source: row.key ?? '(none)' })} />
        </Panel>
        <Panel title="Leads by form" action={<ExportLink report="leads-by-form" state={state} label="CSV" />}>
          <Breakdown rows={data.byForm} open={drill.open} drill={row => ({ metric: 'leads', formId: row.key ?? undefined })} />
        </Panel>
        <Panel title="Leads by landing page" description="The page the form was submitted on" action={<ExportLink report="leads-by-page" state={state} label="CSV" />}>
          <Breakdown rows={data.byPage} open={drill.open} drill={row => (row.key ? { metric: 'leads', pageId: row.key } : { metric: 'leads' })} />
        </Panel>
      </div>
      <Panel title="Campaign performance" description="Leads, deals and won revenue in the period from records linked to each campaign. Budget is the campaign's total budget.">
        {data.campaigns.length ? <ChartTable head={['Campaign', 'Leads', 'Deals', 'Won', `Won revenue`, 'Budget', 'Cost per lead', 'ROI']}
          rows={data.campaigns.map(row => [
            <span key="n"><Link href={row.href}>{row.name}</Link><small>{row.status}{row.startsOn ? ` · from ${row.startsOn}` : ''}</small></span>,
            <button key="l" type="button" className="ov-insights-kpi-link" onClick={() => drill.open({ metric: 'leads', campaign: row.campaignId })}>{formatCount(row.leads)}</button>,
            formatCount(row.deals), formatCount(row.wonDeals), formatMoney(row.wonRevenue, cur),
            row.budget == null ? <span key="b" className="ov-insights-muted">Not set</span> : formatMoney(row.budget, row.currency),
            row.costPerLead == null ? <span key="c" className="ov-insights-muted" title={row.costPerLeadNote ?? ''}>n/a</span> : formatMoney(row.costPerLead, row.currency),
            row.roi == null ? <span key="r"><span className="ov-insights-muted">n/a</span><small>{row.roiNote}</small></span> : formatPercent(row.roi, 0),
          ])} />
          : <Empty title="No campaigns yet" description="Create a campaign and link its pages, forms and emails to measure its return." />}
        <Text type="supporting" color="secondary">ROI = (won revenue − budget) ÷ budget, shown only when a campaign has both a budget and won revenue in the same currency.</Text>
      </Panel>
    </>}
    {drill.element}
  </Frame>;
}

/* ── Attribution ────────────────────────────────────────────────────────────── */

const shortModel: Record<AttributionModel, string> = { first_touch: 'First', last_touch: 'Last', linear: 'Linear', position_based: '40/20/40' };

const modelColor: Record<AttributionModel, string> = {
  first_touch: 'var(--ov-insights-s1)', last_touch: 'var(--ov-insights-s2)', linear: 'var(--ov-insights-s3)', position_based: 'var(--ov-insights-s4)',
};

export function AttributionAnalytics() {
  const state = useInsightsState();
  const [model, setModel] = useState<AttributionModel>('linear');
  const [lookback, setLookback] = useState('90');
  const report = useStable<AttributionReport>(`/insights/attribution?${state.apiQuery}&lookbackDays=${lookback}`);
  const drill = useDrill(state, `&lookbackDays=${lookback}`);
  const data = report.data;
  const cur = data?.meta.currency ?? 'GBP';
  const active = attributionModels.find(item => item.key === model)!;
  const attributed = data ? data.totals.wonRevenue - data.unattributed.revenue : 0;
  const max = data ? Math.max(1, ...data.rows.flatMap(row => attributionModels.map(item => row.revenue[item.key]))) : 1;
  return <Frame title="Attribution" description="Which campaigns led to won revenue and leads, under four attribution models." state={state} meta={data?.meta}
    filters={['pipeline', 'owner', 'campaign', 'source']}
    extra={<Selector label="Lookback window" size="sm" width={170} value={lookback} onChange={value => setLookback(value ?? '90')}
      options={['30', '60', '90', '180', '365'].map(days => ({ value: days, label: `${days} days` }))} />}
    actions={<ExportLink report="attribution" state={state} extra={`&lookbackDays=${lookback}`} />}>
    <Panel title="Attribution model" description="Every model splits the same measured won revenue; only the allocation differs.">
      <SegmentedControl label="Attribution model" value={model} onChange={value => setModel(value as AttributionModel)}>
        {attributionModels.map(item => <SegmentedControlItem key={item.key} value={item.key} label={shortModel[item.key]} />)}
      </SegmentedControl>
      <div className="ov-insights-models">
        {attributionModels.map(item => <div key={item.key} className="ov-insights-model" data-active={item.key === model}>
          <Text weight="semibold"><i className="ov-insights-swatch" style={{ background: modelColor[item.key] }} aria-hidden="true" />{item.label}</Text>
          <Text type="supporting" color="secondary">{item.definition}</Text>
        </div>)}
      </div>
      {data ? <Text type="supporting" color="secondary">
        Touchpoints are {data.touchpointTypes.map(type => type.replace('.', ' ').replace('_', ' ')).join(', ')} events that carry a campaign, for any of the deal&apos;s contacts,
        in the {data.lookbackDays} days before the deal was created (for leads: before their first lead event). Credit is the won deal amount in {cur}.
      </Text> : null}
    </Panel>
    {!data ? <Loading resource={report} /> : <>
      <div className="ov-insights-kpis">
        {[
          { label: 'Won revenue', value: formatMoney(data.totals.wonRevenue, cur), note: `${formatCount(data.totals.wonDeals)} deals closed won`, provenance: 'measured' as const },
          { label: 'Attributed to campaigns', value: formatMoney(attributed, cur), note: `Allocated by ${active.label}`, provenance: 'model' as const },
          { label: 'Unattributed revenue', value: formatMoney(data.unattributed.revenue, cur), provenance: 'measured' as const,
            note: `${formatCount(data.unattributed.deals)} deals with no campaign touchpoint${data.unattributed.dealsWithDealCampaign ? ` (${data.unattributed.dealsWithDealCampaign} have a campaign set on the deal)` : ''}`,
            drill: { metric: 'unattributed_deals' } as DrillParams },
          { label: 'Leads', value: formatCount(data.totals.leads), note: `${formatCount(data.unattributed.leads)} without a campaign touchpoint`, provenance: 'measured' as const, drill: { metric: 'leads' } as DrillParams },
        ].map(tile => <Card key={tile.label}><div className="ov-insights-kpi">
          <div className="ov-insights-kpi-head"><Text type="label" color="secondary">{tile.label}</Text><ProvenanceBadge provenance={tile.provenance} /></div>
          <span className="ov-insights-kpi-value">{tile.value}</span>
          <Text type="supporting" color="secondary">{tile.note}</Text>
          {tile.drill ? <button type="button" className="ov-insights-kpi-link" onClick={() => drill.open(tile.drill!)}>View records</button> : null}
        </div></Card>)}
      </div>
      <div className="ov-insights-split">
        <Panel title={`Revenue by campaign · ${active.label}`} description="Model allocation of measured won revenue" action={<ProvenanceBadge provenance="model" />}>
          <BarList rows={data.rows.filter(row => row.revenue[model] > 0).map(row => ({
            key: row.campaignId, label: row.name, value: row.revenue[model], display: formatMoney(row.revenue[model], cur),
            detail: `${formatCount(row.deals[model], 2)} deals credited · ${formatCount(row.touchpoints)} touchpoints`,
            onSelect: () => drill.open({ metric: 'attributed_deals', campaign: row.campaignId }),
          }))} empty={<Empty title="No won revenue could be attributed in this period" description="Won deals need a contact with campaign touchpoints before the deal was created." />} />
        </Panel>
        <Panel title={`Leads by campaign · ${active.label}`} description="Each lead split across the campaigns that touched them" action={<ProvenanceBadge provenance="model" />}>
          <BarList rows={data.rows.filter(row => row.leads[model] > 0).sort((a, b) => b.leads[model] - a.leads[model]).map(row => ({
            key: row.campaignId, label: row.name, value: row.leads[model], display: formatCount(row.leads[model], 1),
          }))} empty={<Empty title="No leads could be attributed in this period" />} />
        </Panel>
      </div>
      <Panel title="Models side by side" description={`Revenue credited to each campaign (${cur}). Columns add up to the attributed total; unattributed revenue is listed separately.`}>
        <Legend items={attributionModels.map(item => ({ label: item.label, kind: 'bar', color: modelColor[item.key] }))} />
        <ChartTable head={['Campaign', ...attributionModels.map(item => item.label)]}
          rows={[
            ...data.rows.map(row => [<Link key="n" href={row.href}>{row.name}</Link>,
              ...attributionModels.map(item => <span key={item.key}>{formatMoney(row.revenue[item.key], cur)}<Meter value={row.revenue[item.key]} max={max} color={modelColor[item.key]} /></span>)]),
            ['Unattributed', ...attributionModels.map(() => formatMoney(data.unattributed.revenue, cur))],
            [<strong key="t">Total won revenue</strong>, ...attributionModels.map(item => <strong key={item.key}>{formatMoney(data.totals.wonRevenue, cur)}</strong>)],
          ]} />
      </Panel>
    </>}
    {drill.element}
  </Frame>;
}

/* ── Funnels ────────────────────────────────────────────────────────────────── */

export function FunnelAnalytics() {
  const state = useInsightsState();
  const report = useStable<FunnelsReport>('/insights/funnels?' + state.apiQuery);
  const drill = useDrill(state);
  const data = report.data;
  return <Frame title="Funnels" description="Conversion through OVELIO funnels, landing pages and from lead to revenue." state={state} meta={data?.meta}
    filters={['campaign', 'source']}
    actions={<><ExportLink report="funnels" state={state} label="Funnels CSV" /><ExportLink report="page-conversion" state={state} label="Pages CSV" /></>}>
    {!data ? <Loading resource={report} /> : <>
      <div className="ov-grid">
        <Panel title={data.lifecycle.name} description={data.lifecycle.definition} action={<ProvenanceBadge provenance="measured" />}>
          <FunnelBars steps={data.lifecycle.steps} onSelect={index => data.lifecycle.steps[index].drill && drill.open(data.lifecycle.steps[index].drill!)} />
        </Panel>
        <Panel title="Landing page conversion" description="Visitors who viewed a page, and how many of them submitted a form on it">
          {data.pages.length ? <ChartTable head={['Page', 'Viewers', 'Submitted', 'Conversion']} rows={data.pages.map(row => [
            <span key="p"><Link href={row.href}>{row.label}</Link></span>,
            <button key="v" type="button" className="ov-insights-kpi-link" onClick={() => drill.open({ metric: 'page_views', pageId: row.pageId })}>{formatCount(row.viewers)}</button>,
            <button key="c" type="button" className="ov-insights-kpi-link" onClick={() => drill.open({ metric: 'leads', pageId: row.pageId })}>{formatCount(row.converters)}</button>,
            <span key="r">{formatPercent(row.conversion)}<Meter value={row.conversion ?? 0} max={1} /></span>,
          ])} /> : <Empty title="No landing page views in this period" description="Published OVELIO pages record a view for every visit." />}
        </Panel>
      </div>
      {data.funnels.length ? data.funnels.map(funnel => <Panel key={funnel.id} title={funnel.name} description={funnel.definition}
        action={funnel.href ? <Link href={funnel.href} type="supporting">Edit funnel</Link> : undefined}>
        <FunnelBars steps={funnel.steps} onSelect={index => funnel.steps[index].drill && drill.open(funnel.steps[index].drill!)} />
      </Panel>) : <Panel title="OVELIO funnels"><Empty title="No funnel visits in this period" description="Multi-step funnels built in Sites & Forms report each step here." /></Panel>}
      <Panel title="Website funnels" description="Path and event funnels measured by website analytics live with the website reports.">
        <span><Link href="/analytics/website?tab=Goals+%26+Funnels">Open website funnels</Link></span>
      </Panel>
    </>}
    {drill.element}
  </Frame>;
}

/* ── Report catalogue ───────────────────────────────────────────────────────── */

export function ReportCatalogue() {
  const state = useInsightsState();
  const groups = [...new Set(reportCatalogue.map(item => item.group))];
  return <Frame title="Reports" description="Every analytics report, with the current date range and filters applied to its page and CSV export." state={state}>
    {groups.map(group => <section key={group} className="ov-stack-sm" aria-label={group}>
      <Heading level={2} className="ov-panel-title">{group}</Heading>
      <div className="ov-insights-catalogue">
        {reportCatalogue.filter(item => item.group === group).map(item => <Card key={item.key}>
          <div className="ov-insights-report">
            <div className="ov-stack-sm" style={{ gap: 6 }}>
              <div className="ov-insights-kpi-head"><Text weight="semibold">{item.name}</Text><ProvenanceBadge provenance={item.provenance} /></div>
              <Text type="supporting" color="secondary">{item.description}</Text>
            </div>
            <div className="ov-actions">
              <Link href={withQuery(item.href, state.pageQuery)}>Open report</Link>
              <ExportLink report={item.key} state={state} label="Download CSV" />
            </div>
          </div>
        </Card>)}
      </div>
    </section>)}
    <Text type="supporting" color="secondary">Website traffic reports have their own exports in <SectionLink href="/analytics/website" state={state} label="Website analytics" />.</Text>
  </Frame>;
}
