'use client';

import { Copy, ExternalLink, Pause, Play, Plus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { IconButton } from '@astryxdesign/core/IconButton';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Selector } from '@astryxdesign/core/Selector';
import { Table } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import type { JourneyEmail, LeadForm, Segment, Workflow, WorkflowInput, WorkflowStep } from '@/contracts';
import { api, number, useAction, useFields, useResource } from './client';
import { AsyncState, Empty, Feedback, FormActions, Modal, PageHeader, Panel, Snippet, StatusBadge, Tabs } from './ui';

const tabs = ['Workflows', 'Journey emails', 'Lead forms'] as const;
type Step = WorkflowStep & { key: number };
const workflowPath = '/workflows';
const emailPath = '/journey-emails';
const formPath = '/forms';
const recipes = [
  { id: 'blank', name: 'Blank workflow', delays: [0] },
  { id: 'welcome', name: 'Welcome sequence', delays: [0, 1440] },
  { id: 'nurture', name: 'Lead nurturing', delays: [0, 2880, 4320] },
  { id: 'follow-up', name: 'Follow-up email', delays: [1440] },
  { id: 're-engage', name: 'Re-engagement', delays: [0, 10080] },
];
const conditions = [
  { value: 'none', label: 'Continue without a condition' },
  { value: 'opened_previous', label: 'Previous email was opened' },
  { value: 'clicked_previous', label: 'Previous email link was clicked' },
];

function delayLabel(minutes: number) {
  if (!minutes) return 'Send immediately';
  if (minutes % 1440 === 0) return `Wait ${number(minutes / 1440)} day${minutes === 1440 ? '' : 's'}`;
  if (minutes % 60 === 0) return `Wait ${number(minutes / 60)} hour${minutes === 60 ? '' : 's'}`;
  return `Wait ${number(minutes)} minutes`;
}

