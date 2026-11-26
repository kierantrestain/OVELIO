'use client';

import { Plus, Workflow as WorkflowIcon } from 'lucide-react';
import NextLink from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { Heading } from '@astryxdesign/core/Heading';
import { Selector } from '@astryxdesign/core/Selector';
import { Table } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import type { Workflow } from '@/contracts';
import type { Enrolment, FlowDetail, FlowSummary, FlowTemplate } from '@/contracts/journeys';
import { describeTrigger, enrolmentStatuses, flowTemplates } from '@/contracts/journeys';
import { api, date, number, useAction, useResource } from '../client';
import { AsyncState, Empty, Metric, PageHeader, Panel, StatusBadge } from '../ui';
import type { Tone } from '../ui';
import { EnrolmentTable } from './flow-builder';
import { EnrolmentDrawer, FlowDiagram } from './shared';

type Row = {
  key: string; engine: 'OVELIO' | 'Mautic'; name: string; description: string; href: string; status: string; statusLabel: string; tone: Tone;
  trigger: string; counts: FlowSummary['counts'] | null; lastRunAt: string | null; campaignName: string | null; campaignId: string | null; issue?: string;
};

const nativeStatus: Record<FlowSummary['status'], [string, string, Tone]> = {
  draft: ['draft', 'Draft', 'neutral'], published: ['live', 'Published', 'success'], paused: ['paused', 'Paused', 'warning'], archived: ['archived', 'Archived', 'neutral'],
};

function useCreateBlank() {
  const router = useRouter();
  const action = useAction();
  return {
    ...action,
    create: (input: { templateKey?: string; campaignId?: string | null; name?: string } = {}) => void action.run(async () => {
      const flow = await api<FlowDetail>('/journeys/flows', 'POST', { ...input, campaignId: input.campaignId || undefined });
      router.push(`/automations/flows/${flow.id}`);
    }),
  };
}

