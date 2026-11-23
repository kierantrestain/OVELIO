'use client';

/*
 * AUT-06: where a contact is in their workflows, and why.
 * - <WorkflowRunLog contactId={…} /> lists every workflow step the engine logged for one contact (contact page).
 * - <WorkflowRunView workflow={…} contactId={…} /> shows one workflow with the contact's position highlighted.
 * Both read Mautic's per-contact campaign event log through the console routes in routes/automations.ts.
 */

import { GitBranch } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import type { Workflow, WorkflowContactRun, WorkflowRunEntry, WorkflowRunLog as RunLog } from '@/contracts';
import { currentRunNodes, entryPath, workflowNodeSpec, workflowRunStates } from '@/contracts';
import { date, useResource } from './client';
import { AsyncState, Empty, Modal, StatusBadge, type Tone } from './ui';
import { runStateLabel, useWorkflowLookups, WorkflowRunCanvas, workflowGraphOf } from './workflow-canvas';

const logCss = `
.ov-run-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.ov-run-item { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px 10px; align-items: baseline; padding: 8px 10px; border: 1px solid var(--color-border); border-radius: var(--radius-element, 8px); background: var(--color-background-surface); }
.ov-run-item > :first-child { grid-row: span 2; }
.ov-run-detail { font-size: 12px; color: var(--color-text-secondary); overflow-wrap: anywhere; }
.ov-run-group { display: grid; gap: 8px; padding: 12px; border: 1px solid var(--color-border); border-radius: var(--radius-container, 12px); }
.ov-run-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
`;

function entryBadge(entry: WorkflowRunEntry): { label: string; tone: Tone } {
  switch (entry.state) {
    case 'executed': return entry.reason ? { label: 'Ran with an error', tone: 'warning' } : { label: 'Done', tone: 'success' };
    case 'scheduled': return { label: 'Scheduled', tone: 'info' };
    case 'failed': return { label: entry.scheduledFor ? 'Failed, will retry' : 'Failed', tone: 'error' };
    case 'cancelled': return { label: 'Cancelled', tone: 'neutral' };
  }
}

