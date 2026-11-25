'use client';

import '@/styles/journeys.css';
import {
  ArrowRightLeft, BellRing, BriefcaseBusiness, CircleStop, Clock, GitBranch, ListTodo, Mail, Play, Split, Tag, Tags, TrendingUp, Webhook,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import NextLink from 'next/link';
import { useEffect, useState } from 'react';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Text } from '@astryxdesign/core/Text';
import type {
  EnrolmentDetail, EnrolmentStatus, FlowGraph, FlowNodeType, FlowStatus, StepLog, StepStatus,
} from '@/contracts/journeys';
import { flowNodeSpecs, nodeBox, nodeSpec, tidyLayout } from '@/contracts/journeys';
import { api, date, useAction, useResource } from '../client';
import { AsyncState, SlideDrawer, StatusBadge } from '../ui';
import type { Tone } from '../ui';

export const nodeIcons: Record<FlowNodeType, LucideIcon> = {
  start: Play, wait: Clock, condition: GitBranch, split: Split, send_email: Mail, add_tag: Tag, remove_tag: Tags,
  adjust_score: TrendingUp, create_deal: BriefcaseBusiness, move_deal: ArrowRightLeft, create_task: ListTodo,
  notify_owner: BellRing, webhook: Webhook, exit: CircleStop,
};

export const paletteGroups = [...new Set(flowNodeSpecs.filter(spec => spec.type !== 'start').map(spec => spec.group))];

const flowTones: Record<FlowStatus, Tone> = { draft: 'neutral', published: 'success', paused: 'warning', archived: 'neutral' };
const flowLabels: Record<FlowStatus, string> = { draft: 'Draft', published: 'Published', paused: 'Paused', archived: 'Archived' };
export function FlowStatusBadge({ status }: { status: FlowStatus }) {
  return <StatusBadge label={flowLabels[status]} tone={flowTones[status]} />;
}

const enrolmentTones: Record<EnrolmentStatus, Tone> = { active: 'info', waiting: 'info', completed: 'success', failed: 'error', exited: 'neutral' };
const enrolmentLabels: Record<EnrolmentStatus, string> = { active: 'Running', waiting: 'Waiting', completed: 'Completed', failed: 'Failed', exited: 'Exited' };
export function EnrolmentBadge({ status, held }: { status: EnrolmentStatus; held?: boolean }) {
  if (held && (status === 'active' || status === 'waiting')) return <StatusBadge label="Held (paused)" tone="warning" />;
  return <StatusBadge label={enrolmentLabels[status]} tone={enrolmentTones[status]} />;
}

const stepLabels: Record<StepStatus, string> = { ok: 'Done', failed: 'Failed', skipped: 'Skipped', waiting: 'Waiting' };
const stepTones: Record<StepStatus, Tone> = { ok: 'success', failed: 'error', skipped: 'warning', waiting: 'info' };

export function StepLogList({ logs }: { logs: StepLog[] }) {
  if (!logs.length) return <Text color="secondary">No steps have run yet.</Text>;
  return <ol className="ov-journeys-log">
    {logs.map(log => <li key={log.id} data-status={log.status}>
      <span className="ov-journeys-log-head">
        <span>{log.action}</span>
        <StatusBadge label={stepLabels[log.status] + (log.attempt > 1 ? ` · attempt ${log.attempt}` : '')} tone={stepTones[log.status]} />
      </span>
      <span className="ov-journeys-log-detail">{log.detail}</span>
      <Text type="supporting" color="secondary">{date(log.at)}</Text>
    </li>)}
  </ol>;
}

export const triggerLabel = (type: string) => type === 'manual' ? 'Manual enrolment' : type;

export function EnrolmentDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged?: () => void }) {
  const detail = useResource<EnrolmentDetail>(`/journeys/enrolments/${id}`);
  const action = useAction();
  const item = detail.data;
  useEffect(() => {
    if (!item || (item.status !== 'active' && item.status !== 'waiting')) return;
    const timer = setInterval(detail.refresh, 4000);
    return () => clearInterval(timer);
  }, [item, detail.refresh]);
  return <SlideDrawer title={item?.contactName ?? 'Enrolment'} subtitle={item ? `${item.flowName} · version ${item.version}` : undefined} onClose={onClose} width={560}>
    {!item ? <AsyncState loading={detail.loading} error={detail.error} retry={detail.refresh} /> : <div className="ov-stack-sm">
      <div className="ov-actions ov-actions--between">
        <EnrolmentBadge status={item.status} held={item.held} />
        <Text type="supporting" color="secondary">Enrolled {date(item.enrolledAt)}</Text>
      </div>
      {item.status === 'failed' ? <Banner status="error" title="This enrolment failed" description={item.error || 'A step failed after its retries.'} /> : null}
      {item.status !== 'failed' && item.error ? <Banner status="warning" title="The last attempt failed and will be retried" description={item.error} /> : null}
      {item.held ? <Banner status="warning" title="Held while the workflow is paused" description="Resume the workflow to continue from this step." /> : null}
      {item.status === 'waiting' && item.nextRunAt ? <Text color="secondary">Next step {date(item.nextRunAt)}: {item.currentStep}</Text> : null}
      <div className="ov-actions">
        {item.contactId ? <NextLink href={`/crm/contacts/${item.contactId}`}>Open contact</NextLink> : <Text color="secondary">No contact (campaign trigger)</Text>}
        <NextLink href={`/automations/flows/${item.flowId}`}>Open workflow</NextLink>
      </div>
      <StepLogList logs={item.logs} />
      {action.error ? <Banner status="error" title={action.error} /> : null}
      <div className="ov-actions ov-actions--end">
        {item.status === 'failed' ? <Button variant="primary" label="Retry the failed step" isLoading={action.busy}
          onClick={() => void action.run(async () => { await api(`/journeys/enrolments/${id}/retry`, 'POST'); detail.refresh(); onChanged?.(); }, 'Retry queued.')} /> : null}
        {item.status === 'active' || item.status === 'waiting' ? <Button label="Remove from workflow" isLoading={action.busy}
          onClick={() => void action.run(async () => { await api(`/journeys/enrolments/${id}/exit`, 'POST'); detail.refresh(); onChanged?.(); }, 'Contact removed from the workflow.')} /> : null}
      </div>
    </div>}
  </SlideDrawer>;
}

