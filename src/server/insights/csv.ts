// CSV exports of every insights report. Cells that a spreadsheet would run as a formula are prefixed with a quote.
import type { User } from '@/contracts';
import type { DrillParams, ReportKey } from '@/contracts/insights';
import { attributionModels, reportCatalogue } from '@/contracts/insights';
import { attribution, lookbackDays } from './attribution';
import { drill } from './drill';
import { funnels } from './funnels';
import { marketing } from './marketing';
import type { InsightsQuery } from './params';
import { sales } from './sales';
import { summary } from './summary';

type Cell = string | number | null | undefined;

export function csvCell(value: Cell): string {
  if (value == null) return '';
  let text = typeof value === 'number' ? String(Math.round(value * 10_000) / 10_000) : value;
  if (/^[=+\-@\t\r]/.test(text) && typeof value === 'string') text = "'" + text;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: string[], rows: Cell[][]): string {
  return [header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

const day = (value: number) => new Date(value).toISOString().slice(0, 10);

function file(name: string, q: InsightsQuery, body: string) {
  return new Response('﻿' + body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="ovelio-${name}-${day(q.range.startAt)}-to-${day(q.range.endAt)}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}

export const exportKeys = [...reportCatalogue.map(item => item.key), 'drill'] as const;

export async function exportReport(key: ReportKey | 'drill', q: InsightsQuery, user: User, query: URLSearchParams, drillParams?: DrillParams & { page: number }) {
  const cur = q.currency;
  switch (key) {
    case 'summary': {
      const data = await summary(q);
      return file(key, q, toCsv(['Metric', 'Value', 'Comparison', 'Unit', 'Provenance', 'Definition'],
        Object.values(data.metrics).map(metric => [metric.label, metric.value, metric.previous, metric.unit === 'currency' ? cur : metric.unit, metric.provenance, metric.definition])));
    }
    case 'pipeline-stages': {
      const data = await sales(q);
      return file(key, q, toCsv(['Stage', 'Outcome', 'Probability %', 'Deals', `Value (${cur})`, `Weighted value, estimate (${cur})`],
        data.stages.map(row => [row.name, row.outcome, row.probability, row.count, row.value, row.weighted])));
    }
    case 'revenue-trend': {
      const data = await sales(q);
      return file(key, q, toCsv(['Period start', `Won revenue (${cur})`, 'Deals won', `Comparison period (${cur})`],
        data.revenue.points.map(point => [point.start.slice(0, 10), point.value, point.count, point.previous])));
    }
    case 'win-rate': {
      const data = await sales(q);
      const rows = (['owner', 'source', 'campaign'] as const).flatMap(by => data.winRate[by].map(row => [by, row.label, row.won, row.lost, row.winRate, row.wonRevenue]));
      return file(key, q, toCsv(['Breakdown', 'Name', 'Won', 'Lost', 'Win rate', `Won revenue (${cur})`], rows));
    }
    case 'stage-conversion': {
      const data = await sales(q);
      return file(key, q, toCsv(['Stage', 'Deals reaching stage', 'Conversion to next stage', 'Average days in stage'],
        data.conversion.map(row => [row.name, row.reached, row.conversionToNext, row.avgDaysInStage])));
    }
    case 'forecast': {
      const data = await sales(q);
      return file(key, q, toCsv(['Expected close month', 'Open deals', `Value (${cur})`, `Weighted value, estimate (${cur})`, 'Close date passed'],
        data.forecast.map(row => [row.month ?? 'No close date', row.count, row.value, row.weighted, row.overdue ? 'yes' : 'no'])));
    }
    case 'leads-by-campaign':
    case 'leads-by-source':
    case 'leads-by-form':
    case 'leads-by-page': {
      const data = await marketing(q, user);
      const list = { 'leads-by-campaign': data.byCampaign, 'leads-by-source': data.bySource, 'leads-by-form': data.byForm, 'leads-by-page': data.byPage }[key];
      return file(key, q, toCsv(['Name', 'Id', 'Leads'], list.map(row => [row.label, row.key, row.value])));
    }
    case 'campaigns': {
      const data = await marketing(q, user);
      return file(key, q, toCsv(['Campaign', 'Status', 'UTM campaign', 'Leads', 'Deals created', 'Deals won', `Won revenue (${cur})`, 'Budget', 'Budget currency',
        'Cost per lead', 'ROI', 'Notes'],
      data.campaigns.map(row => [row.name, row.status, row.utmCampaign, row.leads, row.deals, row.wonDeals, row.wonRevenue, row.budget, row.currency,
        row.costPerLead, row.roi, [row.costPerLeadNote, row.roiNote].filter(Boolean).join(' ')])));
    }
    case 'attribution': {
      const data = await attribution(q, lookbackDays(query.get('lookbackDays')));
      const header = ['Campaign', ...attributionModels.map(model => `Revenue: ${model.label} (${cur})`),
        ...attributionModels.map(model => `Deals: ${model.label}`), ...attributionModels.map(model => `Leads: ${model.label}`)];
      const rows: Cell[][] = data.rows.map(row => [row.name, ...attributionModels.map(model => row.revenue[model.key]),
        ...attributionModels.map(model => row.deals[model.key]), ...attributionModels.map(model => row.leads[model.key])]);
      const repeat = (value: number) => attributionModels.map(() => value);
      rows.push(['Unattributed', ...repeat(data.unattributed.revenue), ...repeat(data.unattributed.deals), ...repeat(data.unattributed.leads)]);
      rows.push(['Total (measured)', ...repeat(data.totals.wonRevenue), ...repeat(data.totals.wonDeals), ...repeat(data.totals.leads)]);
      return file(key, q, toCsv(header, rows));
    }
    case 'funnels': {
      const data = await funnels(q, user);
      return file(key, q, toCsv(['Funnel', 'Step', 'Visitors', 'Conversion from first step', 'Conversion from previous step', 'Abandonment'],
        [data.lifecycle, ...data.funnels].flatMap(funnel => funnel.steps.map(step => [funnel.name, step.label, step.visitors, step.conversionFromStart, step.conversionFromPrevious, step.abandonment]))));
    }
    case 'page-conversion': {
      const data = await funnels(q, user);
      return file(key, q, toCsv(['Page', 'Page id', 'Viewers', 'Viewers who submitted a form on the page', 'Conversion'],
        data.pages.map(row => [row.label, row.pageId, row.viewers, row.converters, row.conversion])));
    }
    case 'drill': {
      const rows = [];
      const params = drillParams!;
      let page = 1;
      let total = 0;
      do {
        const result = await drill(q, { ...params, page }, query);
        rows.push(...result.rows);
        total = result.total;
        page += 1;
      } while (rows.length < total && page <= 40);
      return file(`${params.metric.replace('_', '-')}`, q, toCsv(['Name', 'Details', 'Date', `Amount (${cur})`, 'Status', 'Link'],
        rows.map(row => [row.title, row.subtitle, row.date, row.amount, row.status, row.href])));
    }
  }
}
