'use client';

import { Link } from '@astryxdesign/core/Link';
import { Text } from '@astryxdesign/core/Text';
import type { InsightsSummary, MarketingReport, SalesReport, SummaryMetricKey } from '@/contracts/insights';
import { AsyncState, Empty, PageHeader, Panel } from '../ui';
import { BarList, ChartTable, TrendChart } from './charts';
import { DataNotes, ExportLink, InsightsToolbar, KpiTile, ProvenanceBadge, SectionLink, useDrill, useInsightsState } from './controls';
import { EmailPerformance, WebsiteSummary, useStable } from './engines';
import { formatCount, formatMoney, formatPercent } from './format';

const executiveKpis: SummaryMetricKey[] = ['wonRevenue', 'leads', 'newDeals', 'winRate', 'avgDealSize', 'avgSalesCycleDays', 'openPipeline', 'weightedPipeline', 'emailsSent', 'tasksOverdue'];

export function KpiGrid({ summary, keys, state, onDrill }: {
  summary: InsightsSummary; keys: SummaryMetricKey[]; state: ReturnType<typeof useInsightsState>; onDrill: ReturnType<typeof useDrill>['open'];
}) {
  const cur = summary.meta.currency;
  return <div className="ov-insights-kpis">
    {keys.map(key => <KpiTile key={key} metric={summary.metrics[key]} currency={cur} comparisonLabel={state.comparisonLabel} onDrill={onDrill}
      hint={key === 'newDeals' ? `${formatMoney(summary.metrics.newDealValue.value, cur)} created` : undefined} />)}
  </div>;
}

export function PipelineStages({ report, onDrill }: { report: SalesReport; onDrill: ReturnType<typeof useDrill>['open'] }) {
  const cur = report.meta.currency;
  const open = report.stages.filter(stage => stage.outcome === 'open');
  const won = report.stages.find(stage => stage.outcome === 'won');
  const lost = report.stages.find(stage => stage.outcome === 'lost');
  return <div className="ov-stack-sm">
    <BarList legend={{ outer: 'Deal value (now)', inner: 'Weighted value (estimate)' }}
      empty={<Empty title="No open deals" description="Deals you add in Sales appear here by stage." />}
      rows={open.filter(stage => stage.count).map(stage => ({
        key: stage.stageId, label: stage.name, value: stage.value, inner: stage.weighted,
        detail: `${formatCount(stage.count)} deal${stage.count === 1 ? '' : 's'} · ${stage.probability}% probability`,
        display: `${formatMoney(stage.value, cur, true)} · ${formatMoney(stage.weighted, cur, true)}`,
        onSelect: () => onDrill({ metric: 'open_deals', stageId: stage.stageId }),
      }))} />
    <Text type="supporting" color="secondary">
      In this period: {formatCount(won?.count ?? 0)} won ({formatMoney(won?.value ?? 0, cur)}) · {formatCount(lost?.count ?? 0)} lost
    </Text>
  </div>;
}

export function CampaignLeaderboard({ report, limit = 5 }: { report: MarketingReport; limit?: number }) {
  const cur = report.meta.currency;
  const rows = [...report.campaigns].filter(row => row.leads || row.deals || row.wonRevenue)
    .sort((a, b) => b.wonRevenue - a.wonRevenue || b.leads - a.leads).slice(0, limit);
  if (!rows.length) return <Empty title="No campaign activity in this period" description="Leads and deals linked to a campaign appear here." />;
  return <ChartTable head={['Campaign', 'Leads', 'Deals', `Won revenue`, 'ROI']} rows={rows.map(row => [
    <Link key="name" href={row.href}>{row.name}</Link>,
    formatCount(row.leads), formatCount(row.deals), formatMoney(row.wonRevenue, cur),
    row.roi == null ? <span key="roi" title={row.roiNote ?? ''} className="ov-insights-muted">n/a</span> : formatPercent(row.roi, 0),
  ])} />;
}

