'use client';

// Drawers and dialogs of the page builder: publish and page settings (SEO, address, tracking, A/B test),
// version history, and the shared media library picker.
import { ExternalLink, ImageUp } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Link } from '@astryxdesign/core/Link';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Selector } from '@astryxdesign/core/Selector';
import { Spinner } from '@astryxdesign/core/Spinner';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import type { MediaItem } from '@/contracts';
import type { DesignVersion, LandingPageDetail, PageDesign, SiteDomain } from '@/contracts/sites';
import { api, date, message, request, upload } from '../client';
import { ConfirmDialog, Empty, Modal, SlideDrawer, StatusBadge } from '../ui';
import { absoluteUrl, pageStatusTone } from './shared';

export function MediaPicker({ onPick, onClose }: { onPick: (url: string) => void; onClose: () => void }) {
  const [items, setItems] = useState<MediaItem[]>();
  const [error, setError] = useState<string>();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => request<MediaItem[]>('/api/console/media').then(list => setItems(list.filter(item => item.contentType.startsWith('image/'))), cause => setError(message(cause))), []);
  useEffect(() => { void load(); }, [load]);
  const valid = /^https:\/\/[^\s"'<>]+$/.test(url.trim());
  return <Modal title="Choose an image" onClose={onClose} size="large">
    <div className="ov-stack-sm">
      <label className="ov-sites-upload">
        <ImageUp size={18} aria-hidden="true" />
        <span>{busy ? 'Uploading…' : 'Upload an image (PNG, JPEG, GIF, WebP or SVG, up to 8 MB)'}</span>
        <input type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" disabled={busy} onChange={async event => {
          const file = event.target.files?.[0];
          if (!file) return;
          setBusy(true);
          setError(undefined);
          try {
            const item = await upload<MediaItem>('/media', file);
            onPick(item.url);
          } catch (cause) {
            setError(message(cause));
          } finally {
            setBusy(false);
          }
        }} />
      </label>
      {error ? <Banner status="error" title={error} /> : null}
      <Text weight="medium">Media library</Text>
      {!items ? <div className="ov-actions"><Spinner size="sm" /><Text color="secondary">Loading the media library…</Text></div>
        : items.length ? <div className="ov-sites-media-grid">
          {items.map(item => <button key={item.id} type="button" className="ov-sites-media-item" onClick={() => onPick(item.url)} title={item.filename}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.thumbUrl || item.url} alt={item.filename} loading="lazy" />
            <span>{item.filename}</span>
          </button>)}
        </div> : <Empty title="No images yet" description="Upload one above, or use an image address below." />}
      <form className="ov-sites-inline" onSubmit={event => { event.preventDefault(); if (valid) onPick(url.trim()); }}>
        <TextInput label="Or use an image address" placeholder="https://…" value={url} onChange={setUrl} description="HTTPS images only." />
        <Button type="submit" label="Use image" isDisabled={!valid} />
      </form>
    </div>
  </Modal>;
}

