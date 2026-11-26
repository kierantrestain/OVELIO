'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { IconButton } from '@astryxdesign/core/IconButton';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import type { ConditionCheck, FlowNode, FlowTrigger, FlowTriggerType, ReentryRule, TriggerFilters } from '@/contracts/journeys';
import {
  clampPercent, conditionChecks, contactFieldChoices, describeTrigger, flowTriggerSpecs, needsCompare, nodeIssues, nodeSpec, operatorLabels,
  tagsOf, triggerSpec,
} from '@/contracts/journeys';
import type { DesignOption, Lookup, NamedOption, PipelineOption, TeamMember } from './shared';
import { lookupHint, nodeIcons } from './shared';

export type BuilderLookups = {
  designs: Lookup<DesignOption>;
  forms: Lookup<NamedOption>;
  pages: Lookup<NamedOption>;
  pipelines: Lookup<PipelineOption>;
  team: Lookup<TeamMember>;
  campaigns: Lookup<NamedOption>;
};

const str = (value: unknown) => typeof value === 'string' ? value : value == null ? '' : String(value);
const numberOr = (value: unknown, fallback: number | null = null) => {
  const n = Number(value);
  return value === '' || value == null || !Number.isFinite(n) ? fallback : n;
};

function TagField({ label, value, onChange }: { label: string; value: unknown; onChange: (tags: string[]) => void }) {
  const [text, setText] = useState(tagsOf(value).join(', '));
  return <TextInput label={label} description="Separate tags with commas." value={text} placeholder="e.g. webinar-2026, vip"
    onChange={next => { setText(next); onChange(next.split(',').map(tag => tag.trim()).filter(Boolean)); }} />;
}

function stageOptions(pipelines: PipelineOption[], pipelineId: string) {
  const pipeline = pipelines.find(item => item.id === pipelineId) ?? pipelines.find(item => item.isDefault) ?? pipelines[0];
  return { pipeline, stages: pipeline?.stages ?? [] };
}

function PipelineStagePicker({ config, lookups, set, stageRequired, stageLabel = 'Stage' }: {
  config: Record<string, unknown>; lookups: BuilderLookups; set: (patch: Record<string, unknown>) => void; stageRequired?: boolean; stageLabel?: string;
}) {
  const { pipeline, stages } = stageOptions(lookups.pipelines.items, str(config.pipelineId));
  const hint = lookupHint(lookups.pipelines, 'Pipelines', 'Set them up in Sales › Pipelines.');
  return <>
    <Selector label="Pipeline" value={pipeline?.id ?? null} isLoading={lookups.pipelines.status === 'loading'} description={hint}
      options={lookups.pipelines.items.map(item => ({ value: item.id, label: item.name }))}
      onChange={value => set({ pipelineId: value ?? '', stageId: '', stageName: '' })} />
    <Selector label={stageLabel} value={str(config.stageId) || null} isRequired={stageRequired} hasClear
      placeholder={stageRequired ? 'Choose a stage' : 'First open stage'} isDisabled={!stages.length}
      options={stages.map(stage => ({ value: stage.id, label: stage.name, description: stage.outcome && stage.outcome !== 'open' ? `Closes the deal as ${stage.outcome}` : undefined }))}
      onChange={value => set({ pipelineId: pipeline?.id ?? '', stageId: value ?? '', stageName: stages.find(stage => stage.id === value)?.name ?? '' })} />
  </>;
}

function UserPicker({ label, value, lookups, onChange, ownerLabel }: { label: string; value: string; lookups: BuilderLookups; onChange: (value: string) => void; ownerLabel: string }) {
  return <Selector label={label} value={value || 'owner'} isLoading={lookups.team.status === 'loading'}
    description={lookupHint(lookups.team, 'Team members', '')}
    options={[{ value: 'owner', label: ownerLabel, description: 'The deal owner, else the contact owner, else the workflow owner.' },
      ...lookups.team.items.map(member => ({ value: member.id, label: member.name, description: member.email }))]}
    onChange={next => onChange(!next || next === 'owner' ? '' : next)} />;
}

