'use client';

import { Download, ListFilter, Plus, Search, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Field } from '@astryxdesign/core/Field';
import { Link } from '@astryxdesign/core/Link';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Selector } from '@astryxdesign/core/Selector';
import { Table } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import type { Contact, ContactDetail, MailingList, Page, Segment } from '@/contracts';
import { api, date, number, saveFile, useAction, useFields, useResource } from './client';
import { useUser } from './shell';
import { AsyncState, Empty, Feedback, FormActions, Modal, PageHeader, Pager, Panel, Rows, StatusBadge, Tabs } from './ui';

const tabs = ['Contacts', 'Segments', 'Mailing lists'] as const;
type AudienceTab = typeof tabs[number];
type ImportResult = { imported: number; failed: { row: number; message: string }[] };
const contactsPath = '/contacts';
const segmentPath = '/segments';
const listPath = '/lists';

const fullName = (contact: Contact) => [contact.firstName, contact.lastName].filter(Boolean).join(' ');
const optionsOf = (items: { id: number; name: string }[] = []) => items.map(item => ({ value: String(item.id), label: item.name }));

function Tags({ tags }: { tags: string[] }) {
  return tags.length ? <span className="ov-tags">{tags.map(tag => <StatusBadge key={tag} label={tag} />)}</span> : <Text color="secondary">—</Text>;
}

function ContactForm({ contact, onDone, onClose }: { contact?: Contact; onDone: (contact: Contact) => void; onClose: () => void }) {
  const [optedIn, setOptedIn] = useState(false);
  const action = useAction();
  const { values, field } = useFields({
    email: contact?.email ?? '', firstName: contact?.firstName ?? '', lastName: contact?.lastName ?? '',
    company: contact?.company ?? '', tags: contact?.tags.join(', ') ?? '', evidence: '',
  });
  return <Modal title={contact ? 'Edit contact' : 'Add contact'} onClose={onClose}>
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        if (!contact && optedIn && !values.evidence.trim()) throw new Error('Record the source, date and wording of consent.');
        const input = {
          email: values.email.trim(), firstName: values.firstName.trim(), lastName: values.lastName.trim(), company: values.company.trim(),
          tags: values.tags.split(',').map(tag => tag.trim()).filter(Boolean),
          ...(!contact && optedIn ? { consent: 'opted_in', evidence: values.evidence.trim() } : {}),
        };
        onDone(await api<Contact>(contact ? contactsPath + '/' + contact.id : contactsPath, contact ? 'PATCH' : 'POST', input));
      });
    }}>
      <TextInput label="Email address" type="email" isRequired {...field('email')} />
      <div className="ov-form-grid">
        <TextInput label="First name" isOptional {...field('firstName')} />
        <TextInput label="Last name" isOptional {...field('lastName')} />
      </div>
      <TextInput label="Company" isOptional {...field('company')} />
      <TextInput label="Tags" description="Separate tags with commas." isOptional {...field('tags')} />
      {!contact ? <>
        <CheckboxInput label="This contact consented to marketing email" value={optedIn} onChange={setOptedIn} />
        {optedIn ? <TextInput label="Consent evidence" placeholder="Source, date and wording of consent" isRequired {...field('evidence')} /> : null}
      </> : null}
      <Feedback error={action.error} />
      <FormActions><Button label="Cancel" onClick={onClose} /><Button type="submit" variant="primary" label={contact ? 'Save changes' : 'Add contact'} isLoading={action.busy} /></FormActions>
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
      <Text type="supporting" color="secondary">Include an email column and up to 500 rows. Optional columns: first_name, last_name, company, tags (separated by |), consent and evidence.</Text>
      <Field label="CSV file" inputID="ov-import-file" isRequired>
        <input id="ov-import-file" className="ov-native-file" type="file" accept=".csv,text/csv" onChange={event => setFile(event.target.files?.[0])} />
      </Field>
      <TextInput label="Consent evidence" description="Used for opted_in rows without their own evidence. Record the source and date of consent." isOptional value={evidence} onChange={setEvidence} />
      <Feedback error={action.error} notice={result ? `${number(result.imported)} contacts imported. ${number(result.failed.length)} rows failed.` : undefined} />
      {result?.failed.length ? <Rows>{result.failed.slice(0, 25).map(item => <li key={item.row}><Text type="supporting">Row {item.row} · {item.message}</Text></li>)}</Rows> : null}
      <FormActions><Button label={result ? 'Close' : 'Cancel'} onClick={onClose} /><Button type="submit" variant="primary" label="Import contacts" isLoading={action.busy} /></FormActions>
    </form>
  </Modal>;
}

