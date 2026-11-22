'use client';

import { ArrowLeft, Download, ListFilter, Plus, Search, Upload, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Contact, ContactDetail, MailingList, Page, Segment } from '@/contracts';
import { api, date, number, useAction, useResource } from './client';
import { useUser } from './shell';
import { AsyncState, Badge, Button, Dialog, Empty, Feedback, Field, PageHeader, Pager, Panel } from './ui';

type Tab = 'Contacts' | 'Segments' | 'Mailing lists';
type Modal = 'contact' | 'import' | 'segment' | 'list';
type ImportResult = { imported: number; failed: { row: number; message: string }[] };
const tabs: Tab[] = ['Contacts', 'Segments', 'Mailing lists'];
const contactsPath = '/contacts';
const segmentPath = '/segments';
const listPath = '/lists';

function fullName(contact: Contact) {
  return [contact.firstName, contact.lastName].filter(Boolean).join(' ');
}

function saveFile(content: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ContactForm({ contact, onDone, onClose }: { contact?: Contact; onDone: (contact: Contact) => void; onClose: () => void }) {
  const [optedIn, setOptedIn] = useState(false);
  const action = useAction();
  return <Dialog title={contact ? 'Edit contact' : 'Add contact'} onClose={onClose}>
    <form className="form-stack" onSubmit={event => {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      void action.run(async () => {
        const input = {
          email: String(values.get('email')).trim(),
          firstName: String(values.get('firstName')).trim(),
          lastName: String(values.get('lastName')).trim(),
          company: String(values.get('company')).trim(),
          tags: String(values.get('tags')).split(',').map(tag => tag.trim()).filter(Boolean),
          ...(!contact && optedIn ? { consent: 'opted_in', evidence: String(values.get('evidence')).trim() } : {}),
        };
        onDone(await api<Contact>(contact ? contactsPath + '/' + contact.id : contactsPath, contact ? 'PATCH' : 'POST', input));
      });
    }}>
      <Field label="Email address"><input name="email" type="email" required maxLength={254} defaultValue={contact?.email} /></Field>
      <div className="form-grid">
        <Field label="First name"><input name="firstName" defaultValue={contact?.firstName} maxLength={100} /></Field>
        <Field label="Last name"><input name="lastName" defaultValue={contact?.lastName} maxLength={100} /></Field>
      </div>
      <Field label="Company"><input name="company" defaultValue={contact?.company} maxLength={150} /></Field>
      <Field label="Tags" help="Separate tags with commas."><input name="tags" defaultValue={contact?.tags.join(', ')} maxLength={300} /></Field>
      {!contact ? <>
        <label className="check-line"><input type="checkbox" checked={optedIn} onChange={event => setOptedIn(event.target.checked)} /> This contact consented to marketing email</label>
        {optedIn ? <Field label="Consent evidence"><input name="evidence" required maxLength={500} placeholder="Source, date and wording of consent" /></Field> : null}
      </> : null}
      <Feedback error={action.error} />
      <div className="form-actions"><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" disabled={action.busy}>{contact ? 'Save changes' : 'Add contact'}</Button></div>
    </form>
  </Dialog>;
}

function ImportForm({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const action = useAction();
  const [result, setResult] = useState<ImportResult>();
  return <Dialog title="Import contacts" onClose={onClose}>
    <form className="form-stack" onSubmit={event => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const file = data.get('file');
      const evidence = String(data.get('evidence')).trim();
      if (!(file instanceof File) || !file.size) return;
      void action.run(async () => {
        if (file.size > 1_000_000) throw new Error('Choose a CSV file smaller than 1 MB.');
        const imported = await api<ImportResult>('/contacts/import', 'POST', { csv: await file.text(), evidence: evidence || undefined });
        setResult(imported);
        onImported();
      });
    }}>
      <p className="caption">Include an <code>email</code> column and up to 500 rows. Optional columns include <code>firstName</code>, <code>lastName</code>, <code>company</code>, <code>tags</code>, <code>consent</code> and <code>evidence</code>. Separate multiple tags with <code>|</code>.</p>
      <Field label="CSV file"><input name="file" type="file" accept=".csv,text/csv" required /></Field>
      <Field label="Consent evidence" help="Use this for opted_in rows without their own evidence. Record the source and date of consent."><input name="evidence" maxLength={500} /></Field>
      <Feedback error={action.error} notice={result ? `${number(result.imported)} contacts imported. ${number(result.failed.length)} rows failed.` : undefined} />
      {result?.failed.length ? <ul className="line-list">{result.failed.slice(0, 25).map(item => <li key={item.row}>Row {item.row} · {item.message}</li>)}
        {result.failed.length > 25 ? <li>Showing the first 25 row errors.</li> : null}
      </ul> : null}
      <div className="form-actions"><Button onClick={onClose}>{result ? 'Close' : 'Cancel'}</Button>
        <Button type="submit" variant="primary" disabled={action.busy}>{action.busy ? 'Importing…' : 'Import contacts'}</Button></div>
    </form>
  </Dialog>;
}

function GroupForm({ segment, onClose, onDone }: { segment: boolean; onClose: () => void; onDone: () => void }) {
  const action = useAction();
  return <Dialog title={segment ? 'Create segment' : 'Create mailing list'} onClose={onClose}>
    <form className="form-stack" onSubmit={event => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      void action.run(async () => {
        await api(segment ? segmentPath : listPath, 'POST', {
          name: String(data.get('name')).trim(),
          ...(segment ? { description: String(data.get('description')).trim() } : {}),
        });
        onDone();
      });
    }}>
      <Field label="Name"><input name="name" required maxLength={120} /></Field>
      {segment ? <Field label="Description"><textarea name="description" maxLength={500} /></Field> : null}
      <Feedback error={action.error} />
      <div className="form-actions"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" disabled={action.busy}>{segment ? 'Create segment' : 'Create mailing list'}</Button></div>
    </form>
  </Dialog>;
}

