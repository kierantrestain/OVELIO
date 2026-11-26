'use client';

// CRM › Contacts and CRM › Companies: filterable lists with owner, lifecycle stage, last activity and open deals,
// inline owner and stage edits, bulk changes, saved views (platform views 'contacts' and 'companies'), CSV import
// and export. Creating, importing and editing reuse the audience forms.
import '@/styles/crm.css';
import { Download, Plus, Upload } from 'lucide-react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { DateInput } from '@astryxdesign/core/DateInput';
import { Selector } from '@astryxdesign/core/Selector';
import { Table, pixel } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Token } from '@astryxdesign/core/Token';
import Papa from 'papaparse';
import type { Stage, Tag } from '@/contracts';
import type { CrmCompanyPage, CrmContact, CrmContactPage } from '@/contracts/crm';
import type { SavedView } from '@/contracts/platform';
import { api, saveFile, useAction, useResource } from '../client';
import { CompanyForm, ContactForm, ImportForm } from '../audience';
import { useUser } from '../shell';
import { AsyncState, DataTable, Empty, Feedback, FilterBar, FilterRow, PageHeader, Pager, Panel, StatusBadge, Toolbar } from '../ui';
import type { Tone } from '../ui';
import { OwnerSelect, money, relative, shortDate, useTeam } from './common';

const consentTone: Record<string, [string, Tone]> = { opted_in: ['Opted in', 'success'], unknown: ['No consent', 'neutral'], suppressed: ['Suppressed', 'error'] };

type ContactFilters = { q: string; ownerId: string; stage: string; tag: string; hasOpenDeal: string; activityAfter: string; activityBefore: string; consent: string };
const noContactFilters: ContactFilters = { q: '', ownerId: '', stage: '', tag: '', hasOpenDeal: '', activityAfter: '', activityBefore: '', consent: '' };

function SavedViews<T extends Record<string, string>>({ object, filters, sort, onApply }: {
  object: 'contacts' | 'companies'; filters: T; sort: { field: string; direction: 'asc' | 'desc' }; onApply: (filters: Partial<T>, sort: { field: string; direction: 'asc' | 'desc' } | null) => void;
}) {
  const views = useResource<SavedView[]>(`/platform/views?object=${object}`);
  const action = useAction();
  const [viewId, setViewId] = useState<string | null>(null);
  const [name, setName] = useState('');
  return <>
    <Selector label="Saved views" isLabelHidden width={200} placeholder="Saved views" hasClear value={viewId}
      options={(views.data ?? []).map(view => ({ value: view.id, label: view.name }))}
      onChange={value => {
        setViewId(value);
        const view = views.data?.find(item => item.id === value);
        if (view) onApply(Object.fromEntries(view.filters.map(filter => [filter.field, String(filter.value ?? '')])) as Partial<T>, view.sort);
      }} />
    <TextInput label="View name" isLabelHidden placeholder="Name this view" width={160} value={name} onChange={setName} />
    <Button size="sm" label="Save view" isDisabled={!name.trim()} isLoading={action.busy} onClick={() => void action.run(async () => {
      const saved = await api<SavedView>('/platform/views', 'POST', {
        object, name: name.trim(), sort, columns: [],
        filters: Object.entries(filters).filter(([, value]) => value).map(([field, value]) => ({ field, operator: 'eq', value })),
      });
      setName(''); setViewId(saved.id); views.refresh();
    }, 'View saved for the team.')} />
    {viewId ? <Button size="sm" variant="ghost" label="Delete view" onClick={() => void action.run(async () => { await api(`/platform/views/${viewId}`, 'DELETE'); setViewId(null); views.refresh(); })} /> : null}
    {action.error ? <Text type="supporting" color="secondary">{action.error}</Text> : null}
  </>;
}

