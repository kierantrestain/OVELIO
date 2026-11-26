'use client';

import '@xyflow/react/dist/style.css';
import { ArrowLeft, FlaskConical, LayoutGrid, Pause, Play, Save, Send } from 'lucide-react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  Background, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState, useReactFlow,
} from '@xyflow/react';
import type { Connection, Edge, Node, NodeProps } from '@xyflow/react';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { MoreMenu } from '@astryxdesign/core/MoreMenu';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Selector } from '@astryxdesign/core/Selector';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Table } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import type {
  DryRunResult, Enrolment, EnrolResult, FlowDetail, FlowGraph, FlowHandle, FlowNode, FlowNodeType, FlowTrigger, FlowVersion,
  NodeStats, ReentryRule,
} from '@/contracts/journeys';
import { describeNode, describeTrigger, enrolmentStatuses, flowNodeSpecs, handleLabel, nodeSpec, tidyLayout, validateFlow } from '@/contracts/journeys';
import { api, date, number, useAction, useResource } from '../client';
import { useColorMode } from '../providers';
import { AsyncState, ConfirmDialog, Empty, FormActions, Modal, Panel, SlideDrawer, StatusBadge } from '../ui';
import type { BuilderLookups } from './node-config';
import { NodeConfig, TriggerPanel } from './node-config';
import type { DesignOption, NamedOption, PipelineOption, TeamMember } from './shared';
import { EnrolmentBadge, EnrolmentDrawer, FlowDiagram, FlowStatusBadge, nodeIcons, paletteGroups, useLookup } from './shared';

type StepData = { type: FlowNodeType; config: Record<string, unknown> };
type StepNodeType = Node<StepData, 'step'>;

const BuilderContext = createContext<{ issues: Map<string, number>; stats: Record<string, NodeStats>; triggers: FlowTrigger[] }>({ issues: new Map(), stats: {}, triggers: [] });

const marker = { type: MarkerType.ArrowClosed, width: 16, height: 16 };

function toRfNodes(graph: FlowGraph): StepNodeType[] {
  return graph.nodes.map(node => ({ id: node.id, type: 'step', position: node.position, data: { type: node.type, config: node.config }, deletable: node.type !== 'start' }));
}
function toRfEdges(graph: FlowGraph): Edge[] {
  return graph.edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle, type: 'smoothstep', markerEnd: marker }));
}
function fromRf(nodes: StepNodeType[], edges: Edge[]): FlowGraph {
  return {
    nodes: nodes.map(node => ({ id: node.id, type: node.data.type, position: { x: Math.round(node.position.x), y: Math.round(node.position.y) }, config: node.data.config })),
    edges: edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target, sourceHandle: (edge.sourceHandle ?? 'next') as FlowHandle })),
  };
}

function StepNode({ id, data, selected }: NodeProps<StepNodeType>) {
  const context = useContext(BuilderContext);
  const spec = nodeSpec(data.type);
  const Icon = nodeIcons[data.type];
  const node: FlowNode = { id, type: data.type, position: { x: 0, y: 0 }, config: data.config };
  const issueCount = context.issues.get(id) ?? 0;
  const stats = context.stats[id];
  const summary = data.type === 'start'
    ? context.triggers.length ? context.triggers.map(describeTrigger).slice(0, 2).join(' · ') + (context.triggers.length > 2 ? ` +${context.triggers.length - 2}` : '') : 'Manual enrolment only'
    : describeNode(node);
  return <div className="ov-journeys-node" data-group={spec.group} data-selected={selected ? 'true' : 'false'} data-issue={issueCount ? 'true' : 'false'}>
    {data.type !== 'start' ? <Handle type="target" position={Position.Top} /> : null}
    <span className="ov-journeys-node-kind"><Icon size={13} aria-hidden="true" />{data.type === 'start' ? 'Trigger' : spec.group}</span>
    <span className="ov-journeys-node-title">{spec.label}</span>
    <span className="ov-journeys-node-meta">{summary}</span>
    {issueCount ? <span className="ov-journeys-node-issue">{issueCount} to fix</span> : null}
    {stats ? <span className="ov-journeys-node-stats">
      {stats.ok ? <span>{number(stats.ok)} done</span> : null}
      {stats.waiting ? <span data-tone="waiting">{number(stats.waiting)} waiting</span> : null}
      {stats.skipped ? <span>{number(stats.skipped)} skipped</span> : null}
      {stats.failed ? <span data-tone="failed">{number(stats.failed)} failed</span> : null}
    </span> : null}
    {spec.handles.map((handle, index) => {
      const left = `${((index + 1) / (spec.handles.length + 1)) * 100}%`;
      return <Fragment key={handle}>
        <Handle type="source" position={Position.Bottom} id={handle} style={{ left }} />
        {handle !== 'next' ? <span className="ov-journeys-handle-label" style={{ left }}>{handleLabel(handle, node)}</span> : null}
      </Fragment>;
    })}
  </div>;
}

