'use client';

/* AUT-02 / AUT-04: branching workflow canvas. React, SVG and CSS only. */

import { ArrowLeft, LayoutGrid, ListTree, Plus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Field } from '@astryxdesign/core/Field';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Token } from '@astryxdesign/core/Token';
import type {
  JourneyEmail, LeadForm, Segment, Stage, Workflow, WorkflowBranch, WorkflowGraph, WorkflowInput, WorkflowIntervalUnit,
  WorkflowIssue, WorkflowNode, WorkflowNodeSpec, WorkflowSchedule, WorkflowStep,
} from '@/contracts';
import {
  branches, childNodes, decisionWait, decisionWaitLabel, emptySchedule, intervalSchedule, layoutPoint,
  layoutWorkflowGraph, maxWorkflowNodes, scheduleLabel, setDecisionWait, subtreeIds, validateWorkflowGraph,
  workflowLayout, workflowNodeSpec, workflowNodeSpecs,
} from '@/contracts';
import { api, number, useAction, useResource } from './client';
import { ConfirmDialog, Feedback, FormActions, Modal, Panel, SlideDrawer } from './ui';

const workflowPath = '/workflows';
const cardWidth = 200;
const cardHeight = 96;

export type WorkflowLookups = {
  emails?: JourneyEmail[];
  segments?: Segment[];
  forms?: LeadForm[];
  stages?: Stage[];
};

type Anchor = { parentId: string | null; branch: WorkflowBranch | null };

const unitOptions: { value: WorkflowIntervalUnit; label: string }[] = [
  { value: 'i', label: 'Minutes' }, { value: 'h', label: 'Hours' }, { value: 'd', label: 'Days' },
  { value: 'm', label: 'Months' }, { value: 'y', label: 'Years' },
];
const weekdays = [
  { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' }, { value: 3, label: 'Wed' }, { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' }, { value: 0, label: 'Sun' },
];
const stepTypeByKind: Record<NonNullable<WorkflowStep['kind']>, string> = {
  email: 'email.send', tags: 'lead.changetags', points: 'lead.changepoints', segment: 'lead.changelist', stage: 'stage.change',
};

const canvasCss = `
.ov-wf-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
.ov-wf-scroll { overflow: auto; max-height: 64vh; border: 1px solid var(--color-border); border-radius: var(--radius-container, 12px); background: var(--color-background-muted); }
.ov-wf-canvas { position: relative; }
.ov-wf-edges { position: absolute; inset: 0; pointer-events: none; }
.ov-wf-edges path { fill: none; stroke: var(--color-border-emphasized); stroke-width: 1.5; }
.ov-wf-edges path[data-branch="no"] { stroke-dasharray: 6 4; }
.ov-wf-card { position: absolute; width: ${cardWidth}px; height: ${cardHeight}px; box-sizing: border-box; display: grid; align-content: start; gap: 2px; padding: 9px 12px; text-align: left; font: inherit; color: var(--color-text-primary); background: var(--color-background-surface); border: 1px solid var(--color-border); border-radius: var(--radius-element, 8px); cursor: pointer; overflow: hidden; }
.ov-wf-card:hover { border-color: var(--color-border-emphasized); }
.ov-wf-card:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
.ov-wf-card[data-kind="decision"], .ov-wf-card[data-kind="condition"] { border-left: 4px solid var(--color-accent); }
.ov-wf-card[data-kind="entry"] { background: var(--color-accent-muted); cursor: default; }
.ov-wf-card[data-state="error"] { border-color: var(--color-text-danger, #c0362c); }
.ov-wf-card[data-selected="true"] { box-shadow: 0 0 0 2px var(--color-accent); }
.ov-wf-kind { font-size: 11px; letter-spacing: .04em; text-transform: uppercase; color: var(--color-text-secondary); }
.ov-wf-title { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ov-wf-meta { font-size: 12px; color: var(--color-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ov-wf-wait { font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ov-wf-add { position: absolute; transform: translateX(-50%); height: 24px; padding: 0 10px; font: inherit; font-size: 12px; white-space: nowrap; color: var(--color-text-primary); background: var(--color-background-surface); border: 1px dashed var(--color-border-emphasized); border-radius: 999px; cursor: pointer; }
.ov-wf-add:hover, .ov-wf-add:focus-visible { border-style: solid; border-color: var(--color-accent); outline: none; }
.ov-wf-list, .ov-wf-list ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.ov-wf-list ol { margin-left: 10px; padding-left: 12px; border-left: 2px solid var(--color-border); }
.ov-wf-list ol[data-branch="no"] { border-left-style: dashed; }
.ov-wf-row { display: grid; gap: 2px; width: 100%; box-sizing: border-box; padding: 10px 12px; text-align: left; font: inherit; color: var(--color-text-primary); background: var(--color-background-surface); border: 1px solid var(--color-border); border-radius: var(--radius-element, 8px); cursor: pointer; }
.ov-wf-row[data-state="error"] { border-color: var(--color-text-danger, #c0362c); }
.ov-wf-row:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
.ov-wf-row[data-static="true"] { cursor: default; }
.ov-wf-branch { font-size: 12px; font-weight: 600; color: var(--color-text-secondary); }
.ov-wf-list .ov-wf-add { position: static; transform: none; justify-self: start; }
.ov-wf-issues { margin: 0; padding-left: 18px; display: grid; gap: 4px; }
.ov-wf-native { font: inherit; padding: 6px 8px; border: 1px solid var(--color-border); border-radius: var(--radius-element, 8px); background: var(--color-background-surface); color: var(--color-text-primary); }
.ov-wf-days { display: flex; flex-wrap: wrap; gap: 4px 12px; }
`;