export function CrmContactsList({ initialCreate = false }: { initialCreate?: boolean }) {
  const user = useUser();
  const router = useRouter();
  const { members } = useTeam();
  const stages = useResource<Stage[]>('/stages');
  const tags = useResource<Tag[]>('/tags');
  const action = useAction();
  const [filters, setFilters] = useState<ContactFilters>(noContactFilters);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ field: string; direction: 'asc' | 'desc' }>({ field: 'createdAt', direction: 'desc' });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<number[]>([]);
  const [modal, setModal] = useState<'create' | 'import' | null>(initialCreate ? 'create' : null);
  const [bulkTag, setBulkTag] = useState('');
  const params = new URLSearchParams({ page: String(page), limit: '25', sort: sort.field, dir: sort.direction });
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  const contacts = useResource<CrmContactPage>(`/crm/contacts?${params}`);
  const set = (patch: Partial<ContactFilters>) => { setFilters(current => ({ ...current, ...patch })); setPage(1); setSelected([]); };
  const items = contacts.data?.items ?? [];
  const pageIds = items.map(item => item.id);
  const allSelected = pageIds.length > 0 && pageIds.every(id => selected.includes(id));
  const stageOptions = (stages.data ?? []).map(stage => ({ value: stage.name, label: stage.name }));
  const ownerLabel = (id: string) => id === 'me' ? 'Me' : id === 'none' ? 'Unassigned' : members.find(member => member.id === id)?.name ?? 'Owner';
  const active = [
    ...(filters.q ? [{ key: 'q', label: `Search: ${filters.q}` }] : []),
    ...(filters.ownerId ? [{ key: 'ownerId', label: `Owner: ${ownerLabel(filters.ownerId)}` }] : []),
    ...(filters.stage ? [{ key: 'stage', label: `Stage: ${filters.stage}` }] : []),
    ...(filters.tag ? [{ key: 'tag', label: `Tag: ${filters.tag}` }] : []),
    ...(filters.hasOpenDeal ? [{ key: 'hasOpenDeal', label: filters.hasOpenDeal === 'yes' ? 'Has an open deal' : 'No open deal' }] : []),
    ...(filters.activityAfter ? [{ key: 'activityAfter', label: `Active since ${shortDate(filters.activityAfter)}` }] : []),
    ...(filters.activityBefore ? [{ key: 'activityBefore', label: `Last active before ${shortDate(filters.activityBefore)}` }] : []),
    ...(filters.consent ? [{ key: 'consent', label: `Consent: ${consentTone[filters.consent]?.[0]}` }] : []),
  ];
  const bulk = (task: () => Promise<unknown>, done: string) => void action.run(async () => { await task(); setSelected([]); contacts.refresh(); }, done);
  const setStage = (ids: number[], stageName: string | null) => async () => {
    const stage = stages.data?.find(item => item.name === stageName);
    for (const id of ids) await api(`/contacts/${id}/stage`, 'POST', { stageId: stage?.id ?? null });
  };

  return <div className="ov-stack ov-wide">
    <PageHeader title="Contacts" description="Everyone you sell and market to, with their owner, stage and open deals."
      actions={<>
        {user.role === 'admin' ? <Button label="Export CSV" icon={<Download size={15} />} isLoading={action.busy}
          onClick={() => void action.run(async () => saveFile(await api<string>('/contacts/export'), 'ovelio-contacts.csv', 'text/csv'))} /> : null}
        <Button label="Import CSV" icon={<Upload size={15} />} onClick={() => setModal('import')} />
        <Button label="Add contact" variant="primary" icon={<Plus size={16} />} onClick={() => setModal('create')} />
      </>} />
    <Feedback error={action.error} />
    <Panel>
      <Toolbar label="Search and views"
        end={<>
          <SavedViews object="contacts" filters={filters} sort={sort} onApply={(next, nextSort) => { setFilters({ ...noContactFilters, ...next }); setSearch(next.q ?? ''); if (nextSort) setSort(nextSort); setPage(1); }} />
          <Selector label="Sort" isLabelHidden width={190} value={`${sort.field}:${sort.direction}`} onChange={value => {
            const [field, direction] = (value ?? 'createdAt:desc').split(':');
            setSort({ field, direction: direction === 'asc' ? 'asc' : 'desc' }); setPage(1);
          }} options={[
            { value: 'createdAt:desc', label: 'Newest first' }, { value: 'createdAt:asc', label: 'Oldest first' },
            { value: 'lastActivity:desc', label: 'Recent activity' }, { value: 'openDealValue:desc', label: 'Open deal value' },
            { value: 'points:desc', label: 'Highest score' }, { value: 'lastName:asc', label: 'Last name A–Z' },
          ]} />
        </>}>
        <form onSubmit={event => { event.preventDefault(); set({ q: search.trim() }); }}>
          <TextInput label="Search contacts" isLabelHidden type="search" startIcon="search" placeholder="Name, email, company or tag" width={260} value={search} onChange={setSearch} />
        </form>
      </Toolbar>
      <FilterRow>
        <Selector label="Owner" width={170} value={filters.ownerId || 'all'} onChange={value => set({ ownerId: value && value !== 'all' ? value : '' })}
          options={[{ value: 'all', label: 'Any owner' }, { value: 'me', label: 'Mine' }, { value: 'none', label: 'Unassigned' }, ...members.map(member => ({ value: member.id, label: member.name }))]} />
        <Selector label="Lifecycle stage" width={170} hasClear placeholder="Any stage" value={filters.stage || null} onChange={value => set({ stage: value ?? '' })} options={stageOptions} />
        <Selector label="Tag" width={150} hasClear placeholder="Any tag" value={filters.tag || null} onChange={value => set({ tag: value ?? '' })}
          options={(tags.data ?? []).map(tag => ({ value: tag.tag, label: tag.tag }))} />
        <Selector label="Open deal" width={150} value={filters.hasOpenDeal || 'any'} onChange={value => set({ hasOpenDeal: value && value !== 'any' ? value : '' })}
          options={[{ value: 'any', label: 'Any' }, { value: 'yes', label: 'Has an open deal' }, { value: 'no', label: 'No open deal' }]} />
        <DateInput label="Active since" hasClear value={(filters.activityAfter || undefined) as never} onChange={value => set({ activityAfter: value ?? '' })} />
        <DateInput label="Last active before" hasClear value={(filters.activityBefore || undefined) as never} onChange={value => set({ activityBefore: value ?? '' })} />
        <Selector label="Email consent" width={150} value={filters.consent || 'any'} onChange={value => set({ consent: value && value !== 'any' ? value : '' })}
          options={[{ value: 'any', label: 'Any' }, { value: 'opted_in', label: 'Opted in' }, { value: 'unknown', label: 'No consent' }, { value: 'suppressed', label: 'Suppressed' }]} />
      </FilterRow>
      <FilterBar items={active} onRemove={key => { set({ [key]: '' } as Partial<ContactFilters>); if (key === 'q') setSearch(''); }} onClear={() => { set(noContactFilters); setSearch(''); }} />
      {selected.length ? <div className="ov-filter-bar" role="region" aria-label="Bulk contact actions">
        <Text weight="semibold">{selected.length} selected</Text>
        <Selector label="Assign owner" isLabelHidden width={170} placeholder="Assign owner…" value={null as unknown as string}
          options={[{ value: 'none', label: 'Unassigned' }, ...members.map(member => ({ value: member.id, label: member.name }))]}
          onChange={value => value && bulk(() => api('/crm/owners', 'POST', { object: 'contact', ids: selected, ownerId: value === 'none' ? null : value }), 'Owner assigned.')} />
        <Selector label="Set stage" isLabelHidden width={170} placeholder="Set stage…" value={null as unknown as string}
          options={[{ value: '__none', label: 'No stage' }, ...stageOptions]}
          onChange={value => value && bulk(setStage(selected, value === '__none' ? null : value), 'Lifecycle stage updated.')} />
        <TextInput label="Tag" isLabelHidden placeholder="Tag" width={130} value={bulkTag} onChange={setBulkTag} />
        <Button size="sm" label="Add tag" isDisabled={!bulkTag.trim()} onClick={() => bulk(() => api('/contacts/bulk', 'POST', { ids: selected, action: 'add_tag', tag: bulkTag.trim() }), 'Tag added.')} />
        <Button size="sm" variant="ghost" label="Remove tag" isDisabled={!bulkTag.trim()} onClick={() => bulk(() => api('/contacts/bulk', 'POST', { ids: selected, action: 'remove_tag', tag: bulkTag.trim() }), 'Tag removed.')} />
        <Button size="sm" variant="ghost" label="Clear selection" onClick={() => setSelected([])} />
      </div> : null}
      {contacts.data?.note ? <Banner status="info" title={contacts.data.note} /> : null}
      {!contacts.data ? <AsyncState loading={contacts.loading} error={contacts.error} retry={contacts.refresh} /> : <>
        <DataTable label="Contacts" minWidth={1240}>
          <Table data={items} idKey="id" hasHover density="compact"
            emptyState={<Empty title={active.length ? 'No contacts match these filters' : 'No contacts yet'} description={active.length ? undefined : 'Add a contact or import a CSV.'} />}
            columns={[
              { key: 'select', width: pixel(44), header: <CheckboxInput label="Select all contacts on this page" isLabelHidden size="sm"
                value={allSelected ? true : selected.length ? 'indeterminate' : false} onChange={checked => setSelected(checked ? pageIds : [])} />,
                renderCell: (contact: CrmContact) => <CheckboxInput label={`Select ${contact.name}`} isLabelHidden size="sm" value={selected.includes(contact.id)}
                  onChange={checked => setSelected(current => checked ? [...current, contact.id] : current.filter(id => id !== contact.id))} /> },
              { key: 'name', header: 'Contact', renderCell: (contact: CrmContact) => <span className="ov-cell ov-cell--nowrap">
                <NextLink href={`/crm/contacts/${contact.id}`}><Text weight="medium">{contact.name}</Text></NextLink>
                <Text type="supporting" color="secondary">{contact.email}</Text></span> },
              { key: 'company', header: 'Company', renderCell: (contact: CrmContact) => <span className="ov-cell"><span>{contact.company || '—'}</span>
                {contact.position ? <Text type="supporting" color="secondary">{contact.position}</Text> : null}</span> },
              { key: 'owner', header: 'Owner', width: pixel(170), renderCell: (contact: CrmContact) => <OwnerSelect label={`Owner of ${contact.name}`} isLabelHidden size="sm" width={156}
                value={contact.ownerId} members={members}
                onChange={owner => void action.run(async () => { await api('/crm/owners', 'POST', { object: 'contact', ids: [contact.id], ownerId: owner }); contacts.refresh(); })} /> },
              { key: 'stage', header: 'Lifecycle stage', width: pixel(170), renderCell: (contact: CrmContact) => <Selector label={`Stage of ${contact.name}`} isLabelHidden size="sm" width={156}
                value={contact.stageName ?? '__none'} options={[{ value: '__none', label: 'No stage' }, ...stageOptions]}
                onChange={value => void action.run(async () => { await setStage([contact.id], value && value !== '__none' ? value : null)(); contacts.refresh(); })} /> },
              { key: 'points', header: 'Score', width: pixel(70), renderCell: (contact: CrmContact) => contact.points },
              { key: 'tags', header: 'Tags', renderCell: (contact: CrmContact) => contact.tags.length ? <span className="ov-tags">{contact.tags.slice(0, 3).map(tag => <Token key={tag} label={tag} size="sm" />)}
                {contact.tags.length > 3 ? <Text type="supporting" color="secondary">+{contact.tags.length - 3}</Text> : null}</span> : '—' },
              { key: 'activity', header: 'Last activity', renderCell: (contact: CrmContact) => contact.lastActivityAt ? relative(contact.lastActivityAt) : 'None logged' },
              { key: 'deals', header: 'Open deals', renderCell: (contact: CrmContact) => contact.openDeals ? <span className="ov-cell"><span>{money(contact.openDealValue)}</span>
                <Text type="supporting" color="secondary">{contact.openDeals} deal{contact.openDeals === 1 ? '' : 's'}</Text></span> : '—' },
              { key: 'consent', header: 'Consent', renderCell: (contact: CrmContact) => <StatusBadge label={consentTone[contact.consent]?.[0] ?? contact.consent} tone={consentTone[contact.consent]?.[1] ?? 'neutral'} /> },
              { key: 'created', header: 'Created', renderCell: (contact: CrmContact) => shortDate(contact.createdAt) },
            ]} />
        </DataTable>
        <Pager page={contacts.data.page} limit={contacts.data.limit} total={contacts.data.total} onPage={next => { setPage(next); setSelected([]); }} />
      </>}
    </Panel>
    {modal === 'create' ? <ContactForm onClose={() => { setModal(null); if (initialCreate) router.replace('/crm'); }} onDone={contact => router.push(`/crm/contacts/${contact.id}`)} /> : null}
    {modal === 'import' ? <ImportForm onClose={() => { setModal(null); contacts.refresh(); }} onImported={contacts.refresh} /> : null}
  </div>;
}

