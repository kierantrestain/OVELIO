'use client';

import {
  Ban, Download, ListFilter, MailCheck, Minus, Pencil, Plus, Search, Send, ShieldAlert, Trash2, Upload,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Field } from '@astryxdesign/core/Field';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Link } from '@astryxdesign/core/Link';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { Table, pixel } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import { Token } from '@astryxdesign/core/Token';
import type {
  BounceRecord, Company, Contact, ContactDetail, ContactNote, ContactSortKey, ContactTimeline, ContactView, ImportMapping, ImportPreview, ImportRun, CustomField, CustomFieldObject,
  JourneyEmail, MailingList, Page, PointAction, PointTrigger, PointTriggerEventInput, PointTriggerEventType,
  Segment, SegmentFilter, SegmentFilterField, SegmentOffsetUnit, SegmentOptions, SegmentPicker, SegmentRule, Stage,
  SuppressionRecord, Tag, Workflow,
} from '@/contracts';
import {
  contactSearchCommands, contactSortKeys, canonicalSegmentOperator, emptySegmentRule, formatSegmentOffset, parseSegmentDate, resolveSegmentField, segmentDateUnits,
  segmentFieldCatalogue, segmentFilterFromRule, segmentOffsetUnits, segmentOperatorsFor, segmentRelativeDates,
  segmentRuleFromFilter, segmentValueMode,
} from '@/contracts';
import type { SelectorOptionType } from '@astryxdesign/core/Selector';
import { api, date, number, saveFile, useAction, useFields, useResource } from './client';
import { useUser } from './shell';
import { WorkflowRunLog } from './workflow-run-log';
import {
  AsyncState, ConfirmDialog, Empty, Feedback, FilterBar, FormActions, Modal,
  PageHeader, Pager, Panel, Rows, StatusBadge, Tabs,
} from './ui';
import type { Tone } from './ui';

const tabs = ['Contacts', 'Segments', 'Mailing lists', 'Tags & stages', 'Companies', 'Lead scoring', 'Suppressions', 'Custom fields'] as const;
type AudienceTab = typeof tabs[number];
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
const fieldPath = '/fields';

const customFieldTypes = [
  { value: 'text', label: 'Short text' },
  { value: 'textarea', label: 'Long text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Boolean (Yes / No)' },
  { value: 'date', label: 'Date' },
  { value: 'datetime', label: 'Date & time' },
  { value: 'email', label: 'Email address' },
  { value: 'url', label: 'URL' },
  { value: 'tel', label: 'Telephone' },
  { value: 'select', label: 'Dropdown (select)' },
  { value: 'multiselect', label: 'Multi-select' },
  { value: 'country', label: 'Country' },
  { value: 'region', label: 'Region' },
  { value: 'timezone', label: 'Timezone' },
  { value: 'locale', label: 'Locale' },
] as const;

const customFieldGroups = [
  { value: 'core', label: 'Core' },
  { value: 'social', label: 'Social' },
  { value: 'personal', label: 'Personal' },
  { value: 'professional', label: 'Professional' },
] as const;

type CustomFieldType = typeof customFieldTypes[number]['value'];
type CustomFieldGroup = typeof customFieldGroups[number]['value'];

const fieldTypeLabels: Record<string, string> = Object.fromEntries(customFieldTypes.map(item => [item.value, item.label]));
const fieldGroupLabels: Record<string, string> = Object.fromEntries(customFieldGroups.map(item => [item.value, item.label]));
const validFieldGroups = new Set<string>(customFieldGroups.map(item => item.value));
const coreFieldAliases = new Set(['email', 'firstname', 'lastname', 'company', 'phone', 'position', 'city', 'country', 'website']);
const isChoiceFieldType = (type: string) => type === 'select' || type === 'multiselect';

const csvTemplate = [
  'email,first_name,last_name,company,phone,position,city,country,website,tags,consent,evidence',
  'alex.morgan@example.com,Alex,Morgan,Northwind Studio,+44 20 7946 0192,Marketing Lead,London,United Kingdom,https://northwind.example.com,newsletter|vip,opted_in,Website signup form 2026-01-15',
  'sam.taylor@example.com,Sam,Taylor,Beacon Labs,,Product Manager,Manchester,United Kingdom,,product-updates,,',
].join('\n') + '\n';

const fallbackPointActionTypes: Record<string, string> = {
  'email.open': 'Opens an email',
  'email.send': 'Is sent an email',
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
  { value: 'manual', label: 'Manual' },
];

const sortLabels: Record<ContactSortKey, string> = {
  createdAt: 'Date added', updatedAt: 'Last changed', lastActive: 'Last active', email: 'Email', firstName: 'First name', lastName: 'Last name',
  company: 'Company', city: 'City', country: 'Country', position: 'Position', points: 'Score', id: 'Contact id',
};
const sortChoices = contactSortKeys.map(value => ({ value, label: sortLabels[value] }));

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
  manual: ['Manual', 'warning'],
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
  const normalized = input.trim().toLowerCase().replaceAll(/[-_]+/g, ' ').replaceAll(/\s+/g, ' ');
  return tabs.find(item => item.toLowerCase() === normalized) ?? 'Contacts';
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

const toDateTimeInput = (value: string) => value.replace(' ', 'T').slice(0, 16);

// One input per published contact field, chosen by the field's type.
function CustomFieldInputs({ fields, values, onChange }: {
  fields: CustomField[];
  values: Record<string, string>;
  onChange: (alias: string, value: string) => void;
}) {
  return <div className="ov-form-grid">{fields.map(item => {
    const value = values[item.alias] ?? '';
    const label = item.label || item.alias;
    const set = (next: string | null | undefined) => onChange(item.alias, next ?? '');
    const optional = !item.isRequired;
    if (item.type === 'textarea') return <TextArea key={item.id} label={label} rows={3} isOptional={optional} value={value} onChange={set} />;
    if (item.type === 'boolean') {
      return <Selector key={item.id} label={label} placeholder="Not set" hasClear value={value === '' ? null : value}
        options={[{ value: '1', label: 'Yes' }, { value: '0', label: 'No' }]} onChange={set} />;
    }
    if (item.type === 'select') {
      return <Selector key={item.id} label={label} placeholder="Not set" hasClear value={value || null}
        options={item.options.map(option => ({ value: option, label: option }))} onChange={set} />;
    }
    if (item.type === 'multiselect') {
      const chosen = value.split('|').filter(Boolean);
      return <fieldset key={item.id} className="ov-stack-sm" style={{ border: 0, padding: 0, margin: 0 }}>
        <Text weight="semibold">{label}</Text>
        {item.options.map(option => <CheckboxInput key={option} label={option} value={chosen.includes(option)}
          onChange={on => set((on ? [...chosen, option] : chosen.filter(entry => entry !== option)).join('|'))} />)}
      </fieldset>;
    }
    const hint = item.type === 'date' ? 'Format: YYYY-MM-DD'
      : item.type === 'datetime' ? 'Format: YYYY-MM-DD HH:MM'
        : item.type === 'number' ? 'Enter a number'
          : item.type === 'locale' ? 'For example en_GB' : item.type === 'timezone' ? 'For example Europe/London' : undefined;
    const type = ({ email: 'email', url: 'url', tel: 'tel' } as Record<string, 'email' | 'url' | 'tel'>)[item.type];
    return <TextInput key={item.id} label={label} description={hint} type={type ?? 'text'} isOptional={optional}
      value={item.type === 'datetime' ? toDateTimeInput(value).replace('T', ' ') : value} onChange={set} />;
  })}</div>;
}

function showCustomValue(item: CustomField, value: string | undefined) {
  if (!value) return '—';
  if (item.type === 'boolean') return value === '1' ? 'Yes' : 'No';
  if (item.type === 'multiselect') return value.split('|').filter(Boolean).join(', ');
  return value;
}

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
  const definitions = useResource<CustomField[]>(`${fieldPath}/contact`);
  const customFields = (definitions.data ?? []).filter(item => item.published && !coreFieldAliases.has(item.alias));
  const [custom, setCustom] = useState<Record<string, string>>({});
  const customValue = (alias: string) => custom[alias] ?? contact?.customFields?.[alias] ?? '';
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
          // Only changed values are sent, so an untouched field is never rewritten or cleared.
          ...(Object.keys(custom).length ? { customFields: custom } : {}),
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
      {customFields.length ? <CustomFieldInputs fields={customFields} onChange={(alias, value) => setCustom(current => ({ ...current, [alias]: value }))}
        values={Object.fromEntries(customFields.map(item => [item.alias, customValue(item.alias)]))} /> : null}
      <AsyncState loading={definitions.loading} error={definitions.error} retry={definitions.refresh} />
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

type ImportDraft = { run: ImportRun; preview: ImportPreview };