export function WorkflowsList() {
  const native = useResource<{ items: FlowSummary[] }>('/journeys/flows');
  const archived = useResource<{ items: FlowSummary[] }>('/journeys/flows?status=archived');
  const engine = useResource<Workflow[]>('/workflows');
  const blank = useCreateBlank();
  const [q, setQ] = useState('');
  const [engineFilter, setEngineFilter] = useState('all');
  const [status, setStatus] = useState('active');

  const rows = useMemo<Row[]>(() => {
    const flows = [...(native.data?.items ?? []), ...(archived.data?.items ?? [])].map(flow => {
      const [key, label, tone] = nativeStatus[flow.status];
      return {
        key: 'flow:' + flow.id, engine: 'OVELIO' as const, name: flow.name, description: flow.description, href: `/automations/flows/${flow.id}`,
        status: key, statusLabel: label + (flow.hasUnpublishedChanges && flow.status !== 'archived' ? ' · draft changes' : ''), tone,
        trigger: flow.triggers.length ? flow.triggers.map(describeTrigger).join(' · ') : 'Manual enrolment',
        counts: flow.counts, lastRunAt: flow.lastRunAt, campaignName: flow.campaignName, campaignId: flow.campaignId,
      };
    });
    const journeys = (engine.data ?? []).map(item => ({
      key: 'journey:' + item.id, engine: 'Mautic' as const, name: item.name, description: item.description ?? '', href: `/automations/journeys/${item.id}`,
      status: item.enabled ? 'live' : 'inactive', statusLabel: item.enabled ? 'Active' : 'Inactive', tone: (item.enabled ? 'success' : 'neutral') as Tone,
      trigger: item.formId ? 'Segment or lead form' : 'Segment membership', counts: null, lastRunAt: null, campaignName: null, campaignId: null,
      issue: item.editable === false ? item.readOnlyReason : undefined,
    }));
    const term = q.trim().toLowerCase();
    return [...flows, ...journeys]
      .filter(row => engineFilter === 'all' || row.engine === engineFilter)
      .filter(row => status === 'all' ? row.status !== 'archived' : status === 'active' ? row.status !== 'archived' : row.status === status)
      .filter(row => !term || `${row.name} ${row.description} ${row.trigger} ${row.campaignName ?? ''}`.toLowerCase().includes(term));
  }, [native.data, archived.data, engine.data, q, engineFilter, status]);

  const totals = (native.data?.items ?? []).reduce((sum, flow) => ({
    live: sum.live + (flow.status === 'published' ? 1 : 0), running: sum.running + flow.counts.active + flow.counts.waiting,
    completed: sum.completed + flow.counts.completed, failed: sum.failed + flow.counts.failed,
  }), { live: 0, running: 0, completed: 0, failed: 0 });

  return <div className="ov-wide ov-journeys-page">
    <PageHeader title="Workflows" description="Automations that act on forms, deals, tasks, tags and campaigns, plus segment journeys run by the audience engine."
      actions={<DropdownMenu button={{ label: 'Create workflow', variant: 'primary', icon: <Plus size={16} aria-hidden="true" /> }} items={[
        { label: 'From a template', description: 'Onboarding, nurture, follow-up and more', href: '/automations/templates' },
        { label: 'Blank workflow', description: 'Start with an empty canvas', onClick: () => blank.create({ name: 'Untitled workflow' }) },
        { label: 'Segment journey (Mautic)', description: 'Runs in the audience engine on segment membership', href: '/automations/journeys/new' },
      ]} />} />
    {blank.error ? <Banner status="error" title={blank.error} /> : null}
    <div className="ov-metrics">
      <Metric label="Published workflows" value={totals.live} />
      <Metric label="Contacts in progress" value={totals.running} />
      <Metric label="Completed" value={totals.completed} />
      <Metric label="Failed" value={totals.failed} hint={totals.failed ? 'See Run history to retry' : undefined} />
    </div>
    <Panel>
      <div className="ov-stack-sm">
        <div className="ov-journeys-toolbar">
          <div className="ov-journeys-filter--wide ov-journeys-filter"><TextInput label="Search" value={q} onChange={setQ} placeholder="Name, trigger or campaign" /></div>
          <div className="ov-journeys-filter"><Selector label="Engine" value={engineFilter} onChange={value => setEngineFilter(value ?? 'all')}
            options={[{ value: 'all', label: 'All engines' }, { value: 'OVELIO', label: 'OVELIO workflows' }, { value: 'Mautic', label: 'Mautic journeys' }]} /></div>
          <div className="ov-journeys-filter"><Selector label="Status" value={status} onChange={value => setStatus(value ?? 'active')}
            options={[{ value: 'active', label: 'All but archived' }, { value: 'live', label: 'Published / active' }, { value: 'draft', label: 'Draft' }, { value: 'paused', label: 'Paused' }, { value: 'inactive', label: 'Inactive (Mautic)' }, { value: 'archived', label: 'Archived' }]} /></div>
        </div>
        {engine.error ? <Banner status="warning" title="Mautic journeys could not be loaded" description={`${engine.error} OVELIO workflows are listed below.`} /> : null}
        {!native.data ? <AsyncState loading={native.loading} error={native.error} retry={native.refresh} />
          : rows.length ? <Table data={rows} idKey="key" hasHover columns={[
            { key: 'name', header: 'Workflow', renderCell: row => <span className="ov-cell">
              <NextLink href={row.href} className="ov-journeys-row-link">{row.name}</NextLink>
              <Text type="supporting" color="secondary">{row.trigger}</Text>
            </span> },
            { key: 'engine', header: 'Engine', renderCell: row => <StatusBadge label={row.engine} tone={row.engine === 'OVELIO' ? 'info' : 'neutral'} /> },
            { key: 'status', header: 'Status', renderCell: row => <StatusBadge label={row.statusLabel} tone={row.tone} /> },
            { key: 'counts', header: 'Enrolled · active · completed · failed', renderCell: row => row.counts
              ? <span className="ov-journeys-counts"><span>{number(row.counts.enrolled)}</span><span>{number(row.counts.active + row.counts.waiting)}</span><span>{number(row.counts.completed)}</span><span data-tone={row.counts.failed ? 'failed' : undefined}>{number(row.counts.failed)}</span></span>
              : <Text type="supporting" color="secondary">In the journey’s contact list</Text> },
            { key: 'lastRunAt', header: 'Last run', renderCell: row => row.lastRunAt ? date(row.lastRunAt) : '—' },
            { key: 'campaignName', header: 'Campaign', renderCell: row => row.campaignId ? <NextLink href={`/marketing/campaigns/${row.campaignId}`}>{row.campaignName}</NextLink> : '—' },
          ]} /> : <Empty title={q || engineFilter !== 'all' || status !== 'active' ? 'No workflows match these filters' : 'No workflows yet'}
            description="Start from a template to welcome new contacts, nurture leads or follow up on deals."
            action={<NextLink href="/automations/templates">Browse templates</NextLink>} />}
      </div>
    </Panel>
  </div>;
}