export function VersionsDrawer({ pageId, query, onClose, onRestored, beforeSave }: {
  pageId: string; query: string; onClose: () => void; onRestored: (design: PageDesign) => void; beforeSave: (label?: string) => Promise<boolean>;
}) {
  const [items, setItems] = useState<DesignVersion[]>();
  const [error, setError] = useState<string>();
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [restore, setRestore] = useState<DesignVersion | null>(null);
  const load = useCallback(() => api<{ items: DesignVersion[] }>(`/sites/pages/${pageId}/versions${query}`).then(result => setItems(result.items), cause => setError(message(cause))), [pageId, query]);
  useEffect(() => { void load(); }, [load]);
  return <SlideDrawer title="Version history" subtitle="Autosaves every 10 minutes, on publish and when you name a version." onClose={onClose} width={440}>
    <div className="ov-stack-sm">
      <form className="ov-sites-inline" onSubmit={async event => {
        event.preventDefault();
        setBusy(true);
        setError(undefined);
        try {
          if (await beforeSave()) {
            setItems((await api<{ items: DesignVersion[] }>(`/sites/pages/${pageId}/versions${query}`, 'POST', { label: label.trim() || 'Saved version' })).items);
            setLabel('');
          }
        } catch (cause) {
          setError(message(cause));
        } finally {
          setBusy(false);
        }
      }}>
        <TextInput label="Name this version" placeholder="e.g. Before headline test" value={label} onChange={setLabel} />
        <Button type="submit" label="Save version" isLoading={busy} />
      </form>
      {error ? <Banner status="error" title={error} /> : null}
      {!items ? <div className="ov-actions"><Spinner size="sm" /><Text color="secondary">Loading versions…</Text></div>
        : <ul className="ov-sites-versions">{items.map(item => <li key={item.version}>
          <div><Text weight="medium">{item.label || 'Saved'}</Text><Text type="supporting" color="secondary">Version {item.version} · {date(item.createdAt)}{item.createdBy ? ` · ${item.createdBy}` : ''}</Text></div>
          <Button size="sm" variant="ghost" label="Restore" onClick={() => setRestore(item)} />
        </li>)}</ul>}
    </div>
    {restore ? <ConfirmDialog title={`Restore version ${restore.version}?`} description="The page returns to this version. Your current design is kept in the history first, so you can undo this." actionLabel="Restore" destructive={false}
      busy={busy} onClose={() => setRestore(null)} onConfirm={async () => {
        setBusy(true);
        try {
          onRestored(await api<PageDesign>(`/sites/pages/${pageId}/versions/${restore.version}/restore${query}`, 'POST', {}));
        } catch (cause) {
          setError(message(cause));
          setRestore(null);
        } finally {
          setBusy(false);
        }
      }} /> : null}
  </SlideDrawer>;
}

type Draft = Pick<LandingPageDetail, 'name' | 'slug' | 'domainId' | 'seoTitle' | 'seoDescription' | 'ogImageUrl' | 'canonicalUrl' | 'faviconUrl' | 'noindex' | 'abEnabled' | 'controlWeight'> & { utmSource: string; utmMedium: string; utmCampaign: string };

const toDraft = (page: LandingPageDetail): Draft => ({
  name: page.name, slug: page.slug, domainId: page.domainId, seoTitle: page.seoTitle, seoDescription: page.seoDescription, ogImageUrl: page.ogImageUrl,
  canonicalUrl: page.canonicalUrl, faviconUrl: page.faviconUrl, noindex: page.noindex, abEnabled: page.abEnabled, controlWeight: page.controlWeight,
  utmSource: page.utmDefaults.source ?? '', utmMedium: page.utmDefaults.medium ?? '', utmCampaign: page.utmDefaults.campaign ?? '',
});

