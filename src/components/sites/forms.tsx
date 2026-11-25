'use client';

// /sites/forms: OVELIO forms list and the visual form builder (drag to reorder, field settings, live preview,
// after-submit and consent settings, share and embed code, submissions with CSV export).
import '@/styles/sites.css';
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Copy, Download, ExternalLink, GripVertical, Plus, Trash2 } from 'lucide-react';
import NextLink from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Link } from '@astryxdesign/core/Link';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { Table } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import type { FieldType, FormDetail, FormField, FormSettings, FormSubmissionRow, FormSummary, LandingPageSummary } from '@/contracts/sites';
import { formCss } from '@/templates/pages/form-css';
import { api, date, message, number, useResource } from '../client';
import { loadTeam } from '../shell';
import { AsyncState, ConfirmDialog, Empty, Modal, PageHeader, Pager, Panel, Snippet, StatusBadge, Tabs } from '../ui';

const fieldTypes: { type: FieldType; label: string }[] = [
  { type: 'text', label: 'Short text' }, { type: 'email', label: 'Email' }, { type: 'phone', label: 'Phone' }, { type: 'textarea', label: 'Long text' },
  { type: 'select', label: 'Dropdown' }, { type: 'radio', label: 'Single choice' }, { type: 'checkboxes', label: 'Multiple choice' },
  { type: 'checkbox', label: 'Checkbox' }, { type: 'number', label: 'Number' }, { type: 'date', label: 'Date' }, { type: 'url', label: 'Website' }, { type: 'hidden', label: 'Hidden value' },
];

const mappingOptions = [
  { value: 'none', label: 'Keep on the submission only' }, { value: 'email', label: 'Contact · Email' }, { value: 'firstName', label: 'Contact · First name' },
  { value: 'lastName', label: 'Contact · Last name' }, { value: 'company', label: 'Contact · Company' }, { value: 'phone', label: 'Contact · Phone' },
  { value: 'position', label: 'Contact · Job title' }, { value: 'city', label: 'Contact · City' }, { value: 'country', label: 'Contact · Country' },
  { value: 'website', label: 'Contact · Website' }, { value: 'custom', label: 'Contact · Custom field…' },
];

const statusTone = (status: string) => status === 'published' ? 'success' as const : status === 'draft' ? 'info' as const : 'neutral' as const;

export function FormsList() {
  const router = useRouter();
  const params = useSearchParams();
  const [creating, setCreating] = useState(params.get('create') === 'form');
  const [showArchived, setShowArchived] = useState(false);
  const forms = useResource<{ items: FormSummary[] }>(`/sites/forms${showArchived ? '?status=archived' : ''}`);
  return <div className="ov-stack ov-wide">
    <PageHeader title="Forms" description="Capture leads on your pages, as a hosted link or embedded on any website."
      actions={<Button label="New form" variant="primary" icon={<Plus size={16} />} onClick={() => setCreating(true)} />} />
    <div className="ov-sites-toolbar">
      <Switch label="Show archived forms" value={showArchived} onChange={setShowArchived} />
      <div className="ov-sites-links"><Link href="/sites/classic-forms" as={NextLink}>Classic forms (audience engine)</Link></div>
    </div>
    <Panel>
      {!forms.data ? <AsyncState loading={forms.loading} error={forms.error} retry={forms.refresh} />
        : forms.data.items.length ? <Table data={forms.data.items} idKey="id" hasHover columns={[
          { key: 'name', header: 'Form', renderCell: item => <div className="ov-stack-sm" style={{ gap: 2 }}><Link href={`/sites/forms/${item.id}`} as={NextLink}>{item.name}</Link>{item.description ? <Text type="supporting" color="secondary">{item.description}</Text> : null}</div> },
          { key: 'status', header: 'Status', renderCell: item => <StatusBadge label={item.status[0].toUpperCase() + item.status.slice(1)} tone={statusTone(item.status)} /> },
          { key: 'fieldCount', header: 'Fields', renderCell: item => number(item.fieldCount) },
          { key: 'submissions', header: 'Submissions', renderCell: item => number(item.submissions) },
          { key: 'lastSubmissionAt', header: 'Last submission', renderCell: item => date(item.lastSubmissionAt) },
          { key: 'actions', header: '', renderCell: item => <Button size="sm" variant="secondary" label="Open" href={`/sites/forms/${item.id}`} as={NextLink} /> },
        ]} /> : <Empty title={showArchived ? 'No archived forms' : 'No forms yet'} description="Create a form here, or create a landing page from a template and its form is made for you."
          action={<Button label="New form" variant="primary" onClick={() => setCreating(true)} />} />}
    </Panel>
    {creating ? <NewFormDialog onClose={() => { setCreating(false); if (params.get('create')) router.replace('/sites/forms'); }} onCreated={id => router.push(`/sites/forms/${id}`)} /> : null}
  </div>;
}

function NewFormDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState('contact');
  const [state, setState] = useState<{ busy?: boolean; error?: string }>({});
  const starters: Record<string, FormField[]> = {
    contact: [
      { key: 'first_name', label: 'First name', type: 'text', required: true, mapsTo: 'firstName', width: 'half' },
      { key: 'last_name', label: 'Last name', type: 'text', required: false, mapsTo: 'lastName', width: 'half' },
      { key: 'email', label: 'Email address', type: 'email', required: true, mapsTo: 'email' },
      { key: 'message', label: 'Message', type: 'textarea', required: false, mapsTo: 'none' },
    ],
    newsletter: [{ key: 'email', label: 'Email address', type: 'email', required: true, mapsTo: 'email' }],
    lead: [
      { key: 'first_name', label: 'First name', type: 'text', required: true, mapsTo: 'firstName', width: 'half' },
      { key: 'last_name', label: 'Last name', type: 'text', required: false, mapsTo: 'lastName', width: 'half' },
      { key: 'email', label: 'Work email', type: 'email', required: true, mapsTo: 'email' },
      { key: 'company', label: 'Company', type: 'text', required: true, mapsTo: 'company' },
      { key: 'phone', label: 'Phone', type: 'phone', required: false, mapsTo: 'phone' },
    ],
  };
  return <Modal title="New form" onClose={onClose}>
    <form className="ov-stack-sm" onSubmit={async event => {
      event.preventDefault();
      setState({ busy: true });
      try {
        const created = await api<FormDetail>('/sites/forms', 'POST', {
          name: name.trim(), fields: starters[kind], status: 'draft',
          settings: kind === 'newsletter' ? { submitLabel: 'Subscribe', consent: { enabled: true, text: 'Yes, email me the newsletter. I can unsubscribe at any time.', required: true } } : {},
        });
        onCreated(created.id);
      } catch (cause) {
        setState({ error: message(cause) });
      }
    }}>
      <TextInput label="Form name" value={name} onChange={setName} isRequired hasAutoFocus />
      <Selector label="Start with" value={kind} onChange={value => setKind(value ?? 'contact')} options={[
        { value: 'contact', label: 'Contact form', description: 'Name, email and message' },
        { value: 'lead', label: 'Lead capture', description: 'Name, work email, company and phone' },
        { value: 'newsletter', label: 'Newsletter sign-up', description: 'Email with a required consent box' },
      ]} />
      {state.error ? <Banner status="error" title={state.error} /> : null}
      <div className="ov-actions ov-actions--end">
        <Button label="Cancel" variant="ghost" onClick={onClose} />
        <Button label="Create and edit" variant="primary" type="submit" isLoading={state.busy} isDisabled={!name.trim()} />
      </div>
    </form>
  </Modal>;
}

