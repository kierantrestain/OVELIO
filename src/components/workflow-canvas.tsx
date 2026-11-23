'use client';

/* AUT-02 / AUT-04 / AUT-03 / AUT-05 / AUT-06: branching workflow canvas. React, SVG and CSS only. */

import { ArrowLeft, LayoutGrid, ListTree, Plus, Trash2, X } from 'lucide-react';
import { useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Field } from '@astryxdesign/core/Field';
import { IconButton } from '@astryxdesign/core/IconButton';
import { MultiSelector } from '@astryxdesign/core/MultiSelector';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Token } from '@astryxdesign/core/Token';
import type {
  Company, CustomField, DynamicContent, FocusItem, JourneyEmail, LandingPage, LeadForm, MarketingMessage, Segment, Stage,
  Tag, Workflow, WorkflowBranch, WorkflowFieldSpec, WorkflowGraph, WorkflowInput, WorkflowIntervalUnit, WorkflowIssue,
  WorkflowNode, WorkflowNodeRun, WorkflowNodeSpec, WorkflowSchedule, WorkflowStep,
} from '@/contracts';
import {
  addressList, branches, childNodes, conditionOperatorLabels, decisionWait, decisionWaitLabel, editableNodeSpec,
  emptySchedule, fieldConditionOperatorsFor, formConditionOperators, intervalSchedule, isOn, keyValueRows, layoutPoint,
  layoutWorkflowGraph, maxWorkflowNodes, relativeDateChoices, scheduleLabel, setDecisionWait, subtreeIds, utmFields,
  validateWorkflowGraph, workflowLayout, workflowNodeSpec, workflowNodeSpecs,
} from '@/contracts';
import { api, date, number, useAction, useResource } from './client';
import { ConfirmDialog, Feedback, FormActions, Modal, Panel, SlideDrawer } from './ui';

const workflowPath = '/workflows';
const cardWidth = 200;
const cardHeight = 96;

type User = { id: number; name: string; email: string };

export type WorkflowLookups = {
  emails?: JourneyEmail[];
  segments?: Segment[];
  forms?: LeadForm[];
  stages?: Stage[];
  users?: User[];
  companies?: Company[];
  pointGroups?: { id: number; name: string }[];
  workflows?: Workflow[];
  pages?: LandingPage[];
  dynamicContents?: DynamicContent[];
  focusItems?: FocusItem[];
  messages?: MarketingMessage[];
  contactFields?: CustomField[];
  companyFields?: CustomField[];
  tags?: Tag[];
};

type LookupKey = keyof WorkflowLookups;

const lookupPaths: Record<LookupKey, string> = {
  emails: '/journey-emails', segments: '/segments', forms: '/forms', stages: '/stages', users: '/forms/users',
  companies: '/companies', pointGroups: '/point-groups', workflows: '/workflows', pages: '/pages',
  dynamicContents: '/dynamic-content', focusItems: '/focus-items', messages: '/marketing-messages',
  contactFields: '/fields/contact', companyFields: '/fields/company', tags: '/tags',
};

/** Which console list each property editor reads. */
function lookupsFor(field: WorkflowFieldSpec): LookupKey[] {
  switch (field.kind) {
    case 'email': case 'user-email': return ['emails'];
    case 'stage': case 'stages': return ['stages'];
    case 'segments': return ['segments'];
    case 'user': case 'users': return ['users'];
    case 'company': return ['companies'];
    case 'form': case 'form-field-condition': return ['forms'];
    case 'campaigns': return ['workflows'];
    case 'point-group': return ['pointGroups'];
    case 'page': return ['pages'];
    case 'dynamic-content': return ['dynamicContents'];
    case 'focus': return ['focusItems'];
    case 'message': return ['messages'];
    case 'field-condition': return ['contactFields', 'companyFields'];
    case 'field-values': return [field.object === 'company' ? 'companyFields' : 'contactFields'];
    default: return [];
  }
}

function useLookup<T>(key: LookupKey, needed: Set<LookupKey>) {
  return useResource<T>(needed.has(key) ? lookupPaths[key] : null);
}