export function PublishDrawer({ page, onClose, onChange, beforePublish }: {
  page: LandingPageDetail; onClose: () => void; onChange: (page: LandingPageDetail) => void; beforePublish: () => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(page));
  const [domains, setDomains] = useState<SiteDomain[]>([]);
  const [state, setState] = useState<{ busy?: string; error?: string; notice?: string }>({});
  useEffect(() => { api<{ items: SiteDomain[] }>('/sites/domains').then(result => setDomains(result.items), () => setDomains([])); }, []);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(current => ({ ...current, [key]: value }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(page));

  const saveSettings = async () => {
    const next = await api<LandingPageDetail>(`/sites/pages/${page.id}`, 'PATCH', {
      name: draft.name, slug: draft.slug, domainId: draft.domainId, seoTitle: draft.seoTitle, seoDescription: draft.seoDescription,
      ogImageUrl: draft.ogImageUrl.trim(), canonicalUrl: draft.canonicalUrl.trim(), faviconUrl: draft.faviconUrl.trim(), noindex: draft.noindex,
      abEnabled: draft.abEnabled, controlWeight: draft.controlWeight,
      utmDefaults: Object.fromEntries(Object.entries({ source: draft.utmSource, medium: draft.utmMedium, campaign: draft.utmCampaign }).filter(([, value]) => value.trim()).map(([key, value]) => [key, value.trim()])),
    });
    onChange(next);
    setDraft(toDraft(next));
    return next;
  };

  const run = async (label: string, task: () => Promise<string>) => {
    setState({ busy: label });
    try {
      setState({ notice: await task() });
    } catch (cause) {
      setState({ error: message(cause) });
    }
  };

  const domain = domains.find(item => item.id === draft.domainId);
  const liveUrl = absoluteUrl(page.url);
  return <SlideDrawer title="Publish and settings" subtitle={page.name} onClose={onClose} width={520}>
    <div className="ov-stack">
      <section className="ov-sites-publish-card">
        <div className="ov-actions ov-actions--between">
          <StatusBadge label={page.status === 'published' ? (page.hasDraftChanges ? 'Published · unpublished edits' : 'Published') : page.status === 'archived' ? 'Archived' : 'Draft'} tone={pageStatusTone(page)} />
          {page.publishedAt ? <Text type="supporting" color="secondary">Last published {date(page.publishedAt)}</Text> : null}
        </div>
        {page.status === 'published' ? <Link href={liveUrl} target="_blank"><span className="ov-actions">{liveUrl}<ExternalLink size={14} aria-hidden="true" /></span></Link>
          : <Text type="supporting" color="secondary">Publishing makes the page live at {liveUrl}</Text>}
        {domain && domain.status !== 'verified' ? <Banner status="warning" title={`${domain.hostname} is not verified yet`} description="The page goes live on the domain once its DNS records verify in Sites › Domains." /> : null}
        {state.error ? <Banner status="error" title={state.error} /> : null}
        {state.notice ? <Banner status="success" title={state.notice} /> : null}
        <div className="ov-actions">
          <Button variant="primary" label={page.status === 'published' ? 'Publish changes' : 'Publish now'} isLoading={state.busy === 'publish'} onClick={() => void run('publish', async () => {
            if (dirty) await saveSettings();
            if (!await beforePublish()) throw new Error('Save the page before publishing: the latest changes could not be saved.');
            const next = await api<LandingPageDetail>(`/sites/pages/${page.id}/publish`, 'POST', {});
            onChange(next);
            return `Published. Live at ${absoluteUrl(next.url)}`;
          })} />
          {page.status === 'published' ? <Button variant="ghost" label="Unpublish" isLoading={state.busy === 'unpublish'} onClick={() => void run('unpublish', async () => {
            onChange(await api<LandingPageDetail>(`/sites/pages/${page.id}/unpublish`, 'POST', {}));
            return 'Unpublished. Visitors now see “page not found”.';
          })} /> : null}
        </div>
      </section>

      <section className="ov-stack-sm">
        <Text weight="bold">Address</Text>
        <TextInput label="Page name" value={draft.name} onChange={value => set('name', value)} />
        <Selector label="Domain" value={draft.domainId ?? 'default'} onChange={value => set('domainId', !value || value === 'default' ? null : value)}
          options={[{ value: 'default', label: 'Workspace address (/s/…)' }, ...domains.map(item => ({ value: item.id, label: item.hostname, description: item.status === 'verified' ? 'Verified' : 'Not verified yet' }))]} />
        <TextInput label="Page address" description={draft.domainId ? `https://${domain?.hostname ?? 'your-domain'}/${draft.slug}` : `${typeof window === 'undefined' ? '' : window.location.origin}/s/${draft.slug}`}
          value={draft.slug} onChange={value => set('slug', value.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 80))} />
      </section>

      <section className="ov-stack-sm">
        <Text weight="bold">Search and social</Text>
        <TextInput label="Title" description={`${draft.seoTitle.length}/60 characters recommended`} value={draft.seoTitle} onChange={value => set('seoTitle', value)} />
        <TextArea label="Description" description={`${draft.seoDescription.length}/155 characters recommended`} rows={3} value={draft.seoDescription} onChange={value => set('seoDescription', value)} />
        <TextInput label="Social image address (Open Graph)" placeholder="https://…/share.png" value={draft.ogImageUrl} onChange={value => set('ogImageUrl', value)} isOptional />
        <TextInput label="Canonical address" placeholder="Leave empty to use this page’s own address" value={draft.canonicalUrl} onChange={value => set('canonicalUrl', value)} isOptional />
        <TextInput label="Favicon address" placeholder="https://…/favicon.png" value={draft.faviconUrl} onChange={value => set('faviconUrl', value)} isOptional />
        <Switch label="Hide from search engines (noindex)" value={draft.noindex} onChange={value => set('noindex', value)} />
      </section>

      <section className="ov-stack-sm">
        <Text weight="bold">Tracking</Text>
        <Text type="supporting" color="secondary">Used for visits that arrive without utm_ parameters, so they are still attributed to a campaign.</Text>
        <div className="ov-form-grid--three ov-form-grid">
          <TextInput label="Source" value={draft.utmSource} onChange={value => set('utmSource', value)} isOptional />
          <TextInput label="Medium" value={draft.utmMedium} onChange={value => set('utmMedium', value)} isOptional />
          <TextInput label="Campaign" value={draft.utmCampaign} onChange={value => set('utmCampaign', value)} isOptional />
        </div>
      </section>

      <section className="ov-stack-sm">
        <Text weight="bold">A/B test</Text>
        <Switch label="Split traffic between variants" description="Each visitor keeps seeing the same variant. Conversions are reported per variant." value={draft.abEnabled} onChange={value => set('abEnabled', value)} />
        <NumberInput label="Variant A (control) weight" value={draft.controlWeight} min={0} max={100} onChange={value => set('controlWeight', Number(value ?? 0))} />
        {page.variants.map(variant => <VariantRow key={variant.id} pageId={page.id} variant={variant} onChange={async () => onChange(await api<LandingPageDetail>(`/sites/pages/${page.id}`))} />)}
        <div className="ov-actions">
          <Button variant="secondary" label="Add a variant (copy of A)" isLoading={state.busy === 'variant'} onClick={() => void run('variant', async () => {
            await api(`/sites/pages/${page.id}/variants`, 'POST', {});
            onChange(await api<LandingPageDetail>(`/sites/pages/${page.id}`));
            return 'Variant added. Open it from the variant menu in the top bar to edit it, then publish.';
          })} />
        </div>
      </section>

      <div className="ov-actions ov-actions--end ov-sites-sticky-actions">
        <Button variant="ghost" label="Close" onClick={onClose} />
        <Button variant="primary" label="Save settings" isDisabled={!dirty} isLoading={state.busy === 'settings'} onClick={() => void run('settings', async () => {
          await saveSettings();
          return page.status === 'published' ? 'Settings saved. They are live now.' : 'Settings saved.';
        })} />
      </div>
    </div>
  </SlideDrawer>;
}

