'use client';

import { Download, ExternalLink, Plus, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { CompanySettings, Role, Settings as SettingsData, User } from '@/contracts';
import { api, date, useAction, useResource } from './client';
import { useUser } from './shell';
import { AsyncState, Badge, Button, Dialog, Empty, Feedback, Field, PageHeader, Panel } from './ui';

export type SettingsTab = 'Company' | 'Team' | 'Connections' | 'Data & privacy';
const tabs: SettingsTab[] = ['Company', 'Team', 'Connections', 'Data & privacy'];
const path = '/settings';
const roles: Role[] = ['analyst', 'marketer', 'admin'];
type DomainResult = { domain: string; selector: string; spf: boolean | null; dkim: boolean | null; dmarc: boolean | null };

function CompanyForm({ company, onSaved }: { company: CompanySettings; onSaved: () => void }) {
  const action = useAction();
  const accent = /^#[0-9a-f]{6}$/i.test(company.accent) ? company.accent : '#2456cf';
  return <Panel title="Company profile" description="Set your workspace identity and the details used for marketing disclosures.">
    <form className="panel-body form-stack" onSubmit={event => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const fields: CompanySettings = {
        name: String(data.get('name')).trim(),
        website: String(data.get('website')).trim(),
        accent: String(data.get('accent')),
        privacyUrl: String(data.get('privacyUrl')).trim(),
        postalAddress: String(data.get('postalAddress')).trim(),
      };
      void action.run(async () => {
        await api(path, 'PATCH', { company: fields });
        onSaved();
      }, 'Company profile saved.');
    }}>
      <div className="form-grid">
        <Field label="Company name"><input name="name" required defaultValue={company.name} maxLength={120} /></Field>
        <Field label="Company website"><input name="website" type="url" defaultValue={company.website} maxLength={500} placeholder="https://example.com" /></Field>
        <Field label="Privacy policy URL"><input name="privacyUrl" type="url" defaultValue={company.privacyUrl} maxLength={500} placeholder="https://example.com/privacy" /></Field>
        <Field label="Brand accent"><input type="color" name="accent" defaultValue={accent} /></Field>
      </div>
      <Field label="Postal address"><textarea name="postalAddress" maxLength={300} defaultValue={company.postalAddress} rows={3} /></Field>
      <Feedback error={action.error} notice={action.notice} />
      <div className="form-actions"><Button type="submit" variant="primary" disabled={action.busy}>Save company profile</Button></div>
    </form>
  </Panel>;
}

function TeamDialog({ member, onClose, onDone }: { member?: User; onClose: () => void; onDone: (message: string) => void }) {
  const current = useUser();
  const action = useAction();
  const [disable, setDisable] = useState(false);
  return <Dialog title={member ? 'Edit team member' : 'Add team member'} onClose={onClose}>
    <form className="form-stack" onSubmit={event => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const role = String(data.get('role')) as Role;
      const password = String(data.get('password') || '');
      void action.run(async () => {
        if (member) await api(`${path}/team/${member.id}`, 'PATCH', disable ? { disabled: true } : { role, ...(password ? { password } : {}) });
        else await api(`${path}/team`, 'POST', { name: String(data.get('name')).trim(), email: String(data.get('email')).trim(), role, password });
        onDone(disable ? 'Team member disabled.' : member ? 'Team member updated.' : 'Team member added.');
      });
    }}>
      {member ? <p className="caption">{member.name} · {member.email}</p> : <>
        <Field label="Name"><input name="name" required maxLength={120} /></Field>
        <Field label="Email address"><input name="email" type="email" required maxLength={254} autoComplete="off" /></Field>
      </>}
      {disable ? <p>This revokes the member’s workspace access and signs them out.</p> : <>
        <Field label="Role"><select name="role" defaultValue={member?.role || 'analyst'}>{roles.map(role => <option key={role} value={role}>{role[0].toUpperCase() + role.slice(1)}</option>)}</select></Field>
        <Field label={member ? 'New password' : 'Initial password'} help={member ? 'Leave blank to keep the current password.' : 'Use 14 or more characters and share it securely.'}>
          <input type="password" name="password" autoComplete="new-password" minLength={14} maxLength={128} required={!member} />
        </Field>
      </>}
      <Feedback error={action.error} />
      <div className="form-actions">
        {member && member.id !== current.id && !disable ? <Button variant="danger" onClick={() => setDisable(true)}>Disable access…</Button> : null}
        {disable ? <Button onClick={() => setDisable(false)}>Back</Button> : <Button onClick={onClose}>Cancel</Button>}
        <Button type="submit" variant={disable ? 'danger' : 'primary'} disabled={action.busy}>
          {disable ? 'Disable account' : member ? 'Save member' : 'Add team member'}
        </Button>
      </div>
    </form>
  </Dialog>;
}