function generateSecret() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

/** The settings form for one step. Edits apply to the draft immediately; Save stores the draft. */
export function NodeConfig({ node, lookups, readOnly, onChange, onDelete }: {
  node: FlowNode; lookups: BuilderLookups; readOnly: boolean; onChange: (config: Record<string, unknown>) => void; onDelete: () => void;
}) {
  const spec = nodeSpec(node.type);
  const c = node.config ?? {};
  const set = (patch: Record<string, unknown>) => onChange({ ...c, ...patch });
  const Icon = nodeIcons[node.type];
  const issues = nodeIssues(node);
  const check = conditionChecks.find(item => item.value === c.check) ?? conditionChecks[0];

  const body = (() => {
    switch (node.type) {
      case 'wait': return <>
        <SegmentedControl label="Wait type" size="sm" value={c.mode === 'until' ? 'until' : 'duration'} onChange={value => set(value === 'until' ? { mode: 'until' } : { mode: 'duration', amount: numberOr(c.amount, 1), unit: str(c.unit) || 'days' })}>
          <SegmentedControlItem value="duration" label="For a time" />
          <SegmentedControlItem value="until" label="Until a date" />
        </SegmentedControl>
        {c.mode === 'until' ? <label className="ov-stack-sm">
          <Text type="label">Continue on (UTC)</Text>
          <input className="ov-wf-native" type="datetime-local" value={str(c.until).slice(0, 16)} aria-label="Continue on (UTC)"
            onChange={event => set({ until: event.target.value ? new Date(event.target.value + 'Z').toISOString() : '' })}
            style={{ font: 'inherit', padding: '6px 8px', border: '1px solid var(--color-border)', borderRadius: 8, background: 'var(--color-background-surface)', color: 'var(--color-text-primary)' }} />
        </label> : <div className="ov-form-grid">
          <NumberInput label="Amount" min={1} max={1000} isIntegerOnly value={numberOr(c.amount)} onChange={value => set({ amount: value })} />
          <Selector label="Unit" value={str(c.unit) || 'days'} options={['minutes', 'hours', 'days', 'weeks'].map(unit => ({ value: unit, label: unit[0].toUpperCase() + unit.slice(1) }))}
            onChange={value => set({ unit: value ?? 'days' })} />
        </div>}
      </>;
      case 'condition': return <>
        <Selector label="Check" value={check.value} options={conditionChecks.map(item => ({ value: item.value, label: item.label }))}
          onChange={value => { const next = conditionChecks.find(item => item.value === value) ?? conditionChecks[0]; set({ check: next.value as ConditionCheck, operator: next.operators[0], value: '', field: '' }); }} />
        {check.value === 'field' ? <Selector label="Field" hasClear value={str(c.field) || null} placeholder="Choose a field"
          options={contactFieldChoices.map(item => ({ value: item.value, label: item.label }))} onChange={value => set({ field: value ?? '' })} /> : null}
        {check.value === 'form_field' ? <TextInput label="Form field name" description="The field’s name in the form that started the workflow, e.g. role." value={str(c.field)} onChange={value => set({ field: value })} /> : null}
        <Selector label="Comparison" value={check.operators.includes(c.operator as never) ? str(c.operator) : check.operators[0]}
          options={check.operators.map(op => ({ value: op, label: operatorLabels[op] }))} onChange={value => set({ operator: value ?? check.operators[0] })} />
        {check.needsValue && needsCompare(c.operator) ? <TextInput label={check.value === 'tag' ? 'Tag' : 'Value'} value={str(c.value)} onChange={value => set({ value })}
          description={check.value === 'deal_value' ? 'Compares the deal that started the workflow, else the contact’s largest deal.' : undefined} /> : null}
        <Text type="supporting" color="secondary">Contacts who match continue on the Yes path; everyone else takes No.</Text>
      </>;
      case 'split': return <>
        <NumberInput label="Share for path A (%)" min={1} max={99} isIntegerOnly value={clampPercent(c.percentA)} onChange={value => set({ percentA: value })} />
        <Text type="supporting" color="secondary">Path B gets {100 - clampPercent(c.percentA)}%. Each contact is assigned once and keeps their path on retries.</Text>
      </>;
      case 'send_email': return <>
        <Selector label="Email design" hasClear value={str(c.designId) || null} placeholder="Choose an email" isLoading={lookups.designs.status === 'loading'}
          description={lookupHint(lookups.designs, 'Email designs', 'Create one in Marketing › Templates.')}
          options={lookups.designs.items.map(design => ({ value: design.id, label: design.name, description: design.subject }))}
          onChange={value => set({ designId: value ?? '', designName: lookups.designs.items.find(item => item.id === value)?.name ?? '' })} />
        <Text type="supporting" color="secondary">Sent as marketing email through OVELIO’s mailer: consent and suppression are checked first, and a blocked or undelivered message is logged with its reason instead of failing the workflow.</Text>
      </>;
      case 'add_tag': case 'remove_tag': return <TagField key={node.id} label={node.type === 'add_tag' ? 'Tags to add' : 'Tags to remove'} value={c.tags} onChange={tags => set({ tags })} />;
      case 'adjust_score': return <NumberInput label="Points" description="Use a negative number to subtract." min={-1000} max={1000} isIntegerOnly value={numberOr(c.delta)} onChange={value => set({ delta: value })} />;
      case 'create_deal': return <>
        <TextInput label="Deal name" description="Merge tags such as {{contact.full_name}} are filled in." value={str(c.name)} onChange={value => set({ name: value })} />
        <NumberInput label="Value" min={0} value={numberOr(c.amount, 0)} onChange={value => set({ amount: value })} />
        <PipelineStagePicker config={c} lookups={lookups} set={set} />
        <UserPicker label="Owner" value={str(c.ownerId)} lookups={lookups} ownerLabel="Record owner" onChange={value => set({ ownerId: value })} />
        <Text type="supporting" color="secondary">The deal is attributed to this workflow’s campaign.</Text>
      </>;
      case 'move_deal': return <>
        <PipelineStagePicker config={c} lookups={lookups} set={set} stageRequired stageLabel="Move to stage" />
        <Text type="supporting" color="secondary">Moves the deal that started the workflow. Enrolments without a deal skip this step.</Text>
      </>;
      case 'create_task': return <>
        <TextInput label="Title" value={str(c.title)} onChange={value => set({ title: value })} />
        <TextArea label="Notes" isOptional value={str(c.notes)} onChange={value => set({ notes: value })} />
        <div className="ov-form-grid">
          <Selector label="Type" value={str(c.type) || 'follow_up'} options={[['follow_up', 'Follow-up'], ['call', 'Call'], ['email', 'Email'], ['meeting', 'Meeting'], ['todo', 'To-do']].map(([value, label]) => ({ value, label }))} onChange={value => set({ type: value ?? 'follow_up' })} />
          <Selector label="Priority" value={str(c.priority) || 'normal'} options={[['low', 'Low'], ['normal', 'Normal'], ['high', 'High']].map(([value, label]) => ({ value, label }))} onChange={value => set({ priority: value ?? 'normal' })} />
        </div>
        <NumberInput label="Due after (days)" min={0} max={365} isIntegerOnly value={numberOr(c.dueInDays, 0)} onChange={value => set({ dueInDays: value })} />
        <UserPicker label="Assign to" value={c.assignee === 'owner' ? '' : str(c.assignee)} lookups={lookups} ownerLabel="Record owner" onChange={value => set({ assignee: value || 'owner' })} />
      </>;
      case 'notify_owner': return <>
        <TextArea label="Message" value={str(c.message)} onChange={value => set({ message: value })} />
        <UserPicker label="Notify" value={str(c.userId)} lookups={lookups} ownerLabel="Record owner" onChange={value => set({ userId: value })} />
        <Text type="supporting" color="secondary">Appears as a task due today in their task list.</Text>
      </>;
      case 'webhook': return <>
        <TextInput label="URL" placeholder="https://hooks.example.com/ovelio" value={str(c.url)} onChange={value => set({ url: value.trim() })} />
        <div className="ov-stack-sm">
          <TextInput label="Signing secret" description="At least 16 characters. Share it with the receiving system." value={str(c.secret)} onChange={value => set({ secret: value.trim() })} />
          <div><Button size="sm" label="Generate a secret" isDisabled={readOnly} onClick={() => set({ secret: generateSecret() })} /></div>
        </div>
        <Text type="supporting" color="secondary">POSTs JSON with the contact and trigger. Verify X-Ovelio-Signature = sha256=HMAC-SHA256(secret, X-Ovelio-Timestamp + “.” + body). Times out after 10 s; 5xx answers are retried twice, then the enrolment fails with the reason. Private network addresses are refused.</Text>
      </>;
      case 'exit': return <Text color="secondary">Contacts who reach this step leave the workflow and are counted as exited.</Text>;
      default: return null;
    }
  })();

  return <div className="ov-stack-sm">
    <div className="ov-actions ov-actions--between">
      <div className="ov-journeys-panel-head">
        <Text type="label" color="secondary"><span className="ov-actions"><Icon size={14} aria-hidden="true" />{spec.group}</span></Text>
        <Heading level={2}>{spec.label}</Heading>
      </div>
      {node.type !== 'start' && !readOnly ? <IconButton variant="ghost" label="Delete step" icon={<Trash2 size={16} />} onClick={onDelete} /> : null}
    </div>
    <Text type="supporting" color="secondary">{spec.description}</Text>
    <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }} className="ov-stack-sm">{body}</fieldset>
    {issues.length ? <ul className="ov-journeys-issues">{issues.map(issue => <li key={issue} className="ov-journeys-issue" data-level="error">{issue}</li>)}</ul> : null}
  </div>;
}