/** A read-only picture of a flow graph, for template cards and version history. */
export function FlowDiagram({ graph, label }: { graph: FlowGraph; label: string }) {
  const laid = graph.nodes.every(node => node.position.x === 0 && node.position.y === 0) ? tidyLayout(graph) : graph;
  if (!laid.nodes.length) return null;
  const xs = laid.nodes.map(node => node.position.x);
  const ys = laid.nodes.map(node => node.position.y);
  const pad = 30;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const width = Math.max(...xs) + nodeBox.width + pad - minX;
  const height = Math.max(...ys) + nodeBox.height + pad - minY;
  const byId = new Map(laid.nodes.map(node => [node.id, node]));
  return <svg className="ov-journeys-diagram" viewBox={`${minX} ${minY} ${width} ${height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={label}>
    {laid.edges.map(edge => {
      const from = byId.get(edge.source);
      const to = byId.get(edge.target);
      if (!from || !to) return null;
      const x1 = from.position.x + nodeBox.width / 2;
      const y1 = from.position.y + nodeBox.height;
      const x2 = to.position.x + nodeBox.width / 2;
      const y2 = to.position.y;
      const mid = (y1 + y2) / 2;
      return <path key={edge.id} d={`M${x1},${y1} C${x1},${mid} ${x2},${mid} ${x2},${y2}`} />;
    })}
    {laid.nodes.map(node => <g key={node.id}>
      <rect x={node.position.x} y={node.position.y} width={nodeBox.width} height={nodeBox.height} rx={14} />
      <text x={node.position.x + nodeBox.width / 2} y={node.position.y + nodeBox.height / 2 + 8} textAnchor="middle">{nodeSpec(node.type).label}</text>
    </g>)}
  </svg>;
}

export type DesignOption = { id: string; name: string; subject?: string; status?: string };
export type NamedOption = { id: string; name: string; status?: string };
export type PipelineOption = { id: string; name: string; currency?: string; isDefault?: boolean; stages: { id: string; name: string; outcome?: string }[] };
export type TeamMember = { id: string; name: string; email: string; role: string };

export type Lookup<T> = { items: T[]; status: 'loading' | 'ready' | 'missing' | 'error'; error?: string };

/**
 * Loads a cross-lane list. Paths are tried in order and a 404 falls through to the next, so a picker keeps working
 * (or shows a clear empty state) while another lane's endpoint is not deployed.
 */
export function useLookup<T>(paths: string[]): Lookup<T> {
  const key = paths.join('|');
  const [state, setState] = useState<{ key: string; value: Lookup<T> }>();
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      for (const path of key.split('|')) {
        const response = await fetch('/api/console' + path, { cache: 'no-store', signal: controller.signal });
        if (response.status === 404) continue;
        if (!response.ok) {
          const body = await response.json().catch(() => null) as { error?: string } | null;
          return { items: [], status: 'error' as const, error: body?.error ?? 'The list could not be loaded.' };
        }
        const data = await response.json() as { items?: T[] } | T[];
        return { items: Array.isArray(data) ? data : data.items ?? [], status: 'ready' as const };
      }
      return { items: [], status: 'missing' as const };
    })().then(value => { if (!controller.signal.aborted) setState({ key, value }); }, error => {
      if (!controller.signal.aborted) setState({ key, value: { items: [], status: 'error', error: (error as Error).message } });
    });
    return () => controller.abort();
  }, [key]);
  return state?.key === key ? state.value : { items: [], status: 'loading' };
}

/** A short explanation under a picker whose list is empty or unavailable. */
export function lookupHint(lookup: Lookup<unknown>, what: string, createHint: string) {
  if (lookup.status === 'missing') return `${what} are not available in this workspace yet. ${createHint}`;
  if (lookup.status === 'error') return lookup.error;
  if (lookup.status === 'ready' && !lookup.items.length) return `No ${what.toLowerCase()} yet. ${createHint}`;
  return undefined;
}