/** The form exactly as visitors see it, rendered with the published form styles. */
function LivePreview({ fields, settings }: { fields: FormField[]; settings: FormSettings }) {
  const rows: FormField[][] = [];
  for (const field of fields.filter(item => item.type !== 'hidden')) {
    const last = rows.at(-1);
    if (field.width === 'half' && last && last.length === 1 && last[0].width === 'half') last.push(field);
    else rows.push([field]);
  }
  const control = (field: FormField) => {
    const label = <>{field.label}{field.required ? <span className="ovf-req" aria-hidden="true">*</span> : null}</>;
    switch (field.type) {
      case 'textarea': return <><label>{label}</label><textarea rows={3} placeholder={field.placeholder} readOnly tabIndex={-1} /></>;
      case 'select': return <><label>{label}</label><select tabIndex={-1} disabled><option>{field.placeholder || 'Choose…'}</option></select></>;
      case 'radio': case 'checkboxes': return <fieldset className="ovf-group"><legend>{label}</legend>{(field.options ?? []).map(option => <label key={option} className="ovf-choice"><input type={field.type === 'radio' ? 'radio' : 'checkbox'} disabled /> <span>{option}</span></label>)}</fieldset>;
      case 'checkbox': return <label className="ovf-choice"><input type="checkbox" disabled /> <span>{label}</span></label>;
      default: return <><label>{label}</label><input type={field.type === 'phone' ? 'tel' : field.type} placeholder={field.placeholder} readOnly tabIndex={-1} /></>;
    }
  };
  return <div className="ov-sites-form-preview" aria-label="Live preview">
    <style>{formCss}</style>
    <div className="ovf">
      {rows.map((row, index) => row.length === 2
        ? <div key={index} className="ovf-row">{row.map(field => <div key={field.key} className="ovf-field">{control(field)}{field.help ? <p className="ovf-help">{field.help}</p> : null}</div>)}</div>
        : <div key={index} className="ovf-field">{control(row[0])}{row[0].help ? <p className="ovf-help">{row[0].help}</p> : null}</div>)}
      {settings.consent.enabled ? <label className="ovf-choice"><input type="checkbox" disabled /> <span>{settings.consent.text}</span></label> : null}
      <button type="button" className="ovf-submit" tabIndex={-1}>{settings.submitLabel || 'Submit'}</button>
    </div>
  </div>;
}

function SortableField({ field, selected, onSelect, onRemove }: { field: FormField; selected: boolean; onSelect: () => void; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.key });
  return <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={'ov-sites-field' + (selected ? ' is-selected' : '') + (isDragging ? ' is-dragging' : '')}
    onClick={onSelect}>
    <button type="button" className="ov-sites-handle" aria-label={`Reorder ${field.label}`} {...attributes} {...listeners}><GripVertical size={16} aria-hidden="true" /></button>
    <span className="ov-sites-field-meta">
      <strong>{field.label}{field.required ? ' *' : ''}</strong>
      <small>{fieldTypes.find(item => item.type === field.type)?.label} · {mappingOptions.find(item => item.value === field.mapsTo)?.label ?? `Custom field ${field.mapsTo.slice(7)}`}</small>
    </span>
    <IconButton label={`Remove ${field.label}`} icon={<Trash2 size={15} />} variant="ghost" size="sm" onClick={event => { event.stopPropagation(); onRemove(); }} />
  </li>;
}

function uniqueKey(fields: FormField[], base: string) {
  let key = base.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'f_$1').slice(0, 30) || 'field';
  if (!/^[a-z]/.test(key)) key = 'f_' + key;
  let candidate = key;
  for (let n = 2; fields.some(field => field.key === candidate); n += 1) candidate = `${key}_${n}`;
  return candidate;
}

