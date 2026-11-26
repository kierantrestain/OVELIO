// OVELIO 2.0 Analytics & BI (lane 5). Every number the insights API returns names where it comes from (`provenance`)
// and how it is computed (`definition`), so a screen can label measured data, snapshots, estimates and model
// allocations, and explain each number in a tooltip.
import type { DateRange } from './common';

/**
 * measured: counted from recorded events or closed records in the period.
 * snapshot: the state right now (open pipeline, overdue tasks); not tied to the period.
 * estimate: a projection from probabilities or averages (weighted pipeline, forecast, velocity).
 * model: an allocation of measured revenue or leads by an attribution model.
 */
export type Provenance = 'measured' | 'snapshot' | 'estimate' | 'model';

export type ComparisonMode = 'none' | 'previous' | 'year';
export type Interval = 'day' | 'week' | 'month';
export type FilterKey = 'pipeline' | 'owner' | 'campaign' | 'source';
export type InsightsFilters = { pipelineId?: string; ownerId?: string; campaignId?: string; source?: string };

/** `live` in a real workspace, `preview_sample` in the developer preview (all records are labelled sample data). */
export type Dataset = 'live' | 'preview_sample';

export type InsightsMeta = {
  range: DateRange;
  comparison: { mode: Exclude<ComparisonMode, 'none'>; range: DateRange } | null;
  filters: InsightsFilters;
  /** Money is summed in one currency only; deals in other currencies are counted in `otherCurrencyDeals`. */
  currency: string;
  otherCurrencyDeals: number;
  dataset: Dataset;
  generatedAt: string;
};

export type MetricUnit = 'count' | 'currency' | 'ratio' | 'days';

export type DrillMetric =
  | 'leads' | 'new_deals' | 'open_deals' | 'won_deals' | 'lost_deals' | 'emails_sent' | 'overdue_tasks'
  | 'attributed_deals' | 'unattributed_deals' | 'funnel_step' | 'page_views';

/** Extra narrowing a drill-down accepts on top of the page filters. */
export type DrillParams = {
  metric: DrillMetric;
  stageId?: string;
  /** Expected close month `YYYY-MM`, or `none` for open deals without a close date. */
  closeMonth?: string;
  formId?: string;
  pageId?: string;
  funnelId?: string;
  step?: number;
  /** `none` narrows to records without a campaign; otherwise overrides the campaign filter. */
  campaign?: string;
  /** `(none)` narrows to records without a source; otherwise overrides the source filter. */
  source?: string;
  owner?: string;
};

export type Metric = {
  key: SummaryMetricKey;
  label: string;
  value: number | null;
  previous: number | null;
  unit: MetricUnit;
  provenance: Provenance;
  /** Plain-language description of the query behind the number. */
  definition: string;
  /** Page filters this number cannot honour (e.g. a pipeline filter on leads). */
  ignoredFilters: FilterKey[];
  /** Whether a rise is good news, for colouring the change. */
  betterWhen: 'up' | 'down' | 'neutral';
  drill: DrillParams | null;
  /** Why the value is missing, when it is. */
  unavailable?: string;
};

export type SummaryMetricKey =
  | 'leads' | 'newDeals' | 'newDealValue' | 'openPipeline' | 'weightedPipeline' | 'wonRevenue' | 'wonDeals'
  | 'lostDeals' | 'winRate' | 'avgDealSize' | 'avgSalesCycleDays' | 'emailsSent' | 'tasksOverdue';

export type InsightsSummary = { meta: InsightsMeta; metrics: Record<SummaryMetricKey, Metric> };

export type SeriesPoint = {
  /** ISO date of the bucket start (UTC). */
  start: string;
  value: number;
  count: number;
  /** The aligned bucket of the comparison period, when one is selected. */
  previous: number | null;
};
export type Series = { interval: Interval; points: SeriesPoint[] };

export type StageRow = {
  stageId: string;
  name: string;
  position: number;
  outcome: 'open' | 'won' | 'lost';
  probability: number;
  /** Open stages: open deals now (snapshot). Won and lost stages: deals closed in the period. */
  count: number;
  value: number;
  /** Open stages only: value × probability (estimate). */
  weighted: number | null;
};

export type WinRateRow = { key: string | null; label: string; won: number; lost: number; winRate: number | null; wonRevenue: number };

export type ConversionRow = {
  stageId: string;
  name: string;
  /** Deals created in the period that reached this stage or a later one. */
  reached: number;
  conversionToNext: number | null;
  /** Average days a deal stayed in this stage before moving on (completed stays only). */
  avgDaysInStage: number | null;
};

export type ForecastRow = {
  /** `YYYY-MM`, or null for open deals without an expected close date. */
  month: string | null;
  count: number;
  value: number;
  weighted: number;
  /** The expected close month has already passed and the deal is still open. */
  overdue: boolean;
};

