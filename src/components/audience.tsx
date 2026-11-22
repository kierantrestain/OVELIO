'use client';

import {
  Ban, Download, ListFilter, MailCheck, Minus, Pencil, Plus, Search, ShieldAlert, Trash2, Upload,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Field } from '@astryxdesign/core/Field';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Link } from '@astryxdesign/core/Link';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { Table, pixel } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import { Token } from '@astryxdesign/core/Token';
import type {
  BounceRecord, Company, Contact, ContactDetail, ContactNote, MailingList, Page,
  PointAction, PointTrigger, Segment, SegmentFilter, Stage, SuppressionRecord, Tag, Workflow,
} from '@/contracts';
import { api, date, number, saveFile, useAction, useFields, useResource } from './client';
import { useUser } from './shell';
import {
  AsyncState, ConfirmDialog, Empty, Feedback, FilterBar, FormActions, Modal,
  PageHeader, Pager, Panel, Rows, StatusBadge, Tabs,
} from './ui';
import type { Tone } from './ui';

const tabs = ['Contacts', 'Segments', 'Mailing lists', 'Tags & stages', 'Companies', 'Lead scoring', 'Suppressions'] as const;
type AudienceTab = typeof tabs[number];
type ImportResult = { imported: number; failed: { row: number; message: string }[] };
type BulkActionType = 'add_tag' | 'remove_tag' | 'add_segment' | 'adjust_points';
type SuppressionReason = SuppressionRecord['reason'];
type NoteType = 'general' | 'email' | 'call' | 'meeting';

const contactsPath = '/contacts';
const segmentPath = '/segments';
const listPath = '/lists';
const tagPath = '/tags';
const stagePath = '/stages';
const companyPath = '/companies';
const pointActionPath = '/point-actions';
const pointTriggerPath = '/point-triggers';
const suppressionPath = '/suppressions';
const bouncePath = '/bounces';

const csvTemplate = [
  'email,first_name,last_name,company,phone,position,city,country,website,tags,consent,evidence',
  'alex.morgan@example.com,Alex,Morgan,Northwind Studio,+44 20 7946 0192,Marketing Lead,London,United Kingdom,https://northwind.example.com,newsletter|vip,opted_in,Website signup form 2026-01-15',
  'sam.taylor@example.com,Sam,Taylor,Beacon Labs,,Product Manager,Manchester,United Kingdom,,product-updates,,',
].join('\n') + '\n';

const segmentFieldOptions = [
  { value: 'email', label: 'Email' },
  { value: 'company', label: 'Company' },
  { value: 'country', label: 'Country' },
  { value: 'city', label: 'City' },
  { value: 'points', label: 'Lead score' },
  { value: 'tags', label: 'Tags' },
];

const segmentOperatorOptions = [
  { value: 'like', label: 'Contains / matches' },
  { value: 'eq', label: 'Equals' },
  { value: 'neq', label: 'Does not equal' },
  { value: 'gt', label: 'Greater than' },
  { value: 'lt', label: 'Less than' },
  { value: 'in', label: 'In list' },
];

const fallbackPointActionTypes: Record<string, string> = {
  'email.open': 'Opens an email',
  'url.hit': 'Visits a tracked page',
  'form.submit': 'Submits a lead form',
  'asset.download': 'Downloads an asset',
  'page.hit': 'Visits a landing page',
};

const suppressionReasons: { value: SuppressionReason; label: string }[] = [
  { value: 'unsubscribe', label: 'Unsubscribe' },
  { value: 'bounce', label: 'Bounce' },
  { value: 'complaint', label: 'Complaint' },
  { value: 'erasure', label: 'Erasure' },
];

const noteTypes: { value: NoteType; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'email', label: 'Email' },
  { value: 'call', label: 'Call' },
  { value: 'meeting', label: 'Meeting' },
];

const suppressionTone: Record<SuppressionReason, [string, Tone]> = {
  unsubscribe: ['Unsubscribe', 'warning'],
  bounce: ['Bounce', 'error'],
  complaint: ['Complaint', 'error'],
  erasure: ['Erasure', 'neutral'],
};

const bounceTone: Record<string, [string, Tone]> = {
  hard: ['Hard bounce', 'error'],
  soft: ['Soft bounce', 'warning'],
  complaint: ['Complaint', 'error'],
};

const noteTone: Record<string, Tone> = {
  general: 'neutral',
  email: 'info',
  call: 'success',
  meeting: 'warning',
};

const consentLabel = {
  opted_in: ['Opted in', 'success'],
  suppressed: ['Suppressed', 'error'],
  unknown: ['Unknown', 'warning'],
} as const;

const fullName = (contact: Contact) => [contact.firstName, contact.lastName].filter(Boolean).join(' ');
const optionsOf = (items: { id: number; name: string }[] = []) => items.map(item => ({ value: String(item.id), label: item.name }));
const isSyncedList = (list: MailingList) => list.tags.some(tag => tag.startsWith('ovelio-segment-'));
const isSafeHttpUrl = (value?: string) => Boolean(value && /^https?:\/\//i.test(value.trim()));

function cleanLabel(raw: string) {
  return raw.replace(/\b(mautic|listmonk|umami)\b/gi, 'workspace').trim();
}

function prettifyKey(key: string) {
  return key
    .replace(/^(mautic|listmonk|umami)\./i, '')
    .replaceAll(/[._-]+/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase())
    .trim();
}

function resolveTab(input?: string): AudienceTab {
  if (!input) return 'Contacts';
  const exact = tabs.find(item => item === input);
  if (exact) return exact;
  const lower = input.trim().toLowerCase();
  return tabs.find(item => item.toLowerCase() === lower) ?? 'Contacts';
}

function Tags({ tags, onSelect }: { tags: string[]; onSelect?: (tag: string) => void }) {
  if (!tags.length) return <Text color="secondary">—</Text>;
  return <span className="ov-tags">
    {tags.map(tag => onSelect
      ? <Link key={tag} onClick={() => onSelect(tag)}><StatusBadge label={tag} /></Link>
      : <StatusBadge key={tag} label={tag} />)}
  </span>;
}

/* ── Contact Forms & CSV Import ────────────────────────────────────────────── */

function ContactForm({ contact, onDone, onClose }: { contact?: Contact; onDone: (contact: Contact) => void; onClose: () => void }) {
  const [optedIn, setOptedIn] = useState(false);
  const action = useAction();
  const { values, field } = useFields({
    email: contact?.email ?? '',
    firstName: contact?.firstName ?? '',
    lastName: contact?.lastName ?? '',
    company: contact?.company ?? '',
    phone: contact?.phone ?? '',
    position: contact?.position ?? '',
    city: contact?.city ?? '',
    country: contact?.country ?? '',
    website: contact?.website ?? '',
    tags: contact?.tags.join(', ') ?? '',
    evidence: '',
  });
  return <Modal title={contact ? 'Edit contact' : 'Add contact'} onClose={onClose} size="large">
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        if (!contact && optedIn && !values.evidence.trim()) throw new Error('Record the source, date and wording of consent.');
        const input = {
          email: values.email.trim(),
          firstName: values.firstName.trim(),
          lastName: values.lastName.trim(),
          company: values.company.trim(),
          phone: values.phone.trim(),
          position: values.position.trim(),
          city: values.city.trim(),
          country: values.country.trim(),
          website: values.website.trim(),
          tags: values.tags.split(',').map(tag => tag.trim()).filter(Boolean),
          ...(!contact && optedIn ? { consent: 'opted_in', evidence: values.evidence.trim() } : {}),
        };
        onDone(await api<Contact>(contact ? `${contactsPath}/${contact.id}` : contactsPath, contact ? 'PATCH' : 'POST', input));
      });
    }}>
      <TextInput label="Email address" type="email" isRequired {...field('email')} />
      <div className="ov-form-grid">
        <TextInput label="First name" isOptional {...field('firstName')} />
        <TextInput label="Last name" isOptional {...field('lastName')} />
        <TextInput label="Company" isOptional {...field('company')} />
        <TextInput label="Job title / position" isOptional {...field('position')} />
        <TextInput label="Phone" isOptional {...field('phone')} />
        <TextInput label="Website" type="url" placeholder="https://example.com" isOptional {...field('website')} />
        <TextInput label="City" isOptional {...field('city')} />
        <TextInput label="Country" isOptional {...field('country')} />
      </div>
      <TextInput label="Tags" description="Separate tags with commas." isOptional {...field('tags')} />
      {!contact ? <>
        <CheckboxInput label="This contact consented to marketing email" value={optedIn} onChange={setOptedIn} />
        {optedIn ? <TextInput label="Consent evidence" placeholder="Source, date and wording of consent" isRequired {...field('evidence')} /> : null}
      </> : null}
      <Feedback error={action.error} />
      <FormActions>
        <Button label="Cancel" onClick={onClose} />
        <Button type="submit" variant="primary" label={contact ? 'Save changes' : 'Add contact'} isLoading={action.busy} />
      </FormActions>
    </form>
  </Modal>;
}