// Upload, map columns, optionally dry-run, then follow the background job's progress.
function ImportForm({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const action = useAction();
  const [file, setFile] = useState<File>();
  const [evidence, setEvidence] = useState('');
  const [draft, setDraft] = useState<ImportDraft>();
  const [mapping, setMapping] = useState<ImportMapping>({});
  const [updateExisting, setUpdateExisting] = useState(true);
  const [run, setRun] = useState<ImportRun>();
  const watching = run && (run.status === 'queued' || run.status === 'running') ? run.id : null;
  useEffect(() => {
    if (!watching) return;
    const timer = setInterval(() => {
      void api<ImportRun>(`/crm/imports/${watching}`).then(next => {
        setRun(next);
        if (next.status === 'done' && !next.dryRun) onImported();
      }).catch(() => undefined);
    }, 2000);
    return () => clearInterval(timer);
  }, [watching, onImported]);

  async function start(dryRun: boolean) {
    if (!draft) return;
    setRun(await api<ImportRun>(`/crm/imports/${draft.run.id}/start`, 'POST', {
      mapping, dryRun, updateExisting, evidence: evidence.trim() || undefined,
    }));
  }
  const issues = run && run.skipped + run.errors > 0;
  const emailMapped = Object.values(mapping).includes('email');
  const percent = run?.total ? Math.min(100, Math.round(run.processed / run.total * 100)) : 0;

  return <Modal title="Import contacts" onClose={onClose}>
    {!draft ? <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        if (!file?.size) throw new Error('Choose a CSV file to import.');
        if (file.size > 25_000_000) throw new Error('Choose a CSV file smaller than 25 MB.');
        const next = await api<ImportDraft>('/crm/imports', 'POST', { csv: await file.text(), fileName: file.name, evidence: evidence.trim() || undefined });
        setDraft(next);
        setMapping(next.preview.mapping);
      });
    }}>
      <div className="ov-actions ov-actions--between">
        <Text type="supporting" color="secondary">Upload a CSV with a header row and an email column. Large files run in the background; you choose how each column maps in the next step.</Text>
        <Button size="sm" label="Download CSV template" icon={<Download size={14} />}
          onClick={() => saveFile(csvTemplate, 'ovelio-contacts-template.csv', 'text/csv')} />
      </div>
      <Field label="CSV file" inputID="ov-import-file" isRequired>
        <input id="ov-import-file" className="ov-native-file" type="file" accept=".csv,text/csv" onChange={event => setFile(event.target.files?.[0])} />
      </Field>
      <TextInput label="Consent evidence" description="Used for opted_in rows without their own evidence. Record the source and date of consent." isOptional value={evidence} onChange={setEvidence} />
      <Feedback error={action.error} />
      <FormActions>
        <Button label="Cancel" onClick={onClose} />
        <Button type="submit" variant="primary" label="Continue" isLoading={action.busy} />
      </FormActions>
    </form> : <div className="ov-stack-sm">
      <Text type="supporting" color="secondary">{number(draft.preview.rowCount)} rows in {draft.run.fileName}. Check which field each column fills.</Text>
      <Table data={draft.preview.headers.map((header, index) => ({ header, index }))} idKey="header" columns={[
        { key: 'header', header: 'CSV column', renderCell: item => <span className="ov-cell">
          <Text weight="semibold">{item.header}</Text>
          <Text type="supporting" color="secondary">{draft.preview.rows.map(row => row[item.index]).filter(Boolean).slice(0, 2).join(', ') || '—'}</Text>
        </span> },
        { key: 'target', header: 'Fills', renderCell: item => <Selector label={`Field for ${item.header}`} isLabelHidden width={230}
          value={mapping[item.header] ?? 'skip'} options={draft.preview.targets}
          onChange={value => setMapping(current => ({ ...current, [item.header]: value ?? 'skip' }))} isDisabled={!!run && run.status !== 'draft' && !run.dryRun && run.status !== 'done'} /> },
      ]} />
      <Switch label="Update contacts that already exist" description="Off leaves existing contacts untouched and reports them as skipped." value={updateExisting} onChange={setUpdateExisting} />
      {run ? <div className="ov-stack-sm" role="status">
        <Text weight="semibold">{run.dryRun ? 'Dry run' : 'Import'} {run.status === 'done' ? 'finished' : run.status === 'failed' ? 'failed' : `running, ${number(run.processed)} of ${number(run.total)} rows (${percent}%)`}</Text>
        <Text type="supporting" color="secondary">
          {run.dryRun ? 'Would create' : 'Created'} {number(run.created)} · {run.dryRun ? 'would update' : 'updated'} {number(run.updated)} · skipped {number(run.skipped)} · errors {number(run.errors)}
        </Text>
        {issues && run.status === 'done' ? <Button size="sm" label="Download skipped and failed rows" icon={<Download size={14} />}
          onClick={() => void action.run(async () => saveFile(await api<string>(`/crm/imports/${run.id}/issues`), 'ovelio-import-issues.csv', 'text/csv'))} /> : null}
      </div> : null}
      <Feedback error={action.error} />
      <FormActions>
        <Button label={run?.status === 'done' && !run.dryRun ? 'Close' : 'Cancel'} onClick={onClose} />
        <Button label="Dry run" isLoading={action.busy} isDisabled={!emailMapped || !!watching}
          onClick={() => void action.run(() => start(true))} />
        <Button variant="primary" label="Import contacts" isLoading={action.busy} isDisabled={!emailMapped || !!watching || (run?.status === 'done' && !run.dryRun)}
          onClick={() => void action.run(() => start(false))} />
      </FormActions>
    </div>}
  </Modal>;
}

function TimelinePanel({ contactId }: { contactId: number }) {
  const [page, setPage] = useState(1);
  const [type, setType] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const params = new URLSearchParams({ page: String(page), limit: '25' });
  if (type) params.append('include', type);
  if (search) params.set('q', search);
  const timeline = useResource<ContactTimeline>(`${contactsPath}/${contactId}/timeline?${params}`);
  const [known, setKnown] = useState<Record<string, string>>({});
  const types = timeline.data?.types;
  if (types && Object.keys(types).length > Object.keys(known).length) setKnown(types);
  return <Panel title="Activity" description="Everything the audience engine has recorded for this contact, newest first.">
    <div className="ov-toolbar">
      <form onSubmit={event => { event.preventDefault(); setSearch(query.trim()); setPage(1); }}>
        <TextInput label="Search activity" isLabelHidden type="search" startIcon="search" placeholder="Search activity" value={query} onChange={setQuery} width={240} />
      </form>
      <Selector label="Event type" isLabelHidden width={220} placeholder="All event types" hasClear value={type}
        options={Object.entries(known).sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }))}
        onChange={value => { setType(value); setPage(1); }} />
    </div>
    {!timeline.data ? <AsyncState loading={timeline.loading} error={timeline.error} retry={timeline.refresh} /> : <>
      {timeline.data.events.length ? <Rows>{timeline.data.events.map(item => <li key={item.id}>
        <span className="ov-cell">
          <Text>{item.href ? <Link href={item.href}>{item.label}</Link> : item.label}</Text>
          <Text type="supporting" color="secondary">{item.typeLabel}</Text>
        </span>
        <Timestamp value={item.at} format="date_time" />
      </li>)}</Rows> : <Empty title={type || search ? 'No activity matches' : 'No recorded activity'} />}
      <Pager {...timeline.data} onPage={setPage} />
    </>}
  </Panel>;
}

/* ── Segments & Mailing Lists Modals ───────────────────────────────────────── */

type Choice = { value: string; label: string };
type ValuePatch = Partial<Pick<SegmentRule, 'text' | 'text2' | 'list' | 'interval' | 'unit'>>;

const yesNoChoices: Choice[] = [{ value: '1', label: 'Yes' }, { value: '0', label: 'No' }];
const offsetUnitChoices = segmentOffsetUnits.map(unit => ({ value: unit, label: unit }));
const dateModeChoices: Choice[] = [
  { value: 'absolute', label: 'A specific date' },
  { value: 'relative', label: 'A named period (today, this month…)' },
  { value: 'offset', label: 'A number of days, weeks, months or years from today' },
];

function ChoiceChecklist({ label, choices, selected, onChange }: {
  label: string; choices: Choice[]; selected: string[]; onChange: (next: string[]) => void;
}) {
  // Values saved earlier but no longer in the list stay visible so they are not dropped silently.
  const extra = selected.filter(value => !choices.some(choice => choice.value === value)).map(value => ({ value, label: value }));
  const all = [...choices, ...extra];
  return <fieldset className="ov-stack-sm" style={{ border: 0, padding: 0, margin: 0 }}>
    <Text weight="semibold">{label}</Text>
    {all.length ? <div className="ov-stack-sm" style={{ maxHeight: 180, overflowY: 'auto' }}>
      {all.map(choice => <CheckboxInput key={choice.value} label={choice.label} value={selected.includes(choice.value)}
        onChange={on => onChange(on ? [...selected, choice.value] : selected.filter(entry => entry !== choice.value))} />)}
    </div> : <Text type="supporting" color="secondary">Nothing to choose from yet.</Text>}
  </fieldset>;
}

function DateValueInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const parsed = parseSegmentDate(value);
  const [mode, setMode] = useState(value ? parsed.mode : 'absolute');
  const offset = parsed.mode === 'offset' ? parsed : { amount: 7, unit: 'days' as const, direction: 'ago' as const };
  function pick(next: string | null) {
    const chosen = next === 'relative' || next === 'offset' ? next : 'absolute';
    setMode(chosen);
    onChange(chosen === 'relative' ? 'today' : chosen === 'offset' ? formatSegmentOffset(7, 'days', 'ago') : '');
  }
  return <div className="ov-stack-sm">
    <Selector label={`${label} type`} value={mode} options={dateModeChoices} onChange={pick} />
    {mode === 'relative'
      ? <Selector label={label} value={parsed.mode === 'relative' ? parsed.value : 'today'} options={segmentRelativeDates} onChange={next => onChange(next ?? 'today')} />
      : mode === 'offset'
        ? <div className="ov-form-grid ov-form-grid--three">
          <TextInput label="Amount" inputMode="numeric" value={String(offset.amount)}
            onChange={next => onChange(formatSegmentOffset(Number(next) || 1, offset.unit, offset.direction))} />
          <Selector label="Unit" value={offset.unit} options={offsetUnitChoices}
            onChange={next => onChange(formatSegmentOffset(offset.amount, (next ?? 'days') as SegmentOffsetUnit, offset.direction))} />
          <Selector label="Direction" value={offset.direction}
            options={[{ value: 'ago', label: 'ago' }, { value: 'ahead', label: 'from now' }]}
            onChange={next => onChange(formatSegmentOffset(offset.amount, offset.unit, next === 'ahead' ? 'ahead' : 'ago'))} />
        </div>
        : <TextInput label={label} placeholder="YYYY-MM-DD" description="Add a time (YYYY-MM-DD HH:MM:SS) for date and time fields." value={value}
          onChange={onChange} />}
  </div>;
}