/* ── Start: triggers and re-entry ─────────────────────────────────────────────────────────────────────── */

function TriggerFilterFields({ trigger, lookups, onChange }: { trigger: FlowTrigger; lookups: BuilderLookups; onChange: (filters: TriggerFilters) => void }) {
  const spec = triggerSpec(trigger.type);
  const f = trigger.filters ?? {};
  const set = (patch: TriggerFilters) => onChange({ ...f, ...patch });
  return <>
    {spec.filters.includes('form') ? <Selector label="Form" value={f.formId || 'any'} isLoading={lookups.forms.status === 'loading'}
      description={lookupHint(lookups.forms, 'Forms', 'Build one in Sites & Forms › Forms.')}
      options={[{ value: 'any', label: 'Any form' }, ...lookups.forms.items.map(item => ({ value: item.id, label: item.name, description: item.status }))]}
      onChange={value => set({ formId: !value || value === 'any' ? '' : value, formName: lookups.forms.items.find(item => item.id === value)?.name ?? '' })} /> : null}
    {spec.filters.includes('page') ? <Selector label="Landing page" value={f.pageId || 'any'} isLoading={lookups.pages.status === 'loading'}
      description={lookupHint(lookups.pages, 'Landing pages', 'Publish one in Sites & Forms.')}
      options={[{ value: 'any', label: 'Any page' }, ...lookups.pages.items.map(item => ({ value: item.id, label: item.name, description: item.status }))]}
      onChange={value => set({ pageId: !value || value === 'any' ? '' : value, pageName: lookups.pages.items.find(item => item.id === value)?.name ?? '' })} /> : null}
    {spec.filters.includes('pipeline') ? <Selector label="Pipeline" value={f.pipelineId || 'any'} isLoading={lookups.pipelines.status === 'loading'}
      options={[{ value: 'any', label: 'Any pipeline' }, ...lookups.pipelines.items.map(item => ({ value: item.id, label: item.name }))]}
      onChange={value => set({ pipelineId: !value || value === 'any' ? '' : value, pipelineName: lookups.pipelines.items.find(item => item.id === value)?.name ?? '', stageId: '', stageName: '' })} /> : null}
    {spec.filters.includes('stage') ? (() => {
      const stages = lookups.pipelines.items.filter(item => !f.pipelineId || item.id === f.pipelineId).flatMap(item => item.stages.map(stage => ({ ...stage, pipeline: item.name })));
      return <Selector label="Moved to stage" value={f.stageId || 'any'}
        options={[{ value: 'any', label: 'Any stage' }, ...stages.map(stage => ({ value: stage.id, label: stage.name, description: f.pipelineId ? undefined : stage.pipeline }))]}
        onChange={value => set({ stageId: !value || value === 'any' ? '' : value, stageName: stages.find(stage => stage.id === value)?.name ?? '' })} />;
    })() : null}
    {spec.filters.includes('tag') ? <TextInput label="Tag" isRequired value={f.tag ?? ''} onChange={value => set({ tag: value.trim() })} placeholder="e.g. customer" /> : null}
    {spec.filters.includes('campaign') ? <Selector label="Campaign" value={f.campaignId || 'any'} isLoading={lookups.campaigns.status === 'loading'}
      options={[{ value: 'any', label: 'Any campaign' }, ...lookups.campaigns.items.map(item => ({ value: item.id, label: item.name }))]}
      onChange={value => set({ campaignId: !value || value === 'any' ? '' : value, campaignName: lookups.campaigns.items.find(item => item.id === value)?.name ?? '' })} /> : null}
  </>;
}

