'use client';

import {
  Code2, Copy, ExternalLink, Eye, FileText, Pause, Pencil, Play, Plus, Trash2, Users,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Field } from '@astryxdesign/core/Field';
import { Heading } from '@astryxdesign/core/Heading';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Link } from '@astryxdesign/core/Link';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { Table } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import { Token } from '@astryxdesign/core/Token';
import type {
  Asset, Category, DynamicContent, FocusItem, FocusItemInput, FormSubmission, JourneyEmail,
  LandingPage, LeadForm, LeadFormInput, Page, Segment, Stage, Webhook, Workflow, WorkflowContact,
  WorkflowInput, WorkflowStep, WorkflowStepKind,
} from '@/contracts';
import { maxWorkflowSteps } from '@/contracts';
import { api, date, number, useAction, useFields, useResource } from './client';
import { useUser } from './shell';
import {
  AsyncState, ConfirmDialog, Empty, Feedback, FormActions, Modal,
  PageHeader, Pager, Panel, SlideDrawer, Snippet, StatusBadge, Tabs,
} from './ui';

const tabs = [
  'Workflows', 'Journey emails', 'Lead forms', 'Assets', 'Landing pages',
  'Dynamic content', 'Popups & bars', 'Categories', 'Webhooks',
] as const;
type AutomationsTab = typeof tabs[number];
type TriggerType = 'segment' | 'form';
type FormFieldType = NonNullable<LeadFormInput['fields']>[number]['type'];
type FocusType = FocusItemInput['type'];
type FocusStyle = FocusItemInput['style'];
type FocusWhen = NonNullable<FocusItemInput['when']>;

const workflowPath = '/workflows';
const emailPath = '/journey-emails';
const formPath = '/forms';
const assetPath = '/assets';
const pagePath = '/pages';
const dynamicContentPath = '/dynamic-content';
const focusItemPath = '/focus-items';
const categoryPath = '/categories';
const webhookPath = '/webhooks';

const focusTypes: { value: FocusType; label: string; description: string }[] = [
  { value: 'notice', label: 'Notice', description: 'Display an announcement or banner message' },
  { value: 'link', label: 'Click-through link', description: 'Promote a call-to-action button linking to a URL' },
  { value: 'form', label: 'Lead form', description: 'Embed a lead capture form inside the popup or bar' },
];

const focusStyles: { value: FocusStyle; label: string }[] = [
  { value: 'bar', label: 'Top bar' },
  { value: 'modal', label: 'Modal popup' },
  { value: 'notification', label: 'Notification' },
  { value: 'page', label: 'Full page' },
];

const focusWhenOptions: { value: FocusWhen; label: string }[] = [
  { value: 'immediately', label: 'Immediately on load' },
  { value: 'scroll_slight', label: 'After slight scroll' },
  { value: 'scroll_middle', label: 'Middle of page' },
  { value: 'scroll_bottom', label: 'Bottom of page' },
  { value: 'leave', label: 'On exit intent' },
];

const focusTypeLabels: Record<string, string> = Object.fromEntries(focusTypes.map(item => [item.value, item.label]));
const focusStyleLabels: Record<string, string> = Object.fromEntries(focusStyles.map(item => [item.value, item.label]));
const focusWhenLabels: Record<string, string> = Object.fromEntries(focusWhenOptions.map(item => [item.value, item.label]));
const validFocusTypes = new Set<string>(focusTypes.map(item => item.value));
const validFocusStyles = new Set<string>(focusStyles.map(item => item.value));
const validFocusWhen = new Set<string>(focusWhenOptions.map(item => item.value));

const categoryBundles = [
  { value: 'global', label: 'Global' },
  { value: 'campaign', label: 'Workflows' },
  { value: 'email', label: 'Journey emails' },
  { value: 'form', label: 'Lead forms' },
  { value: 'asset', label: 'Assets' },
  { value: 'page', label: 'Landing pages' },
  { value: 'segment', label: 'Segments' },
  { value: 'point', label: 'Lead scoring' },
  { value: 'stage', label: 'Lifecycle stages' },
  { value: 'dynamicContent', label: 'Dynamic content' },
  { value: 'focus', label: 'Popups & bars' },
] as const;

type CategoryBundle = typeof categoryBundles[number]['value'];
type CategoryFilter = 'all' | CategoryBundle;

const categoryBundleLabels: Record<string, string> = Object.fromEntries(categoryBundles.map(item => [item.value, item.label]));
const validCategoryBundles = new Set<string>(categoryBundles.map(item => item.value));

const recipes = [
  { id: 'blank', name: 'Blank workflow', delays: [0] },
  { id: 'welcome', name: 'Welcome sequence', delays: [0, 1440] },
  { id: 'nurture', name: 'Lead nurturing', delays: [0, 2880, 4320] },
  { id: 'follow-up', name: 'Follow-up email', delays: [1440] },
  { id: 're-engage', name: 'Re-engagement', delays: [0, 10080] },
];

const stepKindOptions: { value: WorkflowStepKind; label: string; description: string }[] = [
  { value: 'email', label: 'Send journey email', description: 'Deliver a published automation email' },
  { value: 'tags', label: 'Modify tags', description: 'Add or remove contact tags' },
  { value: 'points', label: 'Adjust lead score', description: 'Add or subtract contact points' },
  { value: 'segment', label: 'Change segments', description: 'Add to or remove from segments' },
  { value: 'stage', label: 'Change lifecycle stage', description: 'Move contact to a lifecycle stage' },
];

const conditions = [
  { value: 'none', label: 'Continue without a condition' },
  { value: 'opened_previous', label: 'Previous email was opened' },
  { value: 'clicked_previous', label: 'Previous email link was clicked' },
];

const formFieldTypes: { value: FormFieldType; label: string }[] = [
  { value: 'text', label: 'Short text' },
  { value: 'email', label: 'Email address' },
  { value: 'textarea', label: 'Long text' },
  { value: 'select', label: 'Dropdown' },
  { value: 'checkboxgrp', label: 'Checkboxes' },
];

const mappedContactFields = [
  { value: 'none', label: 'Not mapped' },
  { value: 'email', label: 'Contact email' },
  { value: 'firstname', label: 'First name' },
  { value: 'lastname', label: 'Last name' },
  { value: 'company', label: 'Company' },
  { value: 'phone', label: 'Phone' },
  { value: 'position', label: 'Position / job title' },
  { value: 'city', label: 'City' },
  { value: 'country', label: 'Country' },
  { value: 'website', label: 'Website' },
];

const landingPageStarter = `<main style="max-width:720px;margin:48px auto;padding:24px;font-family:system-ui,sans-serif;line-height:1.6">
  <h1>Your campaign headline</h1>
  <p>Share a concise value proposition and invite visitors to get started.</p>
</main>`;

type WebhookTriggerOption = { value: string; label: string; description?: string };

const fallbackWebhookTriggers: WebhookTriggerOption[] = [
  { value: 'mautic.lead_post_save_new', label: 'Contact created' },
  { value: 'mautic.lead_post_save_update', label: 'Contact updated' },
  { value: 'mautic.lead_points_change', label: 'Lead score changed' },
  { value: 'mautic.form_on_submit', label: 'Lead form submitted' },
  { value: 'mautic.email_on_open', label: 'Email opened' },
  { value: 'mautic.page_on_hit', label: 'Landing page visited' },
];

function cleanText(raw: string) {
  return raw.replace(/\b(mautic|listmonk|umami)\b/gi, 'workspace').trim();
}

function prettifyTriggerKey(key: string) {
  const known = fallbackWebhookTriggers.find(item => item.value === key);
  if (known) return known.label;
  return key
    .replace(/^(mautic|listmonk|umami)\./i, '')
    .replaceAll(/[._-]+/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase())
    .trim();
}

function parseWebhookTriggers(raw?: Record<string, unknown>): WebhookTriggerOption[] {
  if (!raw) return fallbackWebhookTriggers;
  const found: WebhookTriggerOption[] = [];
  const seen = new Set<string>();

  function visit(obj: Record<string, unknown>) {
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        if (!seen.has(key)) {
          seen.add(key);
          found.push({ value: key, label: cleanText(value) || prettifyTriggerKey(key) });
        }
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        const entry = value as Record<string, unknown>;
        if (typeof entry.label === 'string') {
          if (!seen.has(key)) {
            seen.add(key);
            found.push({
              value: key,
              label: cleanText(entry.label) || prettifyTriggerKey(key),
              description: typeof entry.description === 'string' ? cleanText(entry.description) : undefined,
            });
          }
        } else {
          visit(entry);
        }
      }
    }
  }

  visit(raw);
  return found.length ? found.sort((a, b) => a.label.localeCompare(b.label)) : fallbackWebhookTriggers;
}

function delayLabel(minutes: number) {
  if (!minutes) return 'Immediately';
  if (minutes % 1440 === 0) return `Wait ${number(minutes / 1440)} day${minutes === 1440 ? '' : 's'}`;
  if (minutes % 60 === 0) return `Wait ${number(minutes / 60)} hour${minutes === 60 ? '' : 's'}`;
  return `Wait ${number(minutes)} minutes`;
}

function slugAlias(label: string) {
  const cleaned = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!cleaned) return 'field';
  return /^[a-z]/.test(cleaned) ? cleaned.slice(0, 50) : `f_${cleaned.slice(0, 48)}`;
}

function escapeAttr(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function slotSlug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^[_-]+|[_-]+$/g, '').slice(0, 80);
}

function normalizeHex(value: string | undefined, fallback: string) {
  const trimmed = (value ?? '').trim();
  const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  return /^#[0-9a-f]{6}$/i.test(withHash) ? withHash.toLowerCase() : fallback;
}

function resolveTab(input: string | undefined, isAdmin: boolean): AutomationsTab {
  const allowed: readonly AutomationsTab[] = isAdmin ? tabs : tabs.filter(item => item !== 'Webhooks');
  if (!input) return 'Workflows';
  const exact = allowed.find(item => item === input);
  if (exact) return exact;
  const normalized = input.trim().toLowerCase().replaceAll(/[-_]+/g, ' ').replaceAll(/\s+/g, ' ');
  const aliasMap: Record<string, AutomationsTab> = {
    'popups': 'Popups & bars',
    'popups bars': 'Popups & bars',
    'popups and bars': 'Popups & bars',
    'focus': 'Popups & bars',
    'focus items': 'Popups & bars',
    'dynamic': 'Dynamic content',
  };
  const aliased = aliasMap[normalized];
  if (aliased && allowed.includes(aliased)) return aliased;
  return allowed.find(item => item.toLowerCase() === normalized) ?? 'Workflows';
}

/* ── HTML Preview Modal (Journey emails & Landing pages) ───────────────────── */

function HtmlPreviewModal({ title, html, onClose }: { title: string; html: string; onClose: () => void }) {
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop');
  return <Modal title={`Preview: ${title}`} onClose={onClose} size="wide">
    <div className="ov-actions ov-actions--between">
      <Text type="supporting" color="secondary">Rendered in a sandboxed preview frame.</Text>
      <SegmentedControl label="Preview viewport" size="sm" value={viewport}
        onChange={value => setViewport(value === 'mobile' ? 'mobile' : 'desktop')}>
        <SegmentedControlItem value="desktop" label="Desktop" />
        <SegmentedControlItem value="mobile" label="Mobile" />
      </SegmentedControl>
    </div>
    <iframe
      className={viewport === 'mobile' ? 'ov-preview ov-preview--mobile' : 'ov-preview'}
      sandbox=""
      srcDoc={html || '<p style="font-family:sans-serif;color:#666;padding:16px">No HTML content yet.</p>'}
      title={`Preview of ${title}`}
    />
    <FormActions><Button label="Close" onClick={onClose} /></FormActions>
  </Modal>;
}

/* ── Workflow Step Editor & Enrolled Contacts Drawer ───────────────────────── */

type EditableStep = {
  key: number;
  kind: WorkflowStepKind;
  emailId: number;
  delayMinutes: number;
  condition?: 'opened_previous' | 'clicked_previous';
  addTagsText: string;
  removeTagsText: string;
  pointsDelta: number;
  addSegmentIds: number[];
  removeSegmentIds: number[];
  stageId: number;
};