/* ── Graph helpers used by the editor ──────────────────────────────────────── */

function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function tagList(value: unknown) {
  return listOf(value).filter((tag): tag is string => typeof tag === 'string');
}

function idsOf(value: unknown) {
  return listOf(value).map(Number).filter(id => Number.isSafeInteger(id) && id > 0);
}

function parseCsv(text: string) {
  return [...new Set(text.split(',').map(item => item.trim()).filter(Boolean))];
}

/** A linear step list as a graph, for workflows saved before the canvas and for templates. */
export function graphFromSteps(steps: WorkflowStep[], segmentId: number, formId?: number): WorkflowGraph {
  const nodes: WorkflowNode[] = [];
  let parentId: string | null = null;
  steps.forEach((step, index) => {
    let branch: WorkflowBranch | null = null;
    if (step.condition) {
      const id = `new_d${index + 1}`;
      const type = step.condition === 'opened_previous' ? 'email.open' : 'email.click';
      nodes.push({
        id, parentId, branch: null, eventType: 'decision', type, name: workflowNodeSpec(type)!.label,
        description: '', properties: {}, schedule: emptySchedule(null),
      });
      parentId = id;
      branch = 'yes';
    }
    const kind = step.kind ?? 'email';
    const type = stepTypeByKind[kind];
    const properties: Record<string, unknown> = kind === 'email' ? { email: step.emailId, email_type: 'marketing' }
      : kind === 'tags' ? { add_tags: step.addTags ?? [], remove_tags: step.removeTags ?? [] }
        : kind === 'points' ? { points: step.pointsDelta ?? 0 }
          : kind === 'segment' ? { addToLists: step.addSegmentIds ?? [], removeFromLists: step.removeSegmentIds ?? [] }
            : { stage: step.stageId ?? 0 };
    const id = `new_a${index + 1}`;
    nodes.push({
      id, parentId, branch, eventType: 'action', type, name: workflowNodeSpec(type)!.label, description: '', properties,
      schedule: step.delayMinutes ? intervalSchedule(step.delayMinutes, 'i') : emptySchedule(),
    });
    parentId = id;
  });
  return { segmentIds: segmentId > 0 ? [segmentId] : [], formIds: formId ? [formId] : [], allowRestart: false, nodes };
}

export function workflowGraphOf(workflow: Workflow): WorkflowGraph {
  return workflow.graph ?? graphFromSteps(workflow.steps, workflow.segmentId, workflow.formId);
}

function templateGraph(id: string): WorkflowGraph {
  const email = (key: string, parentId: string | null, branch: WorkflowBranch | null, schedule: WorkflowSchedule): WorkflowNode => ({
    id: key, parentId, branch, eventType: 'action', type: 'email.send', name: 'Send email', description: '',
    properties: { email: 0, email_type: 'marketing' }, schedule,
  });
  const delays: Record<string, number[]> = { blank: [0], welcome: [0, 1440], nurture: [0, 2880, 4320], 'follow-up': [1440], 're-engage': [0, 10080] };
  if (id === 'reminder') {
    return {
      segmentIds: [], formIds: [], allowRestart: false, nodes: [
        email('new_t1', null, null, emptySchedule()),
        { id: 'new_t2', parentId: 'new_t1', branch: null, eventType: 'decision', type: 'email.open', name: 'Opened email?', description: '', properties: {}, schedule: emptySchedule(null) },
        { id: 'new_t3', parentId: 'new_t2', branch: 'yes', eventType: 'action', type: 'lead.changetags', name: 'Change tags', description: '', properties: { add_tags: ['engaged'], remove_tags: [] }, schedule: emptySchedule() },
        email('new_t4', 'new_t2', 'no', intervalSchedule(3, 'd')),
      ],
    };
  }
  return graphFromSteps((delays[id] ?? [0]).map(delayMinutes => ({ emailId: 0, delayMinutes })), 0);
}

export const workflowTemplates = [
  { id: 'blank', name: 'Blank workflow', description: 'One email step' },
  { id: 'reminder', name: 'Email with a reminder', description: 'Tag openers, remind non-openers after 3 days' },
  { id: 'welcome', name: 'Welcome sequence', description: '2 emails, one day apart' },
  { id: 'nurture', name: 'Lead nurturing', description: '3 emails over a week' },
  { id: 'follow-up', name: 'Follow-up email', description: 'One email after a day' },
  { id: 're-engage', name: 'Re-engagement', description: '2 emails, a week apart' },
];

function nodeKindLabel(node: WorkflowNode) {
  const kind = node.eventType === 'decision' ? 'Decision' : node.eventType === 'condition' ? 'Condition' : 'Action';
  return workflowNodeSpec(node.type) ? kind : `${kind} · Advanced`;
}