const nodeTypes = { step: StepNode };

function newNodeId(type: FlowNodeType) {
  return `${type}_${Math.random().toString(36).slice(2, 7)}`;
}

function useBuilderLookups(): BuilderLookups {
  return {
    designs: useLookup<DesignOption>(['/studio/designs?kind=email', '/journeys/lookups/designs']),
    forms: useLookup<NamedOption>(['/sites/forms']),
    pages: useLookup<NamedOption>(['/sites/pages']),
    pipelines: useLookup<PipelineOption>(['/sales/pipelines', '/journeys/lookups/pipelines']),
    team: useLookup<TeamMember>(['/platform/users']),
    campaigns: useLookup<NamedOption>(['/journeys/campaigns']),
  };
}

export function FlowBuilder({ id }: { id: string }) {
  const flow = useResource<FlowDetail>(`/journeys/flows/${id}`);
  if (!flow.data) return <div className="ov-wide ov-journeys-page"><AsyncState loading={flow.loading} error={flow.error} retry={flow.refresh} /></div>;
  return <ReactFlowProvider><Builder initial={flow.data} /></ReactFlowProvider>;
}

type Confirm = { title: string; description: string; actionLabel: string; destructive?: boolean; run: () => Promise<void> };

function Builder({ initial }: { initial: FlowDetail }) {
  const router = useRouter();
  const { mode } = useColorMode();
  const flowApi = useReactFlow<StepNodeType, Edge>();
  const action = useAction();
  const lookups = useBuilderLookups();
  const [detail, setDetail] = useState(initial);
  const [nodes, setNodes, onNodesChange] = useNodesState<StepNodeType>(toRfNodes(initial.graph));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(toRfEdges(initial.graph));
  const [triggers, setTriggers] = useState<FlowTrigger[]>(initial.triggers);
  const [reentry, setReentry] = useState<ReentryRule>(initial.reentry);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState('canvas');
  const [testing, setTesting] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>();
  const readOnly = detail.status === 'archived';

  const graph = useMemo(() => fromRf(nodes, edges), [nodes, edges]);
  const issues = useMemo(() => validateFlow(graph, triggers), [graph, triggers]);
  const errors = issues.filter(issue => issue.level === 'error');
  const issueCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const issue of issues) if (issue.level === 'error') {
      const key = issue.nodeId ?? (issue.triggerId ? graph.nodes.find(node => node.type === 'start')?.id : undefined);
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [issues, graph.nodes]);
  const draftKey = JSON.stringify({ graph, triggers, reentry });
  const [savedKey, setSavedKey] = useState(() => JSON.stringify({ graph: fromRf(toRfNodes(initial.graph), toRfEdges(initial.graph)), triggers: initial.triggers, reentry: initial.reentry }));
  const dirty = draftKey !== savedKey;

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);


  const refreshCounts = useCallback(() => {
    void api<FlowDetail>(`/journeys/flows/${initial.id}`).then(next => setDetail(current => ({
      ...current, counts: next.counts, nodeStats: next.nodeStats, lastRunAt: next.lastRunAt, versions: next.versions,
    })), () => {});
  }, [initial.id]);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    setNodes(current => current.map(node => ({ ...node, selected: node.id === id })));
    const target = id ? flowApi.getNode(id) : undefined;
    if (target) void flowApi.setCenter(target.position.x + 120, target.position.y + 60, { zoom: Math.max(flowApi.getZoom(), 0.8), duration: 300 });
  }, [flowApi, setNodes]);

  const connect = useCallback((source: string, handle: FlowHandle, target: string) => {
    setEdges(current => [
      ...current.filter(edge => !(edge.source === source && (edge.sourceHandle ?? 'next') === handle)),
      { id: `e_${source}_${handle}_${target}_${Date.now().toString(36)}`, source, target, sourceHandle: handle, type: 'smoothstep', markerEnd: marker },
    ]);
  }, [setEdges]);

  function addNode(type: FlowNodeType, position?: { x: number; y: number }) {
    if (readOnly) return;
    const id = newNodeId(type);
    let at = position;
    let from: { source: string; handle: FlowHandle } | null = null;
    if (!at) {
      const anchor = nodes.find(node => node.id === selectedId) ?? [...nodes].sort((a, b) => b.position.y - a.position.y)[0];
      const free = anchor ? nodeSpec(anchor.data.type).handles.find(handle => !edges.some(edge => edge.source === anchor.id && (edge.sourceHandle ?? 'next') === handle)) : undefined;
      const offset = free === 'no' || free === 'b' ? 150 : free === 'yes' || free === 'a' ? -150 : 0;
      at = anchor ? { x: anchor.position.x + offset, y: anchor.position.y + 160 } : { x: 0, y: 0 };
      if (anchor && free) from = { source: anchor.id, handle: free };
    }
    setNodes(current => [...current.map(node => ({ ...node, selected: false })),
      { id, type: 'step', position: at, data: { type, config: nodeSpec(type).defaults() }, selected: true, deletable: true }]);
    if (from) connect(from.source, from.handle, id);
    setSelectedId(id);
  }

  function updateConfig(id: string, config: Record<string, unknown>) {
    setNodes(current => current.map(node => node.id === id ? { ...node, data: { ...node.data, config } } : node));
  }

  function tidy() {
    const laid = tidyLayout(graph);
    const positions = new Map(laid.nodes.map(node => [node.id, node.position]));
    setNodes(current => current.map(node => ({ ...node, position: positions.get(node.id) ?? node.position })));
    setTimeout(() => void flowApi.fitView({ padding: 0.15, duration: 300, maxZoom: 1, minZoom: 0.6 }), 60);
  }

  async function save(): Promise<FlowDetail> {
    const sent = { graph, triggers, reentry };
    const next = await api<FlowDetail>(`/journeys/flows/${detail.id}`, 'PATCH', sent);
    setDetail(next);
    setSavedKey(JSON.stringify(sent));
    return next;
  }

  function lifecycle(path: string, success: string) {
    void action.run(async () => {
      if (path === 'publish' && dirty) await save();
      setDetail(await api<FlowDetail>(`/journeys/flows/${detail.id}/${path}`, 'POST'));
    }, success);
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (dirty && !readOnly) void action.run(async () => { await save(); }, 'Draft saved.');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const selected = selectedId ? nodes.find(node => node.id === selectedId) : undefined;
  const canPublish = !readOnly && (detail.status === 'draft' || detail.status === 'paused' || dirty || detail.hasUnpublishedChanges);
  const publishLabel = detail.status === 'draft' ? 'Publish' : detail.status === 'paused' ? 'Publish and resume' : 'Publish changes';
  const moreItems = [
    { label: 'Duplicate', onClick: () => void action.run(async () => { const copy = await api<FlowDetail>(`/journeys/flows/${detail.id}/duplicate`, 'POST'); router.push(`/automations/flows/${copy.id}`); }) },
    readOnly
      ? { label: 'Restore to draft', onClick: () => lifecycle('restore', 'Workflow restored as a draft.') }
      : { label: 'Archive', onClick: () => setConfirm({ title: `Archive “${detail.name}”`, description: 'New contacts stop entering, and anyone in the workflow now leaves it. Its history is kept.', actionLabel: 'Archive workflow', run: async () => { setDetail(await api<FlowDetail>(`/journeys/flows/${detail.id}/archive`, 'POST')); } }) },
    ...(detail.counts.enrolled === 0 ? [{ label: 'Delete', variant: 'destructive' as const, onClick: () => setConfirm({ title: `Delete “${detail.name}”`, description: 'This permanently deletes the workflow and its versions.', actionLabel: 'Delete workflow', run: async () => { await api(`/journeys/flows/${detail.id}`, 'DELETE'); router.push('/automations'); } }) }] : []),
  ];

  return <BuilderContext.Provider value={{ issues: issueCounts, stats: detail.nodeStats, triggers }}>
    <div className="ov-wide ov-journeys-page">
      <header className="ov-journeys-head">
        <div>
          <NextLink href="/automations" className="ov-journeys-muted"><span className="ov-actions"><ArrowLeft size={14} aria-hidden="true" />Workflows</span></NextLink>
          <div className="ov-journeys-title">
            <Heading level={1}>{detail.name}</Heading>
            <FlowStatusBadge status={detail.status} />
            {detail.publishedVersion ? <StatusBadge label={`Version ${detail.publishedVersion} live`} /> : null}
            {dirty ? <StatusBadge label="Unsaved changes" tone="warning" /> : detail.hasUnpublishedChanges ? <StatusBadge label="Draft differs from live" tone="info" /> : null}
          </div>
          <Text color="secondary">
            {detail.counts.enrolled ? `${number(detail.counts.enrolled)} enrolled · ${number(detail.counts.active + detail.counts.waiting)} in progress · ${number(detail.counts.completed)} completed · ${number(detail.counts.failed)} failed` : 'No enrolments yet'}
            {detail.campaignName ? <> · Campaign <NextLink href={`/marketing/campaigns/${detail.campaignId}`}>{detail.campaignName}</NextLink></> : null}
          </Text>
        </div>
        <div className="ov-actions">
          {!readOnly ? <Button label="Save draft" icon={<Save size={16} />} isDisabled={!dirty} isLoading={action.busy && dirty}
            onClick={() => void action.run(async () => { await save(); }, 'Draft saved.')} /> : null}
          <Button label="Test run" icon={<FlaskConical size={16} />} onClick={() => setTesting(true)} />
          {detail.status === 'published' ? <Button label="Pause" icon={<Pause size={16} />} onClick={() => lifecycle('pause', 'Workflow paused: new enrolments stop and scheduled steps are held.')} /> : null}
          {detail.status === 'paused' && !dirty && !detail.hasUnpublishedChanges ? <Button label="Resume" icon={<Play size={16} />} onClick={() => lifecycle('resume', 'Workflow resumed.')} /> : null}
          {canPublish ? <Button variant="primary" label={publishLabel} icon={<Send size={16} />} isDisabled={Boolean(errors.length)} isLoading={action.busy}
            onClick={() => lifecycle('publish', 'Published. New enrolments use this version; contacts already in the workflow stay on theirs.')} /> : null}
          <MoreMenu label="More workflow actions" items={moreItems} />
        </div>
      </header>
      {action.error ? <Banner status="error" title={action.error} /> : null}
      {readOnly ? <Banner status="info" title="This workflow is archived" description="Restore it to a draft to edit or publish it again." /> : null}
      <TabList value={tab} onChange={next => { setTab(next); refreshCounts(); }} hasDivider aria-label="Workflow view">
        <Tab value="canvas" label="Canvas" />
        <Tab value="enrolments" label={`Enrolments (${number(detail.counts.enrolled)})`} />
        <Tab value="versions" label={`Versions (${detail.versions.length})`} />
        <Tab value="settings" label="Settings" />
      </TabList>

      {tab === 'canvas' ? <div className="ov-journeys-workspace">
        <aside className="ov-journeys-palette" aria-label="Steps you can add">
          {paletteGroups.map(group => <div key={group} className="ov-journeys-palette-group">
            <span className="ov-journeys-palette-heading">{group}</span>
            {flowNodeSpecs.filter(spec => spec.group === group).map(spec => {
              const Icon = nodeIcons[spec.type];
              return <button key={spec.type} type="button" className="ov-journeys-palette-item" data-group={spec.group} draggable={!readOnly} disabled={readOnly}
                title={`${spec.description} Drag onto the canvas, or click to add after the selected step.`}
                onDragStart={event => { event.dataTransfer.setData('application/x-ovelio-step', spec.type); event.dataTransfer.effectAllowed = 'move'; }}
                onClick={() => addNode(spec.type)}>
                <Icon size={15} aria-hidden="true" />{spec.label}
              </button>;
            })}
          </div>)}
        </aside>
        <div className="ov-journeys-canvas"
          onDragOver={event => { if (event.dataTransfer.types.includes('application/x-ovelio-step')) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }}
          onDrop={event => {
            const type = event.dataTransfer.getData('application/x-ovelio-step') as FlowNodeType;
            if (!type) return;
            event.preventDefault();
            const point = flowApi.screenToFlowPosition({ x: event.clientX, y: event.clientY });
            addNode(type, { x: point.x - 120, y: point.y - 40 });
          }}>
          <div className="ov-journeys-canvas-bar">
            <Button size="sm" label="Tidy layout" icon={<LayoutGrid size={14} />} isDisabled={readOnly} onClick={tidy} />
            <Button size="sm" label={errors.length ? `${errors.length} to fix` : 'Ready to publish'} variant={errors.length ? 'secondary' : 'ghost'} onClick={() => select(null)} />
          </div>
          <ReactFlow<StepNodeType, Edge>
            nodes={nodes} edges={edges} nodeTypes={nodeTypes} colorMode={mode === 'dark' ? 'dark' : 'light'}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
            onConnect={(connection: Connection) => { if (connection.source && connection.target) connect(connection.source, (connection.sourceHandle ?? 'next') as FlowHandle, connection.target); }}
            isValidConnection={connection => connection.source !== connection.target && nodes.find(node => node.id === connection.target)?.data.type !== 'start'}
            onNodeClick={(_, node) => setSelectedId(node.id)} onPaneClick={() => setSelectedId(null)}
            onNodesDelete={deleted => { if (deleted.some(node => node.id === selectedId)) setSelectedId(null); }}
            nodesDraggable={!readOnly} nodesConnectable={!readOnly} deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
            defaultEdgeOptions={{ type: 'smoothstep', markerEnd: marker }} fitView fitViewOptions={{ padding: 0.15, maxZoom: 1, minZoom: 0.6 }} minZoom={0.2} maxZoom={1.6}
            proOptions={{ hideAttribution: true }} aria-label="Workflow canvas">
            <Background gap={20} size={1} />
            <Controls showInteractive={false} position="bottom-left" />
            <MiniMap pannable zoomable position="bottom-right" nodeBorderRadius={8} ariaLabel="Workflow overview map" />
          </ReactFlow>
        </div>
        <aside className="ov-journeys-panel" aria-label="Step settings">
          {selected && selected.data.type === 'start'
            ? <TriggerPanel triggers={triggers} reentry={reentry} lookups={lookups} readOnly={readOnly} onTriggers={setTriggers} onReentry={setReentry} />
            : selected
              ? <NodeConfig key={selected.id} node={{ id: selected.id, type: selected.data.type, position: selected.position, config: selected.data.config }} lookups={lookups} readOnly={readOnly}
                onChange={config => updateConfig(selected.id, config)}
                onDelete={() => { void flowApi.deleteElements({ nodes: [{ id: selected.id }] }); setSelectedId(null); }} />
              : <div className="ov-stack-sm">
                <div className="ov-journeys-panel-head">
                  <Text type="label" color="secondary">Overview</Text>
                  <Heading level={2}>{errors.length ? 'Before you publish' : 'Ready to publish'}</Heading>
                </div>
                <Text type="supporting" color="secondary">Drag steps from the left onto the canvas, connect a step’s bottom handle to the next step, and select a step to configure it. Select the start to choose triggers.</Text>
                {issues.length ? <ul className="ov-journeys-issues">{issues.map((issue, index) => {
                  const node = issue.nodeId ? graph.nodes.find(item => item.id === issue.nodeId) : issue.triggerId ? graph.nodes.find(item => item.type === 'start') : undefined;
                  return <li key={index}><button type="button" className="ov-journeys-issue" data-level={issue.level} onClick={() => node && select(node.id)}>
                    <Text weight="medium">{node ? nodeSpec(node.type).label : issue.level === 'error' ? 'Workflow' : 'Note'}</Text>
                    <span>{issue.message}</span>
                  </button></li>;
                })}</ul> : <Text color="secondary">Every step is connected and configured.</Text>}
              </div>}
        </aside>
      </div> : null}

      {tab === 'enrolments' ? <FlowEnrolments flowId={detail.id} /> : null}
      {tab === 'versions' ? <FlowVersions detail={detail} onRestored={next => {
        setDetail(next);
        setNodes(toRfNodes(next.graph));
        setEdges(toRfEdges(next.graph));
        setTriggers(next.triggers);
        setReentry(next.reentry);
        setSavedKey(JSON.stringify({ graph: fromRf(toRfNodes(next.graph), toRfEdges(next.graph)), triggers: next.triggers, reentry: next.reentry }));
        setTab('canvas');
      }} /> : null}
      {tab === 'settings' ? <FlowSettings detail={detail} lookups={lookups} readOnly={readOnly} onSaved={setDetail} /> : null}

      {testing ? <TestRunDrawer detail={detail} dirty={dirty} onClose={() => setTesting(false)} onEnrolled={() => { setTesting(false); setTab('enrolments'); refreshCounts(); }} /> : null}
      {confirm ? <ConfirmDialog title={confirm.title} description={confirm.description} actionLabel={confirm.actionLabel} busy={action.busy}
        onClose={() => setConfirm(undefined)} onConfirm={() => void action.run(async () => { await confirm.run(); setConfirm(undefined); })} /> : null}
    </div>
  </BuilderContext.Provider>;
}

