'use client';

// Lightweight, accessible SVG/CSS charts for the analytics screens. Colours come from design tokens, so they follow
// light and dark mode; every chart has visible values or a table view, and numbers use tabular figures.
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { Button } from '@astryxdesign/core/Button';
import type { Interval, SeriesPoint } from '@/contracts/insights';
import { Empty } from '../ui';
import { bucketLabel, formatCompact } from './format';

function useWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(entries => setWidth(Math.max(240, Math.floor(entries[0].contentRect.width))));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

/** Rounded maximum and evenly spaced ticks (1, 2, 2.5 or 5 × 10ⁿ steps). */
export function niceTicks(max: number, count = 4) {
  if (max <= 0) return [0, 1];
  const rough = max / count;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map(m => m * power).find(m => m >= rough) ?? rough;
  const top = Math.ceil(max / step) * step;
  return Array.from({ length: Math.round(top / step) + 1 }, (_, index) => Math.round(index * step * 1000) / 1000);
}

function barPath(x: number, y: number, width: number, height: number) {
  const r = Math.min(4, width / 2, height);
  return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`;
}

export function Legend({ items }: { items: { label: string; kind: 'bar' | 'line' | 'muted'; color?: string }[] }) {
  return <div className="ov-insights-legend">
    {items.map(item => <span key={item.label}>
      <i className={`ov-insights-key ov-insights-key--${item.kind}`} style={item.color ? { background: item.color } : undefined} aria-hidden="true" />{item.label}
    </span>)}
  </div>;
}

/**
 * Column chart over time with an optional comparison line. Hover or arrow keys show the bucket's values; the table
 * view lists every value.
 */
export function TrendChart({ points, interval, label, yLabel, format, formatAxis = formatCompact, comparisonLabel, empty = 'Nothing recorded in this period' }: {
  points: SeriesPoint[]; interval: Interval; label: string; yLabel: string; format: (value: number) => string;
  formatAxis?: (value: number) => string; comparisonLabel?: string | null; empty?: string;
}) {
  const { ref, width } = useWidth(640);
  const [active, setActive] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const hasPrevious = Boolean(comparisonLabel) && points.some(point => point.previous != null);
  const allZero = points.every(point => !point.value && !point.previous);
  const height = 240;
  const margin = { top: 14, right: 12, bottom: 30, left: 58 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const ticks = niceTicks(Math.max(0, ...points.map(point => Math.max(point.value, point.previous ?? 0))));
  const top = ticks[ticks.length - 1] || 1;
  const band = plotWidth / Math.max(1, points.length);
  const barWidth = Math.max(2, Math.min(24, band - 2));
  const y = (value: number) => margin.top + plotHeight - (value / top) * plotHeight;
  const center = (index: number) => margin.left + index * band + band / 2;
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(plotWidth / 64))));
  const line = hasPrevious ? points.map((point, index) => point.previous == null ? null : `${center(index)},${y(point.previous)}`).filter(Boolean).join(' ') : '';
  const current = active == null ? null : points[active];

  function pointer(event: PointerEvent<SVGRectElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const index = Math.floor((event.clientX - box.left) / (box.width / points.length));
    setActive(Math.min(points.length - 1, Math.max(0, index)));
  }
  function keys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    setActive(index => Math.min(points.length - 1, Math.max(0, (index ?? (event.key === 'ArrowLeft' ? points.length : -1)) + (event.key === 'ArrowLeft' ? -1 : 1))));
  }

  return <figure className="ov-insights-figure">
    <div className="ov-insights-figure-head">
      {hasPrevious ? <Legend items={[{ label: 'This period', kind: 'bar' }, { label: comparisonLabel!, kind: 'line' }]} /> : <span />}
      <Button size="sm" variant="ghost" label={table ? 'Show chart' : 'Show table'} onClick={() => setTable(value => !value)} />
    </div>
    {table ? <ChartTable head={['Period', yLabel, ...(hasPrevious ? [comparisonLabel!] : [])]}
      rows={points.map(point => [bucketLabel(point.start, interval, true), format(point.value), ...(hasPrevious ? [point.previous == null ? '—' : format(point.previous)] : [])])} />
      : allZero ? <Empty title={empty} />
        : <div ref={ref} className="ov-insights-plot" tabIndex={0} role="group" onKeyDown={keys} onBlur={() => setActive(null)}
          aria-label={`${label}. Use the left and right arrow keys to read each ${interval}, or show the table.`}>
          <svg width={width} height={height} role="img" aria-label={label}>
            <text className="ov-insights-axis-title" transform={`translate(12 ${margin.top + plotHeight / 2}) rotate(-90)`} textAnchor="middle">{yLabel}</text>
            {ticks.map(tick => <g key={tick}>
              <line className={tick === 0 ? 'ov-insights-baseline' : 'ov-insights-grid'} x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} />
              <text className="ov-insights-tick" x={margin.left - 8} y={y(tick)} dy="0.32em" textAnchor="end">{formatAxis(tick)}</text>
            </g>)}
            {active != null ? <rect className="ov-insights-hover" x={margin.left + active * band} y={margin.top} width={band} height={plotHeight} /> : null}
            {points.map((point, index) => point.value > 0
              ? <path key={point.start} className="ov-insights-bar" d={barPath(center(index) - barWidth / 2, y(point.value), barWidth, y(0) - y(point.value))} />
              : null)}
            {line ? <polyline className="ov-insights-line" points={line} /> : null}
            {points.map((point, index) => index % labelEvery === 0
              ? <text key={point.start} className="ov-insights-tick" x={center(index)} y={height - 10} textAnchor="middle">{bucketLabel(point.start, interval)}</text> : null)}
            <rect x={margin.left} y={margin.top} width={plotWidth} height={plotHeight} fill="transparent" onPointerMove={pointer} onPointerLeave={() => setActive(null)} />
          </svg>
          {current ? <div className="ov-insights-tooltip" role="status"
            style={{ left: Math.min(Math.max(center(active!), 90), width - 90), top: 0 }}>
            <strong>{format(current.value)}</strong>
            <span>{bucketLabel(current.start, interval, true)}{current.count ? ` · ${current.count} record${current.count === 1 ? '' : 's'}` : ''}</span>
            {hasPrevious && current.previous != null ? <span><i className="ov-insights-key ov-insights-key--line" aria-hidden="true" />{format(current.previous)} {comparisonLabel?.toLowerCase()}</span> : null}
          </div> : null}
        </div>}
  </figure>;
}

export function ChartTable({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return <div className="ov-insights-table-wrap">
    <table className="ov-insights-table">
      <thead><tr>{head.map(cell => <th key={cell} scope="col">{cell}</th>)}</tr></thead>
      <tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, column) => column === 0 ? <th key={column} scope="row">{cell}</th> : <td key={column}>{cell}</td>)}</tr>)}</tbody>
    </table>
  </div>;
}

export type BarRow = {
  key: string;
  label: string;
  value: number;
  /** Drawn as a solid bar inside the lighter `value` bar (e.g. weighted value inside deal value). */
  inner?: number | null;
  display: ReactNode;
  detail?: ReactNode;
  onSelect?: () => void;
};

/** Ranked horizontal bars with the value printed at the end of every row. */
export function BarList({ rows, empty, legend, max: fixedMax }: { rows: BarRow[]; empty?: ReactNode; legend?: { outer: string; inner: string }; max?: number }) {
  if (!rows.length) return <>{empty ?? <Empty title="Nothing recorded in this period" />}</>;
  const max = fixedMax ?? Math.max(1, ...rows.map(row => row.value));
  return <div className="ov-insights-bars">
    {legend ? <Legend items={[{ label: legend.outer, kind: 'muted' }, { label: legend.inner, kind: 'bar' }]} /> : null}
    {rows.map(row => {
      const body = <>
        <span className="ov-insights-bar-label"><span title={row.label}>{row.label}</span>{row.detail ? <small>{row.detail}</small> : null}</span>
        <span className="ov-insights-bar-track" aria-hidden="true">
          <span className={legend ? 'ov-insights-bar-fill ov-insights-bar-fill--muted' : 'ov-insights-bar-fill'} style={{ width: `${(row.value / max) * 100}%` }} />
          {row.inner != null ? <span className="ov-insights-bar-fill ov-insights-bar-fill--inner" style={{ width: `${(row.inner / max) * 100}%` }} /> : null}
        </span>
        <span className="ov-insights-bar-value">{row.display}</span>
      </>;
      return row.onSelect
        ? <button type="button" key={row.key} className="ov-insights-bar-row ov-insights-bar-row--button" onClick={row.onSelect} aria-label={`${row.label}: ${typeof row.display === 'string' ? row.display : ''}. Show records`}>{body}</button>
        : <div key={row.key} className="ov-insights-bar-row">{body}</div>;
    })}
  </div>;
}

/** Funnel steps: bar length is the share of the first step; drop-off is printed between steps. */
export function FunnelBars({ steps, onSelect }: {
  steps: { label: string; visitors: number; conversionFromStart: number | null; abandonment: number | null; extra?: ReactNode }[];
  onSelect?: (index: number) => void;
}) {
  const first = Math.max(1, steps[0]?.visitors ?? 1);
  if (!steps.length || !steps[0].visitors) return <Empty title="No visitors reached this funnel in the period" />;
  return <ol className="ov-insights-funnel">
    {steps.map((step, index) => <li key={step.label + index}>
      {index > 0 && step.abandonment != null ? <span className="ov-insights-funnel-drop">{(step.abandonment * 100).toFixed(1)}% dropped off</span> : null}
      <BarList max={first} rows={[{
        key: step.label, label: `${index + 1}. ${step.label}`, value: step.visitors,
        display: `${step.visitors.toLocaleString('en-GB')} · ${step.conversionFromStart == null ? '—' : (step.conversionFromStart * 100).toFixed(1) + '%'}`,
        detail: step.extra, onSelect: onSelect ? () => onSelect(index) : undefined,
      }]} />
    </li>)}
  </ol>;
}

/** A single thin proportion bar, e.g. inside a table cell. */
export function Meter({ value, max, color }: { value: number; max: number; color?: string }) {
  return <span className="ov-insights-meter" aria-hidden="true"><span style={{ width: `${max > 0 ? Math.min(100, (value / max) * 100) : 0}%`, background: color }} /></span>;
}