function ImportForm({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const action = useAction();
  const [file, setFile] = useState<File>();
  const [evidence, setEvidence] = useState('');
  const [result, setResult] = useState<ImportResult>();
  return <Modal title="Import contacts" onClose={onClose}>
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        if (!file?.size) throw new Error('Choose a CSV file to import.');
        if (file.size > 1_000_000) throw new Error('Choose a CSV file smaller than 1 MB.');
        setResult(await api<ImportResult>('/contacts/import', 'POST', { csv: await file.text(), evidence: evidence.trim() || undefined }));
        onImported();
      });
    }}>
      <div className="ov-actions ov-actions--between">
        <Text type="supporting" color="secondary">Include an email column and up to 500 rows. Optional columns: first_name, last_name, company, phone, position, city, country, website, tags (separated by |), consent and evidence.</Text>
        <Button size="sm" label="Download CSV template" icon={<Download size={14} />}
          onClick={() => saveFile(csvTemplate, 'ovelio-contacts-template.csv', 'text/csv')} />
      </div>
      <Field label="CSV file" inputID="ov-import-file" isRequired>
        <input id="ov-import-file" className="ov-native-file" type="file" accept=".csv,text/csv" onChange={event => setFile(event.target.files?.[0])} />
      </Field>
      <TextInput label="Consent evidence" description="Used for opted_in rows without their own evidence. Record the source and date of consent." isOptional value={evidence} onChange={setEvidence} />
      <Feedback error={action.error} notice={result ? `${number(result.imported)} contacts imported. ${number(result.failed.length)} rows failed.` : undefined} />
      {result?.failed.length ? <Rows>{result.failed.slice(0, 25).map(item => <li key={item.row}><Text type="supporting">Row {item.row} · {item.message}</Text></li>)}</Rows> : null}
      <FormActions>
        <Button label={result ? 'Close' : 'Cancel'} onClick={onClose} />
        <Button type="submit" variant="primary" label="Import contacts" isLoading={action.busy} />
      </FormActions>
    </form>
  </Modal>;
}

/* ── Segments & Mailing Lists Modals ───────────────────────────────────────── */

type FilterRow = {
  key: number;
  glue: 'and' | 'or';
  field: string;
  operator: string;
  value: string;
};

function SegmentForm({ segment, onClose, onDone }: { segment?: Segment; onClose: () => void; onDone: () => void }) {
  const action = useAction();
  const { values, field } = useFields({ name: segment?.name ?? '', description: segment?.description ?? '' });
  const [published, setPublished] = useState(segment?.published ?? true);
  const [rules, setRules] = useState<FilterRow[]>(() =>
    (segment?.filters ?? []).map((entry, index) => ({
      key: index,
      glue: entry.glue,
      field: entry.field,
      operator: entry.operator,
      value: Array.isArray(entry.filter) ? entry.filter.join(', ') : String(entry.filter ?? ''),
    })),
  );
  const nextKey = useRef(rules.length);

  function addRule() {
    setRules(items => [...items, { key: nextKey.current++, glue: 'and', field: 'email', operator: 'like', value: '' }]);
  }

  function updateRule(ruleKey: number, patch: Partial<FilterRow>) {
    setRules(items => items.map(item => item.key === ruleKey ? { ...item, ...patch } : item));
  }

  function fieldOptionsFor(current: string) {
    return segmentFieldOptions.some(opt => opt.value === current)
      ? segmentFieldOptions
      : [...segmentFieldOptions, { value: current, label: prettifyKey(current) }];
  }

  function operatorOptionsFor(current: string) {
    return segmentOperatorOptions.some(opt => opt.value === current)
      ? segmentOperatorOptions
      : [...segmentOperatorOptions, { value: current, label: prettifyKey(current) }];
  }

  return <Modal title={segment ? 'Edit segment' : 'Create segment'} onClose={onClose} size="large">
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        const filters: SegmentFilter[] = rules.map((rule, index) => {
          const raw = rule.value.trim();
          if (!raw) throw new Error(`Enter a value for filter rule ${index + 1}.`);
          if (rule.field === 'points') {
            const numeric = Number(raw);
            if (!Number.isFinite(numeric)) throw new Error(`Enter a numeric score for filter rule ${index + 1}.`);
            return { glue: index === 0 ? 'and' : rule.glue, field: rule.field, type: 'number', operator: rule.operator, filter: numeric };
          }
          if (rule.operator === 'in' || rule.field === 'tags') {
            const list = raw.split(',').map(item => item.trim()).filter(Boolean);
            if (!list.length) throw new Error(`Enter at least one value for filter rule ${index + 1}.`);
            return {
              glue: index === 0 ? 'and' : rule.glue,
              field: rule.field,
              type: rule.field === 'tags' ? 'tags' : 'text',
              operator: rule.operator,
              filter: list,
            };
          }
          return { glue: index === 0 ? 'and' : rule.glue, field: rule.field, type: 'text', operator: rule.operator, filter: raw };
        });

        await api(segment ? `${segmentPath}/${segment.id}` : segmentPath, segment ? 'PATCH' : 'POST', {
          name: values.name.trim(),
          description: values.description.trim(),
          published,
          filters,
        });
        onDone();
      });
    }}>
      <TextInput label="Segment name" isRequired {...field('name')} />
      <TextArea label="Description" rows={2} isOptional {...field('description')} />
      <Switch label="Published" description="Published segments can sync to newsletter lists and trigger automations." value={published} onChange={setPublished} />
      <div className="ov-stack-sm">
        <div className="ov-actions ov-actions--between">
          <div>
            <Text weight="semibold">Filter rules</Text>
            <Text type="supporting" color="secondary">Automatically include contacts matching these conditions, or leave empty for manual membership.</Text>
          </div>
          {rules.length < 20 ? <Button size="sm" label="Add rule" icon={<Plus size={14} />} onClick={addRule} /> : null}
        </div>
        {rules.map((rule, index) => <div key={rule.key} className="ov-step">
          <div className="ov-step-heading">
            <Text weight="medium">Rule {index + 1}</Text>
            <IconButton variant="ghost" size="sm" label={`Remove rule ${index + 1}`} icon={<Trash2 size={15} />}
              onClick={() => setRules(items => items.filter(item => item.key !== rule.key))} />
          </div>
          <div className={index > 0 ? 'ov-form-grid' : 'ov-form-grid ov-form-grid--three'}>
            {index > 0 ? <Selector label="Match" value={rule.glue}
              options={[{ value: 'and', label: 'AND' }, { value: 'or', label: 'OR' }]}
              onChange={value => updateRule(rule.key, { glue: value === 'or' ? 'or' : 'and' })} /> : null}
            <Selector label="Field" value={rule.field} options={fieldOptionsFor(rule.field)}
              onChange={value => updateRule(rule.key, { field: value ?? 'email' })} />
            <Selector label="Operator" value={rule.operator} options={operatorOptionsFor(rule.operator)}
              onChange={value => updateRule(rule.key, { operator: value ?? 'like' })} />
            <TextInput label="Value" isRequired value={rule.value}
              placeholder={rule.field === 'points' ? 'e.g. 50' : rule.operator === 'in' || rule.field === 'tags' ? 'Comma-separated values' : 'Filter value'}
              onChange={value => updateRule(rule.key, { value })} />
          </div>
        </div>)}
      </div>
      <Feedback error={action.error} />
      <FormActions>
        <Button label="Cancel" onClick={onClose} />
        <Button type="submit" variant="primary" label={segment ? 'Save segment' : 'Create segment'} isLoading={action.busy} isDisabled={!values.name.trim()} />
      </FormActions>
    </form>
  </Modal>;
}

function MailingListForm({ list, onClose, onDone }: { list?: MailingList; onClose: () => void; onDone: () => void }) {
  const action = useAction();
  const internalTags = list?.tags.filter(tag => tag.startsWith('ovelio-segment-')) ?? [];
  const editableTags = list?.tags.filter(tag => !tag.startsWith('ovelio-segment-')) ?? [];
  const { values, field } = useFields({
    name: list?.name ?? '',
    description: list?.description ?? '',
    tags: editableTags.join(', '),
  });
  const [type, setType] = useState<'private' | 'public'>(list?.type === 'public' ? 'public' : 'private');
  const [optin, setOptin] = useState<'double' | 'single'>(list?.optin === 'single' ? 'single' : 'double');

  return <Modal title={list ? 'Edit mailing list' : 'Create mailing list'} onClose={onClose}>
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        const userTags = values.tags.split(',').map(tag => tag.trim()).filter(Boolean);
        const mergedTags = [...new Set([...internalTags, ...userTags])];
        await api(list ? `${listPath}/${list.id}` : listPath, list ? 'PATCH' : 'POST', {
          name: values.name.trim(),
          description: values.description.trim(),
          type,
          optin,
          tags: mergedTags,
        });
        onDone();
      });
    }}>
      <TextInput label="List name" isRequired {...field('name')} />
      <TextArea label="Description" rows={2} isOptional {...field('description')} />
      <div className="ov-form-grid">
        <Selector label="Visibility" value={type}
          options={[
            { value: 'private', label: 'Private', description: 'Only team members can manage membership' },
            { value: 'public', label: 'Public', description: 'Visible on public subscription pages' },
          ]}
          onChange={value => setType(value === 'public' ? 'public' : 'private')} />
        <Selector label="Opt-in mode" value={optin}
          options={[
            { value: 'double', label: 'Double opt-in', description: 'Requires email confirmation' },
            { value: 'single', label: 'Single opt-in', description: 'Subscribes immediately' },
          ]}
          onChange={value => setOptin(value === 'single' ? 'single' : 'double')} />
      </div>
      <TextInput label="Tags" description="Separate tags with commas." isOptional {...field('tags')} />
      <Feedback error={action.error} />
      <FormActions>
        <Button label="Cancel" onClick={onClose} />
        <Button type="submit" variant="primary" label={list ? 'Save mailing list' : 'Create mailing list'} isLoading={action.busy} isDisabled={!values.name.trim()} />
      </FormActions>
    </form>
  </Modal>;
}

/* ── Tags, Stages, Companies, Scoring & Suppression Modals ─────────────────── */

function TagForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const action = useAction();
  const { values, field } = useFields({ tag: '', description: '' });
  return <Modal title="Create tag" onClose={onClose}>
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        const clean = values.tag.trim();
        if (clean.startsWith('-')) throw new Error('A tag cannot start with a hyphen.');
        await api(tagPath, 'POST', { tag: clean, description: values.description.trim() || undefined });
        onDone();
      });
    }}>
      <TextInput label="Tag name" description="Cannot start with a hyphen." isRequired {...field('tag')} />
      <TextArea label="Description" rows={2} isOptional {...field('description')} />
      <Feedback error={action.error} />
      <FormActions>
        <Button label="Cancel" onClick={onClose} />
        <Button type="submit" variant="primary" label="Create tag" isLoading={action.busy} isDisabled={!values.tag.trim()} />
      </FormActions>
    </form>
  </Modal>;
}

