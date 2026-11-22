'use client';

import { Download, Plus, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Field } from '@astryxdesign/core/Field';
import { Link } from '@astryxdesign/core/Link';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Selector } from '@astryxdesign/core/Selector';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Table } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import type { CompanySettings, Role, Settings as SettingsData, User } from '@/contracts';
import { api, date, saveFile, useAction, useFields, useResource } from './client';
import { useUser } from './shell';
import { AsyncState, Empty, Feedback, FormActions, Modal, PageHeader, Panel, Rows, Snippet, StatusBadge, Tabs } from './ui';

export type SettingsTab = 'Company' | 'Team' | 'Connections' | 'Data & privacy';
const tabs = ['Company', 'Team', 'Connections', 'Data & privacy'] as const satisfies readonly SettingsTab[];
const path = '/settings';
const roles = [
  { value: 'analyst', label: 'Analyst', description: 'View reports and analytics' },
  { value: 'marketer', label: 'Marketer', description: 'Manage audience, campaigns and automations' },
  { value: 'admin', label: 'Admin', description: 'Full access including team, settings and exports' },
] satisfies { value: Role; label: string; description: string }[];
type DomainResult = { domain: string; selector: string; spf: boolean | null; dkim: boolean | null; dmarc: boolean | null };

function CompanyForm({ company, onSaved }: { company: CompanySettings; onSaved: () => void }) {
  const action = useAction();
  const { values, field, setValues } = useFields({
    name: company.name, website: company.website, privacyUrl: company.privacyUrl, postalAddress: company.postalAddress,
    accent: /^#[0-9a-f]{6}$/i.test(company.accent) ? company.accent : '#2457d6',
  });
  return <Panel title="Company profile" description="Your workspace identity and the details used in marketing disclosures.">
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        await api(path, 'PATCH', { company: { ...values, name: values.name.trim(), website: values.website.trim(), privacyUrl: values.privacyUrl.trim(), postalAddress: values.postalAddress.trim() } });
        onSaved();
      }, 'Company profile saved.');
    }}>
      <div className="ov-form-grid">
        <TextInput label="Company name" isRequired {...field('name')} />
        <TextInput label="Company website" type="url" placeholder="https://example.com" isOptional {...field('website')} />
        <TextInput label="Privacy policy URL" type="url" placeholder="https://example.com/privacy" isOptional {...field('privacyUrl')} />
        <Field label="Brand accent" inputID="ov-accent" description="Used for charts and highlights in this workspace.">
          <input id="ov-accent" className="ov-color" type="color" value={values.accent} onChange={event => setValues(current => ({ ...current, accent: event.target.value }))} />
        </Field>
      </div>
      <TextArea label="Postal address" description="Included in marketing email footers for UK PECR compliance." rows={3} isOptional {...field('postalAddress')} />
      <Feedback error={action.error} notice={action.notice} />
      <FormActions><Button type="submit" variant="primary" label="Save company profile" isLoading={action.busy} isDisabled={!values.name.trim()} /></FormActions>
    </form>
  </Panel>;
}

function TeamDialog({ member, onClose, onDone }: { member?: User; onClose: () => void; onDone: (message: string) => void }) {
  const current = useUser();
  const action = useAction();
  const [disable, setDisable] = useState(false);
  const [role, setRole] = useState<Role>(member?.role ?? 'analyst');
  const { values, field } = useFields({ name: '', email: '', password: '' });
  return <Modal title={member ? 'Edit team member' : 'Add team member'} onClose={onClose}>
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        if (member) await api(`${path}/team/${member.id}`, 'PATCH', disable ? { disabled: true } : { role, ...(values.password ? { password: values.password } : {}) });
        else await api(`${path}/team`, 'POST', { name: values.name.trim(), email: values.email.trim(), role, password: values.password });
        onDone(disable ? 'Team member disabled.' : member ? 'Team member updated.' : 'Team member added.');
      });
    }}>
      {member ? <Text color="secondary">{member.name} · {member.email}</Text> : <>
        <TextInput label="Name" isRequired {...field('name')} />
        <TextInput label="Email address" type="email" autoComplete="off" isRequired {...field('email')} />
      </>}
      {disable ? <Text>This revokes the member’s workspace access and signs them out.</Text> : <>
        <Selector label="Role" value={role} onChange={value => setRole((value as Role) || 'analyst')} options={roles} />
        <TextInput label={member ? 'New password' : 'Initial password'} type="password" autoComplete="new-password" isRequired={!member} isOptional={!!member}
          description={member ? 'Leave blank to keep the current password.' : 'Use 14 or more characters and share it securely.'} {...field('password')} />
      </>}
      <Feedback error={action.error} />
      <FormActions>
        {member && member.id !== current.id && !disable ? <Button variant="destructive" label="Disable access…" onClick={() => setDisable(true)} /> : null}
        {disable ? <Button label="Back" onClick={() => setDisable(false)} /> : <Button label="Cancel" onClick={onClose} />}
        <Button type="submit" variant={disable ? 'destructive' : 'primary'} label={disable ? 'Disable account' : member ? 'Save member' : 'Add team member'} isLoading={action.busy} />
      </FormActions>
    </form>
  </Modal>;
}