export type Velocity = {
  openDeals: number;
  winRate: number | null;
  avgDealSize: number | null;
  cycleDays: number | null;
  /** Expected revenue per day = open deals × win rate × average deal size ÷ cycle days (estimate). */
  perDay: number | null;
  unavailable?: string;
};

export type SalesReport = {
  meta: InsightsMeta;
  pipeline: { id: string; name: string; currency: string } | null;
  stages: StageRow[];
  revenue: Series;
  winRate: { owner: WinRateRow[]; source: WinRateRow[]; campaign: WinRateRow[] };
  velocity: Velocity;
  conversion: ConversionRow[];
  forecast: ForecastRow[];
};

export type BreakdownRow = { key: string | null; label: string; value: number; href: string | null };

export type CampaignRow = {
  campaignId: string;
  name: string;
  status: string;
  startsOn: string | null;
  endsOn: string | null;
  utmCampaign: string;
  leads: number;
  deals: number;
  wonDeals: number;
  wonRevenue: number;
  budget: number | null;
  currency: string;
  costPerLead: number | null;
  costPerLeadNote: string | null;
  roi: number | null;
  roiNote: string | null;
  href: string;
};

export type MarketingReport = {
  meta: InsightsMeta;
  leads: { total: number; previous: number | null; series: Series };
  byCampaign: BreakdownRow[];
  bySource: BreakdownRow[];
  byForm: BreakdownRow[];
  byPage: BreakdownRow[];
  campaigns: CampaignRow[];
};

export type AttributionModel = 'first_touch' | 'last_touch' | 'linear' | 'position_based';
export const attributionModels: { key: AttributionModel; label: string; definition: string }[] = [
  { key: 'first_touch', label: 'First touch', definition: 'All credit goes to the first campaign the contact interacted with in the lookback window.' },
  { key: 'last_touch', label: 'Last touch', definition: 'All credit goes to the last campaign interaction before the deal was created (or the lead converted).' },
  { key: 'linear', label: 'Linear', definition: 'Credit is split equally across every campaign interaction in the lookback window.' },
  { key: 'position_based', label: 'Position-based (40/20/40)', definition: '40% to the first interaction, 40% to the last, and the remaining 20% shared equally by the interactions in between. With two interactions each gets 50%; with one it gets 100%.' },
];

export type AttributionRow = {
  campaignId: string;
  name: string;
  href: string;
  revenue: Record<AttributionModel, number>;
  /** Share of won deals credited (fractional under multi-touch models). */
  deals: Record<AttributionModel, number>;
  leads: Record<AttributionModel, number>;
  /** Touchpoints recorded for this campaign on attributed deals. */
  touchpoints: number;
};

export type AttributionReport = {
  meta: InsightsMeta;
  lookbackDays: number;
  touchpointTypes: string[];
  totals: { wonRevenue: number; wonDeals: number; leads: number };
  unattributed: { revenue: number; deals: number; leads: number; dealsWithDealCampaign: number };
  rows: AttributionRow[];
};

export type FunnelStep = {
  index: number;
  label: string;
  visitors: number;
  /** Share of the first step's visitors who reached this step. */
  conversionFromStart: number | null;
  conversionFromPrevious: number | null;
  /** Share of the previous step's visitors who did not reach this step. */
  abandonment: number | null;
  drill: DrillParams | null;
};

export type FunnelResult = { id: string; name: string; kind: 'lifecycle' | 'funnel'; steps: FunnelStep[]; href: string | null; definition: string };

export type PageConversionRow = { pageId: string; label: string; viewers: number; converters: number; conversion: number | null; href: string };

export type FunnelsReport = { meta: InsightsMeta; lifecycle: FunnelResult; funnels: FunnelResult[]; pages: PageConversionRow[] };

export type DrillRow = {
  id: string;
  title: string;
  subtitle: string;
  href: string | null;
  date: string | null;
  amount: number | null;
  status: string | null;
};

export type DrillResult = {
  title: string;
  kind: 'deals' | 'contacts' | 'tasks' | 'messages' | 'events';
  definition: string;
  currency: string;
  rows: DrillRow[];
  total: number;
  page: number;
  limit: number;
};

export type InsightsOptions = {
  pipelines: { id: string; name: string; currency: string; isDefault: boolean }[];
  owners: { id: string; name: string }[];
  campaigns: { id: string; name: string; status: string }[];
  sources: string[];
  defaultCurrency: string;
  dataset: Dataset;
};

export type HomeTask = {
  id: string; title: string; type: string; priority: string; dueAt: string | null; overdue: boolean;
  related: { label: string; href: string } | null;
};