function WorkflowForm({ workflow, onClose, onDone }: { workflow?: Workflow; onClose: () => void; onDone: () => void }) {
  const emails = useResource<JourneyEmail[]>(emailPath);
  const segments = useResource<Segment[]>('/segments');
  const action = useAction();
  const { values, field, setValues } = useFields({ name: workflow?.name ?? '', description: workflow?.description ?? '' });
  const [segmentId, setSegmentId] = useState<string | null>(workflow?.segmentId ? String(workflow.segmentId) : null);
  const [recipe, setRecipe] = useState('blank');
  const [steps, setSteps] = useState<Step[]>(() => workflow?.steps.map((step, key) => ({ ...step, key })) || [{ key: 0, emailId: 0, delayMinutes: 0 }]);
  const key = useRef(steps.length);
  const publishedSegments = segments.data?.filter(segment => segment.published);
  const publishedEmails = emails.data?.filter(email => email.published);
  const emailOptions = (publishedEmails ?? []).map(email => ({ value: String(email.id), label: email.name, description: email.subject }));
  const ready = !!publishedEmails?.length && !!publishedSegments?.length && !!segmentId && steps.every(step => step.emailId);

  function applyRecipe(id: string) {
    const chosen = recipes.find(item => item.id === id);
    if (!chosen) return;
    setRecipe(id);
    if (id !== 'blank') setValues(current => ({ ...current, name: chosen.name }));
    setSteps(chosen.delays.map(delayMinutes => ({ key: key.current++, delayMinutes, emailId: 0 })));
  }
  const updateStep = (stepKey: number, parts: Partial<WorkflowStep>) => setSteps(items => items.map(step => step.key === stepKey ? { ...step, ...parts } : step));

  return <Modal title={workflow ? 'Edit automation' : 'Create automation'} onClose={onClose} size="large">
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      const input: WorkflowInput = {
        name: values.name.trim(), description: values.description.trim(), segmentId: Number(segmentId),
        steps: steps.map(({ emailId, delayMinutes, condition }, index) => ({ emailId, delayMinutes, ...(index > 0 && condition ? { condition } : {}) })),
      };
      void action.run(async () => { await api(workflow ? `${workflowPath}/${workflow.id}` : workflowPath, workflow ? 'PATCH' : 'POST', input); onDone(); });
    }}>
      {!workflow ? <Selector label="Workflow template" value={recipe} onChange={value => applyRecipe(value ?? 'blank')}
        options={recipes.map(item => ({ value: item.id, label: item.name, description: `${item.delays.length} step${item.delays.length > 1 ? 's' : ''}` }))} /> : null}
      <div className="ov-form-grid">
        <TextInput label="Workflow name" isRequired {...field('name')} />
        <Selector label="Trigger segment" description="Contacts entering this segment start the workflow." placeholder="Select a segment" isLoading={segments.loading}
          value={segmentId} hasClear onChange={setSegmentId} options={(publishedSegments ?? []).map(segment => ({ value: String(segment.id), label: segment.name }))} />
      </div>
      <TextArea label="Description" isOptional rows={2} {...field('description')} />
      <Feedback error={segments.error || emails.error} />
      {publishedSegments && !publishedSegments.length ? <Text color="secondary">Create and publish a segment in Audience first.</Text> : null}
      {publishedEmails && !publishedEmails.length ? <Text color="secondary">Create a journey email from the Journey emails tab first.</Text> : null}
      {steps.map((step, index) => <div key={step.key} className="ov-step">
        <div className="ov-step-heading"><Text weight="semibold">Step {index + 1}</Text>
          {steps.length > 1 ? <IconButton variant="ghost" size="sm" label={`Remove step ${index + 1}`} icon={<Trash2 size={15} />} onClick={() => setSteps(items => items.filter(item => item.key !== step.key))} /> : null}
        </div>
        <div className="ov-form-grid">
          <Selector label={`Step ${index + 1} email`} placeholder="Choose a journey email" value={step.emailId ? String(step.emailId) : null} hasClear
            onChange={value => updateStep(step.key, { emailId: Number(value) || 0 })} options={emailOptions} />
          <NumberInput label={`Step ${index + 1} delay`} units="minutes" min={0} max={525600} isIntegerOnly value={step.delayMinutes}
            description={delayLabel(step.delayMinutes)} onChange={value => updateStep(step.key, { delayMinutes: value })} />
        </div>
        {index > 0 ? <Selector label={`Step ${index + 1} condition`} value={step.condition ?? 'none'} options={conditions}
          onChange={value => updateStep(step.key, { condition: value === 'opened_previous' || value === 'clicked_previous' ? value : undefined })} /> : null}
      </div>)}
      {steps.length < 12 ? <div><Button label="Add step" icon={<Plus size={15} />} onClick={() => setSteps(items => [...items, { key: key.current++, emailId: 0, delayMinutes: 0 }])} /></div> : null}
      <Feedback error={action.error} />
      <FormActions><Button label="Cancel" onClick={onClose} />
        <Button type="submit" variant="primary" label={workflow ? 'Save changes' : 'Save workflow'} isLoading={action.busy} isDisabled={!ready || !values.name.trim()} />
      </FormActions>
    </form>
  </Modal>;
}

function JourneyEmailForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const action = useAction();
  const { values, field } = useFields({ name: '', subject: '', body: '' });
  return <Modal title="Create journey email" onClose={onClose} size="large">
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => { await api(emailPath, 'POST', { name: values.name.trim(), subject: values.subject.trim(), body: values.body }); onDone(); });
    }}>
      <TextInput label="Email name" isRequired {...field('name')} />
      <TextInput label="Subject" isRequired {...field('subject')} />
      <TextArea label="Email content (HTML)" rows={9} isRequired hasSpellCheck={false} placeholder="<h1>Welcome!</h1>" {...field('body')} />
      <Feedback error={action.error} />
      <FormActions><Button label="Cancel" onClick={onClose} />
        <Button type="submit" variant="primary" label="Save journey email" isLoading={action.busy} isDisabled={!values.name.trim() || !values.subject.trim() || !values.body.trim()} />
      </FormActions>
    </form>
  </Modal>;
}

function LeadFormEditor({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const action = useAction();
  const { values, field } = useFields({ name: '', message: '' });
  return <Modal title="Create lead form" onClose={onClose}>
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => { await api(formPath, 'POST', { name: values.name.trim(), message: values.message.trim() || undefined }); onDone(); });
    }}>
      <TextInput label="Form name" isRequired {...field('name')} />
      <TextArea label="Confirmation message" isOptional placeholder="Thank you for getting in touch." {...field('message')} />
      <Text type="supporting" color="secondary">The form captures an email address. Record marketing consent separately before sending marketing emails.</Text>
      <Feedback error={action.error} />
      <FormActions><Button label="Cancel" onClick={onClose} /><Button type="submit" variant="primary" label="Create form" isLoading={action.busy} isDisabled={!values.name.trim()} /></FormActions>
    </form>
  </Modal>;
}