function FieldSettings({ field, fields, onChange }: { field: FormField; fields: FormField[]; onChange: (next: FormField) => void }) {
  const set = (patch: Partial<FormField>) => onChange({ ...field, ...patch });
  const custom = field.mapsTo.startsWith('custom:');
  return <div className="ov-stack-sm">
    <TextInput label="Label" value={field.label} onChange={label => set({ label })} isRequired />
    <TextInput label="Field key" description="Used in exports and automations." value={field.key}
      onChange={key => { const next = key.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40); if (!fields.some(item => item !== field && item.key === next)) set({ key: next }); }} />
    <Selector label="Type" value={field.type} onChange={value => value && set({ type: value as FieldType, options: ['select', 'radio', 'checkboxes'].includes(value) ? field.options ?? ['Option 1', 'Option 2'] : field.options })}
      options={fieldTypes.map(item => ({ value: item.type, label: item.label }))} />
    {field.type !== 'hidden' ? <>
      <Switch label="Required" value={field.required} onChange={required => set({ required })} />
      {['text', 'email', 'phone', 'textarea', 'number', 'url', 'select'].includes(field.type) ? <TextInput label="Placeholder" value={field.placeholder ?? ''} onChange={placeholder => set({ placeholder })} isOptional /> : null}
      <TextInput label="Help text" value={field.help ?? ''} onChange={help => set({ help })} isOptional />
      <Selector label="Width" value={field.width ?? 'full'} onChange={value => set({ width: value === 'half' ? 'half' : 'full' })} options={[{ value: 'full', label: 'Full width' }, { value: 'half', label: 'Half width (pairs side by side)' }]} />
    </> : <TextInput label="Value" description="Sent with every submission, e.g. a lead source." value={field.defaultValue ?? ''} onChange={defaultValue => set({ defaultValue })} />}
    {['select', 'radio', 'checkboxes'].includes(field.type) ? <TextArea label="Options" description="One per line." rows={4} value={(field.options ?? []).join('\n')}
      onChange={value => set({ options: value.split('\n').map(item => item.trim()).filter(Boolean).slice(0, 100) })} /> : null}
    <Selector label="Save to the contact" value={custom ? 'custom' : field.mapsTo} onChange={value => set({ mapsTo: value === 'custom' ? `custom:${field.key}` : (value ?? 'none') as FormField['mapsTo'] })} options={mappingOptions} />
    {custom ? <TextInput label="Custom field alias" description="The alias in CRM › Custom fields." value={field.mapsTo.slice(7)} onChange={alias => set({ mapsTo: `custom:${alias.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 64)}` })} /> : null}
    {['text', 'textarea', 'phone'].includes(field.type) ? <div className="ov-form-grid">
      <NumberInput label="Min length" value={field.validation?.minLength ?? null} min={0} max={5000} onChange={value => set({ validation: { ...field.validation, minLength: value == null ? undefined : Number(value) } })} isOptional />
      <NumberInput label="Max length" value={field.validation?.maxLength ?? null} min={1} max={5000} onChange={value => set({ validation: { ...field.validation, maxLength: value == null ? undefined : Number(value) } })} isOptional />
    </div> : null}
    {field.type === 'number' ? <div className="ov-form-grid">
      <NumberInput label="Minimum" value={field.validation?.min ?? null} onChange={value => set({ validation: { ...field.validation, min: value == null ? undefined : Number(value) } })} isOptional />
      <NumberInput label="Maximum" value={field.validation?.max ?? null} onChange={value => set({ validation: { ...field.validation, max: value == null ? undefined : Number(value) } })} isOptional />
    </div> : null}
    {['text', 'phone'].includes(field.type) ? <>
      <TextInput label="Format (regular expression)" placeholder="e.g. [A-Z]{2}\d{6}" value={field.validation?.pattern ?? ''} onChange={pattern => set({ validation: { ...field.validation, pattern: pattern || undefined } })} isOptional />
      {field.validation?.pattern ? <TextInput label="Message when the format is wrong" value={field.validation?.message ?? ''} onChange={value => set({ validation: { ...field.validation, message: value || undefined } })} isOptional /> : null}
    </> : null}
  </div>;
}