/** Loads the lists the graph's steps need, plus `always`. Unused lists are not requested. */
export function useWorkflowLookups(graph: WorkflowGraph | null, always: LookupKey[] = []) {
  const needed = new Set<LookupKey>(always);
  for (const node of graph?.nodes ?? []) {
    for (const field of editableNodeSpec(node.type)?.fields ?? []) for (const key of lookupsFor(field)) needed.add(key);
  }
  const resources = {
    emails: useLookup<JourneyEmail[]>('emails', needed),
    segments: useLookup<Segment[]>('segments', needed),
    forms: useLookup<LeadForm[]>('forms', needed),
    stages: useLookup<Stage[]>('stages', needed),
    users: useLookup<User[]>('users', needed),
    companies: useLookup<Company[]>('companies', needed),
    pointGroups: useLookup<{ id: number; name: string }[]>('pointGroups', needed),
    workflows: useLookup<Workflow[]>('workflows', needed),
    pages: useLookup<LandingPage[]>('pages', needed),
    dynamicContents: useLookup<DynamicContent[]>('dynamicContents', needed),
    focusItems: useLookup<FocusItem[]>('focusItems', needed),
    messages: useLookup<MarketingMessage[]>('messages', needed),
    contactFields: useLookup<CustomField[]>('contactFields', needed),
    companyFields: useLookup<CustomField[]>('companyFields', needed),
    tags: useLookup<Tag[]>('tags', needed),
  };
  const lookups: WorkflowLookups = {
    emails: resources.emails.data, segments: resources.segments.data, forms: resources.forms.data, stages: resources.stages.data,
    users: resources.users.data, companies: resources.companies.data, pointGroups: resources.pointGroups.data,
    workflows: resources.workflows.data, pages: resources.pages.data, dynamicContents: resources.dynamicContents.data,
    focusItems: resources.focusItems.data, messages: resources.messages.data, contactFields: resources.contactFields.data,
    companyFields: resources.companyFields.data, tags: resources.tags.data,
  };
  const error = Object.values(resources).map(resource => resource.error).find(Boolean);
  return { lookups, error, loading: (key: LookupKey) => resources[key].loading };
}

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
.ov-wf-edges path[data-run="taken"] { stroke: var(--color-accent); stroke-width: 2.5; }
.ov-wf-card { position: absolute; width: ${cardWidth}px; height: ${cardHeight}px; box-sizing: border-box; display: grid; align-content: start; gap: 2px; padding: 9px 12px; text-align: left; font: inherit; color: var(--color-text-primary); background: var(--color-background-surface); border: 1px solid var(--color-border); border-radius: var(--radius-element, 8px); cursor: pointer; overflow: hidden; }
.ov-wf-card:hover { border-color: var(--color-border-emphasized); }
.ov-wf-card:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
.ov-wf-card[data-kind="decision"], .ov-wf-card[data-kind="condition"] { border-left: 4px solid var(--color-accent); }
.ov-wf-card[data-kind="entry"] { background: var(--color-accent-muted); cursor: default; }
.ov-wf-card[data-state="error"] { border-color: var(--color-text-error, #c0362c); }
.ov-wf-card[data-selected="true"] { box-shadow: 0 0 0 2px var(--color-accent); }
.ov-wf-card[data-run="executed"], .ov-wf-row[data-run="executed"] { border-color: var(--color-border-success, #2e7d32); }
.ov-wf-card[data-run="scheduled"], .ov-wf-row[data-run="scheduled"], .ov-wf-card[data-run="pending"], .ov-wf-row[data-run="pending"] { border-color: var(--color-border-info, #1565c0); }
.ov-wf-card[data-run="failed"], .ov-wf-row[data-run="failed"] { border-color: var(--color-border-error, #c0362c); }
.ov-wf-card[data-run="waiting"], .ov-wf-row[data-run="waiting"] { border-color: var(--color-border-warning, #b26a00); }
.ov-wf-card[data-run], .ov-wf-row[data-run] { border-width: 2px; }
.ov-wf-card[data-run="none"], .ov-wf-row[data-run="none"], .ov-wf-card[data-run="cancelled"], .ov-wf-row[data-run="cancelled"] { opacity: .55; border-width: 1px; }
.ov-wf-run { font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ov-wf-run[data-run="executed"] { color: var(--color-text-success, #2e7d32); }
.ov-wf-run[data-run="scheduled"], .ov-wf-run[data-run="pending"] { color: var(--color-text-info, #1565c0); }
.ov-wf-run[data-run="failed"] { color: var(--color-text-error, #c0362c); }
.ov-wf-run[data-run="waiting"] { color: var(--color-text-warning, #b26a00); }
.ov-wf-run[data-run="none"], .ov-wf-run[data-run="cancelled"] { color: var(--color-text-secondary); font-weight: 400; }
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
.ov-wf-row[data-state="error"] { border-color: var(--color-text-error, #c0362c); }
.ov-wf-row:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
.ov-wf-row[data-static="true"] { cursor: default; }
.ov-wf-row:disabled { cursor: not-allowed; opacity: .6; }
.ov-wf-branch { font-size: 12px; font-weight: 600; color: var(--color-text-secondary); }
.ov-wf-list .ov-wf-add { position: static; transform: none; justify-self: start; }
.ov-wf-issues { margin: 0; padding-left: 18px; display: grid; gap: 4px; }
.ov-wf-native { font: inherit; padding: 6px 8px; border: 1px solid var(--color-border); border-radius: var(--radius-element, 8px); background: var(--color-background-surface); color: var(--color-text-primary); }
.ov-wf-days { display: flex; flex-wrap: wrap; gap: 4px 12px; }
.ov-wf-pairs { display: grid; gap: 8px; }
.ov-wf-pair { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; gap: 8px; align-items: end; }
.ov-wf-catalogue { display: grid; gap: 6px; max-height: 60vh; overflow: auto; }
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
  const spec = workflowNodeSpec(node.type);
  return spec?.unavailable ? `${kind} · Not available` : spec ? kind : `${kind} · Advanced`;
}

function nameIn<T extends { id: number }>(list: T[] | undefined, id: number, label: (item: T) => string, fallback: string) {
  const found = list?.find(item => item.id === id);
  return found ? label(found) : `${fallback} #${id}`;
}

function namesIn<T extends { id: number }>(list: T[] | undefined, ids: number[], label: (item: T) => string, fallback: string) {
  return ids.map(id => nameIn(list, id, label, fallback)).join(', ');
}

function fieldLabel(alias: string, lookups: WorkflowLookups) {
  if (alias === 'tags') return 'Tags';
  return [...(lookups.contactFields ?? []), ...(lookups.companyFields ?? [])].find(field => field.alias === alias)?.label || alias;
}

/** One line that says what a step does, for cards and outlines. */
export function describeNode(node: WorkflowNode, lookups: WorkflowLookups) {
  const props = node.properties;
  const id = (key: string) => Number(props[key]) || 0;
  const valueText = (value: unknown) => Array.isArray(value) ? value.join(', ') : String(value ?? '');
  switch (node.type) {
    case 'email.send': {
      const name = id('email') ? nameIn(lookups.emails, id('email'), email => email.name, 'Email') : 'Choose an email';
      return props.email_type === 'transactional' ? `${name} (transactional)` : name;
    }
    case 'email.send.to.user': {
      const emailId = Number((props.useremail as Record<string, unknown> | undefined)?.email) || 0;
      return emailId ? `${nameIn(lookups.emails, emailId, email => email.name, 'Email')} to users` : 'Choose an email';
    }
    case 'message.send': return id('marketingMessage') ? nameIn(lookups.messages, id('marketingMessage'), item => item.name, 'Message') : 'Choose a message';
    case 'lead.changetags': {
      const parts = [...tagList(props.add_tags).map(tag => `+${tag}`), ...tagList(props.remove_tags).map(tag => `−${tag}`)];
      return parts.join(', ') || 'Choose tags';
    }
    case 'lead.changepoints': {
      const points = Number(props.points) || 0;
      return `${points > 0 ? '+' : ''}${number(points)} points${id('group') ? ` in ${nameIn(lookups.pointGroups, id('group'), group => group.name, 'group')}` : ''}`;
    }
    case 'lead.changelist': {
      const nameOf = (segmentId: number) => nameIn(lookups.segments, segmentId, item => item.name, 'Segment');
      const parts = [...idsOf(props.addToLists).map(item => `add to ${nameOf(item)}`), ...idsOf(props.removeFromLists).map(item => `remove from ${nameOf(item)}`)];
      return parts.join(', ') || 'Choose segments';
    }
    case 'stage.change': return id('stage') ? nameIn(lookups.stages, id('stage'), stage => stage.name, 'Stage') : 'Choose a stage';
    case 'lead.updatelead': case 'lead.updatecompany': {
      const keys = Object.keys(props);
      return keys.length ? `Set ${keys.slice(0, 3).map(key => fieldLabel(key, lookups)).join(', ')}${keys.length > 3 ? ` and ${keys.length - 3} more` : ''}` : 'Choose fields';
    }
    case 'lead.addtocompany': return id('company') ? nameIn(lookups.companies, id('company'), item => item.name, 'Company') : 'Choose a company';
    case 'lead.changeowner': return id('owner') ? `Owner: ${nameIn(lookups.users, id('owner'), user => user.name, 'User')}` : 'Choose an owner';
    case 'lead.scorecontactscompanies': return `${Number(props.score) > 0 ? '+' : ''}${number(Number(props.score) || 0)} company score`;
    case 'lead.adddnc': return `Do not contact: ${tagList(props.channels).join(', ') || 'choose channels'}`;
    case 'lead.removednc': return `Contactable again: ${tagList(props.channels).join(', ') || 'choose channels'}`;
    case 'lead.deletecontact': return 'Deletes the contact';
    case 'campaign.addremovelead': {
      const label = (value: unknown) => value === 'this' ? 'this workflow' : nameIn(lookups.workflows, Number(value), item => item.name, 'Workflow');
      const parts = [...listOf(props.addTo).map(item => `add to ${label(item)}`), ...listOf(props.removeFrom).map(item => `remove from ${label(item)}`)];
      return parts.join(', ') || 'Choose workflows';
    }
    case 'campaign.jump_to_event': return props.jumpToEvent ? `Jump to step ${String(props.jumpToEvent)}` : 'Choose a step';
    case 'campaign.sendwebhook': return `${String(props.method ?? 'post').toUpperCase()} ${String(props.url ?? '') || 'URL'}`;
    case 'dwc.push_content': return id('dynamicContent') ? nameIn(lookups.dynamicContents, id('dynamicContent'), item => item.name, 'Content') : 'Choose content';
    case 'focus.show': return id('focus') ? nameIn(lookups.focusItems, id('focus'), item => item.name, 'Popup') : 'Choose a popup';
    case 'lead.field_value': {
      const operator = String(props.operator ?? '=');
      const label = props.field ? fieldLabel(String(props.field), lookups) : 'Field';
      return `${label} ${conditionOperatorLabels[operator] ?? operator}${operator === 'empty' || operator === '!empty' ? '' : ` ${valueText(props.value)}`}`;
    }
    case 'lead.device': return [...tagList(props.device_type), ...tagList(props.device_brand), ...tagList(props.device_os)].join(', ') || 'Any device';
    case 'lead.pageHit': return id('page') ? nameIn(lookups.pages, id('page'), page => page.title, 'Page') : String(props.page_url || 'Choose a page');
    case 'lead.tags': return `Has ${tagList(props.tags).join(' or ') || 'tags'}`;
    case 'lead.segments': return `In ${namesIn(lookups.segments, idsOf(props.segments), item => item.name, 'Segment') || 'segments'}`;
    case 'lead.stages': return `In ${namesIn(lookups.stages, idsOf(props.stages), item => item.name, 'Stage') || 'stages'}`;
    case 'lead.owner': return `Owned by ${namesIn(lookups.users, idsOf(props.owner), user => user.name, 'User') || 'an owner'}`;
    case 'lead.attached': return `Now is ${props.operator === 'gt' ? 'after' : 'before'} start + ${String(props.triggerInterval ?? 1)}${String(props.triggerIntervalUnit ?? 'd')}`;
    case 'lead.campaigns': return `In ${namesIn(lookups.workflows, idsOf(props.campaigns), item => item.name, 'Workflow') || 'workflows'}`;
    case 'lead.dnc': return `Do not contact on ${tagList(props.channels).join(' or ') || 'a channel'}`;
    case 'lead.points': return `Points ${conditionOperatorLabels[String(props.operator)] ?? String(props.operator ?? '')} ${String(props.score ?? '')}`;
    case 'form.field_value': {
      const form = lookups.forms?.find(item => item.id === id('form'));
      const field = form?.fields?.find(item => item.alias === props.field)?.label ?? String(props.field || 'field');
      return `${form?.name ?? 'Form'}: ${field} ${conditionOperatorLabels[String(props.operator)] ?? ''} ${valueText(props.value)}`;
    }
    case 'email.validate.address': return 'Valid, deliverable address';
    case 'notification.has.active': return 'Has an enabled push subscription';
    case 'email.open': return 'Waits for an open';
    case 'email.click': return 'Waits for a click';
    default: {
      const spec = workflowNodeSpec(node.type);
      return spec?.unavailable ? `${spec.label} (kept as saved)` : spec ? spec.description : node.type;
    }
  }
}

function timingLabel(graph: WorkflowGraph, node: WorkflowNode) {
  if (node.eventType === 'decision') return decisionWaitLabel(graph, node) ?? 'No end for contacts who never act';
  if (workflowNodeSpec(node.type)?.immediateOnly) return 'When reached';
  return scheduleLabel(node.schedule);
}

export function describeSources(graph: WorkflowGraph, lookups: WorkflowLookups) {
  const parts = [
    ...graph.segmentIds.map(id => `Segment: ${lookups.segments?.find(item => item.id === id)?.name || `#${id}`}`),
    ...graph.formIds.map(id => `Lead form: ${lookups.forms?.find(item => item.id === id)?.name || `#${id}`}`),
  ];
  return parts.join(' · ') || 'No trigger yet';
}

/** AUT-06: one line saying where the contact is at this step and why. */
export function runStateLabel(run: WorkflowNodeRun | undefined) {
  if (!run) return 'Not reached';
  const entry = run.entry;
  switch (run.state) {
    case 'executed':
      return `${entry?.reason ? 'Ran with an error' : 'Done'} ${date(entry?.triggeredAt)}${run.path ? ` · ${run.path} path` : ''}${entry?.reason ? `: ${entry.reason}` : ''}`;
    case 'scheduled': return `Scheduled for ${date(entry?.scheduledFor)}`;
    case 'failed': return `Failed${entry?.scheduledFor ? `, retry ${date(entry.scheduledFor)}` : ''}: ${entry?.reason ?? 'no reason given'}`;
    case 'cancelled': return 'Cancelled before it ran';
    case 'waiting': return run.deadline ? `Waiting · no path from ${date(run.deadline)}` : 'Waiting for the contact to act';
    case 'pending': return 'Runs on the engine’s next pass';
  }
}

function slotsFor(node: WorkflowNode | null): { branch: WorkflowBranch | null; label: string }[] {
  if (node && workflowNodeSpec(node.type)?.leaf) return [];
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

function OutlineBranch({ graph, parentId, branch, lookups, issues, runStates, onSelect, onAdd }: {
  graph: WorkflowGraph; parentId: string | null; branch?: WorkflowBranch | null; lookups: WorkflowLookups;
  issues?: Map<string, WorkflowIssue[]>; runStates?: Map<string, WorkflowNodeRun>; onSelect?: (id: string) => void; onAdd?: (anchor: Anchor) => void;
}) {
  const children = childNodes(graph, parentId, branch === undefined ? undefined : branch);
  if (!children.length && !onAdd) return null;
  return <ol data-branch={branch ?? undefined}>
    {children.map(node => {
      const hasError = issues?.get(node.id)?.some(issue => issue.level === 'error');
      const run = runStates?.get(node.id);
      const runKey = runStates ? run?.state ?? 'none' : undefined;
      const content = <>
        <span className="ov-wf-kind">{nodeKindLabel(node)}</span>
        <span className="ov-wf-title">{node.name || 'Untitled step'}</span>
        <span className="ov-wf-meta">{describeNode(node, lookups)}</span>
        {runStates
          ? <span className="ov-wf-run" data-run={runKey}>{runStateLabel(run)}</span>
          : <span className={node.eventType === 'decision' ? 'ov-wf-wait' : 'ov-wf-meta'}>{timingLabel(graph, node)}</span>}
      </>;
      return <li key={node.id}>
        {onSelect
          ? <button type="button" className="ov-wf-row" data-state={hasError ? 'error' : undefined} data-run={runKey} onClick={() => onSelect(node.id)}>{content}</button>
          : <div className="ov-wf-row" data-static="true" data-run={runKey}>{content}</div>}
        {slotsFor(node).map(slot => {
          const nested = <OutlineBranch graph={graph} parentId={node.id} branch={slot.branch} lookups={lookups} issues={issues} runStates={runStates} onSelect={onSelect} onAdd={onAdd} />;
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
export function WorkflowOutline({ graph, lookups, runStates }: { graph: WorkflowGraph; lookups: WorkflowLookups; runStates?: Map<string, WorkflowNodeRun> }) {
  return <div className="ov-wf-list">
    <style>{canvasCss}</style>
    <OutlineBranch graph={graph} parentId={null} lookups={lookups} runStates={runStates} />
  </div>;
}

/* ── Canvas ─────────────────────────────────────────────────────────────────── */

function CanvasView({ graph, lookups, issues, selectedId, runStates, onSelect, onAdd }: {
  graph: WorkflowGraph; lookups: WorkflowLookups; issues: Map<string, WorkflowIssue[]>; selectedId: string | null;
  runStates?: Map<string, WorkflowNodeRun>; onSelect: (id: string) => void; onAdd?: (anchor: Anchor) => void;
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
    const taken = runStates?.get(node.id) && runStates.get(node.id)!.state !== 'cancelled';
    edges.push(<path key={node.id} data-branch={node.branch ?? undefined} data-run={taken ? 'taken' : undefined}
      d={`M ${startX} ${startY} C ${startX} ${middle}, ${endX} ${middle}, ${endX} ${point.y}`} />);
  }

  const addButtons: ReactNode[] = [];
  const pushAdd = (node: WorkflowNode | null, x: number, y: number) => {
    if (!onAdd) return;
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
        const run = runStates?.get(node.id);
        const status = runStates ? runStateLabel(run) : timingLabel(graph, node);
        return <button key={node.id} type="button" className="ov-wf-card" data-node-id={node.id}
          data-kind={node.eventType} data-state={hasError ? 'error' : undefined} data-selected={selectedId === node.id}
          data-run={runStates ? run?.state ?? 'none' : undefined}
          style={{ left: point.x, top: point.y }} onClick={() => onSelect(node.id)} onKeyDown={event => onKey(event, node)}
          aria-label={`${nodeKindLabel(node)}: ${node.name}. ${describeNode(node, lookups)}. ${status}.${hasError ? ' Needs attention.' : ''}`}>
          <span className="ov-wf-kind">{nodeKindLabel(node)}{hasError ? ' · Fix this step' : ''}</span>
          <span className="ov-wf-title">{node.name || 'Untitled step'}</span>
          <span className="ov-wf-meta">{describeNode(node, lookups)}</span>
          {runStates
            ? <span className="ov-wf-run" data-run={run?.state ?? 'none'}>{status}</span>
            : <span className={node.eventType === 'decision' ? 'ov-wf-wait' : 'ov-wf-meta'}>{status}</span>}
        </button>;
      })}
      {addButtons}
    </div>
  </div>;
}

/** AUT-06: the workflow, read-only, with each step coloured by where one contact is. */
export function WorkflowRunCanvas({ graph, lookups, runStates, selectedId, onSelect }: {
  graph: WorkflowGraph; lookups: WorkflowLookups; runStates: Map<string, WorkflowNodeRun>;
  selectedId: string | null; onSelect: (id: string) => void;
}) {
  const [view, setView] = useState<'canvas' | 'list'>(() =>
    typeof window !== 'undefined' && window.matchMedia?.('(max-width: 720px)').matches ? 'list' : 'canvas');
  return <div className="ov-stack-sm">
    <style>{canvasCss}</style>
    <div className="ov-wf-toolbar">
      <Text type="supporting" color="secondary">Green ran, blue is scheduled or next, amber waits for the contact, red failed. Faded steps were not reached.</Text>
      <SegmentedControl label="Workflow view" size="sm" value={view} onChange={value => setView(value === 'list' ? 'list' : 'canvas')}>
        <SegmentedControlItem value="canvas" label="Canvas" icon={<LayoutGrid size={14} />} />
        <SegmentedControlItem value="list" label="Outline" icon={<ListTree size={14} />} />
      </SegmentedControl>
    </div>
    {view === 'canvas'
      ? <CanvasView graph={graph} lookups={lookups} issues={new Map()} selectedId={selectedId} runStates={runStates} onSelect={onSelect} />
      : <div className="ov-wf-list"><OutlineBranch graph={graph} parentId={null} lookups={lookups} runStates={runStates} onSelect={onSelect} /></div>}
  </div>;
}

/* ── Property editors (AUT-03 / AUT-05) ─────────────────────────────────────── */

type Option = { value: string; label: string; description?: string };

function MultiIdPicker({ field, value, options, onChange, loading }: {
  field: WorkflowFieldSpec; value: unknown; options: Option[]; onChange: (value: unknown[]) => void; loading?: boolean;
}) {
  const selected = listOf(value).map(String);
  const known = new Set(options.map(option => option.value));
  const all = [...options, ...selected.filter(item => !known.has(item)).map(item => ({ value: item, label: item === 'this' ? 'This workflow' : `#${item}` }))];
  return <MultiSelector label={field.label} description={field.hint} options={all} value={selected} isLoading={loading}
    isRequired={field.required} hasSearch hasClear triggerDisplay="badges" placeholder="Choose from the list"
    onChange={next => onChange(next.map(item => item === 'this' || !/^\d+$/.test(item) ? item : Number(item)))} />;
}

function SingleIdPicker({ field, value, options, onChange, loading, placeholder }: {
  field: WorkflowFieldSpec; value: unknown; options: Option[]; onChange: (value: number | null) => void; loading?: boolean; placeholder?: string;
}) {
  const current = Number(value) ? String(value) : null;
  const all = current && !options.some(option => option.value === current) ? [...options, { value: current, label: `#${current}` }] : options;
  return <Selector label={field.label} description={field.hint} placeholder={placeholder ?? 'Choose from the list'} hasClear isLoading={loading}
    isRequired={field.required} value={current} options={all} onChange={next => onChange(Number(next) || null)} />;
}

function KeyValuesEditor({ field, value, onChange }: { field: WorkflowFieldSpec; value: unknown; onChange: (value: unknown) => void }) {
  const rows = keyValueRows(value) ?? [];
  const set = (next: { label: string; value: string }[]) => onChange({ list: next });
  return <div className="ov-stack-sm">
    <Text type="label">{field.label}</Text>
    <div className="ov-wf-pairs">
      {rows.map((row, index) => <div key={index} className="ov-wf-pair">
        <TextInput label="Name" value={row.label} onChange={label => set(rows.map((item, at) => at === index ? { ...item, label } : item))} />
        <TextInput label="Value" value={row.value} onChange={next => set(rows.map((item, at) => at === index ? { ...item, value: next } : item))} />
        <IconButton label={`Remove ${row.label || 'row'}`} variant="ghost" icon={<X size={14} />} onClick={() => set(rows.filter((_, at) => at !== index))} />
      </div>)}
    </div>
    <Button size="sm" variant="ghost" label={`Add ${field.label.toLowerCase().replace(/s$/, '')}`} icon={<Plus size={14} />}
      onClick={() => set([...rows, { label: '', value: '' }])} />
  </div>;
}

function datetimeInput(value: unknown) {
  const text = typeof value === 'string' ? value.trim() : '';
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(text);
  return match ? `${match[1]}T${match[2]}` : /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00` : '';
}

function fieldOptions(fields: CustomField[] | undefined) {
  return (fields ?? []).filter(field => field.published !== false).map(field => ({ value: field.alias, label: field.label, description: field.alias }));
}

/** lead.field_value: field, operator and value, with the engine's operators for the field's type. */
function FieldConditionEditor({ props, lookups, loading, onProps }: {
  props: Record<string, unknown>; lookups: WorkflowLookups; loading: boolean; onProps: (props: Record<string, unknown>) => void;
}) {
  const field = typeof props.field === 'string' ? props.field : '';
  const definition = [...(lookups.contactFields ?? []), ...(lookups.companyFields ?? [])].find(item => item.alias === field);
  const fieldType = definition?.type ?? ((utmFields as readonly string[]).includes(field) ? 'text' : null);
  const operators = fieldConditionOperatorsFor(fieldType, field);
  const operator = typeof props.operator === 'string' ? props.operator : '=';
  const sections: { type: 'section'; title: string; options: Option[] }[] = [
    { type: 'section' as const, title: 'Contact fields', options: fieldOptions(lookups.contactFields) },
    { type: 'section' as const, title: 'Company fields', options: fieldOptions(lookups.companyFields) },
    { type: 'section' as const, title: 'Other', options: [{ value: 'tags', label: 'Tags' }, ...utmFields.map(value => ({ value, label: value.replace('utm_', 'UTM ') }))] },
  ];
  const known = sections.some(section => section.options.some(option => option.value === field));
  if (field && !known) sections[2].options.push({ value: field, label: field });
  const choices = fieldType === 'boolean' ? [{ value: '1', label: 'Yes' }, { value: '0', label: 'No' }]
    : (definition?.options ?? []).map(option => ({ value: option, label: option }));
  const value = props.value;
  return <div className="ov-stack-sm">
    <Selector label="Field" isRequired placeholder="Choose a field" isLoading={loading} value={field || undefined} options={sections}
      onChange={next => {
        const nextDefinition = [...(lookups.contactFields ?? []), ...(lookups.companyFields ?? [])].find(item => item.alias === next);
        const allowed = fieldConditionOperatorsFor(nextDefinition?.type ?? ((utmFields as readonly string[]).includes(next) ? 'text' : null), next);
        onProps({ ...props, field: next, operator: allowed.includes(operator as never) ? operator : allowed[0], value: '' });
      }} />
    <Selector label="Comparison" value={operators.includes(operator as never) ? operator : operators[0]}
      options={operators.map(item => ({ value: item, label: conditionOperatorLabels[item] ?? item }))}
      onChange={next => onProps({ ...props, operator: next, value: next === 'in' || next === '!in' ? listOf(value).length ? value : [] : Array.isArray(value) ? '' : value })} />
    {operator === 'empty' || operator === '!empty' ? null
      : operator === 'date' ? <div className="ov-form-grid">
        <Selector label="Date" value={relativeDateChoices.some(choice => choice.value === value) ? String(value) : 'custom'}
          options={[...relativeDateChoices, { value: 'custom', label: 'Another period' }]}
          onChange={next => onProps({ ...props, value: next === 'custom' ? '+P7D' : next })} />
        {!relativeDateChoices.some(choice => choice.value === value) ? <TextInput label="Period from today" description="For example +P7D for in a week, -P1M for a month ago."
          value={typeof value === 'string' ? value : ''} onChange={next => onProps({ ...props, value: next.trim() })} /> : null}
      </div>
        : (operator === 'in' || operator === '!in') && choices.length
          ? <MultiSelector label="Values" options={choices} value={listOf(value).map(String)} hasSearch hasClear triggerDisplay="badges"
            onChange={next => onProps({ ...props, value: next })} />
          : choices.length && (operator === '=' || operator === '!=')
            ? <Selector label="Value" value={value === undefined || value === null || value === '' ? undefined : String(value)} options={choices}
              placeholder="Choose a value" onChange={next => onProps({ ...props, value: next })} />
            : <TextInput label="Value" isRequired value={Array.isArray(value) ? value.join(', ') : String(value ?? '')}
              description={operator === 'in' || operator === '!in' ? 'Separate values with commas.' : operator.includes('regexp') ? 'A MySQL regular expression.' : undefined}
              onChange={next => onProps({ ...props, value: operator === 'in' || operator === '!in' ? parseCsv(next) : next })} />}
    {field === 'tags' ? <Text type="supporting" color="secondary">The engine compares tags only with equals, does not equal, is like and is not like.</Text> : null}
  </div>;
}

/** form.field_value: a form, one of its fields, an operator and a value. */
function FormFieldConditionEditor({ props, lookups, loading, onProps }: {
  props: Record<string, unknown>; lookups: WorkflowLookups; loading: boolean; onProps: (props: Record<string, unknown>) => void;
}) {
  const formId = Number(props.form) || 0;
  const form = lookups.forms?.find(item => item.id === formId);
  const fields = (form?.fields ?? []).filter(field => !['button', 'freetext', 'freehtml', 'pagebreak', 'captcha'].includes(String(field.type)));
  const field = fields.find(item => item.alias === props.field);
  const choices = (field?.options ?? []).map(option => ({ value: option, label: option }));
  return <div className="ov-stack-sm">
    <Selector label="Lead form" isRequired placeholder="Choose a lead form" isLoading={loading} value={formId ? String(formId) : undefined}
      options={(lookups.forms ?? []).map(item => ({ value: String(item.id), label: item.name }))}
      onChange={next => onProps({ ...props, form: Number(next), field: '', value: '' })} />
    <Selector label="Field" isRequired placeholder={form ? 'Choose a field' : 'Choose a form first'} isDisabled={!form}
      value={typeof props.field === 'string' && props.field ? props.field : undefined}
      options={[...fields.map(item => ({ value: item.alias, label: item.label || item.alias })),
        ...(typeof props.field === 'string' && props.field && !field ? [{ value: props.field, label: props.field }] : [])]}
      onChange={next => onProps({ ...props, field: next, value: '' })} />
    <Selector label="Comparison" value={String(props.operator ?? '=')}
      options={formConditionOperators.map(item => ({ value: item, label: conditionOperatorLabels[item] ?? item }))}
      onChange={next => onProps({ ...props, operator: next })} />
    {choices.length && (props.operator === '=' || props.operator === '!=')
      ? <Selector label="Value" placeholder="Choose a value" value={props.value ? String(props.value) : undefined} options={choices}
        onChange={next => onProps({ ...props, value: next })} />
      : <TextInput label="Value" isRequired value={String(props.value ?? '')} onChange={next => onProps({ ...props, value: next })} />}
  </div>;
}

/** lead.updatelead / lead.updatecompany: the properties object is the alias → value map itself. */
function FieldValuesEditor({ field, props, lookups, loading, onProps }: {
  field: WorkflowFieldSpec; props: Record<string, unknown>; lookups: WorkflowLookups; loading: boolean; onProps: (props: Record<string, unknown>) => void;
}) {
  const fields = (field.object === 'company' ? lookups.companyFields : lookups.contactFields) ?? [];
  const entries = Object.entries(props);
  const unused = fieldOptions(fields).filter(option => !(option.value in props));
  const setValue = (alias: string, value: unknown) => onProps({ ...props, [alias]: value });
  return <div className="ov-stack-sm">
    <Text type="label">{field.label}</Text>
    {entries.map(([alias, value]) => {
      const definition = fields.find(item => item.alias === alias);
      const label = definition?.label ?? alias;
      const remove = <IconButton label={`Stop setting ${label}`} variant="ghost" icon={<X size={14} />}
        onClick={() => onProps(Object.fromEntries(entries.filter(([key]) => key !== alias)))} />;
      let input: ReactNode;
      if (definition?.type === 'boolean') {
        input = <Selector label={label} value={value === 1 || value === '1' || value === true ? '1' : '0'}
          options={[{ value: '1', label: 'Yes' }, { value: '0', label: 'No' }]} onChange={next => setValue(alias, Number(next))} />;
      } else if (definition?.type === 'multiselect' && definition.options.length) {
        input = <MultiSelector label={label} options={definition.options.map(option => ({ value: option, label: option }))}
          value={listOf(value).map(String)} hasClear onChange={next => setValue(alias, next)} />;
      } else if (definition?.options.length) {
        input = <Selector label={label} value={value ? String(value) : undefined} placeholder="Choose a value"
          options={definition.options.map(option => ({ value: option, label: option }))} onChange={next => setValue(alias, next)} />;
      } else {
        input = <TextInput label={label} value={value === null || value === undefined ? '' : String(value)}
          description={definition?.type === 'date' || definition?.type === 'datetime' ? 'A date, or a relative value such as now+3days.' : undefined}
          onChange={next => setValue(alias, next)} />;
      }
      return <div key={alias} className="ov-wf-pair" style={{ gridTemplateColumns: 'minmax(0, 1fr) auto' }}>{input}{remove}</div>;
    })}
    <Selector label="Add a field" placeholder="Choose a field to set" isLoading={loading} value={null} hasClear options={unused}
      onChange={next => { if (next) setValue(next, ''); }} />
    <Text type="supporting" color="secondary">Values can use tokens such as {'{contactfield=firstname}'}.</Text>
  </div>;
}

function PropertyField({ field, node, graph, lookups, loading, onProps }: {
  field: WorkflowFieldSpec; node: WorkflowNode; graph: WorkflowGraph; lookups: WorkflowLookups; loading: (key: LookupKey) => boolean;
  onProps: (props: Record<string, unknown>) => void;
}) {
  const props = node.properties;
  const value = props[field.key];
  const set = (next: unknown) => onProps({ ...props, [field.key]: next });
  const options = {
    emails: (lookups.emails ?? []).filter(email => email.published || email.id === Number(value))
      .map(email => ({ value: String(email.id), label: email.name, description: email.subject })),
    segments: (lookups.segments ?? []).map(item => ({ value: String(item.id), label: item.name })),
    stages: (lookups.stages ?? []).map(item => ({ value: String(item.id), label: item.name, description: item.published ? undefined : 'Unpublished' })),
    users: (lookups.users ?? []).map(user => ({ value: String(user.id), label: user.name, description: user.email })),
    companies: (lookups.companies ?? []).map(item => ({ value: String(item.id), label: item.name })),
    pointGroups: (lookups.pointGroups ?? []).map(item => ({ value: String(item.id), label: item.name })),
    pages: (lookups.pages ?? []).map(item => ({ value: String(item.id), label: item.title })),
    dynamicContents: (lookups.dynamicContents ?? []).map(item => ({ value: String(item.id), label: item.name, description: item.slotName })),
    focusItems: (lookups.focusItems ?? []).map(item => ({ value: String(item.id), label: item.name })),
    messages: (lookups.messages ?? []).map(item => ({ value: String(item.id), label: item.name, description: item.published ? undefined : 'Unpublished' })),
  };
  if (field.showWhen && !isOn(props[field.showWhen])) return null;
  switch (field.kind) {
    case 'email':
      return <SingleIdPicker field={field} value={value} options={options.emails} loading={loading('emails')} placeholder="Choose a published journey email" onChange={next => set(next || 0)} />;
    case 'user-email': {
      const current = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
      return <SingleIdPicker field={field} value={current.email} options={options.emails} loading={loading('emails')}
        placeholder="Choose a published email" onChange={next => set({ ...current, email: next || 0 })} />;
    }
    case 'stage': return <SingleIdPicker field={field} value={value} options={options.stages} loading={loading('stages')} onChange={next => set(next || 0)} />;
    case 'company': return <SingleIdPicker field={field} value={value} options={options.companies} loading={loading('companies')} onChange={next => set(next || 0)} />;
    case 'user': return <SingleIdPicker field={field} value={value} options={options.users} loading={loading('users')} onChange={next => set(next || 0)} />;
    case 'point-group': return <SingleIdPicker field={field} value={value} options={options.pointGroups} loading={loading('pointGroups')} onChange={next => set(next || null)} />;
    case 'page': return <SingleIdPicker field={field} value={value} options={options.pages} loading={loading('pages')} onChange={next => set(next || '')} />;
    case 'dynamic-content': return <SingleIdPicker field={field} value={value} options={options.dynamicContents} loading={loading('dynamicContents')} onChange={next => set(next || 0)} />;
    case 'focus': return <SingleIdPicker field={field} value={value} options={options.focusItems} loading={loading('focusItems')} onChange={next => set(next || 0)} />;
    case 'message': return <SingleIdPicker field={field} value={value} options={options.messages} loading={loading('messages')} onChange={next => set(next || 0)} />;
    case 'form': return <SingleIdPicker field={field} value={value} options={(lookups.forms ?? []).map(item => ({ value: String(item.id), label: item.name }))} loading={loading('forms')} onChange={next => set(next || 0)} />;
    case 'segments': return <MultiIdPicker field={field} value={value} options={options.segments} loading={loading('segments')} onChange={set} />;
    case 'stages': return <MultiIdPicker field={field} value={value} options={options.stages} loading={loading('stages')} onChange={set} />;
    case 'users': return <MultiIdPicker field={field} value={value} options={options.users} loading={loading('users')} onChange={set} />;
    case 'campaigns': {
      const workflows = (lookups.workflows ?? []).map(item => ({ value: String(item.id), label: item.name }));
      return <MultiIdPicker field={field} value={value} loading={loading('workflows')} onChange={set}
        options={field.allowThis ? [{ value: 'this', label: 'This workflow' }, ...workflows] : workflows} />;
    }
    case 'tags': case 'list':
      return <TextInput label={field.label} isRequired={field.required} description={field.hint ?? 'Separate items with commas.'}
        value={tagList(value).join(', ')} onChange={next => set(parseCsv(next))} />;
    case 'integer':
      return <NumberInput label={field.label} description={field.hint} min={field.min ?? -100000} max={field.max ?? 100000} isIntegerOnly
        isRequired={field.required} value={value === '' || value === null || value === undefined ? null : Number(value)} hasClear
        onChange={(next: number | null) => set(next ?? '')} />;
    case 'seconds':
      return <NumberInput label={field.label} description={field.hint} min={0} max={86_400 * 30} isIntegerOnly hasClear
        value={value === '' || value === null || value === undefined ? null : Number(value)} onChange={(next: number | null) => set(next ?? '')} />;
    case 'text': case 'url': case 'addresses': {
      const invalid = field.kind === 'addresses' && addressList(value) === null;
      return <TextInput label={field.label} isRequired={field.required} description={field.hint} value={String(value ?? '')}
        status={invalid ? { type: 'error', message: 'Use email addresses or {contactfield=alias} tokens, separated by commas.' } : undefined}
        onChange={next => set(next)} />;
    }
    case 'boolean':
      return <CheckboxInput label={field.label} description={field.hint} value={isOn(value)} onChange={checked => set(checked)} />;
    case 'choice': {
      const current = value === null || value === undefined || value === '' ? null : String(value);
      return <Selector label={field.label} description={field.hint} hasClear value={current} placeholder="Choose one"
        options={field.choices ?? []} onChange={next => set(next === null ? (field.numeric ? null : '') : field.numeric ? Number(next) : next)} />;
    }
    case 'choices': {
      const selected = new Set(tagList(value));
      const extra = [...selected].filter(item => !(field.choices ?? []).some(choice => choice.value === item));
      const all = [...(field.choices ?? []), ...extra.map(item => ({ value: item, label: item }))];
      if (all.length > 4) {
        return <MultiSelector label={field.label} description={field.hint} options={all} value={[...selected]} hasSearch hasClear
          triggerDisplay="badges" isRequired={field.required} onChange={next => set(next)} />;
      }
      return <div className="ov-stack-sm">
        <Text type="label">{field.label}</Text>
        <div className="ov-wf-days">{all.map(choice => <CheckboxInput key={choice.value} label={choice.label} value={selected.has(choice.value)}
          onChange={checked => {
            const next = new Set(selected);
            if (checked) next.add(choice.value); else next.delete(choice.value);
            set(all.map(item => item.value).filter(item => next.has(item)));
          }} />)}</div>
      </div>;
    }
    case 'datetime':
      return <Field label={field.label} inputID={`ov-wf-${field.key}-${node.id}`}>
        <input id={`ov-wf-${field.key}-${node.id}`} className="ov-wf-native" type="datetime-local" value={datetimeInput(value)}
          onChange={event => set(event.target.value ? event.target.value.replace('T', ' ') : '')} />
      </Field>;
    case 'key-values': return <KeyValuesEditor field={field} value={value} onChange={set} />;
    case 'jump-target': {
      const targets = graph.nodes.filter(item => item.id !== node.id && item.type !== 'campaign.jump_to_event')
        .map(item => ({ value: item.id, label: item.name || item.type, description: nodeKindLabel(item) }));
      return <Selector label={field.label} isRequired placeholder="Choose a step in this workflow" value={value ? String(value) : undefined}
        options={targets} onChange={next => set(/^\d+$/.test(next) ? Number(next) : next)} />;
    }
    case 'field-condition':
      return <FieldConditionEditor props={props} lookups={lookups} loading={loading('contactFields')} onProps={onProps} />;
    case 'form-field-condition':
      return <FormFieldConditionEditor props={props} lookups={lookups} loading={loading('forms')} onProps={onProps} />;
    case 'field-values':
      return <FieldValuesEditor field={field} props={props} lookups={lookups} loading={loading(field.object === 'company' ? 'companyFields' : 'contactFields')} onProps={onProps} />;
  }
}

/* ── Node settings drawer ──────────────────────────────────────────────────── */

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

function NodeDrawer({ graph, node, lookups, loading, issues, onChange, onGraph, onDelete, onClose }: {
  graph: WorkflowGraph; node: WorkflowNode; lookups: WorkflowLookups; loading: (key: LookupKey) => boolean; issues: WorkflowIssue[];
  onChange: (node: WorkflowNode) => void; onGraph: (graph: WorkflowGraph) => void; onDelete: () => void; onClose: () => void;
}) {
  const known = workflowNodeSpec(node.type);
  const spec = editableNodeSpec(node.type);
  const parent = node.parentId === null ? null : graph.nodes.find(item => item.id === node.parentId) ?? null;
  const [json, setJson] = useState(() => JSON.stringify(node.properties, null, 2));
  const [jsonError, setJsonError] = useState('');
  const wait = node.eventType === 'decision' ? decisionWait(graph, node.id) : null;
  const hasNoPath = node.eventType === 'decision' && childNodes(graph, node.id, 'no').length > 0;

  return <SlideDrawer title={node.name || 'Step'} subtitle={spec ? spec.label : known ? `${known.label} (not available)` : `Advanced step: ${node.type}`} onClose={onClose} width={500}>
    <div className="ov-stack-sm">
      {issues.length ? <ul className="ov-wf-issues">{issues.map((issue, index) => <li key={index}>
        <Text color={issue.level === 'error' ? undefined : 'secondary'} weight={issue.level === 'error' ? 'semibold' : undefined}>{issue.message}</Text>
      </li>)}</ul> : null}
      <TextInput label="Step name" isRequired value={node.name} onChange={name => onChange({ ...node, name })} />
      {spec ? <Text type="supporting" color="secondary">{spec.description}</Text>
        : known?.unavailable ? <Text type="supporting" color="secondary">{known.unavailable} Its settings are kept exactly as saved.</Text>
          : <Text type="supporting" color="secondary">
            The console has no form for this engine step yet. Its settings are kept exactly as saved; edit them as JSON with care.
          </Text>}

      {spec?.fields.map(field => <PropertyField key={field.key || field.kind} field={field} node={node} graph={graph} lookups={lookups}
        loading={loading} onProps={properties => onChange({ ...node, properties })} />)}

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
      </div> : spec?.immediateOnly ? <Text type="supporting" color="secondary">This step runs as soon as a contact reaches it.</Text>
        : <ScheduleEditor node={node} parent={parent} onChange={schedule => onChange({ ...node, schedule })} />}

      <FormActions>
        <Button variant="ghost" label="Delete step" icon={<Trash2 size={15} />} onClick={onDelete} />
        <Button variant="primary" label="Done" onClick={onClose} />
      </FormActions>
    </div>
  </SlideDrawer>;
}

/** Why a step type cannot go at this point, or null when it can. */
export function addStepBlocker(graph: WorkflowGraph, anchor: Anchor, spec: WorkflowNodeSpec): string | null {
  const parent = anchor.parentId === null ? null : graph.nodes.find(node => node.id === anchor.parentId) ?? null;
  if (spec.unavailable) return spec.unavailable;
  if (spec.eventType === 'decision' && parent?.eventType === 'decision') return 'A decision cannot follow another decision.';
  if (spec.parentTypes && (!parent || !spec.parentTypes.includes(parent.type))) return `Comes straight after ${spec.parentLabel ?? 'a specific step'}.`;
  if (spec.notOnNoPath && anchor.branch === 'no') return 'Only allowed on the yes path.';
  if (spec.leaf && childNodes(graph, anchor.parentId, anchor.branch).length) return 'Nothing can follow this step, and steps already follow this point.';
  return null;
}

function AddStepModal({ graph, anchor, onPick, onClose }: {
  graph: WorkflowGraph; anchor: Anchor; onPick: (spec: WorkflowNodeSpec) => void; onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const term = search.trim().toLowerCase();
  const matches = workflowNodeSpecs.filter(spec => !term || `${spec.label} ${spec.description} ${spec.group}`.toLowerCase().includes(term));
  const sections: [string, WorkflowNodeSpec[]][] = [
    ['Actions', matches.filter(spec => spec.eventType === 'action' && !addStepBlocker(graph, anchor, spec))],
    ['Conditions: check at once, then yes or no', matches.filter(spec => spec.eventType === 'condition' && !addStepBlocker(graph, anchor, spec))],
    ['Decisions: wait for the contact to act', matches.filter(spec => spec.eventType === 'decision' && !addStepBlocker(graph, anchor, spec))],
    ['Not possible here', matches.filter(spec => addStepBlocker(graph, anchor, spec))],
  ];
  return <Modal title={anchorLabel(graph, anchor)} onClose={onClose} size="large">
    <TextInput label="Find a step" value={search} onChange={setSearch} placeholder="For example tags, webhook or points" />
    <div className="ov-wf-catalogue">
      {sections.filter(([, specs]) => specs.length).map(([title, specs]) => <div key={title} className="ov-stack-sm">
        <Text type="label">{title}</Text>
        {specs.map(spec => {
          const blocker = addStepBlocker(graph, anchor, spec);
          return <button key={spec.type} type="button" className="ov-wf-row" disabled={Boolean(blocker)} onClick={() => onPick(spec)}>
            <span className="ov-wf-kind">{spec.group}</span>
            <span className="ov-wf-title">{spec.label}</span>
            <span className="ov-wf-meta" style={{ whiteSpace: 'normal' }}>{blocker ?? spec.description}</span>
          </button>;
        })}
      </div>)}
    </div>
    <FormActions><Button label="Cancel" onClick={onClose} /></FormActions>
  </Modal>;
}

/* ── Editor ─────────────────────────────────────────────────────────────────── */

export function WorkflowCanvasEditor({ workflow, onClose, onDone }: { workflow?: Workflow; onClose: () => void; onDone: () => void }) {
  const action = useAction();
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
  const { lookups, error: lookupError, loading } = useWorkflowLookups(graph, ['emails', 'segments', 'forms', 'stages']);

  const issues = validateWorkflowGraph(graph);
  const issuesByNode = new Map<string, WorkflowIssue[]>();
  for (const issue of issues) if (issue.nodeId) issuesByNode.set(issue.nodeId, [...(issuesByNode.get(issue.nodeId) ?? []), issue]);
  const errors = issues.filter(issue => issue.level === 'error');
  const selected = selectedId ? graph.nodes.find(node => node.id === selectedId) ?? null : null;

  const publishedSegments = (lookups.segments ?? []).filter(segment => segment.published || graph.segmentIds.includes(segment.id));
  const publishedForms = (lookups.forms ?? []).filter(form => form.published || graph.formIds.includes(form.id));

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
          <Selector label="Start for contacts in segment" placeholder="Add a published segment" value={null} hasClear isLoading={loading('segments')}
            options={publishedSegments.filter(segment => !graph.segmentIds.includes(segment.id)).map(segment => ({ value: String(segment.id), label: segment.name }))}
            onChange={value => { const id = Number(value); if (id) setGraph(current => ({ ...current, segmentIds: [...current.segmentIds, id] })); }} />
          {graph.segmentIds.length ? <div className="ov-tags">{graph.segmentIds.map(id => <Token key={id} size="sm"
            label={lookups.segments?.find(item => item.id === id)?.name || `Segment ${id}`}
            onRemove={() => setGraph(current => ({ ...current, segmentIds: current.segmentIds.filter(item => item !== id) }))} />)}</div> : null}
        </div>
        <div className="ov-stack-sm">
          <Selector label="Start when a lead form is sent" placeholder="Add a published lead form" value={null} hasClear isLoading={loading('forms')}
            options={publishedForms.filter(form => !graph.formIds.includes(form.id)).map(form => ({ value: String(form.id), label: form.name }))}
            onChange={value => { const id = Number(value); if (id) setGraph(current => ({ ...current, formIds: [...current.formIds, id] })); }} />
          {graph.formIds.length ? <div className="ov-tags">{graph.formIds.map(id => <Token key={id} size="sm"
            label={lookups.forms?.find(item => item.id === id)?.name || `Lead form ${id}`}
            onRemove={() => setGraph(current => ({ ...current, formIds: current.formIds.filter(item => item !== id) }))} />)}</div> : null}
        </div>
      </div>
      <Feedback error={lookupError} />

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

    {selected ? <NodeDrawer key={selected.id} graph={graph} node={selected} lookups={lookups} loading={loading} issues={issuesByNode.get(selected.id) ?? []}
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