function Team({ members, onSaved }: { members: User[]; onSaved: () => void }) {
  const [edit, setEdit] = useState<User | 'new'>();
  const [notice, setNotice] = useState('');
  return <div className="stack-small">
    <Feedback notice={notice} />
    <Panel title="Team access" description="Assign access to reports, marketing operations and administration."
      action={<Button variant="primary" onClick={() => setEdit('new')}><Plus size={15} /> Add team member</Button>}>
      {members.length ? <div className="table-wrap"><table className="table">
        <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Access</th></tr></thead>
        <tbody>{members.map(member => <tr key={member.id}>
          <td>{member.name}</td><td>{member.email}</td><td><Badge tone={member.role === 'admin' ? 'blue' : 'neutral'}>{member.role}</Badge></td>
          <td><Button onClick={() => setEdit(member)} aria-label={`Edit ${member.name}`}>Edit</Button></td>
        </tr>)}</tbody>
      </table></div> : <Empty title="No team members found" />}
    </Panel>
    {edit ? <TeamDialog member={edit === 'new' ? undefined : edit} onClose={() => setEdit(undefined)} onDone={message => {
      setEdit(undefined);
      setNotice(message);
      onSaved();
    }} /> : null}
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
  return <div className="stack">
    <div className="columns">
      <Panel title="Connection health" action={<Button onClick={refresh} disabled={loading}><RefreshCw size={15} /> Check connections</Button>}>
        <div className="panel-body"><ul className="line-list">
          {connections.map(item => <li key={item.name}>
            <span><strong>{item.name}</strong>{item.health.message ? <small>{item.health.message}</small> : null}</span>
            <Badge tone={item.health.status === 'ready' ? 'green' : 'amber'}>{item.health.status === 'ready' ? 'Connected' : 'Unavailable'}</Badge>
          </li>)}
        </ul><p className="caption">Manage API credentials in the deployment environment.</p></div>
      </Panel>
      <Panel title="Email delivery" action={<Badge tone={data.sender.configured ? 'green' : 'amber'}>{data.sender.configured ? 'Configured' : 'Setup required'}</Badge>}>
        <div className="panel-body stack-small">
          <dl className="definition-list">
            <dt>Sender address</dt><dd>{data.sender.fromEmail || '—'}</dd>
            <dt>Provider</dt><dd>{data.sender.provider || '—'}</dd>
            <dt>SMTP host</dt><dd>{data.sender.smtpHost || '—'}</dd>
            <dt>Sender domain</dt><dd>{data.sender.verifiedDomain || '—'}</dd>
          </dl>
          <p className="caption">Set the sender and SMTP credentials in the deployment environment. Use a verified domain for production delivery.</p>
        </div>
      </Panel>
      <Panel title="Sender domain records" action={<Button disabled={dns.busy} onClick={() => void dns.run(async () => setDomain(await api<DomainResult>(path + '/sender-domain')))}>
        {dns.busy ? 'Checking…' : 'Check DNS'}
      </Button>}>
        <div className="panel-body stack-small">
          <Feedback error={dns.error} />
          {domain ? <>
            <p className="caption">{domain.domain}{domain.selector ? ` · DKIM selector ${domain.selector}` : ''}</p>
            <ul className="line-list">
              {([['SPF', domain.spf], ['DKIM', domain.dkim], ['DMARC', domain.dmarc]] as const).map(([label, exists]) => <li key={label}>
                <span>{label}</span><Badge tone={exists == null ? 'neutral' : exists ? 'green' : 'amber'}>{exists == null ? 'Unavailable' : exists ? 'Record found' : 'Missing'}</Badge>
              </li>)}
            </ul>
          </> : <p className="caption">Look up SPF, DKIM and DMARC records for the configured sender domain.</p>}
        </div>
      </Panel>
      <Panel title="Website tracking">
        <div className="panel-body stack-small"><dl className="definition-list"><dt>Tracking origin</dt><dd>{data.trackingOrigin || '—'}</dd></dl>
          <Link className="text-link inline-group" href="/analytics">Manage websites <ExternalLink size={14} /></Link>
        </div>
      </Panel>
    </div>
    {data.failedJobs?.length ? <Panel title="Failed background jobs" description="Retry after checking the affected service connection.">
      <div className="panel-body"><Feedback error={retry.error} notice={retry.notice} /><ul className="line-list">
        {data.failedJobs.map(job => <li key={job.id}>
          <span><strong>{job.kind.replaceAll('_', ' ').replaceAll('-', ' ')}</strong><small>{job.attempts} attempts · {date(job.at)}</small></span>
          <Button disabled={retry.busy} onClick={() => void retry.run(async () => {
            await api(`${path}/jobs/${job.id}/retry`, 'POST');
            refresh();
          }, 'Job queued for retry.')}>Retry</Button>
        </li>)}
      </ul></div>
    </Panel> : null}
  </div>;
}