export function describeNode(node: WorkflowNode, lookups: WorkflowLookups) {
  const props = node.properties;
  switch (node.type) {
    case 'email.send': {
      const id = Number(props.email);
      return id ? lookups.emails?.find(email => email.id === id)?.name || `Email #${id}` : 'Choose an email';
    }
    case 'lead.changetags': {
      const parts = [...tagList(props.add_tags).map(tag => `+${tag}`), ...tagList(props.remove_tags).map(tag => `−${tag}`)];
      return parts.join(', ') || 'Choose tags';
    }
    case 'lead.changepoints': {
      const points = Number(props.points) || 0;
      return `${points > 0 ? '+' : ''}${number(points)} points`;
    }
    case 'lead.changelist': {
      const nameOf = (id: number) => lookups.segments?.find(item => item.id === id)?.name || `Segment #${id}`;
      const parts = [
        ...idsOf(props.addToLists).map(id => `add to ${nameOf(id)}`),
        ...idsOf(props.removeFromLists).map(id => `remove from ${nameOf(id)}`),
      ];
      return parts.join(', ') || 'Choose segments';
    }
    case 'stage.change': {
      const id = Number(props.stage);
      return id ? lookups.stages?.find(stage => stage.id === id)?.name || `Stage #${id}` : 'Choose a stage';
    }
    case 'email.open':
      return 'Waits for an open';
    case 'email.click':
      return 'Waits for a click';
    default:
      return workflowNodeSpec(node.type) ? workflowNodeSpec(node.type)!.description : node.type;
  }
}

function timingLabel(graph: WorkflowGraph, node: WorkflowNode) {
  if (node.eventType === 'decision') return decisionWaitLabel(graph, node) ?? 'No end for contacts who never act';
  return scheduleLabel(node.schedule);
}