/* ── Enrolments, versions, settings, test run ─────────────────────────────────────────────────────────── */

export function EnrolmentTable({ items, onOpen, showFlow }: { items: Enrolment[]; onOpen: (id: string) => void; showFlow?: boolean }) {
  return <Table data={items} idKey="id" hasHover columns={[
    { key: 'contactName', header: 'Contact', renderCell: item => <span className="ov-cell">
      <button type="button" className="ov-journeys-row-link" onClick={() => onOpen(item.id)}>{item.contactName ?? 'No contact'}</button>
      {item.contactEmail ? <Text type="supporting" color="secondary">{item.contactEmail}</Text> : null}
    </span> },
    ...(showFlow ? [{ key: 'flowName' as const, header: 'Workflow', renderCell: (item: Enrolment) => <a href={`/automations/flows/${item.flowId}`}>{item.flowName}</a> }] : []),
    { key: 'status', header: 'Status', renderCell: item => <EnrolmentBadge status={item.status} held={item.held} /> },
    { key: 'currentStep', header: 'Step', renderCell: item => <span className="ov-cell">
      <Text>{item.status === 'completed' ? 'Finished' : item.currentStep ?? '—'}</Text>
      {item.error ? <Text type="supporting" color="secondary">{item.error}</Text> : item.status === 'waiting' && item.nextRunAt ? <Text type="supporting" color="secondary">Continues {date(item.nextRunAt)}</Text> : null}
    </span> },
    { key: 'triggerType', header: 'Entered by', renderCell: item => <Text color="secondary">{item.triggerType === 'manual' ? 'Manual' : item.triggerType}</Text> },
    { key: 'updatedAt', header: 'Last activity', renderCell: item => date(item.updatedAt) },
  ]} />;
}

