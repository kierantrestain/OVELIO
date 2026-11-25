'use client';

// Marketing › Templates: the template gallery, My designs and Saved blocks. "Use template" creates a design and opens
// the studio. Global Create → Email lands here with ?create=email.
import { Archive, Copy, Eye, FilePlus2, PenLine, Search, Send } from 'lucide-react';
import NextLink from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { TextInput } from '@astryxdesign/core/TextInput';
import type { DesignSummary, EmailTemplateSummary } from '@/contracts/studio';
import { templateCategories } from '@/contracts/studio';
import { api, date, request, useAction, useResource } from '../client';
import { AsyncState, ConfirmDialog, Empty, Feedback, FormActions, Modal, PageHeader, StatusBadge, Tabs } from '../ui';
import { DeviceToggle, EmailFrame } from './common';
import '@/styles/studio.css';

const tabs = ['Templates', 'My designs', 'Saved blocks'] as const;
type Tab = typeof tabs[number];

/** A live thumbnail: the compiled email in a scaled, sandboxed frame, fetched only when the card scrolls into view. */
export function Thumb({ path, label, onOpen }: { path: string; label: string; onOpen?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [html, setHtml] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '200px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let active = true;
    request<{ html: string }>('/api/console' + path).then(data => { if (active) setHtml(data.html); }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [visible, path]);
  const body = html ? <iframe title={`Thumbnail of ${label}`} sandbox="" srcDoc={html} loading="lazy" tabIndex={-1} aria-hidden="true" />
    : <span className="ov-studio-thumb-empty">{failed ? 'Preview unavailable' : 'Loading preview…'}</span>;
  return <div ref={ref} className="ov-studio-thumb-wrap">
    {onOpen ? <button type="button" className="ov-studio-thumb" onClick={onOpen} aria-label={`Preview ${label}`}>{body}</button> : <div className="ov-studio-thumb">{body}</div>}
  </div>;
}

function TemplatePreview({ template, onUse, busy, onClose }: { template: EmailTemplateSummary; onUse: () => void; busy: boolean; onClose: () => void }) {
  const html = useResource<{ html: string }>(`/studio/templates/${template.key}/html`);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  return <Modal title={template.name} onClose={onClose} size="wide">
    <div className="ov-actions ov-actions--between">
      <span className="ov-actions"><StatusBadge label={template.category} tone="info" /><span className="ov-studio-card-meta">{template.description}</span></span>
      <DeviceToggle value={device} onChange={setDevice} />
    </div>
    {html.data ? <EmailFrame html={html.data.html} title={`${template.name} preview`} device={device} height={560} /> : <AsyncState loading={html.loading} error={html.error} retry={html.refresh} />}
    <FormActions>
      <Button label="Close" onClick={onClose} />
      <Button variant="primary" icon={<PenLine size={15} />} label="Use this template" isLoading={busy} onClick={onUse} />
    </FormActions>
  </Modal>;
}

export function TemplateGallery() {
  const router = useRouter();
  const params = useSearchParams();
  const initialTab: Tab = params.get('tab') === 'designs' ? 'My designs' : params.get('tab') === 'blocks' ? 'Saved blocks' : 'Templates';
  const [tab, setTab] = useState<Tab>(initialTab);
  const [category, setCategory] = useState<string>('All');
  const [query, setQuery] = useState('');
  const [previewKey, setPreviewKey] = useState<string | null>(params.get('template'));
  const creating = params.get('create') === 'email';
  const templates = useResource<{ items: EmailTemplateSummary[] }>('/studio/templates');
  const designs = useResource<{ items: DesignSummary[] }>(tab === 'My designs' ? `/studio/designs?kind=email&q=${encodeURIComponent(query)}` : null);
  const blocks = useResource<{ items: DesignSummary[] }>(tab === 'Saved blocks' ? '/studio/designs?kind=email_block' : null);
  const action = useAction();
  const [archiving, setArchiving] = useState<DesignSummary>();

  const q = query.trim().toLowerCase();
  const shown = (templates.data?.items ?? []).filter(item => (category === 'All' || item.category === category)
    && (!q || `${item.name} ${item.category} ${item.description}`.toLowerCase().includes(q)));
  const previewing = templates.data?.items.find(item => item.key === previewKey);

  function startFrom(key: string | null) {
    void action.run(async () => {
      const created = await api<{ id: string }>('/studio/designs', 'POST', key ? { templateKey: key } : { kind: 'email', name: 'Untitled email' });
      router.push(`/studio/email/${created.id}`);
    });
  }

  return <div className="ov-stack">
    <PageHeader title="Templates" description="Start from a professionally designed template, or reopen your own designs."
      actions={<Button variant="primary" icon={<FilePlus2 size={16} />} label="Blank email" isLoading={action.busy && !previewKey} onClick={() => startFrom(null)} />} />
    {creating ? <Banner status="info" title="Create an email" description="Pick a template to start from. Everything is editable in the studio, and your brand kit is applied automatically." /> : null}
    <Feedback error={action.error} />
    <Tabs label="Template library view" items={tabs} value={tab} onChange={setTab} />

    <div className="ov-studio-toolbar">
      {tab === 'Templates' ? <div className="ov-studio-filters" role="group" aria-label="Category">
        {['All', ...templateCategories].map(item => <button key={item} type="button" className="ov-studio-chip" aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}
      </div> : <span />}
      {tab !== 'Saved blocks' ? <TextInput label="Search" isLabelHidden type="search" placeholder={tab === 'Templates' ? 'Search templates…' : 'Search my designs…'} value={query} onChange={setQuery} startIcon={<Search size={14} />} width={260} /> : null}
    </div>

    {tab === 'Templates' ? (!templates.data ? <AsyncState loading={templates.loading} error={templates.error} retry={templates.refresh} />
      : shown.length ? <div className="ov-studio-gallery">
        {shown.map(item => <article key={item.key} className="ov-studio-card">
          <Thumb path={`/studio/templates/${item.key}/html`} label={item.name} onOpen={() => setPreviewKey(item.key)} />
          <div className="ov-studio-card-body">
            <span className="ov-studio-card-title">{item.name}</span>
            <span className="ov-studio-card-meta">{item.category} · {item.description}</span>
            <div className="ov-studio-card-actions">
              <Button size="sm" variant="primary" label="Use template" onClick={() => startFrom(item.key)} isDisabled={action.busy} />
              <Button size="sm" variant="ghost" icon={<Eye size={14} />} label="Preview" onClick={() => setPreviewKey(item.key)} />
            </div>
          </div>
        </article>)}
      </div> : <Empty title="No templates match" description="Try another category or search term." />) : null}

    {tab === 'My designs' ? (!designs.data ? <AsyncState loading={designs.loading} error={designs.error} retry={designs.refresh} />
      : designs.data.items.length ? <div className="ov-studio-gallery">
        {designs.data.items.map(item => <article key={item.id} className="ov-studio-card">
          <Thumb path={`/studio/designs/${item.id}/html`} label={item.name} onOpen={() => router.push(`/studio/email/${item.id}`)} />
          <div className="ov-studio-card-body">
            <span className="ov-studio-card-title">{item.name}</span>
            <span className="ov-studio-card-meta">{item.subject || 'No subject yet'}</span>
            <span className="ov-studio-card-meta">Edited {date(item.updatedAt)}{item.updatedBy ? ` by ${item.updatedBy}` : ''}</span>
            <div className="ov-studio-card-actions">
              <NextLink href={`/studio/email/${item.id}`} className="ov-studio-chip" aria-pressed="false">Edit</NextLink>
              <NextLink href={`/marketing/emails?create=1&design=${item.id}`} className="ov-studio-chip" aria-pressed="false"><Send size={12} /> Send</NextLink>
              <Button size="sm" variant="ghost" icon={<Copy size={14} />} label="Duplicate" isDisabled={action.busy} onClick={() => void action.run(async () => {
                await api(`/studio/designs/${item.id}/duplicate`, 'POST');
                designs.refresh();
              }, 'Design duplicated.')} />
              <Button size="sm" variant="ghost" icon={<Archive size={14} />} label="Archive" onClick={() => setArchiving(item)} />
            </div>
          </div>
        </article>)}
      </div> : <Empty title={q ? 'No designs match' : 'No designs yet'} description="Use a template to create your first email." action={<Button label="Browse templates" onClick={() => setTab('Templates')} />} />) : null}

    {tab === 'Saved blocks' ? (!blocks.data ? <AsyncState loading={blocks.loading} error={blocks.error} retry={blocks.refresh} />
      : blocks.data.items.length ? <div className="ov-studio-gallery">
        {blocks.data.items.map(item => <article key={item.id} className="ov-studio-card">
          <Thumb path={`/studio/designs/${item.id}/html`} label={item.name} />
          <div className="ov-studio-card-body">
            <span className="ov-studio-card-title">{item.name}</span>
            <span className="ov-studio-card-meta">Saved {date(item.updatedAt)} · appears under Saved blocks in the studio</span>
            <div className="ov-studio-card-actions"><Button size="sm" variant="ghost" icon={<Archive size={14} />} label="Remove" onClick={() => setArchiving(item)} /></div>
          </div>
        </article>)}
      </div> : <Empty title="No saved blocks yet" description="In the studio, select a section and choose Save as block to reuse it in every email." />) : null}

    {previewing ? <TemplatePreview template={previewing} busy={action.busy} onUse={() => startFrom(previewing.key)} onClose={() => setPreviewKey(null)} /> : null}
    {archiving ? <ConfirmDialog title={`Archive “${archiving.name}”?`} description="It leaves this list. Newsletters already created from it keep their content."
      actionLabel="Archive" busy={action.busy} onClose={() => setArchiving(undefined)}
      onConfirm={() => void action.run(async () => {
        await api(`/studio/designs/${archiving.id}/archive`, 'POST');
        setArchiving(undefined);
        designs.refresh();
        blocks.refresh();
      }, 'Archived.')} /> : null}
  </div>;
}