export function Audience() {
  const user = useUser();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('Contacts');
  const [modal, setModal] = useState<Modal>();
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
  function changeTab(value: Tab) {
    setTab(value);
    setNotice('');
  }
  return <>
    <PageHeader title="Audience" description="Manage contacts, segmentation and email permissions." actions={tab === 'Contacts'
      ? <>
        {user.role === 'admin' ? <Button onClick={() => void action.run(async () => saveFile(await api<string>('/contacts/export'), 'ovelio-contacts.csv', 'text/csv'))} disabled={action.busy}><Download size={15} /> Export CSV</Button> : null}
        <Button onClick={() => setModal('import')}><Upload size={15} /> Import CSV</Button>
        <Button variant="primary" onClick={() => setModal('contact')}><Plus size={16} /> Add contact</Button>
      </>
      : <Button variant="primary" onClick={() => setModal(tab === 'Segments' ? 'segment' : 'list')}><Plus size={16} /> {tab === 'Segments' ? 'Create segment' : 'Create mailing list'}</Button>} />
    <nav className="tabs" aria-label="Audience view">{tabs.map(item => <button key={item} aria-pressed={tab === item} onClick={() => changeTab(item)}>{item}</button>)}</nav>
    <div className="stack-small"><Feedback error={action.error} notice={notice || action.notice} />
    {tab === 'Contacts' ? <Panel title="Contact directory" description={contacts.data ? `${number(contacts.data.total)} contacts` : undefined}>
      <div className="section-bar">
        <form className="inline-form" onSubmit={event => { event.preventDefault(); setSearch(query.trim()); setPage(1); }}>
          <Field label="Search contacts"><input value={query} onChange={event => setQuery(event.target.value)} type="search" placeholder="Name or email" /></Field>
          <Button type="submit"><Search size={15} /> Search</Button>
        </form>
        <Field label="Segment filter"><select value={segmentId} onChange={event => { setSegmentId(event.target.value); setPage(1); }}>
          <option value="">All segments</option>
          {segments.data?.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
        </select></Field>
      </div>
      {!contacts.data ? <AsyncState loading={contacts.loading} error={contacts.error} retry={contacts.refresh} />
        : contacts.data.items.length ? <><div className="table-wrap"><table className="table">
          <thead><tr><th scope="col">Contact</th><th scope="col">Company</th><th scope="col" className="num">Score</th><th scope="col">Tags</th><th scope="col">Delivery</th><th scope="col">Added</th></tr></thead>
          <tbody>{contacts.data.items.map(contact => <tr key={contact.id}>
            <td><Link className="text-link" href={`/audience/${contact.id}`}>{fullName(contact) || contact.email || `Contact ${contact.id}`}</Link>
              {fullName(contact) && contact.email ? <small>{contact.email}</small> : null}</td>
            <td>{contact.company || '—'}</td><td className="num">{number(contact.points)}</td>
            <td><div className="inline-group">{contact.tags.length ? contact.tags.map(tag => <Badge key={tag}>{tag}</Badge>) : '—'}</div></td>
            <td>{contact.suppressed ? <Badge tone="red">Suppressed</Badge> : <span className="muted">—</span>}</td>
            <td className="no-wrap">{date(contact.createdAt)}</td>
          </tr>)}</tbody>
        </table></div><Pager {...contacts.data} onPage={setPage} /></> : <Empty title={search || segmentId ? 'No contacts match these filters' : 'No contacts yet'}>
          {search || segmentId ? <Button onClick={() => { setSearch(''); setQuery(''); setSegmentId(''); setPage(1); }}>Clear filters</Button> : null}
        </Empty>}
    </Panel> : null}
    {tab === 'Segments' ? <Panel title="Segments" description="Build groups for automations and synchronise opted-in members for newsletters.">
      {!segments.data ? <AsyncState loading={segments.loading} error={segments.error} retry={segments.refresh} />
        : segments.data.length ? <div className="table-wrap"><table className="table">
          <thead><tr><th scope="col">Name</th><th scope="col">Status</th><th scope="col">Newsletter audience</th></tr></thead>
          <tbody>{segments.data.map(group => <tr key={group.id}>
            <td><button className="text-link" onClick={() => { setTab('Contacts'); setSegmentId(String(group.id)); setPage(1); }}>{group.name}</button>
              {group.description ? <small>{group.description}</small> : null}</td>
            <td><Badge tone={group.published ? 'green' : 'neutral'}>{group.published ? 'Published' : 'Draft'}</Badge></td>
            <td><Button disabled={action.busy} onClick={() => void action.run(async () => {
              await api(`${segmentPath}/${group.id}/sync`, 'POST');
              setNotice('');
            }, `Sync queued for ${group.name}.`)}><ListFilter size={15} /> Sync subscribers</Button></td>
          </tr>)}</tbody>
        </table></div> : <Empty title="No segments yet" />}
    </Panel> : null}
    {tab === 'Mailing lists' ? <Panel title="Mailing lists" description="Subscriber groups available for newsletters.">
      {!lists.data ? <AsyncState loading={lists.loading} error={lists.error} retry={lists.refresh} />
        : lists.data.length ? <div className="table-wrap"><table className="table">
          <thead><tr><th scope="col">Name</th><th scope="col" className="num">Subscribers</th><th scope="col">Tags</th></tr></thead>
          <tbody>{lists.data.map(list => <tr key={list.id}><td>{list.name}</td><td className="num">{number(list.subscriberCount)}</td><td>{list.tags.join(', ') || '—'}</td></tr>)}</tbody>
        </table></div> : <Empty title="No mailing lists yet" />}
    </Panel> : null}
    </div>
    {modal === 'contact' ? <ContactForm onClose={() => setModal(undefined)} onDone={contact => router.push(`/audience/${contact.id}`)} /> : null}
    {modal === 'import' ? <ImportForm onClose={() => setModal(undefined)} onImported={() => { contacts.refresh(); setNotice('Import processed.'); }} /> : null}
    {modal === 'segment' || modal === 'list' ? <GroupForm segment={modal === 'segment'} onClose={() => setModal(undefined)} onDone={() => {
      setNotice(modal === 'segment' ? 'Segment created.' : 'Mailing list created.');
      setModal(undefined);
      if (modal === 'segment') segments.refresh(); else lists.refresh();
    }} /> : null}
  </>;
}

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
  const contact = resource.data;
  const addable = segments.data?.filter(segment => !contact?.segments.some(current => current.id === segment.id)) || [];
  const subscribed = contact?.mailingListIds || [];
  const manualLists = mailingLists.data?.filter(list => !list.tags.some(tag => tag.startsWith('ovelio-segment-'))) || [];
  const availableLists = manualLists.filter(list => !subscribed.includes(list.id));

  function updateList(listId: number, member: boolean) {
    void action.run(async () => {
      await api(path + '/lists', 'POST', { listId, member });
      setNotice('');
      resource.refresh();
    }, member ? 'Mailing list membership updated.' : 'Removed from mailing list.');
  }

  return <>
    <Link className="text-link back-link" href="/audience"><ArrowLeft size={15} /> Audience</Link>
    <PageHeader title={contact ? fullName(contact) || contact.email || 'Contact' : 'Contact'} description={contact?.email || 'Contact record and preferences.'}
      actions={contact ? <>
        {user.role === 'admin' ? <>
          <Button disabled={action.busy} onClick={() => void action.run(async () => saveFile(JSON.stringify(await api(`${path}/export`), null, 2), `ovelio-contact-${id}.json`, 'application/json'))}><Download size={15} /> Export contact</Button>
          <Button variant="danger" onClick={() => setModal('delete')}>Delete contact</Button>
        </> : null}
        <Button variant="primary" onClick={() => setModal('edit')}>Edit contact</Button>
      </> : undefined} />
    {!contact ? <Panel><AsyncState loading={resource.loading} error={resource.error} retry={resource.refresh} /></Panel> : <div className="stack">
      <Feedback error={action.error} notice={action.notice || notice} />
      <div className="columns">
        <Panel title="Contact information" action={<UserRound size={17} />}>
          <div className="panel-body"><dl className="definition-list">
            <dt>Company</dt><dd>{contact.company || '—'}</dd>
            <dt>Lead score</dt><dd>{number(contact.points)}</dd>
            <dt>Tags</dt><dd className="inline-group">{contact.tags.length ? contact.tags.map(tag => <Badge key={tag}>{tag}</Badge>) : '—'}</dd>
            <dt>Created</dt><dd>{date(contact.createdAt)}</dd>
            <dt>Updated</dt><dd>{date(contact.updatedAt)}</dd>
          </dl></div>
        </Panel>
        <Panel title="Email consent" action={<Badge tone={contact.consent === 'opted_in' ? 'green' : contact.consent === 'suppressed' ? 'red' : 'amber'}>
          {contact.consent === 'opted_in' ? 'Opted in' : contact.consent === 'suppressed' ? 'Suppressed' : 'Unknown'}
        </Badge>}>
          <div className="panel-body">
            {contact.consent === 'suppressed' ? <p className="caption">Marketing emails are blocked for this contact.</p>
              : <form className="form-stack" onSubmit={event => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                void action.run(async () => {
                  await api(path + '/consent', 'POST', { action: data.get('action'), evidence: String(data.get('evidence')).trim() });
                  setNotice('');
                  resource.refresh();
                }, 'Email consent updated.');
              }}>
                <div className="form-grid">
                  <Field label="Consent action"><select name="action" defaultValue={contact.consent === 'opted_in' ? 'suppressed' : 'opted_in'}>
                    {contact.consent === 'unknown' ? <option value="opted_in">Record opt-in</option> : null}<option value="suppressed">Suppress marketing email</option>
                  </select></Field>
                  <Field label="Evidence"><input name="evidence" required maxLength={500} placeholder="Source and date" /></Field>
                </div>
                <div className="form-actions"><Button type="submit" disabled={action.busy}>Save consent</Button></div>
              </form>}
          </div>
        </Panel>
        <Panel title="Segments">
          <div className="panel-body stack-small">
            {contact.segments.length ? <ul className="line-list">{contact.segments.map(segment => <li key={segment.id}><span>{segment.name}</span>
              <Button variant="quiet" disabled={action.busy} onClick={() => void action.run(async () => {
                await api(path + '/segments', 'POST', { segmentId: segment.id, member: false });
                setNotice('');
                resource.refresh();
              }, 'Segment membership removed.')}>Remove</Button>
            </li>)}</ul> : <p className="caption">This contact has no segment memberships.</p>}
            {addable.length ? <form className="inline-form" onSubmit={event => {
              event.preventDefault();
              const group = Number(new FormData(event.currentTarget).get('segmentId'));
              void action.run(async () => {
                await api(path + '/segments', 'POST', { segmentId: group, member: true });
                setNotice('');
                resource.refresh();
              }, 'Segment membership added.');
            }}>
              <Field label="Add to segment"><select name="segmentId" defaultValue="" required><option value="" disabled>Select a segment</option>
                {addable.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
              </select></Field>
              <Button type="submit" disabled={action.busy}>Add to segment</Button>
            </form> : <AsyncState loading={segments.loading} error={segments.error} retry={segments.refresh} />}
          </div>
        </Panel>
        <Panel title="Mailing lists" description="Managed mailing lists follow segment membership.">
          <div className="panel-body stack-small">
            {subscribed.length ? <ul className="line-list">{subscribed.map(listId => {
              const list = mailingLists.data?.find(item => item.id === listId);
              return <li key={listId}><span>{list?.name || `List ${listId}`}</span>
                {manualLists.some(item => item.id === listId) ? <Button variant="quiet" disabled={action.busy} onClick={() => updateList(listId, false)}>Remove from list</Button> : null}
              </li>;
            })}</ul> : <p className="caption">No mailing list memberships.</p>}
            {contact.consent === 'opted_in' && availableLists.length ? <form className="inline-form" onSubmit={event => {
              event.preventDefault();
              updateList(Number(new FormData(event.currentTarget).get('listId')), true);
            }}>
              <Field label="Mailing list"><select name="listId" defaultValue="" required><option value="" disabled>Select a mailing list</option>
                {availableLists.map(list => <option value={list.id} key={list.id}>{list.name}</option>)}
              </select></Field>
              <Button type="submit" disabled={action.busy}>Add to mailing list</Button>
            </form> : null}
            <AsyncState loading={mailingLists.loading} error={mailingLists.error} retry={mailingLists.refresh} />
          </div>
        </Panel>
        <Panel title="Activity">
          <div className="panel-body">
            {contact.activity.length ? <ul className="line-list line-list--activity">{contact.activity.map((item, index) => <li key={item.at + item.type + index}>
              <span>{item.label}</span><time dateTime={item.at}>{date(item.at)}</time>
            </li>)}</ul> : <Empty title="No recorded activity" />}
          </div>
        </Panel>
      </div>
    </div>}
    {modal === 'edit' && contact ? <ContactForm contact={contact} onClose={() => setModal(undefined)} onDone={() => {
      setModal(undefined);
      setNotice('Contact updated.');
      resource.refresh();
    }} /> : null}
    {modal === 'delete' ? <Dialog title="Delete contact" onClose={() => setModal(undefined)}>
      <div className="stack-small"><p>This queues erasure and preserves a minimal suppression record to prevent future marketing email.</p>
        <Feedback error={action.error} /><div className="form-actions"><Button onClick={() => setModal(undefined)}>Cancel</Button>
          <Button variant="danger" disabled={action.busy} onClick={() => void action.run(async () => {
            await api(path, 'DELETE');
            router.replace('/audience');
          })}>Request erasure</Button></div>
      </div>
    </Dialog> : null}
  </>;
}