function makeEmptyStep(key: number, delayMinutes = 0): EditableStep {
  return {
    key,
    kind: 'email',
    emailId: 0,
    delayMinutes,
    addTagsText: '',
    removeTagsText: '',
    pointsDelta: 10,
    addSegmentIds: [],
    removeSegmentIds: [],
    stageId: 0,
  };
}

function toEditableStep(step: WorkflowStep, key: number): EditableStep {
  return {
    key,
    kind: step.kind ?? 'email',
    emailId: step.emailId ?? 0,
    delayMinutes: step.delayMinutes ?? 0,
    condition: step.condition,
    addTagsText: (step.addTags ?? []).join(', '),
    removeTagsText: (step.removeTags ?? []).join(', '),
    pointsDelta: step.pointsDelta ?? 10,
    addSegmentIds: step.addSegmentIds ?? [],
    removeSegmentIds: step.removeSegmentIds ?? [],
    stageId: step.stageId ?? 0,
  };
}

function parseCsvList(text: string) {
  return [...new Set(text.split(',').map(item => item.trim()).filter(Boolean))];
}

function stepIsValid(step: EditableStep) {
  switch (step.kind) {
    case 'email':
      return step.emailId > 0;
    case 'tags': {
      const add = parseCsvList(step.addTagsText);
      const remove = parseCsvList(step.removeTagsText);
      return (add.length > 0 || remove.length > 0) && ![...add, ...remove].some(tag => tag.startsWith('-'));
    }
    case 'points':
      return Number.isSafeInteger(step.pointsDelta) && step.pointsDelta !== 0;
    case 'segment':
      return step.addSegmentIds.length > 0 || step.removeSegmentIds.length > 0;
    case 'stage':
      return step.stageId > 0;
  }
}

function WorkflowForm({ workflow, onClose, onDone }: { workflow?: Workflow; onClose: () => void; onDone: () => void }) {
  const emails = useResource<JourneyEmail[]>(emailPath);
  const segments = useResource<Segment[]>('/segments');
  const forms = useResource<LeadForm[]>(formPath);
  const stages = useResource<Stage[]>('/stages');
  const action = useAction();

  const { values, field, setValues } = useFields({ name: workflow?.name ?? '', description: workflow?.description ?? '' });
  const [triggerType, setTriggerType] = useState<TriggerType>(workflow && !workflow.segmentId && workflow.formId ? 'form' : 'segment');
  const [segmentId, setSegmentId] = useState<string | null>(workflow?.segmentId ? String(workflow.segmentId) : null);
  const [formId, setFormId] = useState<string | null>(workflow?.formId ? String(workflow.formId) : null);
  const [recipe, setRecipe] = useState('blank');
  const [steps, setSteps] = useState<EditableStep[]>(() =>
    workflow?.steps.length ? workflow.steps.map((step, index) => toEditableStep(step, index)) : [makeEmptyStep(0)],
  );
  const nextKey = useRef(steps.length);

  const publishedSegments = segments.data?.filter(segment => segment.published) ?? [];
  const allSegments = segments.data ?? [];
  const publishedForms = forms.data?.filter(form => form.published) ?? [];
  const publishedEmails = emails.data?.filter(email => email.published) ?? [];
  const stageList = stages.data ?? [];

  const emailOptions = publishedEmails.map(email => ({ value: String(email.id), label: email.name, description: email.subject }));
  const segmentOptions = allSegments.map(segment => ({ value: String(segment.id), label: segment.name }));
  const stageOptions = stageList.map(stage => ({ value: String(stage.id), label: stage.name }));

  const hasTrigger = triggerType === 'segment' ? Boolean(segmentId) : Boolean(formId);
  const ready = hasTrigger && steps.length > 0 && steps.every(stepIsValid);

  function applyRecipe(id: string) {
    const chosen = recipes.find(item => item.id === id);
    if (!chosen) return;
    setRecipe(id);
    if (id !== 'blank') setValues(current => ({ ...current, name: chosen.name }));
    setSteps(chosen.delays.map(delayMinutes => makeEmptyStep(nextKey.current++, delayMinutes)));
  }

  function updateStep(stepKey: number, parts: Partial<EditableStep>) {
    setSteps(items => items.map(step => step.key === stepKey ? { ...step, ...parts } : step));
  }

  function buildPayload(): WorkflowInput {
    const builtSteps: WorkflowStep[] = steps.map((step, index) => {
      const canCondition = index > 0 && steps[index - 1].kind === 'email';
      const condition = canCondition && step.condition ? { condition: step.condition } : {};
      switch (step.kind) {
        case 'email':
          return { kind: 'email', emailId: step.emailId, delayMinutes: step.delayMinutes, ...condition };
        case 'tags':
          return {
            kind: 'tags',
            emailId: 0,
            delayMinutes: step.delayMinutes,
            ...condition,
            addTags: parseCsvList(step.addTagsText),
            removeTags: parseCsvList(step.removeTagsText),
          };
        case 'points':
          return {
            kind: 'points',
            emailId: 0,
            delayMinutes: step.delayMinutes,
            ...condition,
            pointsDelta: step.pointsDelta,
          };
        case 'segment':
          return {
            kind: 'segment',
            emailId: 0,
            delayMinutes: step.delayMinutes,
            ...condition,
            addSegmentIds: step.addSegmentIds,
            removeSegmentIds: step.removeSegmentIds,
          };
        case 'stage':
          return {
            kind: 'stage',
            emailId: 0,
            delayMinutes: step.delayMinutes,
            ...condition,
            stageId: step.stageId,
          };
      }
    });

    return {
      name: values.name.trim(),
      description: values.description.trim(),
      segmentId: triggerType === 'segment' ? Number(segmentId) : 0,
      ...(triggerType === 'form' && formId ? { formId: Number(formId) } : {}),
      steps: builtSteps,
    };
  }

  return <Modal title={workflow ? 'Edit automation' : 'Create automation'} onClose={onClose} size="large">
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        const input = buildPayload();
        await api(workflow ? `${workflowPath}/${workflow.id}` : workflowPath, workflow ? 'PATCH' : 'POST', input);
        onDone();
      });
    }}>
      {!workflow ? <Selector label="Workflow template" value={recipe} onChange={value => applyRecipe(value ?? 'blank')}
        options={recipes.map(item => ({ value: item.id, label: item.name, description: `${item.delays.length} step${item.delays.length > 1 ? 's' : ''}` }))} /> : null}

      <TextInput label="Workflow name" isRequired {...field('name')} />

      <div className="ov-form-grid">
        <div className="ov-stack-sm">
          <Text type="label">Trigger source</Text>
          <SegmentedControl label="Trigger source" value={triggerType}
            onChange={value => setTriggerType(value === 'form' ? 'form' : 'segment')}>
            <SegmentedControlItem value="segment" label="Segment" />
            <SegmentedControlItem value="form" label="Lead form" />
          </SegmentedControl>
        </div>
        {triggerType === 'segment' ? (
          <Selector label="Trigger segment" description="Contacts entering this segment start the workflow." placeholder="Select a published segment"
            isLoading={segments.loading} value={segmentId} hasClear onChange={setSegmentId}
            options={publishedSegments.map(segment => ({ value: String(segment.id), label: segment.name }))} />
        ) : (
          <Selector label="Trigger lead form" description="Contacts submitting this form start the workflow." placeholder="Select a published lead form"
            isLoading={forms.loading} value={formId} hasClear onChange={setFormId}
            options={publishedForms.map(form => ({ value: String(form.id), label: form.name }))} />
        )}
      </div>

      <TextArea label="Description" isOptional rows={2} {...field('description')} />
      <Feedback error={segments.error || emails.error || forms.error || stages.error} />
      {triggerType === 'segment' && segments.data && !publishedSegments.length ? <Text color="secondary">Create and publish a segment in Audience first.</Text> : null}
      {triggerType === 'form' && forms.data && !publishedForms.length ? <Text color="secondary">Create and publish a lead form in the Lead forms tab first.</Text> : null}

      {steps.map((step, index) => {
        const canCondition = index > 0 && steps[index - 1].kind === 'email';
        return <div key={step.key} className="ov-step">
          <div className="ov-step-heading">
            <Text weight="semibold">Step {index + 1}</Text>
            {steps.length > 1 ? <IconButton variant="ghost" size="sm" label={`Remove step ${index + 1}`} icon={<Trash2 size={15} />}
              onClick={() => setSteps(items => items.filter(item => item.key !== step.key))} /> : null}
          </div>

          <div className="ov-form-grid">
            <Selector label={`Step ${index + 1} action`} value={step.kind} options={stepKindOptions}
              onChange={value => updateStep(step.key, { kind: (value as WorkflowStepKind) || 'email' })} />
            <NumberInput label={`Step ${index + 1} delay`} units="minutes" min={0} max={525600} isIntegerOnly value={step.delayMinutes}
              description={delayLabel(step.delayMinutes)} onChange={value => updateStep(step.key, { delayMinutes: value })} />
          </div>

          {step.kind === 'email' ? (
            <>
              <Selector label={`Step ${index + 1} email`} placeholder="Choose a published journey email"
                value={step.emailId ? String(step.emailId) : null} hasClear
                onChange={value => updateStep(step.key, { emailId: Number(value) || 0 })} options={emailOptions} />
              {emails.data && !publishedEmails.length ? <Text type="supporting" color="secondary">Create and publish a journey email first.</Text> : null}
            </>
          ) : null}

          {step.kind === 'tags' ? (
            <div className="ov-form-grid">
              <TextInput label="Add tags" description="Comma-separated" placeholder="engaged, prospect"
                value={step.addTagsText} onChange={value => updateStep(step.key, { addTagsText: value })} />
              <TextInput label="Remove tags" description="Comma-separated" placeholder="cold"
                value={step.removeTagsText} onChange={value => updateStep(step.key, { removeTagsText: value })} />
            </div>
          ) : null}

          {step.kind === 'points' ? (
            <NumberInput label="Score change" description="Positive to add points, negative to deduct (non-zero)."
              min={-10000} max={10000} isIntegerOnly value={step.pointsDelta}
              onChange={value => updateStep(step.key, { pointsDelta: value })} />
          ) : null}

          {step.kind === 'segment' ? (
            <div className="ov-form-grid">
              <div className="ov-stack-sm">
                <Selector label="Add to segment" placeholder="Select segment to add" value={null} hasClear
                  options={segmentOptions.filter(opt => !step.addSegmentIds.includes(Number(opt.value)))}
                  onChange={value => {
                    const id = Number(value);
                    if (id) updateStep(step.key, { addSegmentIds: [...step.addSegmentIds, id] });
                  }} />
                {step.addSegmentIds.length ? <div className="ov-tags">
                  {step.addSegmentIds.map(id => <Token key={id} size="sm" color="green"
                    label={allSegments.find(s => s.id === id)?.name || `Segment ${id}`}
                    onRemove={() => updateStep(step.key, { addSegmentIds: step.addSegmentIds.filter(item => item !== id) })} />)}
                </div> : null}
              </div>
              <div className="ov-stack-sm">
                <Selector label="Remove from segment" placeholder="Select segment to remove" value={null} hasClear
                  options={segmentOptions.filter(opt => !step.removeSegmentIds.includes(Number(opt.value)))}
                  onChange={value => {
                    const id = Number(value);
                    if (id) updateStep(step.key, { removeSegmentIds: [...step.removeSegmentIds, id] });
                  }} />
                {step.removeSegmentIds.length ? <div className="ov-tags">
                  {step.removeSegmentIds.map(id => <Token key={id} size="sm" color="red"
                    label={allSegments.find(s => s.id === id)?.name || `Segment ${id}`}
                    onRemove={() => updateStep(step.key, { removeSegmentIds: step.removeSegmentIds.filter(item => item !== id) })} />)}
                </div> : null}
              </div>
            </div>
          ) : null}

          {step.kind === 'stage' ? (
            <>
              <Selector label="Target lifecycle stage" placeholder="Select a lifecycle stage"
                value={step.stageId ? String(step.stageId) : null} hasClear options={stageOptions}
                onChange={value => updateStep(step.key, { stageId: Number(value) || 0 })} />
              {stages.data && !stageList.length ? <Text type="supporting" color="secondary">Create lifecycle stages in Audience → Tags &amp; stages first.</Text> : null}
            </>
          ) : null}

          {canCondition ? (
            <Selector label={`Step ${index + 1} condition`} value={step.condition ?? 'none'} options={conditions}
              onChange={value => updateStep(step.key, { condition: value === 'opened_previous' || value === 'clicked_previous' ? value : undefined })} />
          ) : null}
        </div>;
      })}

      {steps.length < maxWorkflowSteps ? <div>
        <Button label="Add step" icon={<Plus size={15} />} onClick={() => setSteps(items => [...items, makeEmptyStep(nextKey.current++)])} />
      </div> : null}
      <Feedback error={action.error} />
      <FormActions>
        <Button label="Cancel" onClick={onClose} />
        <Button type="submit" variant="primary" label={workflow ? 'Save changes' : 'Save workflow'} isLoading={action.busy} isDisabled={!ready || !values.name.trim()} />
      </FormActions>
    </form>
  </Modal>;
}

