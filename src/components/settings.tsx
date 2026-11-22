'use client';

import { Download, MailCheck, Plus, RefreshCw, Trash2 } from 'lucide-react';
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
import type { CompanySettings, MaintenanceResult, Role, Settings as SettingsData, User } from '@/contracts';
import { api, date, number, saveFile, useAction, useFields, useResource } from './client';
import { useUser } from './shell';
import { AsyncState, ConfirmDialog, Empty, Feedback, FormActions, Modal, PageHeader, Panel, Rows, Snippet, StatusBadge, Tabs } from './ui';

export type SettingsTab = 'Company' | 'Team' | 'Connections' | 'Data & privacy';
const tabs = ['Company', 'Team', 'Connections', 'Data & privacy'] as const satisfies readonly SettingsTab[];
const path = '/settings';
const roles = [
  { value: 'analyst', label: 'Analyst', description: 'View reports and analytics' },
  { value: 'marketer', label: 'Marketer', description: 'Manage audience, campaigns and automations' },
  { value: 'admin', label: 'Admin', description: 'Full access including team, settings and exports' },
] satisfies { value: Role; label: string; description: string }[];

type DomainResult = { domain: string; selector: string; spf: boolean | null; dkim: boolean | null; dmarc: boolean | null };
type MaintenanceActionKey = 'gc_unconfirmed' | 'gc_orphan' | 'gc_blocklisted' | 'gc_analytics';

const maintenanceTasks: readonly {
  action: MaintenanceActionKey;
  title: string;
  description: string;
  confirmTitle: string;
  confirmDescription: string;
  buttonLabel: string;
  confirmLabel: string;
}[] = [
  {
    action: 'gc_unconfirmed',
    title: 'Clean unconfirmed subscriptions',
    description: 'Remove pending double opt-in list subscriptions that were never confirmed.',
    confirmTitle: 'Clean unconfirmed subscriptions',
    confirmDescription: 'Remove all unconfirmed list subscriptions from the delivery service? Confirmed subscriptions and consent history are not affected.',
    buttonLabel: 'Clean up',
    confirmLabel: 'Clean unconfirmed',
  },
  {
    action: 'gc_orphan',
    title: 'Clean orphaned subscribers',
    description: 'Remove delivery subscriber records that are no longer associated with any mailing list.',
    confirmTitle: 'Clean orphaned subscribers',
    confirmDescription: 'Delete delivery subscriber entries that have no list memberships? Active contacts in Audience remain untouched.',
    buttonLabel: 'Clean up',
    confirmLabel: 'Clean orphans',
  },
  {
    action: 'gc_blocklisted',
    title: 'Clean blocklisted subscribers',
    description: 'Remove permanently blocklisted delivery subscriber records. Suppressions remain recorded in OVELIO to block future sends.',
    confirmTitle: 'Clean blocklisted subscribers',
    confirmDescription: 'Remove permanently blocklisted delivery subscriber records? Suppressions remain recorded in OVELIO to block future sends.',
    buttonLabel: 'Clean up',
    confirmLabel: 'Clean blocklisted',
  },
  {
    action: 'gc_analytics',
    title: 'Prune email analytics older than 90 days',
    description: 'Delete historical open, click, link and bounce event logs recorded more than 90 days ago.',
    confirmTitle: 'Prune old email analytics',
    confirmDescription: 'Permanently delete granular email analytics logs older than 90 days? Aggregate newsletter totals remain stored, but detailed event logs for that period cannot be restored.',
    buttonLabel: 'Prune logs',
    confirmLabel: 'Prune analytics',
  },
];

const licenceSummary = [
  {
    component: 'Audience & automation service',
    licence: 'GPL-3.0-or-later',
    obligation: 'Pinned release. Provide corresponding source for any redistributed binaries or images.',
  },
  {
    component: 'Newsletter delivery service',
    licence: 'AGPL-3.0-only',
    obligation: 'Pinned release. Offer corresponding source to network users if the service is modified.',
  },
  {
    component: 'Website analytics service',
    licence: 'MIT',
    obligation: 'Pinned release. Retain copyright and permission notices with distributions.',
  },
  {
    component: 'Supporting runtimes & databases',
    licence: 'Apache-2.0, PostgreSQL, GPL-2.0, MIT',
    obligation: 'Reverse proxy, database servers and Node.js runtime; preserve bundled notices.',
  },
  {
    component: 'Interface & icon libraries',
    licence: 'MIT, SIL OFL 1.1, ISC',
    obligation: 'Astryx design system, StyleX runtime, Figtree typeface and Lucide icon set.',
  },
] as const;

