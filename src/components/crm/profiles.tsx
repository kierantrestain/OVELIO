'use client';

// CRM contact and company profiles: owner, lifecycle stage, deals, tasks, sequences, logged activities and the unified
// timeline. The contact's engine record (consent, do-not-contact, segments, lists, GDPR export and erasure) stays
// available on its own tab through the legacy ContactView.
import '@/styles/crm.css';
import { Mail, Plus } from 'lucide-react';
import NextLink from 'next/link';
import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { Link } from '@astryxdesign/core/Link';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Token } from '@astryxdesign/core/Token';
import type { ContactDetail, Stage } from '@/contracts';
import type { CompanyProfile, ContactProfile, Deal, Pipeline, Sequence, TimelineItem } from '@/contracts/crm';
import { api, useAction, useResource } from '../client';
import { ContactView } from '../audience';
import { AsyncState, Empty, Feedback, FormActions, Metric, Modal, PageHeader, Panel, StatusBadge, Tabs } from '../ui';
import type { Tone } from '../ui';
import {
  ActivityLogger, DealDrawer, EmailDrawer, Kv, OwnerSelect, TaskDrawer, TaskLine, Timeline, followUpDefaults, money, shortDate, statusLabel, statusTone, useTeam,
} from './common';
import type { TaskDefaults } from './common';

const consentBadge: Record<string, [string, Tone]> = { opted_in: ['Opted in', 'success'], unknown: ['No consent recorded', 'warning'], suppressed: ['Suppressed', 'error'] };

function DealList({ deals, empty }: { deals: Deal[]; empty: string }) {
  if (!deals.length) return <Text color="secondary">{empty}</Text>;
  return <ul className="ov-rows">{deals.map(deal => <li key={deal.id}>
    <span><NextLink href={`/sales/deals/${deal.id}`}><Text weight="medium">{deal.name}</Text></NextLink>
      <Text type="supporting" color="secondary">{deal.status === 'open' ? `${deal.stageName} · closes ${shortDate(deal.expectedCloseDate)}` : `${statusLabel[deal.status]} ${shortDate(deal.closedAt)}`}</Text></span>
    <span className="ov-cell" style={{ textAlign: 'right' }}><Text weight="medium">{money(deal.amount, deal.currency)}</Text>
      {deal.status !== 'open' ? <StatusBadge label={statusLabel[deal.status]} tone={statusTone[deal.status]} /> : null}</span>
  </li>)}</ul>;
}