export function describeSources(graph: WorkflowGraph, lookups: WorkflowLookups) {
  const parts = [
    ...graph.segmentIds.map(id => `Segment: ${lookups.segments?.find(item => item.id === id)?.name || `#${id}`}`),
    ...graph.formIds.map(id => `Lead form: ${lookups.forms?.find(item => item.id === id)?.name || `#${id}`}`),
  ];
  return parts.join(' · ') || 'No trigger yet';
}

function slotsFor(node: WorkflowNode | null): { branch: WorkflowBranch | null; label: string }[] {
  if (node && branches(node)) return [{ branch: 'yes', label: 'Yes' }, { branch: 'no', label: 'No' }];
  return [{ branch: null, label: '' }];
}

function anchorLabel(graph: WorkflowGraph, anchor: Anchor) {
  const parent = anchor.parentId === null ? null : graph.nodes.find(node => node.id === anchor.parentId);
  if (!parent) return 'Add the first step';
  if (anchor.branch === 'yes') return `Add a step on the yes path of “${parent.name}”`;
  if (anchor.branch === 'no') return `Add a step on the no path of “${parent.name}”`;
  return `Add a step after “${parent.name}”`;
}

/* ── Read-only outline (workflow list) and the editable outline (phone width) ─ */

function OutlineBranch({ graph, parentId, branch, lookups, issues, onSelect, onAdd }: {
  graph: WorkflowGraph; parentId: string | null; branch?: WorkflowBranch | null; lookups: WorkflowLookups;
  issues?: Map<string, WorkflowIssue[]>; onSelect?: (id: string) => void; onAdd?: (anchor: Anchor) => void;
}) {
  const children = childNodes(graph, parentId, branch === undefined ? undefined : branch);
  if (!children.length && !onAdd) return null;
  return <ol data-branch={branch ?? undefined}>
    {children.map(node => {
      const hasError = issues?.get(node.id)?.some(issue => issue.level === 'error');
      const content = <>
        <span className="ov-wf-kind">{nodeKindLabel(node)}</span>
        <span className="ov-wf-title">{node.name || 'Untitled step'}</span>
        <span className="ov-wf-meta">{describeNode(node, lookups)}</span>
        <span className={node.eventType === 'decision' ? 'ov-wf-wait' : 'ov-wf-meta'}>{timingLabel(graph, node)}</span>
      </>;
      return <li key={node.id}>
        {onSelect
          ? <button type="button" className="ov-wf-row" data-state={hasError ? 'error' : undefined} onClick={() => onSelect(node.id)}>{content}</button>
          : <div className="ov-wf-row" data-static="true">{content}</div>}
        {slotsFor(node).map(slot => {
          const nested = <OutlineBranch graph={graph} parentId={node.id} branch={slot.branch} lookups={lookups} issues={issues} onSelect={onSelect} onAdd={onAdd} />;
          const hasChildren = childNodes(graph, node.id, slot.branch).length > 0;
          if (!hasChildren && !onAdd) return null;
          return <div key={slot.branch ?? 'next'} className="ov-stack-sm" style={{ marginTop: 8 }}>
            {slot.branch ? <span className="ov-wf-branch">
              {slot.branch === 'yes' ? 'If yes' : node.eventType === 'decision' ? decisionWaitLabel(graph, node) ?? 'If no' : 'If no'}
            </span> : null}
            {nested}
            {onAdd ? <button type="button" className="ov-wf-add" aria-label={anchorLabel(graph, { parentId: node.id, branch: slot.branch })}
              onClick={() => onAdd({ parentId: node.id, branch: slot.branch })}>
              + {slot.branch === 'yes' ? 'Yes step' : slot.branch === 'no' ? 'No step' : 'Step'}
            </button> : null}
          </div>;
        })}
      </li>;
    })}
  </ol>;
}

/** Compact read-only outline for the workflow list. */
export function WorkflowOutline({ graph, lookups }: { graph: WorkflowGraph; lookups: WorkflowLookups }) {
  return <div className="ov-wf-list">
    <style>{canvasCss}</style>
    <OutlineBranch graph={graph} parentId={null} lookups={lookups} />
  </div>;
}

/* ── Canvas ─────────────────────────────────────────────────────────────────── */

function CanvasView({ graph, lookups, issues, selectedId, onSelect, onAdd }: {
  graph: WorkflowGraph; lookups: WorkflowLookups; issues: Map<string, WorkflowIssue[]>; selectedId: string | null;
  onSelect: (id: string) => void; onAdd: (anchor: Anchor) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const layout = layoutWorkflowGraph(graph);
  const width = workflowLayout.originX * 2 + layout.columns * workflowLayout.columnWidth;
  const height = workflowLayout.originY * 2 + layout.rows * workflowLayout.rowHeight;
  const entry = layoutPoint(layout.entry, cardWidth);
  const points = new Map(graph.nodes.map(node => [node.id, layoutPoint(layout.positions.get(node.id)!, cardWidth)]));
  const byId = new Map(graph.nodes.map(node => [node.id, node]));

  const anchorX = (x: number, node: WorkflowNode | null, branch: WorkflowBranch | null) =>
    x + (node && branches(node) ? (branch === 'no' ? cardWidth * 0.75 : cardWidth * 0.25) : cardWidth / 2);

  function focusNode(id: string | undefined) {
    if (!id) return;
    container.current?.querySelector<HTMLButtonElement>(`[data-node-id="${id}"]`)?.focus();
  }

  function onKey(event: KeyboardEvent<HTMLButtonElement>, node: WorkflowNode) {
    const siblings = childNodes(graph, node.parentId);
    const index = siblings.findIndex(item => item.id === node.id);
    const target = event.key === 'ArrowDown' ? childNodes(graph, node.id)[0]?.id
      : event.key === 'ArrowUp' ? node.parentId ?? undefined
        : event.key === 'ArrowLeft' ? siblings[index - 1]?.id
          : event.key === 'ArrowRight' ? siblings[index + 1]?.id : undefined;
    if (target) {
      event.preventDefault();
      focusNode(target);
    }
  }

  const edges: ReactNode[] = [];
  for (const node of graph.nodes) {
    const point = points.get(node.id)!;
    const parent = node.parentId === null ? null : byId.get(node.parentId) ?? null;
    const from = parent ? points.get(parent.id)! : entry;
    const startX = anchorX(from.x, parent, node.branch);
    const startY = from.y + cardHeight;
    const endX = point.x + cardWidth / 2;
    const middle = (startY + point.y) / 2;
    edges.push(<path key={node.id} data-branch={node.branch ?? undefined}
      d={`M ${startX} ${startY} C ${startX} ${middle}, ${endX} ${middle}, ${endX} ${point.y}`} />);
  }

  const addButtons: ReactNode[] = [];
  const pushAdd = (node: WorkflowNode | null, x: number, y: number) => {
    for (const slot of slotsFor(node)) {
      const anchor = { parentId: node ? node.id : null, branch: slot.branch };
      addButtons.push(<button key={`${anchor.parentId ?? 'entry'}-${slot.branch ?? 'next'}`} type="button" className="ov-wf-add"
        style={{ left: anchorX(x, node, slot.branch), top: y + cardHeight + 10 }}
        aria-label={anchorLabel(graph, anchor)} onClick={() => onAdd(anchor)}>
        {slot.branch ? `+ ${slot.label}` : '+'}
      </button>);
    }
  };
  pushAdd(null, entry.x, entry.y);
  for (const node of graph.nodes) {
    const point = points.get(node.id)!;
    pushAdd(node, point.x, point.y);
  }

  return <div className="ov-wf-scroll">
    <div ref={container} className="ov-wf-canvas" role="group" aria-label="Workflow canvas. Use the arrow keys to move between steps."
      style={{ width, height }}>
      <svg className="ov-wf-edges" width={width} height={height} aria-hidden="true">{edges}</svg>
      <div className="ov-wf-card" data-kind="entry" style={{ left: entry.x, top: entry.y }}>
        <span className="ov-wf-kind">Start</span>
        <span className="ov-wf-title">Contacts enter from</span>
        <span className="ov-wf-meta">{describeSources(graph, lookups)}</span>
      </div>
      {graph.nodes.map(node => {
        const point = points.get(node.id)!;
        const nodeIssues = issues.get(node.id) ?? [];
        const hasError = nodeIssues.some(issue => issue.level === 'error');
        const timing = timingLabel(graph, node);
        return <button key={node.id} type="button" className="ov-wf-card" data-node-id={node.id}
          data-kind={node.eventType} data-state={hasError ? 'error' : undefined} data-selected={selectedId === node.id}
          style={{ left: point.x, top: point.y }} onClick={() => onSelect(node.id)} onKeyDown={event => onKey(event, node)}
          aria-label={`${nodeKindLabel(node)}: ${node.name}. ${describeNode(node, lookups)}. ${timing}.${hasError ? ' Needs attention.' : ''}`}>
          <span className="ov-wf-kind">{nodeKindLabel(node)}{hasError ? ' · Fix this step' : ''}</span>
          <span className="ov-wf-title">{node.name || 'Untitled step'}</span>
          <span className="ov-wf-meta">{describeNode(node, lookups)}</span>
          <span className={node.eventType === 'decision' ? 'ov-wf-wait' : 'ov-wf-meta'}>{timing}</span>
        </button>;
      })}
      {addButtons}
    </div>
  </div>;
}

/* ── Node settings drawer ──────────────────────────────────────────────────── */

function IdPicker({ label, ids, options, onChange, color }: {
  label: string; ids: number[]; options: { value: string; label: string }[]; onChange: (ids: number[]) => void; color: 'green' | 'red';
}) {
  return <div className="ov-stack-sm">
    <Selector label={label} placeholder="Choose a segment" value={null} hasClear
      options={options.filter(option => !ids.includes(Number(option.value)))}
      onChange={value => { const id = Number(value); if (id) onChange([...ids, id]); }} />
    {ids.length ? <div className="ov-tags">{ids.map(id => <Token key={id} size="sm" color={color}
      label={options.find(option => Number(option.value) === id)?.label || `Segment ${id}`}
      onRemove={() => onChange(ids.filter(item => item !== id))} />)}</div> : null}
  </div>;
}

function ScheduleEditor({ node, parent, onChange }: {
  node: WorkflowNode; parent: WorkflowNode | null; onChange: (schedule: WorkflowSchedule) => void;
}) {
  const schedule = node.schedule;
  const onNoPath = parent?.eventType === 'decision' && node.branch === 'no';
  const mode = schedule.mode === 'interval' || schedule.mode === 'date' ? schedule.mode : schedule.mode === 'optimized' ? 'optimized' : 'immediate';
  const set = (parts: Partial<WorkflowSchedule>) => onChange({ ...schedule, ...parts });
  const localDate = schedule.date && Number.isFinite(Date.parse(schedule.date))
    ? new Date(Date.parse(schedule.date) - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
  const days = new Set(schedule.restrictedDaysOfWeek);

  return <div className="ov-stack-sm">
    <Text type="label">When this step runs</Text>
    {onNoPath ? <Text type="supporting" color="secondary">
      The wait counts from when the step before “{parent?.name}” ran. Contacts who have not acted by then take this path.
    </Text> : null}
    <SegmentedControl label="When this step runs" value={mode} onChange={value => {
      if (value === 'immediate') set({ mode: 'immediate', interval: 0, unit: null });
      if (value === 'interval') set({ mode: 'interval', interval: schedule.interval || 1, unit: schedule.unit ?? 'd' });
      if (value === 'date') set({ mode: 'date' });
    }}>
      {!onNoPath || node.eventType === 'condition' ? <SegmentedControlItem value="immediate" label="Right away" /> : null}
      <SegmentedControlItem value="interval" label="After a wait" />
      <SegmentedControlItem value="date" label="On a date" />
      {mode === 'optimized' ? <SegmentedControlItem value="optimized" label="Best time" /> : null}
    </SegmentedControl>
    {mode === 'interval' ? <div className="ov-form-grid">
      <NumberInput label="Wait" min={1} max={1_000_000} isIntegerOnly value={schedule.interval || 1}
        onChange={value => set({ interval: value })} />
      <Selector label="Unit" value={schedule.unit ?? 'd'} options={unitOptions}
        onChange={value => set({ unit: (value as WorkflowIntervalUnit) || 'd' })} />
    </div> : null}
    {mode === 'date' ? <Field label="Date and time" inputID={`ov-wf-date-${node.id}`}>
      <input id={`ov-wf-date-${node.id}`} className="ov-wf-native" type="datetime-local" value={localDate}
        onChange={event => set({ date: event.target.value ? new Date(event.target.value).toISOString() : null })} />
    </Field> : null}
    {mode === 'optimized' ? <Text type="supporting" color="secondary">The engine picks the best time for each contact.</Text> : null}
    {mode !== 'date' ? <>
      <div className="ov-form-grid">
        <Field label="Send window start" inputID={`ov-wf-start-${node.id}`}>
          <input id={`ov-wf-start-${node.id}`} className="ov-wf-native" type="time" value={schedule.restrictedStartHour ?? ''}
            onChange={event => set({ restrictedStartHour: event.target.value || null })} />
        </Field>
        <Field label="Send window end" inputID={`ov-wf-stop-${node.id}`}>
          <input id={`ov-wf-stop-${node.id}`} className="ov-wf-native" type="time" value={schedule.restrictedStopHour ?? ''}
            onChange={event => set({ restrictedStopHour: event.target.value || null })} />
        </Field>
      </div>
      <Text type="label">Only on these days</Text>
      <div className="ov-wf-days">{weekdays.map(day => <CheckboxInput key={day.value} label={day.label} value={days.has(day.value)}
        onChange={checked => {
          const next = new Set(days);
          if (checked) next.add(day.value); else next.delete(day.value);
          set({ restrictedDaysOfWeek: [...next].sort() });
        }} />)}</div>
    </> : null}
  </div>;
}

function NodeDrawer({ graph, node, lookups, issues, onChange, onGraph, onDelete, onClose }: {
  graph: WorkflowGraph; node: WorkflowNode; lookups: WorkflowLookups; issues: WorkflowIssue[];
  onChange: (node: WorkflowNode) => void; onGraph: (graph: WorkflowGraph) => void; onDelete: () => void; onClose: () => void;
}) {
  const spec = workflowNodeSpec(node.type);
  const parent = node.parentId === null ? null : graph.nodes.find(item => item.id === node.parentId) ?? null;
  const [json, setJson] = useState(() => JSON.stringify(node.properties, null, 2));
  const [jsonError, setJsonError] = useState('');
  const setProp = (key: string, value: unknown) => onChange({ ...node, properties: { ...node.properties, [key]: value } });

  const emailOptions = (lookups.emails ?? []).filter(email => email.published || email.id === Number(node.properties.email))
    .map(email => ({ value: String(email.id), label: email.name, description: email.subject }));
  const segmentOptions = (lookups.segments ?? []).map(segment => ({ value: String(segment.id), label: segment.name }));
  const stageOptions = (lookups.stages ?? []).map(stage => ({ value: String(stage.id), label: stage.name }));
  const wait = node.eventType === 'decision' ? decisionWait(graph, node.id) : null;
  const hasNoPath = node.eventType === 'decision' && childNodes(graph, node.id, 'no').length > 0;

  return <SlideDrawer title={node.name || 'Step'} subtitle={spec ? spec.label : `Advanced step: ${node.type}`} onClose={onClose} width={480}>
    <div className="ov-stack-sm">
      {issues.length ? <ul className="ov-wf-issues">{issues.map((issue, index) => <li key={index}>
        <Text color={issue.level === 'error' ? undefined : 'secondary'} weight={issue.level === 'error' ? 'semibold' : undefined}>{issue.message}</Text>
      </li>)}</ul> : null}
      <TextInput label="Step name" isRequired value={node.name} onChange={name => onChange({ ...node, name })} />
      {spec ? <Text type="supporting" color="secondary">{spec.description}</Text> : <Text type="supporting" color="secondary">
        The console has no form for this engine step yet. Its settings are kept exactly as saved; edit them as JSON with care.
      </Text>}

      {spec?.fields.map(field => {
        const value = node.properties[field.key];
        switch (field.kind) {
          case 'email':
            return <Selector key={field.key} label={field.label} placeholder="Choose a published journey email" hasClear
              value={Number(value) ? String(value) : null} options={emailOptions} onChange={next => setProp(field.key, Number(next) || 0)} />;
          case 'stage':
            return <Selector key={field.key} label={field.label} placeholder="Choose a lifecycle stage" hasClear
              value={Number(value) ? String(value) : null} options={stageOptions} onChange={next => setProp(field.key, Number(next) || 0)} />;
          case 'integer':
            return <NumberInput key={field.key} label={field.label} description={field.hint} min={-10000} max={10000} isIntegerOnly
              value={Number(value) || 0} onChange={next => setProp(field.key, next)} />;
          case 'tags':
            return <TextInput key={field.key} label={field.label} description="Separate tags with commas." value={tagList(value).join(', ')}
              onChange={next => setProp(field.key, parseCsv(next))} />;
          case 'segments':
            return <IdPicker key={field.key} label={field.label} ids={idsOf(value)} options={segmentOptions}
              color={field.key === 'removeFromLists' ? 'red' : 'green'} onChange={ids => setProp(field.key, ids)} />;
        }
      })}

      {!spec ? <>
        <TextArea label="Engine settings (JSON)" rows={8} value={json} onChange={next => {
          setJson(next);
          try {
            const parsed: unknown = JSON.parse(next);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
            setJsonError('');
            onChange({ ...node, properties: parsed as Record<string, unknown> });
          } catch {
            setJsonError('Write a JSON object, for example {"key": "value"}. The last valid settings are kept.');
          }
        }} />
        {jsonError ? <Text type="supporting">{jsonError}</Text> : null}
      </> : null}

      {node.eventType === 'decision' ? <div className="ov-stack-sm">
        <Text type="label">Contacts who do not act</Text>
        {hasNoPath ? <>
          <Text weight="semibold">{decisionWaitLabel(graph, node)}</Text>
          <div className="ov-form-grid">
            <NumberInput label="Wait up to" min={1} max={1_000_000} isIntegerOnly
              value={wait?.kind === 'interval' ? wait.interval : 3}
              onChange={value => onGraph(setDecisionWait(graph, node.id, value, wait?.kind === 'interval' ? wait.unit : 'd'))} />
            <Selector label="Unit" value={wait?.kind === 'interval' ? wait.unit : 'd'} options={unitOptions}
              onChange={value => onGraph(setDecisionWait(graph, node.id, wait?.kind === 'interval' ? wait.interval : 3, (value as WorkflowIntervalUnit) || 'd'))} />
          </div>
          <Text type="supporting" color="secondary">After this wait, contacts who have not acted take the no path.</Text>
        </> : <Text type="supporting" color="secondary">
          Add a step on the no path to move contacts on when they do not act. You then choose how long to wait.
        </Text>}
      </div> : <ScheduleEditor node={node} parent={parent} onChange={schedule => onChange({ ...node, schedule })} />}

      <FormActions>
        <Button variant="ghost" label="Delete step" icon={<Trash2 size={15} />} onClick={onDelete} />
        <Button variant="primary" label="Done" onClick={onClose} />
      </FormActions>
    </div>
  </SlideDrawer>;
}

function AddStepModal({ graph, anchor, onPick, onClose }: {
  graph: WorkflowGraph; anchor: Anchor; onPick: (spec: WorkflowNodeSpec) => void; onClose: () => void;
}) {
  const parent = anchor.parentId === null ? null : graph.nodes.find(node => node.id === anchor.parentId) ?? null;
  const allowed = workflowNodeSpecs.filter(spec => {
    if (spec.eventType === 'decision' && parent?.eventType === 'decision') return false;
    if (spec.parentTypes && (!parent || !spec.parentTypes.includes(parent.type))) return false;
    return true;
  });
  const groups: [string, WorkflowNodeSpec[]][] = [
    ['Actions', allowed.filter(spec => spec.eventType === 'action')],
    ['Decisions', allowed.filter(spec => spec.eventType === 'decision')],
    ['Conditions', allowed.filter(spec => spec.eventType === 'condition')],
  ];
  return <Modal title={anchorLabel(graph, anchor)} onClose={onClose}>
    {groups.filter(([, specs]) => specs.length).map(([title, specs]) => <div key={title} className="ov-stack-sm">
      <Text type="label">{title}</Text>
      {specs.map(spec => <button key={spec.type} type="button" className="ov-wf-row" onClick={() => onPick(spec)}>
        <span className="ov-wf-title">{spec.label}</span>
        <span className="ov-wf-meta">{spec.description}</span>
      </button>)}
    </div>)}
    {parent?.type !== 'email.send' ? <Text type="supporting" color="secondary">Email decisions can follow a Send email step.</Text> : null}
    <FormActions><Button label="Cancel" onClick={onClose} /></FormActions>
  </Modal>;
}

/* ── Editor ─────────────────────────────────────────────────────────────────── */

export function WorkflowCanvasEditor({ workflow, onClose, onDone }: { workflow?: Workflow; onClose: () => void; onDone: () => void }) {
  const emails = useResource<JourneyEmail[]>('/journey-emails');
  const segments = useResource<Segment[]>('/segments');
  const forms = useResource<LeadForm[]>('/forms');
  const stages = useResource<Stage[]>('/stages');
  const action = useAction();
  const lookups: WorkflowLookups = { emails: emails.data, segments: segments.data, forms: forms.data, stages: stages.data };

  const [name, setName] = useState(workflow?.name ?? '');
  const [description, setDescription] = useState(workflow?.description ?? '');
  const [template, setTemplate] = useState('blank');
  const [graph, setGraph] = useState<WorkflowGraph>(() => workflow ? workflowGraphOf(workflow) : templateGraph('blank'));
  const [removed, setRemoved] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState<Anchor | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [view, setView] = useState<'canvas' | 'list'>(() =>
    typeof window !== 'undefined' && window.matchMedia?.('(max-width: 720px)').matches ? 'list' : 'canvas');
  const counter = useRef(1);

  const issues = validateWorkflowGraph(graph);
  const issuesByNode = new Map<string, WorkflowIssue[]>();
  for (const issue of issues) if (issue.nodeId) issuesByNode.set(issue.nodeId, [...(issuesByNode.get(issue.nodeId) ?? []), issue]);
  const errors = issues.filter(issue => issue.level === 'error');
  const selected = selectedId ? graph.nodes.find(node => node.id === selectedId) ?? null : null;

  const publishedSegments = (segments.data ?? []).filter(segment => segment.published || graph.segmentIds.includes(segment.id));
  const publishedForms = (forms.data ?? []).filter(form => form.published || graph.formIds.includes(form.id));

  function newId() {
    const taken = new Set(graph.nodes.map(node => node.id));
    let id = `new_c${counter.current++}`;
    while (taken.has(id)) id = `new_c${counter.current++}`;
    return id;
  }

  function updateNode(next: WorkflowNode) {
    setGraph(current => ({ ...current, nodes: current.nodes.map(node => node.id === next.id ? next : node) }));
  }

  function addStep(spec: WorkflowNodeSpec, anchor: Anchor) {
    const id = newId();
    const parent = anchor.parentId === null ? null : graph.nodes.find(node => node.id === anchor.parentId) ?? null;
    let schedule = spec.eventType === 'decision' ? emptySchedule(null) : emptySchedule();
    if (parent?.eventType === 'decision' && anchor.branch === 'no' && spec.eventType !== 'decision') {
      const wait = decisionWait(graph, parent.id);
      schedule = wait.kind === 'interval' ? intervalSchedule(wait.interval, wait.unit) : intervalSchedule(1, 'd');
    }
    const node: WorkflowNode = {
      id, parentId: anchor.parentId, branch: anchor.branch, eventType: spec.eventType, type: spec.type, name: spec.label,
      description: '', properties: structuredClone(spec.defaults), schedule,
    };
    // Insert: the steps that hung from this anchor now follow the new step.
    setGraph(current => ({
      ...current,
      nodes: [...current.nodes.map(item => item.parentId === anchor.parentId && item.branch === anchor.branch
        ? { ...item, parentId: id, branch: branches(node) ? 'yes' as const : null }
        : item), node],
    }));
    setAdding(null);
    setSelectedId(id);
  }

  function deleteStep(id: string) {
    const ids = subtreeIds(graph, id);
    setGraph(current => ({ ...current, nodes: current.nodes.filter(node => !ids.has(node.id)) }));
    setRemoved(current => [...new Set([...current, ...[...ids].filter(item => /^\d+$/.test(item))])]);
    setSelectedId(null);
    setDeleting(null);
  }

  function save() {
    void action.run(async () => {
      const input: WorkflowInput = {
        name: name.trim(),
        description: description.trim(),
        segmentId: graph.segmentIds[0] ?? 0,
        ...(graph.formIds[0] ? { formId: graph.formIds[0] } : {}),
        steps: [],
        graph,
        removedNodeIds: removed,
      };
      await api(workflow ? `${workflowPath}/${workflow.id}` : workflowPath, workflow ? 'PATCH' : 'POST', input);
      onDone();
    });
  }

  const deletingNode = deleting ? graph.nodes.find(node => node.id === deleting) : undefined;
  const deletingCount = deleting ? subtreeIds(graph, deleting).size : 0;

  return <Panel title={workflow ? `Edit automation: ${workflow.name}` : 'Create automation'}
    description="Saved as a draft. The engine confirms every step before the editor closes."
    action={<Button size="sm" variant="ghost" label="Back to workflows" icon={<ArrowLeft size={14} />} onClick={onClose} />}>
    <style>{canvasCss}</style>
    <div className="ov-stack-sm">
      {!workflow ? <Selector label="Start from" value={template} options={workflowTemplates.map(item => ({ value: item.id, label: item.name, description: item.description }))}
        onChange={value => {
          const id = value ?? 'blank';
          setTemplate(id);
          const next = templateGraph(id);
          setGraph(current => ({ ...next, segmentIds: current.segmentIds, formIds: current.formIds }));
          if (id !== 'blank' && !name.trim()) setName(workflowTemplates.find(item => item.id === id)?.name ?? '');
          setSelectedId(null);
        }} /> : null}
      <div className="ov-form-grid">
        <TextInput label="Workflow name" isRequired value={name} onChange={setName} />
        <TextInput label="Description" isOptional value={description} onChange={setDescription} />
      </div>
      <div className="ov-form-grid">
        <div className="ov-stack-sm">
          <Selector label="Start for contacts in segment" placeholder="Add a published segment" value={null} hasClear isLoading={segments.loading}
            options={publishedSegments.filter(segment => !graph.segmentIds.includes(segment.id)).map(segment => ({ value: String(segment.id), label: segment.name }))}
            onChange={value => { const id = Number(value); if (id) setGraph(current => ({ ...current, segmentIds: [...current.segmentIds, id] })); }} />
          {graph.segmentIds.length ? <div className="ov-tags">{graph.segmentIds.map(id => <Token key={id} size="sm"
            label={lookups.segments?.find(item => item.id === id)?.name || `Segment ${id}`}
            onRemove={() => setGraph(current => ({ ...current, segmentIds: current.segmentIds.filter(item => item !== id) }))} />)}</div> : null}
        </div>
        <div className="ov-stack-sm">
          <Selector label="Start when a lead form is sent" placeholder="Add a published lead form" value={null} hasClear isLoading={forms.loading}
            options={publishedForms.filter(form => !graph.formIds.includes(form.id)).map(form => ({ value: String(form.id), label: form.name }))}
            onChange={value => { const id = Number(value); if (id) setGraph(current => ({ ...current, formIds: [...current.formIds, id] })); }} />
          {graph.formIds.length ? <div className="ov-tags">{graph.formIds.map(id => <Token key={id} size="sm"
            label={lookups.forms?.find(item => item.id === id)?.name || `Lead form ${id}`}
            onRemove={() => setGraph(current => ({ ...current, formIds: current.formIds.filter(item => item !== id) }))} />)}</div> : null}
        </div>
      </div>
      <Feedback error={segments.error || emails.error || forms.error || stages.error} />

      <div className="ov-wf-toolbar">
        <Text type="supporting" color="secondary">
          {graph.nodes.length} of {maxWorkflowNodes} steps. Select a step to edit it; use + to add a step at that point.
        </Text>
        <SegmentedControl label="Workflow view" size="sm" value={view} onChange={value => setView(value === 'list' ? 'list' : 'canvas')}>
          <SegmentedControlItem value="canvas" label="Canvas" icon={<LayoutGrid size={14} />} />
          <SegmentedControlItem value="list" label="Outline" icon={<ListTree size={14} />} />
        </SegmentedControl>
      </div>

      {view === 'canvas'
        ? <CanvasView graph={graph} lookups={lookups} issues={issuesByNode} selectedId={selectedId} onSelect={setSelectedId} onAdd={setAdding} />
        : <div className="ov-wf-list">
          <div className="ov-wf-row" data-static="true">
            <span className="ov-wf-kind">Start</span>
            <span className="ov-wf-meta">{describeSources(graph, lookups)}</span>
          </div>
          <OutlineBranch graph={graph} parentId={null} lookups={lookups} issues={issuesByNode} onSelect={setSelectedId} onAdd={setAdding} />
          <button type="button" className="ov-wf-add" aria-label={anchorLabel(graph, { parentId: null, branch: null })}
            onClick={() => setAdding({ parentId: null, branch: null })}><Plus size={12} /> First step</button>
        </div>}

      {issues.length ? <div className="ov-stack-sm">
        <Text type="label">{errors.length ? `Fix ${errors.length} problem${errors.length === 1 ? '' : 's'} before saving` : 'Worth checking'}</Text>
        <ul className="ov-wf-issues">{issues.map((issue, index) => {
          const node = issue.nodeId ? graph.nodes.find(item => item.id === issue.nodeId) : undefined;
          return <li key={index}>
            <Text color={issue.level === 'error' ? undefined : 'secondary'}>{node ? `${node.name || 'Step'}: ` : ''}{issue.message}</Text>
            {node ? <> <Button size="sm" variant="ghost" label="Show step" onClick={() => setSelectedId(node.id)} /></> : null}
          </li>;
        })}</ul>
      </div> : null}

      <Feedback error={action.error} />
      <FormActions>
        <Button label="Cancel" onClick={onClose} />
        <Button variant="primary" label={workflow ? 'Save changes' : 'Save workflow'} isLoading={action.busy}
          isDisabled={Boolean(errors.length) || !name.trim()} onClick={save} />
      </FormActions>
    </div>

    {selected ? <NodeDrawer key={selected.id} graph={graph} node={selected} lookups={lookups} issues={issuesByNode.get(selected.id) ?? []}
      onChange={updateNode} onGraph={setGraph} onDelete={() => setDeleting(selected.id)} onClose={() => setSelectedId(null)} /> : null}
    {adding ? <AddStepModal graph={graph} anchor={adding} onClose={() => setAdding(null)} onPick={spec => addStep(spec, adding)} /> : null}
    {deletingNode ? <ConfirmDialog
      title={`Delete “${deletingNode.name || 'this step'}”`}
      description={deletingCount > 1
        ? `This deletes the step and the ${deletingCount - 1} step${deletingCount === 2 ? '' : 's'} under it when you save. Contacts waiting at them leave the workflow.`
        : 'This deletes the step when you save. Contacts waiting at it leave the workflow.'}
      actionLabel="Delete step"
      onClose={() => setDeleting(null)}
      onConfirm={() => deleteStep(deletingNode.id)} /> : null}
  </Panel>;
}

