// Number formatting shared by the analytics screens (en-GB, UTC dates).
import type { Interval, MetricUnit } from '@/contracts/insights';

export function formatMoney(value: number | null | undefined, currency: string, compact = false) {
  if (value == null) return '—';
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency', currency, notation: compact ? 'compact' : 'standard',
      maximumFractionDigits: compact ? 1 : Math.abs(value) >= 1000 || Number.isInteger(value) ? 0 : 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString('en-GB')}`;
  }
}

export const formatCount = (value: number | null | undefined, digits = 0) => value == null ? '—'
  : new Intl.NumberFormat('en-GB', { maximumFractionDigits: digits }).format(value);

export const formatCompact = (value: number) => new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 }).format(value);

export const formatPercent = (value: number | null | undefined, digits = 1) => value == null ? '—' : `${(value * 100).toFixed(digits)}%`;

export const formatDays = (value: number | null | undefined) => value == null ? '—' : `${formatCount(value, 1)} ${value === 1 ? 'day' : 'days'}`;

export function formatValue(value: number | null | undefined, unit: MetricUnit, currency: string) {
  if (unit === 'currency') return formatMoney(value, currency);
  if (unit === 'ratio') return formatPercent(value);
  if (unit === 'days') return formatDays(value);
  return formatCount(value);
}

const utc = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' });

export function bucketLabel(iso: string, interval: Interval, long = false) {
  const date = new Date(iso);
  if (interval === 'month') return utc({ month: 'short', year: long ? 'numeric' : '2-digit' }).format(date);
  if (interval === 'week') return (long ? 'Week of ' : '') + utc({ day: 'numeric', month: 'short' }).format(date);
  return utc({ day: 'numeric', month: 'short', ...(long ? { weekday: 'short' } : {}) }).format(date);
}

export const formatDate = (value: string | number | null | undefined) => value == null ? '—' : utc({ day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));

export function monthLabel(month: string | null) {
  if (!month) return 'No close date';
  return utc({ month: 'long', year: 'numeric' }).format(new Date(month + '-01T00:00:00Z'));
}

/** Change between two values, as a relative change or, for ratios, percentage points. */
export function change(value: number | null, previous: number | null, unit: MetricUnit) {
  if (value == null || previous == null) return null;
  if (unit === 'ratio') return { direction: Math.sign(value - previous), text: `${value - previous >= 0 ? '+' : '−'}${Math.abs((value - previous) * 100).toFixed(1)} pts` };
  if (previous === 0) return value === 0 ? { direction: 0, text: 'No change' } : { direction: 1, text: 'New' };
  const relative = (value - previous) / Math.abs(previous);
  return { direction: Math.sign(relative), text: `${relative >= 0 ? '+' : '−'}${Math.abs(relative * 100).toFixed(Math.abs(relative) < 0.1 ? 1 : 0)}%` };
}