function resolveSettingsTab(value?: string): SettingsTab {
  const normalized = value?.trim().toLowerCase();
  return tabs.find(item => item.toLowerCase() === normalized) ?? 'Company';
}

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
        await api(path, 'PATCH', {
          company: {
            ...values,
            name: values.name.trim(),
            website: values.website.trim(),
            privacyUrl: values.privacyUrl.trim(),
            postalAddress: values.postalAddress.trim(),
          },
        });
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
  const [pending, setPending] = useState<'submit' | 'reenable'>();
  const [role, setRole] = useState<Role>(member?.role ?? 'analyst');
  const { values, field } = useFields({ name: '', email: '', password: '' });
  const isDisabledMember = Boolean(member?.disabled);

  return <Modal title={member ? 'Edit team member' : 'Add team member'} onClose={onClose}>
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      setPending('submit');
      void action.run(async () => {
        if (member) await api(`${path}/team/${member.id}`, 'PATCH', disable ? { disabled: true } : { role, ...(values.password ? { password: values.password } : {}) });
        else await api(`${path}/team`, 'POST', { name: values.name.trim(), email: values.email.trim(), role, password: values.password });
        onDone(disable ? 'Team member disabled.' : member ? 'Team member updated.' : 'Team member added.');
      });
    }}>
      {member ? <div className="ov-actions ov-actions--between">
        <Text color="secondary">{member.name} · {member.email}</Text>
        <StatusBadge label={isDisabledMember ? 'Disabled' : 'Active'} tone={isDisabledMember ? 'warning' : 'success'} />
      </div> : <>
        <TextInput label="Name" isRequired {...field('name')} />
        <TextInput label="Email address" type="email" autoComplete="off" isRequired {...field('email')} />
      </>}
      {disable ? <Text>This revokes the member’s workspace access and signs them out.</Text> : <>
        {isDisabledMember ? <Text type="supporting" color="secondary">This account is disabled and cannot sign in. Re-enable access to restore workspace login.</Text> : null}
        <Selector label="Role" value={role} onChange={value => setRole((value as Role) || 'analyst')} options={roles} />
        <TextInput label={member ? 'New password' : 'Initial password'} type="password" autoComplete="new-password" isRequired={!member} isOptional={!!member}
          description={member ? 'Leave blank to keep the current password.' : 'Use 14 or more characters and share it securely.'} {...field('password')} />
      </>}
      <Feedback error={action.error} />
      <FormActions>
        {member && !isDisabledMember && member.id !== current.id && !disable ? (
          <Button variant="destructive" label="Disable access…" isDisabled={action.busy} onClick={() => setDisable(true)} />
        ) : null}
        {disable ? (
          <Button label="Back" isDisabled={action.busy} onClick={() => setDisable(false)} />
        ) : (
          <Button label="Cancel" isDisabled={action.busy} onClick={onClose} />
        )}
        {member && isDisabledMember ? <>
          <Button
            type="submit"
            label="Save member"
            isLoading={action.busy && pending === 'submit'}
            isDisabled={action.busy && pending !== 'submit'}
          />
          <Button
            variant="primary"
            label="Re-enable access"
            isLoading={action.busy && pending === 'reenable'}
            isDisabled={action.busy && pending !== 'reenable'}
            onClick={() => {
              setPending('reenable');
              void action.run(async () => {
                await api(`${path}/team/${member.id}`, 'PATCH', {
                  disabled: false,
                  ...(role !== member.role ? { role } : {}),
                  ...(values.password ? { password: values.password } : {}),
                });
                onDone('Team member access re-enabled.');
              });
            }}
          />
        </> : (
          <Button
            type="submit"
            variant={disable ? 'destructive' : 'primary'}
            label={disable ? 'Disable account' : member ? 'Save member' : 'Add team member'}
            isLoading={action.busy && pending === 'submit'}
          />
        )}
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
        { key: 'disabled', header: 'Status', renderCell: member => <StatusBadge label={member.disabled ? 'Disabled' : 'Active'} tone={member.disabled ? 'warning' : 'success'} /> },
        { key: 'id', header: 'Access', align: 'end', renderCell: member => <Button size="sm" label={`Edit ${member.name}`} onClick={() => setEdit(member)}>Edit</Button> },
      ]} />
    </Panel>
    {edit ? <TeamDialog member={edit === 'new' ? undefined : edit} onClose={() => setEdit(undefined)} onDone={message => { setEdit(undefined); setNotice(message); onSaved(); }} /> : null}
  </div>;
}