export function WorkflowTemplates() {
  const params = useSearchParams();
  const campaignId = params.get('campaign');
  const create = useCreateBlank();
  const [busyKey, setBusyKey] = useState<string>();
  const use = (template?: FlowTemplate) => {
    setBusyKey(template?.key ?? 'blank');
    create.create(template ? { templateKey: template.key, campaignId } : { name: 'Untitled workflow', campaignId });
  };
  return <div className="ov-wide ov-journeys-page">
    <PageHeader title="Workflow templates" description="Proven automations to start from. Each opens as a draft: pick your emails, check the triggers, then publish."
      back={{ href: '/automations', label: 'Workflows' }} />
    {create.error ? <Banner status="error" title={create.error} /> : null}
    <div className="ov-journeys-cards">
      {flowTemplates.map(template => <Card key={template.key}><div className="ov-journeys-card">
        <div className="ov-stack-sm">
          <div className="ov-actions ov-actions--between"><StatusBadge label={template.category} tone="info" /><Text type="supporting" color="secondary">{template.graph.nodes.length - 1} steps</Text></div>
          <Heading level={2}>{template.name}</Heading>
          <FlowDiagram graph={template.graph} label={`Diagram of the ${template.name} template`} />
        </div>
        <div className="ov-stack-sm">
          <Text color="secondary">{template.description}</Text>
          <Text type="supporting"><strong>Starts when:</strong> {template.triggers.map(describeTrigger).join(' · ')}</Text>
          <Text type="supporting"><strong>Outcome:</strong> {template.outcome}</Text>
        </div>
        <div><Button variant="primary" label="Use template" isLoading={create.busy && busyKey === template.key} isDisabled={create.busy} onClick={() => use(template)} /></div>
      </div></Card>)}
      <Card><div className="ov-journeys-card">
        <div className="ov-stack-sm"><StatusBadge label="Blank" /><Heading level={2}>Start from scratch</Heading>
          <div className="ov-journeys-diagram" style={{ display: 'grid', placeItems: 'center' }}><WorkflowIcon size={40} aria-hidden="true" /></div></div>
        <Text color="secondary">An empty canvas with just the start. Add triggers and drag steps in.</Text>
        <div><Button label="Blank workflow" isLoading={create.busy && busyKey === 'blank'} isDisabled={create.busy} onClick={() => use()} /></div>
      </div></Card>
    </div>
  </div>;
}

export function RunHistory() {
  const params = useSearchParams();
  const [status, setStatus] = useState(params.get('status') ?? 'all');
  const [flowId, setFlowId] = useState(params.get('flow') ?? 'all');
  const [contact, setContact] = useState('');
  const [open, setOpen] = useState<string>();
  const flows = useResource<{ items: FlowSummary[] }>('/journeys/flows');
  const query = new URLSearchParams({ limit: '300' });
  if (status !== 'all') query.set('status', status);
  if (flowId !== 'all') query.set('flowId', flowId);
  const list = useResource<{ items: Enrolment[] }>(`/journeys/enrolments?${query}`);
  const running = list.data?.items.some(item => item.status === 'active' || item.status === 'waiting');
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(list.refresh, 5000);
    return () => clearInterval(timer);
  }, [running, list.refresh]);
  const term = contact.trim().toLowerCase();
  const items = (list.data?.items ?? []).filter(item => !term || `${item.contactName ?? ''} ${item.contactEmail ?? ''}`.toLowerCase().includes(term));
  const count = (state: string) => (list.data?.items ?? []).filter(item => item.status === state).length;
  return <div className="ov-wide ov-journeys-page">
    <PageHeader title="Run history" description="Every contact’s path through every workflow: what ran, what was skipped and why, and what failed." />
    <div className="ov-metrics">
      <Metric label="Running" value={count('active')} />
      <Metric label="Waiting" value={count('waiting')} />
      <Metric label="Completed" value={count('completed')} />
      <Metric label="Failed" value={count('failed')} hint={count('failed') ? 'Open a run to see the reason and retry' : undefined} />
    </div>
    <Panel>
      <div className="ov-stack-sm">
        <div className="ov-journeys-toolbar">
          <div className="ov-journeys-filter"><Selector label="Status" value={status} onChange={value => setStatus(value ?? 'all')}
            options={[{ value: 'all', label: 'All statuses' }, ...enrolmentStatuses.map(item => ({ value: item, label: item[0].toUpperCase() + item.slice(1) }))]} /></div>
          <div className="ov-journeys-filter--wide ov-journeys-filter"><Selector label="Workflow" value={flowId} onChange={value => setFlowId(value ?? 'all')} isLoading={flows.loading}
            options={[{ value: 'all', label: 'All workflows' }, ...(flows.data?.items ?? []).map(flow => ({ value: flow.id, label: flow.name }))]} /></div>
          <div className="ov-journeys-filter--wide ov-journeys-filter"><TextInput label="Contact" value={contact} onChange={setContact} placeholder="Name or email" /></div>
        </div>
        {!list.data ? <AsyncState loading={list.loading} error={list.error} retry={list.refresh} />
          : items.length ? <EnrolmentTable items={items} onOpen={setOpen} showFlow />
            : <Empty title="No runs match" description="Runs appear here as soon as a published workflow enrols someone." />}
      </div>
    </Panel>
    {open ? <EnrolmentDrawer id={open} onClose={() => setOpen(undefined)} onChanged={list.refresh} /> : null}
  </div>;
}