function SegmentValueInput({ field, rule, choices, onChange }: {
  field: SegmentFilterField; rule: SegmentRule; choices: Choice[]; onChange: (patch: ValuePatch) => void;
}) {
  const mode = segmentValueMode(rule.operator);
  const dated = field.kind === 'date' || field.kind === 'behaviorDate';
  if (mode === 'none') return <Text type="supporting" color="secondary">No value needed.</Text>;
  if (mode === 'span') {
    return <div className="ov-form-grid">
      <TextInput label="Number" inputMode="numeric" isRequired value={rule.interval} onChange={interval => onChange({ interval })} />
      <Selector label="Unit" value={rule.unit} options={segmentDateUnits}
        onChange={unit => onChange({ unit: unit === 'month' || unit === 'year' ? unit : 'day' })} />
    </div>;
  }
  if (mode === 'pair') {
    return dated
      ? <div className="ov-stack-sm">
        <DateValueInput label="From" value={rule.text} onChange={text => onChange({ text })} />
        <DateValueInput label="To" value={rule.text2} onChange={text2 => onChange({ text2 })} />
      </div>
      : <div className="ov-form-grid">
        <TextInput label="From" isRequired value={rule.text} onChange={text => onChange({ text })} />
        <TextInput label="To" isRequired value={rule.text2} onChange={text2 => onChange({ text2 })} />
      </div>;
  }
  if (mode === 'multi') {
    if (choices.length || field.picker) return <ChoiceChecklist label="Values" choices={choices} selected={rule.list} onChange={list => onChange({ list })} />;
    return <TextInput label="Values" isRequired placeholder="Comma-separated values"
      value={rule.text || rule.list.join(', ')} onChange={text => onChange({ text, list: [] })} />;
  }
  if (field.kind === 'boolean') return <Selector label="Value" value={rule.text === '0' ? '0' : '1'} options={yesNoChoices} onChange={text => onChange({ text: text ?? '1' })} />;
  if ((field.kind === 'owner' || field.kind === 'stage' || choices.length) && field.kind !== 'date') {
    return <Selector label="Value" value={rule.text} placeholder="Choose a value" hasSearch options={choices} onChange={text => onChange({ text: text ?? '' })} />;
  }
  if (dated) return <DateValueInput label="Value" value={rule.text} onChange={text => onChange({ text })} />;
  const numeric = field.kind === 'number' || field.kind === 'behaviorNumber';
  return <TextInput label="Value" isRequired inputMode={numeric ? 'decimal' : undefined}
    placeholder={numeric ? 'e.g. 50' : rule.operator === 'regexp' || rule.operator === '!regexp' ? 'Regular expression' : 'Filter value'}
    value={rule.text} onChange={text => onChange({ text })} />;
}

function SegmentForm({ segment, onClose, onDone }: { segment?: Segment; onClose: () => void; onDone: () => void }) {
  const contactFields = useResource<CustomField[]>(`${fieldPath}/contact`);
  const companyFields = useResource<CustomField[]>(`${fieldPath}/company`);
  const lookups = useResource<SegmentOptions>('/segment-options');
  const segments = useResource<Segment[]>(segmentPath);
  const tags = useResource<Tag[]>(tagPath);
  const stages = useResource<Stage[]>(stagePath);
  const emails = useResource<JourneyEmail[]>('/journey-emails');
  const assets = useResource<{ id: number; title: string }[]>('/assets');
  const campaigns = useResource<Workflow[]>('/workflows');
  const categories = useResource<{ id: number; title: string }[]>('/categories?bundle=global');
  const error = contactFields.error || companyFields.error || lookups.error;
  if (!contactFields.data || !companyFields.data || !lookups.data) {
    return <Modal title={segment ? 'Edit segment' : 'Create segment'} onClose={onClose} size="large">
      <AsyncState loading={!error} error={error} retry={() => { contactFields.refresh(); companyFields.refresh(); lookups.refresh(); }} />
    </Modal>;
  }
  // Stored rows are read once the field definitions are known, so custom fields resolve to their real type.
  const catalogue = segmentFieldCatalogue({ contactFields: contactFields.data, companyFields: companyFields.data, pointGroups: lookups.data.pointGroups });
  const picker: Record<SegmentPicker, Choice[]> = {
    segments: (segments.data ?? []).filter(item => item.id !== segment?.id).map(item => ({ value: String(item.id), label: item.name })),
    tags: (tags.data ?? []).map(item => ({ value: String(item.id), label: item.tag })),
    stages: optionsOf(stages.data),
    owners: optionsOf(lookups.data.owners),
    campaigns: optionsOf(campaigns.data),
    emails: optionsOf(emails.data),
    assets: (assets.data ?? []).map(item => ({ value: String(item.id), label: item.title })),
    categories: (categories.data ?? []).map(item => ({ value: String(item.id), label: item.title })),
  };
  return <SegmentEditor segment={segment} catalogue={catalogue} picker={picker} onClose={onClose} onDone={onDone} />;
}

type RuleRow = { key: number; rule: SegmentRule };

function SegmentEditor({ segment, catalogue, picker, onClose, onDone }: {
  segment?: Segment; catalogue: SegmentFilterField[]; picker: Record<SegmentPicker, Choice[]>; onClose: () => void; onDone: () => void;
}) {
  const action = useAction();
  const { values, field } = useFields({ name: segment?.name ?? '', description: segment?.description ?? '' });
  const [published, setPublished] = useState(segment?.published ?? true);
  const [rows, setRows] = useState<RuleRow[]>(() =>
    (segment?.filters ?? []).map((entry, key) => ({ key, rule: segmentRuleFromFilter(entry, resolveSegmentField(catalogue, entry)) })));
  const nextKey = useRef(rows.length);
  const byId = (id: string) => catalogue.find(entry => entry.id === id)
    ?? resolveSegmentField(catalogue, { field: id.slice(id.indexOf(':') + 1), object: id.startsWith('company:') ? 'company' : id.startsWith('behaviors:') ? 'behaviors' : 'lead', operator: '=', filter: '' });
  const fieldChoices = (entry: SegmentFilterField): Choice[] =>
    entry.picker ? picker[entry.picker] : (entry.options ?? []).map(option => ({ value: option, label: option }));
  const fieldOptions: SelectorOptionType[] = [...new Set(catalogue.map(entry => entry.group))].map(group => ({
    type: 'section' as const, title: group,
    options: catalogue.filter(entry => entry.group === group).map(entry => ({ value: entry.id, label: entry.label })),
  }));

  function addRule() {
    const first = catalogue.find(entry => entry.id === 'lead:email') ?? catalogue[0];
    setRows(items => [...items, { key: nextKey.current++, rule: emptySegmentRule(first) }]);
  }

  function updateRule(key: number, patch: Partial<SegmentRule>) {
    setRows(items => items.map(item => item.key === key ? { ...item, rule: { ...item.rule, ...patch } } : item));
  }

  function changeField(key: number, id: string) {
    setRows(items => items.map(item => item.key === key ? { ...item, rule: emptySegmentRule(byId(id), item.rule.glue) } : item));
  }

  return <Modal title={segment ? 'Edit segment' : 'Create segment'} onClose={onClose} size="large">
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        const filters: SegmentFilter[] = rows.map(({ rule }, index) => segmentFilterFromRule(rule, byId(rule.field), index));
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
            <Text type="supporting" color="secondary">Automatically include contacts matching these conditions, or leave empty for manual membership. Rules join with AND first, then OR.</Text>
          </div>
          {rows.length < 20 ? <Button size="sm" label="Add rule" icon={<Plus size={14} />} onClick={addRule} /> : null}
        </div>
        {rows.map(({ key, rule }, index) => {
          const entry = byId(rule.field);
          const operators = segmentOperatorsFor(entry, rule.operator);
          return <div key={key} className="ov-step">
            <div className="ov-step-heading">
              <Text weight="medium">Rule {index + 1}</Text>
              <IconButton variant="ghost" size="sm" label={`Remove rule ${index + 1}`} icon={<Trash2 size={15} />}
                onClick={() => setRows(items => items.filter(item => item.key !== key))} />
            </div>
            <div className="ov-stack-sm">
              <div className={index > 0 ? 'ov-form-grid ov-form-grid--three' : 'ov-form-grid'}>
                {index > 0 ? <Selector label="Match" value={rule.glue}
                  options={[{ value: 'and', label: 'AND' }, { value: 'or', label: 'OR' }]}
                  onChange={value => updateRule(key, { glue: value === 'or' ? 'or' : 'and' })} /> : null}
                <Selector label="Field" value={rule.field} hasSearch
                  options={catalogue.some(item => item.id === rule.field) ? fieldOptions : [...fieldOptions, { value: rule.field, label: entry.label }]}
                  onChange={value => value && changeField(key, value)} />
                <Selector label="Operator" value={canonicalSegmentOperator(rule.operator)} options={operators.map(({ value, label }) => ({ value, label }))}
                  onChange={value => value && updateRule(key, { operator: value })} />
              </div>
              <SegmentValueInput field={entry} rule={rule} choices={fieldChoices(entry)} onChange={patch => updateRule(key, patch)} />
            </div>
          </div>;
        })}
      </div>
      <Feedback error={action.error} />
      <FormActions>
        <Button label="Cancel" onClick={onClose} />
        <Button type="submit" variant="primary" label={segment ? 'Save segment' : 'Create segment'} isLoading={action.busy} isDisabled={!values.name.trim()} />
      </FormActions>
    </form>
  </Modal>;
}

