'use client';

// Shared CRM & Sales building blocks: formatting, team and record pickers, the activity logger, the task drawer,
// the new-deal drawer, the email composer and the unified timeline.
import '@/styles/crm.css';
import {
  AlarmClock, Building2, CheckCircle2, CircleDot, Mail, MessageSquare, NotebookPen, Phone, Trophy, UserRound, Users, XCircle,
} from 'lucide-react';
import NextLink from 'next/link';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { DateInput } from '@astryxdesign/core/DateInput';
import { DateTimeInput } from '@astryxdesign/core/DateTimeInput';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Typeahead } from '@astryxdesign/core/Typeahead';
import type { SearchableItem, SearchSource } from '@astryxdesign/core/Typeahead/utils';
import type { User } from '@/contracts';
import type {
  ActivityType, CrmTask, Deal, Pipeline, SalesEmailResult, TaskInput, TaskPriority, TaskType, TimelineItem,
} from '@/contracts/crm';
import { taskTypeLabels } from '@/contracts/crm';
import type { DirectoryCompany, DirectoryContact } from '@/contracts/platform';
import { api, request, useAction, useResource } from '../client';
import { useUser } from '../shell';
import { Empty, Feedback, FormActions, SlideDrawer, StatusBadge } from '../ui';
import type { Tone } from '../ui';

/* ── Formatting ───────────────────────────────────────────────────────── */