function Connections({ data, refresh, loading }: { data: SettingsData; refresh: () => void; loading: boolean }) {
  const [domain, setDomain] = useState<DomainResult>();
  const [smtpRecipient, setSmtpRecipient] = useState('');
  const dns = useAction();
  const retry = useAction();
  const smtpTest = useAction();
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
        <form
          className="ov-stack-sm"
          style={{ paddingTop: 12, borderTop: '1px solid var(--color-border)' }}
          onSubmit={event => {
            event.preventDefault();
            void smtpTest.run(async () => {
              await api(`${path}/smtp/test`, 'POST', { email: smtpRecipient.trim() });
              setSmtpRecipient('');
            }, 'SMTP diagnostic email sent.');
          }}
        >
          <TextInput
            label="Send SMTP diagnostic test"
            type="email"
            placeholder="opted-in@example.com"
            description="Verify live SMTP delivery using an opted-in audience contact."
            isRequired
            value={smtpRecipient}
            onChange={setSmtpRecipient}
          />
          <Feedback error={smtpTest.error} notice={smtpTest.notice} />
          <FormActions>
            <Button
              type="submit"
              size="sm"
              icon={<MailCheck size={14} />}
              label="Send diagnostic test"
              isLoading={smtpTest.busy}
              isDisabled={!smtpRecipient.trim()}
            />
          </FormActions>
        </form>
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
  const user = useUser();
  const exporter = useAction();
  const maintenance = useAction();
  const [confirmTask, setConfirmTask] = useState<typeof maintenanceTasks[number]>();
  const [maintenanceNotice, setMaintenanceNotice] = useState('');

  return <div className="ov-stack">
    <div className="ov-grid">
      <Panel title="Contact data" description="Import, export and erase contact records.">
        <Text>Open a contact to review marketing consent, export its data or erase its record. Suppression applies to newsletter and automation delivery alike.</Text>
        <div className="ov-actions">
          <Button label="Open Audience" href="/audience" />
          <Button label="Export contacts" icon={<Download size={15} />} isLoading={exporter.busy}
            onClick={() => void exporter.run(async () => saveFile(await api<string>('/contacts/export'), 'ovelio-contacts.csv', 'text/csv'))} />
        </div>
        <Feedback error={exporter.error} />
      </Panel>

      {user.role === 'admin' ? <Panel title="Delivery maintenance" description="Safe housekeeping tasks for the newsletter delivery database.">
        <Feedback error={maintenance.error} notice={maintenanceNotice || maintenance.notice} />
        <Rows>{maintenanceTasks.map(task => <li key={task.action}>
          <span>
            <Text weight="medium">{task.title}</Text>
            <Text type="supporting" color="secondary">{task.description}</Text>
          </span>
          <Button
            size="sm"
            icon={<Trash2 size={14} />}
            label={task.buttonLabel}
            isDisabled={maintenance.busy}
            onClick={() => { setMaintenanceNotice(''); setConfirmTask(task); }}
          />
        </li>)}</Rows>
      </Panel> : null}

      <Panel title="Privacy policy">
        {company.privacyUrl ? <Link href={company.privacyUrl} isExternalLink>{company.privacyUrl}</Link> : <Text color="secondary">Add your privacy policy URL in the Company tab.</Text>}
      </Panel>

      <Panel title="Backups and restore" description="Run these commands from your installation directory.">
        <Snippet language="bash" code="sh deploy/backup.sh /path/to/new-backup-directory" />
        <Snippet language="bash" code="sh deploy/restore.sh /path/to/backup-directory" />
        <Text type="supporting" color="secondary">Store backups encrypted with their matching .env. Restore into a fresh installation with the same deployment credentials.</Text>
      </Panel>
    </div>

    <Panel
      title="Third-party licences and compliance"
      description="Open-source software obligations for this unified OVELIO deployment."
    >
      <Rows>{licenceSummary.map(item => <li key={item.component}>
        <span>
          <Text weight="medium">{item.component}</Text>
          <Text type="supporting" color="secondary">{item.obligation}</Text>
        </span>
        <StatusBadge label={item.licence} tone="neutral" />
      </li>)}</Rows>
      <Text type="supporting" color="secondary">
        Complete upstream version pins, source links and full licence texts accompany this installation in NOTICE.md and deploy/licenses/. Generate a runtime software bill of materials for releases with:
      </Text>
      <Snippet language="bash" code="npm sbom --omit=dev --sbom-format spdx" />
    </Panel>

    {confirmTask ? <ConfirmDialog
      title={confirmTask.confirmTitle}
      description={confirmTask.confirmDescription}
      actionLabel={confirmTask.confirmLabel}
      busy={maintenance.busy}
      onClose={() => setConfirmTask(undefined)}
      onConfirm={() => {
        const task = confirmTask;
        void maintenance.run(async () => {
          const result = await api<MaintenanceResult>(`${path}/maintenance`, 'POST', { action: task.action });
          setConfirmTask(undefined);
          if (task.action === 'gc_analytics') {
            setMaintenanceNotice('Pruned email analytics logs older than 90 days.');
          } else {
            const labelByAction: Record<Exclude<MaintenanceActionKey, 'gc_analytics'>, string> = {
              gc_unconfirmed: 'unconfirmed subscription',
              gc_orphan: 'orphaned subscriber',
              gc_blocklisted: 'blocklisted subscriber',
            };
            const kind = labelByAction[task.action];
            setMaintenanceNotice(`Removed ${number(result.count)} ${kind}${result.count === 1 ? '' : 's'}.`);
          }
        });
      }}
    /> : null}
  </div>;
}

export function Settings({ initialTab = 'Company' }: { initialTab?: SettingsTab | string }) {
  const router = useRouter();
  const [view, setView] = useState<SettingsTab>();
  const tab = view ?? resolveSettingsTab(initialTab);
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