function StageForm({ stage, onClose, onDone }: { stage?: Stage; onClose: () => void; onDone: () => void }) {
  const action = useAction();
  const { values, field } = useFields({ name: stage?.name ?? '', description: stage?.description ?? '' });
  const [weight, setWeight] = useState(stage?.weight ?? 10);
  const [published, setPublished] = useState(stage?.published ?? true);
  return <Modal title={stage ? 'Edit lifecycle stage' : 'Create lifecycle stage'} onClose={onClose}>
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        await api(stage ? `${stagePath}/${stage.id}` : stagePath, stage ? 'PATCH' : 'POST', {
          name: values.name.trim(),
          description: values.description.trim(),
          weight,
          published,
        });
        onDone();
      });
    }}>
      <div className="ov-form-grid">
        <TextInput label="Stage name" isRequired {...field('name')} />
        <NumberInput label="Weight" description="Higher weight indicates further progression." min={0} max={10000} isIntegerOnly value={weight} onChange={setWeight} />
      </div>
      <TextArea label="Description" rows={2} isOptional {...field('description')} />
      <Switch label="Published" value={published} onChange={setPublished} />
      <Feedback error={action.error} />
      <FormActions>
        <Button label="Cancel" onClick={onClose} />
        <Button type="submit" variant="primary" label={stage ? 'Save stage' : 'Create stage'} isLoading={action.busy} isDisabled={!values.name.trim()} />
      </FormActions>
    </form>
  </Modal>;
}

const companyIndustries = [
  'Aerospace & Defense', 'Agriculture', 'Apparel', 'Automotive & Assembly', 'Banking', 'Biotechnology',
  'Chemicals', 'Communications', 'Construction', 'Consumer Packaged Goods', 'Education', 'Electronics',
  'Energy', 'Engineering', 'Entertainment', 'Environmental', 'Finance', 'Food & Beverage', 'Government',
  'Healthcare', 'Hospitality', 'Insurance', 'Machinery', 'Manufacturing', 'Media', 'Metals & Mining',
  'Not for Profit', 'Oil & Gas', 'Packaging & Paper', 'Private Equity & Principal Investors', 'Recreation',
  'Real Estate', 'Retail', 'Semiconductors', 'Shipping', 'Social Sector', 'Technology', 'Telecommunications',
  'Transportation', 'Utilities', 'Other',
].map(value => ({ value, label: value }));

function CompanyForm({ company, onClose, onDone }: { company?: Company; onClose: () => void; onDone: () => void }) {
  const action = useAction();
  const [industry, setIndustry] = useState<string | null>(company?.industry || null);
  const { values, field } = useFields({
    name: company?.name ?? '',
    email: company?.email ?? '',
    website: company?.website ?? '',
    city: company?.city ?? '',
    country: company?.country ?? '',
  });
  return <Modal title={company ? 'Edit company' : 'Add company'} onClose={onClose} size="large">
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        await api(company ? `${companyPath}/${company.id}` : companyPath, company ? 'PATCH' : 'POST', {
          name: values.name.trim(),
          email: values.email.trim(),
          website: values.website.trim(),
          industry: industry ?? '',
          city: values.city.trim(),
          country: values.country.trim(),
        });
        onDone();
      });
    }}>
      <div className="ov-form-grid">
        <TextInput label="Company name" isRequired {...field('name')} />
        <Selector label="Industry" placeholder="Select an industry" isOptional value={industry} hasClear
          onChange={setIndustry} options={companyIndustries} />
        <TextInput label="Contact email" type="email" isOptional {...field('email')} />
        <TextInput label="Website" type="url" placeholder="https://example.com" isOptional {...field('website')} />
        <TextInput label="City" isOptional {...field('city')} />
        <TextInput label="Country" isOptional {...field('country')} />
      </div>
      <Feedback error={action.error} />
      <FormActions>
        <Button label="Cancel" onClick={onClose} />
        <Button type="submit" variant="primary" label={company ? 'Save company' : 'Add company'} isLoading={action.busy} isDisabled={!values.name.trim()} />
      </FormActions>
    </form>
  </Modal>;
}

function PointActionForm({
  rule, typeMap, onClose, onDone,
}: { rule?: PointAction; typeMap: Record<string, string>; onClose: () => void; onDone: () => void }) {
  const action = useAction();
  const mergedTypes = Object.keys(typeMap).length ? typeMap : fallbackPointActionTypes;
  const options = Object.entries(mergedTypes).map(([value, label]) => ({ value, label: cleanLabel(label) || prettifyKey(value) }));
  if (rule?.type && !options.some(option => option.value === rule.type)) {
    options.push({ value: rule.type, label: prettifyKey(rule.type) });
  }
  const { values, field } = useFields({ name: rule?.name ?? '', description: rule?.description ?? '' });
  const [type, setType] = useState<string>(rule?.type || options[0]?.value || 'email.open');
  const [delta, setDelta] = useState(rule?.delta ?? 10);
  const [published, setPublished] = useState(rule?.published ?? true);

  return <Modal title={rule ? 'Edit scoring rule' : 'Create scoring rule'} onClose={onClose}>
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        await api(rule ? `${pointActionPath}/${rule.id}` : pointActionPath, rule ? 'PATCH' : 'POST', {
          name: values.name.trim(),
          description: values.description.trim(),
          type,
          delta,
          published,
        });
        onDone();
      });
    }}>
      <TextInput label="Rule name" isRequired {...field('name')} />
      <div className="ov-form-grid">
        <Selector label="Action type" value={type} options={options} onChange={value => setType(value ?? options[0]?.value ?? 'email.open')} />
        <NumberInput label="Points delta" description="Positive to add, negative to deduct." min={-10000} max={10000} isIntegerOnly value={delta} onChange={setDelta} />
      </div>
      <TextArea label="Description" rows={2} isOptional {...field('description')} />
      <Switch label="Published" value={published} onChange={setPublished} />
      <Feedback error={action.error} />
      <FormActions>
        <Button label="Cancel" onClick={onClose} />
        <Button type="submit" variant="primary" label={rule ? 'Save rule' : 'Create rule'} isLoading={action.busy} isDisabled={!values.name.trim() || !type} />
      </FormActions>
    </form>
  </Modal>;
}

function PointTriggerForm({ trigger, onClose, onDone }: { trigger?: PointTrigger; onClose: () => void; onDone: () => void }) {
  const action = useAction();
  const { values, field } = useFields({ name: trigger?.name ?? '', description: trigger?.description ?? '' });
  const [points, setPoints] = useState(trigger?.points ?? 50);
  const [published, setPublished] = useState(trigger?.published ?? true);
  const [triggerExistingLeads, setTriggerExistingLeads] = useState(trigger?.triggerExistingLeads ?? false);

  return <Modal title={trigger ? 'Edit score trigger' : 'Create score trigger'} onClose={onClose}>
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        await api(trigger ? `${pointTriggerPath}/${trigger.id}` : pointTriggerPath, trigger ? 'PATCH' : 'POST', {
          name: values.name.trim(),
          description: values.description.trim(),
          points,
          published,
          triggerExistingLeads,
        });
        onDone();
      });
    }}>
      <div className="ov-form-grid">
        <TextInput label="Trigger name" isRequired {...field('name')} />
        <NumberInput label="Point threshold" min={1} max={100000} isIntegerOnly value={points} onChange={setPoints} />
      </div>
      <TextArea label="Description" rows={2} isOptional {...field('description')} />
      <CheckboxInput label="Trigger for existing contacts who already meet this score" value={triggerExistingLeads} onChange={setTriggerExistingLeads} />
      <Switch label="Published" value={published} onChange={setPublished} />
      <Feedback error={action.error} />
      <FormActions>
        <Button label="Cancel" onClick={onClose} />
        <Button type="submit" variant="primary" label={trigger ? 'Save trigger' : 'Create trigger'} isLoading={action.busy} isDisabled={!values.name.trim() || points < 1} />
      </FormActions>
    </form>
  </Modal>;
}

function SuppressAddressForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const action = useAction();
  const { values, field } = useFields({ email: '', evidence: '' });
  const [reason, setReason] = useState<SuppressionReason>('unsubscribe');
  return <Modal title="Suppress email address" onClose={onClose}>
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        await api(suppressionPath, 'POST', {
          email: values.email.trim(),
          reason,
          evidence: values.evidence.trim(),
        });
        onDone();
      });
    }}>
      <Text type="supporting" color="secondary">Suppressed addresses are blocked from receiving newsletters and automation emails.</Text>
      <TextInput label="Email address" type="email" isRequired {...field('email')} />
      <Selector label="Reason" value={reason} options={suppressionReasons}
        onChange={value => setReason((value as SuppressionReason) || 'unsubscribe')} />
      <TextInput label="Evidence" placeholder="Source, date and request details" isRequired {...field('evidence')} />
      <Feedback error={action.error} />
      <FormActions>
        <Button label="Cancel" onClick={onClose} />
        <Button type="submit" variant="destructive" label="Suppress address" isLoading={action.busy} isDisabled={!values.email.trim() || !values.evidence.trim()} />
      </FormActions>
    </form>
  </Modal>;
}

/* ── Main Audience Page Component ──────────────────────────────────────────── */

type ConfirmState = {
  title: string;
  description: string;
  actionLabel: string;
  destructive?: boolean;
  onConfirm: () => Promise<void>;
};