export function FormEditor({ id }: { id: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<'Build' | 'Settings' | 'Share' | 'Submissions'>('Build');
  const loaded = useResource<FormDetail>(`/sites/forms/${id}`);
  const [form, setForm] = useState<FormDetail>();
  const [selected, setSelected] = useState<string | null>(null);
  const [state, setState] = useState<{ busy?: boolean; error?: string; notice?: string }>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const [synced, setSynced] = useState<FormDetail>();
  if (loaded.data && loaded.data !== synced) {
    setSynced(loaded.data);
    setForm(loaded.data);
  }
  if (!form) return <div className="ov-stack"><PageHeader title="Form" back={{ href: '/sites/forms', label: 'Forms' }} /><AsyncState loading={loaded.loading} error={loaded.error} retry={loaded.refresh} /></div>;

  const dirty = JSON.stringify({ n: form.name, d: form.description, s: form.status, f: form.fields, t: form.settings }) !== JSON.stringify({ n: loaded.data?.name, d: loaded.data?.description, s: loaded.data?.status, f: loaded.data?.fields, t: loaded.data?.settings });
  const field = form.fields.find(item => item.key === selected) ?? null;
  const setFields = (fields: FormField[]) => setForm({ ...form, fields });
  const setSettings = (patch: Partial<FormSettings>) => setForm({ ...form, settings: { ...form.settings, ...patch } });
  const save = async (status?: FormDetail['status']) => {
    setState({ busy: true });
    try {
      const next = await api<FormDetail>(`/sites/forms/${id}`, 'PATCH', { name: form.name, description: form.description, status: status ?? form.status, fields: form.fields, settings: form.settings });
      setForm(next);
      loaded.refresh();
      setState({ notice: status === 'published' ? 'Published. Pages using this form show the new version immediately.' : 'Form saved.' });
    } catch (cause) {
      setState({ error: message(cause) });
    }
  };

  return <div className="ov-stack ov-wide">
    <PageHeader title={form.name} back={{ href: '/sites/forms', label: 'Forms' }}
      description={`${form.status === 'published' ? 'Published' : form.status === 'draft' ? 'Draft: not accepting submissions' : 'Archived'} · ${number(form.submissions)} submissions`}
      actions={<>
        <Button label="Duplicate" variant="ghost" icon={<Copy size={15} />} onClick={async () => { try { const copy = await api<{ id: string }>(`/sites/forms/${id}/duplicate`, 'POST', {}); router.push(`/sites/forms/${copy.id}`); } catch (cause) { setState({ error: message(cause) }); } }} />
        <Button label={form.submissions ? 'Archive' : 'Delete'} variant="ghost" icon={<Trash2 size={15} />} onClick={() => setConfirmDelete(true)} />
        <Button label="Save" variant="secondary" isDisabled={!dirty} isLoading={state.busy} onClick={() => void save()} />
        {form.status !== 'published' ? <Button label="Publish form" variant="primary" isLoading={state.busy} onClick={() => void save('published')} /> : null}
      </>} />
    {state.error ? <Banner status="error" title={state.error} /> : null}
    {state.notice && !dirty ? <Banner status="success" title={state.notice} /> : null}
    {dirty ? <Banner status="warning" title="Unsaved changes" description="Save to apply them to every page and embed that uses this form." /> : null}
    <Tabs label="Form sections" value={tab} onChange={setTab} items={['Build', 'Settings', 'Share', 'Submissions'] as const} />
    {tab === 'Build' ? <div className="ov-sites-form-layout">
      <Panel title="Add a field">
        <div className="ov-sites-palette-list">
          {fieldTypes.map(item => <button key={item.type} type="button" onClick={() => {
            const key = uniqueKey(form.fields, item.label);
            const next: FormField = { key, label: item.label, type: item.type, required: false, mapsTo: item.type === 'email' && !form.fields.some(f => f.mapsTo === 'email') ? 'email' : 'none',
              ...(['select', 'radio', 'checkboxes'].includes(item.type) ? { options: ['Option 1', 'Option 2'] } : {}) };
            setFields([...form.fields, next]);
            setSelected(key);
          }}><Plus size={14} aria-hidden="true" />{item.label}</button>)}
        </div>
      </Panel>
      <div className="ov-stack">
        <Panel title="Fields" description="Drag the handle (or focus it and use the arrow keys) to reorder.">
          {form.fields.length ? <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event: DragEndEvent) => {
            const { active, over } = event;
            if (!over || active.id === over.id) return;
            const from = form.fields.findIndex(item => item.key === active.id);
            const to = form.fields.findIndex(item => item.key === over.id);
            setFields(arrayMove(form.fields, from, to));
          }}>
            <SortableContext items={form.fields.map(item => item.key)} strategy={verticalListSortingStrategy}>
              <ul className="ov-sites-fields">
                {form.fields.map(item => <SortableField key={item.key} field={item} selected={item.key === selected} onSelect={() => setSelected(item.key)}
                  onRemove={() => { setFields(form.fields.filter(other => other.key !== item.key)); if (selected === item.key) setSelected(null); }} />)}
              </ul>
            </SortableContext>
          </DndContext> : <Empty title="No fields yet" description="Add an email field first: every submission creates or updates the contact with that email." />}
        </Panel>
        <Panel title="Live preview"><LivePreview fields={form.fields} settings={form.settings} /></Panel>
      </div>
      <Panel title={field ? 'Field settings' : 'Form details'}>
        {field ? <FieldSettings key={selected} field={field} fields={form.fields} onChange={next => { setFields(form.fields.map(item => item.key === field.key ? next : item)); setSelected(next.key); }} />
          : <div className="ov-stack-sm">
            <TextInput label="Form name" value={form.name} onChange={name => setForm({ ...form, name })} />
            <TextArea label="Description" description="Shown on the hosted form page." rows={3} value={form.description} onChange={description => setForm({ ...form, description })} />
            <Text type="supporting" color="secondary">Select a field to edit its label, type, validation and where it is saved on the contact.</Text>
          </div>}
      </Panel>
    </div> : null}
    {tab === 'Settings' ? <FormSettingsPanel form={form} onChange={setSettings} /> : null}
    {tab === 'Share' ? <SharePanel form={form} /> : null}
    {tab === 'Submissions' ? <Submissions form={form} /> : null}
    {confirmDelete ? <ConfirmDialog title={form.submissions ? 'Archive this form?' : 'Delete this form?'}
      description={form.submissions ? 'It stops accepting submissions. Its submissions stay available.' : 'The form is removed. Pages still pointing to it will need another form.'}
      actionLabel={form.submissions ? 'Archive' : 'Delete'} onClose={() => setConfirmDelete(false)} onConfirm={async () => {
        try { await api(`/sites/forms/${id}`, 'DELETE'); router.push('/sites/forms'); } catch (cause) { setConfirmDelete(false); setState({ error: message(cause) }); }
      }} /> : null}
  </div>;
}