function FlowEnrolments({ flowId }: { flowId: string }) {
  const [status, setStatus] = useState<string | null>(null);
  const [open, setOpen] = useState<string>();
  const list = useResource<{ items: Enrolment[] }>(`/journeys/enrolments?flowId=${flowId}${status ? `&status=${status}` : ''}`);
  const running = list.data?.items.some(item => item.status === 'active' || item.status === 'waiting');
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(list.refresh, 4000);
    return () => clearInterval(timer);
  }, [running, list.refresh]);
  return <Panel title="Enrolments" description="Everyone who entered this workflow, where they are now, and every step they took."
    action={<div className="ov-journeys-filter"><Selector label="Status" isLabelHidden value={status ?? 'all'} options={[{ value: 'all', label: 'All statuses' }, ...enrolmentStatuses.map(item => ({ value: item, label: item[0].toUpperCase() + item.slice(1) }))]}
      onChange={value => setStatus(!value || value === 'all' ? null : value)} /></div>}>
    {!list.data ? <AsyncState loading={list.loading} error={list.error} retry={list.refresh} />
      : list.data.items.length ? <EnrolmentTable items={list.data.items} onOpen={setOpen} />
        : <Empty title={status ? 'No enrolments with this status' : 'No one has entered yet'} description="Publish the workflow and let a trigger fire, or enrol a contact from Test run." />}
    {open ? <EnrolmentDrawer id={open} onClose={() => setOpen(undefined)} onChanged={list.refresh} /> : null}
  </Panel>;
}