function WorkflowContactsDrawer({ workflow, onClose }: { workflow: Workflow; onClose: () => void }) {
  const enrolled = useResource<WorkflowContact[]>(`${workflowPath}/${workflow.id}/contacts`);
  return <SlideDrawer title={workflow.name} subtitle="Enrolled contacts in this automation" onClose={onClose} width={540}>
    {!enrolled.data ? <AsyncState loading={enrolled.loading} error={enrolled.error} retry={enrolled.refresh} />
      : enrolled.data.length ? <Table data={enrolled.data} idKey="contactId" hasHover columns={[
        {
          key: 'contactId',
          header: 'Contact',
          renderCell: item => <Link href={`/audience/${item.contactId}`}>Contact #{item.contactId}</Link>,
        },
        { key: 'dateAdded', header: 'Enrolled', renderCell: item => date(item.dateAdded) },
        {
          key: 'manuallyRemoved',
          header: 'Status',
          renderCell: item => <StatusBadge label={item.manuallyRemoved ? 'Removed' : 'Active'} tone={item.manuallyRemoved ? 'neutral' : 'success'} />,
        },
      ]} /> : <Empty title="No contacts enrolled yet" description="Contacts enter this workflow when they match its trigger while active." />}
  </SlideDrawer>;
}

/* ── Journey Email Form ────────────────────────────────────────────────────── */

function JourneyEmailForm({ email, onClose, onDone }: { email?: JourneyEmail; onClose: () => void; onDone: () => void }) {
  const action = useAction();
  const { values, field } = useFields({
    name: email?.name ?? '',
    subject: email?.subject ?? '',
    body: email?.body ?? '',
  });
  const [published, setPublished] = useState(email?.published ?? true);

  return <Modal title={email ? 'Edit journey email' : 'Create journey email'} onClose={onClose} size="large">
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        await api(email ? `${emailPath}/${email.id}` : emailPath, email ? 'PATCH' : 'POST', {
          name: values.name.trim(),
          subject: values.subject.trim(),
          body: values.body,
          published,
        });
        onDone();
      });
    }}>
      <div className="ov-form-grid">
        <TextInput label="Email name" isRequired {...field('name')} />
        <TextInput label="Subject" isRequired {...field('subject')} />
      </div>
      <Switch label="Published" description="Only published journey emails can be selected in active workflows." value={published} onChange={setPublished} />
      <TextArea label="Email content (HTML)" description="An unsubscribe link is appended automatically if omitted." rows={10}
        isRequired hasSpellCheck={false} placeholder="<h1>Welcome!</h1><p>Thanks for joining us.</p>" {...field('body')} />
      <Feedback error={action.error} />
      <FormActions>
        <Button label="Cancel" onClick={onClose} />
        <Button type="submit" variant="primary" label={email ? 'Save changes' : 'Save journey email'}
          isLoading={action.busy} isDisabled={!values.name.trim() || !values.subject.trim() || !values.body.trim()} />
      </FormActions>
    </form>
  </Modal>;
}

/* ── Lead Form Builder, Embed Modal & Submissions Drawer ───────────────────── */

type EditableFormField = {
  key: number;
  label: string;
  alias: string;
  type: FormFieldType;
  mappedField: string;
  isRequired: boolean;
  optionsText: string;
};

const validFieldTypes = new Set<string>(['text', 'email', 'textarea', 'select', 'checkboxgrp']);

function defaultBuilderFields(): EditableFormField[] {
  return [
    { key: 0, label: 'First name', alias: 'first_name', type: 'text', mappedField: 'firstname', isRequired: false, optionsText: '' },
    { key: 1, label: 'Email address', alias: 'email', type: 'email', mappedField: 'email', isRequired: true, optionsText: '' },
  ];
}

function LeadFormEditor({ form, onClose, onDone }: { form?: LeadForm; onClose: () => void; onDone: () => void }) {
  const action = useAction();
  const { values, field } = useFields({
    name: form?.name ?? '',
    description: form?.description ?? '',
    message: '',
  });
  const [published, setPublished] = useState(form?.published ?? true);
  const [fields, setFields] = useState<EditableFormField[]>(() => {
    const existing = form?.fields?.filter(item => item.type !== 'button' && item.type !== 'hidden') ?? [];
    if (!existing.length) return defaultBuilderFields();
    return existing.map((item, index) => ({
      key: index,
      label: item.label || prettifyTriggerKey(item.alias),
      alias: item.alias || slugAlias(item.label),
      type: validFieldTypes.has(item.type) ? item.type as FormFieldType : 'text',
      mappedField: item.mappedField || 'none',
      isRequired: Boolean(item.isRequired),
      optionsText: (item.options ?? []).join(', '),
    }));
  });
  const nextKey = useRef(fields.length);

  function updateField(fieldKey: number, patch: Partial<EditableFormField>) {
    setFields(items => items.map(item => item.key === fieldKey ? { ...item, ...patch } : item));
  }

  function addField() {
    const idx = nextKey.current++;
    setFields(items => [...items, {
      key: idx,
      label: '',
      alias: `field_${idx + 1}`,
      type: 'text',
      mappedField: 'none',
      isRequired: false,
      optionsText: '',
    }]);
  }

  return <Modal title={form ? 'Edit lead form' : 'Create lead form'} onClose={onClose} size="large">
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        const seen = new Set<string>();
        const built = fields.map((item, index) => {
          const label = item.label.trim();
          const alias = item.alias.trim().toLowerCase();
          if (!label) throw new Error(`Enter a label for field ${index + 1}.`);
          if (!/^[a-z][a-z0-9_]{0,59}$/.test(alias) || alias === 'submit') {
            throw new Error(`Field ${index + 1} alias must start with a lowercase letter and use only lowercase letters, numbers and underscores.`);
          }
          if (seen.has(alias)) throw new Error(`Duplicate field alias “${alias}”.`);
          seen.add(alias);
          const options = item.type === 'select' || item.type === 'checkboxgrp'
            ? item.optionsText.split(',').map(opt => opt.trim()).filter(Boolean)
            : undefined;
          if ((item.type === 'select' || item.type === 'checkboxgrp') && !options?.length) {
            throw new Error(`Add at least one choice for field ${index + 1}.`);
          }
          return {
            label,
            alias,
            type: item.type,
            mappedField: item.mappedField === 'none' ? undefined : item.mappedField,
            isRequired: item.isRequired,
            ...(options?.length ? { options } : {}),
          };
        });

        const payload: LeadFormInput = {
          name: values.name.trim(),
          description: values.description.trim(),
          ...(values.message.trim() ? { message: values.message.trim() } : {}),
          published,
          fields: built,
        };
        await api(form ? `${formPath}/${form.id}` : formPath, form ? 'PATCH' : 'POST', payload);
        onDone();
      });
    }}>
      <TextInput label="Form name" isRequired {...field('name')} />
      <div className="ov-form-grid">
        <TextArea label="Description" rows={2} isOptional {...field('description')} />
        <TextArea label="Confirmation message" rows={2} isOptional
          placeholder={form ? 'Leave blank to keep existing message' : 'Thank you for getting in touch.'} {...field('message')} />
      </div>
      <Switch label="Published" description="Published forms can be embedded and trigger workflows." value={published} onChange={setPublished} />

      <div className="ov-stack-sm">
        <div className="ov-actions ov-actions--between">
          <div>
            <Text weight="semibold">Form fields</Text>
            <Text type="supporting" color="secondary">An email field mapped to the contact email is required and preserved automatically.</Text>
          </div>
          {fields.length < 20 ? <Button size="sm" label="Add field" icon={<Plus size={14} />} onClick={addField} /> : null}
        </div>
        {fields.map((item, index) => <div key={item.key} className="ov-step">
          <div className="ov-step-heading">
            <Text weight="medium">Field {index + 1}</Text>
            {fields.length > 1 ? <IconButton variant="ghost" size="sm" label={`Remove field ${index + 1}`} icon={<Trash2 size={15} />}
              onClick={() => setFields(current => current.filter(entry => entry.key !== item.key))} /> : null}
          </div>
          <div className="ov-form-grid">
            <TextInput label="Label" isRequired value={item.label} onChange={value => {
              const autoAlias = !item.alias || item.alias.startsWith('field_') || item.alias === slugAlias(item.label);
              updateField(item.key, { label: value, ...(autoAlias && value.trim() ? { alias: slugAlias(value) } : {}) });
            }} />
            <TextInput label="Field alias" description="Lowercase letters, numbers, underscores" isRequired value={item.alias}
              onChange={value => updateField(item.key, { alias: value })} />
            <Selector label="Field type" value={item.type} options={formFieldTypes}
              onChange={value => updateField(item.key, { type: (value as FormFieldType) || 'text' })} />
            <Selector label="Map to contact field" value={item.mappedField} options={mappedContactFields}
              onChange={value => updateField(item.key, { mappedField: value ?? 'none' })} />
          </div>
          {item.type === 'select' || item.type === 'checkboxgrp' ? (
            <TextInput label="Choices" description="Separate options with commas." placeholder="Option A, Option B, Option C" isRequired
              value={item.optionsText} onChange={value => updateField(item.key, { optionsText: value })} />
          ) : null}
          <CheckboxInput label="Required field" value={item.isRequired} onChange={checked => updateField(item.key, { isRequired: checked })} />
        </div>)}
      </div>

      <Text type="supporting" color="secondary">Record marketing consent separately before sending marketing emails to new leads.</Text>
      <Feedback error={action.error} />
      <FormActions>
        <Button label="Cancel" onClick={onClose} />
        <Button type="submit" variant="primary" label={form ? 'Save changes' : 'Create form'} isLoading={action.busy} isDisabled={!values.name.trim() || !fields.length} />
      </FormActions>
    </form>
  </Modal>;
}