export function ContactProfileView({ id }: { id: string }) {
  const contactId = Number(id);
  const engine = useResource<ContactDetail>(`/contacts/${contactId}`);
  const profile = useResource<ContactProfile>(`/crm/contacts/${contactId}/profile`);
  const stages = useResource<Stage[]>('/stages');
  const pipelines = useResource<{ items: Pipeline[] }>('/sales/pipelines');
  const sequences = useResource<Sequence[]>('/sales/sequences');
  const { members } = useTeam();
  const action = useAction();
  const [tab, setTab] = useState<'Overview' | 'Consent & record'>('Overview');
  const [drawer, setDrawer] = useState<'email' | 'deal' | null>(null);
  const [task, setTask] = useState<TaskDefaults | null>(null);
  const [editing, setEditing] = useState<ContactProfile['tasks'][number] | null>(null);
  const contact = engine.data;
  const data = profile.data;
  const refresh = () => { profile.refresh(); engine.refresh(); };
  if (!contact || !data) return <div className="ov-stack">
    <PageHeader title="Contact" back={{ href: '/crm', label: 'Contacts' }} />
    <Panel><AsyncState loading={engine.loading || profile.loading} error={engine.error || profile.error} retry={refresh} /></Panel>
  </div>;
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ') || contact.email;
  const engineItems: TimelineItem[] = (contact.activity ?? []).map((item, index) => ({
    id: `engine:${index}`, kind: 'engine', type: item.type, at: item.at, title: item.label, detail: 'Recorded by the audience engine',
  }));
  const timeline = [...data.timeline, ...engineItems].sort((a, b) => b.at.localeCompare(a.at));
  const [consentLabel, consentTone] = consentBadge[contact.consent] ?? ['Unknown', 'neutral'];
  const company = contact.linkedCompanies?.find(item => item.isPrimary) ?? contact.linkedCompanies?.[0];
  const activeSequences = (sequences.data ?? []).filter(item => item.status === 'active');

  return <div className="ov-stack">
    <PageHeader back={{ href: '/crm', label: 'Contacts' }} title={name}
      description={[contact.position, contact.company].filter(Boolean).join(' at ') || contact.email}
      actions={<>
        <Button label="Send email" icon={<Mail size={15} />} onClick={() => setDrawer('email')} isDisabled={!contact.email} />
        <Button label="Schedule follow-up" onClick={() => setTask(followUpDefaults({ title: `Follow up with ${name}`, contactId, contactName: name, companyId: company?.id ?? null, companyName: company?.name }))} />
        {activeSequences.length ? <DropdownMenu button={{ label: 'Enrol in sequence' }} items={activeSequences.map(sequence => ({
          label: sequence.name, onClick: () => void action.run(async () => {
            const result = await api<{ results: { status: string }[] }>(`/sales/sequences/${sequence.id}/enrol`, 'POST', { contactIds: [contactId] });
            if (result.results[0]?.status === 'already_active') throw new Error(`${name} is already active in ${sequence.name}.`);
            profile.refresh();
          }, `Enrolled in ${sequence.name}.`),
        }))} /> : null}
        <Button label="New deal" variant="primary" icon={<Plus size={16} />} onClick={() => setDrawer('deal')} isDisabled={!pipelines.data?.items.length} />
      </>} />
    <Tabs label="Contact sections" value={tab} items={['Overview', 'Consent & record'] as const} onChange={setTab} />
    <Feedback error={action.error} />
    {tab === 'Consent & record' ? <ContactView id={String(contactId)} embedded /> : <div className="ov-crm-detail">
      <div className="ov-stack">
        <Panel title="Log activity"><ActivityLogger contactId={contactId} companyId={company?.id ?? null} onLogged={profile.refresh} /></Panel>
        <Panel title="Timeline" description="Calls, meetings, notes, emails, deals, forms, sequences and engine activity in one place.">
          <Timeline items={timeline} />
        </Panel>
      </div>
      <div className="ov-crm-side">
        <Panel title="About">
          <div className="ov-stack-sm">
            <Kv label="Email">{contact.email ? <Link href={`mailto:${contact.email}`}>{contact.email}</Link> : '—'}</Kv>
            <Kv label="Phone">{contact.phone || '—'}</Kv>
            <Kv label="Company">{company ? <NextLink href={`/crm/companies/${company.id}`}>{company.name}</NextLink> : contact.company || '—'}</Kv>
            <OwnerSelect value={data.owner?.id ?? null} members={members} isDisabled={action.busy}
              onChange={owner => void action.run(async () => { await api('/crm/owners', 'POST', { object: 'contact', ids: [contactId], ownerId: owner }); profile.refresh(); }, 'Owner updated.')} />
            <Selector label="Lifecycle stage" value={contact.stageId ? String(contact.stageId) : 'none'} isLoading={stages.loading}
              options={[{ value: 'none', label: 'No stage' }, ...(stages.data ?? []).map(stage => ({ value: String(stage.id), label: stage.name }))]}
              onChange={value => void action.run(async () => { await api(`/contacts/${contactId}/stage`, 'POST', { stageId: value && value !== 'none' ? Number(value) : null }); engine.refresh(); }, 'Lifecycle stage updated.')} />
            <Kv label="Lead score">{contact.points}</Kv>
            <Kv label="Email consent"><StatusBadge label={consentLabel} tone={consentTone} /></Kv>
            <Kv label="Tags">{contact.tags.length ? <span className="ov-tags">{contact.tags.map(tag => <Token key={tag} label={tag} size="sm" />)}</span> : '—'}</Kv>
            <Kv label="Created">{shortDate(contact.createdAt)}</Kv>
          </div>
        </Panel>
        <Panel title="Deals" action={<Button size="sm" label="New deal" icon={<Plus size={14} />} onClick={() => setDrawer('deal')} isDisabled={!pipelines.data?.items.length} />}>
          <DealList deals={data.deals} empty="No deals with this contact yet." />
        </Panel>
        <Panel title="Tasks" action={<Button size="sm" label="Add task" icon={<Plus size={14} />} onClick={() => setTask({ title: '', contactId, contactName: name })} />}>
          {data.tasks.length ? data.tasks.map(item => <TaskLine key={item.id} task={item} onChanged={profile.refresh} onEdit={setEditing} />) : <Text color="secondary">No tasks for this contact.</Text>}
        </Panel>
        <Panel title="Sequences">
          {data.enrolments.length ? <ul className="ov-rows">{data.enrolments.map(item => <li key={item.id}>
            <span><Text weight="medium">{item.sequenceName}</Text>
              <Text type="supporting" color="secondary">{item.status === 'active' ? `Step ${Math.min(item.nextPosition + 1, item.stepCount)} of ${item.stepCount}${item.nextRunAt ? ` · next ${shortDate(item.nextRunAt)}` : ''}` : item.stoppedReason || `Finished ${shortDate(item.finishedAt)}`}</Text></span>
            {item.status === 'active' ? <Button size="sm" variant="ghost" label="Stop" onClick={() => void action.run(async () => { await api(`/sales/enrolments/${item.id}/stop`, 'POST'); profile.refresh(); }, 'Sequence stopped.')} />
              : <StatusBadge label={item.status === 'completed' ? 'Completed' : 'Stopped'} tone={item.status === 'completed' ? 'success' : 'warning'} />}
          </li>)}</ul> : <Text color="secondary">Not in any sequence.</Text>}
        </Panel>
        {contact.linkedCompanies?.length ? <Panel title="Companies">
          <ul className="ov-rows">{contact.linkedCompanies.map(item => <li key={item.id}>
            <NextLink href={`/crm/companies/${item.id}`}>{item.name}</NextLink>{item.isPrimary ? <StatusBadge label="Primary" tone="info" /> : null}
          </li>)}</ul>
        </Panel> : null}
      </div>
    </div>}
    {drawer === 'email' ? <EmailDrawer contact={{ id: contactId, name, email: contact.email }} onClose={() => setDrawer(null)} onDone={() => { setDrawer(null); profile.refresh(); }} /> : null}
    {drawer === 'deal' && pipelines.data ? <DealDrawer pipelines={pipelines.data.items} onClose={() => setDrawer(null)}
      defaults={{ contactId, contactName: name, companyId: company?.id ?? null, companyName: company?.name ?? '', name: `${contact.company || name} — ` }}
      onCreated={() => { setDrawer(null); refresh(); }} /> : null}
    {task || editing ? <TaskDrawer task={editing ?? undefined} defaults={task ?? undefined} onClose={() => { setTask(null); setEditing(null); }}
      onSaved={() => { setTask(null); setEditing(null); profile.refresh(); }} /> : null}
  </div>;
}