function SegmentPreview({ segment, onClose }: { segment: Segment; onClose: () => void }) {
  const members = useResource<Page<Contact>>(`${contactsPath}?segmentId=${segment.id}&limit=50`);
  return <Modal title={`Members of “${segment.name}”`} onClose={onClose} size="large">
    <div className="ov-stack-sm">
      <Text type="supporting" color="secondary">
        {segment.contactCount == null ? 'Member count not reported yet.' : `${number(segment.contactCount)} member${segment.contactCount === 1 ? '' : 's'} counted by the engine.`}
        {' '}Rebuilds run on the engine’s schedule, so recent rule or contact changes may not show until its next run.
      </Text>
      {!members.data ? <AsyncState loading={members.loading} error={members.error} retry={members.refresh} />
        : members.data.items.length ? <>
          <Rows>{members.data.items.map(item => <li key={item.id}>
            <span className="ov-cell">
              <Text>{[item.firstName, item.lastName].filter(Boolean).join(' ') || item.email || `Contact ${item.id}`}</Text>
              {item.email ? <Text type="supporting" color="secondary">{item.email}</Text> : null}
            </span>
          </li>)}</Rows>
          {members.data.total > members.data.items.length
            ? <Text type="supporting" color="secondary">Showing the first {number(members.data.items.length)} of {number(members.data.total)} identified members.</Text> : null}
        </> : <Empty title="No members yet" description="Nobody is in this segment as of the engine’s last rebuild." />}
      <FormActions><Button label="Close" onClick={onClose} /></FormActions>
    </div>
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

const pointPickers: Record<string, { key: string; label: string; path: string; empty: string } | undefined> = {
  'email.open': { key: 'emails', label: 'Only these emails', path: '/journey-emails', empty: 'Any email' },
  'email.send': { key: 'emails', label: 'Only these emails', path: '/journey-emails', empty: 'Any email' },
  'form.submit': { key: 'forms', label: 'Only these forms', path: '/forms', empty: 'Any form' },
  'page.hit': { key: 'pages', label: 'Only these landing pages', path: '/pages', empty: 'Any landing page' },
  'asset.download': { key: 'assets', label: 'Only these assets', path: '/assets', empty: 'Any asset' },
};

function PointActionForm({
  rule, typeMap, onClose, onDone,
}: { rule?: PointAction; typeMap: Record<string, string>; onClose: () => void; onDone: () => void }) {
  const action = useAction();
  const mergedTypes = { ...fallbackPointActionTypes, ...typeMap };
  const options = Object.entries(mergedTypes).map(([value, label]) => ({ value, label: cleanLabel(label) || prettifyKey(value) }));
  if (rule?.type && !options.some(option => option.value === rule.type)) {
    options.push({ value: rule.type, label: prettifyKey(rule.type) });
  }
  const { values, field } = useFields({ name: rule?.name ?? '', description: rule?.description ?? '' });
  const [type, setType] = useState<string>(rule?.type || options[0]?.value || 'email.open');
  const [delta, setDelta] = useState(rule?.delta ?? 10);
  const [published, setPublished] = useState(rule?.published ?? true);
  const [repeatable, setRepeatable] = useState(rule?.repeatable ?? false);
  const [groupId, setGroupId] = useState<string | null>(rule?.groupId ? String(rule.groupId) : null);
  const [properties, setProperties] = useState<Record<string, unknown>>(rule?.properties ?? {});
  const picker = pointPickers[type];
  const choices = useResource<{ id: number; name?: string; title?: string; subject?: string }[]>(picker?.path ?? null);
  const groups = useResource<{ id: number; name: string }[]>('/point-groups');
  const chosen = picker && Array.isArray(properties[picker.key]) ? (properties[picker.key] as unknown[]).map(String) : [];
  const text = (key: string) => String(properties[key] ?? '');
  const patch = (key: string, value: unknown) => setProperties(current => ({ ...current, [key]: value }));
  const needsUrl = type === 'url.hit';

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
          repeatable,
          groupId: groupId ? Number(groupId) : null,
          properties: picker ? { [picker.key]: chosen.map(Number) } : needsUrl ? properties : {},
        });
        onDone();
      });
    }}>
      <TextInput label="Rule name" isRequired {...field('name')} />
      <div className="ov-form-grid">
        <Selector label="Action type" value={type} options={options} onChange={value => { setType(value ?? options[0]?.value ?? 'email.open'); setProperties({}); }} />
        <NumberInput label="Points delta" description="Positive to add, negative to deduct." min={-10000} max={10000} isIntegerOnly value={delta} onChange={setDelta} />
      </div>
      {picker ? <fieldset className="ov-stack-sm" style={{ border: 0, padding: 0, margin: 0 }}>
        <Text weight="semibold">{picker.label}</Text>
        <Text type="supporting" color="secondary">{chosen.length ? `${number(chosen.length)} selected.` : `${picker.empty}: leave everything unticked.`}</Text>
        {(choices.data ?? []).map(item => <CheckboxInput key={item.id} label={item.name || item.title || item.subject || `#${item.id}`}
          value={chosen.includes(String(item.id))}
          onChange={on => patch(picker.key, on ? [...chosen, String(item.id)] : chosen.filter(entry => entry !== String(item.id)))} />)}
      </fieldset> : null}
      {needsUrl ? <div className="ov-stack-sm">
        <TextInput label="URL" description="The tracked page address that earns points. Use * as a wildcard." isRequired value={text('page_url')} onChange={value => patch('page_url', value)} />
        <NumberInput label="Hits needed" description="0 awards points on every hit." min={0} isIntegerOnly value={Number(properties.page_hits ?? 0)} onChange={value => patch('page_hits', value)} />
        <Switch label="First visit only" value={properties.first_time === true} onChange={value => patch('first_time', value)} />
      </div> : null}
      <div className="ov-form-grid">
        <Selector label="Point group" placeholder="No group" hasClear value={groupId} options={(groups.data ?? []).map(item => ({ value: String(item.id), label: item.name }))} onChange={setGroupId} />
        <Switch label="Repeatable" description="Award the points each time, not only the first time." value={repeatable} onChange={setRepeatable} />
      </div>
      <TextArea label="Description" rows={2} isOptional {...field('description')} />
      <Switch label="Published" value={published} onChange={setPublished} />
      <Feedback error={action.error} />
      <FormActions>
        <Button label="Cancel" onClick={onClose} />
        <Button type="submit" variant="primary" label={rule ? 'Save rule' : 'Create rule'} isLoading={action.busy} isDisabled={!values.name.trim() || !type || (needsUrl && !text('page_url').trim())} />
      </FormActions>
    </form>
  </Modal>;
}

type TriggerSource = 'segments' | 'tags' | 'stages' | 'emails' | 'campaigns';
type TriggerField = {
  key: string;
  label: string;
  kind: 'pick' | 'pickOne' | 'ids' | 'text' | 'flag';
  source?: TriggerSource;
  description?: string;
};
type EventDraft = { key: number; id?: number; type: PointTriggerEventType; values: Record<string, string | string[] | boolean> };

const triggerEventKinds: Record<PointTriggerEventType, { label: string; fields: TriggerField[] }> = {
  'lead.changelists': { label: 'Change segments', fields: [
    { key: 'addToLists', label: 'Add contact to segments', kind: 'pick', source: 'segments' },
    { key: 'removeFromLists', label: 'Remove contact from segments', kind: 'pick', source: 'segments' },
  ] },
  'lead.changetags': { label: 'Change tags', fields: [
    { key: 'add_tags', label: 'Add tags', kind: 'pick', source: 'tags' },
    { key: 'remove_tags', label: 'Remove tags', kind: 'pick', source: 'tags' },
  ] },
  'lead.changestage': { label: 'Change lifecycle stage', fields: [
    { key: 'addstage', label: 'Move contact to stage', kind: 'pickOne', source: 'stages' },
  ] },
  'email.send': { label: 'Send email to the contact', fields: [
    { key: 'email', label: 'Email to send', kind: 'pickOne', source: 'emails' },
  ] },
  'email.send_to_user': { label: 'Send email to a user', fields: [
    { key: 'useremail', label: 'Email to send', kind: 'pickOne', source: 'emails' },
    { key: 'user_id', label: 'User ids', kind: 'ids', description: 'Numeric ids of the users to notify, separated by commas.' },
    { key: 'to_owner', label: 'Also send to the contact owner', kind: 'flag' },
    { key: 'to', label: 'Other recipients', kind: 'text', description: 'Email addresses separated by commas.' },
    { key: 'cc', label: 'Cc', kind: 'text' },
    { key: 'bcc', label: 'Bcc', kind: 'text' },
  ] },
  'campaign.changecampaign': { label: 'Change campaigns', fields: [
    { key: 'addTo', label: 'Add contact to campaigns', kind: 'pick', source: 'campaigns' },
    { key: 'removeFrom', label: 'Remove contact from campaigns', kind: 'pick', source: 'campaigns' },
  ] },
  'plugin.leadpush': { label: 'Push contact to an integration', fields: [
    { key: 'integration', label: 'Integration name', kind: 'text', description: 'The integration key, for example Hubspot.' },
  ] },
};
// Mautic 7.2.2 registers campaign.changecampaign with a callback that does not exist
// (CampaignBundle/EventListener/PointSubscriber.php:27), so the engine never runs it. Existing events still load.
const triggerEventTypeOptions = (Object.keys(triggerEventKinds) as PointTriggerEventType[])
  .filter(type => type !== 'campaign.changecampaign')
  .map(type => ({ value: type, label: triggerEventKinds[type].label }));

function draftFromEvent(key: number, event: { id?: number; type: string; properties?: Record<string, unknown> }): EventDraft | null {
  if (!(event.type in triggerEventKinds)) return null;
  const type = event.type as PointTriggerEventType;
  const properties = event.properties ?? {};
  const values: EventDraft['values'] = {};
  for (const item of triggerEventKinds[type].fields) {
    const raw = item.key === 'useremail' ? (properties.useremail as { email?: unknown } | undefined)?.email : properties[item.key];
    if (item.kind === 'flag') values[item.key] = raw === true || raw === 1 || raw === '1';
    else if (item.kind === 'pick') values[item.key] = Array.isArray(raw) ? raw.map(String) : [];
    else if (item.kind === 'ids') values[item.key] = Array.isArray(raw) ? raw.join(', ') : '';
    else values[item.key] = raw === undefined || raw === null ? '' : String(raw);
  }
  return { key, id: event.id, type, values };
}

function eventFromDraft(draft: EventDraft): PointTriggerEventInput {
  const properties: Record<string, unknown> = {};
  for (const item of triggerEventKinds[draft.type].fields) {
    const value = draft.values[item.key];
    if (item.kind === 'flag') properties[item.key] = value === true;
    else if (item.kind === 'pick') {
      const chosen = Array.isArray(value) ? value : [];
      properties[item.key] = item.source === 'tags' ? chosen : chosen.map(Number);
    } else if (item.kind === 'ids') {
      properties[item.key] = String(value ?? '').split(',').map(part => part.trim()).filter(Boolean).map(Number);
    } else if (item.kind === 'pickOne') {
      const chosen = Number(value);
      properties[item.key] = item.key === 'useremail' ? { email: chosen } : chosen;
    } else properties[item.key] = String(value ?? '').trim();
  }
  return { ...(draft.id ? { id: draft.id } : {}), type: draft.type, properties };
}