export function ExecutiveAnalytics() {
  const state = useInsightsState();
  const summary = useStable<InsightsSummary>('/insights/summary?' + state.apiQuery);
  const sales = useStable<SalesReport>('/insights/sales?' + state.apiQuery);
  const marketing = useStable<MarketingReport>('/insights/marketing?' + state.apiQuery);
  const drill = useDrill(state);
  const cur = summary.data?.meta.currency ?? 'GBP';
  const loading = <AsyncState loading error={undefined} />;
  return <div className="ov-insights-root ov-wide">
    <PageHeader title="Executive analytics" description="Revenue, pipeline, leads, email and website performance in one view. Every number links to the records behind it."
      actions={<ExportLink report="summary" state={state} label="Export KPIs" />} />
    <InsightsToolbar state={state} />
    <DataNotes meta={summary.data?.meta} />
    {summary.error ? <AsyncState loading={false} error={summary.error} retry={summary.refresh} /> : null}
    <div className={summary.stale ? 'ov-insights-stale' : undefined}>
      {summary.data ? <KpiGrid summary={summary.data} keys={executiveKpis} state={state} onDrill={drill.open} /> : loading}
    </div>
    <div className="ov-insights-split">
      <Panel title="Won revenue" description={`Deals closed won, by ${sales.data?.revenue.interval ?? 'period'} · ${state.presetLabel}`}
        action={<span className="ov-actions"><ProvenanceBadge provenance="measured" /><SectionLink href="/analytics/sales" state={state} label="Sales report" /></span>}>
        {sales.data ? <TrendChart points={sales.data.revenue.points} interval={sales.data.revenue.interval} label="Won revenue over time"
          yLabel={`Revenue (${cur})`} format={value => formatMoney(value, cur)} formatAxis={value => formatMoney(value, cur, true)}
          comparisonLabel={state.comparisonLabel} empty="No deals were won in this period" /> : <AsyncState loading={sales.loading} error={sales.error} retry={sales.refresh} />}
      </Panel>
      <Panel title="Pipeline by stage" description={sales.data?.pipeline ? `${sales.data.pipeline.name} · open deals now` : 'Open deals now'}
        action={<SectionLink href="/analytics/sales" state={state} label="Details" />}>
        {sales.data ? <PipelineStages report={sales.data} onDrill={drill.open} /> : <AsyncState loading={sales.loading} error={sales.error} />}
      </Panel>
    </div>
    <div className="ov-grid">
      <Panel title="Lead sources" description="Leads by UTM source" action={<SectionLink href="/analytics/marketing" state={state} label="Marketing report" />}>
        {marketing.data ? <BarList rows={marketing.data.bySource.slice(0, 7).map(row => ({
          key: row.key ?? 'none', label: row.label, value: row.value, display: formatCount(row.value),
          onSelect: () => drill.open({ metric: 'leads', source: row.key ?? '(none)' }),
        }))} empty={<Empty title="No leads in this period" description="Form submissions and new contacts appear here." />} />
          : <AsyncState loading={marketing.loading} error={marketing.error} retry={marketing.refresh} />}
      </Panel>
      <Panel title="Campaign leaderboard" description="Top campaigns by won revenue, then leads" action={<SectionLink href="/analytics/attribution" state={state} label="Attribution" />}>
        {marketing.data ? <CampaignLeaderboard report={marketing.data} /> : <AsyncState loading={marketing.loading} error={marketing.error} />}
      </Panel>
    </div>
    <div className="ov-grid">
      <Panel title="Email performance" description="Newsletters by send date, measured by the email engine" action={<SectionLink href="/marketing/emails" state={state} label="Emails" />}>
        <EmailPerformance range={state.range} ovelioSent={summary.data?.metrics.emailsSent.value ?? null} />
      </Panel>
      <Panel title="Website" description="Visitors and top sources, measured by website analytics" action={<SectionLink href="/analytics/website" state={state} label="Website analytics" />}>
        <WebsiteSummary range={state.range} compare={state.compare} />
      </Panel>
    </div>
    {drill.element}
  </div>;
}