function FormSettingsPanel({ form, onChange }: { form: FormDetail; onChange: (patch: Partial<FormSettings>) => void }) {
  const s = form.settings;
  const pages = useResource<{ items: LandingPageSummary[] }>('/sites/pages?status=published');
  const designs = useResource<{ items: { id: string; name: string; subject: string }[] }>('/sites/email-designs');
  const [team, setTeam] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => { loadTeam().then(setTeam, () => setTeam([])); }, []);
  return <div className="ov-grid">
    <Panel title="After someone submits">
      <div className="ov-stack-sm">
        <TextInput label="Button label" value={s.submitLabel} onChange={submitLabel => onChange({ submitLabel })} />
        <Selector label="Then" value={s.afterSubmit} onChange={value => onChange({ afterSubmit: (value ?? 'message') as FormSettings['afterSubmit'] })} options={[
          { value: 'message', label: 'Show a thank-you message', description: 'On a funnel step, visitors continue to the next step.' },
          { value: 'redirect', label: 'Go to a web address' }, { value: 'page', label: 'Go to a landing page' },
        ]} />
        {s.afterSubmit === 'message' ? <TextArea label="Thank-you message" rows={3} value={s.successMessage} onChange={successMessage => onChange({ successMessage })} /> : null}
        {s.afterSubmit === 'redirect' ? <TextInput label="Web address" placeholder="https://example.com/thanks" value={s.redirectUrl} onChange={redirectUrl => onChange({ redirectUrl })} /> : null}
        {s.afterSubmit === 'page' ? <Selector label="Thank-you page" placeholder="Choose a published page" value={s.thankYouPageId ?? ''} onChange={value => onChange({ thankYouPageId: value || null })}
          options={(pages.data?.items ?? []).map(page => ({ value: page.id, label: page.name, description: page.url }))} /> : null}
        <TextInput label="Tags to add to the contact" description="Separate tags with commas." value={s.tags.join(', ')} onChange={value => onChange({ tags: value.split(',').map(tag => tag.trim()).filter(Boolean).slice(0, 20) })} />
      </div>
    </Panel>
    <Panel title="Consent and follow-up">
      <div className="ov-stack-sm">
        <Switch label="Ask for email consent" description="A checkbox below the fields. Consent is recorded only when it is ticked, with the form, page and time as evidence." value={s.consent.enabled} onChange={enabled => onChange({ consent: { ...s.consent, enabled } })} />
        {s.consent.enabled ? <>
          <TextArea label="Consent wording" rows={3} value={s.consent.text} onChange={text => onChange({ consent: { ...s.consent, text } })} />
          <CheckboxInput label="Require consent to submit" value={s.consent.required} onChange={required => onChange({ consent: { ...s.consent, required } })} />
        </> : null}
        <Selector label="Confirmation email" placeholder={designs.data?.items.length ? 'No confirmation email' : 'No email designs yet (Marketing › Emails)'} value={s.confirmationDesignId ?? ''}
          onChange={value => onChange({ confirmationDesignId: value || null })} options={[{ value: '', label: 'No confirmation email' }, ...(designs.data?.items ?? []).map(item => ({ value: item.id, label: item.name, description: item.subject }))]} />
        {s.confirmationDesignId ? <Banner status="info" title="Sent only with consent" description="People who do not tick the consent box are not emailed. Each submission shows the email result." /> : null}
        <Selector label="Create a follow-up task for" value={s.notifyUserId ?? ''} onChange={value => onChange({ notifyUserId: value || null })}
          options={[{ value: '', label: 'Nobody' }, ...team.map(member => ({ value: member.id, label: member.name }))]} />
      </div>
    </Panel>
  </div>;
}