function VariantRow({ pageId, variant, onChange }: { pageId: string; variant: LandingPageDetail['variants'][number]; onChange: () => Promise<void> }) {
  const [weight, setWeight] = useState(variant.weight);
  const [error, setError] = useState<string>();
  return <div className="ov-sites-variant">
    <div><Text weight="medium">{variant.name}</Text><Text type="supporting" color="secondary">{variant.publishedAt ? `Published version ${variant.publishedVersion}` : 'Not published yet'}</Text></div>
    <NumberInput label="Weight" value={weight} min={0} max={100} width={90} onChange={value => setWeight(Number(value ?? 0))} />
    <Button size="sm" variant="ghost" label="Save" isDisabled={weight === variant.weight} onClick={async () => {
      try { await api(`/sites/pages/${pageId}/variants/${variant.key}`, 'PATCH', { weight }); await onChange(); } catch (cause) { setError(message(cause)); }
    }} />
    <Button size="sm" variant="ghost" label="Edit" href={`/studio/page/${pageId}?variant=${variant.key}`} />
    <Button size="sm" variant="ghost" label="Remove" onClick={async () => {
      try { await api(`/sites/pages/${pageId}/variants/${variant.key}`, 'DELETE'); await onChange(); } catch (cause) { setError(message(cause)); }
    }} />
    {error ? <Banner status="error" title={error} /> : null}
  </div>;
}
