'use client';

// Sales › Pipelines (stages with drag reorder), Sales › Sequences, Settings › Mailboxes and Sales › Inbox.
import '@/styles/crm.css';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDown, ArrowUp, Download, GripVertical, Inbox, Plus, Trash2, Users } from 'lucide-react';
import NextLink from 'next/link';
import { useState } from 'react';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { IconButton } from '@astryxdesign/core/IconButton';
import { MultiSelector } from '@astryxdesign/core/MultiSelector';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { Table } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useToast } from '@astryxdesign/core/Toast';
import type {
  InboxConversation, InboxThread, InboxThreadSummary, Mailbox, MailboxOverview, Pipeline, PipelineStage, Sequence, SequenceEnrolment,
  SequenceInput, SequenceStep, TaskType,
} from '@/contracts/crm';
import { taskTypeLabels } from '@/contracts/crm';
import { mergeTags } from '@/contracts/merge-tags';
import { api, message, saveFile, useAction, useResource } from '../client';
import { useUser } from '../shell';
import { AsyncState, ConfirmDialog, Empty, Feedback, FormActions, Modal, PageHeader, Panel, SlideDrawer, StatusBadge, Toolbar } from '../ui';
import { ContactPicker, relative, shortDate, dateTime } from './common';
import type { Member, RecordOption } from './common';

/* ── Pipelines ────────────────────────────────────────────────────────── */

function StageRow({ stage, pipeline, onSaved, onDelete }: { stage: PipelineStage; pipeline: Pipeline; onSaved: (pipeline: Pipeline) => void; onDelete: (stage: PipelineStage) => void }) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition } = useSortable({ id: stage.id, disabled: stage.outcome !== 'open' });
  const action = useAction();
  const [name, setName] = useState(stage.name);
  const save = (body: Record<string, unknown>) => void action.run(async () => onSaved(await api<Pipeline>(`/sales/stages/${stage.id}`, 'PATCH', body)));
  return <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className="ov-crm-stage-row">
    {stage.outcome === 'open' ? <button type="button" ref={setActivatorNodeRef} className="ov-crm-handle" aria-label={`Reorder ${stage.name}`} {...attributes} {...listeners}><GripVertical size={16} /></button> : <span />}
    <TextInput label="Stage name" isLabelHidden value={name} onChange={setName} onBlur={() => { if (name.trim() && name.trim() !== stage.name) save({ name: name.trim() }); }} />
    <NumberInput label="Win probability" isLabelHidden units="%" min={0} max={100} isIntegerOnly value={stage.probability}
      onChange={value => { if (value != null && value !== stage.probability) save({ probability: value }); }} />
    <StatusBadge label={stage.outcome === 'won' ? 'Won stage' : stage.outcome === 'lost' ? 'Lost stage' : 'Open'} tone={stage.outcome === 'won' ? 'success' : stage.outcome === 'lost' ? 'error' : 'neutral'} />
    {stage.outcome === 'open' ? <NumberInput label="Rotting after (days)" isLabelHidden placeholder="Rotting days" min={1} max={365} isIntegerOnly value={stage.rottingDays}
      onChange={value => { if (value !== stage.rottingDays) save({ rottingDays: value ?? null }); }} /> : <span />}
    {stage.outcome !== 'lost' ? <MultiSelector label={`Required to enter ${stage.name}`} isLabelHidden placeholder="Required fields" width={190} value={stage.requiredFields ?? []}
      options={[{ value: 'amount', label: 'Value' }, { value: 'expected_close_date', label: 'Close date' }, { value: 'contact', label: 'Contact' }, { value: 'company', label: 'Company' }]}
      onChange={value => save({ requiredFields: value })} /> : <span />}
    <IconButton variant="ghost" label={`Delete ${stage.name}`} icon={<Trash2 size={15} />} onClick={() => onDelete(stage)}
      isDisabled={stage.outcome === 'open' && pipeline.stages.filter(item => item.outcome === 'open').length <= 1} />
    {action.error ? <Text type="supporting" color="secondary">{action.error}</Text> : null}
  </div>;
}

function PipelineFields({ pipeline, onSaved }: { pipeline: Pipeline; onSaved: (pipeline: Pipeline) => void }) {
  const action = useAction();
  const [name, setName] = useState(pipeline.name);
  const [currency, setCurrency] = useState(pipeline.currency);
  const save = (body: Record<string, string>, done: string) => void action.run(async () => onSaved(await api<Pipeline>(`/sales/pipelines/${pipeline.id}`, 'PATCH', body)), done);
  return <div className="ov-stack-sm">
    <div className="ov-form-grid">
      <TextInput label="Pipeline name" value={name} onChange={setName} onBlur={() => { if (name.trim() && name.trim() !== pipeline.name) save({ name: name.trim() }, 'Pipeline renamed.'); }} />
      <TextInput label="Currency" value={currency} onChange={value => setCurrency(value.toUpperCase().slice(0, 3))}
        onBlur={() => { if (currency.length === 3 && currency !== pipeline.currency) save({ currency }, 'Currency changed.'); }} />
    </div>
    <Feedback error={action.error} />
  </div>;
}