function PointTriggerForm({ trigger, onClose, onDone }: { trigger?: PointTrigger; onClose: () => void; onDone: () => void }) {
  const action = useAction();
  const { values, field } = useFields({ name: trigger?.name ?? '', description: trigger?.description ?? '' });
  const [points, setPoints] = useState(trigger?.points ?? 50);
  const [published, setPublished] = useState(trigger?.published ?? true);
  const [triggerExistingLeads, setTriggerExistingLeads] = useState(trigger?.triggerExistingLeads ?? false);
  const [drafts, setDrafts] = useState<EventDraft[]>(() =>
    (trigger?.events ?? []).flatMap((event, index) => draftFromEvent(index, event) ?? []));
  const [eventsChanged, setEventsChanged] = useState(false);
  const [nextKey, setNextKey] = useState(trigger?.events.length ?? 0);
  const [newType, setNewType] = useState<PointTriggerEventType>('lead.changetags');
  const segments = useResource<Segment[]>(segmentPath);
  const tags = useResource<Tag[]>(tagPath);
  const stages = useResource<Stage[]>(stagePath);
  const emails = useResource<JourneyEmail[]>('/journey-emails');
  const campaigns = useResource<Workflow[]>('/workflows');
  const choices: Record<TriggerSource, { value: string; label: string }[]> = {
    segments: optionsOf(segments.data),
    tags: (tags.data ?? []).map(item => ({ value: item.tag, label: item.tag })),
    stages: optionsOf(stages.data),
    emails: optionsOf(emails.data?.filter(item => item.published)),
    campaigns: optionsOf(campaigns.data),
  };
  const skipped = (trigger?.events.length ?? 0) - (trigger?.events.filter(event => event.type in triggerEventKinds).length ?? 0);

  function update(key: number, next: (draft: EventDraft) => EventDraft) {
    setDrafts(current => current.map(draft => draft.key === key ? next(draft) : draft));
    setEventsChanged(true);
  }

  return <Modal title={trigger ? 'Edit score trigger' : 'Create score trigger'} onClose={onClose} size="large">
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        if (!drafts.length) throw new Error('Add at least one event. A trigger with no events does nothing.');
        await api(trigger ? `${pointTriggerPath}/${trigger.id}` : pointTriggerPath, trigger ? 'PATCH' : 'POST', {
          name: values.name.trim(),
          description: values.description.trim(),
          points,
          published,
          triggerExistingLeads,
          ...(!trigger || eventsChanged ? { events: drafts.map(eventFromDraft) } : {}),
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
      <Text weight="semibold">Events</Text>
      <Text type="supporting" color="secondary">What happens when a contact reaches the threshold. A trigger with no events does nothing.</Text>
      {skipped > 0 ? <Text type="supporting" color="secondary">{skipped} event{skipped === 1 ? '' : 's'} of an unsupported type {skipped === 1 ? 'is' : 'are'} kept until you change events here.</Text> : null}
      {drafts.map((draft, index) => <Panel key={draft.key} title={`${index + 1}. ${triggerEventKinds[draft.type].label}`}
        action={<Button size="sm" variant="ghost" label="Remove" icon={<Trash2 size={14} />} onClick={() => {
          setDrafts(current => current.filter(item => item.key !== draft.key));
          setEventsChanged(true);
        }} />}>
        <div className="ov-stack-sm">
          {triggerEventKinds[draft.type].fields.map(item => {
            const value = draft.values[item.key];
            const set = (next: string | string[] | boolean) => update(draft.key, current => ({ ...current, values: { ...current.values, [item.key]: next } }));
            if (item.kind === 'flag') return <CheckboxInput key={item.key} label={item.label} value={value === true} onChange={set} />;
            if (item.kind === 'pickOne') {
              return <Selector key={item.key} label={item.label} placeholder="Select an option" value={String(value || '') || null} hasClear
                options={choices[item.source!]} onChange={next => set(next ?? '')} />;
            }
            if (item.kind === 'pick') {
              const chosen = Array.isArray(value) ? value : [];
              const options = choices[item.source!];
              return <fieldset key={item.key} className="ov-stack-sm" style={{ border: 0, padding: 0, margin: 0 }}>
                <Text weight="semibold">{item.label}</Text>
                {options.length ? options.map(option => <CheckboxInput key={option.value} label={option.label} value={chosen.includes(option.value)}
                  onChange={on => set(on ? [...chosen, option.value] : chosen.filter(entry => entry !== option.value))} />)
                  : <Text type="supporting" color="secondary">Nothing to choose from yet.</Text>}
              </fieldset>;
            }
            return <TextInput key={item.key} label={item.label} description={item.description} isOptional
              value={String(value ?? '')} onChange={set} />;
          })}
        </div>
      </Panel>)}
      <div className="ov-toolbar">
        <Selector label="Event type" value={newType} options={triggerEventTypeOptions}
          onChange={value => setNewType((value as PointTriggerEventType) || 'lead.changetags')} width={260} />
        <Button label="Add event" icon={<Plus size={14} />} onClick={() => {
          setDrafts(current => [...current, draftFromEvent(nextKey, { type: newType })!]);
          setNextKey(nextKey + 1);
          setEventsChanged(true);
        }} />
      </div>
      <AsyncState loading={segments.loading || tags.loading || stages.loading || emails.loading || campaigns.loading}
        error={segments.error || tags.error || stages.error || emails.error || campaigns.error} retry={() => {
          segments.refresh(); tags.refresh(); stages.refresh(); emails.refresh(); campaigns.refresh();
        }} />
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

/* ── Do not contact (AUD-08) ─────────────────────────────────────────────── */

const dncReasonChoices = [
  { value: 'unsubscribed', label: 'Unsubscribed' },
  { value: 'bounced', label: 'Bounced' },
  { value: 'manual', label: 'Manual' },
];
const dncChannelChoices = [{ value: 'email', label: 'Email' }, { value: 'sms', label: 'SMS' }];
const dncReasonLabel: Record<string, string> = { unsubscribed: 'Unsubscribed', bounced: 'Bounced', manual: 'Manual' };

function DncPanel({ contact, path, busy, mutate }: {
  contact: ContactDetail; path: string; busy: boolean; mutate: (task: () => Promise<unknown>, success: string) => void;
}) {
  const [channel, setChannel] = useState('email');
  const [reason, setReason] = useState('manual');
  const [comment, setComment] = useState('');
  const [removing, setRemoving] = useState<string>();
  const [evidence, setEvidence] = useState('');
  const [fixed, setFixed] = useState(false);
  const entries = contact.dnc ?? [];
  const hasEntry = entries.some(entry => entry.channel === channel);
  return <Panel title="Do not contact" description="One entry per channel. Email entries are kept in OVELIO and mirrored to the audience and newsletter engines; text messages go straight to the audience engine.">
    {entries.length ? <Rows>{entries.map(entry => <li key={entry.channel}>
      <span>
        <span className="ov-actions">
          <StatusBadge label={entry.channel.toUpperCase()} tone="neutral" />
          <StatusBadge label={dncReasonLabel[entry.reason] ?? entry.reason} tone={entry.reason === 'bounced' ? 'error' : 'warning'} />
        </span>
        <Text type="supporting" color="secondary">{entry.comment || 'No comment'}</Text>
      </span>
      <span className="ov-actions">
        {entry.at ? <Timestamp value={entry.at} format="date_time" /> : null}
        <Button size="sm" variant="ghost" label="Remove" isDisabled={busy} onClick={() => { setRemoving(entry.channel); setFixed(false); setEvidence(''); }} />
      </span>
    </li>)}</Rows> : <Text color="secondary">This contact can be contacted on every channel.</Text>}
    {removing ? <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      if (!evidence.trim()) return;
      mutate(() => api(`${path}/dnc/${removing}/remove`, 'POST', { evidence: evidence.trim(), ...(removing === 'email' ? { confirmFixed: fixed } : {}) }), 'Do-not-contact removed.');
      setRemoving(undefined);
    }}>
      <TextInput label={`Why can this contact be reached by ${removing === 'sms' ? 'text message' : 'email'} again?`} placeholder="Source and date" isRequired value={evidence} onChange={setEvidence} />
      {removing === 'email' ? <>
        <CheckboxInput label="The address has been fixed (required after a bounce or complaint)" value={fixed} onChange={setFixed} />
        <Text type="supporting" color="secondary">Removing the entry does not record consent. Consent stays unknown until you record an opt-in.</Text>
      </> : null}
      <FormActions>
        <Button label="Cancel" onClick={() => setRemoving(undefined)} />
        <Button type="submit" variant="destructive" label="Remove do-not-contact" isDisabled={busy || !evidence.trim()} />
      </FormActions>
    </form> : <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      if (!comment.trim() || hasEntry) return;
      mutate(() => api(`${path}/dnc/${channel}`, 'POST', { reason, comment: comment.trim() }), 'Do-not-contact added.');
      setComment('');
    }}>
      <div className="ov-form-grid">
        <Selector label="Channel" value={channel} options={dncChannelChoices} onChange={value => setChannel(value ?? 'email')} />
        <Selector label="Reason" value={reason} options={dncReasonChoices} onChange={value => setReason(value ?? 'manual')} />
      </div>
      <TextInput label="Comment" placeholder="Why, and where the request came from" isRequired value={comment} onChange={setComment} />
      <FormActions><Button type="submit" label="Add do-not-contact" isDisabled={busy || !comment.trim() || hasEntry} /></FormActions>
    </form>}
  </Panel>;
}

/* ── Custom Fields & Direct Email Modals ───────────────────────────────────── */

