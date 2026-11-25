'use client';

// /sites/domains: connect a custom domain or subdomain, see the exact DNS records to create, and verify them.
import '@/styles/sites.css';
import { Globe, Plus, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import type { LandingPageSummary, SiteDomain } from '@/contracts/sites';
import { api, date, message, useResource } from '../client';
import { useUser } from '../shell';
import { AsyncState, ConfirmDialog, Empty, Modal, PageHeader, Panel, StatusBadge } from '../ui';

export function Domains() {
  const user = useUser();
  const domains = useResource<{ items: SiteDomain[] }>('/sites/domains');
  const pages = useResource<{ items: LandingPageSummary[] }>('/sites/pages');
  const [adding, setAdding] = useState(false);
  const [remove, setRemove] = useState<SiteDomain | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [state, setState] = useState<{ error?: string; notice?: string }>({});
  const admin = user.role === 'admin';

  const act = async (key: string, task: () => Promise<string>) => {
    setBusy(key);
    setState({});
    try {
      setState({ notice: await task() });
      domains.refresh();
    } catch (cause) {
      setState({ error: message(cause) });
    } finally {
      setBusy(null);
    }
  };

  return <div className="ov-stack">
    <PageHeader title="Domains" description="Publish landing pages on your own domain or subdomain, such as go.yourcompany.com."
      actions={admin ? <Button label="Connect a domain" variant="primary" icon={<Plus size={16} />} onClick={() => setAdding(true)} /> : undefined} />
    {!admin ? <Banner status="info" title="Only admins can connect or remove domains." description="You can verify DNS and see the records here." /> : null}
    {state.error ? <Banner status="error" title={state.error} /> : null}
    {state.notice ? <Banner status="success" title={state.notice} /> : null}
    <Panel title="Workspace address" description="Every page is also available here without any DNS set-up.">
      <Text><code>{typeof window === 'undefined' ? '' : window.location.origin}/s/&lt;page-address&gt;</code></Text>
    </Panel>
    {!domains.data ? <AsyncState loading={domains.loading} error={domains.error} retry={domains.refresh} />
      : !domains.data.items.length ? <Panel><Empty title="No domains connected" description="Connect a subdomain (recommended) or a root domain, add two DNS records, then verify."
        action={admin ? <Button label="Connect a domain" variant="primary" onClick={() => setAdding(true)} /> : undefined} /></Panel>
        : domains.data.items.map(domain => <Panel key={domain.id} title={domain.hostname}
          description={`${domain.kind === 'subdomain' ? 'Subdomain' : 'Root domain'} · ${domain.pageCount} page${domain.pageCount === 1 ? '' : 's'}${domain.checkedAt ? ` · checked ${date(domain.checkedAt)}` : ''}`}
          action={<StatusBadge label={domain.status === 'verified' ? 'Verified' : domain.status === 'failed' ? 'Not verified' : 'Waiting for DNS'} tone={domain.status === 'verified' ? 'success' : domain.status === 'failed' ? 'error' : 'warning'} />}>
          <div className="ov-stack-sm">
            <Banner status={domain.status === 'verified' ? 'success' : domain.status === 'failed' ? 'warning' : 'info'} title={domain.statusDetail || 'Add the records below at your DNS provider.'} description={domain.routingDetail || undefined} />
            <table className="ov-sites-dns">
              <thead><tr><th scope="col">Type</th><th scope="col">Name</th><th scope="col">Value</th><th scope="col">Why</th></tr></thead>
              <tbody>{domain.records.map(record => <tr key={record.type}><td>{record.type}</td><td><code>{record.name}</code></td><td><code>{record.value}</code></td><td>{record.purpose}</td></tr>)}</tbody>
            </table>
            <Text type="supporting" color="secondary">DNS changes can take from a few minutes up to 48 hours. Once verified, HTTPS certificates are issued automatically by the OVELIO server.</Text>
            <div className="ov-actions">
              <Button label="Verify DNS now" variant="primary" icon={<RefreshCw size={15} />} isLoading={busy === domain.id} onClick={() => void act(domain.id, async () => {
                const result = await api<SiteDomain>(`/sites/domains/${domain.id}/verify`, 'POST', {});
                return result.status === 'verified' ? `${domain.hostname} is verified.` : `${domain.hostname}: ${result.statusDetail}`;
              })} />
              {admin ? <Selector label="Home page" isLabelHidden width={260} placeholder="Home page for /" value={domain.homePageId ?? ''}
                options={[{ value: '', label: 'No home page' }, ...(pages.data?.items ?? []).filter(page => page.domainId === domain.id).map(page => ({ value: page.id, label: page.name }))]}
                onChange={value => void act('home', async () => { await api(`/sites/domains/${domain.id}`, 'PATCH', { homePageId: value || null }); return 'Home page updated.'; })} /> : null}
              {admin ? <Button label="Remove" variant="ghost" onClick={() => setRemove(domain)} /> : null}
            </div>
          </div>
        </Panel>)}
    {adding ? <AddDomain onClose={() => setAdding(false)} onAdded={() => { setAdding(false); domains.refresh(); setState({ notice: 'Domain added. Create the DNS records shown, then verify.' }); }} /> : null}
    {remove ? <ConfirmDialog title={`Remove ${remove.hostname}?`} description="Pages on this domain move back to the workspace address and stop being served on the domain." actionLabel="Remove domain"
      onClose={() => setRemove(null)} onConfirm={() => { const target = remove; setRemove(null); void act('remove', async () => { await api(`/sites/domains/${target.id}`, 'DELETE'); return `${target.hostname} removed.`; }); }} /> : null}
  </div>;
}

function AddDomain({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [hostname, setHostname] = useState('');
  const [kind, setKind] = useState('auto');
  const [state, setState] = useState<{ busy?: boolean; error?: string }>({});
  return <Modal title="Connect a domain" onClose={onClose}>
    <form className="ov-stack-sm" onSubmit={async event => {
      event.preventDefault();
      setState({ busy: true });
      try {
        await api('/sites/domains', 'POST', { hostname: hostname.trim(), ...(kind === 'auto' ? {} : { kind }) });
        onAdded();
      } catch (cause) {
        setState({ error: message(cause) });
      }
    }}>
      <TextInput label="Domain" placeholder="go.example.com" description="Without https:// or a path." value={hostname} onChange={setHostname} isRequired hasAutoFocus startIcon={<Globe size={16} />} />
      <Selector label="Type" value={kind} onChange={value => setKind(value ?? 'auto')} options={[
        { value: 'auto', label: 'Work it out from the domain' },
        { value: 'subdomain', label: 'Subdomain (CNAME record)', description: 'Recommended, e.g. go.example.com' },
        { value: 'custom', label: 'Root domain (A record)', description: 'e.g. example.com' },
      ]} />
      {state.error ? <Banner status="error" title={state.error} /> : null}
      <div className="ov-actions ov-actions--end">
        <Button label="Cancel" variant="ghost" onClick={onClose} />
        <Button label="Connect" type="submit" variant="primary" isLoading={state.busy} isDisabled={!hostname.trim()} />
      </div>
    </form>
  </Modal>;
}