function FormSubmissionsDrawer({ form, onClose }: { form: LeadForm; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const submissions = useResource<Page<FormSubmission>>(`${formPath}/${form.id}/submissions?page=${page}`);
  return <SlideDrawer title={form.name} subtitle="Submitted lead form entries" onClose={onClose} width={600}>
    {!submissions.data ? <AsyncState loading={submissions.loading} error={submissions.error} retry={submissions.refresh} />
      : submissions.data.items.length ? <>
        <div className="ov-stack-sm">
          {submissions.data.items.map(entry => <article key={entry.id} className="ov-step">
            <div className="ov-step-heading">
              <div className="ov-actions">
                <Text weight="semibold">Submission #{entry.id}</Text>
                {entry.contactId ? <Link href={`/audience/${entry.contactId}`} type="supporting">Contact #{entry.contactId}</Link> : null}
              </div>
              {entry.dateSubmitted ? <Timestamp value={entry.dateSubmitted} format="date_time" /> : <Text type="supporting" color="secondary">—</Text>}
            </div>
            {Object.keys(entry.results).length ? <MetadataList>
              {Object.entries(entry.results).map(([fieldKey, fieldValue]) => (
                <MetadataListItem key={fieldKey} label={prettifyTriggerKey(fieldKey)}>{fieldValue || '—'}</MetadataListItem>
              ))}
            </MetadataList> : <Text type="supporting" color="secondary">No field values recorded.</Text>}
          </article>)}
        </div>
        <Pager {...submissions.data} onPage={setPage} />
      </> : <Empty title="No submissions yet" description="Responses appear here once visitors submit the embedded form." />}
  </SlideDrawer>;
}

function FormEmbedModal({ form, origin, onClose }: { form: LeadForm; origin: string; onClose: () => void }) {
  const copy = useAction();
  const scriptSnippet = `<script src="${origin}/form/generate.js?id=${form.id}"></script>`;
  const directUrl = `${origin}/form/embed/${form.id}`;
  const iframeSnippet = `<iframe src="${directUrl}" width="100%" height="480" frameborder="0" title="${escapeAttr(form.name)}"></iframe>`;

  return <Modal title={`Embed ${form.name}`} onClose={onClose} size="large">
    <div className="ov-stack-sm">
      <div className="ov-actions ov-actions--between">
        <Text weight="semibold">Script tag</Text>
        <Button size="sm" label="Copy script" icon={<Copy size={14} />}
          onClick={() => void copy.run(async () => navigator.clipboard.writeText(scriptSnippet), 'Script snippet copied.')} />
      </div>
      <Snippet code={scriptSnippet} />

      <div className="ov-actions ov-actions--between">
        <Text weight="semibold">Iframe embed</Text>
        <Button size="sm" label="Copy iframe" icon={<Copy size={14} />}
          onClick={() => void copy.run(async () => navigator.clipboard.writeText(iframeSnippet), 'Iframe snippet copied.')} />
      </div>
      <Snippet code={iframeSnippet} />

      <div className="ov-actions ov-actions--between">
        <Text weight="semibold">Direct link</Text>
        <div className="ov-actions">
          <Button size="sm" label="Copy link" icon={<Copy size={14} />}
            onClick={() => void copy.run(async () => navigator.clipboard.writeText(directUrl), 'Direct link copied.')} />
          <Button size="sm" variant="ghost" label="Open form" icon={<ExternalLink size={14} />}
            href={`/form/embed/${form.id}`} target="_blank" rel="noreferrer" />
        </div>
      </div>
      <Snippet code={directUrl} language="text" />

      <Feedback notice={copy.notice} error={copy.error} />
      <FormActions><Button label="Close" onClick={onClose} /></FormActions>
    </div>
  </Modal>;
}

/* ── Asset, Landing Page & Webhook Modals ──────────────────────────────────── */

function AssetForm({ asset, onClose, onDone }: { asset?: Asset; onClose: () => void; onDone: () => void }) {
  const action = useAction();
  const { values, field } = useFields({
    title: asset?.title ?? '',
    remotePath: asset?.remotePath ?? '',
    description: asset?.description ?? '',
  });
  const [published, setPublished] = useState(asset?.published ?? true);

  return <Modal title={asset ? 'Edit asset' : 'Add downloadable asset'} onClose={onClose}>
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        await api(asset ? `${assetPath}/${asset.id}` : assetPath, asset ? 'PATCH' : 'POST', {
          title: values.title.trim(),
          remotePath: values.remotePath.trim(),
          description: values.description.trim(),
          published,
        });
        onDone();
      });
    }}>
      <TextInput label="Asset title" isRequired {...field('title')} />
      <TextInput label="File URL" type="url" placeholder="https://cdn.example.com/guide.pdf"
        description="Hosted HTTP or HTTPS file URL delivered to contacts." isRequired {...field('remotePath')} />
      <TextArea label="Description" rows={3} isOptional {...field('description')} />
      <Switch label="Published" value={published} onChange={setPublished} />
      <Feedback error={action.error} />
      <FormActions>
        <Button label="Cancel" onClick={onClose} />
        <Button type="submit" variant="primary" label={asset ? 'Save asset' : 'Add asset'}
          isLoading={action.busy} isDisabled={!values.title.trim() || !values.remotePath.trim()} />
      </FormActions>
    </form>
  </Modal>;
}

function LandingPageForm({ page, onClose, onDone }: { page?: LandingPage; onClose: () => void; onDone: () => void }) {
  const action = useAction();
  const { values, field, setValues } = useFields({
    title: page?.title ?? '',
    alias: page?.alias ?? '',
    metaDescription: page?.metaDescription ?? '',
    customHtml: page?.customHtml ?? '',
  });
  const [published, setPublished] = useState(page?.published ?? true);

  return <Modal title={page ? 'Edit landing page' : 'Create landing page'} onClose={onClose} size="large">
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        await api(page ? `${pagePath}/${page.id}` : pagePath, page ? 'PATCH' : 'POST', {
          title: values.title.trim(),
          ...(values.alias.trim() ? { alias: values.alias.trim() } : {}),
          metaDescription: values.metaDescription.trim(),
          customHtml: values.customHtml,
          published,
        });
        onDone();
      });
    }}>
      <div className="ov-form-grid">
        <TextInput label="Page title" isRequired {...field('title')} />
        <TextInput label="URL slug" placeholder="spring-launch" isOptional {...field('alias')} />
      </div>
      <TextInput label="Meta description" isOptional {...field('metaDescription')} />
      <Switch label="Published" value={published} onChange={setPublished} />
      <div className="ov-actions ov-actions--between">
        <Text type="supporting" color="secondary">Provide clean HTML markup for the landing page.</Text>
        {!values.customHtml ? <Button size="sm" label="Use starter layout"
          onClick={() => setValues(current => ({ ...current, customHtml: landingPageStarter }))} /> : null}
      </div>
      <TextArea label="Page HTML" rows={10} hasSpellCheck={false} isRequired placeholder="<main><h1>Welcome</h1></main>" {...field('customHtml')} />
      <Feedback error={action.error} />
      <FormActions>
        <Button label="Cancel" onClick={onClose} />
        <Button type="submit" variant="primary" label={page ? 'Save landing page' : 'Create landing page'}
          isLoading={action.busy} isDisabled={!values.title.trim() || !values.customHtml.trim()} />
      </FormActions>
    </form>
  </Modal>;
}

function WebhookForm({
  webhook, triggerOptions, onClose, onDone,
}: { webhook?: Webhook; triggerOptions: WebhookTriggerOption[]; onClose: () => void; onDone: () => void }) {
  const action = useAction();
  const { values, field } = useFields({
    name: webhook?.name ?? '',
    webhookUrl: webhook?.webhookUrl ?? '',
    description: webhook?.description ?? '',
  });
  const [published, setPublished] = useState(webhook?.published ?? true);
  const [selectedTriggers, setSelectedTriggers] = useState<string[]>(webhook?.triggers ?? []);
  const [filterText, setFilterText] = useState('');

  const options = [...triggerOptions];
  for (const current of selectedTriggers) {
    if (!options.some(opt => opt.value === current)) {
      options.push({ value: current, label: prettifyTriggerKey(current) });
    }
  }
  const visibleOptions = filterText.trim()
    ? options.filter(opt => opt.label.toLowerCase().includes(filterText.trim().toLowerCase()))
    : options;

  return <Modal title={webhook ? 'Edit webhook' : 'Create webhook'} onClose={onClose} size="large">
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        if (!selectedTriggers.length) throw new Error('Select at least one trigger event.');
        await api(webhook ? `${webhookPath}/${webhook.id}` : webhookPath, webhook ? 'PATCH' : 'POST', {
          name: values.name.trim(),
          webhookUrl: values.webhookUrl.trim(),
          description: values.description.trim(),
          triggers: selectedTriggers,
          published,
        });
        onDone();
      });
    }}>
      <div className="ov-form-grid">
        <TextInput label="Webhook name" isRequired {...field('name')} />
        <TextInput label="Endpoint URL" type="url" placeholder="https://hooks.example.com/events" isRequired {...field('webhookUrl')} />
      </div>
      <TextArea label="Description" rows={2} isOptional {...field('description')} />
      <Switch label="Published" description="Only published webhooks dispatch outbound HTTP events." value={published} onChange={setPublished} />
      <div className="ov-stack-sm">
        <div className="ov-actions ov-actions--between">
          <Text weight="semibold">Trigger events ({number(selectedTriggers.length)} selected)</Text>
          {options.length > 8 ? (
            <TextInput label="Filter events" isLabelHidden type="search" startIcon="search" placeholder="Filter events…"
              value={filterText} onChange={setFilterText} width={220} />
          ) : null}
        </div>
        <div className="ov-step" style={{ maxHeight: 240, overflowY: 'auto' }}>
          {visibleOptions.length ? visibleOptions.map(opt => (
            <CheckboxInput key={opt.value} label={opt.label} description={opt.description}
              value={selectedTriggers.includes(opt.value)}
              onChange={checked => setSelectedTriggers(current => checked ? [...new Set([...current, opt.value])] : current.filter(item => item !== opt.value))} />
          )) : <Text type="supporting" color="secondary">No matching trigger events.</Text>}
        </div>
      </div>
      <Feedback error={action.error} />
      <FormActions>
        <Button label="Cancel" onClick={onClose} />
        <Button type="submit" variant="primary" label={webhook ? 'Save webhook' : 'Create webhook'}
          isLoading={action.busy} isDisabled={!values.name.trim() || !values.webhookUrl.trim() || !selectedTriggers.length} />
      </FormActions>
    </form>
  </Modal>;
}

/* ── Dynamic Content Tab & Modals ──────────────────────────────────────────── */

function DynamicContentForm({
  item,
  onClose,
  onDone,
}: {
  item?: DynamicContent;
  onClose: () => void;
  onDone: () => void;
}) {
  const action = useAction();
  const { values, field, setValues } = useFields({
    name: item?.name ?? '',
    slotName: item?.slotName ?? '',
    content: item?.content ?? '',
  });
  const [slotTouched, setSlotTouched] = useState(Boolean(item));
  const [isCampaignBased, setIsCampaignBased] = useState(item?.isCampaignBased ?? true);
  const [published, setPublished] = useState(item?.published ?? true);

  return <Modal title={item ? 'Edit dynamic content' : 'Create dynamic content'} onClose={onClose} size="large">
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        const cleanName = values.name.trim();
        const cleanSlot = values.slotName.trim();
        if (!cleanName) throw new Error('Enter a name for this dynamic content slot.');
        if (!/^[a-z0-9_-]{1,80}$/i.test(cleanSlot)) {
          throw new Error('Use letters, numbers, underscores or dashes for slot names.');
        }
        if (!values.content.trim()) throw new Error('Enter HTML content for this slot.');
        await api(item ? `${dynamicContentPath}/${item.id}` : dynamicContentPath, item ? 'PATCH' : 'POST', {
          name: cleanName,
          slotName: cleanSlot,
          content: values.content,
          isCampaignBased,
          published,
        });
        onDone();
      });
    }}>
      <div className="ov-form-grid">
        <TextInput label="Name" isRequired value={values.name} onChange={next => {
          setValues(current => ({
            ...current,
            name: next,
            ...(!slotTouched ? { slotName: slotSlug(next) } : {}),
          }));
        }} />
        <TextInput label="Slot name" description="Letters, numbers, underscores or dashes." placeholder="hero_offer" isRequired
          value={values.slotName} onChange={next => {
            setSlotTouched(true);
            setValues(current => ({ ...current, slotName: next }));
          }} />
      </div>
      <TextArea label="Slot content (HTML)" rows={8} hasSpellCheck={false} isRequired
        placeholder="<div><h2>Personalised offer</h2><p>Welcome back!</p></div>" {...field('content')} />
      <div className="ov-stack-sm">
        <Switch label="Campaign-based" description="Deliver via workflow actions rather than direct filter matching."
          value={isCampaignBased} onChange={setIsCampaignBased} />
        <Switch label="Published" description="Published slots render wherever the embed container is placed."
          value={published} onChange={setPublished} />
      </div>
      <Feedback error={action.error} />
      <FormActions>
        <Button label="Cancel" onClick={onClose} />
        <Button type="submit" variant="primary" label={item ? 'Save changes' : 'Create slot'}
          isLoading={action.busy} isDisabled={!values.name.trim() || !values.slotName.trim() || !values.content.trim()} />
      </FormActions>
    </form>
  </Modal>;
}

