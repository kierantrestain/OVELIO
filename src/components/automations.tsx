'use client';

import { ArrowDown, Copy, ExternalLink, Pause, Play, Plus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import type { JourneyEmail, LeadForm, Segment, Workflow, WorkflowInput, WorkflowStep } from '@/contracts';
import { api, number, useAction, useResource } from './client';
import { AsyncState, Badge, Button, Dialog, Empty, Feedback, Field, PageHeader, Panel } from './ui';

type AutomationTab = 'Workflows' | 'Journey emails' | 'Lead forms';
type Step = WorkflowStep & { key: number };
const tabs: AutomationTab[] = ['Workflows', 'Journey emails', 'Lead forms'];
const workflowPath = '/workflows';
const emailPath = '/journey-emails';
const formPath = '/forms';
const recipes = [
  { id: 'welcome', name: 'Welcome sequence', delays: [0, 1440] },
  { id: 'nurture', name: 'Lead nurturing', delays: [0, 2880, 4320] },
  { id: 'follow-up', name: 'Follow-up email', delays: [1440] },
  { id: 're-engage', name: 'Re-engagement', delays: [0, 10080] },
];

function WorkflowForm({ workflow, onClose, onDone }: { workflow?: Workflow; onClose: () => void; onDone: () => void }) {
  const emails = useResource<JourneyEmail[]>(emailPath);
  const segments = useResource<Segment[]>('/segments');
  const action = useAction();
  const [name, setName] = useState(workflow?.name ?? '');
  const [steps, setSteps] = useState<Step[]>(() => workflow?.steps.map((step, key) => ({ ...step, key })) || [{ key: 0, emailId: 0, delayMinutes: 0 }]);
  const key = useRef(steps.length);
  const publishedSegments = segments.data?.filter(segment => segment.published);
  const publishedEmails = emails.data?.filter(email => email.published);

  function applyRecipe(id: string) {
    const recipe = recipes.find(item => item.id === id);
    if (!recipe) return;
    setName(recipe.name);
    setSteps(recipe.delays.map(delayMinutes => ({ key: key.current++, delayMinutes, emailId: 0 })));
  }

  function updateStep(stepKey: number, parts: Partial<WorkflowStep>) {
    setSteps(items => items.map(step => step.key === stepKey ? { ...step, ...parts } : step));
  }

  return <Dialog title={workflow ? 'Edit automation' : 'Create automation'} onClose={onClose} size="large">
    <form className="form-stack" onSubmit={event => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const input: WorkflowInput = {
        name: name.trim(),
        description: String(data.get('description')).trim(),
        segmentId: Number(data.get('segmentId')),
        steps: steps.map(({ emailId, delayMinutes, condition }, index) => ({ emailId, delayMinutes, ...(index > 0 && condition ? { condition } : {}) })),
      };
      void action.run(async () => {
        await api(workflow ? `${workflowPath}/${workflow.id}` : workflowPath, workflow ? 'PATCH' : 'POST', input);
        onDone();
      });
    }}>
      {!workflow ? <Field label="Workflow template">
        <select defaultValue="" onChange={event => applyRecipe(event.target.value)}><option value="">Blank workflow</option>
          {recipes.map(recipe => <option key={recipe.id} value={recipe.id}>{recipe.name}</option>)}
        </select>
      </Field> : null}
      <div className="form-grid">
        <Field label="Workflow name"><input name="name" required maxLength={120} value={name} onChange={event => setName(event.target.value)} /></Field>
        <Field label="Trigger segment" help="The workflow runs for members of this segment.">
          <select name="segmentId" key={publishedSegments ? 'ready' : 'loading'} required defaultValue={workflow?.segmentId || ''}>
            <option value="" disabled>Select a segment</option>
            {publishedSegments?.map(segment => <option key={segment.id} value={segment.id}>{segment.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Description"><textarea name="description" maxLength={500} defaultValue={workflow?.description} /></Field>
      <Feedback error={segments.error || emails.error} />
      {publishedSegments && !publishedSegments.length ? <p className="caption">Create a segment in Audience first.</p> : null}
      {publishedEmails && !publishedEmails.length ? <p className="caption">Create a journey email from the Journey emails tab first.</p> : null}
      {steps.map((step, index) => <div key={step.key} className="step">
        <div className="step-heading"><span>Step {index + 1}</span>
          {steps.length > 1 ? <Button variant="quiet" className="icon-button" aria-label={`Remove step ${index + 1}`} onClick={() => setSteps(items => items.filter(item => item.key !== step.key))}><Trash2 size={16} /></Button> : null}
        </div>
        <div className="form-grid">
          <Field label={`Step ${index + 1} email`}>
            <select value={step.emailId || ''} required onChange={event => updateStep(step.key, { emailId: Number(event.target.value) })}>
              <option value="" disabled>Choose a journey email</option>
              {publishedEmails?.map(email => <option value={email.id} key={email.id}>{email.name}</option>)}
            </select>
          </Field>
          <Field label={`Step ${index + 1} delay in minutes`}>
            <input type="number" min="0" max="525600" required value={step.delayMinutes}
              onChange={event => updateStep(step.key, { delayMinutes: Number(event.target.value) })} />
          </Field>
        </div>
        {index > 0 ? <Field label={`Step ${index + 1} condition`}>
          <select value={step.condition ?? ''} onChange={event => {
            const condition = event.target.value as WorkflowStep['condition'] | '';
            updateStep(step.key, { condition: condition || undefined });
          }}>
            <option value="">Continue without a condition</option><option value="opened_previous">Previous email was opened</option>
            <option value="clicked_previous">Previous email link was clicked</option>
          </select>
        </Field> : null}
      </div>)}
      {steps.length < 12 ? <div><Button onClick={() => {
        const next = { key: key.current++, emailId: 0, delayMinutes: 0 };
        setSteps(items => [...items, next]);
      }}><Plus size={15} /> Add step</Button></div> : null}
      <Feedback error={action.error} />
      <div className="form-actions">
        <Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" disabled={action.busy || !publishedEmails?.length || !publishedSegments?.length}>{workflow ? 'Save changes' : 'Save workflow'}</Button>
      </div>
    </form>
  </Dialog>;
}

function JourneyEmailForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const action = useAction();
  return <Dialog title="Create journey email" onClose={onClose} size="large">
    <form className="form-stack" onSubmit={event => {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      void action.run(async () => {
        await api(emailPath, 'POST', { name: String(values.get('name')).trim(), subject: String(values.get('subject')).trim(), body: String(values.get('body')) });
        onDone();
      });
    }}>
      <Field label="Email name"><input name="name" required maxLength={120} /></Field>
      <Field label="Subject"><input name="subject" required maxLength={160} /></Field>
      <Field label="Email content (HTML)"><textarea name="body" className="code-input" required maxLength={160000} rows={8} placeholder="<h1>Welcome!</h1>" /></Field>
      <Feedback error={action.error} />
      <div className="form-actions"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" disabled={action.busy}>Save journey email</Button></div>
    </form>
  </Dialog>;
}

function LeadFormEditor({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const action = useAction();
  return <Dialog title="Create lead form" onClose={onClose}>
    <form className="form-stack" onSubmit={event => {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      const message = String(values.get('message')).trim();
      void action.run(async () => {
        await api(formPath, 'POST', { name: String(values.get('name')).trim(), message: message || undefined });
        onDone();
      });
    }}>
      <Field label="Form name"><input name="name" required maxLength={120} /></Field>
      <Field label="Confirmation message"><textarea name="message" maxLength={500} placeholder="Thank you for getting in touch." /></Field>
      <p className="caption">The form captures an email address. Record marketing consent separately before sending marketing emails.</p>
      <Feedback error={action.error} />
      <div className="form-actions"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" disabled={action.busy}>Create form</Button></div>
    </form>
  </Dialog>;
}

function StatusDialog({ workflow, onClose, onDone }: { workflow: Workflow; onClose: () => void; onDone: (message: string) => void }) {
  const action = useAction();
  const title = workflow.enabled ? 'Disable automation' : 'Enable automation';
  return <Dialog title={title} onClose={onClose}>
    <div className="stack-small">
      <p>{workflow.enabled ? 'Pause workflow execution for ' : 'Allow execution and email delivery for eligible contacts in '}<strong>{workflow.name}</strong>?</p>
      <Feedback error={action.error} />
      <div className="form-actions"><Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={action.busy} onClick={() => void action.run(async () => {
          await api(`${workflowPath}/${workflow.id}/status`, 'POST', { enabled: !workflow.enabled });
          onDone(workflow.enabled ? 'Automation disabled.' : 'Automation enabled.');
        })}>{title}</Button>
      </div>
    </div>
  </Dialog>;
}

export function Automations() {
  const [tab, setTab] = useState<AutomationTab>('Workflows');
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
  return <>
    <PageHeader title="Automations" description="Send journeys based on audience membership and email activity." actions={tab === 'Workflows'
      ? <Button variant="primary" onClick={() => setEditor('new')}><Plus size={16} /> Create automation</Button>
      : tab === 'Journey emails' ? <Button variant="primary" onClick={() => setCreateEmail(true)}><Plus size={16} /> Create journey email</Button>
        : <Button variant="primary" onClick={() => setCreateForm(true)}><Plus size={16} /> Create lead form</Button>} />
    <nav className="tabs" aria-label="Automation view">{tabs.map(value => <button key={value} aria-pressed={tab === value} onClick={() => { setTab(value); setNotice(''); }}>{value}</button>)}</nav>
    <div className="stack-small"><Feedback notice={notice} />
      {tab === 'Workflows' ? <Panel title="Workflows">
        {!workflows.data ? <AsyncState loading={workflows.loading} error={workflows.error} retry={workflows.refresh} />
          : workflows.data.length ? <div className="panel-body stack">
            {workflows.data.map(workflow => <article className="step" key={workflow.id}>
              <div className="actions actions--between">
                <div><h3>{workflow.name}</h3><p className="caption">{segments.data?.find(segment => segment.id === workflow.segmentId)?.name || (workflow.segmentId ? `Segment ${workflow.segmentId}` : 'Managed trigger')}</p></div>
                <Badge tone={workflow.enabled ? 'green' : 'neutral'}>{workflow.enabled ? 'Active' : 'Inactive'}</Badge>
              </div>
              {workflow.description ? <p className="caption">{workflow.description}</p> : null}
              {workflow.steps.length ? <ol className="workflow-steps">{workflow.steps.map((step, index) => <li key={index}>
                <span><strong>{emails.data?.find(email => email.id === step.emailId)?.name || `Email ${step.emailId}`}</strong>
                  {step.condition ? <small>{step.condition === 'opened_previous' ? 'After previous open' : 'After previous click'}</small> : null}</span>
                <span className="caption">{step.delayMinutes ? `${number(step.delayMinutes)} min delay` : 'Send immediately'}</span>
                {index + 1 < workflow.steps.length ? <ArrowDown size={12} aria-hidden="true" /> : null}
              </li>)}</ol> : null}
              <div className="actions">
                {!workflow.enabled && workflow.editable !== false ? <Button onClick={() => setEditor(workflow)}>Edit workflow</Button> : null}
                <Button onClick={() => setChangeStatus(workflow)}>{workflow.enabled ? <Pause size={14} /> : <Play size={14} />}{workflow.enabled ? 'Disable' : 'Enable'}</Button>
              </div>
            </article>)}
          </div> : <Empty title="No workflows yet" />}
      </Panel> : null}
      {tab === 'Journey emails' ? <Panel title="Journey emails" description="Reusable messages for automation steps.">
        {!emails.data ? <AsyncState loading={emails.loading} error={emails.error} retry={emails.refresh} />
          : emails.data.length ? <div className="table-wrap"><table className="table">
            <thead><tr><th scope="col">Name</th><th scope="col">Subject</th><th scope="col">Status</th></tr></thead>
            <tbody>{emails.data.map(email => <tr key={email.id}><td>{email.name}</td><td>{email.subject}</td><td><Badge tone={email.published ? 'green' : 'neutral'}>{email.published ? 'Published' : 'Draft'}</Badge></td></tr>)}</tbody>
          </table></div> : <Empty title="No journey emails yet" />}
      </Panel> : null}
      {tab === 'Lead forms' ? <Panel title="Lead forms" description="View submissions and copy embed code for published forms.">
        {!forms.data ? <AsyncState loading={forms.loading} error={forms.error} retry={forms.refresh} />
          : forms.data.length ? <div className="table-wrap"><table className="table">
            <thead><tr><th scope="col">Form</th><th scope="col">Status</th><th scope="col" className="num">Submissions</th><th scope="col">Embed</th></tr></thead>
            <tbody>{forms.data.map(form => <tr key={form.id}>
              <td>{form.name}</td><td><Badge tone={form.published ? 'green' : 'neutral'}>{form.published ? 'Published' : 'Draft'}</Badge></td>
              <td className="num">{number(form.submissions)}</td>
              <td>{form.published ? <div className="actions">
                <Button onClick={() => setFormEmbed({ form, snippet: `<script src="${location.origin}/form/generate.js?id=${form.id}"></script>` })}>Embed code</Button>
                <a className="button button--secondary" href={`/form/embed/${form.id}`} target="_blank" rel="noreferrer">View form <ExternalLink size={14} /></a>
              </div> : '—'}</td>
            </tr>)}</tbody>
          </table></div> : <Empty title="No lead forms available" />}
      </Panel> : null}
    </div>
    {editor ? <WorkflowForm workflow={editor === 'new' ? undefined : editor} onClose={() => setEditor(undefined)} onDone={() => {
      setEditor(undefined);
      setNotice(editor === 'new' ? 'Workflow saved.' : 'Changes saved.');
      workflows.refresh();
    }} /> : null}
    {createEmail ? <JourneyEmailForm onClose={() => setCreateEmail(false)} onDone={() => {
      setCreateEmail(false);
      setNotice('Journey email saved.');
      emails.refresh();
    }} /> : null}
    {createForm ? <LeadFormEditor onClose={() => setCreateForm(false)} onDone={() => {
      setCreateForm(false);
      setNotice('Lead form created.');
      forms.refresh();
    }} /> : null}
    {changeStatus ? <StatusDialog workflow={changeStatus} onClose={() => setChangeStatus(undefined)} onDone={result => {
      setChangeStatus(undefined);
      setNotice(result);
      workflows.refresh();
    }} /> : null}
    {formEmbed ? <Dialog title={`Embed ${formEmbed.form.name}`} onClose={() => setFormEmbed(undefined)}>
      <div className="stack-small"><pre className="snippet">{formEmbed.snippet}</pre><Feedback notice={copy.notice} error={copy.error} />
        <div className="form-actions"><Button onClick={() => void copy.run(async () => navigator.clipboard.writeText(formEmbed.snippet), 'Embed code copied.')}><Copy size={15} /> Copy code</Button></div>
      </div>
    </Dialog> : null}
  </>;
}