function DataPrivacy({ company }: { company: CompanySettings }) {
  return <div className="columns">
    <Panel title="Contact data" description="Import, export and manage contact records in Audience.">
      <div className="panel-body stack-small">
        <p>Open a contact to review marketing consent, export its data or erase its record. Suppression applies to newsletter and automation delivery.</p>
        <div className="actions"><Link className="button button--secondary" href="/audience">Open Audience</Link>
          <a className="button button--secondary" href="/api/console/contacts/export" download="ovelio-contacts.csv"><Download size={15} /> Export contacts</a>
        </div>
      </div>
    </Panel>
    <Panel title="Privacy policy">
      <div className="panel-body">
        {company.privacyUrl ? <a className="text-link" href={company.privacyUrl} rel="noreferrer">{company.privacyUrl}</a>
          : <p className="caption">Add your privacy policy URL in the Company tab.</p>}
      </div>
    </Panel>
    <Panel title="Backups and restore" description="Run these commands from your installation directory.">
      <div className="panel-body stack-small">
        <pre className="snippet">sh deploy/backup.sh /path/to/new-backup-directory</pre>
        <pre className="snippet">sh deploy/restore.sh /path/to/backup-directory</pre>
        <p className="caption">Store backups securely. Restore into a fresh installation with the matching deployment credentials.</p>
      </div>
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
    <nav className="tabs" aria-label="Settings view">{tabs.map(value => <button key={value} aria-pressed={tab === value} onClick={() => setView(value)}>{value}</button>)}</nav>
    {!resource.data ? <Panel><AsyncState loading={resource.loading} error={resource.error} retry={resource.refresh} /></Panel>
      : tab === 'Company' ? <CompanyForm company={resource.data.company} onSaved={() => { resource.refresh(); router.refresh(); }} />
        : tab === 'Team' ? <Team members={resource.data.team} onSaved={resource.refresh} />
          : tab === 'Connections' ? <Connections data={resource.data} refresh={resource.refresh} loading={resource.loading} />
            : <DataPrivacy company={resource.data.company} />}
  </>;
}