function StatusDialog({ workflow, onClose, onDone }: { workflow: Workflow; onClose: () => void; onDone: (message: string) => void }) {
  const action = useAction();
  const title = workflow.enabled ? 'Disable automation' : 'Enable automation';
  return <Modal title={title} onClose={onClose}>
    <Text>{workflow.enabled ? 'Pause workflow execution for ' : 'Allow execution and email delivery for eligible contacts in '}<strong>{workflow.name}</strong>?</Text>
    <Feedback error={action.error} />
    <FormActions><Button label="Cancel" onClick={onClose} />
      <Button variant="primary" label={title} isLoading={action.busy} onClick={() => void action.run(async () => {
        await api(`${workflowPath}/${workflow.id}/status`, 'POST', { enabled: !workflow.enabled });
        onDone(workflow.enabled ? 'Automation disabled.' : 'Automation enabled.');
      })} />
    </FormActions>
  </Modal>;
}

export function Automations() {
  const [tab, setTab] = useState<typeof tabs[number]>('Workflows');
  const [editor, setEditor] = useState<'new' | Workflow>();
  const [createEmail, setCreateEmail] = useState(false);
  const [createForm, setCreateForm] = useState(false);
  const [changeStatus, setChangeStatus] = useState<Workflow>();
  const [formEmbed, setFormEmbed] = useState<{ form: LeadForm; snippet: string }>();
  const [notice, setNotice] = useState('');
  const workflows = useResource<Workflow[]>(tab === 'Workflows' ? workflowPath : null);
  const emails = useResource<JourneyEmail[]>(tab === 'Journey emails' || (tab === 'Workflows' && !!workflows.data?.length) ? emailPath : null);
  const segments = useResource<Segment[]>(tab === 'Workflows' && !!workflows.data?.length ? '/segments' : null);
  const forms = useResource<LeadForm[]>(tab === 'Lead forms' ? formPath : null);
  const copy = useAction();
  const create = { 'Workflows': ['Create automation', () => setEditor('new')], 'Journey emails': ['Create journey email', () => setCreateEmail(true)], 'Lead forms': ['Create lead form', () => setCreateForm(true)] } as const;

  return <>
    <PageHeader title="Automations" description="Send journeys based on audience membership and email activity."
      actions={<Button variant="primary" icon={<Plus size={16} />} label={create[tab][0]} onClick={create[tab][1]} />} />
    <Tabs label="Automation view" items={tabs} value={tab} onChange={value => { setTab(value); setNotice(''); }} />
    <Feedback notice={notice} />
    {tab === 'Workflows' ? <Panel title="Workflows" description="A workflow shows as Active only after the automation engine confirms it is enabled.">
      {!workflows.data ? <AsyncState loading={workflows.loading} error={workflows.error} retry={workflows.refresh} />
        : workflows.data.length ? <div className="ov-stack-sm">{workflows.data.map(workflow => <article className="ov-step" key={workflow.id}>
          <div className="ov-step-heading">
            <div className="ov-cell"><Heading level={3}>{workflow.name}</Heading>
              <Text type="supporting" color="secondary">Trigger: {segments.data?.find(segment => segment.id === workflow.segmentId)?.name || (workflow.segmentId ? `Segment ${workflow.segmentId}` : 'Managed trigger')}</Text></div>
            <StatusBadge label={workflow.enabled ? 'Active' : 'Inactive'} tone={workflow.enabled ? 'success' : 'neutral'} />
          </div>
          {workflow.description ? <Text color="secondary">{workflow.description}</Text> : null}
          {workflow.steps.length ? <ol className="ov-flow">{workflow.steps.map((step, index) => <li key={index}>
            <span><Text weight="medium">{index + 1}. {emails.data?.find(email => email.id === step.emailId)?.name || `Email ${step.emailId}`}</Text>
              {step.condition ? <Text type="supporting" color="secondary">{step.condition === 'opened_previous' ? 'Only if the previous email was opened' : 'Only if a previous link was clicked'}</Text> : null}</span>
            <Text type="supporting" color="secondary">{delayLabel(step.delayMinutes)}</Text>
          </li>)}</ol> : null}
          <div className="ov-actions">
            {!workflow.enabled && workflow.editable !== false ? <Button size="sm" label="Edit workflow" onClick={() => setEditor(workflow)} /> : null}
            <Button size="sm" label={workflow.enabled ? 'Disable' : 'Enable'} icon={workflow.enabled ? <Pause size={14} /> : <Play size={14} />} onClick={() => setChangeStatus(workflow)} />
          </div>
        </article>)}</div> : <Empty title="No workflows yet" description="Start from a welcome, nurture, follow-up or re-engagement template." />}
    </Panel> : null}
    {tab === 'Journey emails' ? <Panel title="Journey emails" description="Reusable messages for automation steps.">
      {!emails.data ? <AsyncState loading={emails.loading} error={emails.error} retry={emails.refresh} />
        : <Table data={emails.data} idKey="id" emptyState={<Empty title="No journey emails yet" />} columns={[
          { key: 'name', header: 'Name' },
          { key: 'subject', header: 'Subject' },
          { key: 'published', header: 'Status', renderCell: email => <StatusBadge label={email.published ? 'Published' : 'Draft'} tone={email.published ? 'success' : 'neutral'} /> },
        ]} />}
    </Panel> : null}
    {tab === 'Lead forms' ? <Panel title="Lead forms" description="View submissions and copy embed code for published forms.">
      {!forms.data ? <AsyncState loading={forms.loading} error={forms.error} retry={forms.refresh} />
        : <Table data={forms.data} idKey="id" emptyState={<Empty title="No lead forms available" />} columns={[
          { key: 'name', header: 'Form' },
          { key: 'published', header: 'Status', renderCell: form => <StatusBadge label={form.published ? 'Published' : 'Draft'} tone={form.published ? 'success' : 'neutral'} /> },
          { key: 'submissions', header: 'Submissions', align: 'end', renderCell: form => number(form.submissions) },
          { key: 'id', header: 'Embed', align: 'end', renderCell: form => form.published ? <span className="ov-actions ov-actions--end">
            <Button size="sm" label="Embed code" onClick={() => setFormEmbed({ form, snippet: `<script src="${location.origin}/form/generate.js?id=${form.id}"></script>` })} />
            <Button size="sm" variant="ghost" label="View form" icon={<ExternalLink size={14} />} href={`/form/embed/${form.id}`} target="_blank" rel="noreferrer" />
          </span> : '—' },
        ]} />}
    </Panel> : null}
    {editor ? <WorkflowForm workflow={editor === 'new' ? undefined : editor} onClose={() => setEditor(undefined)} onDone={() => {
      setEditor(undefined); setNotice(editor === 'new' ? 'Workflow saved. Enable it to start enrolling contacts.' : 'Changes saved.'); workflows.refresh();
    }} /> : null}
    {createEmail ? <JourneyEmailForm onClose={() => setCreateEmail(false)} onDone={() => { setCreateEmail(false); setNotice('Journey email saved.'); emails.refresh(); }} /> : null}
    {createForm ? <LeadFormEditor onClose={() => setCreateForm(false)} onDone={() => { setCreateForm(false); setNotice('Lead form created.'); forms.refresh(); }} /> : null}
    {changeStatus ? <StatusDialog workflow={changeStatus} onClose={() => setChangeStatus(undefined)} onDone={result => { setChangeStatus(undefined); setNotice(result); workflows.refresh(); }} /> : null}
    {formEmbed ? <Modal title={`Embed ${formEmbed.form.name}`} onClose={() => setFormEmbed(undefined)}>
      <Snippet code={formEmbed.snippet} />
      <Feedback notice={copy.notice} error={copy.error} />
      <FormActions><Button label="Copy code" icon={<Copy size={15} />} onClick={() => void copy.run(async () => navigator.clipboard.writeText(formEmbed.snippet), 'Embed code copied.')} /></FormActions>
    </Modal> : null}
  </>;
}
