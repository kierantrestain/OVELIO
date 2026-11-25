'use client';

import { ArrowLeft } from 'lucide-react';
import { createContext, useContext } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { CodeBlock } from '@astryxdesign/core/CodeBlock';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Drawer, DrawerHeader } from '@astryxdesign/core/Drawer';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { InfoTip } from '@astryxdesign/core/InfoTip';
import { Link } from '@astryxdesign/core/Link';
import { Pagination } from '@astryxdesign/core/Pagination';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Text } from '@astryxdesign/core/Text';
import { Token } from '@astryxdesign/core/Token';
import type { Point, WeeklyTraffic } from '@/contracts';
import { number } from './client';

export type Tone = 'neutral' | 'success' | 'info' | 'warning' | 'error';

/**
 * Re-homes an existing tabbed section under the OVELIO 2.0 navigation: the side navigation replaces its top-level
 * tab strip, and its list header takes the workspace page's title. Detail headers (with `back`) are left as they are.
 */
export type SectionFrame = { title: string; description?: string; hiddenTabs: string[] };
const SectionFrameContext = createContext<SectionFrame | null>(null);
export function SectionFrameProvider({ frame, children }: { frame: SectionFrame; children: ReactNode }) {
  return <SectionFrameContext.Provider value={frame}>{children}</SectionFrameContext.Provider>;
}

export function PageHeader({ title: ownTitle, description: ownDescription, actions, back }: {
  title: string; description?: string; actions?: ReactNode; back?: { href: string; label: string };
}) {
  const frame = useContext(SectionFrameContext);
  const title = frame && !back ? frame.title : ownTitle;
  const description = frame && !back ? frame.description : ownDescription;
  return <header className="ov-page-header">
    <div>
      {back ? <Link href={back.href} type="supporting" color="secondary"><span className="ov-actions"><ArrowLeft size={14} aria-hidden="true" />{back.label}</span></Link> : null}
      <Heading level={1}>{title}</Heading>
      {description ? <Text color="secondary">{description}</Text> : null}
    </div>
    {actions ? <div className="ov-actions">{actions}</div> : null}
  </header>;
}

export function Panel({ title, description, action, children }: {
  title?: string; description?: string; action?: ReactNode; children: ReactNode;
}) {
  return <Card>
    <div className="ov-panel">
      {title ? <div className="ov-panel-heading">
        <div><Heading level={2} className="ov-panel-title">{title}</Heading>{description ? <Text type="supporting" color="secondary">{description}</Text> : null}</div>
        {action}
      </div> : null}
      {children}
    </div>
  </Card>;
}

export function Metric({ label, value, formatted, hint, info, icon, flat }: {
  label: string; value?: number | null; formatted?: string; hint?: string; info?: string; icon?: ReactNode; flat?: boolean;
}) {
  const display = formatted ?? number(value);
  const body = <div className="ov-metric">
    <span className="ov-metric-label">
      <span className="ov-actions">
        <Text type="label" color="secondary">{label}</Text>
        {info ? <InfoTip content={info} label={`About ${label}`} size="sm" /> : null}
      </span>
      {icon}
    </span>
    <span className="ov-metric-value">{display}</span>
    {hint || (formatted === undefined && value == null) ? <Text type="supporting" color="secondary">{hint || 'Unavailable'}</Text> : null}
  </div>;
  return flat ? body : <Card>{body}</Card>;
}