function DynamicContentEmbedModal({ item, onClose }: { item: DynamicContent; onClose: () => void }) {
  const copy = useAction();
  const embedCode = `<div data-slot="dwc" data-param-slot-name="${escapeAttr(item.slotName)}">Default content</div>`;
  return <Modal title={`Embed ${item.name}`} onClose={onClose} size="large">
    <div className="ov-stack-sm">
      <Text type="supporting" color="secondary">
        Place this container on any tracked page. Visitors who match this slot receive the personalised HTML in place of the default content.
      </Text>
      <div className="ov-actions ov-actions--between">
        <Text weight="semibold">HTML slot snippet</Text>
        <Button size="sm" label="Copy snippet" icon={<Copy size={14} />}
          onClick={() => void copy.run(async () => navigator.clipboard.writeText(embedCode), 'Embed snippet copied.')} />
      </div>
      <Snippet code={embedCode} />
      <Feedback notice={copy.notice} error={copy.error} />
      <FormActions><Button label="Close" onClick={onClose} /></FormActions>
    </div>
  </Modal>;
}

function DynamicContentTab({
  modal,
  onModalChange,
  onPreview,
  onNotice,
}: {
  modal: 'new' | DynamicContent | undefined;
  onModalChange: (next: 'new' | DynamicContent | undefined) => void;
  onPreview: (preview: { title: string; html: string }) => void;
  onNotice: (message: string) => void;
}) {
  const slots = useResource<DynamicContent[]>(dynamicContentPath);
  const action = useAction();
  const [embedItem, setEmbedItem] = useState<DynamicContent>();
  const [deleteItem, setDeleteItem] = useState<DynamicContent>();

  return <>
    <Panel title="Dynamic content slots" description="Personalise sections of your website for returning contacts using embeddable HTML slots.">
      <Feedback error={action.error} />
      {!slots.data ? <AsyncState loading={slots.loading} error={slots.error} retry={slots.refresh} />
        : <Table data={slots.data} idKey="id" hasHover
          emptyState={<Empty title="No dynamic content slots yet" description="Create a slot to swap in personalised HTML on tracked pages." />}
          columns={[
            {
              key: 'name',
              header: 'Name',
              renderCell: item => <span className="ov-cell">
                <Text weight="medium">{item.name}</Text>
                <Text type="supporting" color="secondary">
                  {item.isCampaignBased ? 'Campaign-based' : 'Direct slot'}{item.dateAdded ? ` · Added ${date(item.dateAdded)}` : ''}
                </Text>
              </span>,
            },
            {
              key: 'slotName',
              header: 'Slot name',
              renderCell: item => <StatusBadge label={item.slotName} tone="info" />,
            },
            {
              key: 'sentCount',
              header: 'Sent',
              align: 'end',
              renderCell: item => number(item.sentCount),
            },
            {
              key: 'published',
              header: 'Status',
              renderCell: item => <StatusBadge label={item.published ? 'Published' : 'Draft'} tone={item.published ? 'success' : 'neutral'} />,
            },
            {
              key: 'id',
              header: 'Actions',
              align: 'end',
              renderCell: item => <span className="ov-actions ov-actions--end">
                <Button size="sm" variant="ghost" label="Preview" icon={<Eye size={14} />}
                  onClick={() => onPreview({ title: item.name, html: item.content })} />
                <Button size="sm" label="Embed" icon={<Code2 size={14} />} onClick={() => setEmbedItem(item)} />
                <Button size="sm" variant="ghost" label="Edit" icon={<Pencil size={14} />} onClick={() => onModalChange(item)} />
                <IconButton size="sm" variant="ghost" label={`Delete ${item.name}`} icon={<Trash2 size={14} />}
                  onClick={() => setDeleteItem(item)} />
              </span>,
            },
          ]} />}
    </Panel>

    {modal ? <DynamicContentForm
      item={modal === 'new' ? undefined : modal}
      onClose={() => onModalChange(undefined)}
      onDone={() => {
        onNotice(modal === 'new' ? 'Dynamic content slot created.' : 'Dynamic content slot updated.');
        onModalChange(undefined);
        slots.refresh();
      }}
    /> : null}

    {embedItem ? <DynamicContentEmbedModal item={embedItem} onClose={() => setEmbedItem(undefined)} /> : null}

    {deleteItem ? <ConfirmDialog
      title={`Delete dynamic content “${deleteItem.name}”`}
      description="Pages embedding this slot will fall back to their default HTML content."
      actionLabel="Delete slot"
      destructive
      busy={action.busy}
      onClose={() => setDeleteItem(undefined)}
      onConfirm={() => {
        const target = deleteItem;
        void action.run(async () => {
          try {
            await api(`${dynamicContentPath}/${target.id}`, 'DELETE');
            slots.refresh();
            onNotice('Dynamic content slot deleted.');
          } finally {
            setDeleteItem(undefined);
          }
        });
      }}
    /> : null}
  </>;
}

/* ── Popups & Bars (Focus Items) Tab & Modals ──────────────────────────────── */

function FocusItemForm({
  item,
  onClose,
  onDone,
}: {
  item?: FocusItem;
  onClose: () => void;
  onDone: () => void;
}) {
  const forms = useResource<LeadForm[]>(formPath);
  const action = useAction();
  const { values, field } = useFields({
    name: item?.name ?? '',
    description: item?.description ?? '',
    headline: item?.headline ?? '',
    tagline: item?.tagline ?? '',
    linkText: item?.linkText ?? '',
    linkUrl: item?.linkUrl ?? '',
  });
  const [type, setType] = useState<FocusType>(item && validFocusTypes.has(item.type) ? item.type as FocusType : 'notice');
  const [style, setStyle] = useState<FocusStyle>(item && validFocusStyles.has(item.style) ? item.style as FocusStyle : 'bar');
  const [when, setWhen] = useState<FocusWhen>(item && validFocusWhen.has(item.when) ? item.when as FocusWhen : 'immediately');
  const [formId, setFormId] = useState<string | null>(item?.formId ? String(item.formId) : null);
  const [primaryColor, setPrimaryColor] = useState(() => normalizeHex(item?.primaryColor, '#2457d6'));
  const [textColor, setTextColor] = useState(() => normalizeHex(item?.textColor, '#111827'));
  const [buttonColor, setButtonColor] = useState(() => normalizeHex(item?.buttonColor, '#2457d6'));
  const [buttonTextColor, setButtonTextColor] = useState(() => normalizeHex(item?.buttonTextColor, '#ffffff'));
  const [published, setPublished] = useState(item?.published ?? true);

  const selectableForms = (forms.data ?? []).filter(entry => entry.published || (item?.formId && entry.id === item.formId));

  return <Modal title={item ? 'Edit popup or bar' : 'Create popup or bar'} onClose={onClose} size="large">
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        const cleanName = values.name.trim();
        if (!cleanName) throw new Error('Enter a name for this popup or bar.');
        const cleanLinkUrl = values.linkUrl.trim();
        if (type === 'link' && cleanLinkUrl && !/^https?:\/\//i.test(cleanLinkUrl)) {
          throw new Error('Enter a valid HTTP or HTTPS link URL.');
        }

        const payload: FocusItemInput = {
          name: cleanName,
          description: values.description.trim(),
          type,
          style,
          when,
          headline: values.headline.trim(),
          tagline: values.tagline.trim(),
          linkText: type === 'link' ? values.linkText.trim() : '',
          linkUrl: type === 'link' ? cleanLinkUrl : '',
          formId: type === 'form' && formId ? Number(formId) : null,
          primaryColor: normalizeHex(primaryColor, '#2457d6'),
          textColor: normalizeHex(textColor, '#111827'),
          buttonColor: normalizeHex(buttonColor, '#2457d6'),
          buttonTextColor: normalizeHex(buttonTextColor, '#ffffff'),
          published,
        };
        await api(item ? `${focusItemPath}/${item.id}` : focusItemPath, item ? 'PATCH' : 'POST', payload);
        onDone();
      });
    }}>
      <TextInput label="Name" isRequired {...field('name')} />
      <TextArea label="Description" rows={2} isOptional {...field('description')} />

      <div className="ov-form-grid ov-form-grid--three">
        <Selector label="Action type" value={type} options={focusTypes}
          onChange={value => setType((value as FocusType) || 'notice')} />
        <Selector label="Display style" value={style} options={focusStyles}
          onChange={value => setStyle((value as FocusStyle) || 'bar')} />
        <Selector label="Trigger timing" value={when} options={focusWhenOptions}
          onChange={value => setWhen((value as FocusWhen) || 'immediately')} />
      </div>

      {type === 'form' ? (
        <div className="ov-stack-sm">
          <Selector
            label="Embedded lead form"
            description="Optional. Choose a published lead form to display inside this popup or bar."
            placeholder="Select a lead form"
            isOptional
            isLoading={forms.loading}
            value={formId}
            hasClear
            onChange={setFormId}
            options={selectableForms.map(entry => ({ value: String(entry.id), label: entry.name }))}
          />
          {forms.error ? <Feedback error={forms.error} /> : null}
          {forms.data && !selectableForms.length ? (
            <Text type="supporting" color="secondary">Create and publish a lead form in the Lead forms tab first.</Text>
          ) : null}
        </div>
      ) : null}

      <div className="ov-form-grid">
        <TextInput label="Headline" placeholder="Stay up to date" isOptional {...field('headline')} />
        <TextInput label="Tagline" placeholder="Get fresh product news every week." isOptional {...field('tagline')} />
      </div>

      {type === 'link' ? (
        <div className="ov-form-grid">
          <TextInput label="Button text" placeholder="Learn more" isOptional {...field('linkText')} />
          <TextInput label="Link URL" type="url" placeholder="https://example.com/offer" isOptional {...field('linkUrl')} />
        </div>
      ) : null}

      <div className="ov-form-grid">
        <Field label="Primary colour" inputID="ov-focus-primary">
          <div className="ov-actions">
            <input id="ov-focus-primary" className="ov-color" type="color" value={primaryColor}
              onChange={event => setPrimaryColor(event.target.value)} />
            <Text type="supporting" color="secondary">{primaryColor.toUpperCase()}</Text>
          </div>
        </Field>
        <Field label="Text colour" inputID="ov-focus-text">
          <div className="ov-actions">
            <input id="ov-focus-text" className="ov-color" type="color" value={textColor}
              onChange={event => setTextColor(event.target.value)} />
            <Text type="supporting" color="secondary">{textColor.toUpperCase()}</Text>
          </div>
        </Field>
        <Field label="Button colour" inputID="ov-focus-button">
          <div className="ov-actions">
            <input id="ov-focus-button" className="ov-color" type="color" value={buttonColor}
              onChange={event => setButtonColor(event.target.value)} />
            <Text type="supporting" color="secondary">{buttonColor.toUpperCase()}</Text>
          </div>
        </Field>
        <Field label="Button text colour" inputID="ov-focus-button-text">
          <div className="ov-actions">
            <input id="ov-focus-button-text" className="ov-color" type="color" value={buttonTextColor}
              onChange={event => setButtonTextColor(event.target.value)} />
            <Text type="supporting" color="secondary">{buttonTextColor.toUpperCase()}</Text>
          </div>
        </Field>
      </div>

      <Switch label="Published" description="Published popups and bars display wherever their embed script is installed."
        value={published} onChange={setPublished} />
      <Feedback error={action.error} />
      <FormActions>
        <Button label="Cancel" onClick={onClose} />
        <Button type="submit" variant="primary" label={item ? 'Save changes' : 'Create popup or bar'}
          isLoading={action.busy} isDisabled={!values.name.trim()} />
      </FormActions>
    </form>
  </Modal>;
}