function FlowVersions({ detail, onRestored }: { detail: FlowDetail; onRestored: (detail: FlowDetail) => void }) {
  const [viewing, setViewing] = useState<number>();
  const version = useResource<FlowVersion>(viewing ? `/journeys/flows/${detail.id}/versions/${viewing}` : null);
  const action = useAction();
  return <Panel title="Version history" description="Each publish saves an immutable version. Contacts finish the version they entered, even after you publish changes.">
    {detail.versions.length ? <Table data={detail.versions} idKey="version" columns={[
      { key: 'version', header: 'Version', renderCell: item => <span className="ov-actions">Version {item.version}{item.version === detail.publishedVersion ? <StatusBadge label="Live" tone="success" /> : null}</span> },
      { key: 'publishedAt', header: 'Published', renderCell: item => date(item.publishedAt) },
      { key: 'publishedBy', header: 'By', renderCell: item => item.publishedBy ?? '—' },
      { key: 'steps', header: 'Steps', renderCell: item => `${item.steps} steps · ${item.triggers} trigger${item.triggers === 1 ? '' : 's'}` },
      { key: 'actions', header: '', renderCell: item => <Button size="sm" variant="ghost" label="View" onClick={() => setViewing(item.version)} /> },
    ]} /> : <Empty title="Not published yet" description="Publish the workflow to create version 1." />}
    {viewing ? <Modal title={`Version ${viewing}`} size="wide" onClose={() => setViewing(undefined)}>
      {!version.data ? <AsyncState loading={version.loading} error={version.error} /> : <div className="ov-stack-sm">
        <Text color="secondary">{version.data.triggers.map(describeTrigger).join(' · ') || 'Manual enrolment only'} · {version.data.reentry === 'once' ? 'once per contact' : 're-entry allowed'}</Text>
        <FlowDiagram graph={version.data.graph} label={`Diagram of version ${viewing}`} />
        {action.error ? <Banner status="error" title={action.error} /> : null}
        <FormActions>
          <Button label="Close" onClick={() => setViewing(undefined)} />
          {detail.status !== 'archived' ? <Button variant="primary" label="Copy into the draft" isLoading={action.busy}
            onClick={() => void action.run(async () => { onRestored(await api<FlowDetail>(`/journeys/flows/${detail.id}/versions/${viewing}/restore`, 'POST')); setViewing(undefined); }, `Version ${viewing} copied into the draft. Publish to make it live.`)} /> : null}
        </FormActions>
      </div>}
    </Modal> : null}
  </Panel>;
}