function Team({ members, onSaved }: { members: User[]; onSaved: () => void }) {
  const [edit, setEdit] = useState<User | 'new'>();
  const [notice, setNotice] = useState('');
  return <div className="ov-stack-sm">
    <Feedback notice={notice} />
    <Panel title="Team access" description="Assign access to reports, marketing operations and administration."
      action={<Button variant="primary" size="sm" label="Add team member" icon={<Plus size={14} />} onClick={() => setEdit('new')} />}>
      <Table data={members} idKey="id" emptyState={<Empty title="No team members found" />} columns={[
        { key: 'name', header: 'Name' },
        { key: 'email', header: 'Email' },
        { key: 'role', header: 'Role', renderCell: member => <StatusBadge label={member.role[0].toUpperCase() + member.role.slice(1)} tone={member.role === 'admin' ? 'info' : 'neutral'} /> },
        { key: 'id', header: 'Access', align: 'end', renderCell: member => <Button size="sm" label={`Edit ${member.name}`} onClick={() => setEdit(member)}>Edit</Button> },
      ]} />
    </Panel>
    {edit ? <TeamDialog member={edit === 'new' ? undefined : edit} onClose={() => setEdit(undefined)} onDone={message => { setEdit(undefined); setNotice(message); onSaved(); }} /> : null}
  </div>;
}

function Connections({ data, refresh, loading }: { data: SettingsData; refresh: () => void; loading: boolean }) {
  const [domain, setDomain] = useState<DomainResult>();
  const dns = useAction();
  const retry = useAction();
  const connections = [
    { name: 'Audience and automation', health: data.health.audience },
    { name: 'Newsletter delivery', health: data.health.delivery },
    { name: 'Website tracking', health: data.health.tracking },
    { name: 'Background jobs', health: data.health.worker },
  ];
  return <div className="ov-stack">
    <div className="ov-grid">
      <Panel title="Connection health" action={<Button size="sm" label="Check connections" icon={<RefreshCw size={14} />} onClick={refresh} isLoading={loading} />}>
        <Rows>{connections.map(item => <li key={item.name}>
          <span><Text weight="medium">{item.name}</Text>{item.health.message ? <Text type="supporting" color="secondary">{item.health.message}</Text> : null}</span>
          <span className="ov-actions"><StatusDot variant={item.health.status === 'ready' ? 'success' : 'warning'} label={item.health.status === 'ready' ? 'Connected' : 'Unavailable'} />
            <Text type="supporting">{item.health.status === 'ready' ? 'Connected' : 'Unavailable'}</Text></span>
        </li>)}</Rows>
        <Text type="supporting" color="secondary">Service credentials are held server-side in the deployment environment and never reach the browser.</Text>
      </Panel>
      <Panel title="Email delivery" action={<StatusBadge label={data.sender.configured ? 'Configured' : 'Setup required'} tone={data.sender.configured ? 'success' : 'warning'} />}>
        <MetadataList>
          <MetadataListItem label="Sender address">{data.sender.fromEmail || '—'}</MetadataListItem>
          <MetadataListItem label="Provider">{data.sender.provider || '—'}</MetadataListItem>
          <MetadataListItem label="SMTP host">{data.sender.smtpHost || '—'}</MetadataListItem>
          <MetadataListItem label="Verified domain">{data.sender.verifiedDomain || '—'}</MetadataListItem>
        </MetadataList>
        <Text type="supporting" color="secondary">Set the sender and SMTP relay in the deployment environment. Use a provider-verified domain for production delivery.</Text>
      </Panel>
      <Panel title="Sender domain records" action={<Button size="sm" label="Check DNS" isLoading={dns.busy} onClick={() => void dns.run(async () => setDomain(await api<DomainResult>(path + '/sender-domain')))} />}>
        <Feedback error={dns.error} />
        {domain ? <>
          <Text type="supporting" color="secondary">{domain.domain}{domain.selector ? ` · DKIM selector ${domain.selector}` : ''}</Text>
          <Rows>{([['SPF', domain.spf], ['DKIM', domain.dkim], ['DMARC', domain.dmarc]] as const).map(([label, exists]) => <li key={label}>
            <Text>{label}</Text><StatusBadge label={exists == null ? 'Unavailable' : exists ? 'Record found' : 'Missing'} tone={exists == null ? 'neutral' : exists ? 'success' : 'warning'} />
          </li>)}</Rows>
        </> : <Text color="secondary">Look up SPF, DKIM and DMARC records for the configured sender domain.</Text>}
      </Panel>
      <Panel title="Website tracking">
        <MetadataList><MetadataListItem label="Tracking origin">{data.trackingOrigin || '—'}</MetadataListItem></MetadataList>
        <Link href="/analytics">Manage websites</Link>
      </Panel>
    </div>
    {data.failedJobs?.length ? <Panel title="Failed background jobs" description="Retry after checking the affected service connection.">
      <Feedback error={retry.error} notice={retry.notice} />
      <Rows>{data.failedJobs.map(job => <li key={job.id}>
        <span><Text weight="medium">{job.kind.replaceAll('_', ' ').replaceAll('-', ' ')}</Text><Text type="supporting" color="secondary">{job.attempts} attempts · {date(job.at)}</Text></span>
        <Button size="sm" label="Retry" isDisabled={retry.busy} onClick={() => void retry.run(async () => { await api(`${path}/jobs/${job.id}/retry`, 'POST'); refresh(); }, 'Job queued for retry.')} />
      </li>)}</Rows>
    </Panel> : null}
  </div>;
}