function FocusEmbedModal({ item, onClose }: { item: FocusItem; onClose: () => void }) {
  const copy = useAction();
  return <Modal title={`Embed ${item.name}`} onClose={onClose} size="large">
    <div className="ov-stack-sm">
      <Text type="supporting" color="secondary">
        Add this script tag to your website where you want this {focusStyleLabels[item.style]?.toLowerCase() ?? 'item'} to appear.
      </Text>
      <div className="ov-actions ov-actions--between">
        <Text weight="semibold">Embed script</Text>
        <Button size="sm" label="Copy script" icon={<Copy size={14} />}
          onClick={() => void copy.run(async () => navigator.clipboard.writeText(item.embedScript), 'Embed script copied.')} />
      </div>
      <Snippet code={item.embedScript} />
      <Feedback notice={copy.notice} error={copy.error} />
      <FormActions><Button label="Close" onClick={onClose} /></FormActions>
    </div>
  </Modal>;
}

function FocusItemsTab({
  modal,
  onModalChange,
  onNotice,
}: {
  modal: 'new' | FocusItem | undefined;
  onModalChange: (next: 'new' | FocusItem | undefined) => void;
  onNotice: (message: string) => void;
}) {
  const items = useResource<FocusItem[]>(focusItemPath);
  const action = useAction();
  const [embedItem, setEmbedItem] = useState<FocusItem>();
  const [deleteItem, setDeleteItem] = useState<FocusItem>();

  return <>
    <Panel title="Popups & bars" description="Display targeted notification bars, modals and lead capture overlays on your site.">
      <Feedback error={action.error} />
      {!items.data ? <AsyncState loading={items.loading} error={items.error} retry={items.refresh} />
        : <Table data={items.data} idKey="id" hasHover
          emptyState={<Empty title="No popups or bars yet" description="Create an announcement bar, click-through banner or form modal." />}
          columns={[
            {
              key: 'name',
              header: 'Name',
              renderCell: item => <span className="ov-cell">
                <Text weight="medium">{item.name}</Text>
                {item.description || item.headline ? (
                  <Text type="supporting" color="secondary">{item.description || item.headline}</Text>
                ) : null}
              </span>,
            },
            {
              key: 'style',
              header: 'Style',
              renderCell: item => <StatusBadge label={focusStyleLabels[item.style] ?? prettifyTriggerKey(item.style)} tone="info" />,
            },
            {
              key: 'type',
              header: 'Type',
              renderCell: item => <StatusBadge label={focusTypeLabels[item.type] ?? prettifyTriggerKey(item.type)} />,
            },
            {
              key: 'when',
              header: 'Trigger timing',
              renderCell: item => focusWhenLabels[item.when] ?? prettifyTriggerKey(item.when),
            },
            {
              key: 'published',
              header: 'Status',
              renderCell: item => <StatusBadge label={item.published ? 'Published' : 'Draft'} tone={item.published ? 'success' : 'neutral'} />,
            },
            {
              key: 'id',
              header: 'Actions',
              align: 'end',
              renderCell: item => <span className="ov-actions ov-actions--end">
                <Button size="sm" label="Embed" icon={<Code2 size={14} />} onClick={() => setEmbedItem(item)} />
                <Button size="sm" variant="ghost" label="Edit" icon={<Pencil size={14} />} onClick={() => onModalChange(item)} />
                <IconButton size="sm" variant="ghost" label={`Delete ${item.name}`} icon={<Trash2 size={14} />}
                  onClick={() => setDeleteItem(item)} />
              </span>,
            },
          ]} />}
    </Panel>

    {modal ? <FocusItemForm
      item={modal === 'new' ? undefined : modal}
      onClose={() => onModalChange(undefined)}
      onDone={() => {
        onNotice(modal === 'new' ? 'Popup or bar created.' : 'Popup or bar updated.');
        onModalChange(undefined);
        items.refresh();
      }}
    /> : null}

    {embedItem ? <FocusEmbedModal item={embedItem} onClose={() => setEmbedItem(undefined)} /> : null}

    {deleteItem ? <ConfirmDialog
      title={`Delete “${deleteItem.name}”`}
      description="This permanently removes the popup or bar and disables its embedded script."
      actionLabel="Delete item"
      destructive
      busy={action.busy}
      onClose={() => setDeleteItem(undefined)}
      onConfirm={() => {
        const target = deleteItem;
        void action.run(async () => {
          try {
            await api(`${focusItemPath}/${target.id}`, 'DELETE');
            items.refresh();
            onNotice('Popup or bar deleted.');
          } finally {
            setDeleteItem(undefined);
          }
        });
      }}
    /> : null}
  </>;
}

/* ── Categories Tab & Modal ────────────────────────────────────────────────── */

function CategoryForm({
  category,
  defaultBundle,
  onClose,
  onDone,
}: {
  category?: Category;
  defaultBundle: CategoryBundle;
  onClose: () => void;
  onDone: () => void;
}) {
  const action = useAction();
  const { values, field } = useFields({
    title: category?.title ?? '',
    description: category?.description ?? '',
  });
  const [bundle, setBundle] = useState<CategoryBundle>(
    category?.bundle && validCategoryBundles.has(category.bundle) ? category.bundle as CategoryBundle : defaultBundle,
  );
  const [color, setColor] = useState(() => normalizeHex(category?.color, '#2457d6'));
  const [published, setPublished] = useState(category?.published ?? true);

  return <Modal title={category ? 'Edit category' : 'Create category'} onClose={onClose}>
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        const cleanTitle = values.title.trim();
        if (!cleanTitle) throw new Error('Enter a category title.');
        await api(category ? `${categoryPath}/${category.id}` : categoryPath, category ? 'PATCH' : 'POST', {
          title: cleanTitle,
          bundle,
          description: values.description.trim(),
          color: normalizeHex(color, '#2457d6'),
          published,
        });
        onDone();
      });
    }}>
      <TextInput label="Title" isRequired {...field('title')} />
      <div className="ov-form-grid">
        <Selector label="Bundle" value={bundle}
          options={categoryBundles.map(item => ({ value: item.value, label: item.label }))}
          onChange={value => setBundle((value as CategoryBundle) || 'global')} />
        <Field label="Colour" inputID="ov-category-color" description="Swatch displayed next to this category.">
          <div className="ov-actions">
            <input id="ov-category-color" className="ov-color" type="color" value={color}
              onChange={event => setColor(event.target.value)} />
            <Text type="supporting" color="secondary">{color.toUpperCase()}</Text>
          </div>
        </Field>
      </div>
      <TextArea label="Description" rows={2} isOptional {...field('description')} />
      <Switch label="Published" value={published} onChange={setPublished} />
      <Feedback error={action.error} />
      <FormActions>
        <Button label="Cancel" onClick={onClose} />
        <Button type="submit" variant="primary" label={category ? 'Save category' : 'Create category'}
          isLoading={action.busy} isDisabled={!values.title.trim()} />
      </FormActions>
    </form>
  </Modal>;
}

function CategoriesTab({
  modal,
  onModalChange,
  onNotice,
}: {
  modal: 'new' | Category | undefined;
  onModalChange: (next: 'new' | Category | undefined) => void;
  onNotice: (message: string) => void;
}) {
  const [bundleFilter, setBundleFilter] = useState<CategoryFilter>('all');
  const resourcePath = bundleFilter === 'all' ? categoryPath : `${categoryPath}?${new URLSearchParams({ bundle: bundleFilter })}`;
  const categories = useResource<Category[]>(resourcePath);
  const action = useAction();
  const [deleteTarget, setDeleteTarget] = useState<Category>();

  return <>
    <Panel title="Categories" description="Organise workflows, emails, forms, assets, segments and overlays into colour-coded groups.">
      <div className="ov-toolbar">
        <Selector
          label="Filter by bundle"
          isLabelHidden
          width={220}
          value={bundleFilter}
          options={[{ value: 'all', label: 'All bundles' }, ...categoryBundles.map(item => ({ value: item.value, label: item.label }))]}
          onChange={value => setBundleFilter((value as CategoryFilter) || 'all')}
        />
      </div>
      <Feedback error={action.error} />
      {!categories.data ? <AsyncState loading={categories.loading} error={categories.error} retry={categories.refresh} />
        : <Table data={categories.data} idKey="id" hasHover
          emptyState={<Empty title={bundleFilter === 'all' ? 'No categories yet' : 'No categories in this bundle'}
            description={bundleFilter === 'all'
              ? 'Create categories to group marketing assets and automations.'
              : 'Create a category for this bundle or switch the bundle filter.'}
            action={bundleFilter !== 'all' ? <Button label="Show all bundles" onClick={() => setBundleFilter('all')} /> : undefined} />}
          columns={[
            {
              key: 'title',
              header: 'Category',
              renderCell: item => {
                const swatch = normalizeHex(item.color, '#2457d6');
                return <span className="ov-actions">
                  <span
                    aria-hidden="true"
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: '50%',
                      backgroundColor: swatch,
                      border: '1px solid var(--color-border)',
                      flexShrink: 0,
                      display: 'inline-block',
                    }}
                  />
                  <span className="ov-cell">
                    <Text weight="medium">{item.title}</Text>
                    {item.alias ? <Text type="supporting" color="secondary">{item.alias}</Text> : null}
                  </span>
                </span>;
              },
            },
            {
              key: 'bundle',
              header: 'Bundle',
              renderCell: item => <StatusBadge label={categoryBundleLabels[item.bundle] ?? prettifyTriggerKey(item.bundle)} tone="info" />,
            },
            {
              key: 'description',
              header: 'Description',
              renderCell: item => item.description || <Text color="secondary">—</Text>,
            },
            {
              key: 'published',
              header: 'Status',
              renderCell: item => <StatusBadge label={item.published ? 'Published' : 'Draft'} tone={item.published ? 'success' : 'neutral'} />,
            },
            {
              key: 'id',
              header: 'Actions',
              align: 'end',
              renderCell: item => <span className="ov-actions ov-actions--end">
                <Button size="sm" variant="ghost" label="Edit" icon={<Pencil size={14} />} onClick={() => onModalChange(item)} />
                <IconButton size="sm" variant="ghost" label={`Delete ${item.title}`} icon={<Trash2 size={14} />}
                  onClick={() => setDeleteTarget(item)} />
              </span>,
            },
          ]} />}
    </Panel>

    {modal ? <CategoryForm
      category={modal === 'new' ? undefined : modal}
      defaultBundle={bundleFilter === 'all' ? 'global' : bundleFilter}
      onClose={() => onModalChange(undefined)}
      onDone={() => {
        onNotice(modal === 'new' ? 'Category created.' : 'Category updated.');
        onModalChange(undefined);
        categories.refresh();
      }}
    /> : null}

    {deleteTarget ? <ConfirmDialog
      title={`Delete category “${deleteTarget.title}”`}
      description="Items assigned to this category will remain intact, with their category cleared."
      actionLabel="Delete category"
      destructive
      busy={action.busy}
      onClose={() => setDeleteTarget(undefined)}
      onConfirm={() => {
        const target = deleteTarget;
        void action.run(async () => {
          try {
            await api(`${categoryPath}/${target.id}`, 'DELETE');
            categories.refresh();
            onNotice('Category deleted.');
          } finally {
            setDeleteTarget(undefined);
          }
        });
      }}
    /> : null}
  </>;
}

/* ── Main Automations Component ────────────────────────────────────────────── */

type ConfirmState = {
  title: string;
  description: string;
  actionLabel: string;
  destructive?: boolean;
  onConfirm: () => Promise<void>;
};