function CustomFieldForm({
  object,
  existing,
  onClose,
  onDone,
}: {
  object: CustomFieldObject;
  existing?: CustomField;
  onClose: () => void;
  onDone: () => void;
}) {
  const action = useAction();
  const { values, field } = useFields({
    label: existing?.label ?? '',
    alias: existing?.alias ?? '',
    defaultValue: existing?.defaultValue ?? '',
    optionsText: (existing?.options ?? []).join(', '),
  });
  const [type, setType] = useState<CustomFieldType>(
    customFieldTypes.some(item => item.value === existing?.type) ? (existing!.type as CustomFieldType) : 'text',
  );
  const [group, setGroup] = useState<CustomFieldGroup>(
    existing?.group && validFieldGroups.has(existing.group) ? (existing.group as CustomFieldGroup) : 'core',
  );
  const [isRequired, setIsRequired] = useState(existing?.isRequired ?? false);
  const [isPubliclyUpdatable, setIsPubliclyUpdatable] = useState(existing?.isPubliclyUpdatable ?? false);
  const [published, setPublished] = useState(existing?.published ?? true);

  const activeType = existing ? existing.type : type;
  const needsOptions = isChoiceFieldType(activeType);

  return <Modal title={existing ? `Edit ${object} field` : `Create ${object} field`} onClose={onClose} size="large">
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        const cleanLabel = values.label.trim();
        if (!cleanLabel) throw new Error('Enter a field label.');

        const cleanAlias = values.alias.trim().toLowerCase();
        if (!existing && cleanAlias && !/^[a-z][a-z0-9_]{0,59}$/.test(cleanAlias)) {
          throw new Error('Alias must start with a lowercase letter and use only lowercase letters, numbers and underscores.');
        }

        let options: string[] | undefined;
        if (needsOptions) {
          options = [...new Set(values.optionsText.split(',').map(item => item.trim()).filter(Boolean))];
          if (!options.length) throw new Error('Enter at least one option separated by commas.');
          if (options.length > 50) throw new Error('Enter up to 50 options.');
        }

        if (existing) {
          await api(`${fieldPath}/${object}/${existing.id}`, 'PATCH', {
            label: cleanLabel,
            group,
            defaultValue: values.defaultValue.trim(),
            isRequired,
            isPubliclyUpdatable,
            published,
            ...(needsOptions ? { options } : {}),
          });
        } else {
          await api(`${fieldPath}/${object}`, 'POST', {
            label: cleanLabel,
            ...(cleanAlias ? { alias: cleanAlias } : {}),
            type,
            group,
            ...(values.defaultValue.trim() ? { defaultValue: values.defaultValue.trim() } : {}),
            isRequired,
            isPubliclyUpdatable,
            published,
            ...(needsOptions ? { options } : {}),
          });
        }
        onDone();
      });
    }}>
      {existing ? (
        <Text type="supporting" color="secondary">
          Alias: {existing.alias} · Type: {fieldTypeLabels[existing.type] ?? prettifyKey(existing.type)}
        </Text>
      ) : null}
      <TextInput label="Label" isRequired {...field('label')} />
      {!existing ? (
        <div className="ov-form-grid">
          <TextInput label="Alias" description="Optional. Lowercase letters, numbers and underscores." placeholder="e.g. account_tier" isOptional {...field('alias')} />
          <Selector label="Field type" value={type}
            options={customFieldTypes.map(item => ({ value: item.value, label: item.label }))}
            onChange={value => setType((value as CustomFieldType) || 'text')} />
        </div>
      ) : null}
      <div className="ov-form-grid">
        <Selector label="Group" value={group}
          options={customFieldGroups.map(item => ({ value: item.value, label: item.label }))}
          onChange={value => setGroup((value as CustomFieldGroup) || 'core')} />
        <TextInput label="Default value" isOptional {...field('defaultValue')} />
      </div>
      {needsOptions ? (
        <TextInput label="Options" description="Separate choices with commas (up to 50 options)." placeholder="Starter, Growth, Enterprise"
          isRequired {...field('optionsText')} />
      ) : null}
      <div className="ov-stack-sm">
        <Switch label="Required" description="Require a value when creating or updating records." value={isRequired} onChange={setIsRequired} />
        <Switch label="Publicly updatable" description="Allow tracking parameters and embedded forms to update this field." value={isPubliclyUpdatable} onChange={setIsPubliclyUpdatable} />
        <Switch label="Published" description="Published fields are available across forms, segments and profiles." value={published} onChange={setPublished} />
      </div>
      <Feedback error={action.error} />
      <FormActions>
        <Button label="Cancel" onClick={onClose} />
        <Button type="submit" variant="primary" label={existing ? 'Save field' : 'Create field'}
          isLoading={action.busy} isDisabled={!values.label.trim() || (needsOptions && !values.optionsText.trim())} />
      </FormActions>
    </form>
  </Modal>;
}

function CustomFieldsTab({
  object,
  onObjectChange,
  modal,
  onModalChange,
  onNotice,
}: {
  object: CustomFieldObject;
  onObjectChange: (next: CustomFieldObject) => void;
  modal: 'new' | CustomField | undefined;
  onModalChange: (next: 'new' | CustomField | undefined) => void;
  onNotice: (message: string) => void;
}) {
  const fields = useResource<CustomField[]>(`${fieldPath}/${object}`);
  const action = useAction();
  const [filter, setFilter] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<CustomField>();

  const query = filter.trim().toLowerCase();
  const visibleFields = (fields.data ?? []).filter(item =>
    !query
    || item.label.toLowerCase().includes(query)
    || item.alias.toLowerCase().includes(query)
    || item.type.toLowerCase().includes(query)
    || item.group.toLowerCase().includes(query),
  );

  return <>
    <Panel
      title={object === 'company' ? 'Company custom fields' : 'Contact custom fields'}
      description={fields.data
        ? `${number(fields.data.length)} ${object} field${fields.data.length === 1 ? '' : 's'} configured.`
        : 'Define structured attributes stored on contact and company profiles.'}
    >
      <div className="ov-toolbar">
        <SegmentedControl label="Field object" value={object}
          onChange={value => {
            onObjectChange(value === 'company' ? 'company' : 'contact');
            setFilter('');
          }}>
          <SegmentedControlItem value="contact" label="Contact fields" />
          <SegmentedControlItem value="company" label="Company fields" />
        </SegmentedControl>
        <TextInput label="Filter custom fields" isLabelHidden type="search" startIcon="search"
          placeholder="Filter by label or alias" value={filter} onChange={setFilter} width={250} />
      </div>
      <Feedback error={action.error} />
      {!fields.data ? <AsyncState loading={fields.loading} error={fields.error} retry={fields.refresh} />
        : <Table data={visibleFields} idKey="id" hasHover
          emptyState={<Empty title={query ? 'No matching fields' : `No ${object} fields yet`}
            description={query ? undefined : `Create a custom ${object} field to store structured attributes.`}
            action={query ? <Button label="Clear filter" onClick={() => setFilter('')} /> : undefined} />}
          columns={[
            {
              key: 'label',
              header: 'Label',
              renderCell: item => <span className="ov-cell">
                <Text weight="medium">{item.label}</Text>
                {item.defaultValue ? <Text type="supporting" color="secondary">Default: {item.defaultValue}</Text>
                  : item.options.length ? <Text type="supporting" color="secondary">{number(item.options.length)} option{item.options.length === 1 ? '' : 's'}</Text> : null}
              </span>,
            },
            {
              key: 'alias',
              header: 'Alias',
              renderCell: item => <Text type="supporting" color="secondary">{item.alias}</Text>,
            },
            {
              key: 'type',
              header: 'Type',
              renderCell: item => fieldTypeLabels[item.type] ?? prettifyKey(item.type),
            },
            {
              key: 'group',
              header: 'Group',
              renderCell: item => <StatusBadge label={fieldGroupLabels[item.group] ?? prettifyKey(item.group)} />,
            },
            {
              key: 'published',
              header: 'Status',
              renderCell: item => <span className="ov-tags">
                <StatusBadge label={item.published ? 'Published' : 'Draft'} tone={item.published ? 'success' : 'neutral'} />
                {item.isRequired ? <StatusBadge label="Required" tone="warning" /> : null}
                {item.isPubliclyUpdatable ? <StatusBadge label="Public" tone="info" /> : null}
                {item.isFixed ? <StatusBadge label="Built-in" tone="neutral" /> : null}
              </span>,
            },
            {
              key: 'id',
              header: 'Actions',
              align: 'end',
              width: pixel(180),
              renderCell: item => <span className="ov-actions ov-actions--end">
                <Button size="sm" variant="ghost" label="Edit" icon={<Pencil size={14} />} onClick={() => onModalChange(item)} />
                <Button size="sm" variant="ghost" label="Delete" icon={<Trash2 size={14} />}
                  isDisabled={item.isFixed || action.busy}
                  tooltip={item.isFixed ? 'Built-in fields cannot be deleted.' : undefined}
                  onClick={() => setDeleteTarget(item)} />
              </span>,
            },
          ]} />}
    </Panel>

    {modal ? <CustomFieldForm
      object={object}
      existing={modal === 'new' ? undefined : modal}
      onClose={() => onModalChange(undefined)}
      onDone={() => {
        onNotice(modal === 'new' ? 'Custom field created.' : 'Custom field updated.');
        onModalChange(undefined);
        fields.refresh();
      }}
    /> : null}

    {deleteTarget ? <ConfirmDialog
      title={`Delete custom field “${deleteTarget.label}”`}
      description={`Remove this ${object} field permanently? Stored values for this field will no longer be accessible.`}
      actionLabel="Delete field"
      destructive
      busy={action.busy}
      onClose={() => setDeleteTarget(undefined)}
      onConfirm={() => {
        const target = deleteTarget;
        void action.run(async () => {
          try {
            await api(`${fieldPath}/${object}/${target.id}`, 'DELETE');
            fields.refresh();
            onNotice('Custom field deleted.');
          } finally {
            setDeleteTarget(undefined);
          }
        });
      }}
    /> : null}
  </>;
}