function DataPrivacy({ company }: { company: CompanySettings }) {
  const exporter = useAction();
  return <div className="ov-grid">
    <Panel title="Contact data" description="Import, export and erase contact records.">
      <Text>Open a contact to review marketing consent, export its data or erase its record. Suppression applies to newsletter and automation delivery alike.</Text>
      <div className="ov-actions"><Button label="Open Audience" href="/audience" />
        <Button label="Export contacts" icon={<Download size={15} />} isLoading={exporter.busy}
          onClick={() => void exporter.run(async () => saveFile(await api<string>('/contacts/export'), 'ovelio-contacts.csv', 'text/csv'))} /></div>
      <Feedback error={exporter.error} />
    </Panel>
    <Panel title="Privacy policy">
      {company.privacyUrl ? <Link href={company.privacyUrl} isExternalLink>{company.privacyUrl}</Link> : <Text color="secondary">Add your privacy policy URL in the Company tab.</Text>}
    </Panel>
    <Panel title="Backups and restore" description="Run these commands from your installation directory.">
      <Snippet language="bash" code="sh deploy/backup.sh /path/to/new-backup-directory" />
      <Snippet language="bash" code="sh deploy/restore.sh /path/to/backup-directory" />
      <Text type="supporting" color="secondary">Store backups encrypted with their matching .env. Restore into a fresh installation with the same deployment credentials.</Text>
    </Panel>
  </div>;
}

export function Settings({ initialTab }: { initialTab: SettingsTab }) {
  const router = useRouter();
  const [view, setView] = useState<SettingsTab>();
  const tab = view ?? initialTab;
  const resource = useResource<SettingsData>(path);
  return <>
    <PageHeader title="Settings" description="Manage the workspace, team, delivery and privacy preferences." />
    <Tabs label="Settings view" items={tabs} value={tab} onChange={setView} />
    {!resource.data ? <Panel><AsyncState loading={resource.loading} error={resource.error} retry={resource.refresh} /></Panel>
      : tab === 'Company' ? <CompanyForm company={resource.data.company} onSaved={() => { resource.refresh(); router.refresh(); }} />
        : tab === 'Team' ? <Team members={resource.data.team} onSaved={resource.refresh} />
          : tab === 'Connections' ? <Connections data={resource.data} refresh={resource.refresh} loading={resource.loading} />
            : <DataPrivacy company={resource.data.company} />}
  </>;
}