export function PipelineSettings() {
  const pipelines = useResource<{ items: Pipeline[] }>('/sales/pipelines?archived=true');
  const toast = useToast();
  const action = useAction();
  const [selected, setSelected] = useState('');
  const [local, setLocal] = useState<Pipeline | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCurrency, setNewCurrency] = useState('GBP');
  const [stageName, setStageName] = useState('');
  const [removing, setRemoving] = useState<PipelineStage | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const items = pipelines.data?.items ?? [];
  const current = selected || items.find(item => item.isDefault)?.id || items[0]?.id || '';
  const fetched = items.find(item => item.id === current);
  const pipeline = local?.id === current ? local : fetched;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const saved = (next: Pipeline) => { setLocal(next); pipelines.refresh(); };

  async function onDragEnd(event: DragEndEvent) {
    if (!pipeline || !event.over || event.active.id === event.over.id) return;
    const open = pipeline.stages.filter(stage => stage.outcome === 'open');
    const from = open.findIndex(stage => stage.id === event.active.id);
    const to = open.findIndex(stage => stage.id === event.over!.id);
    if (from < 0 || to < 0) return;
    const reordered = arrayMove(open, from, to);
    const previous = pipeline;
    setLocal({ ...pipeline, stages: [...reordered, ...pipeline.stages.filter(stage => stage.outcome !== 'open')] });
    try {
      saved(await api<Pipeline>(`/sales/pipelines/${pipeline.id}/stages/order`, 'POST', { ids: reordered.map(stage => stage.id) }));
    } catch (error) {
      setLocal(previous);
      toast({ body: `Stages were not reordered: ${message(error)}`, type: 'error' });
    }
  }

  return <div className="ov-stack">
    <PageHeader title="Pipelines" description="Stages, win probabilities and the outcome each stage stands for."
      actions={<Button label="New pipeline" variant="primary" icon={<Plus size={16} />} onClick={() => setCreating(true)} />} />
    <AsyncState loading={pipelines.loading && !pipelines.data} error={pipelines.error} retry={pipelines.refresh} />
    <Feedback error={action.error} />
    {pipeline ? <Panel title={pipeline.name} description={`${pipeline.openDeals ?? 0} open deals · ${pipeline.currency}${pipeline.isDefault ? ' · default pipeline' : ''}${pipeline.archived ? ' · archived' : ''}`}
      action={<div className="ov-actions">
        <Selector label="Pipeline" isLabelHidden width={220} value={current} onChange={value => { setSelected(value ?? ''); setLocal(null); }}
          options={items.map(item => ({ value: item.id, label: `${item.name}${item.archived ? ' (archived)' : ''}` }))} />
        {!pipeline.isDefault && !pipeline.archived ? <Button size="sm" label="Make default" onClick={() => void action.run(async () => saved(await api<Pipeline>(`/sales/pipelines/${pipeline.id}`, 'PATCH', { isDefault: true })), 'Default pipeline changed.')} /> : null}
        {!pipeline.isDefault ? <Button size="sm" variant="ghost" label={pipeline.archived ? 'Restore' : 'Archive'}
          onClick={() => void action.run(async () => saved(await api<Pipeline>(`/sales/pipelines/${pipeline.id}/archive`, 'POST', { archived: !pipeline.archived })), pipeline.archived ? 'Pipeline restored.' : 'Pipeline archived.')} /> : null}
      </div>}>
      <PipelineFields key={pipeline.id + pipeline.name + pipeline.currency} pipeline={pipeline} onSaved={saved} />
      <div className="ov-stack-sm">
        <Text type="supporting" color="secondary">Drag open stages to reorder them. Probability drives the weighted forecast; rotting days flag deals that sit too long in a stage; required fields must be filled before a deal can enter the stage.</Text>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={event => void onDragEnd(event)}>
          <SortableContext items={pipeline.stages.filter(stage => stage.outcome === 'open').map(stage => stage.id)} strategy={verticalListSortingStrategy}>
            {pipeline.stages.map(stage => <StageRow key={stage.id + stage.name + stage.probability + (stage.rottingDays ?? '') + (stage.requiredFields ?? []).join()} stage={stage} pipeline={pipeline} onSaved={saved}
              onDelete={item => { setRemoving(item); setTarget(null); }} />)}
          </SortableContext>
        </DndContext>
        <form className="ov-actions" onSubmit={event => {
          event.preventDefault();
          void action.run(async () => { saved(await api<Pipeline>(`/sales/pipelines/${pipeline.id}/stages`, 'POST', { name: stageName.trim(), probability: 50 })); setStageName(''); }, 'Stage added.');
        }}>
          <TextInput label="New stage" isLabelHidden placeholder="New stage name" value={stageName} onChange={setStageName} width={240} />
          <Button type="submit" label="Add stage" icon={<Plus size={14} />} isDisabled={!stageName.trim()} />
        </form>
      </div>
    </Panel> : !pipelines.loading ? <Panel><Empty title="No pipelines yet" action={<Button label="New pipeline" onClick={() => setCreating(true)} />} /></Panel> : null}
    {creating ? <Modal title="New pipeline" onClose={() => setCreating(false)}>
      <form className="ov-stack-sm" onSubmit={event => {
        event.preventDefault();
        void action.run(async () => {
          const created = await api<Pipeline>('/sales/pipelines', 'POST', { name: newName.trim(), currency: newCurrency.trim() || 'GBP' });
          setCreating(false); setNewName(''); setSelected(created.id); saved(created);
        }, 'Pipeline created with standard stages.');
      }}>
        <TextInput label="Name" isRequired value={newName} onChange={setNewName} placeholder="Renewals" />
        <TextInput label="Currency" value={newCurrency} onChange={value => setNewCurrency(value.toUpperCase().slice(0, 3))} description="Three-letter code, e.g. GBP, EUR, USD." />
        <Text type="supporting" color="secondary">Starts with Lead in, Qualified, Proposal, Negotiation, Won and Lost. Rename or reorder them afterwards.</Text>
        <Feedback error={action.error} />
        <FormActions><Button label="Cancel" onClick={() => setCreating(false)} /><Button type="submit" variant="primary" label="Create pipeline" isDisabled={!newName.trim()} isLoading={action.busy} /></FormActions>
      </form>
    </Modal> : null}
    {removing && pipeline ? <Modal title={`Delete “${removing.name}”`} onClose={() => setRemoving(null)}>
      <div className="ov-stack-sm">
        <Text>Deals in this stage move to the stage you choose. Their history is kept.</Text>
        <Selector label="Move its deals to" placeholder="Choose a stage" hasClear value={target} onChange={setTarget}
          options={pipeline.stages.filter(stage => stage.id !== removing.id).map(stage => ({ value: stage.id, label: stage.name }))} />
        <Feedback error={action.error} />
        <FormActions>
          <Button label="Cancel" onClick={() => setRemoving(null)} />
          <Button variant="destructive" label="Delete stage" isLoading={action.busy} onClick={() => void action.run(async () => {
            saved(await api<Pipeline>(`/sales/stages/${removing.id}${target ? `?targetStageId=${target}` : ''}`, 'DELETE'));
            setRemoving(null);
          }, 'Stage deleted.')} />
        </FormActions>
      </div>
    </Modal> : null}
  </div>;
}

