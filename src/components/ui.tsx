'use client';

import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { CodeBlock } from '@astryxdesign/core/CodeBlock';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { Link } from '@astryxdesign/core/Link';
import { Pagination } from '@astryxdesign/core/Pagination';
import { Spinner } from '@astryxdesign/core/Spinner';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Text } from '@astryxdesign/core/Text';
import type { Point } from '@/contracts';
import { number } from './client';

export type Tone = 'neutral' | 'success' | 'info' | 'warning' | 'error';

export function PageHeader({ title, description, actions, back }: {
  title: string; description?: string; actions?: ReactNode; back?: { href: string; label: string };
}) {
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

export function Metric({ label, value, hint, icon, flat }: {
  label: string; value: number | null | undefined; hint?: string; icon?: ReactNode; flat?: boolean;
}) {
  const body = <div className="ov-metric">
    <span className="ov-metric-label"><Text type="label" color="secondary">{label}</Text>{icon}</span>
    <span className="ov-metric-value">{number(value)}</span>
    {hint || value == null ? <Text type="supporting" color="secondary">{hint || 'Unavailable'}</Text> : null}
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
  if (loading) return <div className="ov-actions" role="status"><Spinner size="sm" /><Text color="secondary">Loading…</Text></div>;
  return null;
}

export function Empty({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <EmptyState title={title} description={description} actions={action} isCompact />;
}

export function Modal({ title, onClose, children, size = 'normal' }: {
  title: string; onClose: () => void; children: ReactNode; size?: 'normal' | 'large';
}) {
  return <Dialog isOpen onOpenChange={open => { if (!open) onClose(); }} width={size === 'large' ? 760 : 460} purpose="form" maxHeight="88dvh">
    <DialogHeader title={title} onOpenChange={open => { if (!open) onClose(); }} />
    <div className="ov-stack-sm" style={{ padding: 20 }}>{children}</div>
  </Dialog>;
}

export function FormActions({ children }: { children: ReactNode }) {
  return <div className="ov-actions ov-actions--end">{children}</div>;
}

export function Tabs<T extends string>({ value, onChange, items, label }: { value: T; onChange: (value: T) => void; items: readonly T[]; label: string }) {
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

export function Bars({ points, label }: { points?: Point[] | null; label: string }) {
  if (points == null) return <Empty title="Metric unavailable" description="The reporting service did not return this measurement." />;
  if (!points.length) return <Empty title="No recorded activity in this period" />;
  const maximum = Math.max(1, ...points.map(point => point.value));
  const marks = [1, 0.75, 0.5, 0.25, 0].map(ratio => Math.round(maximum * ratio));
  const middle = points.at(Math.floor(points.length / 2));
  return <figure className="ov-chart" aria-label={label}>
    <div className="ov-chart-plot">
      <div className="ov-chart-ticks" aria-hidden="true">{marks.map((mark, index) => <span key={index}>{number(mark)}</span>)}</div>
      <div className="ov-chart-bars" role="list" aria-label={label}>
        {points.map((point, index) => <div className="ov-chart-col" role="listitem" key={`${point.label}-${index}`}
          aria-label={`${point.label}: ${number(point.value)}`} title={`${point.label}: ${number(point.value)}`}>
          <span style={{ height: `${Math.max(0.8, (point.value / maximum) * 100)}%` }} />
        </div>)}
      </div>
    </div>
    <figcaption className="ov-chart-labels"><span>{points[0]?.label}</span>
      {middle && points.length > 3 ? <span>{middle.label}</span> : null}
      {points.length > 1 ? <span>{points.at(-1)?.label}</span> : null}
    </figcaption>
  </figure>;
}

export function Distribution({ points }: { points?: Point[] | null }) {
  if (points == null) return <Empty title="Metric unavailable" />;
  if (!points.length) return <Empty title="No recorded activity" />;
  const max = Math.max(1, ...points.map(point => point.value));
  return <div className="ov-dist">
    {points.slice(0, 10).map((point, index) => <div key={`${point.label}-${index}`} className="ov-dist-row">
      <div><span>{point.label || 'Unknown'}</span><strong>{number(point.value)}</strong></div>
      <div className="ov-dist-track" aria-hidden="true"><span style={{ width: `${point.value / max * 100}%` }} /></div>
    </div>)}
  </div>;
}