export function StatusBadge({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  return <Badge label={label} variant={tone} />;
}

export function Feedback({ error, notice }: { error?: string; notice?: string }) {
  if (error) return <Banner status="error" title={error} />;
  if (notice) return <Banner status="success" title={notice} />;
  return null;
}

export function AsyncState({ loading, error, retry }: { loading: boolean; error?: string; retry?: () => void }) {
  if (error) return <Banner status="error" title={error} endContent={retry ? <Button label="Try again" size="sm" onClick={retry} /> : undefined} />;
  if (loading) return <SkeletonRows rows={3} />;
  return null;
}

/** Loading placeholder shaped like table rows; announces "Loading…" to assistive technology. */
export function SkeletonRows({ rows = 5, columns = 3, label = 'Loading' }: { rows?: number; columns?: number; label?: string }) {
  const widths = ['72%', '48%', '60%', '36%', '54%'];
  return <div className="ov-skeleton-rows" role="status" aria-label={label}
    style={{ '--ov-skeleton-cols': `2fr ${'1fr '.repeat(Math.max(0, columns - 1))}`.trim() } as CSSProperties}>
    <span className="ov-visually-hidden">Loading…</span>
    {Array.from({ length: rows }, (_, row) => <div key={row} className="ov-skeleton-row" aria-hidden="true">
      {Array.from({ length: columns }, (_, column) => <Skeleton key={column} height={column === 0 ? 14 : 12} width={widths[(row + column) % widths.length]} radius={1} index={row * columns + column} />)}
    </div>)}
  </div>;
}

/**
 * Responsive table frame. Wrap an Astryx <Table> (or a plain <table>): narrow screens scroll it sideways instead of
 * crushing columns, the header sticks while a tall table scrolls inside `maxHeight`, and numbers use tabular figures.
 */
export function DataTable({ children, label, maxHeight, minWidth }: {
  children: ReactNode; label?: string; maxHeight?: number | string; minWidth?: number;
}) {
  const style = {
    ...(maxHeight != null ? { '--ov-table-max-height': typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight } : {}),
    ...(minWidth != null ? { '--ov-table-min-width': `${minWidth}px` } : {}),
  } as CSSProperties;
  return <div className="ov-table" style={style} data-min-width={minWidth != null ? '' : undefined}
    role={label ? 'region' : undefined} aria-label={label}>{children}</div>;
}

/** Page or panel toolbar: search and filters at the start, actions at the end; wraps cleanly and stacks on phones. */
export function Toolbar({ children, end, label }: { children?: ReactNode; end?: ReactNode; label?: string }) {
  return <div className="ov-tbar" role={label ? 'group' : undefined} aria-label={label}>
    {children ? <div className="ov-tbar-start">{children}</div> : null}
    {end ? <div className="ov-tbar-end">{end}</div> : null}
  </div>;
}

/** A row of filter controls (selectors, inputs, toggles) with consistent spacing; each control fills the row on phones. */
export function FilterRow({ children, label = 'Filters' }: { children: ReactNode; label?: string }) {
  return <div className="ov-filter-row" role="group" aria-label={label}>{children}</div>;
}

/**
 * KPI tile: label, a large tabular value, an optional change against the previous period and a hint. Mark modelled
 * numbers (forecasts, weighted pipeline) with `estimate` so they are never read as recorded results.
 */
export function KpiTile({ label, value, delta, hint, info, icon, estimate, flat }: {
  label: string; value: ReactNode; delta?: { value: number; label?: string; goodWhen?: 'up' | 'down' };
  hint?: string; info?: string; icon?: ReactNode; estimate?: boolean; flat?: boolean;
}) {
  const good = delta ? (delta.goodWhen === 'down' ? delta.value < 0 : delta.value > 0) : false;
  const body = <div className="ov-kpi">
    <span className="ov-kpi-label">
      <span className="ov-actions">{label}{info ? <InfoTip content={info} label={`About ${label}`} size="sm" /> : null}</span>
      {icon}
    </span>
    <span className="ov-kpi-value">{value}</span>
    {delta || hint || estimate ? <span className="ov-kpi-foot">
      {estimate ? <Badge label="Estimate" variant="neutral" /> : null}
      {delta ? <span className={`ov-kpi-delta ${delta.value === 0 ? '' : good ? 'ov-kpi-delta--good' : 'ov-kpi-delta--bad'}`}>
        {delta.value > 0 ? '+' : delta.value < 0 ? '−' : ''}{number(Math.abs(delta.value))}%
      </span> : null}
      {delta?.label ? <span>{delta.label}</span> : null}
      {hint ? <span>{hint}</span> : null}
    </span> : null}
  </div>;
  return flat ? body : <Card>{body}</Card>;
}

export function Empty({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <EmptyState title={title} description={description} actions={action} isCompact />;
}

export function Modal({ title, onClose, children, size = 'normal' }: {
  title: string; onClose: () => void; children: ReactNode; size?: 'normal' | 'large' | 'wide';
}) {
  const width = size === 'wide' ? 980 : size === 'large' ? 760 : 480;
  return <Dialog isOpen onOpenChange={open => { if (!open) onClose(); }} width={width} purpose="form" maxHeight="90dvh">
    <DialogHeader title={title} onOpenChange={open => { if (!open) onClose(); }} />
    <div className="ov-stack-sm" style={{ padding: 20 }}>{children}</div>
  </Dialog>;
}

export function ConfirmDialog({ title, description, actionLabel, onConfirm, onClose, busy, destructive = true }: {
  title: string; description: string; actionLabel: string; onConfirm: () => void; onClose: () => void; busy?: boolean; destructive?: boolean;
}) {
  return <AlertDialog
    isOpen
    onOpenChange={open => { if (!open) onClose(); }}
    title={title}
    description={description}
    actionLabel={actionLabel}
    actionVariant={destructive ? 'destructive' : 'primary'}
    isActionLoading={busy}
    onAction={onConfirm}
  />;
}

export function SlideDrawer({ title, subtitle, onClose, children, width = 540 }: {
  title: string; subtitle?: string; onClose: () => void; children: ReactNode; width?: number;
}) {
  return <Drawer isOpen onOpenChange={open => { if (!open) onClose(); }} label={title} side="end" width={width}>
    <DrawerHeader title={title} subtitle={subtitle} onOpenChange={open => { if (!open) onClose(); }} hasDivider />
    <div className="ov-drawer-body">{children}</div>
  </Drawer>;
}

export function FormActions({ children }: { children: ReactNode }) {
  return <div className="ov-actions ov-actions--end">{children}</div>;
}

export function Tabs<T extends string>({ value, onChange, items, label }: { value: T; onChange: (value: T) => void; items: readonly T[]; label: string }) {
  const frame = useContext(SectionFrameContext);
  if (frame?.hiddenTabs.includes(label)) return null;
  return <TabList value={value} onChange={next => onChange(next as T)} hasDivider aria-label={label}>
    {items.map(item => <Tab key={item} value={item} label={item} />)}
  </TabList>;
}

export function Pager({ page, limit, total, onPage }: { page: number; limit: number; total: number; onPage: (page: number) => void }) {
  if (total <= limit) return null;
  return <Pagination page={page} pageSize={limit} totalItems={total} onChange={onPage} />;
}

export function Snippet({ code, language = 'html' }: { code: string; language?: string }) {
  return <CodeBlock code={code} language={language} hasLanguageLabel={false} isWrapped width="100%" />;
}

export function Rows({ children }: { children: ReactNode }) {
  return <ul className="ov-rows">{children}</ul>;
}

export function FilterBar({ items, onRemove, onClear }: {
  items: { key: string; label: string }[];
  onRemove: (key: string) => void;
  onClear: () => void;
}) {
  if (!items.length) return null;
  return <div className="ov-filter-bar" role="region" aria-label="Active filters">
    <Text type="label" color="secondary">Active filters:</Text>
    {items.map(item => <Token key={item.key} label={item.label} color="blue" size="sm" onRemove={() => onRemove(item.key)} />)}
    <Button size="sm" variant="ghost" label="Clear all" onClick={onClear} />
  </div>;
}

export function SendProgress({ label, sent, total, rate }: { label: string; sent: number; total: number; rate?: number }) {
  const max = Math.max(total, sent, 1);
  return <div className="ov-stack-sm">
    <div className="ov-actions ov-actions--between">
      <Text weight="medium">{label}</Text>
      <Text type="supporting" color="secondary">{number(sent)} / {number(total)}{rate ? ` · ${number(rate)}/min` : ''}</Text>
    </div>
    <ProgressBar label={label} isLabelHidden value={sent} max={max} />
  </div>;
}

function formatChartLabel(raw: string) {
  if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?/.test(raw)) {
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) {
      const hasTime = raw.includes('T') && !raw.endsWith('T00:00:00Z') && !raw.endsWith('T00:00:00.000Z');
      return new Intl.DateTimeFormat('en-GB', hasTime
        ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }
        : { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(parsed));
    }
  }
  return raw;
}