export function money(amount: number | null | undefined, currency = 'GBP', compact = false) {
  if (amount == null || !Number.isFinite(amount)) return '—';
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency', currency, maximumFractionDigits: compact && Math.abs(amount) >= 1000 ? 1 : 0, notation: compact ? 'compact' : 'standard',
    }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount).toLocaleString('en-GB')}`;
  }
}

export const shortDate = (value: string | null | undefined) => value ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: value.slice(0, 4) === String(new Date().getFullYear()) ? undefined : 'numeric', timeZone: value.length === 10 ? 'UTC' : undefined }).format(new Date(value)) : '—';
export const dateTime = (value: string | null | undefined) => value ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '—';

export function relative(value: string) {
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.round(diff / 60_000);
  if (Math.abs(minutes) < 1) return 'just now';
  const format = new Intl.RelativeTimeFormat('en-GB', { numeric: 'auto' });
  if (Math.abs(minutes) < 60) return format.format(-minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return format.format(-hours, 'hour');
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return format.format(-days, 'day');
  return shortDate(value);
}

export const statusTone: Record<Deal['status'], Tone> = { open: 'info', won: 'success', lost: 'error' };
export const statusLabel: Record<Deal['status'], string> = { open: 'Open', won: 'Won', lost: 'Lost' };

/** "Sample data", "Workflow", "Form submission"… badge for deals other lanes or the seed created. */
export function SourceBadge({ source, label }: { source: string; label: string }) {
  if (!source || source === 'manual' || source === 'ovelio') return null;
  return <StatusBadge label={label} tone={source === 'preview-seed' ? 'neutral' : 'info'} />;
}

export function Estimate({ children = 'Estimate' }: { children?: ReactNode }) {
  return <span className="ov-crm-estimate" title="Calculated from deal values and win probabilities; not revenue.">{children}</span>;
}

export function Kv({ label, children }: { label: string; children: ReactNode }) {
  return <div className="ov-crm-kv"><span>{label}</span><span>{children}</span></div>;
}

/* ── Team ─────────────────────────────────────────────────────────────── */

export type Member = Pick<User, 'id' | 'name' | 'email' | 'role'>;

export function useTeam() {
  const team = useResource<Member[]>('/platform/users');
  return { members: team.data ?? [], loading: team.loading, error: team.error };
}

export function OwnerSelect({ value, onChange, label = 'Owner', isLabelHidden, allowNone = true, width, size, members, isDisabled }: {
  value: string | null; onChange: (value: string | null) => void; label?: string; isLabelHidden?: boolean; allowNone?: boolean;
  width?: number | string; size?: 'sm' | 'md' | 'lg'; members: Member[]; isDisabled?: boolean;
}) {
  return <Selector label={label} isLabelHidden={isLabelHidden} width={width} size={size} isDisabled={isDisabled}
    value={value ?? 'none'} options={[...(allowNone ? [{ value: 'none', label: 'Unassigned' }] : []), ...members.map(member => ({ value: member.id, label: member.name }))]}
    onChange={next => onChange(next && next !== 'none' ? next : null)} />;
}

export function OwnerChip({ name }: { name: string }) {
  if (!name) return <Text type="supporting" color="secondary">Unassigned</Text>;
  return <span className="ov-actions" style={{ gap: 6, flexWrap: 'nowrap' }}><Avatar name={name} size={20} /><span>{name}</span></span>;
}

/* ── Record pickers ───────────────────────────────────────────────────── */

export type RecordOption = SearchableItem<{ id: number; email?: string; company?: string; create?: string }>;

function useLookup(kind: 'contacts' | 'companies', allowCreate: boolean): SearchSource<RecordOption> {
  return useMemo(() => ({
    bootstrap: async () => [],
    async search(query: string) {
      const q = query.trim();
      const items = await request<(DirectoryContact | DirectoryCompany)[]>(`/api/console/crm/lookup/${kind}?q=${encodeURIComponent(q)}`);
      const options: RecordOption[] = items.map(item => 'email' in item
        ? { id: 'contact:' + item.id, label: item.name, auxiliaryData: { id: item.id, email: item.email, company: item.company } }
        : { id: 'company:' + item.id, label: item.name, auxiliaryData: { id: item.id } });
      if (allowCreate && q.length > 1 && !items.some(item => item.name.toLowerCase() === q.toLowerCase())) {
        options.push({ id: 'create:' + q, label: `Create company “${q}”`, auxiliaryData: { id: 0, create: q } });
      }
      return options;
    },
  }), [kind, allowCreate]);
}

export function ContactPicker({ value, onChange, label = 'Contact', isOptional = true }: {
  value: RecordOption | null; onChange: (value: RecordOption | null) => void; label?: string; isOptional?: boolean;
}) {
  const source = useLookup('contacts', false);
  return <Typeahead label={label} isOptional={isOptional} placeholder="Search people by name or email" searchSource={source} value={value} onChange={onChange} hasClear
    renderItem={item => <span className="ov-cell"><span>{item.label}</span><Text type="supporting" color="secondary">{[item.auxiliaryData?.email, item.auxiliaryData?.company].filter(Boolean).join(' · ')}</Text></span>}
    emptySearchText="No matching contact. Add people in CRM › Contacts." />;
}

/** Company typeahead with inline "Create company". A created company is linked to `linkContactId` when given. */
export function CompanyPicker({ value, onChange, label = 'Company', linkContactId }: {
  value: RecordOption | null; onChange: (value: RecordOption | null) => void; label?: string; linkContactId?: number | null;
}) {
  const source = useLookup('companies', true);
  const action = useAction();
  return <div className="ov-stack-sm">
    <Typeahead label={label} isOptional placeholder="Search or create a company" searchSource={source} value={value} hasClear
      emptySearchText="Type a name to create it."
      onChange={item => {
        const create = item?.auxiliaryData?.create;
        if (!create) return onChange(item);
        void action.run(async () => {
          const company = await api<DirectoryCompany>('/crm/lookup/companies', 'POST', { name: create, contactId: linkContactId ?? undefined });
          onChange({ id: 'company:' + company.id, label: company.name, auxiliaryData: { id: company.id } });
        }, `Company “${create}” created.`);
      }} />
    <Feedback error={action.error} />
  </div>;
}

export const contactOption = (id: number | null, name: string): RecordOption | null => id ? { id: 'contact:' + id, label: name || `Contact ${id}`, auxiliaryData: { id } } : null;
export const companyOption = (id: number | null, name: string): RecordOption | null => id ? { id: 'company:' + id, label: name || `Company ${id}`, auxiliaryData: { id } } : null;

function useDealLookup(): SearchSource<SearchableItem<{ id: string }>> {
  return useMemo(() => ({
    bootstrap: async () => [],
    async search(query: string) {
      const page = await request<{ items: Deal[] }>(`/api/console/sales/deals?status=all&limit=10&q=${encodeURIComponent(query.trim())}`);
      return page.items.map(deal => ({ id: deal.id, label: deal.name, auxiliaryData: { id: deal.id } }));
    },
  }), []);
}

/* ── Timeline ─────────────────────────────────────────────────────────── */

const timelineIcon = (item: TimelineItem) => {
  if (item.kind === 'message' || item.type === 'email' || item.type.startsWith('email.')) return Mail;
  if (item.type === 'call') return Phone;
  if (item.type === 'meeting') return Users;
  if (item.type === 'note') return NotebookPen;
  if (item.type === 'deal.won') return Trophy;
  if (item.type === 'deal.lost') return XCircle;
  if (item.type.startsWith('task.')) return CheckCircle2;
  if (item.type.startsWith('contact.')) return UserRound;
  if (item.type.startsWith('company.')) return Building2;
  if (item.kind === 'engine') return MessageSquare;
  return CircleDot;
};

export function Timeline({ items, empty = 'Nothing recorded yet. Log a call, meeting or note to start the history.' }: { items: TimelineItem[]; empty?: string }) {
  const [limit, setLimit] = useState(25);
  if (!items.length) return <Empty title="No activity yet" description={empty} />;
  return <>
    <ul className="ov-crm-timeline">
      {items.slice(0, limit).map(item => {
        const Icon = timelineIcon(item);
        return <li key={item.id}>
          <span className={`ov-crm-dot ${item.tone && item.tone !== 'neutral' ? `ov-crm-dot--${item.tone}` : ''}`} aria-hidden="true"><Icon size={14} /></span>
          <span className="ov-crm-timeline-body">
            <Text weight="medium">{item.href ? <NextLink href={item.href}>{item.title}</NextLink> : item.title}</Text>
            {item.detail ? <p>{item.detail}</p> : null}
            {item.actor ? <Text type="supporting" color="secondary">by {item.actor}</Text> : null}
          </span>
          <time className="ov-crm-when" dateTime={item.at} title={new Date(item.at).toLocaleString('en-GB')}>{relative(item.at)}</time>
        </li>;
      })}
    </ul>
    {items.length > limit ? <Button size="sm" variant="ghost" label={`Show ${Math.min(25, items.length - limit)} more`} onClick={() => setLimit(value => value + 25)} /> : null}
  </>;
}

/* ── Activity logger ──────────────────────────────────────────────────── */

const outcomes: Record<string, string[]> = {
  call: ['Connected', 'Left voicemail', 'No answer', 'Wrong number', 'Interested', 'Not interested'],
  meeting: ['Positive', 'Follow-up needed', 'Not a fit', 'No-show'],
  email: ['Sent', 'Received'],
};

export function ActivityLogger({ contactId, companyId, dealId, onLogged }: { contactId?: number | null; companyId?: number | null; dealId?: string | null; onLogged: () => void }) {
  const [type, setType] = useState<ActivityType>('note');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [outcome, setOutcome] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const action = useAction();
  const reset = () => { setSubject(''); setBody(''); setOutcome(null); setDuration(null); };
  return <form className="ov-stack-sm" onSubmit={event => {
    event.preventDefault();
    void action.run(async () => {
      if (!body.trim() && !subject.trim()) throw new Error('Write what happened before saving.');
      await api('/crm/activities', 'POST', {
        type, subject: subject.trim() || undefined, body: body.trim() || undefined, outcome: outcome ?? undefined,
        direction: type === 'email' ? (outcome === 'Received' ? 'inbound' : 'outbound') : type === 'call' ? 'outbound' : null,
        durationMinutes: type === 'call' || type === 'meeting' ? duration : null,
        contactId: contactId ?? null, companyId: companyId ?? null, dealId: dealId ?? null,
      });
      reset();
      onLogged();
    }, type === 'note' ? 'Note saved.' : `${type === 'call' ? 'Call' : type === 'meeting' ? 'Meeting' : 'Email'} logged.`);
  }}>
    <SegmentedControl label="Activity type" size="sm" value={type} onChange={value => { setType(value as ActivityType); setOutcome(null); }}>
      <SegmentedControlItem value="note" label="Note" />
      <SegmentedControlItem value="call" label="Log call" />
      <SegmentedControlItem value="meeting" label="Log meeting" />
      <SegmentedControlItem value="email" label="Log email" />
    </SegmentedControl>
    {type !== 'note' ? <div className="ov-form-grid">
      <TextInput label="Subject" isOptional value={subject} onChange={setSubject} placeholder={type === 'call' ? 'Discovery call' : type === 'meeting' ? 'Demo' : 'Re: proposal'} />
      <Selector label="Outcome" isOptional placeholder="Choose an outcome" hasClear value={outcome} onChange={setOutcome} options={(outcomes[type] ?? []).map(item => ({ value: item, label: item }))} />
      {type === 'call' || type === 'meeting' ? <NumberInput label="Duration (minutes)" isOptional min={0} max={1440} isIntegerOnly value={duration} onChange={value => setDuration(value ?? null)} /> : null}
    </div> : null}
    <TextArea label={type === 'note' ? 'Note' : 'Summary'} isLabelHidden={type === 'note'} rows={3} value={body} onChange={setBody}
      placeholder={type === 'note' ? 'Add a note for the team…' : 'What was discussed and what happens next?'} />
    <Feedback error={action.error} />
    <FormActions><Button type="submit" variant="primary" size="sm" label={type === 'note' ? 'Save note' : 'Log activity'} isLoading={action.busy} /></FormActions>
  </form>;
}

/* ── Tasks ────────────────────────────────────────────────────────────── */

const reminderChoices = [
  { value: 'none', label: 'No reminder' }, { value: '0', label: 'At the due time' }, { value: '15', label: '15 minutes before' },
  { value: '60', label: '1 hour before' }, { value: '1440', label: '1 day before' },
];

const toLocalInput = (iso: string | null | undefined) => {
  if (!iso) return undefined;
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export type TaskDefaults = Partial<TaskInput> & { contactName?: string; companyName?: string; dealName?: string };

export function followUpDefaults(input: { contactId?: number | null; contactName?: string; companyId?: number | null; companyName?: string; dealId?: string | null; dealName?: string; title: string }): TaskDefaults {
  const due = new Date(Date.now() + 2 * 86_400_000);
  due.setHours(10, 0, 0, 0);
  return { ...input, type: 'follow_up', dueAt: due.toISOString() };
}

export function TaskDrawer({ task, defaults, onClose, onSaved }: { task?: CrmTask; defaults?: TaskDefaults; onClose: () => void; onSaved: (task: CrmTask) => void }) {
  const user = useUser();
  const { members } = useTeam();
  const action = useAction();
  const [title, setTitle] = useState(task?.title ?? defaults?.title ?? '');
  const [type, setType] = useState<TaskType>(task?.type ?? defaults?.type ?? 'todo');
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? defaults?.priority ?? 'normal');
  const [due, setDue] = useState<string | undefined>(toLocalInput(task?.dueAt ?? defaults?.dueAt));
  const initialReminder = task?.remindAt && task.dueAt ? String(Math.round((Date.parse(task.dueAt) - Date.parse(task.remindAt)) / 60_000)) : 'none';
  const [reminder, setReminder] = useState<string>(reminderChoices.some(item => item.value === initialReminder) ? initialReminder : task?.remindAt ? '0' : 'none');
  const [assignee, setAssignee] = useState<string | null>(task ? task.assigneeId : defaults?.assigneeId ?? user.id);
  const [contact, setContact] = useState(contactOption(task?.contactId ?? defaults?.contactId ?? null, task?.contactName ?? defaults?.contactName ?? ''));
  const [company, setCompany] = useState(companyOption(task?.companyId ?? defaults?.companyId ?? null, task?.companyName ?? defaults?.companyName ?? ''));
  const dealId = task?.dealId ?? defaults?.dealId ?? null;
  const [deal, setDeal] = useState<SearchableItem<{ id: string }> | null>(dealId ? { id: dealId, label: task?.dealName ?? defaults?.dealName ?? 'Deal', auxiliaryData: { id: dealId } } : null);
  const [notes, setNotes] = useState(task?.notes ?? defaults?.notes ?? '');
  const dealSource = useDealLookup();
  return <SlideDrawer title={task ? 'Edit task' : 'New task'} subtitle="Tasks appear under Sales › Tasks for the assignee." onClose={onClose}>
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        const dueAt = due ? new Date(due).toISOString() : null;
        if (reminder !== 'none' && !dueAt) throw new Error('Set a due date and time before adding a reminder.');
        const remindAt = reminder !== 'none' && dueAt ? new Date(Date.parse(dueAt) - Number(reminder) * 60_000).toISOString() : null;
        const body = {
          title: title.trim(), type, priority, dueAt, remindAt, assigneeId: assignee, notes: notes.trim(),
          contactId: contact?.auxiliaryData?.id ?? null, companyId: company?.auxiliaryData?.id ?? null, dealId: deal?.auxiliaryData?.id ?? null,
        };
        onSaved(await api<CrmTask>(task ? `/sales/tasks/${task.id}` : '/sales/tasks', task ? 'PATCH' : 'POST', body));
      }, task ? 'Task updated.' : 'Task created.');
    }}>
      <TextInput label="Title" isRequired value={title} onChange={setTitle} placeholder="Call to confirm the proposal" />
      <div className="ov-form-grid">
        <Selector label="Type" value={type} onChange={value => setType((value as TaskType) || 'todo')} options={Object.entries(taskTypeLabels).map(([value, label]) => ({ value, label }))} />
        <Selector label="Priority" value={priority} onChange={value => setPriority((value as TaskPriority) || 'normal')}
          options={[{ value: 'low', label: 'Low' }, { value: 'normal', label: 'Normal' }, { value: 'high', label: 'High' }]} />
        <DateTimeInput label="Due" isOptional value={due as never} onChange={value => setDue(value ?? undefined)} />
        <Selector label="Reminder" value={reminder} onChange={value => setReminder(value || 'none')} options={reminderChoices} />
      </div>
      <OwnerSelect label="Assignee" value={assignee} onChange={setAssignee} members={members} />
      <ContactPicker value={contact} onChange={setContact} />
      <CompanyPicker value={company} onChange={setCompany} linkContactId={contact?.auxiliaryData?.id} />
      <Typeahead label="Deal" isOptional placeholder="Search deals" searchSource={dealSource} value={deal} onChange={setDeal} hasClear />
      <TextArea label="Notes" isOptional rows={3} value={notes} onChange={setNotes} />
      <Feedback error={action.error} />
      <FormActions>
        <Button label="Cancel" onClick={onClose} />
        <Button type="submit" variant="primary" label={task ? 'Save task' : 'Create task'} isLoading={action.busy} isDisabled={!title.trim()} />
      </FormActions>
    </form>
  </SlideDrawer>;
}

export function TaskLine({ task, onChanged, onEdit }: { task: CrmTask; onChanged: () => void; onEdit?: (task: CrmTask) => void }) {
  const action = useAction();
  const done = task.status === 'done';
  return <div className={`ov-crm-task ${done ? 'ov-crm-task--done' : ''}`}>
    <Button size="sm" variant="ghost" isIconOnly label={done ? `Reopen ${task.title}` : `Complete ${task.title}`} isLoading={action.busy}
      icon={done ? <CheckCircle2 size={18} color="#1d7a45" /> : <CircleDot size={18} />}
      onClick={() => void action.run(async () => { await api(`/sales/tasks/${task.id}/${done ? 'reopen' : 'complete'}`, 'POST'); onChanged(); }, done ? 'Task reopened.' : 'Task completed.')} />
    <div className="ov-crm-task-main">
      <Text weight="medium" className="ov-crm-task-title">{task.title}</Text>
      <span className="ov-crm-task-meta">
        <span>{taskTypeLabels[task.type]}</span>
        {task.dueAt ? <span className={task.overdue ? 'ov-crm-overdue' : undefined}>{task.overdue ? 'Overdue · ' : 'Due '}{dateTime(task.dueAt)}</span> : <span>No due date</span>}
        {task.remindAt && !done ? <span title="Reminder"><AlarmClock size={12} aria-hidden="true" /> {dateTime(task.remindAt)}</span> : null}
        {task.priority === 'high' ? <StatusBadge label="High priority" tone="warning" /> : null}
        {task.assigneeName ? <span>{task.assigneeName}</span> : <span>Unassigned</span>}
      </span>
      {action.error ? <Text type="supporting" color="secondary">{action.error}</Text> : null}
    </div>
    {onEdit ? <Button size="sm" variant="ghost" label="Edit" onClick={() => onEdit(task)} /> : <span />}
  </div>;
}

/* ── New deal ─────────────────────────────────────────────────────────── */

export function DealDrawer({ pipelines, defaults, onClose, onCreated }: {
  pipelines: Pipeline[]; defaults?: { pipelineId?: string; stageId?: string; contactId?: number | null; contactName?: string; companyId?: number | null; companyName?: string; name?: string };
  onClose: () => void; onCreated: (deal: Deal) => void;
}) {
  const user = useUser();
  const { members } = useTeam();
  const action = useAction();
  const campaigns = useResource<{ campaigns: { id: string; name: string }[] }>('/sales/filter-options');
  const [pipelineId, setPipelineId] = useState(defaults?.pipelineId ?? pipelines.find(item => item.isDefault)?.id ?? pipelines[0]?.id ?? '');
  const pipeline = pipelines.find(item => item.id === pipelineId);
  const openStages = pipeline?.stages.filter(stage => stage.outcome === 'open') ?? [];
  const [stageId, setStageId] = useState(defaults?.stageId ?? openStages[0]?.id ?? '');
  const [name, setName] = useState(defaults?.name ?? '');
  const [amount, setAmount] = useState<number | null>(null);
  const [currency, setCurrency] = useState(pipeline?.currency ?? 'GBP');
  const [owner, setOwner] = useState<string | null>(user.id);
  const [contact, setContact] = useState(contactOption(defaults?.contactId ?? null, defaults?.contactName ?? ''));
  const [company, setCompany] = useState(companyOption(defaults?.companyId ?? null, defaults?.companyName ?? ''));
  const [close, setClose] = useState<string | undefined>();
  const [campaign, setCampaign] = useState<string | null>(null);
  return <SlideDrawer title="New deal" subtitle="Add an opportunity to a pipeline." onClose={onClose}>
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        const created = await api<Deal>('/sales/deals', 'POST', {
          name: name.trim(), amount: amount ?? 0, currency, pipelineId, stageId: stageId || undefined, ownerId: owner,
          contactId: contact?.auxiliaryData?.id ?? null, companyId: company?.auxiliaryData?.id ?? null, expectedCloseDate: close ?? null, campaignId: campaign,
        });
        onCreated(created);
      }, 'Deal created.');
    }}>
      <TextInput label="Deal name" isRequired value={name} onChange={setName} placeholder="Northbridge — website rebuild" hasAutoFocus />
      <div className="ov-form-grid">
        <NumberInput label="Value" min={0} value={amount} onChange={value => setAmount(value ?? null)} placeholder="0" />
        <TextInput label="Currency" value={currency} onChange={value => setCurrency(value.toUpperCase().slice(0, 3))} />
        <Selector label="Pipeline" value={pipelineId} onChange={value => {
          const next = pipelines.find(item => item.id === value);
          setPipelineId(value ?? '');
          setStageId(next?.stages.find(stage => stage.outcome === 'open')?.id ?? '');
          if (next) setCurrency(next.currency);
        }} options={pipelines.map(item => ({ value: item.id, label: item.name }))} />
        <Selector label="Stage" value={stageId} onChange={value => setStageId(value ?? '')} options={openStages.map(stage => ({ value: stage.id, label: `${stage.name} · ${stage.probability}%` }))} />
        <OwnerSelect value={owner} onChange={setOwner} members={members} />
        <DateInput label="Expected close" isOptional value={close as never} onChange={value => setClose(value ?? undefined)} />
      </div>
      <ContactPicker value={contact} onChange={next => { setContact(next); if (next?.auxiliaryData?.company && !name.trim()) setName(`${next.auxiliaryData.company} — `); }} />
      <CompanyPicker value={company} onChange={setCompany} linkContactId={contact?.auxiliaryData?.id} />
      {campaigns.data?.campaigns.length ? <Selector label="Campaign" isOptional hasClear placeholder="Attribute to a campaign" value={campaign} onChange={setCampaign}
        options={campaigns.data.campaigns.map(item => ({ value: item.id, label: item.name }))} /> : null}
      <Feedback error={action.error} />
      <FormActions>
        <Button label="Cancel" onClick={onClose} />
        <Button type="submit" variant="primary" label="Create deal" isLoading={action.busy} isDisabled={!name.trim() || !pipelineId} />
      </FormActions>
    </form>
  </SlideDrawer>;
}

/* ── 1:1 email ────────────────────────────────────────────────────────── */

const resultTone: Record<SalesEmailResult['status'], 'success' | 'warning' | 'error'> = { sent: 'success', not_sent: 'warning', blocked: 'error', failed: 'error' };
const resultTitle: Record<SalesEmailResult['status'], string> = { sent: 'Email sent', not_sent: 'Email not delivered', blocked: 'Email blocked', failed: 'Email failed' };

export function EmailDrawer({ contact, dealId, onClose, onDone }: { contact: { id: number; name: string; email: string }; dealId?: string | null; onClose: () => void; onDone: () => void }) {
  const user = useUser();
  const mailboxes = useResource<{ id: string; email: string; provider: string; status: string }[]>('/mailboxes/mine');
  const [via, setVia] = useState('gateway');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState(`Hi {{contact.first_name | there}},\n\n\n\nBest,\n${user.name}`);
  const [result, setResult] = useState<SalesEmailResult>();
  const action = useAction();
  return <SlideDrawer title={`Email ${contact.name}`} subtitle={contact.email} onClose={onClose} width={600}>
    {result ? <div className="ov-stack-sm">
      <Banner status={resultTone[result.status]} title={resultTitle[result.status]} description={result.reason} />
      <FormActions><Button label="Close" variant="primary" onClick={onDone} /></FormActions>
    </div> : <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        setResult(await api<SalesEmailResult>(`/crm/contacts/${contact.id}/email`, 'POST', { subject: subject.trim(), body, dealId: dealId ?? null, via }));
      });
    }}>
      <Selector label="Send from" value={via} onChange={value => setVia(value || 'gateway')} options={[
        { value: 'gateway', label: `OVELIO email gateway (replies go to ${user.email})` },
        ...(mailboxes.data ?? []).filter(item => item.status !== 'revoked').map(item => ({ value: item.id, label: `${item.email} (${item.provider === 'google' ? 'Gmail' : 'Outlook'})` })),
      ]} />
      <TextInput label="Subject" isRequired value={subject} onChange={setSubject} />
      <TextArea label="Message" rows={10} value={body} onChange={setBody}
        description="Merge tags such as {{contact.first_name}} are filled in for the recipient. Consent and suppression are checked before sending." />
      <Feedback error={action.error} />
      <FormActions>
        <Button label="Cancel" onClick={onClose} />
        <Button type="submit" variant="primary" label="Send email" icon={<Mail size={15} />} isLoading={action.busy} isDisabled={!subject.trim() || !body.trim()} />
      </FormActions>
    </form>}
  </SlideDrawer>;
}