function entryDetail(entry: WorkflowRunEntry) {
  const path = entryPath(entry);
  const parts = [
    entry.state === 'scheduled' ? `Runs ${date(entry.scheduledFor)}` : entry.triggeredAt ? `${entry.state === 'failed' ? 'Tried' : 'Ran'} ${date(entry.triggeredAt)}` : null,
    entry.state === 'failed' && entry.scheduledFor ? `retry ${date(entry.scheduledFor)}` : null,
    path ? `${path === 'no' && entry.eventType !== 'condition' && entry.nonAction ? 'did not act, ' : ''}took the ${path} path` : null,
    entry.reason,
    entry.deleted ? 'step since deleted' : null,
    entry.rotation && entry.rotation > 1 ? `run ${entry.rotation}` : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

function EntryList({ entries }: { entries: WorkflowRunEntry[] }) {
  return <ol className="ov-run-list">{entries.map((entry, index) => {
    const badge = entryBadge(entry);
    return <li key={`${entry.logId ?? index}:${entry.nodeId}:${entry.triggeredAt ?? entry.scheduledFor ?? ''}`} className="ov-run-item">
      <StatusBadge label={badge.label} tone={badge.tone} />
      <Text weight="semibold">{entry.nodeName || workflowNodeSpec(entry.nodeType)?.label || `Step ${entry.nodeId}`}</Text>
      <span className="ov-run-detail">{entryDetail(entry) || '—'}</span>
    </li>;
  })}</ol>;
}

/** "Waiting at Opened offer? · Scheduled: Reminder on 4 Dec" or the last thing that happened. */
function positionSummary(workflow: Workflow | undefined, entries: WorkflowRunEntry[], removed: boolean) {
  if (removed) return 'Removed from this workflow.';
  if (workflow) {
    const graph = workflowGraphOf(workflow);
    const states = workflowRunStates(graph, entries, { enrolled: true });
    const current = currentRunNodes(graph, states);
    if (current.length) return current.map(node => `${node.name}: ${runStateLabel(states.get(node.id))}`).join(' · ');
  }
  const scheduled = entries.filter(entry => entry.state === 'scheduled' || (entry.state === 'failed' && entry.scheduledFor));
  if (scheduled.length) return scheduled.map(entry => `${entry.nodeName}: ${entry.state === 'failed' ? 'retry' : 'scheduled'} ${date(entry.scheduledFor)}`).join(' · ');
  const last = entries[0];
  return last ? `Last step: ${last.nodeName} (${entryBadge(last).label.toLowerCase()}) ${date(last.triggeredAt ?? last.scheduledFor)}` : 'No steps logged yet.';
}

/** One workflow with the contact's position highlighted on the canvas. */
export function WorkflowRunView({ workflow, contactId }: { workflow: Workflow; contactId: number }) {
  const run = useResource<WorkflowContactRun>(`/workflows/${workflow.id}/contacts/${contactId}/log`);
  const graph = workflowGraphOf(workflow);
  const { lookups } = useWorkflowLookups(graph, ['emails', 'segments', 'forms', 'stages']);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  if (!run.data) return <AsyncState loading={run.loading} error={run.error} retry={run.refresh} />;
  const membership = run.data.membership;
  const enrolled = Boolean(membership && !membership.manuallyRemoved);
  const states = workflowRunStates(graph, run.data.entries, { enrolled });
  const current = currentRunNodes(graph, states);
  const selected = selectedId ? graph.nodes.find(node => node.id === selectedId) : undefined;
  const selectedEntries = selected ? run.data.entries.filter(entry => entry.nodeId === selected.id) : [];
  const orphaned = run.data.entries.filter(entry => !graph.nodes.some(node => node.id === entry.nodeId));
  return <div className="ov-stack-sm">
    <style>{logCss}</style>
    <Text type="supporting" color="secondary">
      {membership
        ? `Added ${date(membership.dateAdded)}${membership.manuallyAdded ? ' by hand' : ''}${membership.manuallyRemoved ? ', since removed' : ''}${membership.dateLastExited ? `, last left ${date(membership.dateLastExited)}` : ''}${membership.rotation && membership.rotation > 1 ? `, run ${membership.rotation}` : ''}.`
        : run.data.entries.length ? 'The engine has steps logged but no current membership for this contact.' : 'This contact has not been added to this workflow.'}
    </Text>
    <Text weight="semibold">
      {current.length ? `Now at: ${current.map(node => `${node.name} (${runStateLabel(states.get(node.id))})`).join(' · ')}`
        : positionSummary(workflow, run.data.entries, Boolean(membership?.manuallyRemoved))}
    </Text>
    {!run.data.complete ? <Text type="supporting" color="secondary">Only the most recent log rows are shown; the engine holds more.</Text> : null}
    <WorkflowRunCanvas graph={graph} lookups={lookups} runStates={states} selectedId={selectedId} onSelect={setSelectedId} />
    {selected ? <div className="ov-stack-sm">
      <Heading level={3}>{selected.name}</Heading>
      <Text>{runStateLabel(states.get(selected.id))}</Text>
      {selectedEntries.length ? <EntryList entries={selectedEntries} /> : <Text type="supporting" color="secondary">The engine has no log rows for this step for this contact.</Text>}
    </div> : <Text type="supporting" color="secondary">Select a step to see its log rows.</Text>}
    {orphaned.length ? <div className="ov-stack-sm">
      <Text type="label">Steps no longer in this workflow</Text>
      <EntryList entries={orphaned} />
    </div> : null}
  </div>;
}

/** WorkflowRunView in a dialog; loads the workflow when only its id is known. */
export function WorkflowRunModal({ workflowId, workflow, contactId, onClose }: {
  workflowId: number; workflow?: Workflow; contactId: number; onClose: () => void;
}) {
  const loaded = useResource<Workflow>(workflow ? null : `/workflows/${workflowId}`);
  const current = workflow ?? loaded.data;
  return <Modal title={current ? `${current.name}: contact #${contactId}` : `Workflow #${workflowId}: contact #${contactId}`} onClose={onClose} size="wide">
    {current ? <WorkflowRunView workflow={current} contactId={contactId} /> : <AsyncState loading={loaded.loading} error={loaded.error} retry={loaded.refresh} />}
  </Modal>;
}

/**
 * Every workflow step the engine logged for one contact, grouped by workflow, newest first. Mount it on the contact
 * page: `<WorkflowRunLog contactId={contact.id} />`.
 */
export function WorkflowRunLog({ contactId }: { contactId: number }) {
  const log = useResource<RunLog>(`/workflows/contact-log/${contactId}`);
  const [open, setOpen] = useState<number | null>(null);
  if (!log.data) return <AsyncState loading={log.loading} error={log.error} retry={log.refresh} />;
  const groups = new Map<number, WorkflowRunEntry[]>();
  for (const entry of log.data.entries) groups.set(entry.workflowId, [...(groups.get(entry.workflowId) ?? []), entry]);
  if (!groups.size) return <Empty title="No workflow activity" description="The engine has not logged any workflow step for this contact yet." />;
  return <div className="ov-stack-sm">
    <style>{logCss}</style>
    {!log.data.complete ? <Text type="supporting" color="secondary">Showing the most recent workflow log rows; older rows are not loaded.</Text> : null}
    {[...groups.entries()].map(([workflowId, entries]) => <section key={workflowId} className="ov-run-group" aria-label={entries[0].workflowName || `Workflow ${workflowId}`}>
      <div className="ov-run-head">
        <Heading level={3}>{entries[0].workflowName || `Workflow #${workflowId}`}</Heading>
        <Button size="sm" variant="ghost" label="Show in workflow" icon={<GitBranch size={14} />} onClick={() => setOpen(workflowId)} />
      </div>
      <Text weight="semibold">{positionSummary(undefined, entries, false)}</Text>
      <EntryList entries={entries} />
    </section>)}
    {open !== null ? <WorkflowRunModal workflowId={open} contactId={contactId} onClose={() => setOpen(null)} /> : null}
  </div>;
}