export function Audience({ initialTab }: { initialTab?: string }) {
  const user = useUser();
  const router = useRouter();
  const [tab, setTab] = useState<AudienceTab>(() => resolveTab(initialTab));
  const [notice, setNotice] = useState('');
  const action = useAction();

  // Contacts state
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [segmentId, setSegmentId] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkAction, setBulkAction] = useState<BulkActionType>('add_tag');
  const [bulkTag, setBulkTag] = useState('');
  const [bulkSegmentId, setBulkSegmentId] = useState<string | null>(null);
  const [bulkPoints, setBulkPoints] = useState(10);

  // Companies & Bounces state
  const [companyQuery, setCompanyQuery] = useState('');
  const [companySearch, setCompanySearch] = useState('');
  const [bouncePage, setBouncePage] = useState(1);

  // Modals
  const [contactModal, setContactModal] = useState(false);
  const [importModal, setImportModal] = useState(false);
  const [segmentModal, setSegmentModal] = useState<'new' | Segment>();
  const [listModal, setListModal] = useState<'new' | MailingList>();
  const [tagModal, setTagModal] = useState(false);
  const [stageModal, setStageModal] = useState<'new' | Stage>();
  const [companyModal, setCompanyModal] = useState<'new' | Company>();
  const [pointActionModal, setPointActionModal] = useState<'new' | PointAction>();
  const [pointTriggerModal, setPointTriggerModal] = useState<'new' | PointTrigger>();
  const [suppressModal, setSuppressModal] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState>();

  // Resources
  const contacts = useResource<Page<Contact>>(tab === 'Contacts' ? `${contactsPath}?${new URLSearchParams({
    page: String(page),
    ...(search ? { q: search } : {}),
    ...(segmentId ? { segmentId } : {}),
    ...(tagFilter ? { tag: tagFilter } : {}),
  })}` : null);
  const segments = useResource<Segment[]>(tab === 'Contacts' || tab === 'Segments' ? segmentPath : null);
  const lists = useResource<MailingList[]>(tab === 'Mailing lists' ? listPath : null);
  const tags = useResource<Tag[]>(tab === 'Contacts' || tab === 'Tags & stages' ? tagPath : null);
  const stages = useResource<Stage[]>(tab === 'Tags & stages' ? stagePath : null);
  const companies = useResource<Company[]>(tab === 'Companies' ? (companySearch ? `${companyPath}?${new URLSearchParams({ q: companySearch })}` : companyPath) : null);
  const pointActions = useResource<PointAction[]>(tab === 'Lead scoring' ? pointActionPath : null);
  const pointActionTypes = useResource<Record<string, string>>(tab === 'Lead scoring' ? `${pointActionPath}/types` : null);
  const pointTriggers = useResource<PointTrigger[]>(tab === 'Lead scoring' ? pointTriggerPath : null);
  const suppressions = useResource<SuppressionRecord[]>(tab === 'Suppressions' ? suppressionPath : null);
  const bounces = useResource<Page<BounceRecord>>(tab === 'Suppressions' ? `${bouncePath}?page=${bouncePage}` : null);

  const filtered = !!(search || segmentId || tagFilter);
  const pageContactIds = contacts.data?.items.map(item => item.id) ?? [];
  const allPageSelected = pageContactIds.length > 0 && pageContactIds.every(id => selectedIds.includes(id));
  const somePageSelected = pageContactIds.some(id => selectedIds.includes(id));

  const activeFilters: { key: string; label: string }[] = [
    ...(search ? [{ key: 'search', label: `Search: ${search}` }] : []),
    ...(segmentId ? [{ key: 'segment', label: `Segment: ${segments.data?.find(s => String(s.id) === segmentId)?.name ?? segmentId}` }] : []),
    ...(tagFilter ? [{ key: 'tag', label: `Tag: ${tagFilter}` }] : []),
  ];

  function clearContactFilters() {
    setSearch('');
    setQuery('');
    setSegmentId('');
    setTagFilter('');
    setPage(1);
    setSelectedIds([]);
  }

  function removeContactFilter(key: string) {
    if (key === 'search') { setSearch(''); setQuery(''); }
    if (key === 'segment') setSegmentId('');
    if (key === 'tag') setTagFilter('');
    setPage(1);
    setSelectedIds([]);
  }

  const bulkReady = selectedIds.length > 0 && (
    bulkAction === 'add_tag' || bulkAction === 'remove_tag' ? Boolean(bulkTag.trim())
      : bulkAction === 'add_segment' ? Boolean(bulkSegmentId)
        : Number.isInteger(bulkPoints) && bulkPoints !== 0
  );

  function applyBulkAction() {
    if (!bulkReady) return;
    void action.run(async () => {
      const payload = {
        ids: selectedIds,
        action: bulkAction,
        ...(bulkAction === 'add_tag' || bulkAction === 'remove_tag' ? { tag: bulkTag.trim() } : {}),
        ...(bulkAction === 'add_segment' ? { segmentId: Number(bulkSegmentId) } : {}),
        ...(bulkAction === 'adjust_points' ? { points: bulkPoints } : {}),
      };
      const result = await api<{ updated: number }>(`${contactsPath}/bulk`, 'POST', payload);
      setSelectedIds([]);
      setBulkTag('');
      setBulkSegmentId(null);
      contacts.refresh();
      if (bulkAction === 'add_tag') tags.refresh();
      setNotice(`Updated ${number(result.updated)} contact${result.updated === 1 ? '' : 's'}.`);
    });
  }

  const actionTypeLabels = pointActionTypes.data && Object.keys(pointActionTypes.data).length
    ? pointActionTypes.data
    : fallbackPointActionTypes;

  const headerActions = (() => {
    switch (tab) {
      case 'Contacts':
        return <>
          {user.role === 'admin' ? <Button label="Export CSV" icon={<Download size={15} />} isLoading={action.busy}
            onClick={() => void action.run(async () => saveFile(await api<string>('/contacts/export'), 'ovelio-contacts.csv', 'text/csv'))} /> : null}
          <Button label="Import CSV" icon={<Upload size={15} />} onClick={() => setImportModal(true)} />
          <Button label="Add contact" variant="primary" icon={<Plus size={16} />} onClick={() => setContactModal(true)} />
        </>;
      case 'Segments':
        return <Button variant="primary" icon={<Plus size={16} />} label="Create segment" onClick={() => setSegmentModal('new')} />;
      case 'Mailing lists':
        return <Button variant="primary" icon={<Plus size={16} />} label="Create mailing list" onClick={() => setListModal('new')} />;
      case 'Tags & stages':
        return <>
          <Button icon={<Plus size={15} />} label="Create tag" onClick={() => setTagModal(true)} />
          <Button variant="primary" icon={<Plus size={16} />} label="Create stage" onClick={() => setStageModal('new')} />
        </>;
      case 'Companies':
        return <Button variant="primary" icon={<Plus size={16} />} label="Add company" onClick={() => setCompanyModal('new')} />;
      case 'Lead scoring':
        return <>
          <Button icon={<Plus size={15} />} label="Create trigger" onClick={() => setPointTriggerModal('new')} />
          <Button variant="primary" icon={<Plus size={16} />} label="Create scoring rule" onClick={() => setPointActionModal('new')} />
        </>;
      case 'Suppressions':
        return <Button variant="primary" icon={<ShieldAlert size={15} />} label="Suppress address" onClick={() => setSuppressModal(true)} />;
    }
  })();

  return <>
    <PageHeader title="Audience" description="Manage contacts, segmentation, scoring and email permissions." actions={headerActions} />
    <Tabs label="Audience view" items={tabs} value={tab} onChange={value => { setTab(value); setNotice(''); setSelectedIds([]); }} />
    <Feedback error={action.error} notice={notice || action.notice} />

    {tab === 'Contacts' ? <Panel title="Contact directory" description={contacts.data ? `${number(contacts.data.total)} contacts` : undefined}>
      <div className="ov-toolbar">
        <form onSubmit={event => { event.preventDefault(); setSearch(query.trim()); setPage(1); setSelectedIds([]); }}>
          <TextInput label="Search contacts" isLabelHidden type="search" startIcon="search" placeholder="Name or email" value={query} onChange={setQuery} width={260} />
          <Button type="submit" label="Search" icon={<Search size={15} />} />
        </form>
        <div className="ov-actions">
          <Selector label="Segment filter" isLabelHidden width={210} value={segmentId || 'all'}
            options={[{ value: 'all', label: 'All segments' }, ...optionsOf(segments.data)]}
            onChange={value => { setSegmentId(value && value !== 'all' ? value : ''); setPage(1); setSelectedIds([]); }} />
          <Selector label="Tag filter" isLabelHidden width={190} value={tagFilter || 'all'}
            options={[{ value: 'all', label: 'All tags' }, ...(tags.data ?? []).map(item => ({ value: item.tag, label: item.tag }))]}
            onChange={value => { setTagFilter(value && value !== 'all' ? value : ''); setPage(1); setSelectedIds([]); }} />
          {filtered ? <Button size="sm" variant="ghost" label="Clear filters" onClick={clearContactFilters} /> : null}
        </div>
      </div>

      <FilterBar items={activeFilters} onRemove={removeContactFilter} onClear={clearContactFilters} />

      {selectedIds.length ? <div className="ov-filter-bar" role="region" aria-label="Bulk contact actions">
        <Text weight="semibold">{number(selectedIds.length)} selected</Text>
        <Selector label="Bulk action" isLabelHidden width={175} value={bulkAction}
          options={[
            { value: 'add_tag', label: 'Add tag' },
            { value: 'remove_tag', label: 'Remove tag' },
            { value: 'add_segment', label: 'Add to segment' },
            { value: 'adjust_points', label: 'Adjust score' },
          ]}
          onChange={value => setBulkAction((value as BulkActionType) || 'add_tag')} />
        {bulkAction === 'add_tag' || bulkAction === 'remove_tag' ? (
          <TextInput label="Tag name" isLabelHidden placeholder="Tag name" value={bulkTag} onChange={setBulkTag} width={180} />
        ) : bulkAction === 'add_segment' ? (
          <Selector label="Target segment" isLabelHidden placeholder="Select segment" value={bulkSegmentId} hasClear
            onChange={setBulkSegmentId} options={optionsOf(segments.data)} width={200} />
        ) : (
          <NumberInput label="Points delta" isLabelHidden min={-10000} max={10000} isIntegerOnly value={bulkPoints} onChange={setBulkPoints} width={130} />
        )}
        <Button size="sm" variant="primary" label="Apply" isLoading={action.busy} isDisabled={!bulkReady} onClick={applyBulkAction} />
        <Button size="sm" variant="ghost" label="Clear selection" onClick={() => setSelectedIds([])} />
      </div> : null}

      {!contacts.data ? <AsyncState loading={contacts.loading} error={contacts.error} retry={contacts.refresh} /> : <>
        <Table data={contacts.data.items} idKey="id" hasHover
          emptyState={<Empty title={filtered ? 'No contacts match these filters' : 'No contacts yet'}
            description={filtered ? undefined : 'Add a contact or import a CSV to build your audience.'}
            action={filtered ? <Button label="Clear filters" onClick={clearContactFilters} /> : undefined} />}
          columns={[
            {
              key: 'select',
              width: pixel(44),
              header: <CheckboxInput label="Select all contacts on this page" isLabelHidden size="sm"
                value={allPageSelected ? true : somePageSelected ? 'indeterminate' : false}
                onChange={checked => setSelectedIds(checked ? pageContactIds : [])} />,
              renderCell: contact => <CheckboxInput label={`Select ${contact.email || `contact ${contact.id}`}`} isLabelHidden size="sm"
                value={selectedIds.includes(contact.id)}
                onChange={checked => setSelectedIds(current => checked ? [...new Set([...current, contact.id])] : current.filter(id => id !== contact.id))} />,
            },
            {
              key: 'email',
              header: 'Contact',
              renderCell: contact => <span className="ov-cell ov-cell--nowrap">
                <Link href={`/audience/${contact.id}`}>{fullName(contact) || contact.email || `Contact ${contact.id}`}</Link>
                {fullName(contact) && contact.email ? <Text type="supporting" color="secondary">{contact.email}</Text> : null}
              </span>,
            },
            {
              key: 'company',
              header: 'Company',
              renderCell: contact => contact.company || contact.position ? <span className="ov-cell">
                <Text>{contact.company || '—'}</Text>
                {contact.position ? <Text type="supporting" color="secondary">{contact.position}</Text> : null}
              </span> : '—',
            },
            {
              key: 'stageName',
              header: 'Stage',
              renderCell: contact => contact.stageName ? <StatusBadge label={contact.stageName} tone="info" /> : <Text color="secondary">—</Text>,
            },
            { key: 'points', header: 'Score', align: 'end', renderCell: contact => number(contact.points) },
            {
              key: 'tags',
              header: 'Tags',
              renderCell: contact => <Tags tags={contact.tags} onSelect={selected => { setTagFilter(selected); setPage(1); setSelectedIds([]); }} />,
            },
            { key: 'suppressed', header: 'Delivery', renderCell: contact => contact.suppressed ? <StatusBadge label="Suppressed" tone="error" /> : <Text color="secondary">—</Text> },
            { key: 'createdAt', header: 'Added', renderCell: contact => date(contact.createdAt) },
          ]} />
        <Pager {...contacts.data} onPage={next => { setPage(next); setSelectedIds([]); }} />
      </>}
    </Panel> : null}

    {tab === 'Segments' ? <Panel title="Segments" description="Build dynamic or manual groups for automations and synchronise opted-in members for newsletters.">
      {!segments.data ? <AsyncState loading={segments.loading} error={segments.error} retry={segments.refresh} />
        : <Table data={segments.data} idKey="id" hasHover emptyState={<Empty title="No segments yet" description="Create a segment to target automations and newsletters." />}
          columns={[
            {
              key: 'name',
              header: 'Name',
              renderCell: group => <span className="ov-cell">
                <Link onClick={() => { setTab('Contacts'); setSegmentId(String(group.id)); setPage(1); setSelectedIds([]); }}>{group.name}</Link>
                {group.description ? <Text type="supporting" color="secondary">{group.description}</Text> : null}
              </span>,
            },
            {
              key: 'filters',
              header: 'Rules',
              renderCell: group => {
                const count = group.filters?.length ?? 0;
                return count ? <StatusBadge label={`${number(count)} rule${count === 1 ? '' : 's'}`} tone="info" /> : <StatusBadge label="Manual" />;
              },
            },
            { key: 'published', header: 'Status', renderCell: group => <StatusBadge label={group.published ? 'Published' : 'Draft'} tone={group.published ? 'success' : 'neutral'} /> },
            {
              key: 'alias',
              header: 'Actions',
              align: 'end',
              renderCell: group => <span className="ov-actions ov-actions--end">
                <Button size="sm" label="Sync subscribers" icon={<ListFilter size={14} />} isDisabled={action.busy || !group.published}
                  tooltip={!group.published ? 'Publish this segment before synchronising it.' : undefined}
                  onClick={() => void action.run(async () => { await api(`${segmentPath}/${group.id}/sync`, 'POST'); setNotice(''); }, `Sync queued for ${group.name}.`)} />
                <Button size="sm" variant="ghost" label="Edit" icon={<Pencil size={14} />} onClick={() => setSegmentModal(group)} />
                <IconButton size="sm" variant="ghost" label={`Delete ${group.name}`} icon={<Trash2 size={14} />}
                  onClick={() => setConfirmState({
                    title: `Delete segment “${group.name}”`,
                    description: 'Contacts themselves are not deleted, but segment membership and newsletter sync links will be removed.',
                    actionLabel: 'Delete segment',
                    onConfirm: async () => {
                      await api(`${segmentPath}/${group.id}`, 'DELETE');
                      segments.refresh();
                      setNotice('Segment deleted.');
                    },
                  })} />
              </span>,
            },
          ]} />}
    </Panel> : null}

    {tab === 'Mailing lists' ? <Panel title="Mailing lists" description="Subscriber groups available for newsletters.">
      {!lists.data ? <AsyncState loading={lists.loading} error={lists.error} retry={lists.refresh} />
        : <Table data={lists.data} idKey="id" hasHover emptyState={<Empty title="No mailing lists yet" description="Sync a segment or create a list for manual subscriptions." />}
          columns={[
            {
              key: 'name',
              header: 'Name',
              renderCell: list => <span className="ov-cell">
                <Text weight="medium">{list.name}</Text>
                {list.description ? <Text type="supporting" color="secondary">{list.description}</Text> : null}
              </span>,
            },
            {
              key: 'optin',
              header: 'Opt-in & type',
              renderCell: list => <Text type="supporting" color="secondary">
                {`${list.optin === 'single' ? 'Single' : 'Double'} opt-in · ${list.type === 'public' ? 'Public' : 'Private'}`}
              </Text>,
            },
            { key: 'subscriberCount', header: 'Subscribers', align: 'end', renderCell: list => number(list.subscriberCount) },
            {
              key: 'tags',
              header: 'Source',
              renderCell: list => isSyncedList(list) ? <StatusBadge label="Synced segment" tone="info" /> : <StatusBadge label="Manual" />,
            },
            {
              key: 'id',
              header: 'Actions',
              align: 'end',
              renderCell: list => {
                const synced = isSyncedList(list);
                return <span className="ov-actions ov-actions--end">
                  <Button size="sm" variant="ghost" label="Edit" icon={<Pencil size={14} />} onClick={() => setListModal(list)} />
                  <Button size="sm" variant="ghost" label="Delete" icon={<Trash2 size={14} />} isDisabled={synced || action.busy}
                    tooltip={synced ? 'Linked to an audience segment. Delete the segment instead.' : undefined}
                    onClick={() => setConfirmState({
                      title: `Delete mailing list “${list.name}”`,
                      description: 'This removes the mailing list. Existing contact records remain in Audience.',
                      actionLabel: 'Delete list',
                      onConfirm: async () => {
                        await api(`${listPath}/${list.id}`, 'DELETE');
                        lists.refresh();
                        setNotice('Mailing list deleted.');
                      },
                    })} />
                </span>;
              },
            },
          ]} />}
    </Panel> : null}

    {tab === 'Tags & stages' ? <div className="ov-grid">
      <Panel title="Tags" description="Label contacts and click any tag to filter the directory."
        action={<Button size="sm" variant="primary" icon={<Plus size={14} />} label="Add tag" onClick={() => setTagModal(true)} />}>
        {!tags.data ? <AsyncState loading={tags.loading} error={tags.error} retry={tags.refresh} />
          : tags.data.length ? <Rows>{tags.data.map(item => <li key={item.id}>
            <span>
              <Link onClick={() => { setTab('Contacts'); setTagFilter(item.tag); setPage(1); setSelectedIds([]); }}>
                <Token label={item.tag} color="blue" size="sm" />
              </Link>
              {item.description ? <Text type="supporting" color="secondary">{item.description}</Text> : null}
            </span>
            <IconButton size="sm" variant="ghost" label={`Delete tag ${item.tag}`} icon={<Trash2 size={14} />}
              onClick={() => setConfirmState({
                title: `Delete tag “${item.tag}”`,
                description: 'This removes the tag from your workspace.',
                actionLabel: 'Delete tag',
                onConfirm: async () => {
                  await api(`${tagPath}/${item.id}`, 'DELETE');
                  tags.refresh();
                  setNotice('Tag deleted.');
                },
              })} />
          </li>)}</Rows> : <Empty title="No tags yet" description="Create tags to classify contacts and drive segmentation." />}
      </Panel>

      <Panel title="Lifecycle stages" description="Track contact progression from new lead to customer."
        action={<Button size="sm" variant="primary" icon={<Plus size={14} />} label="Add stage" onClick={() => setStageModal('new')} />}>
        {!stages.data ? <AsyncState loading={stages.loading} error={stages.error} retry={stages.refresh} />
          : <Table data={stages.data} idKey="id" hasHover emptyState={<Empty title="No lifecycle stages yet" description="Define stages such as Subscriber, Qualified Lead and Customer." />}
            columns={[
              {
                key: 'name',
                header: 'Stage',
                renderCell: stage => <span className="ov-cell">
                  <Text weight="medium">{stage.name}</Text>
                  {stage.description ? <Text type="supporting" color="secondary">{stage.description}</Text> : null}
                </span>,
              },
              { key: 'weight', header: 'Weight', align: 'end', renderCell: stage => number(stage.weight) },
              { key: 'published', header: 'Status', renderCell: stage => <StatusBadge label={stage.published ? 'Published' : 'Draft'} tone={stage.published ? 'success' : 'neutral'} /> },
              {
                key: 'id',
                header: 'Actions',
                align: 'end',
                renderCell: stage => <span className="ov-actions ov-actions--end">
                  <IconButton size="sm" variant="ghost" label={`Edit ${stage.name}`} icon={<Pencil size={14} />} onClick={() => setStageModal(stage)} />
                  <IconButton size="sm" variant="ghost" label={`Delete ${stage.name}`} icon={<Trash2 size={14} />}
                    onClick={() => setConfirmState({
                      title: `Delete stage “${stage.name}”`,
                      description: 'This removes the lifecycle stage from your workspace.',
                      actionLabel: 'Delete stage',
                      onConfirm: async () => {
                        await api(`${stagePath}/${stage.id}`, 'DELETE');
                        stages.refresh();
                        setNotice('Lifecycle stage deleted.');
                      },
                    })} />
                </span>,
              },
            ]} />}
      </Panel>
    </div> : null}

    {tab === 'Companies' ? <Panel title="Companies" description="B2B organisations associated with your contacts.">
      <div className="ov-toolbar">
        <form onSubmit={event => { event.preventDefault(); setCompanySearch(companyQuery.trim()); }}>
          <TextInput label="Search companies" isLabelHidden type="search" startIcon="search" placeholder="Company name" value={companyQuery} onChange={setCompanyQuery} width={280} />
          <Button type="submit" label="Search" icon={<Search size={15} />} />
          {companySearch ? <Button variant="ghost" label="Clear" onClick={() => { setCompanyQuery(''); setCompanySearch(''); }} /> : null}
        </form>
      </div>
      {!companies.data ? <AsyncState loading={companies.loading} error={companies.error} retry={companies.refresh} />
        : <Table data={companies.data} idKey="id" hasHover
          emptyState={<Empty title={companySearch ? 'No companies match this search' : 'No companies yet'}
            description={companySearch ? undefined : 'Add organisations to group B2B accounts.'} />}
          columns={[
            {
              key: 'name',
              header: 'Company',
              renderCell: item => <span className="ov-cell">
                <Text weight="medium">{item.name}</Text>
                {item.industry ? <Text type="supporting" color="secondary">{item.industry}</Text> : null}
              </span>,
            },
            {
              key: 'email',
              header: 'Contact & web',
              renderCell: item => item.email || item.website ? <span className="ov-cell">
                {item.email ? <Text>{item.email}</Text> : null}
                {isSafeHttpUrl(item.website) ? <Link href={item.website} isExternalLink type="supporting">{item.website}</Link>
                  : item.website ? <Text type="supporting" color="secondary">{item.website}</Text> : null}
              </span> : '—',
            },
            {
              key: 'city',
              header: 'Location',
              renderCell: item => [item.city, item.country].filter(Boolean).join(', ') || '—',
            },
            { key: 'score', header: 'Score', align: 'end', renderCell: item => number(item.score) },
            {
              key: 'id',
              header: 'Actions',
              align: 'end',
              renderCell: item => <span className="ov-actions ov-actions--end">
                <Button size="sm" variant="ghost" label="Edit" icon={<Pencil size={14} />} onClick={() => setCompanyModal(item)} />
                <IconButton size="sm" variant="ghost" label={`Delete ${item.name}`} icon={<Trash2 size={14} />}
                  onClick={() => setConfirmState({
                    title: `Delete company “${item.name}”`,
                    description: 'This deletes the company profile. Associated contacts are kept.',
                    actionLabel: 'Delete company',
                    onConfirm: async () => {
                      await api(`${companyPath}/${item.id}`, 'DELETE');
                      companies.refresh();
                      setNotice('Company deleted.');
                    },
                  })} />
              </span>,
            },
          ]} />}
    </Panel> : null}

    {tab === 'Lead scoring' ? <div className="ov-stack">
      <Panel title="Scoring rules" description="Award or deduct points automatically when contacts engage."
        action={<Button size="sm" variant="primary" icon={<Plus size={14} />} label="Add rule" onClick={() => setPointActionModal('new')} />}>
        {!pointActions.data ? <AsyncState loading={pointActions.loading} error={pointActions.error} retry={pointActions.refresh} />
          : <Table data={pointActions.data} idKey="id" hasHover
            emptyState={<Empty title="No scoring rules yet" description="Reward actions such as email opens, form submissions and page visits." />}
            columns={[
              {
                key: 'name',
                header: 'Rule',
                renderCell: rule => <span className="ov-cell">
                  <Text weight="medium">{rule.name}</Text>
                  {rule.description ? <Text type="supporting" color="secondary">{rule.description}</Text> : null}
                </span>,
              },
              {
                key: 'type',
                header: 'Action',
                renderCell: rule => cleanLabel(actionTypeLabels[rule.type] ?? '') || prettifyKey(rule.type),
              },
              {
                key: 'delta',
                header: 'Points',
                align: 'end',
                renderCell: rule => <StatusBadge
                  label={`${rule.delta > 0 ? '+' : ''}${number(rule.delta)}`}
                  tone={rule.delta > 0 ? 'success' : rule.delta < 0 ? 'error' : 'neutral'} />,
              },
              { key: 'published', header: 'Status', renderCell: rule => <StatusBadge label={rule.published ? 'Published' : 'Draft'} tone={rule.published ? 'success' : 'neutral'} /> },
              {
                key: 'id',
                header: 'Actions',
                align: 'end',
                renderCell: rule => <span className="ov-actions ov-actions--end">
                  <Button size="sm" variant="ghost" label="Edit" icon={<Pencil size={14} />} onClick={() => setPointActionModal(rule)} />
                  <IconButton size="sm" variant="ghost" label={`Delete ${rule.name}`} icon={<Trash2 size={14} />}
                    onClick={() => setConfirmState({
                      title: `Delete scoring rule “${rule.name}”`,
                      description: 'Existing contact scores will remain unchanged.',
                      actionLabel: 'Delete rule',
                      onConfirm: async () => {
                        await api(`${pointActionPath}/${rule.id}`, 'DELETE');
                        pointActions.refresh();
                        setNotice('Scoring rule deleted.');
                      },
                    })} />
                </span>,
              },
            ]} />}
      </Panel>

      <Panel title="Score triggers" description="Define score thresholds that fire downstream actions."
        action={<Button size="sm" variant="primary" icon={<Plus size={14} />} label="Add trigger" onClick={() => setPointTriggerModal('new')} />}>
        {!pointTriggers.data ? <AsyncState loading={pointTriggers.loading} error={pointTriggers.error} retry={pointTriggers.refresh} />
          : <Table data={pointTriggers.data} idKey="id" hasHover
            emptyState={<Empty title="No score triggers yet" description="Create a trigger when contacts reach a qualification threshold." />}
            columns={[
              {
                key: 'name',
                header: 'Trigger',
                renderCell: trigger => <span className="ov-cell">
                  <Text weight="medium">{trigger.name}</Text>
                  {trigger.description ? <Text type="supporting" color="secondary">{trigger.description}</Text> : null}
                </span>,
              },
              { key: 'points', header: 'Threshold', align: 'end', renderCell: trigger => `≥ ${number(trigger.points)} pts` },
              {
                key: 'triggerExistingLeads',
                header: 'Scope',
                renderCell: trigger => <StatusBadge label={trigger.triggerExistingLeads ? 'Existing & new' : 'New matches'} tone={trigger.triggerExistingLeads ? 'info' : 'neutral'} />,
              },
              { key: 'published', header: 'Status', renderCell: trigger => <StatusBadge label={trigger.published ? 'Published' : 'Draft'} tone={trigger.published ? 'success' : 'neutral'} /> },
              {
                key: 'id',
                header: 'Actions',
                align: 'end',
                renderCell: trigger => <span className="ov-actions ov-actions--end">
                  <Button size="sm" variant="ghost" label="Edit" icon={<Pencil size={14} />} onClick={() => setPointTriggerModal(trigger)} />
                  <IconButton size="sm" variant="ghost" label={`Delete ${trigger.name}`} icon={<Trash2 size={14} />}
                    onClick={() => setConfirmState({
                      title: `Delete score trigger “${trigger.name}”`,
                      description: 'This permanently deletes the point threshold trigger.',
                      actionLabel: 'Delete trigger',
                      onConfirm: async () => {
                        await api(`${pointTriggerPath}/${trigger.id}`, 'DELETE');
                        pointTriggers.refresh();
                        setNotice('Score trigger deleted.');
                      },
                    })} />
                </span>,
              },
            ]} />}
      </Panel>
    </div> : null}

    {tab === 'Suppressions' ? <div className="ov-stack">
      <Panel title="Global suppressions" description="Addresses blocked across newsletters and automations. Erased contacts retain only a protected digest.">
        {!suppressions.data ? <AsyncState loading={suppressions.loading} error={suppressions.error} retry={suppressions.refresh} />
          : <Table data={suppressions.data} idKey="emailKey" hasHover
            emptyState={<Empty title="No suppressed addresses" description="Unsubscribes, bounces, complaints and erased contacts appear here." />}
            columns={[
              {
                key: 'email',
                header: 'Address',
                renderCell: record => record.email
                  ? (record.contactId ? <Link href={`/audience/${record.contactId}`}>{record.email}</Link> : <Text>{record.email}</Text>)
                  : <Text color="secondary">Protected digest ({record.emailKey.slice(0, 12)}…)</Text>,
              },
              {
                key: 'reason',
                header: 'Reason',
                renderCell: record => {
                  const [label, tone] = suppressionTone[record.reason] ?? ['Suppressed', 'neutral'];
                  return <StatusBadge label={label} tone={tone} />;
                },
              },
              { key: 'at', header: 'Recorded', renderCell: record => date(record.at) },
            ]} />}
      </Panel>

      <Panel title="Delivery bounces" description="Delivery failures recorded during newsletter sends. Blocklist repeated hard bounces to protect deliverability.">
        {!bounces.data ? <AsyncState loading={bounces.loading} error={bounces.error} retry={bounces.refresh} /> : <>
          <Table data={bounces.data.items} idKey="id" hasHover
            emptyState={<Empty title="No delivery bounces recorded" description="Bounce events from outbound newsletters will appear here." />}
            columns={[
              { key: 'email', header: 'Email' },
              {
                key: 'type',
                header: 'Bounce type',
                renderCell: bounce => {
                  const [label, tone] = bounceTone[bounce.type] ?? [prettifyKey(bounce.type || 'bounce'), 'warning'];
                  return <StatusBadge label={label} tone={tone} />;
                },
              },
              { key: 'campaignName', header: 'Campaign', renderCell: bounce => bounce.campaignName || '—' },
              { key: 'source', header: 'Source', renderCell: bounce => bounce.source || '—' },
              { key: 'createdAt', header: 'Date', renderCell: bounce => date(bounce.createdAt) },
              {
                key: 'id',
                header: 'Actions',
                align: 'end',
                renderCell: bounce => <span className="ov-actions ov-actions--end">
                  <Button size="sm" label="Blocklist" icon={<Ban size={14} />} isDisabled={action.busy}
                    onClick={() => setConfirmState({
                      title: `Blocklist ${bounce.email}`,
                      description: 'This permanently blocks newsletter delivery to this bounced subscriber address.',
                      actionLabel: 'Blocklist subscriber',
                      onConfirm: async () => {
                        await api(`${bouncePath}/blocklist`, 'POST', { ids: [bounce.id] });
                        bounces.refresh();
                        setNotice(`${bounce.email} blocklisted.`);
                      },
                    })} />
                  <Button size="sm" variant="ghost" label="Clear" isDisabled={action.busy}
                    onClick={() => setConfirmState({
                      title: 'Clear bounce record',
                      description: `Remove this bounce log entry for ${bounce.email}?`,
                      actionLabel: 'Clear record',
                      onConfirm: async () => {
                        await api(`${bouncePath}/${bounce.id}`, 'DELETE');
                        bounces.refresh();
                        setNotice('Bounce record cleared.');
                      },
                    })} />
                </span>,
              },
            ]} />
          <Pager {...bounces.data} onPage={setBouncePage} />
        </>}
      </Panel>
    </div> : null}

    {contactModal ? <ContactForm onClose={() => setContactModal(false)} onDone={contact => router.push(`/audience/${contact.id}`)} /> : null}
    {importModal ? <ImportForm onClose={() => setImportModal(false)} onImported={() => { contacts.refresh(); setNotice('Import processed.'); }} /> : null}
    {segmentModal ? <SegmentForm segment={segmentModal === 'new' ? undefined : segmentModal} onClose={() => setSegmentModal(undefined)} onDone={() => {
      setNotice(segmentModal === 'new' ? 'Segment created.' : 'Segment updated.');
      setSegmentModal(undefined);
      segments.refresh();
    }} /> : null}
    {listModal ? <MailingListForm list={listModal === 'new' ? undefined : listModal} onClose={() => setListModal(undefined)} onDone={() => {
      setNotice(listModal === 'new' ? 'Mailing list created.' : 'Mailing list updated.');
      setListModal(undefined);
      lists.refresh();
    }} /> : null}
    {tagModal ? <TagForm onClose={() => setTagModal(false)} onDone={() => {
      setTagModal(false);
      setNotice('Tag created.');
      tags.refresh();
    }} /> : null}
    {stageModal ? <StageForm stage={stageModal === 'new' ? undefined : stageModal} onClose={() => setStageModal(undefined)} onDone={() => {
      setNotice(stageModal === 'new' ? 'Lifecycle stage created.' : 'Lifecycle stage updated.');
      setStageModal(undefined);
      stages.refresh();
    }} /> : null}
    {companyModal ? <CompanyForm company={companyModal === 'new' ? undefined : companyModal} onClose={() => setCompanyModal(undefined)} onDone={() => {
      setNotice(companyModal === 'new' ? 'Company added.' : 'Company updated.');
      setCompanyModal(undefined);
      companies.refresh();
    }} /> : null}
    {pointActionModal ? <PointActionForm rule={pointActionModal === 'new' ? undefined : pointActionModal} typeMap={actionTypeLabels}
      onClose={() => setPointActionModal(undefined)} onDone={() => {
        setNotice(pointActionModal === 'new' ? 'Scoring rule created.' : 'Scoring rule updated.');
        setPointActionModal(undefined);
        pointActions.refresh();
      }} /> : null}
    {pointTriggerModal ? <PointTriggerForm trigger={pointTriggerModal === 'new' ? undefined : pointTriggerModal}
      onClose={() => setPointTriggerModal(undefined)} onDone={() => {
        setNotice(pointTriggerModal === 'new' ? 'Score trigger created.' : 'Score trigger updated.');
        setPointTriggerModal(undefined);
        pointTriggers.refresh();
      }} /> : null}
    {suppressModal ? <SuppressAddressForm onClose={() => setSuppressModal(false)} onDone={() => {
      setSuppressModal(false);
      setNotice('Address suppressed.');
      suppressions.refresh();
    }} /> : null}
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