function GroupForm({ segment, onClose, onDone }: { segment: boolean; onClose: () => void; onDone: () => void }) {
  const action = useAction();
  const { values, field } = useFields({ name: '', description: '' });
  return <Modal title={segment ? 'Create segment' : 'Create mailing list'} onClose={onClose}>
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        await api(segment ? segmentPath : listPath, 'POST', { name: values.name.trim(), ...(segment ? { description: values.description.trim() } : {}) });
        onDone();
      });
    }}>
      <TextInput label="Name" isRequired {...field('name')} />
      {segment ? <TextArea label="Description" isOptional {...field('description')} /> : null}
      <Feedback error={action.error} />
      <FormActions><Button label="Cancel" onClick={onClose} /><Button type="submit" variant="primary" label={segment ? 'Create segment' : 'Create mailing list'} isLoading={action.busy} isDisabled={!values.name.trim()} /></FormActions>
    </form>
  </Modal>;
}

export function Audience() {
  const user = useUser();
  const router = useRouter();
  const [tab, setTab] = useState<AudienceTab>('Contacts');
  const [modal, setModal] = useState<'contact' | 'import' | 'segment' | 'list'>();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [segmentId, setSegmentId] = useState('');
  const [notice, setNotice] = useState('');
  const action = useAction();
  const contacts = useResource<Page<Contact>>(tab === 'Contacts' ? contactsPath + '?' + new URLSearchParams({
    page: String(page), ...(search ? { q: search } : {}), ...(segmentId ? { segmentId } : {}),
  }) : null);
  const segments = useResource<Segment[]>(tab !== 'Mailing lists' ? segmentPath : null);
  const lists = useResource<MailingList[]>(tab === 'Mailing lists' ? listPath : null);
  const filtered = !!(search || segmentId);

  return <>
    <PageHeader title="Audience" description="Manage contacts, segmentation and email permissions." actions={tab === 'Contacts' ? <>
      {user.role === 'admin' ? <Button label="Export CSV" icon={<Download size={15} />} isLoading={action.busy}
        onClick={() => void action.run(async () => saveFile(await api<string>('/contacts/export'), 'ovelio-contacts.csv', 'text/csv'))} /> : null}
      <Button label="Import CSV" icon={<Upload size={15} />} onClick={() => setModal('import')} />
      <Button label="Add contact" variant="primary" icon={<Plus size={16} />} onClick={() => setModal('contact')} />
    </> : <Button variant="primary" icon={<Plus size={16} />} label={tab === 'Segments' ? 'Create segment' : 'Create mailing list'} onClick={() => setModal(tab === 'Segments' ? 'segment' : 'list')} />} />
    <Tabs label="Audience view" items={tabs} value={tab} onChange={value => { setTab(value); setNotice(''); }} />
    <Feedback error={action.error} notice={notice || action.notice} />

    {tab === 'Contacts' ? <Panel title="Contact directory" description={contacts.data ? `${number(contacts.data.total)} contacts` : undefined}>
      <div className="ov-toolbar">
        <form onSubmit={event => { event.preventDefault(); setSearch(query.trim()); setPage(1); }}>
          <TextInput label="Search contacts" isLabelHidden type="search" startIcon="search" placeholder="Name or email" value={query} onChange={setQuery} width={280} />
          <Button type="submit" label="Search" icon={<Search size={15} />} />
        </form>
        <Selector label="Segment filter" isLabelHidden width={240} value={segmentId || 'all'}
          options={[{ value: 'all', label: 'All segments' }, ...optionsOf(segments.data)]}
          onChange={value => { setSegmentId(value && value !== 'all' ? value : ''); setPage(1); }} />
      </div>
      {!contacts.data ? <AsyncState loading={contacts.loading} error={contacts.error} retry={contacts.refresh} /> : <>
        <Table data={contacts.data.items} idKey="id" hasHover
          emptyState={<Empty title={filtered ? 'No contacts match these filters' : 'No contacts yet'}
            description={filtered ? undefined : 'Add a contact or import a CSV to build your audience.'}
            action={filtered ? <Button label="Clear filters" onClick={() => { setSearch(''); setQuery(''); setSegmentId(''); setPage(1); }} /> : undefined} />}
          columns={[
            { key: 'email', header: 'Contact', renderCell: contact => <span className="ov-cell">
              <Link href={`/audience/${contact.id}`}>{fullName(contact) || contact.email || `Contact ${contact.id}`}</Link>
              {fullName(contact) && contact.email ? <Text type="supporting" color="secondary">{contact.email}</Text> : null}
            </span> },
            { key: 'company', header: 'Company', renderCell: contact => contact.company || '—' },
            { key: 'points', header: 'Score', align: 'end', renderCell: contact => number(contact.points) },
            { key: 'tags', header: 'Tags', renderCell: contact => <Tags tags={contact.tags} /> },
            { key: 'suppressed', header: 'Delivery', renderCell: contact => contact.suppressed ? <StatusBadge label="Suppressed" tone="error" /> : <Text color="secondary">—</Text> },
            { key: 'createdAt', header: 'Added', renderCell: contact => date(contact.createdAt) },
          ]} />
        <Pager {...contacts.data} onPage={setPage} />
      </>}
    </Panel> : null}

    {tab === 'Segments' ? <Panel title="Segments" description="Build groups for automations and synchronise opted-in members for newsletters.">
      {!segments.data ? <AsyncState loading={segments.loading} error={segments.error} retry={segments.refresh} />
        : <Table data={segments.data} idKey="id" hasHover emptyState={<Empty title="No segments yet" description="Create a segment to target automations and newsletters." />}
          columns={[
            { key: 'name', header: 'Name', renderCell: group => <span className="ov-cell">
              <Link onClick={() => { setTab('Contacts'); setSegmentId(String(group.id)); setPage(1); }}>{group.name}</Link>
              {group.description ? <Text type="supporting" color="secondary">{group.description}</Text> : null}
            </span> },
            { key: 'published', header: 'Status', renderCell: group => <StatusBadge label={group.published ? 'Published' : 'Draft'} tone={group.published ? 'success' : 'neutral'} /> },
            { key: 'alias', header: 'Newsletter audience', align: 'end', renderCell: group => <Button size="sm" label="Sync subscribers" icon={<ListFilter size={14} />} isDisabled={action.busy}
              onClick={() => void action.run(async () => { await api(`${segmentPath}/${group.id}/sync`, 'POST'); setNotice(''); }, `Sync queued for ${group.name}.`)} /> },
          ]} />}
    </Panel> : null}

    {tab === 'Mailing lists' ? <Panel title="Mailing lists" description="Subscriber groups available for newsletters.">
      {!lists.data ? <AsyncState loading={lists.loading} error={lists.error} retry={lists.refresh} />
        : <Table data={lists.data} idKey="id" emptyState={<Empty title="No mailing lists yet" description="Sync a segment or create a list for manual subscriptions." />}
          columns={[
            { key: 'name', header: 'Name' },
            { key: 'subscriberCount', header: 'Subscribers', align: 'end', renderCell: list => number(list.subscriberCount) },
            { key: 'tags', header: 'Source', renderCell: list => list.tags.some(tag => tag.startsWith('ovelio-segment-')) ? <StatusBadge label="Synced segment" tone="info" /> : <StatusBadge label="Manual" /> },
          ]} />}
    </Panel> : null}

    {modal === 'contact' ? <ContactForm onClose={() => setModal(undefined)} onDone={contact => router.push(`/audience/${contact.id}`)} /> : null}
    {modal === 'import' ? <ImportForm onClose={() => setModal(undefined)} onImported={() => { contacts.refresh(); setNotice('Import processed.'); }} /> : null}
    {modal === 'segment' || modal === 'list' ? <GroupForm segment={modal === 'segment'} onClose={() => setModal(undefined)} onDone={() => {
      setNotice(modal === 'segment' ? 'Segment created.' : 'Mailing list created.');
      setModal(undefined);
      if (modal === 'segment') segments.refresh(); else lists.refresh();
    }} /> : null}
  </>;
}