function FlowSettings({ detail, lookups, readOnly, onSaved }: { detail: FlowDetail; lookups: BuilderLookups; readOnly: boolean; onSaved: (detail: FlowDetail) => void }) {
  const [name, setName] = useState(detail.name);
  const [description, setDescription] = useState(detail.description);
  const [campaignId, setCampaignId] = useState(detail.campaignId);
  const [ownerId, setOwnerId] = useState(detail.ownerId);
  const action = useAction();
  return <Panel title="Settings" description="Emails, deals and events from this workflow are attributed to its campaign.">
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => onSaved(await api<FlowDetail>(`/journeys/flows/${detail.id}`, 'PATCH', { name, description, campaignId, ownerId })), 'Settings saved.');
    }}>
      <fieldset disabled={readOnly} className="ov-stack-sm" style={{ border: 0, padding: 0, margin: 0 }}>
        <TextInput label="Name" isRequired value={name} onChange={setName} />
        <TextArea label="Description" isOptional value={description} onChange={setDescription} />
        <div className="ov-form-grid">
          <Selector label="Campaign" value={campaignId ?? 'none'} isLoading={lookups.campaigns.status === 'loading'}
            options={[{ value: 'none', label: 'No campaign' }, ...lookups.campaigns.items.map(item => ({ value: item.id, label: item.name }))]}
            onChange={value => setCampaignId(!value || value === 'none' ? null : value)} />
          <Selector label="Owner" value={ownerId ?? 'none'} description="Receives tasks when a contact has no owner."
            options={[{ value: 'none', label: 'No owner' }, ...lookups.team.items.map(item => ({ value: item.id, label: item.name }))]}
            onChange={value => setOwnerId(!value || value === 'none' ? null : value)} />
        </div>
      </fieldset>
      {action.error ? <Banner status="error" title={action.error} /> : null}
      <FormActions><Button type="submit" variant="primary" label="Save settings" isDisabled={readOnly || !name.trim()} isLoading={action.busy} /></FormActions>
    </form>
  </Panel>;
}