/* ── Unified Contact Detail View ───────────────────────────────────────────── */

export function ContactView({ id }: { id: string }) {
  const user = useUser();
  const router = useRouter();
  const path = `${contactsPath}/${id}`;
  const resource = useResource<ContactDetail>(path);
  const segments = useResource<Segment[]>(segmentPath);
  const mailingLists = useResource<MailingList[]>(listPath);
  const stages = useResource<Stage[]>(stagePath);
  const workflows = useResource<Workflow[]>('/workflows');
  const action = useAction();

  const [modal, setModal] = useState<'edit' | 'delete'>();
  const [deleteNote, setDeleteNote] = useState<ContactNote>();
  const [notice, setNotice] = useState('');
  const [consentAction, setConsentAction] = useState<string>();
  const [evidence, setEvidence] = useState('');
  const [segmentChoice, setSegmentChoice] = useState<string | null>(null);
  const [listChoice, setListChoice] = useState<string | null>(null);
  const [pointsDelta, setPointsDelta] = useState(5);
  const [noteType, setNoteType] = useState<NoteType>('general');
  const [noteText, setNoteText] = useState('');

  const contact = resource.data;
  const addable = segments.data?.filter(segment => !contact?.segments.some(current => current.id === segment.id)) || [];
  const subscribed = contact?.mailingListIds || [];
  const manualLists = mailingLists.data?.filter(list => !isSyncedList(list)) || [];
  const availableLists = manualLists.filter(list => !subscribed.includes(list.id));
  const chosenConsent = consentAction ?? (contact?.consent === 'unknown' ? 'opted_in' : 'suppressed');
  const enrolledIds = contact?.workflowIds ?? [];
  const locationText = contact ? [contact.city, contact.country].filter(Boolean).join(', ') : '';

  function mutate(task: () => Promise<unknown>, success: string) {
    void action.run(async () => {
      await task();
      setNotice('');
      resource.refresh();
    }, success);
  }

  function adjustScore(delta: number) {
    if (!Number.isInteger(delta) || delta === 0) return;
    mutate(() => api(`${path}/points`, 'POST', { delta }), `Lead score adjusted (${delta > 0 ? '+' : ''}${delta}).`);
  }

  return <>
    <PageHeader back={{ href: '/audience', label: 'Audience' }} title={contact ? fullName(contact) || contact.email || 'Contact' : 'Contact'}
      description={contact?.email || 'Contact record and preferences.'}
      actions={contact ? <>
        {user.role === 'admin' ? <>
          <Button label="Export contact" icon={<Download size={15} />} isDisabled={action.busy}
            onClick={() => void action.run(async () => saveFile(JSON.stringify(await api(`${path}/export`), null, 2), `ovelio-contact-${id}.json`, 'application/json'))} />
          <Button label="Delete contact" variant="destructive" onClick={() => setModal('delete')} />
        </> : null}
        <Button label="Edit contact" variant="primary" onClick={() => setModal('edit')} />
      </> : undefined} />

    {!contact ? <Panel><AsyncState loading={resource.loading} error={resource.error} retry={resource.refresh} /></Panel> : <div className="ov-stack">
      <Feedback error={action.error} notice={action.notice || notice} />
      <div className="ov-grid">
        <Panel title="Contact information">
          <MetadataList>
            <MetadataListItem label="Company">{contact.company || '—'}</MetadataListItem>
            <MetadataListItem label="Position">{contact.position || '—'}</MetadataListItem>
            <MetadataListItem label="Phone">{contact.phone || '—'}</MetadataListItem>
            <MetadataListItem label="Location">{locationText || '—'}</MetadataListItem>
            <MetadataListItem label="Website">
              {isSafeHttpUrl(contact.website) ? <Link href={contact.website} isExternalLink>{contact.website}</Link> : contact.website || '—'}
            </MetadataListItem>
            <MetadataListItem label="Lead score">
              <div className="ov-stack-sm">
                <div className="ov-actions">
                  <Text weight="semibold">{number(contact.points)}</Text>
                  <Button size="sm" variant="ghost" label="-10" icon={<Minus size={13} />} isDisabled={action.busy} onClick={() => adjustScore(-10)} />
                  <Button size="sm" variant="ghost" label="+10" icon={<Plus size={13} />} isDisabled={action.busy} onClick={() => adjustScore(10)} />
                </div>
                <div className="ov-actions">
                  <NumberInput label="Custom score adjustment" isLabelHidden min={-10000} max={10000} isIntegerOnly
                    value={pointsDelta} onChange={setPointsDelta} width={110} />
                  <Button size="sm" label="Adjust" isDisabled={action.busy || pointsDelta === 0} onClick={() => adjustScore(pointsDelta)} />
                </div>
              </div>
            </MetadataListItem>
            <MetadataListItem label="Lifecycle stage">
              <Selector label="Lifecycle stage" isLabelHidden width={220} isLoading={stages.loading}
                value={contact.stageId ? String(contact.stageId) : 'none'}
                options={[{ value: 'none', label: 'No stage' }, ...optionsOf(stages.data)]}
                onChange={value => {
                  const nextId = value && value !== 'none' ? Number(value) : null;
                  if (nextId === (contact.stageId ?? null)) return;
                  mutate(() => api(`${path}/stage`, 'POST', { stageId: nextId }), 'Lifecycle stage updated.');
                }} />
            </MetadataListItem>
            <MetadataListItem label="Tags"><Tags tags={contact.tags} /></MetadataListItem>
            <MetadataListItem label="Created">{date(contact.createdAt)}</MetadataListItem>
            <MetadataListItem label="Updated">{date(contact.updatedAt)}</MetadataListItem>
          </MetadataList>
        </Panel>

        <Panel title="Email consent" action={<StatusBadge label={consentLabel[contact.consent][0]} tone={consentLabel[contact.consent][1]} />}>
          {contact.consent === 'suppressed' ? <Text color="secondary">Marketing emails are blocked for this contact across newsletters and automations.</Text>
            : <form className="ov-stack-sm" onSubmit={event => {
              event.preventDefault();
              if (!evidence.trim()) return;
              mutate(() => api(`${path}/consent`, 'POST', { action: chosenConsent, evidence: evidence.trim() }), 'Email consent updated.');
              setEvidence('');
            }}>
              <div className="ov-form-grid">
                <Selector label="Consent action" value={chosenConsent} onChange={value => setConsentAction(value ?? undefined)} options={[
                  ...(contact.consent === 'unknown' ? [{ value: 'opted_in', label: 'Record opt-in' }] : []),
                  { value: 'suppressed', label: 'Suppress marketing email' },
                ]} />
                <TextInput label="Evidence" placeholder="Source and date" isRequired value={evidence} onChange={setEvidence} />
              </div>
              <FormActions><Button type="submit" label="Save consent" isDisabled={action.busy || !evidence.trim()} /></FormActions>
            </form>}
          <div className="ov-stack-sm">
            <Text type="label" color="secondary">Consent audit history</Text>
            {contact.consentHistory?.length ? <Rows>{contact.consentHistory.map(entry => <li key={entry.id}>
              <span>
                <span className="ov-actions">
                  <StatusBadge label={entry.action === 'opted_in' ? 'Opted in' : 'Suppressed'} tone={entry.action === 'opted_in' ? 'success' : 'error'} />
                </span>
                <Text type="supporting" color="secondary">{entry.evidence}</Text>
              </span>
              <Timestamp value={entry.at} format="date_time" />
            </li>)}</Rows> : <Text type="supporting" color="secondary">No consent events recorded yet.</Text>}
          </div>
        </Panel>

        <Panel title="Segments">
          {contact.segments.length ? <Rows>{contact.segments.map(segment => <li key={segment.id}><Text>{segment.name}</Text>
            <Button size="sm" variant="ghost" label="Remove" isDisabled={action.busy}
              onClick={() => mutate(() => api(`${path}/segments`, 'POST', { segmentId: segment.id, member: false }), 'Segment membership removed.')} />
          </li>)}</Rows> : <Text color="secondary">This contact has no segment memberships.</Text>}
          {addable.length ? <div className="ov-toolbar">
            <Selector label="Add to segment" placeholder="Select a segment" value={segmentChoice} hasClear onChange={setSegmentChoice} options={optionsOf(addable)} width={260} />
            <Button label="Add to segment" isDisabled={action.busy || !segmentChoice}
              onClick={() => { mutate(() => api(`${path}/segments`, 'POST', { segmentId: Number(segmentChoice), member: true }), 'Segment membership added.'); setSegmentChoice(null); }} />
          </div> : <AsyncState loading={segments.loading} error={segments.error} retry={segments.refresh} />}
        </Panel>

        <Panel title="Mailing lists" description="Synced lists follow segment membership."
          action={contact.consent === 'opted_in' && subscribed.length ? <Button size="sm" label="Resend opt-in" icon={<MailCheck size={14} />}
            isDisabled={action.busy}
            onClick={() => void action.run(async () => { await api(`${path}/resend-optin`, 'POST'); }, 'Opt-in confirmation email sent.')} /> : undefined}>
          {subscribed.length ? <Rows>{subscribed.map(listId => <li key={listId}>
            <Text>{mailingLists.data?.find(item => item.id === listId)?.name || `List ${listId}`}</Text>
            {manualLists.some(item => item.id === listId) ? <Button size="sm" variant="ghost" label="Remove from list" isDisabled={action.busy}
              onClick={() => mutate(() => api(`${path}/lists`, 'POST', { listId, member: false }), 'Removed from mailing list.')} /> : null}
          </li>)}</Rows> : <Text color="secondary">No mailing list memberships.</Text>}
          {contact.consent === 'opted_in' && availableLists.length ? <div className="ov-toolbar">
            <Selector label="Mailing list" placeholder="Select a mailing list" value={listChoice} hasClear onChange={setListChoice} options={optionsOf(availableLists)} width={260} />
            <Button label="Add to mailing list" isDisabled={action.busy || !listChoice}
              onClick={() => { mutate(() => api(`${path}/lists`, 'POST', { listId: Number(listChoice), member: true }), 'Mailing list membership updated.'); setListChoice(null); }} />
          </div> : null}
          <AsyncState loading={mailingLists.loading} error={mailingLists.error} retry={mailingLists.refresh} />
        </Panel>

        <Panel title="Notes" description="Record call summaries, meeting notes and internal context.">
          <form className="ov-stack-sm" onSubmit={event => {
            event.preventDefault();
            if (!noteText.trim()) return;
            void action.run(async () => {
              await api(`${path}/notes`, 'POST', { text: noteText.trim(), type: noteType });
              setNoteText('');
              setNotice('');
              resource.refresh();
            }, 'Note added.');
          }}>
            <Selector label="Note type" value={noteType} options={noteTypes}
              onChange={value => setNoteType((value as NoteType) || 'general')} />
            <TextArea label="Note" rows={3} placeholder="Add context from a call, email or meeting…" isRequired value={noteText} onChange={setNoteText} />
            <FormActions>
              <Button type="submit" variant="primary" size="sm" label="Add note" isLoading={action.busy} isDisabled={!noteText.trim()} />
            </FormActions>
          </form>
          {contact.notes?.length ? <Rows>{contact.notes.map(note => <li key={note.id}>
            <span>
              <span className="ov-actions">
                <StatusBadge label={prettifyKey(note.type || 'general')} tone={noteTone[note.type] ?? 'neutral'} />
                {note.dateTime ? <Timestamp value={note.dateTime} format="date_time" /> : null}
              </span>
              <Text>{note.text}</Text>
            </span>
            <IconButton size="sm" variant="ghost" label="Delete note" icon={<Trash2 size={14} />} onClick={() => setDeleteNote(note)} />
          </li>)}</Rows> : <Text color="secondary">No notes recorded yet.</Text>}
        </Panel>

        <Panel title="Enrolled automations" description="Active journeys currently including this contact."
          action={<Link href="/automations" type="supporting">Manage automations</Link>}>
          {enrolledIds.length ? <Rows>{enrolledIds.map(workflowId => {
            const match = workflows.data?.find(item => item.id === workflowId);
            return <li key={workflowId}>
              <Text weight="medium">{match?.name || `Workflow #${workflowId}`}</Text>
              {match ? <StatusBadge label={match.enabled ? 'Active' : 'Inactive'} tone={match.enabled ? 'success' : 'neutral'} /> : <StatusBadge label="Enrolled" tone="info" />}
            </li>;
          })}</Rows> : <Text color="secondary">Not currently enrolled in any automations.</Text>}
          {workflows.loading && enrolledIds.length ? <AsyncState loading={workflows.loading} error={workflows.error} retry={workflows.refresh} /> : null}
        </Panel>
      </div>

      <Panel title="Activity">
        {contact.activity.length ? <Rows>{contact.activity.map((item, index) => <li key={item.at + item.type + index}>
          <Text>{item.label}</Text><Timestamp value={item.at} format="date_time" />
        </li>)}</Rows> : <Empty title="No recorded activity" />}
      </Panel>
    </div>}

    {modal === 'edit' && contact ? <ContactForm contact={contact} onClose={() => setModal(undefined)} onDone={() => {
      setModal(undefined);
      setNotice('Contact updated.');
      resource.refresh();
    }} /> : null}

    {modal === 'delete' ? <ConfirmDialog
      title="Delete contact"
      description="This queues erasure across audience and newsletter records, and keeps a minimal suppression record to prevent future marketing email."
      actionLabel="Request erasure"
      destructive
      busy={action.busy}
      onClose={() => setModal(undefined)}
      onConfirm={() => void action.run(async () => {
        try {
          await api(path, 'DELETE');
          router.replace('/audience');
        } finally {
          setModal(undefined);
        }
      })}
    /> : null}

    {deleteNote ? <ConfirmDialog
      title="Delete note"
      description="Remove this note permanently from the contact record?"
      actionLabel="Delete note"
      destructive
      busy={action.busy}
      onClose={() => setDeleteNote(undefined)}
      onConfirm={() => void action.run(async () => {
        try {
          await api(`/notes/${deleteNote.id}`, 'DELETE');
          resource.refresh();
        } finally {
          setDeleteNote(undefined);
        }
      }, 'Note deleted.')}
    /> : null}
  </>;
}