export function CrmCompaniesList({ initialCreate = false }: { initialCreate?: boolean }) {
  const router = useRouter();
  const { members } = useTeam();
  const action = useAction();
  const [filters, setFilters] = useState({ q: '', ownerId: '', hasOpenDeal: '' });
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ field: string; direction: 'asc' | 'desc' }>({ field: 'name', direction: 'asc' });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<number[]>([]);
  const [creating, setCreating] = useState(initialCreate);
  const params = new URLSearchParams({ page: String(page), limit: '25', sort: sort.field, dir: sort.direction });
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  const companies = useResource<CrmCompanyPage>(`/crm/companies?${params}`);
  const set = (patch: Partial<typeof filters>) => { setFilters(current => ({ ...current, ...patch })); setPage(1); setSelected([]); };
  const items = companies.data?.items ?? [];
  const pageIds = items.map(item => item.id);
  return <div className="ov-stack ov-wide">
    <PageHeader title="Companies" description="Accounts, their owners, people and pipeline."
      actions={<>
        <Button label="Export CSV" icon={<Download size={15} />} isLoading={action.busy} onClick={() => void action.run(async () => {
          const all = await api<CrmCompanyPage>(`/crm/companies?${new URLSearchParams({ ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)), limit: '100' })}`);
          saveFile(Papa.unparse({ fields: ['Company', 'Website', 'Industry', 'City', 'Country', 'Owner', 'People', 'Open deals', 'Open value', 'Won revenue'],
            data: all.items.map(item => [item.name, item.website, item.industry, item.city, item.country, item.ownerName, item.people, item.openDeals, item.openValue, item.wonRevenue]) }, { escapeFormulae: true }),
          'ovelio-companies.csv', 'text/csv');
        })} />
        <Button label="Add company" variant="primary" icon={<Plus size={16} />} onClick={() => setCreating(true)} />
      </>} />
    <Feedback error={action.error} />
    <Panel>
      <Toolbar label="Search and views" end={<>
        <SavedViews object="companies" filters={filters} sort={sort} onApply={(next, nextSort) => { setFilters({ q: '', ownerId: '', hasOpenDeal: '', ...next }); setSearch(next.q ?? ''); if (nextSort) setSort(nextSort); setPage(1); }} />
        <Selector label="Sort" isLabelHidden width={180} value={`${sort.field}:${sort.direction}`} onChange={value => {
          const [field, direction] = (value ?? 'name:asc').split(':'); setSort({ field, direction: direction === 'desc' ? 'desc' : 'asc' }); setPage(1);
        }} options={[{ value: 'name:asc', label: 'Name A–Z' }, { value: 'openValue:desc', label: 'Open pipeline' }, { value: 'wonRevenue:desc', label: 'Won revenue' }, { value: 'lastActivity:desc', label: 'Recent activity' }]} />
      </>}>
        <form onSubmit={event => { event.preventDefault(); set({ q: search.trim() }); }}>
          <TextInput label="Search companies" isLabelHidden type="search" startIcon="search" placeholder="Name or website" width={240} value={search} onChange={setSearch} />
        </form>
        <Selector label="Owner" isLabelHidden width={160} value={filters.ownerId || 'all'} onChange={value => set({ ownerId: value && value !== 'all' ? value : '' })}
          options={[{ value: 'all', label: 'Any owner' }, { value: 'me', label: 'Mine' }, { value: 'none', label: 'Unassigned' }, ...members.map(member => ({ value: member.id, label: member.name }))]} />
        <Selector label="Open deal" isLabelHidden width={160} value={filters.hasOpenDeal || 'any'} onChange={value => set({ hasOpenDeal: value && value !== 'any' ? value : '' })}
          options={[{ value: 'any', label: 'Any pipeline' }, { value: 'yes', label: 'Has an open deal' }, { value: 'no', label: 'No open deal' }]} />
      </Toolbar>
      {selected.length ? <div className="ov-filter-bar" role="region" aria-label="Bulk company actions">
        <Text weight="semibold">{selected.length} selected</Text>
        <Selector label="Assign owner" isLabelHidden width={180} placeholder="Assign owner…" value={null as unknown as string}
          options={[{ value: 'none', label: 'Unassigned' }, ...members.map(member => ({ value: member.id, label: member.name }))]}
          onChange={value => value && void action.run(async () => { await api('/crm/owners', 'POST', { object: 'company', ids: selected, ownerId: value === 'none' ? null : value }); setSelected([]); companies.refresh(); }, 'Owner assigned.')} />
        <Button size="sm" variant="ghost" label="Clear selection" onClick={() => setSelected([])} />
      </div> : null}
      {!companies.data ? <AsyncState loading={companies.loading} error={companies.error} retry={companies.refresh} /> : <>
        <DataTable label="Companies" minWidth={1000}>
          <Table data={items} idKey="id" hasHover density="compact" emptyState={<Empty title="No companies match" description="Add a company or change the filters." />}
            columns={[
              { key: 'select', width: pixel(44), header: <CheckboxInput label="Select all companies on this page" isLabelHidden size="sm"
                value={pageIds.length > 0 && pageIds.every(id => selected.includes(id)) ? true : selected.length ? 'indeterminate' : false} onChange={checked => setSelected(checked ? pageIds : [])} />,
                renderCell: item => <CheckboxInput label={`Select ${item.name}`} isLabelHidden size="sm" value={selected.includes(item.id)}
                  onChange={checked => setSelected(current => checked ? [...current, item.id] : current.filter(id => id !== item.id))} /> },
              { key: 'name', header: 'Company', renderCell: item => <span className="ov-cell"><NextLink href={`/crm/companies/${item.id}`}><Text weight="medium">{item.name}</Text></NextLink>
                <Text type="supporting" color="secondary">{[item.industry, [item.city, item.country].filter(Boolean).join(', ')].filter(Boolean).join(' · ') || item.website || '—'}</Text></span> },
              { key: 'owner', header: 'Owner', width: pixel(170), renderCell: item => <OwnerSelect label={`Owner of ${item.name}`} isLabelHidden size="sm" width={156} value={item.ownerId} members={members}
                onChange={owner => void action.run(async () => { await api('/crm/owners', 'POST', { object: 'company', ids: [item.id], ownerId: owner }); companies.refresh(); })} /> },
              { key: 'people', header: 'People', width: pixel(80), renderCell: item => item.people },
              { key: 'open', header: 'Open deals', renderCell: item => item.openDeals ? <span className="ov-cell"><span>{money(item.openValue, item.currency)}</span><Text type="supporting" color="secondary">{item.openDeals} open</Text></span> : '—' },
              { key: 'won', header: 'Won revenue', renderCell: item => item.wonRevenue ? money(item.wonRevenue, item.currency) : '—' },
              { key: 'activity', header: 'Last activity', renderCell: item => item.lastActivityAt ? relative(item.lastActivityAt) : 'None logged' },
            ]} />
        </DataTable>
        <Pager page={companies.data.page} limit={companies.data.limit} total={companies.data.total} onPage={setPage} />
      </>}
    </Panel>
    {creating ? <CompanyForm onClose={() => { setCreating(false); if (initialCreate) router.replace('/crm/companies'); }} onDone={() => { setCreating(false); companies.refresh(); }} /> : null}
  </div>;
}