/* ── Lead routing ─────────────────────────────────────────────────────── */

type Rule = { id: string; name: string; active: boolean; matchField: 'any' | 'country' | 'source' | 'form'; matchValue: string; userIds: string[]; users: { id: string; name: string }[] };
const matchLabel: Record<Rule['matchField'], string> = { any: 'Every new lead', country: 'Country is', source: 'Source is', form: 'Form is' };

function RuleEditor({ rule, onClose, onSaved }: { rule?: Rule; onClose: () => void; onSaved: () => void }) {
  const team = useResource<{ id: string; name: string }[]>('/platform/users');
  const action = useAction();
  const [name, setName] = useState(rule?.name ?? '');
  const [field, setField] = useState<Rule['matchField']>(rule?.matchField ?? 'any');
  const [value, setValue] = useState(rule?.matchValue ?? '');
  const [users, setUsers] = useState<string[]>(rule?.userIds ?? []);
  const [active, setActive] = useState(rule?.active ?? true);
  return <Modal title={rule ? 'Edit routing rule' : 'New routing rule'} onClose={onClose}>
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        await api(rule ? `/crm/routing/${rule.id}` : '/crm/routing', rule ? 'PATCH' : 'POST', { name: name.trim(), matchField: field, matchValue: value.trim(), userIds: users, active });
        onSaved();
      }, 'Routing rule saved.');
    }}>
      <TextInput label="Rule name" isRequired value={name} onChange={setName} placeholder="UK inbound leads" />
      <div className="ov-form-grid">
        <Selector label="Applies to" value={field} onChange={next => setField((next as Rule['matchField']) || 'any')}
          options={(Object.keys(matchLabel) as Rule['matchField'][]).map(key => ({ value: key, label: matchLabel[key] }))} />
        {field !== 'any' ? <TextInput label={field === 'country' ? 'Country' : field === 'source' ? 'Source or UTM source' : 'Form id or name'} isRequired value={value} onChange={setValue}
          placeholder={field === 'country' ? 'United Kingdom' : field === 'source' ? 'linkedin' : 'Demo request'} /> : null}
      </div>
      <MultiSelector label="Assign in turn to" value={users} onChange={setUsers} isLoading={team.loading}
        options={(team.data ?? []).map(member => ({ value: member.id, label: member.name }))} description="Leads rotate through these people in order." />
      <Switch label="Active" value={active} onChange={setActive} />
      <Feedback error={action.error} />
      <FormActions><Button label="Cancel" onClick={onClose} /><Button type="submit" variant="primary" label="Save rule" isLoading={action.busy} isDisabled={!name.trim() || !users.length} /></FormActions>
    </form>
  </Modal>;
}

export function LeadRouting() {
  const routing = useResource<{ rules: Rule[]; recent: { contactId: number; owner: string; rule: string; at: string }[] }>('/crm/routing');
  const action = useAction();
  const [editing, setEditing] = useState<Rule | 'new' | null>(null);
  const rules = routing.data?.rules ?? [];
  const move = (index: number, by: number) => void action.run(async () => {
    await api('/crm/routing/order', 'POST', { ids: arrayMove(rules, index, index + by).map(rule => rule.id) });
    routing.refresh();
  });
  return <Panel title="Lead routing" description="New contacts without an owner (created, or from a form) go to the first matching rule, which assigns people in turn."
    action={<Button size="sm" label="New rule" icon={<Plus size={14} />} onClick={() => setEditing('new')} />}>
    <Feedback error={action.error} />
    {!routing.data ? <AsyncState loading={routing.loading} error={routing.error} retry={routing.refresh} /> : rules.length ? <ul className="ov-rows">
      {rules.map((rule, index) => <li key={rule.id}>
        <span>
          <span className="ov-actions"><Text weight="medium">{index + 1}. {rule.name}</Text>{rule.active ? null : <StatusBadge label="Paused" tone="neutral" />}</span>
          <Text type="supporting" color="secondary">{matchLabel[rule.matchField]}{rule.matchField !== 'any' ? ` “${rule.matchValue}”` : ''} → {rule.users.map(user => user.name).join(', ') || 'nobody'}</Text>
        </span>
        <span className="ov-actions">
          <IconButton size="sm" variant="ghost" label={`Move ${rule.name} up`} icon={<ArrowUp size={14} />} isDisabled={index === 0} onClick={() => move(index, -1)} />
          <IconButton size="sm" variant="ghost" label={`Move ${rule.name} down`} icon={<ArrowDown size={14} />} isDisabled={index === rules.length - 1} onClick={() => move(index, 1)} />
          <Button size="sm" label="Edit" onClick={() => setEditing(rule)} />
          <IconButton size="sm" variant="ghost" label={`Delete ${rule.name}`} icon={<Trash2 size={14} />}
            onClick={() => void action.run(async () => { await api(`/crm/routing/${rule.id}`, 'DELETE'); routing.refresh(); }, 'Rule deleted.')} />
        </span>
      </li>)}
    </ul> : <Empty title="No routing rules" description="Without rules, new leads stay unassigned until someone takes them." />}
    {routing.data?.recent.length ? <div className="ov-stack-sm">
      <Text type="label" color="secondary">Recent assignments</Text>
      <ul className="ov-rows">{routing.data.recent.map(item => <li key={`${item.contactId}-${item.at}`}>
        <span><NextLink href={`/crm/contacts/${item.contactId}`}>Contact {item.contactId}</NextLink><Text type="supporting" color="secondary">{item.owner} · {item.rule}</Text></span>
        <time className="ov-crm-when" dateTime={item.at}>{relative(item.at)}</time>
      </li>)}</ul>
    </div> : null}
    {editing ? <RuleEditor rule={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); routing.refresh(); }} /> : null}
  </Panel>;
}