function SharePanel({ form }: { form: FormDetail }) {
  const embed = useResource<{ origin: string; hostedUrl: string; snippet: string }>(`/sites/forms/${form.id}/embed`);
  return <div className="ov-grid">
    <Panel title="Hosted form page" description="Share this link anywhere: email, social or a QR code.">
      {!embed.data ? <AsyncState loading={embed.loading} error={embed.error} /> : <div className="ov-stack-sm">
        <Link href={embed.data.hostedUrl} target="_blank"><span className="ov-actions">{embed.data.hostedUrl}<ExternalLink size={14} aria-hidden="true" /></span></Link>
        {form.status !== 'published' ? <Banner status="warning" title="Publish the form to accept submissions." /> : null}
      </div>}
    </Panel>
    <Panel title="Embed on another website" description="Paste where the form should appear. It inherits the site's fonts and submits to OVELIO.">
      {embed.data ? <Snippet code={embed.data.snippet} /> : null}
    </Panel>
    <Panel title="Landing pages using this form">
      {form.pages.length ? <ul className="ov-rows">{form.pages.map(page => <li key={page.id}><Link href={`/studio/page/${page.id}`} as={NextLink}>{page.name}</Link></li>)}</ul>
        : <Empty title="Not on any page yet" description="Add a Form block to a page in the builder and choose this form." />}
    </Panel>
  </div>;
}