export function Bars({ points, label }: { points?: Point[] | null; label: string }) {
  if (points == null) return <Empty title="Metric unavailable" description="The reporting service did not return this measurement." />;
  if (!points.length) return <Empty title="No recorded activity in this period" />;
  const maximum = Math.max(1, ...points.map(point => point.value));
  const marks = maximum < 4
    ? Array.from({ length: maximum + 1 }, (_, i) => maximum - i)
    : [1, 0.75, 0.5, 0.25, 0].map(ratio => Math.round(maximum * ratio));
  const middle = points.at(Math.floor(points.length / 2));
  return <figure className="ov-chart" aria-label={label}>
    <div className="ov-chart-plot">
      <div className="ov-chart-ticks" aria-hidden="true">{marks.map((mark, index) => <span key={index}>{number(mark)}</span>)}</div>
      <div className="ov-chart-bars" role="list" aria-label={label}>
        {points.map((point, index) => <div className="ov-chart-col" role="listitem" key={`${point.label}-${index}`}
          aria-label={`${formatChartLabel(point.label)}: ${number(point.value)}`} title={`${formatChartLabel(point.label)}: ${number(point.value)}`}>
          <span style={{ height: `${Math.max(1.5, (point.value / maximum) * 100)}%` }} />
        </div>)}
      </div>
    </div>
    <figcaption className="ov-chart-labels"><span>{formatChartLabel(points[0]?.label ?? '')}</span>
      {middle && points.length > 3 ? <span>{formatChartLabel(middle.label)}</span> : null}
      {points.length > 1 ? <span>{formatChartLabel(points.at(-1)?.label ?? '')}</span> : null}
    </figcaption>
  </figure>;
}