export function Automations({ initialTab }: { initialTab?: string }) {
  const user = useUser();
  const isAdmin = user.role === 'admin';
  const visibleTabs = isAdmin ? tabs : tabs.filter((item): item is Exclude<AutomationsTab, 'Webhooks'> => item !== 'Webhooks');
  const blockedWebhooks = !isAdmin && initialTab?.trim().toLowerCase() === 'webhooks';

  const [tab, setTab] = useState<AutomationsTab>(() => resolveTab(initialTab, isAdmin));
  const [notice, setNotice] = useState('');
  const action = useAction();

  // Modals & drawers
  const [workflowEditor, setWorkflowEditor] = useState<'new' | Workflow>();
  const [workflowContacts, setWorkflowContacts] = useState<Workflow>();
  const [emailModal, setEmailModal] = useState<'new' | JourneyEmail>();
  const [formModal, setFormModal] = useState<'new' | LeadForm>();
  const [formSubmissions, setFormSubmissions] = useState<LeadForm>();
  const [formEmbed, setFormEmbed] = useState<{ form: LeadForm; origin: string }>();
  const [assetModal, setAssetModal] = useState<'new' | Asset>();
  const [pageModal, setPageModal] = useState<'new' | LandingPage>();
  const [dynamicModal, setDynamicModal] = useState<'new' | DynamicContent>();
  const [focusModal, setFocusModal] = useState<'new' | FocusItem>();
  const [categoryModal, setCategoryModal] = useState<'new' | Category>();
  const [webhookModal, setWebhookModal] = useState<'new' | Webhook>();
  const [preview, setPreview] = useState<{ title: string; html: string }>();
  const [confirmState, setConfirmState] = useState<ConfirmState>();

  // Resources
  const workflows = useResource<Workflow[]>(tab === 'Workflows' ? workflowPath : null);
  const needWorkflowMeta = tab === 'Workflows' && Boolean(workflows.data?.length);
  const emails = useResource<JourneyEmail[]>(tab === 'Journey emails' || needWorkflowMeta ? emailPath : null);
  const segments = useResource<Segment[]>(needWorkflowMeta ? '/segments' : null);
  const stages = useResource<Stage[]>(needWorkflowMeta ? '/stages' : null);
  const forms = useResource<LeadForm[]>(tab === 'Lead forms' || needWorkflowMeta ? formPath : null);
  const assets = useResource<Asset[]>(tab === 'Assets' ? assetPath : null);
  const pages = useResource<LandingPage[]>(tab === 'Landing pages' ? pagePath : null);
  const webhooks = useResource<Webhook[]>(tab === 'Webhooks' && isAdmin ? webhookPath : null);
  const webhookTriggers = useResource<Record<string, unknown>>(tab === 'Webhooks' && isAdmin ? `${webhookPath}/triggers` : null);

  const parsedTriggers = parseWebhookTriggers(webhookTriggers.data);

  function describeStep(step: WorkflowStep) {
    const kind = step.kind ?? 'email';
    switch (kind) {
      case 'email':
        return `Send email: ${emails.data?.find(email => email.id === step.emailId)?.name || `Email #${step.emailId}`}`;
      case 'tags': {
        const parts: string[] = [];
        if (step.addTags?.length) parts.push(`add ${step.addTags.join(', ')}`);
        if (step.removeTags?.length) parts.push(`remove ${step.removeTags.join(', ')}`);
        return `Modify tags: ${parts.join(' · ') || 'No changes'}`;
      }
      case 'points': {
        const delta = step.pointsDelta ?? 0;
        return `Adjust lead score: ${delta > 0 ? '+' : ''}${number(delta)} pts`;
      }
      case 'segment': {
        const nameOf = (id: number) => segments.data?.find(item => item.id === id)?.name || `Segment #${id}`;
        const parts: string[] = [];
        if (step.addSegmentIds?.length) parts.push(`add to ${step.addSegmentIds.map(nameOf).join(', ')}`);
        if (step.removeSegmentIds?.length) parts.push(`remove from ${step.removeSegmentIds.map(nameOf).join(', ')}`);
        return `Update segments: ${parts.join(' · ') || 'No changes'}`;
      }
      case 'stage': {
        const stageName = stages.data?.find(item => item.id === step.stageId)?.name || `Stage #${step.stageId ?? ''}`;
        return `Change lifecycle stage: ${stageName}`;
      }
    }
  }

  function describeTrigger(workflow: Workflow) {
    if (workflow.formId && !workflow.segmentId) {
      const formName = forms.data?.find(item => item.id === workflow.formId)?.name || `Lead form #${workflow.formId}`;
      return `Lead form: ${formName}`;
    }
    if (workflow.segmentId) {
      const segName = segments.data?.find(item => item.id === workflow.segmentId)?.name || `Segment #${workflow.segmentId}`;
      return `Segment: ${segName}`;
    }
    return 'Managed trigger';
  }

  const createAction: Record<AutomationsTab, [string, () => void]> = {
    'Workflows': ['Create automation', () => setWorkflowEditor('new')],
    'Journey emails': ['Create journey email', () => setEmailModal('new')],
    'Lead forms': ['Create lead form', () => setFormModal('new')],
    'Assets': ['Add asset', () => setAssetModal('new')],
    'Landing pages': ['Create landing page', () => setPageModal('new')],
    'Dynamic content': ['Create dynamic slot', () => setDynamicModal('new')],
    'Popups & bars': ['Create popup or bar', () => setFocusModal('new')],
    'Categories': ['Create category', () => setCategoryModal('new')],
    'Webhooks': ['Create webhook', () => setWebhookModal('new')],
  };

  return <>
    <PageHeader title="Automations" description="Orchestrate multi-step journeys, capture leads, personalise pages and manage categories."
      actions={<Button variant="primary" icon={<Plus size={16} />} label={createAction[tab][0]} onClick={createAction[tab][1]} />} />
    <Tabs label="Automation view" items={visibleTabs} value={tab} onChange={value => { setTab(value); setNotice(''); }} />
    <Feedback
      error={action.error || (blockedWebhooks ? 'Outbound webhooks require administrator access.' : undefined)}
      notice={notice || action.notice}
    />

    {tab === 'Workflows' ? <Panel title="Workflows" description="A workflow shows as Active only after the automation engine confirms it is enabled.">
      {!workflows.data ? <AsyncState loading={workflows.loading} error={workflows.error} retry={workflows.refresh} />
        : workflows.data.length ? <div className="ov-stack-sm">{workflows.data.map(workflow => <article className="ov-step" key={workflow.id}>
          <div className="ov-step-heading">
            <div className="ov-cell">
              <Heading level={3}>{workflow.name}</Heading>
              <Text type="supporting" color="secondary">Trigger · {describeTrigger(workflow)}</Text>
            </div>
            <StatusBadge label={workflow.enabled ? 'Active' : 'Inactive'} tone={workflow.enabled ? 'success' : 'neutral'} />
          </div>
          {workflow.description ? <Text color="secondary">{workflow.description}</Text> : null}
          {workflow.steps.length ? <ol className="ov-flow">{workflow.steps.map((step, index) => <li key={index}>
            <span>
              <Text weight="medium">{index + 1}. {describeStep(step)}</Text>
              {step.condition ? <Text type="supporting" color="secondary">
                {step.condition === 'opened_previous' ? 'Only if the previous email was opened' : 'Only if a previous link was clicked'}
              </Text> : null}
            </span>
            <Text type="supporting" color="secondary">{delayLabel(step.delayMinutes)}</Text>
          </li>)}</ol> : null}
          <div className="ov-actions">
            {!workflow.enabled && workflow.editable !== false ? <Button size="sm" label="Edit workflow" icon={<Pencil size={14} />}
              onClick={() => setWorkflowEditor(workflow)} /> : null}
            <Button size="sm" label={workflow.enabled ? 'Disable' : 'Enable'} icon={workflow.enabled ? <Pause size={14} /> : <Play size={14} />}
              onClick={() => setConfirmState({
                title: workflow.enabled ? 'Disable automation' : 'Enable automation',
                description: workflow.enabled
                  ? `Pause workflow execution for “${workflow.name}”?`
                  : `Allow execution and email delivery for eligible contacts in “${workflow.name}”?`,
                actionLabel: workflow.enabled ? 'Disable automation' : 'Enable automation',
                destructive: false,
                onConfirm: async () => {
                  await api(`${workflowPath}/${workflow.id}/status`, 'POST', { enabled: !workflow.enabled });
                  workflows.refresh();
                  setNotice(workflow.enabled ? 'Automation disabled.' : 'Automation enabled.');
                },
              })} />
            <Button size="sm" variant="ghost" label="Enrolled contacts" icon={<Users size={14} />}
              onClick={() => setWorkflowContacts(workflow)} />
            <IconButton size="sm" variant="ghost" label={`Delete ${workflow.name}`} icon={<Trash2 size={14} />}
              onClick={() => setConfirmState({
                title: `Delete automation “${workflow.name}”`,
                description: 'This permanently deletes the workflow and stops any pending steps for enrolled contacts.',
                actionLabel: 'Delete workflow',
                destructive: true,
                onConfirm: async () => {
                  await api(`${workflowPath}/${workflow.id}`, 'DELETE');
                  workflows.refresh();
                  setNotice('Automation deleted.');
                },
              })} />
          </div>
        </article>)}</div> : <Empty title="No workflows yet" description="Start from a welcome, nurture, follow-up or re-engagement template." />}
    </Panel> : null}

    {tab === 'Journey emails' ? <Panel title="Journey emails" description="Reusable messages delivered inside automation steps.">
      {!emails.data ? <AsyncState loading={emails.loading} error={emails.error} retry={emails.refresh} />
        : <Table data={emails.data} idKey="id" hasHover emptyState={<Empty title="No journey emails yet" description="Create an email to use inside workflow steps." />}
          columns={[
            { key: 'name', header: 'Name' },
            { key: 'subject', header: 'Subject' },
            { key: 'sentCount', header: 'Sent', align: 'end', renderCell: email => number(email.sentCount) },
            { key: 'readCount', header: 'Opens', align: 'end', renderCell: email => number(email.readCount) },
            { key: 'published', header: 'Status', renderCell: email => <StatusBadge label={email.published ? 'Published' : 'Draft'} tone={email.published ? 'success' : 'neutral'} /> },
            {
              key: 'id',
              header: 'Actions',
              align: 'end',
              renderCell: email => <span className="ov-actions ov-actions--end">
                <Button size="sm" variant="ghost" label="Preview" icon={<Eye size={14} />}
                  onClick={() => setPreview({ title: email.name, html: email.body ?? '' })} />
                <Button size="sm" variant="ghost" label="Edit" icon={<Pencil size={14} />} onClick={() => setEmailModal(email)} />
                <IconButton size="sm" variant="ghost" label={`Delete ${email.name}`} icon={<Trash2 size={14} />}
                  onClick={() => setConfirmState({
                    title: `Delete journey email “${email.name}”`,
                    description: 'Ensure no active workflow depends on this email before deleting it.',
                    actionLabel: 'Delete email',
                    destructive: true,
                    onConfirm: async () => {
                      await api(`${emailPath}/${email.id}`, 'DELETE');
                      emails.refresh();
                      setNotice('Journey email deleted.');
                    },
                  })} />
              </span>,
            },
          ]} />}
    </Panel> : null}

    {tab === 'Lead forms' ? <Panel title="Lead forms" description="Capture contact fields, inspect submissions and copy embed snippets.">
      {!forms.data ? <AsyncState loading={forms.loading} error={forms.error} retry={forms.refresh} />
        : <Table data={forms.data} idKey="id" hasHover emptyState={<Empty title="No lead forms available" description="Create a lead capture form with custom contact fields." />}
          columns={[
            {
              key: 'name',
              header: 'Form',
              renderCell: form => <span className="ov-cell">
                <Text weight="medium">{form.name}</Text>
                {form.description ? <Text type="supporting" color="secondary">{form.description}</Text> : null}
              </span>,
            },
            {
              key: 'fields',
              header: 'Fields',
              renderCell: form => <StatusBadge label={`${number(form.fields?.length ?? 0)} field${(form.fields?.length ?? 0) === 1 ? '' : 's'}`} />,
            },
            { key: 'published', header: 'Status', renderCell: form => <StatusBadge label={form.published ? 'Published' : 'Draft'} tone={form.published ? 'success' : 'neutral'} /> },
            { key: 'submissions', header: 'Submissions', align: 'end', renderCell: form => number(form.submissions) },
            {
              key: 'id',
              header: 'Actions',
              align: 'end',
              renderCell: form => <span className="ov-actions ov-actions--end">
                <Button size="sm" variant="ghost" label="Submissions" icon={<FileText size={14} />} onClick={() => setFormSubmissions(form)} />
                {form.published ? <Button size="sm" label="Embed code" onClick={() => setFormEmbed({ form, origin: window.location.origin })} /> : null}
                <Button size="sm" variant="ghost" label="Edit" icon={<Pencil size={14} />} onClick={() => setFormModal(form)} />
                <IconButton size="sm" variant="ghost" label={`Delete ${form.name}`} icon={<Trash2 size={14} />}
                  onClick={() => setConfirmState({
                    title: `Delete lead form “${form.name}”`,
                    description: 'This permanently deletes the form and its embedded endpoint.',
                    actionLabel: 'Delete form',
                    destructive: true,
                    onConfirm: async () => {
                      await api(`${formPath}/${form.id}`, 'DELETE');
                      forms.refresh();
                      setNotice('Lead form deleted.');
                    },
                  })} />
              </span>,
            },
          ]} />}
    </Panel> : null}

    {tab === 'Assets' ? <Panel title="Downloadable assets" description="Trackable lead magnets and resource downloads.">
      {!assets.data ? <AsyncState loading={assets.loading} error={assets.error} retry={assets.refresh} />
        : <Table data={assets.data} idKey="id" hasHover emptyState={<Empty title="No assets yet" description="Add a hosted PDF, guide or toolkit to track downloads." />}
          columns={[
            {
              key: 'title',
              header: 'Asset',
              renderCell: asset => <span className="ov-cell">
                <Text weight="medium">{asset.title}</Text>
                {asset.description ? <Text type="supporting" color="secondary">{asset.description}</Text> : null}
              </span>,
            },
            {
              key: 'remotePath',
              header: 'File URL',
              renderCell: asset => asset.remotePath && /^https?:\/\//i.test(asset.remotePath)
                ? <Link href={asset.remotePath} isExternalLink type="supporting">{asset.remotePath}</Link>
                : <Text color="secondary">{asset.remotePath || '—'}</Text>,
            },
            {
              key: 'downloadCount',
              header: 'Downloads',
              align: 'end',
              renderCell: asset => `${number(asset.downloadCount)} (${number(asset.uniqueDownloadCount)} unique)`,
            },
            { key: 'published', header: 'Status', renderCell: asset => <StatusBadge label={asset.published ? 'Published' : 'Draft'} tone={asset.published ? 'success' : 'neutral'} /> },
            {
              key: 'id',
              header: 'Actions',
              align: 'end',
              renderCell: asset => {
                const url = asset.downloadUrl || asset.remotePath;
                return <span className="ov-actions ov-actions--end">
                  {url ? <Button size="sm" variant="ghost" label="Copy URL" icon={<Copy size={14} />}
                    onClick={() => void action.run(async () => navigator.clipboard.writeText(url), 'Download URL copied.')} /> : null}
                  <Button size="sm" variant="ghost" label="Edit" icon={<Pencil size={14} />} onClick={() => setAssetModal(asset)} />
                  <IconButton size="sm" variant="ghost" label={`Delete ${asset.title}`} icon={<Trash2 size={14} />}
                    onClick={() => setConfirmState({
                      title: `Delete asset “${asset.title}”`,
                      description: 'This removes the asset and disables its tracked download link.',
                      actionLabel: 'Delete asset',
                      destructive: true,
                      onConfirm: async () => {
                        await api(`${assetPath}/${asset.id}`, 'DELETE');
                        assets.refresh();
                        setNotice('Asset deleted.');
                      },
                    })} />
                </span>;
              },
            },
          ]} />}
    </Panel> : null}

    {tab === 'Landing pages' ? <Panel title="Landing pages" description="Publish campaign landing pages and track page visits.">
      {!pages.data ? <AsyncState loading={pages.loading} error={pages.error} retry={pages.refresh} />
        : <Table data={pages.data} idKey="id" hasHover emptyState={<Empty title="No landing pages yet" description="Build HTML landing pages for campaigns and lead capture." />}
          columns={[
            {
              key: 'title',
              header: 'Page',
              renderCell: item => <span className="ov-cell">
                <Text weight="medium">{item.title}</Text>
                <Text type="supporting" color="secondary">{item.alias ? `/${item.alias}` : 'No slug'}{item.metaDescription ? ` · ${item.metaDescription}` : ''}</Text>
              </span>,
            },
            {
              key: 'hits',
              header: 'Visits',
              align: 'end',
              renderCell: item => `${number(item.hits)} (${number(item.uniqueHits)} unique)`,
            },
            { key: 'published', header: 'Status', renderCell: item => <StatusBadge label={item.published ? 'Published' : 'Draft'} tone={item.published ? 'success' : 'neutral'} /> },
            {
              key: 'id',
              header: 'Actions',
              align: 'end',
              renderCell: item => <span className="ov-actions ov-actions--end">
                <Button size="sm" variant="ghost" label="Preview" icon={<Eye size={14} />}
                  onClick={() => setPreview({ title: item.title, html: item.customHtml })} />
                <Button size="sm" variant="ghost" label="Edit" icon={<Pencil size={14} />} onClick={() => setPageModal(item)} />
                <IconButton size="sm" variant="ghost" label={`Delete ${item.title}`} icon={<Trash2 size={14} />}
                  onClick={() => setConfirmState({
                    title: `Delete landing page “${item.title}”`,
                    description: 'This permanently deletes the landing page.',
                    actionLabel: 'Delete landing page',
                    destructive: true,
                    onConfirm: async () => {
                      await api(`${pagePath}/${item.id}`, 'DELETE');
                      pages.refresh();
                      setNotice('Landing page deleted.');
                    },
                  })} />
              </span>,
            },
          ]} />}
    </Panel> : null}

    {tab === 'Dynamic content' ? (
      <DynamicContentTab
        modal={dynamicModal}
        onModalChange={setDynamicModal}
        onPreview={setPreview}
        onNotice={setNotice}
      />
    ) : null}

    {tab === 'Popups & bars' ? (
      <FocusItemsTab
        modal={focusModal}
        onModalChange={setFocusModal}
        onNotice={setNotice}
      />
    ) : null}

    {tab === 'Categories' ? (
      <CategoriesTab
        modal={categoryModal}
        onModalChange={setCategoryModal}
        onNotice={setNotice}
      />
    ) : null}

    {tab === 'Webhooks' && isAdmin ? <Panel title="Outbound webhooks" description="Send real-time HTTP notifications to external tools when audience events occur.">
      {!webhooks.data ? <AsyncState loading={webhooks.loading} error={webhooks.error} retry={webhooks.refresh} />
        : <Table data={webhooks.data} idKey="id" hasHover emptyState={<Empty title="No webhooks configured" description="Create a webhook to notify your CRM, Slack or internal services." />}
          columns={[
            {
              key: 'name',
              header: 'Webhook',
              renderCell: hook => <span className="ov-cell">
                <Text weight="medium">{hook.name}</Text>
                {hook.description ? <Text type="supporting" color="secondary">{hook.description}</Text> : null}
              </span>,
            },
            { key: 'webhookUrl', header: 'Endpoint URL' },
            {
              key: 'triggers',
              header: 'Events',
              renderCell: hook => <span className="ov-tags">
                {hook.triggers.slice(0, 3).map(triggerKey => {
                  const match = parsedTriggers.find(opt => opt.value === triggerKey);
                  return <StatusBadge key={triggerKey} label={match?.label || prettifyTriggerKey(triggerKey)} tone="info" />;
                })}
                {hook.triggers.length > 3 ? <StatusBadge label={`+${hook.triggers.length - 3} more`} /> : null}
              </span>,
            },
            { key: 'published', header: 'Status', renderCell: hook => <StatusBadge label={hook.published ? 'Published' : 'Draft'} tone={hook.published ? 'success' : 'neutral'} /> },
            {
              key: 'id',
              header: 'Actions',
              align: 'end',
              renderCell: hook => <span className="ov-actions ov-actions--end">
                <Button size="sm" variant="ghost" label="Edit" icon={<Pencil size={14} />} onClick={() => setWebhookModal(hook)} />
                <IconButton size="sm" variant="ghost" label={`Delete ${hook.name}`} icon={<Trash2 size={14} />}
                  onClick={() => setConfirmState({
                    title: `Delete webhook “${hook.name}”`,
                    description: 'Outbound HTTP deliveries to this endpoint will stop immediately.',
                    actionLabel: 'Delete webhook',
                    destructive: true,
                    onConfirm: async () => {
                      await api(`${webhookPath}/${hook.id}`, 'DELETE');
                      webhooks.refresh();
                      setNotice('Webhook deleted.');
                    },
                  })} />
              </span>,
            },
          ]} />}
    </Panel> : null}

    {workflowEditor ? <WorkflowForm workflow={workflowEditor === 'new' ? undefined : workflowEditor}
      onClose={() => setWorkflowEditor(undefined)}
      onDone={() => {
        setNotice(workflowEditor === 'new' ? 'Workflow saved. Enable it to start enrolling contacts.' : 'Changes saved.');
        setWorkflowEditor(undefined);
        workflows.refresh();
      }} /> : null}

    {workflowContacts ? <WorkflowContactsDrawer workflow={workflowContacts} onClose={() => setWorkflowContacts(undefined)} /> : null}

    {emailModal ? <JourneyEmailForm email={emailModal === 'new' ? undefined : emailModal}
      onClose={() => setEmailModal(undefined)}
      onDone={() => {
        setNotice(emailModal === 'new' ? 'Journey email saved.' : 'Journey email updated.');
        setEmailModal(undefined);
        emails.refresh();
      }} /> : null}

    {formModal ? <LeadFormEditor form={formModal === 'new' ? undefined : formModal}
      onClose={() => setFormModal(undefined)}
      onDone={() => {
        setNotice(formModal === 'new' ? 'Lead form created.' : 'Lead form updated.');
        setFormModal(undefined);
        forms.refresh();
      }} /> : null}

    {formSubmissions ? <FormSubmissionsDrawer form={formSubmissions} onClose={() => setFormSubmissions(undefined)} /> : null}
    {formEmbed ? <FormEmbedModal form={formEmbed.form} origin={formEmbed.origin} onClose={() => setFormEmbed(undefined)} /> : null}

    {assetModal ? <AssetForm asset={assetModal === 'new' ? undefined : assetModal}
      onClose={() => setAssetModal(undefined)}
      onDone={() => {
        setNotice(assetModal === 'new' ? 'Asset added.' : 'Asset updated.');
        setAssetModal(undefined);
        assets.refresh();
      }} /> : null}

    {pageModal ? <LandingPageForm page={pageModal === 'new' ? undefined : pageModal}
      onClose={() => setPageModal(undefined)}
      onDone={() => {
        setNotice(pageModal === 'new' ? 'Landing page created.' : 'Landing page updated.');
        setPageModal(undefined);
        pages.refresh();
      }} /> : null}

    {webhookModal && isAdmin ? <WebhookForm webhook={webhookModal === 'new' ? undefined : webhookModal} triggerOptions={parsedTriggers}
      onClose={() => setWebhookModal(undefined)}
      onDone={() => {
        setNotice(webhookModal === 'new' ? 'Webhook created.' : 'Webhook updated.');
        setWebhookModal(undefined);
        webhooks.refresh();
      }} /> : null}

    {preview ? <HtmlPreviewModal title={preview.title} html={preview.html} onClose={() => setPreview(undefined)} /> : null}

    {confirmState ? <ConfirmDialog
      title={confirmState.title}
      description={confirmState.description}
      actionLabel={confirmState.actionLabel}
      destructive={confirmState.destructive ?? true}
      busy={action.busy}
      onClose={() => setConfirmState(undefined)}
      onConfirm={() => {
        const current = confirmState;
        void action.run(async () => {
          try {
            await current.onConfirm();
          } finally {
            setConfirmState(undefined);
          }
        });
      }}
    /> : null}
  </>;
}