function Submissions({ form }: { form: FormDetail }) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const list = useResource<{ items: FormSubmissionRow[]; total: number; limit: number; fields: { key: string; label: string }[] }>(`/sites/forms/${form.id}/submissions?page=${page}${status ? `&status=${status}` : ''}`);
  const tone = (value: string | null) => value === 'sent' ? 'success' as const : value === 'blocked' || value === 'failed' ? 'error' as const : 'neutral' as const;
  return <Panel title="Submissions" action={<div className="ov-actions">
    <Selector label="Status" isLabelHidden width={150} value={status || 'all'} onChange={value => { setStatus(!value || value === 'all' ? '' : value); setPage(1); }}
      options={[{ value: 'all', label: 'All' }, { value: 'accepted', label: 'Accepted' }, { value: 'spam', label: 'Spam' }, { value: 'error', label: 'Errors' }]} />
    <Button label="Export CSV" variant="secondary" size="sm" icon={<Download size={14} />} href={`/api/console/sites/forms/${form.id}/submissions.csv`} />
  </div>}>
    {!list.data ? <AsyncState loading={list.loading} error={list.error} retry={list.refresh} />
      : list.data.items.length ? <div className="ov-stack-sm">
        <Table data={list.data.items} idKey="id" textOverflow="wrap" columns={[
          { key: 'createdAt', header: 'Submitted', renderCell: item => date(item.createdAt) },
          { key: 'email', header: 'Contact', renderCell: item => item.contactId ? <Link href={`/crm/contacts/${item.contactId}`} as={NextLink}>{item.email || `Contact #${item.contactId}`}</Link> : <Text color="secondary">{item.email || '—'}</Text> },
          { key: 'status', header: 'Status', renderCell: item => <StatusBadge label={item.status === 'accepted' ? 'Accepted' : item.status === 'spam' ? 'Spam' : 'Error'} tone={item.status === 'accepted' ? 'success' : item.status === 'spam' ? 'neutral' : 'error'} /> },
          { key: 'values', header: 'Answers', renderCell: item => <Text type="supporting">{list.data!.fields.filter(f => item.values[f.key] && item.values[f.key] !== 'no' && f.key !== 'email').slice(0, 4).map(f => `${f.label}: ${[item.values[f.key]].flat().join(', ')}`).join(' · ') || '—'}</Text> },
          { key: 'pageName', header: 'Source', renderCell: item => <Text type="supporting">{[item.pageName ?? (item.pageUrl ? 'Hosted or embedded form' : '—'), item.variant && item.variant !== 'a' ? `variant ${item.variant.toUpperCase()}` : null, item.utm.source].filter(Boolean).join(' · ')}</Text> },
          { key: 'consentGiven', header: 'Consent', renderCell: item => item.consentGiven ? 'Given' : 'Not given' },
          { key: 'emailStatus', header: 'Confirmation email', renderCell: item => item.emailStatus ? <span title={item.emailDetail}><StatusBadge label={item.emailStatus.replace('_', ' ')} tone={tone(item.emailStatus)} /><Text type="supporting" color="secondary"> {item.emailDetail}</Text></span> : item.errorDetail ? <Text type="supporting" color="secondary">{item.errorDetail}</Text> : '—' },
        ]} />
        <Pager page={page} limit={list.data.limit} total={list.data.total} onPage={setPage} />
      </div> : <Empty title="No submissions yet" description={form.status === 'published' ? 'Submissions from pages, the hosted link and embeds appear here.' : 'Publish the form to start accepting submissions.'} />}
  </Panel>;
}