function CompanyForm({ company, onClose, onSaved }: { company: CompanyProfile['company']; onClose: () => void; onSaved: () => void }) {
  const action = useAction();
  const [values, setValues] = useState({ name: company.name, website: company.website, industry: company.industry, city: company.city, country: company.country, email: company.email });
  const field = (key: keyof typeof values) => ({ value: values[key], onChange: (value: string) => setValues(current => ({ ...current, [key]: value })) });
  return <Modal title="Edit company" onClose={onClose}>
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => { await api(`/companies/${company.id}`, 'PATCH', values); onSaved(); }, 'Company saved.');
    }}>
      <TextInput label="Name" isRequired {...field('name')} />
      <div className="ov-form-grid">
        <TextInput label="Website" type="url" isOptional placeholder="https://example.com" {...field('website')} />
        <TextInput label="Email" type="email" isOptional {...field('email')} />
        <TextInput label="Industry" isOptional {...field('industry')} />
        <TextInput label="City" isOptional {...field('city')} />
        <TextInput label="Country" isOptional {...field('country')} />
      </div>
      <Feedback error={action.error} />
      <FormActions><Button label="Cancel" onClick={onClose} /><Button type="submit" variant="primary" label="Save company" isLoading={action.busy} /></FormActions>
    </form>
  </Modal>;
}