function SendContactEmailModal({ contact, onClose, onSent }: { contact: ContactDetail; onClose: () => void; onSent: () => void }) {
  const emails = useResource<JourneyEmail[]>('/journey-emails');
  const action = useAction();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const eligible = Boolean(contact.email && contact.consent === 'opted_in' && !contact.suppressed);
  const published = (emails.data ?? []).filter(item => item.published);
  const chosen = published.find(item => String(item.id) === selectedId);

  return <Modal title={`Send email to ${fullName(contact) || contact.email || `Contact #${contact.id}`}`} onClose={onClose}>
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      if (!eligible || !selectedId) return;
      void action.run(async () => {
        await api(`${contactsPath}/${contact.id}/send-email`, 'POST', { emailId: Number(selectedId) });
        onSent();
      });
    }}>
      {!eligible ? (
        <Banner
          status="warning"
          title="Direct email delivery is unavailable"
          description={contact.suppressed || contact.consent === 'suppressed'
            ? 'This contact is suppressed and cannot receive marketing emails.'
            : !contact.email
              ? 'Add an email address to this contact before sending.'
              : 'Record active opt-in consent before sending email to this contact.'}
        />
      ) : (
        <Text type="supporting" color="secondary">Recipient: {contact.email}</Text>
      )}
      {!emails.data ? <AsyncState loading={emails.loading} error={emails.error} retry={emails.refresh} />
        : !published.length ? (
          <Empty
            title="No published journey emails"
            description="Create and publish a journey email in Automations before sending direct messages."
            action={<Link href="/automations?tab=Journey+emails">Open journey emails</Link>}
          />
        ) : <>
          <Selector
            label="Journey email"
            placeholder="Select a published journey email"
            value={selectedId}
            hasClear
            onChange={setSelectedId}
            options={published.map(item => ({ value: String(item.id), label: item.name, description: item.subject }))}
          />
          {chosen ? <Text type="supporting" color="secondary">Subject: {chosen.subject}</Text> : null}
        </>}
      <Feedback error={action.error} />
      <FormActions>
        <Button label="Cancel" onClick={onClose} />
        <Button type="submit" variant="primary" label="Send email" icon={<Send size={14} />}
          isLoading={action.busy} isDisabled={!eligible || !selectedId || !published.length} />
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
  const [sortBy, setSortBy] = useState<ContactSortKey>('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [pageSize, setPageSize] = useState(25);
  const [viewId, setViewId] = useState<string | null>(null);
  const [viewName, setViewName] = useState('');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkAction, setBulkAction] = useState<BulkActionType>('add_tag');
  const [bulkTag, setBulkTag] = useState('');
  const [bulkSegmentId, setBulkSegmentId] = useState<string | null>(null);
  const [bulkPoints, setBulkPoints] = useState(10);

  // Companies, Bounces & Custom Fields state
  const [companyQuery, setCompanyQuery] = useState('');
  const [companySearch, setCompanySearch] = useState('');
  const [bouncePage, setBouncePage] = useState(1);
  const [fieldObject, setFieldObject] = useState<CustomFieldObject>('contact');

  // Modals
  const [contactModal, setContactModal] = useState(false);
  const [importModal, setImportModal] = useState(false);
  const [segmentModal, setSegmentModal] = useState<'new' | Segment>();
  const [previewSegment, setPreviewSegment] = useState<Segment>();
  const [listModal, setListModal] = useState<'new' | MailingList>();
  const [tagModal, setTagModal] = useState(false);
  const [stageModal, setStageModal] = useState<'new' | Stage>();
  const [companyModal, setCompanyModal] = useState<'new' | Company>();
  const [pointActionModal, setPointActionModal] = useState<'new' | PointAction>();
  const [pointTriggerModal, setPointTriggerModal] = useState<'new' | PointTrigger>();
  const [suppressModal, setSuppressModal] = useState(false);
  const [fieldModal, setFieldModal] = useState<'new' | CustomField>();
  const [confirmState, setConfirmState] = useState<ConfirmState>();

  // Resources
  const contacts = useResource<Page<Contact>>(tab === 'Contacts' ? `${contactsPath}?${new URLSearchParams({
    page: String(page),
    limit: String(pageSize),
    orderBy: sortBy,
    orderByDir: sortDir,
    ...(search ? { q: search } : {}),
    ...(segmentId ? { segmentId } : {}),
    ...(tagFilter ? { tag: tagFilter } : {}),
  })}` : null);
  const views = useResource<ContactView[]>(tab === 'Contacts' ? '/contact-views' : null);
  const segments = useResource<Segment[]>(tab === 'Contacts' || tab === 'Segments' ? segmentPath : null);
  const lists = useResource<MailingList[]>(tab === 'Mailing lists' ? listPath : null);
  const tags = useResource<Tag[]>(tab === 'Contacts' || tab === 'Tags & stages' ? tagPath : null);
  const stages = useResource<Stage[]>(tab === 'Tags & stages' ? stagePath : null);
  const companies = useResource<Company[] | Page<Company>>(tab === 'Companies' ? (companySearch ? `${companyPath}?${new URLSearchParams({ q: companySearch })}` : companyPath) : null);
  // The engine returns a list; the developer preview a page. Both render the same table.
  const companyRows = Array.isArray(companies.data) ? companies.data : companies.data?.items;
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
      case 'Custom fields':
        return <Button variant="primary" icon={<Plus size={16} />} label="Create custom field" onClick={() => setFieldModal('new')} />;
    }
  })();

  return <>
    <PageHeader title="Audience" description="Manage contacts, segmentation, scoring and email permissions." actions={headerActions} />
    <Tabs label="Audience view" items={tabs} value={tab} onChange={value => { setTab(value); setNotice(''); setSelectedIds([]); }} />
    <Feedback error={action.error} notice={notice || action.notice} />

    {tab === 'Contacts' ? <Panel title="Contact directory" description={contacts.data ? `${number(contacts.data.total)} contacts` : undefined}>
      <div className="ov-toolbar">
        <form onSubmit={event => { event.preventDefault(); setSearch(query.trim()); setPage(1); setSelectedIds([]); }}>
          <TextInput label="Search contacts" isLabelHidden type="search" startIcon="search" placeholder="Name, email or tag:vip is:unowned" value={query} onChange={setQuery} width={300} />
          <Button type="submit" label="Search" icon={<Search size={15} />} />
        </form>
        <div className="ov-actions">
          <Selector label="Sort by" isLabelHidden width={160} value={sortBy} options={sortChoices}
            onChange={value => { setSortBy((value as ContactSortKey) || 'createdAt'); setPage(1); }} />
          <Selector label="Sort direction" isLabelHidden width={130} value={sortDir} options={[{ value: 'desc', label: 'Newest first' }, { value: 'asc', label: 'Oldest first' }]}
            onChange={value => { setSortDir(value === 'asc' ? 'asc' : 'desc'); setPage(1); }} />
          <Selector label="Contacts per page" isLabelHidden width={120} value={String(pageSize)}
            options={['25', '50', '100', '250', '500'].map(value => ({ value, label: `${value} per page` }))}
            onChange={value => { setPageSize(Number(value) || 25); setPage(1); setSelectedIds([]); }} />
          <Selector label="Segment filter" isLabelHidden width={210} value={segmentId || 'all'}
            options={[{ value: 'all', label: 'All segments' }, ...optionsOf(segments.data)]}
            onChange={value => { setSegmentId(value && value !== 'all' ? value : ''); setPage(1); setSelectedIds([]); }} />
          <Selector label="Tag filter" isLabelHidden width={190} value={tagFilter || 'all'}
            options={[{ value: 'all', label: 'All tags' }, ...(tags.data ?? []).map(item => ({ value: item.tag, label: item.tag }))]}
            onChange={value => { setTagFilter(value && value !== 'all' ? value : ''); setPage(1); setSelectedIds([]); }} />
          {filtered ? <Button size="sm" variant="ghost" label="Clear filters" onClick={clearContactFilters} /> : null}
        </div>
      </div>

      <div className="ov-toolbar">
        <Selector label="Saved views" isLabelHidden width={220} placeholder="Saved views" hasClear value={viewId}
          options={(views.data ?? []).map(item => ({ value: item.id, label: item.name }))}
          onChange={value => {
            setViewId(value);
            const chosen = views.data?.find(item => item.id === value);
            if (!chosen) return;
            setSearch(chosen.search); setQuery(chosen.search); setSortBy(chosen.sortBy); setSortDir(chosen.sortDir);
            setSegmentId(''); setTagFilter(''); setPage(1); setSelectedIds([]);
          }} />
        <TextInput label="View name" isLabelHidden placeholder="Name this view" value={viewName} onChange={setViewName} width={180} />
        <Button size="sm" label="Save view" isLoading={action.busy} isDisabled={!viewName.trim()}
          onClick={() => void action.run(async () => {
            const saved = await api<ContactView>('/contact-views', 'POST', { name: viewName.trim(), search, sortBy, sortDir });
            setViewId(saved.id); setViewName(''); views.refresh(); setNotice('View saved for the team.');
          })} />
        {viewId ? <Button size="sm" variant="ghost" label="Delete view" icon={<Trash2 size={14} />}
          onClick={() => void action.run(async () => { await api(`/contact-views/${viewId}`, 'DELETE'); setViewId(null); views.refresh(); })} /> : null}
        <Text type="supporting" color="secondary">Search commands: {contactSearchCommands.slice(0, 8).map(item => item.example).join(', ')} and more.</Text>
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
                <Link href={`/crm/contacts/${contact.id}`}>{fullName(contact) || contact.email || `Contact ${contact.id}`}</Link>
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

    {tab === 'Segments' ? <Panel title="Segments" description="Build dynamic or manual groups for automations and synchronise opted-in members for newsletters. Rebuilds run on the engine's schedule, so counts and members can lag behind recent changes.">
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
            {
              key: 'contactCount',
              header: 'Members',
              align: 'end',
              renderCell: group => group.contactCount == null ? <Text color="secondary">—</Text> : <Text>{number(group.contactCount)}</Text>,
            },
            {
              key: 'lastBuiltAt',
              header: 'Last built',
              renderCell: group => group.lastBuiltAt ? <Timestamp value={group.lastBuiltAt} /> : <Text color="secondary">Not reported</Text>,
            },
            { key: 'published', header: 'Status', renderCell: group => <StatusBadge label={group.published ? 'Published' : 'Draft'} tone={group.published ? 'success' : 'neutral'} /> },
            {
              key: 'alias',
              header: 'Actions',
              align: 'end',
              renderCell: group => <span className="ov-actions ov-actions--end">
                <Button size="sm" variant="ghost" label="Preview" icon={<Search size={14} />} onClick={() => setPreviewSegment(group)} />
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
      {!companyRows ? <AsyncState loading={companies.loading} error={companies.error} retry={companies.refresh} />
        : <Table data={companyRows} idKey="id" hasHover
          emptyState={<Empty title={companySearch ? 'No companies match this search' : 'No companies yet'}
            description={companySearch ? undefined : 'Add organisations to group B2B accounts.'} />}
          columns={[
            {
              key: 'name',
              header: 'Company',
              renderCell: item => <span className="ov-cell">
                <Link href={`/crm/companies/${item.id}`}>{item.name}</Link>
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
              { key: 'comment', header: 'Comment', renderCell: record => record.comment || '—' },
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

    {tab === 'Custom fields' ? (
      <CustomFieldsTab
        object={fieldObject}
        onObjectChange={setFieldObject}
        modal={fieldModal}
        onModalChange={setFieldModal}
        onNotice={setNotice}
      />
    ) : null}

    {contactModal ? <ContactForm onClose={() => setContactModal(false)} onDone={contact => router.push(`/audience/${contact.id}`)} /> : null}
    {importModal ? <ImportForm onClose={() => setImportModal(false)} onImported={() => { contacts.refresh(); setNotice('Import processed.'); }} /> : null}
    {previewSegment ? <SegmentPreview segment={previewSegment} onClose={() => setPreviewSegment(undefined)} /> : null}
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

/** The engine record: consent, do-not-contact, segments, lists, notes, devices and GDPR export or erasure. `embedded` drops
 * the page header so the CRM profile (src/components/crm/profiles.tsx) can show it as a tab. */
export function ContactView({ id, embedded = false }: { id: string; embedded?: boolean }) {
  const user = useUser();
  const router = useRouter();
  const path = `${contactsPath}/${id}`;
  const resource = useResource<ContactDetail>(path);
  const segments = useResource<Segment[]>(segmentPath);
  const mailingLists = useResource<MailingList[]>(listPath);
  const stages = useResource<Stage[]>(stagePath);
  const workflows = useResource<Workflow[]>('/workflows');
  const fieldDefinitions = useResource<CustomField[]>(`${fieldPath}/contact`);
  const action = useAction();

  const [modal, setModal] = useState<'edit' | 'delete' | 'send-email' | 'clear-bounces'>();
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
  const linkedCompanies = contact?.linkedCompanies ?? [];
  const devices = contact?.devices ?? [];
  const newsletterViews = contact?.newsletterActivity?.views ?? [];
  const newsletterClicks = contact?.newsletterActivity?.clicks ?? [];
  const contactBounces = contact?.subscriberBounces ?? [];
  const canSendEmail = Boolean(contact && contact.email && contact.consent === 'opted_in' && !contact.suppressed);
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

  const headerActions = contact ? <>
        <Button label={embedded ? "Send journey email" : "Send email"} icon={<Send size={15} />} isDisabled={action.busy || !canSendEmail}
          tooltip={!contact.email
            ? 'Add an email address before sending.'
            : contact.suppressed || contact.consent === 'suppressed'
              ? 'Marketing emails are blocked because this contact is suppressed.'
              : contact.consent !== 'opted_in'
                ? 'Record active opt-in consent before sending a direct email.'
                : undefined}
          onClick={() => setModal('send-email')} />
        {user.role === 'admin' ? <>
          <Button label="Export contact" icon={<Download size={15} />} isDisabled={action.busy}
            onClick={() => void action.run(async () => saveFile(JSON.stringify(await api(`${path}/export`), null, 2), `ovelio-contact-${id}.json`, 'application/json'))} />
          <Button label="Delete contact" variant="destructive" onClick={() => setModal('delete')} />
        </> : null}
        <Button label="Edit contact" variant="primary" onClick={() => setModal('edit')} />
      </> : undefined;

  return <>
    {embedded ? (headerActions ? <div className="ov-actions ov-actions--end">{headerActions}</div> : null)
      : <PageHeader back={{ href: '/crm', label: 'Contacts' }} title={contact ? fullName(contact) || contact.email || 'Contact' : 'Contact'}
        description={contact?.email || 'Contact record and preferences.'} actions={headerActions} />}

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

        {(fieldDefinitions.data ?? []).some(item => item.published && !coreFieldAliases.has(item.alias)) ? <Panel title="Custom fields"
          description="Values from your contact field definitions."
          action={<Button size="sm" variant="ghost" label="Edit" icon={<Pencil size={14} />} onClick={() => setModal('edit')} />}>
          <MetadataList>
            {(fieldDefinitions.data ?? []).filter(item => item.published && !coreFieldAliases.has(item.alias)).map(item =>
              <MetadataListItem key={item.id} label={item.label || item.alias}>{showCustomValue(item, contact.customFields?.[item.alias])}</MetadataListItem>)}
          </MetadataList>
        </Panel> : null}

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
                  <StatusBadge label={entry.action === 'opted_in' ? 'Opted in' : entry.action === 'unsuppressed' ? 'Do-not-contact removed' : 'Suppressed'} tone={entry.action === 'opted_in' ? 'success' : entry.action === 'unsuppressed' ? 'warning' : 'error'} />
                </span>
                <Text type="supporting" color="secondary">{entry.evidence}</Text>
              </span>
              <Timestamp value={entry.at} format="date_time" />
            </li>)}</Rows> : <Text type="supporting" color="secondary">No consent events recorded yet.</Text>}
          </div>
        </Panel>

        <DncPanel contact={contact} path={path} busy={action.busy} mutate={mutate} />

        <Panel title="Workflows" description="Where this contact is in each workflow, and why.">
          <WorkflowRunLog contactId={contact.id} />
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

        <Panel title="Linked companies" description="Organisations linked to this contact profile."
          action={<Link href="/crm/companies" type="supporting">Manage companies</Link>}>
          {linkedCompanies.length ? <Rows>{linkedCompanies.map(company => <li key={company.id}>
            <Text weight="medium">{company.name || `Company #${company.id}`}</Text>
            {company.isPrimary ? <StatusBadge label="Primary" tone="info" /> : <StatusBadge label="Linked" tone="neutral" />}
          </li>)}</Rows> : <Text color="secondary">No linked companies recorded.</Text>}
        </Panel>

        <Panel title="Recorded devices" description="Devices detected from email opens and tracked site visits.">
          {devices.length ? <Rows>{devices.map(item => {
            const details = [item.os ? `OS: ${item.os}` : '', item.brand ? `Brand: ${item.brand}` : ''].filter(Boolean).join(' · ');
            return <li key={item.id}>
              <span>
                <Text weight="medium">{item.device ? prettifyKey(item.device) : 'Unknown device'}</Text>
                <Text type="supporting" color="secondary">{details || 'No OS or brand details'}</Text>
              </span>
              {item.dateAdded ? <Timestamp value={item.dateAdded} format="date_time" /> : <Text type="supporting" color="secondary">—</Text>}
            </li>;
          })}</Rows> : <Text color="secondary">No devices recorded yet.</Text>}
        </Panel>

        <Panel title="Newsletter engagement" description="Recent newsletter opens and link clicks for this contact.">
          {newsletterViews.length || newsletterClicks.length ? <div className="ov-stack-sm">
            <div className="ov-stack-sm">
              <Text type="label" color="secondary">Opens ({number(newsletterViews.length)})</Text>
              {newsletterViews.length ? <Rows>{newsletterViews.map((entry, index) => <li key={`view-${entry.campaignId}-${entry.at}-${index}`}>
                <Link href={`/campaigns/${entry.campaignId}`}>{entry.campaignName || `Campaign #${entry.campaignId}`}</Link>
                <Timestamp value={entry.at} format="date_time" />
              </li>)}</Rows> : <Text type="supporting" color="secondary">No opens recorded.</Text>}
            </div>
            <div className="ov-stack-sm">
              <Text type="label" color="secondary">Link clicks ({number(newsletterClicks.length)})</Text>
              {newsletterClicks.length ? <Rows>{newsletterClicks.map((entry, index) => <li key={`click-${entry.campaignId}-${entry.at}-${index}`}>
                <span>
                  <Link href={`/campaigns/${entry.campaignId}`}>{entry.campaignName || `Campaign #${entry.campaignId}`}</Link>
                  {isSafeHttpUrl(entry.url)
                    ? <Link href={entry.url} isExternalLink type="supporting">{entry.url}</Link>
                    : <Text type="supporting" color="secondary">{entry.url || '—'}</Text>}
                </span>
                <Timestamp value={entry.at} format="date_time" />
              </li>)}</Rows> : <Text type="supporting" color="secondary">No link clicks recorded.</Text>}
            </div>
          </div> : <Text color="secondary">No newsletter opens or link clicks recorded yet.</Text>}
        </Panel>

        <Panel title="Delivery bounces" description="Bounce records reported during outbound email deliveries."
          action={contactBounces.length ? <Button size="sm" variant="ghost" label="Clear bounces" icon={<Trash2 size={14} />}
            isDisabled={action.busy} onClick={() => setModal('clear-bounces')} /> : undefined}>
          {contactBounces.length ? <Rows>{contactBounces.map(bounce => {
            const [label, tone] = bounceTone[bounce.type] ?? [prettifyKey(bounce.type || 'bounce'), 'warning'];
            return <li key={bounce.id}>
              <span>
                <span className="ov-actions">
                  <StatusBadge label={label} tone={tone} />
                  {bounce.campaignId
                    ? <Link href={`/campaigns/${bounce.campaignId}`}>{bounce.campaignName || `Campaign #${bounce.campaignId}`}</Link>
                    : bounce.campaignName ? <Text weight="medium">{bounce.campaignName}</Text> : null}
                </span>
                {bounce.source ? <Text type="supporting" color="secondary">Source: {bounce.source}</Text> : null}
              </span>
              {bounce.createdAt ? <Timestamp value={bounce.createdAt} format="date_time" /> : <Text type="supporting" color="secondary">—</Text>}
            </li>;
          })}</Rows> : <Text color="secondary">No delivery bounces recorded.</Text>}
        </Panel>
      </div>

      <TimelinePanel contactId={contact.id} />
    </div>}

    {modal === 'edit' && contact ? <ContactForm contact={contact} onClose={() => setModal(undefined)} onDone={() => {
      setModal(undefined);
      setNotice('Contact updated.');
      resource.refresh();
    }} /> : null}

    {modal === 'send-email' && contact ? <SendContactEmailModal contact={contact} onClose={() => setModal(undefined)} onSent={() => {
      setModal(undefined);
      setNotice('Email sent to contact.');
      resource.refresh();
    }} /> : null}

    {modal === 'clear-bounces' && contact ? <ConfirmDialog
      title="Clear delivery bounces"
      description="Remove all recorded bounce entries for this contact? Any active email suppression remains enforced."
      actionLabel="Clear bounces"
      destructive
      busy={action.busy}
      onClose={() => setModal(undefined)}
      onConfirm={() => void action.run(async () => {
        try {
          await api(`${contactsPath}/${contact.id}/bounces`, 'DELETE');
          resource.refresh();
        } finally {
          setModal(undefined);
        }
      }, 'Delivery bounces cleared.')}
    /> : null}

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
          router.replace('/crm');
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