export function Distribution({ points, onSelect, showPercent = false }: {
  points?: Point[] | null; onSelect?: (label: string) => void; showPercent?: boolean;
}) {
  if (points == null) return <Empty title="Metric unavailable" />;
  if (!points.length) return <Empty title="No recorded activity" />;
  const max = Math.max(1, ...points.map(point => point.value));
  const first = Math.max(1, points[0]?.value ?? 1);
  return <div className="ov-dist">
    {points.slice(0, 15).map((point, index) => {
      const pct = showPercent ? ` (${Math.round((point.value / first) * 100)}%)` : '';
      return <div
        key={`${point.label}-${index}`}
        className={`ov-dist-row ${onSelect ? 'ov-dist-row--clickable' : ''}`}
        role={onSelect ? 'button' : undefined}
        tabIndex={onSelect ? 0 : undefined}
        onClick={onSelect ? () => onSelect(point.label) : undefined}
        onKeyDown={onSelect ? event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(point.label); } } : undefined}
      >
        <div>
          <span title={point.label || 'Unknown'}>{point.label || 'Unknown'}</span>
          <strong>{number(point.value)}{pct}</strong>
        </div>
        <div className="ov-dist-track" aria-hidden="true"><span style={{ width: `${(point.value / max) * 100}%` }} /></div>
      </div>;
    })}
  </div>;
}

const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function WeeklyHeatmap({ matrix }: { matrix?: WeeklyTraffic | null }) {
  if (!matrix?.length) return <Empty title="No hourly traffic pattern yet" />;
  const max = Math.max(1, ...matrix.flat());
  return <div className="ov-heatmap" role="img" aria-label="Traffic by day of week and hour (UTC)">
    <div className="ov-heatmap-row">
      <span className="ov-heatmap-day" />
      {Array.from({ length: 24 }, (_, hour) => <span key={hour} className="ov-heatmap-day" style={{ textAlign: 'center' }}>{hour % 4 === 0 ? `${hour}h` : ''}</span>)}
    </div>
    {matrix.slice(0, 7).map((row, dayIndex) => <div key={dayIndex} className="ov-heatmap-row">
      <span className="ov-heatmap-day">{dayLabels[dayIndex] ?? `D${dayIndex}`}</span>
      {row.slice(0, 24).map((value, hour) => {
        const opacity = value > 0 ? Math.max(0.18, value / max) : 0;
        return <span
          key={hour}
          className="ov-heatmap-cell"
          title={`${dayLabels[dayIndex]} ${String(hour).padStart(2, '0')}:00 UTC — ${number(value)} views`}
          style={opacity ? { background: 'var(--ov-chart)', opacity } : undefined}
        />;
      })}
    </div>)}
  </div>;
}