type ContactHit = { id: number; name: string; email: string; tags: string[]; points: number };
const outcomeTone = { would_run: 'success', would_skip: 'warning', would_wait: 'info', branch: 'neutral', end: 'neutral' } as const;
const outcomeLabel = { would_run: 'Would run', would_skip: 'Would skip', would_wait: 'Would wait', branch: 'Decision', end: 'End' } as const;

function TestRunDrawer({ detail, dirty, onClose, onEnrolled }: { detail: FlowDetail; dirty: boolean; onClose: () => void; onEnrolled: () => void }) {
  const [query, setQuery] = useState('');
  const [contact, setContact] = useState<ContactHit>();
  const [version, setVersion] = useState<'draft' | 'published'>('draft');
  const [result, setResult] = useState<DryRunResult>();
  const [enrolled, setEnrolled] = useState<EnrolResult>();
  const contacts = useResource<{ items: ContactHit[] }>(`/journeys/contacts?q=${encodeURIComponent(query.trim())}`);
  const action = useAction();
  const live = detail.status === 'published';
  return <SlideDrawer title="Test run" subtitle="Check what would happen for a real contact, then enrol them for real." onClose={onClose} width={560}>
    <div className="ov-stack-sm">
      <TextInput label="Find a contact" placeholder="Name, email or company" value={query} onChange={value => { setQuery(value); setContact(undefined); setResult(undefined); }} />
      {!contacts.data ? <AsyncState loading={contacts.loading} error={contacts.error} /> : contacts.data.items.length ? <ul className="ov-rows" aria-label="Matching contacts">
        {contacts.data.items.slice(0, 6).map(item => <li key={item.id}>
          <span><Text weight="medium">{item.name}</Text><Text type="supporting" color="secondary">{item.email} · {item.points} points{item.tags.length ? ` · ${item.tags.slice(0, 3).join(', ')}` : ''}</Text></span>
          <Button size="sm" variant={contact?.id === item.id ? 'primary' : 'secondary'} label={contact?.id === item.id ? 'Selected' : 'Select'} onClick={() => { setContact(item); setResult(undefined); setEnrolled(undefined); }} />
        </li>)}
      </ul> : <Text color="secondary">No contacts match.</Text>}
      {detail.publishedVersion ? <SegmentedControl label="Test against" size="sm" value={version} onChange={value => { setVersion(value === 'published' ? 'published' : 'draft'); setResult(undefined); }}>
        <SegmentedControlItem value="draft" label={dirty ? 'Draft (saved copy)' : 'Draft'} />
        <SegmentedControlItem value="published" label={`Live version ${detail.publishedVersion}`} />
      </SegmentedControl> : null}
      {dirty && version === 'draft' ? <Text type="supporting" color="secondary">Save the draft first to include your latest edits in the test.</Text> : null}
      <FormActions>
        <Button label="Run test" icon={<FlaskConical size={16} />} isDisabled={!contact} isLoading={action.busy}
          onClick={() => void action.run(async () => { setResult(await api<DryRunResult>(`/journeys/flows/${detail.id}/test`, 'POST', { contactId: contact!.id, version })); })} />
        <Button variant="primary" label="Enrol now" icon={<Send size={16} />} isDisabled={!contact || !live} isLoading={action.busy}
          onClick={() => void action.run(async () => {
            const outcome = await api<EnrolResult>(`/journeys/flows/${detail.id}/enrol`, 'POST', { contactIds: [contact!.id] });
            setEnrolled(outcome);
            if (outcome.enrolled) setTimeout(onEnrolled, 900);
          })} />
      </FormActions>
      {!live ? <Text type="supporting" color="secondary">{detail.status === 'paused' ? 'Resume the workflow to enrol contacts.' : 'Publish the workflow to enrol contacts for real.'}</Text> : null}
      {action.error ? <Banner status="error" title={action.error} /> : null}
      {enrolled ? enrolled.enrolled
        ? <Banner status="success" title={`${contact?.name} entered the workflow`} description="Their steps are running now; follow them in Enrolments." />
        : <Banner status="warning" title="Not enrolled" description={enrolled.skipped[0]?.reason} /> : null}
      {result ? <div className="ov-stack-sm">
        <Text type="label">What would happen for {result.contact?.name ?? 'this contact'}</Text>
        <ol className="ov-journeys-log">{result.steps.map((step, index) => <li key={index} data-status={step.outcome === 'would_run' ? 'ok' : step.outcome === 'would_skip' ? 'skipped' : step.outcome === 'would_wait' ? 'waiting' : undefined}>
          <span className="ov-journeys-log-head"><span>{step.action}</span><StatusBadge label={outcomeLabel[step.outcome]} tone={outcomeTone[step.outcome]} /></span>
          <span className="ov-journeys-log-detail">{step.detail}</span>
        </li>)}</ol>
        <Text type="supporting" color="secondary">{result.note}</Text>
      </div> : null}
      <Text type="supporting" color="secondary">Tests never send, tag or create anything.</Text>
    </div>
  </SlideDrawer>;
}