export function TriggerPanel({ triggers, reentry, lookups, readOnly, onTriggers, onReentry }: {
  triggers: FlowTrigger[]; reentry: ReentryRule; lookups: BuilderLookups; readOnly: boolean;
  onTriggers: (triggers: FlowTrigger[]) => void; onReentry: (value: ReentryRule) => void;
}) {
  const update = (id: string, patch: Partial<FlowTrigger>) => onTriggers(triggers.map(item => item.id === id ? { ...item, ...patch } : item));
  return <div className="ov-stack-sm">
    <div className="ov-journeys-panel-head">
      <Text type="label" color="secondary">Start</Text>
      <Heading level={2}>Who enters, and when</Heading>
    </div>
    <Text type="supporting" color="secondary">A contact enters when any trigger fires. Published workflows also accept manual enrolment from Test run.</Text>
    <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }} className="ov-stack-sm">
      {triggers.map((trigger, index) => <div key={trigger.id} className="ov-journeys-trigger">
        <div className="ov-actions ov-actions--between">
          <Text weight="medium">{index ? 'Or when' : 'When'}: {describeTrigger(trigger)}</Text>
          {!readOnly ? <IconButton size="sm" variant="ghost" label="Remove trigger" icon={<Trash2 size={14} />} onClick={() => onTriggers(triggers.filter(item => item.id !== trigger.id))} /> : null}
        </div>
        <Selector label="Trigger" value={trigger.type}
          options={flowTriggerSpecs.map(spec => ({ value: spec.type, label: spec.label, description: spec.description }))}
          onChange={value => update(trigger.id, { type: (value ?? 'form.submitted') as FlowTriggerType, filters: {} })} />
        <TriggerFilterFields trigger={trigger} lookups={lookups} onChange={filters => update(trigger.id, { filters })} />
      </div>)}
      {!readOnly && triggers.length < 10 ? <div><Button size="sm" icon={<Plus size={14} />} label={triggers.length ? 'Add another trigger' : 'Add a trigger'}
        onClick={() => onTriggers([...triggers, { id: `t${Date.now().toString(36)}`, type: 'form.submitted', filters: {} }])} /></div> : null}
      <SegmentedControl label="Re-entry" size="sm" value={reentry} onChange={value => onReentry(value === 'every_time' ? 'every_time' : 'once')}>
        <SegmentedControlItem value="once" label="Once per contact" />
        <SegmentedControlItem value="every_time" label="Every time" />
      </SegmentedControl>
      <Text type="supporting" color="secondary">{reentry === 'once'
        ? 'A contact goes through this workflow at most once.'
        : 'A contact can enter again on each new trigger, but never while already in it. The workflow never re-triggers itself from its own steps.'}</Text>
    </fieldset>
  </div>;
}