export function CompanyProfileView({ id }: { id: string }) {
  const companyId = Number(id);
  const profile = useResource<CompanyProfile>(`/crm/companies/${companyId}/profile`);
  const pipelines = useResource<{ items: Pipeline[] }>('/sales/pipelines');
  const { members } = useTeam();
  const action = useAction();
  const [modal, setModal] = useState<'edit' | 'deal' | null>(null);
  const [task, setTask] = useState<TaskDefaults | null>(null);
  const [editing, setEditing] = useState<CompanyProfile['tasks'][number] | null>(null);
  const data = profile.data;
  if (!data) return <div className="ov-stack">
    <PageHeader title="Company" back={{ href: '/crm/companies', label: 'Companies' }} />
    <Panel><AsyncState loading={profile.loading} error={profile.error} retry={profile.refresh} /></Panel>
  </div>;
  const company = data.company;
  return <div className="ov-stack">
    <PageHeader back={{ href: '/crm/companies', label: 'Companies' }} title={company.name}
      description={[company.industry, [company.city, company.country].filter(Boolean).join(', ')].filter(Boolean).join(' · ') || 'Company'}
      actions={<>
        <Button label="Edit company" onClick={() => setModal('edit')} />
        <Button label="Schedule follow-up" onClick={() => setTask(followUpDefaults({ title: `Follow up with ${company.name}`, companyId, companyName: company.name }))} />
        <Button label="New deal" variant="primary" icon={<Plus size={16} />} onClick={() => setModal('deal')} isDisabled={!pipelines.data?.items.length} />
      </>} />
    <Feedback error={action.error} />
    <div className="ov-metrics">
      <Metric label="People" value={company.people} />
      <Metric label="Open deals" value={company.openDeals} />
      <Metric label="Open pipeline" formatted={money(company.openValue, company.currency)} hint="Total value of open deals" />
      <Metric label="Won revenue" formatted={money(company.wonRevenue, company.currency)} hint="Measured from won deals" />
    </div>
    <div className="ov-crm-detail">
      <div className="ov-stack">
        <Panel title="Log activity"><ActivityLogger companyId={companyId} onLogged={profile.refresh} /></Panel>
        <Panel title="Timeline" description="Activity with the company, its people and its deals."><Timeline items={data.timeline} /></Panel>
      </div>
      <div className="ov-crm-side">
        <Panel title="About">
          <div className="ov-stack-sm">
            <OwnerSelect value={company.ownerId} members={members} isDisabled={action.busy}
              onChange={owner => void action.run(async () => { await api('/crm/owners', 'POST', { object: 'company', ids: [companyId], ownerId: owner }); profile.refresh(); }, 'Owner updated.')} />
            <Kv label="Website">{company.website && /^https?:\/\//.test(company.website) ? <Link href={company.website} isExternalLink>{company.website}</Link> : company.website || '—'}</Kv>
            <Kv label="Email">{company.email || '—'}</Kv>
            <Kv label="Industry">{company.industry || '—'}</Kv>
            <Kv label="Location">{[company.city, company.country].filter(Boolean).join(', ') || '—'}</Kv>
          </div>
        </Panel>
        <Panel title={`People (${company.people})`}>
          {data.people.length ? <ul className="ov-rows">{data.people.map(person => <li key={person.id}>
            <span><NextLink href={`/crm/contacts/${person.id}`}>{person.name}</NextLink><Text type="supporting" color="secondary">{[person.position, person.email].filter(Boolean).join(' · ')}</Text></span>
          </li>)}</ul> : <Empty title="No people linked" description="Link contacts to this company from their record or when creating a deal." />}
        </Panel>
        <Panel title="Deals" action={<Button size="sm" label="New deal" icon={<Plus size={14} />} onClick={() => setModal('deal')} isDisabled={!pipelines.data?.items.length} />}>
          <DealList deals={data.deals} empty="No deals with this company yet." />
        </Panel>
        <Panel title="Tasks" action={<Button size="sm" label="Add task" icon={<Plus size={14} />} onClick={() => setTask({ title: '', companyId, companyName: company.name })} />}>
          {data.tasks.length ? data.tasks.map(item => <TaskLine key={item.id} task={item} onChanged={profile.refresh} onEdit={setEditing} />) : <Text color="secondary">No tasks for this company.</Text>}
        </Panel>
      </div>
    </div>
    {modal === 'edit' ? <CompanyForm company={company} onClose={() => setModal(null)} onSaved={() => { setModal(null); profile.refresh(); }} /> : null}
    {modal === 'deal' && pipelines.data ? <DealDrawer pipelines={pipelines.data.items} defaults={{ companyId, companyName: company.name, name: `${company.name} — ` }}
      onClose={() => setModal(null)} onCreated={() => { setModal(null); profile.refresh(); }} /> : null}
    {task || editing ? <TaskDrawer task={editing ?? undefined} defaults={task ?? undefined} onClose={() => { setTask(null); setEditing(null); }}
      onSaved={() => { setTask(null); setEditing(null); profile.refresh(); }} /> : null}
  </div>;
}