/* ── Sequences ────────────────────────────────────────────────────────── */

type DraftStep = Omit<SequenceStep, 'id' | 'position'> & { key: number };
let stepKey = 1;
const newStep = (kind: 'email' | 'task', delayDays = 2): DraftStep => ({ key: stepKey++, kind, delayDays, businessHours: true, subject: '', body: '', taskTitle: '', taskType: 'call' });

function SequenceEditor({ sequence, onClose, onSaved }: { sequence?: Sequence; onClose: () => void; onSaved: (sequence: Sequence) => void }) {
  const action = useAction();
  const [name, setName] = useState(sequence?.name ?? '');
  const [description, setDescription] = useState(sequence?.description ?? '');
  const [steps, setSteps] = useState<DraftStep[]>(sequence?.steps.map(step => ({ ...step, key: stepKey++ })) ?? [newStep('email', 0)]);
  const [sendWindow, setSendWindow] = useState(sequence?.sendWindow ?? { start: 9, end: 17, days: [1, 2, 3, 4, 5] });
  const [dailyLimit, setDailyLimit] = useState(sequence?.dailyLimit ?? 50);
  const update = (key: number, patch: Partial<DraftStep>) => setSteps(current => current.map(step => step.key === key ? { ...step, ...patch } : step));
  const move = (index: number, by: number) => setSteps(current => arrayMove(current, index, index + by));
  return <SlideDrawer title={sequence ? 'Edit sequence' : 'New sequence'} subtitle="Emails send through OVELIO’s mailer with consent checks. A reply, unsubscribe, bounce or won deal stops it." onClose={onClose} width={680}>
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        const body: SequenceInput = { name: name.trim(), description: description.trim(), steps: steps.map(step => ({
          kind: step.kind, delayDays: step.delayDays, businessHours: step.businessHours, subject: step.subject, body: step.body, taskTitle: step.taskTitle, taskType: step.taskType,
        })), sendWindow, dailyLimit };
        onSaved(await api<Sequence>(sequence ? `/sales/sequences/${sequence.id}` : '/sales/sequences', sequence ? 'PATCH' : 'POST', body));
      }, 'Sequence saved.');
    }}>
      <TextInput label="Name" isRequired value={name} onChange={setName} placeholder="New lead follow-up" />
      <TextInput label="Description" isOptional value={description} onChange={setDescription} />
      <div className="ov-crm-step">
        <Text weight="semibold">Send window and limits</Text>
        <div className="ov-form-grid">
          <NumberInput label="Window opens (hour)" min={0} max={23} isIntegerOnly value={sendWindow.start} onChange={value => setSendWindow(current => ({ ...current, start: value ?? 9 }))} />
          <NumberInput label="Window closes (hour)" min={1} max={24} isIntegerOnly value={sendWindow.end} onChange={value => setSendWindow(current => ({ ...current, end: value ?? 17 }))} />
          <MultiSelector label="Sending days" value={sendWindow.days.map(String)} onChange={value => setSendWindow(current => ({ ...current, days: value.map(Number).sort() }))}
            options={['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, index) => ({ value: String(index), label: day }))} />
          <NumberInput label="Daily emails per sender" min={1} max={2000} isIntegerOnly value={dailyLimit} onChange={value => setDailyLimit(value ?? 50)} />
        </div>
        <Text type="supporting" color="secondary">Hours are in each recipient’s local time, from their country (otherwise the workspace zone, OVELIO_TIMEZONE). Email steps marked “send window only” wait for the next window; any email waits for the next day once the sender reaches the limit.</Text>
      </div>
      {steps.map((step, index) => <div key={step.key} className="ov-crm-step">
        <div className="ov-actions ov-actions--between">
          <Text weight="semibold">Step {index + 1} · {step.kind === 'email' ? 'Email' : 'Task'}</Text>
          <div className="ov-actions">
            <IconButton size="sm" variant="ghost" label="Move up" icon={<ArrowUp size={14} />} isDisabled={index === 0} onClick={() => move(index, -1)} />
            <IconButton size="sm" variant="ghost" label="Move down" icon={<ArrowDown size={14} />} isDisabled={index === steps.length - 1} onClick={() => move(index, 1)} />
            <IconButton size="sm" variant="ghost" label="Remove step" icon={<Trash2 size={14} />} isDisabled={steps.length === 1} onClick={() => setSteps(current => current.filter(item => item.key !== step.key))} />
          </div>
        </div>
        <div className="ov-form-grid">
          <NumberInput label={index === 0 ? 'Days after enrolment' : 'Days after previous step'} min={0} max={365} isIntegerOnly value={step.delayDays} onChange={value => update(step.key, { delayDays: value ?? 0 })} />
          <Switch label="Send window only" description="Wait for the recipient’s send window" value={step.businessHours} onChange={value => update(step.key, { businessHours: value })} />
        </div>
        {step.kind === 'email' ? <>
          <TextInput label="Subject" isRequired value={step.subject} onChange={value => update(step.key, { subject: value })} />
          <TextArea label="Message" rows={6} value={step.body} onChange={value => update(step.key, { body: value })}
            description={`Merge tags: ${mergeTags.filter(tag => tag.group === 'Contact').slice(0, 5).map(tag => `{{${tag.tag}}}`).join(', ')} — add a fallback with {{contact.first_name | there}}.`} />
        </> : <div className="ov-form-grid">
          <TextInput label="Task title" isRequired value={step.taskTitle} onChange={value => update(step.key, { taskTitle: value })} />
          <Selector label="Task type" value={step.taskType} onChange={value => update(step.key, { taskType: (value as TaskType) || 'todo' })}
            options={Object.entries(taskTypeLabels).map(([value, label]) => ({ value, label }))} />
        </div>}
      </div>)}
      <div className="ov-actions">
        <Button size="sm" label="Add email step" icon={<Plus size={14} />} onClick={() => setSteps(current => [...current, newStep('email')])} />
        <Button size="sm" label="Add task step" icon={<Plus size={14} />} onClick={() => setSteps(current => [...current, newStep('task')])} />
      </div>
      <Feedback error={action.error} />
      <FormActions><Button label="Cancel" onClick={onClose} /><Button type="submit" variant="primary" label="Save sequence" isLoading={action.busy} isDisabled={!name.trim()} /></FormActions>
    </form>
  </SlideDrawer>;
}

const runLabel: Record<string, [string, 'success' | 'warning' | 'error' | 'info' | 'neutral']> = {
  sent: ['Sent', 'success'], not_sent: ['Not delivered', 'warning'], blocked: ['Blocked', 'error'], failed: ['Failed', 'error'], task_created: ['Task created', 'info'], skipped: ['Skipped', 'neutral'],
};

function Enrolments({ sequence, onChanged }: { sequence: Sequence; onChanged: () => void }) {
  const enrolments = useResource<SequenceEnrolment[]>(`/sales/sequences/${sequence.id}/enrolments`);
  const action = useAction();
  const [contact, setContact] = useState<RecordOption | null>(null);
  return <Panel title={`Enrolments · ${sequence.name}`} description="Each step’s real result is listed, including why an email was not delivered.">
    <div className="ov-actions" style={{ alignItems: 'flex-end' }}>
      <div style={{ minWidth: 280, flex: 1 }}><ContactPicker label="Enrol a contact" value={contact} onChange={setContact} /></div>
      <Button label="Enrol" variant="primary" isDisabled={!contact || sequence.status !== 'active'} isLoading={action.busy}
        onClick={() => void action.run(async () => {
          const result = await api<{ results: { status: string }[] }>(`/sales/sequences/${sequence.id}/enrol`, 'POST', { contactIds: [contact!.auxiliaryData!.id] });
          const status = result.results[0]?.status;
          setContact(null); enrolments.refresh(); onChanged();
          if (status !== 'enrolled') throw new Error(status === 'already_active' ? 'That contact is already active in this sequence.' : 'That contact has no email address.');
        }, 'Contact enrolled.')} />
    </div>
    {sequence.status !== 'active' ? <Text type="supporting" color="secondary">Activate the sequence to enrol contacts.</Text> : null}
    <Feedback error={action.error} />
    {!enrolments.data ? <AsyncState loading={enrolments.loading} error={enrolments.error} retry={enrolments.refresh} /> : enrolments.data.length ? <ul className="ov-rows">
      {enrolments.data.map(item => <li key={item.id}>
        <span>
          <NextLink href={`/crm/contacts/${item.contactId}`}><Text weight="medium">{item.contactName || item.contactEmail}</Text></NextLink>
          <Text type="supporting" color="secondary">{item.status === 'active' ? `Step ${Math.min(item.nextPosition + 1, item.stepCount)} of ${item.stepCount}${item.nextRunAt ? ` · next ${dateTime(item.nextRunAt)}` : ''}` : item.stoppedReason || `Completed ${shortDate(item.finishedAt)}`}</Text>
          <span className="ov-actions">{item.runs.map(run => <span key={run.position} title={run.reason}><StatusBadge label={`${run.position + 1}: ${runLabel[run.status]?.[0] ?? run.status}`} tone={runLabel[run.status]?.[1] ?? 'neutral'} /></span>)}</span>
          {item.runs.filter(run => run.reason && run.status !== 'sent').slice(-1).map(run => <Text key={run.position} type="supporting" color="secondary">{run.reason}</Text>)}
          {item.status === 'active' && item.waitReason ? <Text type="supporting" color="secondary">{item.waitReason}</Text> : null}
        </span>
        {item.status === 'active' ? <Button size="sm" variant="ghost" label="Stop" onClick={() => void action.run(async () => { await api(`/sales/enrolments/${item.id}/stop`, 'POST'); enrolments.refresh(); onChanged(); }, 'Stopped.')} />
          : <StatusBadge label={item.status === 'completed' ? 'Completed' : 'Stopped'} tone={item.status === 'completed' ? 'success' : 'warning'} />}
      </li>)}
    </ul> : <Empty title="Nobody enrolled yet" description="Enrol contacts here or from a contact’s page." />}
  </Panel>;
}

export function SalesSequences() {
  const sequences = useResource<Sequence[]>('/sales/sequences');
  const action = useAction();
  const [editing, setEditing] = useState<Sequence | 'new' | null>(null);
  const [selected, setSelected] = useState('');
  const items = sequences.data ?? [];
  const current = items.find(item => item.id === selected) ?? items[0];
  return <div className="ov-stack">
    <PageHeader title="Sequences" description="Timed follow-up emails and tasks for one contact at a time."
      actions={<Button label="New sequence" variant="primary" icon={<Plus size={16} />} onClick={() => setEditing('new')} />} />
    <Feedback error={action.error} />
    {!sequences.data ? <Panel><AsyncState loading={sequences.loading} error={sequences.error} retry={sequences.refresh} /></Panel> : items.length ? <>
      <Panel>
        <Table data={items} idKey="id" hasHover columns={[
          { key: 'name', header: 'Sequence', renderCell: item => <span className="ov-cell"><Button variant="ghost" size="sm" label={item.name} onClick={() => setSelected(item.id)} /><Text type="supporting" color="secondary">{item.steps.length} steps · {item.steps.filter(step => step.kind === 'email').length} emails</Text></span> },
          { key: 'status', header: 'Status', renderCell: item => <StatusBadge label={item.status === 'active' ? 'Active' : item.status === 'paused' ? 'Paused' : 'Archived'} tone={item.status === 'active' ? 'success' : 'neutral'} /> },
          { key: 'active', header: 'Active', renderCell: item => item.counts.active },
          { key: 'completed', header: 'Completed', renderCell: item => item.counts.completed },
          { key: 'stopped', header: 'Stopped', renderCell: item => item.counts.stopped },
          { key: 'actions', header: '', renderCell: item => <div className="ov-actions ov-actions--end">
            <Button size="sm" label="Edit" onClick={() => setEditing(item)} />
            <Button size="sm" variant="ghost" label={item.status === 'active' ? 'Pause' : 'Activate'}
              onClick={() => void action.run(async () => { await api(`/sales/sequences/${item.id}/status`, 'POST', { status: item.status === 'active' ? 'paused' : 'active' }); sequences.refresh(); })} />
          </div> },
        ]} />
      </Panel>
      {current ? <Enrolments key={current.id} sequence={current} onChanged={sequences.refresh} /> : null}
    </> : <Panel><Empty title="No sequences yet" description="Build a sequence of follow-up emails and call tasks, then enrol contacts." action={<Button label="New sequence" onClick={() => setEditing('new')} />} /></Panel>}
    {editing ? <SequenceEditor sequence={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={saved => { setEditing(null); setSelected(saved.id); sequences.refresh(); }} /> : null}
  </div>;
}

/* ── Mailboxes ────────────────────────────────────────────────────────── */

function MailboxAccessDialog({ mailbox, onClose }: { mailbox: Mailbox; onClose: () => void }) {
  const endpoint = `/mailboxes/${mailbox.id}/members`;
  const access = useResource<{ members: { userId: string; name: string; email: string }[] }>(endpoint);
  const team = useResource<Member[]>('/platform/users');
  const action = useAction();
  const [selection, setSelection] = useState<string[] | null>(null);
  const options = (team.data ?? [])
    .filter(member => member.id !== mailbox.userId && (member.role === 'marketer' || member.role === 'admin'))
    .map(member => ({ value: member.id, label: member.name ? `${member.name} · ${member.email}` : member.email }));
  const saved = new Set(access.data?.members.map(member => member.userId));
  const eligibleSavedIds = options.filter(option => saved.has(option.value)).map(option => option.value);
  const userIds = selection ?? eligibleSavedIds;
  const changed = userIds.length !== saved.size || userIds.some(id => !saved.has(id));
  const loading = access.loading || team.loading;
  const loadError = access.error || team.error;

  return <Modal title="Mailbox access" onClose={() => { if (!action.busy) onClose(); }}>
    <Text weight="semibold" className="ov-crm-mailbox-address">{mailbox.email}</Text>
    {loading || loadError ? <AsyncState loading={loading} error={loadError} retry={() => { access.refresh(); team.refresh(); }} /> : (
      <form className="ov-stack-sm" onSubmit={event => {
        event.preventDefault();
        if (!changed) return;
        void action.run(async () => { await api(endpoint, 'PATCH', { userIds }); onClose(); }, 'Mailbox access updated.');
      }}>
        {options.length ? <MultiSelector label="Teammates with access" description="Selected teammates can read this mailbox in Sales and CRM."
          placeholder="Only you have access" options={options} value={userIds} onChange={setSelection} width="100%"
          renderOption={option => <span className="ov-crm-mailbox-address">{option.label}</span>}
          hasSearch hasClear searchPlaceholder="Find by name or email" isDisabled={action.busy} />
          : <Text type="supporting" color="secondary">Only active marketers and admins can be added to a mailbox.</Text>}
        {saved.size > eligibleSavedIds.length
          ? <Text type="supporting" color="secondary">Saving removes grants for teammates who are no longer eligible.</Text> : null}
        <Feedback error={action.error} />
        <FormActions>
          <Button label="Cancel" onClick={onClose} isDisabled={action.busy} />
          <Button type="submit" variant="primary" label="Save access" isLoading={action.busy} isDisabled={!changed} />
        </FormActions>
      </form>
    )}
  </Modal>;
}

export function MailboxSettings({ connected, error }: { connected?: string; error?: string }) {
  const user = useUser();
  const overview = useResource<MailboxOverview>('/mailboxes');
  const action = useAction();
  const [disconnect, setDisconnect] = useState<string | null>(null);
  const [access, setAccess] = useState<Mailbox | null>(null);
  const data = overview.data;
  return <div className="ov-stack ov-crm-mailboxes">
    <PageHeader title="Mailboxes" description="Connect Gmail or Outlook so sales email sends from your own address and replies are logged against contacts." />
    {connected ? <Banner status="success" title={`${connected} is connected`} description="Recent conversations with known contacts sync every 15 minutes." /> : null}
    {error ? <Banner status="error" title="The mailbox was not connected" description={error} /> : null}
    <Feedback error={action.error} />
    {!data ? <Panel><AsyncState loading={overview.loading} error={overview.error} retry={overview.refresh} /></Panel> : <>
      <div className="ov-grid">
        {data.providers.map(provider => <Panel key={provider.provider} title={provider.label}
          description={provider.provider === 'google' ? 'Google OAuth 2.0 and the Gmail API (send and read).' : 'Microsoft identity platform and Microsoft Graph (Mail.Send, Mail.Read).'}
          action={<StatusBadge label={provider.configured ? 'Ready to connect' : 'Not configured'} tone={provider.configured ? 'success' : 'warning'} />}>
          {provider.configured ? <Button variant="primary" label={`Connect ${provider.label}`} isLoading={action.busy}
            onClick={() => void action.run(async () => { const { url } = await api<{ url: string }>(`/mailboxes/connect/${provider.provider}`, 'POST'); window.location.assign(url); })} />
            : <div className="ov-stack-sm">
              <Text>An administrator must set these server environment variables, then restart OVELIO:</Text>
              <div className="ov-actions">{provider.missing.map(name => <code key={name} className="ov-crm-code">{name}</code>)}</div>
            </div>}
          <Text type="supporting" color="secondary">Redirect URI to register with {provider.provider === 'google' ? 'Google Cloud' : 'Microsoft Entra'}: <code className="ov-crm-code">{provider.redirectUri}</code></Text>
        </Panel>)}
      </div>
      <Panel title={data.canManageAll ? 'Workspace mailbox connections' : 'Your mailboxes'}>
        {data.mailboxes.length ? <ul className="ov-rows">
          {data.mailboxes.map(item => {
            const owns = item.userId === user.id;
            const canManageAccess = owns && item.status !== 'revoked';
            return <li key={item.id}>
              <span>
                <span className="ov-actions">
                  <Text weight="semibold">{item.email}</Text>
                  <StatusBadge label={item.status === 'connected' ? 'Connected' : item.status === 'error' ? 'Needs attention' : 'Revoked'}
                    tone={item.status === 'connected' ? 'success' : 'error'} />
                </span>
                <Text type="supporting" color="secondary">
                  {item.provider === 'google' ? 'Gmail' : 'Outlook'} · {owns ? 'You' : item.userName} · {item.lastSyncedAt
                    ? <>Synced <time dateTime={item.lastSyncedAt}>{relative(item.lastSyncedAt)}</time></>
                    : 'Awaiting first sync'}
                </Text>
                {owns && item.lastError ? <Text type="supporting" color="secondary">{item.lastError}</Text> : null}
              </span>
              <div className="ov-actions" role="group" aria-label={`Actions for ${item.email}`}>
                {canManageAccess ? <>
                  <Button size="sm" label="Manage access" icon={<Users size={14} />} onClick={() => setAccess(item)} />
                  <Button size="sm" variant="ghost" label="Sync now" isDisabled={action.busy} onClick={() => void action.run(async () => {
                    const synced = await api<Mailbox>(`/mailboxes/${item.id}/sync`, 'POST');
                    overview.refresh();
                    if (synced.status !== 'connected') throw new Error(synced.lastError || 'Sync failed. Try again or reconnect the mailbox.');
                  }, 'Mailbox synced.')} />
                </> : null}
                {owns || data.canManageAll ? <Button size="sm" variant="ghost" label="Disconnect" onClick={() => setDisconnect(item.id)} /> : null}
              </div>
            </li>;
          })}
        </ul> : <Empty title="No mailboxes connected" description="Until a mailbox is connected, sales email goes through OVELIO’s email gateway with replies to your address." />}
      </Panel>
    </>}
    {access ? <MailboxAccessDialog mailbox={access} onClose={() => setAccess(null)} /> : null}
    {disconnect ? <ConfirmDialog title="Disconnect mailbox" description="OVELIO removes the stored connection, stops syncing and revokes access to its synced email." actionLabel="Disconnect"
      busy={action.busy} onClose={() => setDisconnect(null)} onConfirm={() => void action.run(async () => { await api(`/mailboxes/${disconnect}`, 'DELETE'); setDisconnect(null); overview.refresh(); }, 'Mailbox disconnected.')} /> : null}
  </div>;
}

const sourceLabel: Record<InboxConversation['source'], string> = { mailbox: 'Synced', logged: 'Logged', sent: 'Sent from OVELIO' };

function InboxDirection({ direction }: { direction: InboxConversation['direction'] }) {
  if (!direction) return null;
  return <StatusBadge label={direction === 'inbound' ? 'Received' : 'Sent'} tone={direction === 'inbound' ? 'info' : 'neutral'} />;
}

function ContactEmailActivity({ query }: { query: string }) {
  const search = query ? `?q=${encodeURIComponent(query)}` : '';
  const inbox = useResource<InboxConversation[]>(`/sales/inbox${search}`);
  const action = useAction();
  if (!inbox.data) return <AsyncState loading={inbox.loading} error={inbox.error} retry={inbox.refresh} />;
  if (!inbox.data.length) return query ? <Empty title="No matching contact activity" />
    : <Empty title="No email activity yet" description="Email sent or logged from a CRM contact appears here." />;
  return <>
    <div className="ov-actions ov-actions--end">
      <Button size="sm" label="Export activity CSV" icon={<Download size={15} />} isLoading={action.busy}
        onClick={() => void action.run(async () => saveFile(await api<string>(`/sales/inbox/export${search}`), 'ovelio-inbox.csv', 'text/csv'))} />
    </div>
    <Feedback error={action.error} />
    <ul className="ov-rows" aria-label="Contact email activity">
      {inbox.data.map((item, index) => <li key={`${item.contactId}-${index}`}>
        <span>
          <span className="ov-actions">
            {item.contactId ? <NextLink href={`/crm/contacts/${item.contactId}`}><Text weight="semibold">{item.contactName}</Text></NextLink> : <Text weight="semibold">{item.contactName}</Text>}
            <InboxDirection direction={item.direction} />
            <Text type="supporting" color="secondary">{sourceLabel[item.source]}{item.count > 1 ? ` · ${item.count} emails` : ''}</Text>
          </span>
          <Text weight="medium">{item.subject || '(no subject)'}</Text>
          {item.snippet ? <Text type="supporting" color="secondary">{item.snippet}</Text> : null}
        </span>
        <time className="ov-crm-when" dateTime={item.at}>{relative(item.at)}</time>
      </li>)}
    </ul>
  </>;
}

function InboxThreadDrawer({ thread, onClose }: { thread: InboxThreadSummary; onClose: () => void }) {
  const params = new URLSearchParams({ mailboxId: thread.mailboxId, threadId: thread.threadId });
  const detail = useResource<InboxThread>(`/sales/inbox/thread?${params}`);
  const messages = detail.data?.messages;
  const subject = messages?.at(-1)?.subject;
  const contactId = messages?.findLast(item => item.contactId != null)?.contactId;
  return <SlideDrawer title="Conversation" onClose={onClose}>
    {!messages ? <AsyncState loading={detail.loading} error={detail.error} retry={detail.refresh} /> : <>
      <div className="ov-stack-sm ov-crm-inbox-copy">
        <Heading level={2}>{subject || '(no subject)'}</Heading>
        <Text type="supporting" color="secondary">Mailbox · {thread.mailboxEmail}</Text>
        {contactId ? <div className="ov-actions"><Button size="sm" label="View CRM contact" href={`/crm/contacts/${contactId}`} /></div> : null}
      </div>
      {messages.length < thread.count ? <Text type="supporting" color="secondary">Showing the most recent {messages.length} messages.</Text> : null}
      <ol className="ov-rows" aria-label="Conversation messages, oldest first">
        {messages.map(item => <li key={item.id}>
          <span>
            <span className="ov-actions">
              <Text weight="semibold">{item.fromEmail || 'Sender unavailable'}</Text>
              <InboxDirection direction={item.direction} />
            </span>
            {item.toEmails ? <Text type="supporting" color="secondary">To {item.toEmails}</Text> : null}
            {item.subject && item.subject !== subject ? <Text weight="medium">{item.subject}</Text> : null}
            {item.snippet ? <Text className="ov-crm-inbox-snippet">{item.snippet}</Text> : null}
          </span>
          <time className="ov-crm-when" dateTime={item.at}>{dateTime(item.at)}</time>
        </li>)}
      </ol>
    </>}
  </SlideDrawer>;
}

function MailboxThreads({ query }: { query: string }) {
  const threads = useResource<InboxThreadSummary[]>(`/sales/inbox/threads${query ? `?q=${encodeURIComponent(query)}` : ''}`);
  const [selected, setSelected] = useState<InboxThreadSummary | null>(null);
  if (!threads.data) return <AsyncState loading={threads.loading} error={threads.error} retry={threads.refresh} />;
  if (!threads.data.length) return query ? <Empty title="No matching conversations" />
    : <Empty title="No mailbox conversations yet" description="Synced email with CRM contacts appears here when you connect a mailbox or a teammate shares one with you." />;
  return <>
    <ul className="ov-rows" aria-label="Mailbox conversations">
      {threads.data.map(thread => {
        const subject = thread.subject || '(no subject)';
        const counterpart = thread.direction === 'inbound' ? thread.fromEmail : thread.toEmails;
        return <li key={`${thread.mailboxId}:${thread.threadId}`}>
          <span>
            <span className="ov-actions">
              <Text weight="semibold">{subject}</Text>
              <InboxDirection direction={thread.direction} />
            </span>
            <Text type="supporting" color="secondary">{[counterpart, thread.mailboxEmail, thread.count === 1 ? '1 message' : `${thread.count} messages`].filter(Boolean).join(' · ')}</Text>
            {thread.snippet ? <Text type="supporting" className="ov-crm-inbox-preview">{thread.snippet}</Text> : null}
          </span>
          <div className="ov-actions">
            <time className="ov-crm-when" dateTime={thread.at}>{relative(thread.at)}</time>
            <Button size="sm" label="Open" aria-label={`Open conversation ${subject} in ${thread.mailboxEmail}`} onClick={() => setSelected(thread)} />
          </div>
        </li>;
      })}
    </ul>
    {selected ? <InboxThreadDrawer thread={selected} onClose={() => setSelected(null)} /> : null}
  </>;
}

export function SalesInbox() {
  const [view, setView] = useState('conversations');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  return <div className="ov-stack">
    <PageHeader title="Inbox" description="Review synced mailbox conversations and email activity recorded in CRM."
      actions={<Button label="Mailbox settings" href="/settings/mailboxes" icon={<Inbox size={15} />} />} />
    <Panel>
      <Toolbar end={<form className="ov-crm-inbox-search" role="search" onSubmit={event => { event.preventDefault(); setQuery(search.trim()); }}>
        <TextInput label="Search email" isLabelHidden type="search" startIcon="search" placeholder="Subject, address or message" width="100%"
          hasClear value={search} onChange={value => { setSearch(value.slice(0, 200)); if (!value) setQuery(''); }} />
        <Button type="submit" label="Search" />
      </form>}>
        <SegmentedControl label="Inbox view" value={view} onChange={setView}>
          <SegmentedControlItem value="conversations" label="Conversations" />
          <SegmentedControlItem value="activity" label="Contact activity" />
        </SegmentedControl>
      </Toolbar>
      {view === 'conversations' ? <MailboxThreads key={query} query={query} /> : <ContactEmailActivity query={query} />}
    </Panel>
  </div>;
}