const consentLabel = { opted_in: ['Opted in', 'success'], suppressed: ['Suppressed', 'error'], unknown: ['Unknown', 'warning'] } as const;

export function ContactView({ id }: { id: string }) {
  const user = useUser();
  const router = useRouter();
  const path = contactsPath + '/' + id;
  const resource = useResource<ContactDetail>(path);
  const segments = useResource<Segment[]>(segmentPath);
  const mailingLists = useResource<MailingList[]>(listPath);
  const action = useAction();
  const [modal, setModal] = useState<'edit' | 'delete'>();
  const [notice, setNotice] = useState('');
  const [consentAction, setConsentAction] = useState<string>();
  const [evidence, setEvidence] = useState('');
  const [segmentChoice, setSegmentChoice] = useState<string | null>(null);
  const [listChoice, setListChoice] = useState<string | null>(null);
  const contact = resource.data;
  const addable = segments.data?.filter(segment => !contact?.segments.some(current => current.id === segment.id)) || [];
  const subscribed = contact?.mailingListIds || [];
  const manualLists = mailingLists.data?.filter(list => !list.tags.some(tag => tag.startsWith('ovelio-segment-'))) || [];
  const availableLists = manualLists.filter(list => !subscribed.includes(list.id));
  const chosenConsent = consentAction ?? (contact?.consent === 'unknown' ? 'opted_in' : 'suppressed');

  function mutate(task: () => Promise<unknown>, success: string) {
    void action.run(async () => { await task(); setNotice(''); resource.refresh(); }, success);
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
            <MetadataListItem label="Lead score">{number(contact.points)}</MetadataListItem>
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
              mutate(() => api(path + '/consent', 'POST', { action: chosenConsent, evidence: evidence.trim() }), 'Email consent updated.');
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
        </Panel>
        <Panel title="Segments">
          {contact.segments.length ? <Rows>{contact.segments.map(segment => <li key={segment.id}><Text>{segment.name}</Text>
            <Button size="sm" variant="ghost" label="Remove" isDisabled={action.busy}
              onClick={() => mutate(() => api(path + '/segments', 'POST', { segmentId: segment.id, member: false }), 'Segment membership removed.')} />
          </li>)}</Rows> : <Text color="secondary">This contact has no segment memberships.</Text>}
          {addable.length ? <div className="ov-toolbar">
            <Selector label="Add to segment" placeholder="Select a segment" value={segmentChoice} hasClear onChange={setSegmentChoice} options={optionsOf(addable)} width={260} />
            <Button label="Add to segment" isDisabled={action.busy || !segmentChoice}
              onClick={() => { mutate(() => api(path + '/segments', 'POST', { segmentId: Number(segmentChoice), member: true }), 'Segment membership added.'); setSegmentChoice(null); }} />
          </div> : <AsyncState loading={segments.loading} error={segments.error} retry={segments.refresh} />}
        </Panel>
        <Panel title="Mailing lists" description="Synced lists follow segment membership.">
          {subscribed.length ? <Rows>{subscribed.map(listId => <li key={listId}>
            <Text>{mailingLists.data?.find(item => item.id === listId)?.name || `List ${listId}`}</Text>
            {manualLists.some(item => item.id === listId) ? <Button size="sm" variant="ghost" label="Remove from list" isDisabled={action.busy}
              onClick={() => mutate(() => api(path + '/lists', 'POST', { listId, member: false }), 'Removed from mailing list.')} /> : null}
          </li>)}</Rows> : <Text color="secondary">No mailing list memberships.</Text>}
          {contact.consent === 'opted_in' && availableLists.length ? <div className="ov-toolbar">
            <Selector label="Mailing list" placeholder="Select a mailing list" value={listChoice} hasClear onChange={setListChoice} options={optionsOf(availableLists)} width={260} />
            <Button label="Add to mailing list" isDisabled={action.busy || !listChoice}
              onClick={() => { mutate(() => api(path + '/lists', 'POST', { listId: Number(listChoice), member: true }), 'Mailing list membership updated.'); setListChoice(null); }} />
          </div> : null}
          <AsyncState loading={mailingLists.loading} error={mailingLists.error} retry={mailingLists.refresh} />
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
    {modal === 'delete' ? <Modal title="Delete contact" onClose={() => setModal(undefined)}>
      <Text>This queues erasure across audience and newsletter records, and keeps a minimal suppression record to prevent future marketing email.</Text>
      <Feedback error={action.error} />
      <FormActions><Button label="Cancel" onClick={() => setModal(undefined)} />
        <Button variant="destructive" label="Request erasure" isLoading={action.busy} onClick={() => void action.run(async () => {
          await api(path, 'DELETE');
          router.replace('/audience');
        })} />
      </FormActions>
    </Modal> : null}
  </>;
}