export type OnboardingStep = {
  key: 'website' | 'contacts' | 'deals' | 'email' | 'page' | 'workflow';
  label: string;
  description: string;
  /** null when the workspace state could not be checked (an engine is unreachable). */
  done: boolean | null;
  href: string;
  action: string;
};

export type HomeData = {
  dataset: Dataset;
  currency: string;
  today: {
    leads: number; leadsYesterday: number; newDeals: number; newDealValue: number; wonRevenue: number; wonDeals: number;
    tasksDue: number; tasksOverdue: number;
  };
  myTasks: { overdue: HomeTask[]; today: HomeTask[]; overdueTotal: number; todayTotal: number };
  pipeline: { name: string | null; openDeals: number; openValue: number; weighted: number; stages: { name: string; count: number; value: number }[] };
  recentLeads: { contactId: number; name: string; email: string; at: string; source: string; campaign: { id: string; name: string } | null; href: string }[];
  campaignsInFlight: { id: string; name: string; status: string; endsOn: string | null; leads: number; wonRevenue: number; href: string }[];
  ovelioEmails: { sent7d: number; sentPrevious7d: number; notSent7d: number };
  onboarding: OnboardingStep[];
};

/** The report catalogue: each report has a page, an API path and a CSV export. */
export type ReportKey =
  | 'summary' | 'pipeline-stages' | 'revenue-trend' | 'win-rate' | 'stage-conversion' | 'forecast'
  | 'leads-by-campaign' | 'leads-by-source' | 'leads-by-form' | 'leads-by-page' | 'campaigns' | 'attribution' | 'funnels' | 'page-conversion';

export const reportCatalogue: { key: ReportKey; name: string; group: 'Sales' | 'Marketing' | 'Attribution' | 'Funnels' | 'Overview'; description: string; href: string; provenance: Provenance }[] = [
  { key: 'summary', name: 'KPI summary', group: 'Overview', description: 'Leads, deals, revenue, win rate, cycle time, OVELIO email sends and overdue tasks, with the comparison period.', href: '/analytics', provenance: 'measured' },
  { key: 'pipeline-stages', name: 'Pipeline by stage', group: 'Sales', description: 'Open deals, value and weighted value per stage, with deals won and lost in the period.', href: '/analytics/sales', provenance: 'snapshot' },
  { key: 'revenue-trend', name: 'Won revenue over time', group: 'Sales', description: 'Revenue from deals closed won, per day, week or month.', href: '/analytics/sales', provenance: 'measured' },
  { key: 'win-rate', name: 'Win rate breakdown', group: 'Sales', description: 'Won, lost and win rate by owner, deal source and campaign.', href: '/analytics/sales', provenance: 'measured' },
  { key: 'stage-conversion', name: 'Stage conversion', group: 'Sales', description: 'How many deals created in the period reached each stage, and how long they stayed.', href: '/analytics/sales', provenance: 'measured' },
  { key: 'forecast', name: 'Forecast by close month', group: 'Sales', description: 'Open deal value and weighted value by expected close month.', href: '/analytics/sales', provenance: 'estimate' },
  { key: 'leads-by-campaign', name: 'Leads by campaign', group: 'Marketing', description: 'Distinct contacts who became leads, by the campaign on their lead event.', href: '/analytics/marketing', provenance: 'measured' },
  { key: 'leads-by-source', name: 'Leads by source', group: 'Marketing', description: 'Leads by UTM source.', href: '/analytics/marketing', provenance: 'measured' },
  { key: 'leads-by-form', name: 'Leads by form', group: 'Marketing', description: 'Form submissions from distinct contacts, by form.', href: '/analytics/marketing', provenance: 'measured' },
  { key: 'leads-by-page', name: 'Leads by landing page', group: 'Marketing', description: 'Form submissions by the page the form was on.', href: '/analytics/marketing', provenance: 'measured' },
  { key: 'campaigns', name: 'Campaign performance', group: 'Marketing', description: 'Leads, deals, won revenue, budget, cost per lead and ROI per campaign.', href: '/analytics/marketing', provenance: 'measured' },
  { key: 'attribution', name: 'Attribution by campaign', group: 'Attribution', description: 'Won revenue, deals and leads credited to campaigns under all four models.', href: '/analytics/attribution', provenance: 'model' },
  { key: 'funnels', name: 'Funnel steps', group: 'Funnels', description: 'Visitors, conversion and abandonment per funnel step, and the lead-to-revenue funnel.', href: '/analytics/funnels', provenance: 'measured' },
  { key: 'page-conversion', name: 'Landing page conversion', group: 'Funnels', description: 'Page viewers who went on to submit a form on that page.', href: '/analytics/funnels', provenance: 'measured' },
];
