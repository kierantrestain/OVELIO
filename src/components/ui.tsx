'use client';

import { AlertCircle, ArrowLeft, ArrowRight, CircleCheck, LoaderCircle, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { Point } from '@/contracts';
import { number } from './client';

export function Button({ variant = 'secondary', className = '', type = 'button', children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
}) {
  return <button type={type} className={`button button--${variant} ${className}`} {...props}>{children}</button>;
}

export function PageHeader({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return <header className="page-header">
    <div><h1>{title}</h1><p>{description}</p></div>
    {actions ? <div className="actions">{actions}</div> : null}
  </header>;
}

export function Panel({ title, description, action, children, className = '' }: {
  title?: string; description?: string; action?: ReactNode; children: ReactNode; className?: string;
}) {
  return <section className={`panel ${className}`}>
    {title ? <header className="panel-heading"><div><h2>{title}</h2>{description ? <p>{description}</p> : null}</div>{action}</header> : null}
    {children}
  </section>;
}

export function Field({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}{help ? <small>{help}</small> : null}</label>;
}

export function Feedback({ error, notice }: { error?: string; notice?: string }) {
  return error ? <p role="alert" className="feedback feedback--error"><AlertCircle size={17} />{error}</p>
    : notice ? <p role="status" className="feedback feedback--success"><CircleCheck size={17} />{notice}</p> : null;
}

export function AsyncState({ loading, error, retry }: { loading: boolean; error?: string; retry?: () => void }) {
  if (error) return <div className="async-state"><Feedback error={error} />{retry ? <Button onClick={retry}>Try again</Button> : null}</div>;
  if (loading) return <div className="async-state" role="status"><LoaderCircle className="spinner" size={18} /> Loading…</div>;
  return null;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><p>{title}</p>{children ? <div>{children}</div> : null}</div>;
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'green' | 'blue' | 'amber' | 'red' }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function Dialog({ title, onClose, children, size = 'normal' }: {
  title: string; onClose: () => void; children: ReactNode; size?: 'normal' | 'large';
}) {
  const element = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = element.current;
    if (!dialog?.open) dialog?.showModal();
    return () => dialog?.close();
  }, []);

  return <dialog ref={element} aria-label={title} className={`dialog dialog--${size}`} onCancel={event => {
    event.preventDefault();
    onClose();
  }}>
    <header className="dialog-heading">
      <h2>{title}</h2>
      <Button variant="quiet" className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={19} /></Button>
    </header>
    <div className="dialog-content">{children}</div>
  </dialog>;
}

export function Pager({ page, limit, total, onPage }: { page: number; limit: number; total: number; onPage: (page: number) => void }) {
  const last = Math.max(1, Math.ceil(total / limit));
  if (last === 1 && page === 1) return null;
  return <footer className="pager">
    <span>Page {page} of {last}</span>
    <div className="actions">
      <Button onClick={() => onPage(page - 1)} disabled={page <= 1}><ArrowLeft size={15} /> Previous</Button>
      <Button onClick={() => onPage(page + 1)} disabled={page >= last}>Next <ArrowRight size={15} /></Button>
    </div>
  </footer>;
}

export function Metric({ label, value, hint, icon }: { label: string; value: number | null | undefined; hint?: string; icon?: ReactNode }) {
  return <div className="metric">
    <div className="metric-heading"><span>{label}</span>{icon ? <span className="metric-icon">{icon}</span> : null}</div>
    <strong>{number(value)}</strong>
    {hint || value == null ? <small>{hint || 'Unavailable'}</small> : null}
  </div>;
}

export function Bars({ points, label }: { points?: Point[] | null; label: string }) {
  if (points == null) return <Empty title="Metric unavailable" />;
  if (!points.length) return <Empty title="No recorded activity in this period" />;
  const maximum = Math.max(1, ...points.map(point => point.value));
  const marks = [1, 0.75, 0.5, 0.25, 0].map(ratio => Math.round(maximum * ratio));
  const middle = points.at(Math.floor(points.length / 2));
  return <figure className="chart" aria-label={label}>
    <div className="chart-plot">
      <div className="chart-ticks" aria-hidden="true">{marks.map((mark, index) => <span key={index}>{number(mark)}</span>)}</div>
      <div className="chart-bars" role="list" aria-label={label}>
        {points.map((point, index) => <div className="chart-column" role="listitem" key={`${point.label}-${index}`}
          aria-label={`${point.label}: ${number(point.value)}`} title={`${point.label}: ${number(point.value)}`}>
          <span style={{ height: `${Math.max(0.8, (point.value / maximum) * 100)}%` }} />
        </div>)}
      </div>
    </div>
    <figcaption className="chart-labels"><span>{points[0]?.label}</span>
      {middle && points.length > 3 ? <span>{middle.label}</span> : null}
      {points.length > 1 ? <span>{points.at(-1)?.label}</span> : null}
    </figcaption>
  </figure>;
}
