'use client';

// The full-screen Email Studio: GrapesJS 0.23.9 + grapesjs-mjml (BSD-3-Clause) inside OVELIO's own chrome.
// GrapesJS loads only in the browser (dynamic import in an effect). The server compiles the MJML on every save.
import {
  ArrowLeft, Blocks, Bookmark, Code2, Copy, Eye, History, ImageIcon, Inbox, Layers, MailCheck, Monitor, Redo2, RefreshCw, Save, Send,
  SlidersHorizontal, Smartphone, Undo2,
} from 'lucide-react';
import NextLink from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { Editor } from 'grapesjs';
import 'grapesjs/dist/css/grapes.min.css';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Spinner } from '@astryxdesign/core/Spinner';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import type { Campaign } from '@/contracts';
import { mergeTags } from '@/contracts/merge-tags';
import type { BrandKit, BrandSummary, CompileIssue, Design, DesignSaveResult, DesignVersion, EngineExport } from '@/contracts/studio';
import { api, date, message, useAction, useResource } from '../client';
import { usePreview } from '../shell';
import { AsyncState, ConfirmDialog, Empty, Feedback, FormActions, Modal, SlideDrawer } from '../ui';
import { Selector } from '@astryxdesign/core/Selector';
import { studioBlocks } from './blocks';
import { EmailFrame, MediaPicker, PreviewDialog, SentTestsDrawer, TestSendDialog } from './common';

type SaveState = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict';
type Selected = { type: string; name: string } | null;
type Panel = 'versions' | 'preview' | 'test' | 'sent' | 'advanced' | 'media' | 'block' | null;
type AssetRequest = { select: (asset: unknown, complete?: boolean) => void; close: () => void } | null;

const sectionTypes = ['mj-section', 'mj-wrapper', 'mj-hero', 'mj-group'];

function hasPages(document: Record<string, unknown>) {
  return Array.isArray(document.pages) && document.pages.length > 0;
}

function relative(at: number, now: number) {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  return date(new Date(at).toISOString());
}

const mergeSelect = `<select class="ov-studio-rte-select" aria-label="Insert personalisation" title="Insert personalisation"><option value="">{{ }} Personalise</option>${mergeTags.map(tag => `<option value="${tag.tag}${tag.group === 'Contact' && tag.tag === 'contact.first_name' ? ' | there' : ''}">${tag.label}</option>`).join('')}</select>`;

export function EmailStudio({ id }: { id: string }) {
  const preview = usePreview();
  const canvasRef = useRef<HTMLDivElement>(null);
  const blocksRef = useRef<HTMLDivElement>(null);
  const layersRef = useRef<HTMLDivElement>(null);
  const stylesRef = useRef<HTMLDivElement>(null);
  const traitsRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const versionRef = useRef(0);
  const metaRef = useRef({ name: '', subject: '', preheader: '' });
  const dirtyRef = useRef(false);
  const savingRef = useRef<Promise<void> | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const readyRef = useRef(false);

  const [design, setDesign] = useState<Design>();
  const [loadError, setLoadError] = useState<string>();
  const [meta, setMeta] = useState({ name: '', subject: '', preheader: '' });
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [saveError, setSaveError] = useState<string>();
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [errors, setErrors] = useState<CompileIssue[]>([]);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [history, setHistory] = useState({ undo: false, redo: false });
  const [selected, setSelected] = useState<Selected>(null);
  const [leftTab, setLeftTab] = useState<'blocks' | 'layers'>('blocks');
  const [rightTab, setRightTab] = useState<'style' | 'settings'>('style');
  const [mobilePanel, setMobilePanel] = useState<'left' | 'right' | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [assetRequest, setAssetRequest] = useState<AssetRequest>(null);
  const pushAction = useAction();
  const brandAction = useAction();
  const brands = useResource<{ items: BrandSummary[] }>('/studio/brands');
  const [rebranding, setRebranding] = useState<BrandSummary>();

  async function persist() {
    const editor = editorRef.current;
    if (!editor || !readyRef.current) return;
    dirtyRef.current = false;
    setSaveState('saving');
    try {
      const result = await api<DesignSaveResult>(`/studio/designs/${id}`, 'PATCH', {
        version: versionRef.current, ...metaRef.current, source: editor.getHtml(), document: editor.getProjectData(),
      });
      versionRef.current = result.design.version;
      setErrors(result.errors);
      setSavedAt(Date.now());
      setSaveError(undefined);
      setSaveState(dirtyRef.current ? 'dirty' : 'saved');
    } catch (error) {
      const text = message(error);
      dirtyRef.current = true;
      setSaveError(text);
      setSaveState(/changed somewhere else/.test(text) ? 'conflict' : 'error');
    }
  }

  /** Saves now (waiting for a save already running). Used before preview, tests, exports and leaving. */
  async function flush() {
    window.clearTimeout(timerRef.current);
    if (savingRef.current) await savingRef.current;
    if (!dirtyRef.current) return;
    savingRef.current = persist().finally(() => { savingRef.current = null; });
    await savingRef.current;
    if (dirtyRef.current) throw new Error('The latest changes could not be saved. Check the message at the top, then try again.');
  }

  function markDirty() {
    if (!readyRef.current) return;
    dirtyRef.current = true;
    setSaveState(current => current === 'conflict' ? current : 'dirty');
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      if (savingRef.current) { markDirty(); return; }
      savingRef.current = persist().finally(() => { savingRef.current = null; });
    }, 1200);
  }

  function updateMeta(key: 'name' | 'subject' | 'preheader', value: string) {
    metaRef.current = { ...metaRef.current, [key]: value };
    setMeta(metaRef.current);
    markDirty();
  }

  function load(next: Design) {
    const editor = editorRef.current;
    if (!editor) return;
    readyRef.current = false;
    if (hasPages(next.document)) editor.loadProjectData(next.document as Parameters<Editor['loadProjectData']>[0]);
    else editor.setComponents(next.source);
    editor.UndoManager.clear();
    versionRef.current = next.version;
    metaRef.current = { name: next.name, subject: next.subject, preheader: next.preheader };
    setMeta(metaRef.current);
    window.setTimeout(() => { readyRef.current = true; }, 300);
  }

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 20_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let instance: Editor | undefined;
    const warn = (event: BeforeUnloadEvent) => { if (dirtyRef.current || savingRef.current) event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    (async () => {
      const [{ default: grapesjs }, { default: mjmlPlugin }, loaded, brand, saved] = await Promise.all([
        import('grapesjs'), import('grapesjs-mjml'), api<Design>(`/studio/designs/${id}`), api<BrandKit>('/studio/brand'),
        api<{ items: { id: string; name: string; source: string }[] }>('/studio/blocks').catch(() => ({ items: [] })),
      ]);
      if (cancelled || !canvasRef.current) return;
      if (loaded.kind !== 'email') throw new Error('Saved blocks are edited from the brand kit page.');
      const editor = grapesjs.init({
        container: canvasRef.current,
        height: '100%',
        width: 'auto',
        storageManager: false,
        cssIcons: '',
        fromElement: false,
        panels: { defaults: [] },
        showDevices: false,
        deviceManager: { devices: [{ id: 'desktop', name: 'Desktop', width: '' }, { id: 'mobile', name: 'Mobile portrait', width: '375px', widthMedia: '480px' }] },
        blockManager: { appendTo: blocksRef.current ?? undefined },
        layerManager: { appendTo: layersRef.current ?? undefined },
        styleManager: { appendTo: stylesRef.current ?? undefined },
        traitManager: { appendTo: traitsRef.current ?? undefined },
        assetManager: { custom: true },
        undoManager: { trackSelection: false },
        plugins: [editorInstance => mjmlPlugin(editorInstance, {
          blocks: [], resetBlocks: true, resetDevices: false, resetStyleManager: true, hideSelector: true, useCustomTheme: false, columnsPadding: '0px',
          imagePlaceholderSrc: '',
        })],
      });
      instance = editor;
      editorRef.current = editor;
      editor.Panels.getPanels().reset([]);

      for (const block of studioBlocks(brand)) editor.BlockManager.add(block.id, { label: block.label, category: block.category, media: block.media, content: block.content });
      for (const item of saved.items) editor.BlockManager.add('saved-' + item.id, { label: item.name, category: 'Saved blocks', media: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 3h12v18l-6-4-6 4z"/></svg>', content: item.source });

      editor.RichTextEditor.add('ovMergeTag', {
        icon: mergeSelect,
        event: 'change',
        attributes: { class: 'ov-studio-rte-merge' },
        result: (rte: { insertHTML: (value: string) => void }, action: { btn: HTMLElement }) => {
          const select = action.btn.querySelector('select');
          if (select?.value) rte.insertHTML(`{{${select.value}}}`);
          if (select) select.value = '';
        },
      } as never);

      editor.Keymaps.add('ov:redo-y', '⌘+y, ctrl+y', 'core:redo');
      editor.Keymaps.add('ov:save', '⌘+s, ctrl+s', () => { void flush().catch(() => {}); }, { prevent: true });

      editor.on('asset:custom', props => {
        setAssetRequest(props.open ? { select: props.select as NonNullable<AssetRequest>['select'], close: props.close } : null);
        if (props.open) setPanel('media');
      });
      const syncHistory = () => setHistory({ undo: editor.UndoManager.hasUndo(), redo: editor.UndoManager.hasRedo() });
      editor.on('update', () => { markDirty(); syncHistory(); });
      editor.on('undo redo', syncHistory);
      editor.on('component:toggled', () => {
        const component = editor.getSelected();
        setSelected(component ? { type: String(component.get('type') ?? ''), name: component.getName() } : null);
      });

      setDesign(loaded);
      load(loaded);
      setSavedAt(new Date(loaded.updatedAt).getTime());
      syncHistory();
    })().catch(error => { if (!cancelled) setLoadError(message(error)); });
    return () => {
      cancelled = true;
      window.removeEventListener('beforeunload', warn);
      window.clearTimeout(timerRef.current);
      editorRef.current = null;
      instance?.destroy();
    };
    // The editor is created once per design id; the helpers it calls only read refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    editorRef.current?.setDevice(device === 'mobile' ? 'Mobile portrait' : 'Desktop');
  }, [device]);

  function pickImage(url: string) {
    const editor = editorRef.current;
    if (assetRequest && editor) {
      const asset = editor.Assets.add({ src: url, type: 'image' });
      assetRequest.select(asset, true);
      assetRequest.close();
    } else {
      // Image components keep `src` as a property (rendered into the attribute); set both so the canvas and MJML agree.
      const target = editor?.getSelected();
      target?.set('src', url);
      target?.addAttributes({ src: url });
    }
    setAssetRequest(null);
    setPanel(null);
  }

  async function reloadLatest() {
    const latest = await api<Design>(`/studio/designs/${id}`);
    setDesign(latest);
    load(latest);
    dirtyRef.current = false;
    setSaveError(undefined);
    setSaveState('saved');
  }

  async function pushToNewsletter(campaignId: string) {
    await flush();
    const exported = await api<EngineExport>(`/studio/designs/${id}/export?engine=listmonk`);
    const campaign = await api<Campaign>(`/campaigns/${campaignId}`);
    if (campaign.status !== 'draft') throw new Error(`The newsletter is ${campaign.status}, so its content can no longer change. Duplicate it to send an updated version.`);
    await api(`/campaigns/${campaignId}`, 'PATCH', {
      name: campaign.name, subject: exported.subject || campaign.subject, body: exported.html, listIds: campaign.listIds, contentType: 'html',
      tags: campaign.tags, templateId: campaign.templateId, archive: campaign.archive,
    });
  }

  const statusText = saveState === 'saving' ? 'Saving…'
    : saveState === 'dirty' ? 'Unsaved changes'
      : saveState === 'error' ? 'Not saved'
        : saveState === 'conflict' ? 'Changed elsewhere'
          : savedAt ? `Saved · ${relative(savedAt, now)}` : 'Saved';
  const newsletter = design?.links.find(link => link.engine === 'listmonk_campaign');
  const isImage = selected?.type === 'mj-image';
  const isSection = !!selected && sectionTypes.includes(selected.type);

  if (loadError) return <div className="ov-studio-error"><Banner status="error" title="This email could not be opened" description={loadError} />
    <NextLink href="/marketing/templates?tab=designs">Back to My designs</NextLink></div>;

  return <div className={`ov-studio ${mobilePanel ? 'ov-studio--panel-' + mobilePanel : ''}`}>
    <header className="ov-studio-top">
      <div className="ov-studio-top-row">
        <NextLink href="/marketing/templates?tab=designs" className="ov-studio-back" aria-label="Back to Marketing" onClick={() => { void flush().catch(() => {}); }}>
          <ArrowLeft size={16} aria-hidden="true" /><span>Marketing</span>
        </NextLink>
        <input className="ov-studio-name" aria-label="Email name" value={meta.name} onChange={event => updateMeta('name', event.target.value)} maxLength={120} placeholder="Untitled email" />
        <span className={`ov-studio-status ov-studio-status--${saveState}`} role="status" aria-live="polite">
          {saveState === 'saving' ? <Spinner size="sm" /> : null}{statusText}
        </span>
        {errors.length ? <button type="button" className="ov-studio-issues" onClick={() => setPanel('advanced')}>{errors.length} MJML {errors.length === 1 ? 'warning' : 'warnings'}</button> : null}
        <span className="ov-studio-spacer" />
        <div className="ov-studio-mobile-toggles">
          <IconButton size="sm" variant="ghost" label="Blocks and layers" icon={<Blocks size={17} />} onClick={() => setMobilePanel(current => current === 'left' ? null : 'left')} />
          <IconButton size="sm" variant="ghost" label="Style and settings" icon={<SlidersHorizontal size={17} />} onClick={() => setMobilePanel(current => current === 'right' ? null : 'right')} />
        </div>
        <div className="ov-studio-group" role="group" aria-label="Canvas width">
          <button type="button" aria-pressed={device === 'desktop'} onClick={() => setDevice('desktop')} title="Desktop"><Monitor size={16} /><span>Desktop</span></button>
          <button type="button" aria-pressed={device === 'mobile'} onClick={() => setDevice('mobile')} title="Mobile"><Smartphone size={16} /><span>Mobile</span></button>
        </div>
        <IconButton size="sm" variant="ghost" label="Undo (Ctrl+Z)" tooltip="Undo (Ctrl+Z)" icon={<Undo2 size={17} />} isDisabled={!history.undo} onClick={() => editorRef.current?.UndoManager.undo()} />
        <IconButton size="sm" variant="ghost" label="Redo (Ctrl+Y)" tooltip="Redo (Ctrl+Y)" icon={<Redo2 size={17} />} isDisabled={!history.redo} onClick={() => editorRef.current?.UndoManager.redo()} />
        <Button size="sm" variant="ghost" icon={<History size={15} />} label="Versions" onClick={() => setPanel('versions')} />
        <Button size="sm" variant="ghost" icon={<Code2 size={15} />} label="Advanced" onClick={() => void flush().catch(() => {}).then(() => setPanel('advanced'))} />
        <Button size="sm" variant="ghost" icon={<Inbox size={15} />} label="Sent tests" onClick={() => setPanel('sent')} />
        <Button size="sm" icon={<Eye size={15} />} label="Preview" onClick={() => void flush().then(() => setPanel('preview'), error => setSaveError(message(error)))} />
        <Button size="sm" variant="primary" icon={<MailCheck size={15} />} label="Send test" onClick={() => setPanel('test')} />
      </div>
      <div className="ov-studio-meta">
        <label><span>Subject</span><input value={meta.subject} onChange={event => updateMeta('subject', event.target.value)} maxLength={200} placeholder="What the inbox shows first" /></label>
        <label><span>Preview text</span><input value={meta.preheader} onChange={event => updateMeta('preheader', event.target.value)} maxLength={200} placeholder="The line after the subject in most inboxes" /></label>
        {brands.data?.items.length ? <Selector label="Brand kit" isLabelHidden width={230} size="sm"
          value={design?.brandId ?? brands.data.items.find(item => item.isDefault)?.id ?? ''}
          options={brands.data.items.map(item => ({ value: item.id, label: `Brand: ${item.name}` }))}
          onChange={value => { const next = brands.data?.items.find(item => item.id === value); if (next) setRebranding(next); }} /> : null}
        {newsletter ? <span className="ov-studio-link">
          <Text type="supporting" color="secondary">Feeds newsletter “{newsletter.label || newsletter.engineId}”</Text>
          <Button size="sm" icon={<Send size={14} />} label="Update newsletter" isLoading={pushAction.busy}
            onClick={() => void pushAction.run(() => pushToNewsletter(newsletter.engineId), 'Newsletter content updated from this design.')} />
          <NextLink href={`/marketing/emails/${newsletter.engineId}`}>Open newsletter</NextLink>
        </span> : null}
      </div>
    </header>

    {saveState === 'conflict' || saveState === 'error' || pushAction.error || pushAction.notice ? <div className="ov-studio-banner">
      {saveState === 'conflict' ? <Banner status="warning" title="This email was changed in another tab or by a teammate" description={saveError}
        endContent={<Button size="sm" icon={<RefreshCw size={14} />} label="Load latest" onClick={() => void reloadLatest()} />} />
        : saveState === 'error' ? <Banner status="error" title="Your latest changes are not saved yet" description={saveError}
          endContent={<Button size="sm" label="Try again" onClick={() => void flush().catch(() => {})} />} /> : null}
      <Feedback error={pushAction.error} notice={pushAction.notice} />
    </div> : null}

    <div className="ov-studio-body">
      <aside className="ov-studio-left" aria-label="Blocks and layers">
        <div className="ov-studio-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={leftTab === 'blocks'} onClick={() => setLeftTab('blocks')}><Blocks size={15} />Blocks</button>
          <button type="button" role="tab" aria-selected={leftTab === 'layers'} onClick={() => setLeftTab('layers')}><Layers size={15} />Layers</button>
        </div>
        <p className="ov-studio-hint" hidden={leftTab !== 'blocks'}>Drag a block onto the email. Sections go between sections; content goes inside a column.</p>
        <div ref={blocksRef} className="ov-studio-blocks" hidden={leftTab !== 'blocks'} />
        <div ref={layersRef} className="ov-studio-layers" hidden={leftTab !== 'layers'} />
      </aside>

      <main className={`ov-studio-canvas ov-studio-canvas--${device}`} aria-label="Email canvas">
        {!design ? <div className="ov-studio-loading"><Spinner /><Text color="secondary">Opening the studio…</Text></div> : null}
        <div ref={canvasRef} className="ov-studio-gjs" />
      </main>

      <aside className="ov-studio-right" aria-label="Style and settings">
        {selected ? <div className="ov-studio-selected">
          <Text weight="medium">{selected.name}</Text>
          <div className="ov-actions">
            {isImage ? <Button size="sm" icon={<ImageIcon size={14} />} label="Replace image" onClick={() => { setAssetRequest(null); setPanel('media'); }} /> : null}
            <Button size="sm" variant="ghost" icon={<Copy size={14} />} label="Duplicate" onClick={() => {
              const editor = editorRef.current;
              if (editor?.getSelected()) editor.runCommand('tlb-clone');
            }} />
            {isSection ? <Button size="sm" variant="ghost" icon={<Bookmark size={14} />} label="Save as block" onClick={() => setPanel('block')} /> : null}
          </div>
        </div> : <div className="ov-studio-selected"><Text color="secondary">Select anything in the email to style it. Double-click text to edit; use Personalise in the text toolbar to add merge tags.</Text></div>}
        <div className="ov-studio-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={rightTab === 'style'} onClick={() => setRightTab('style')}>Style</button>
          <button type="button" role="tab" aria-selected={rightTab === 'settings'} onClick={() => setRightTab('settings')}>Settings</button>
        </div>
        <div ref={stylesRef} className="ov-studio-styles" hidden={rightTab !== 'style'} />
        <div ref={traitsRef} className="ov-studio-traits" hidden={rightTab !== 'settings'} />
      </aside>
    </div>

    {rebranding ? <ConfirmDialog title={`Switch to ${rebranding.name}?`} destructive={false} busy={brandAction.busy}
      description="The email's colours, fonts and buttons change to this brand kit. The current design is kept as a version, so you can restore it."
      actionLabel="Re-theme email" onClose={() => setRebranding(undefined)}
      onConfirm={() => void brandAction.run(async () => {
        await flush();
        const themed = await api<Design>(`/studio/designs/${id}/brand`, 'POST', { brandId: rebranding.id, version: versionRef.current });
        setRebranding(undefined);
        setDesign(themed);
        load(themed);
        setSaveState('saved');
        setSavedAt(Date.now());
      }, `Re-themed with ${rebranding.name}.`)} /> : null}
    {brandAction.error ? <div className="ov-studio-banner"><Feedback error={brandAction.error} /></div> : null}
    {panel === 'media' ? <MediaPicker onPick={pickImage} onClose={() => { assetRequest?.close(); setAssetRequest(null); setPanel(null); }} /> : null}
    {panel === 'preview' ? <PreviewDialog designId={id} onClose={() => setPanel(null)} /> : null}
    {panel === 'test' ? <TestSendDialog designId={id} prepare={flush} onClose={() => setPanel(null)} /> : null}
    {panel === 'sent' ? <SentTestsDrawer designId={id} onClose={() => setPanel(null)} /> : null}
    {panel === 'versions' ? <VersionsDrawer designId={id} prepare={flush} currentVersion={() => versionRef.current} onRestored={restored => { setDesign(restored); load(restored); setSaveState('saved'); setSavedAt(Date.now()); setPanel(null); }} onClose={() => setPanel(null)} /> : null}
    {panel === 'advanced' ? <AdvancedView designId={id} errors={errors} preview={preview}
      onApply={source => { editorRef.current?.setComponents(source); markDirty(); setPanel(null); }} onClose={() => setPanel(null)} /> : null}
    {panel === 'block' ? <SaveBlockDialog onClose={() => setPanel(null)} onSave={async name => {
      const editor = editorRef.current;
      const component = editor?.getSelected();
      if (!editor || !component) throw new Error('Select a section first.');
      const created = await api<{ id: string; name: string; source: string }>('/studio/designs', 'POST', { kind: 'email_block', name, source: component.toHTML() });
      editor.BlockManager.add('saved-' + created.id, { label: created.name, category: 'Saved blocks', media: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 3h12v18l-6-4-6 4z"/></svg>', content: created.source });
      setPanel(null);
    }} /> : null}
  </div>;
}

function VersionsDrawer({ designId, prepare, currentVersion, onRestored, onClose }: {
  designId: string; prepare: () => Promise<void>; currentVersion: () => number; onRestored: (design: Design) => void; onClose: () => void;
}) {
  const versions = useResource<{ items: DesignVersion[] }>(`/studio/designs/${designId}/versions`);
  const action = useAction();
  const [label, setLabel] = useState('');
  const [viewing, setViewing] = useState<number>();
  const [restoring, setRestoring] = useState<DesignVersion>();
  const shown = useResource<{ html: string }>(viewing ? `/studio/designs/${designId}/versions/${viewing}` : null);
  return <SlideDrawer title="Versions" subtitle="Saved versions, plus an automatic one every 10 minutes of editing" onClose={onClose} width={640}>
    <form className="ov-actions" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        await prepare();
        await api(`/studio/designs/${designId}/versions`, 'POST', { label: label.trim() });
        setLabel('');
        versions.refresh();
      }, 'Version saved.');
    }}>
      <TextInput label="Version name" isLabelHidden placeholder="Name this version, e.g. Approved by legal" value={label} onChange={setLabel} width={320} />
      <Button type="submit" variant="primary" icon={<Save size={15} />} label="Save version" isLoading={action.busy} />
    </form>
    <Feedback error={action.error} notice={action.notice} />
    {!versions.data ? <AsyncState loading={versions.loading} error={versions.error} retry={versions.refresh} />
      : versions.data.items.length ? <ul className="ov-studio-results">
        {versions.data.items.map(item => <li key={item.version}>
          <span><strong>{item.label || 'Version'} · v{item.version}</strong><Text type="supporting" color="secondary">{date(item.createdAt)}{item.createdBy ? ` · ${item.createdBy}` : ''}{item.automatic ? ' · automatic' : ''}</Text></span>
          <span className="ov-actions">
            <Button size="sm" variant="ghost" label={viewing === item.version ? 'Showing' : 'View'} onClick={() => setViewing(item.version)} />
            <Button size="sm" label="Restore" onClick={() => setRestoring(item)} />
          </span>
        </li>)}
      </ul> : <Empty title="No versions yet" />}
    {viewing ? (shown.data ? <EmailFrame html={shown.data.html} title={`Version ${viewing}`} height={480} /> : <AsyncState loading={shown.loading} error={shown.error} />) : null}
    {restoring ? <ConfirmDialog title={`Restore “${restoring.label || 'version'}”?`} destructive={false} busy={action.busy}
      description="The email returns to this version. What you have now is kept as its own version first, so you can come back to it."
      actionLabel="Restore version" onClose={() => setRestoring(undefined)}
      onConfirm={() => void action.run(async () => {
        await prepare();
        const restored = await api<Design>(`/studio/designs/${designId}/versions/${restoring.version}/restore`, 'POST', { version: currentVersion() });
        setRestoring(undefined);
        onRestored(restored);
      })} /> : null}
  </SlideDrawer>;
}

function AdvancedView({ designId, errors, preview, onApply, onClose }: {
  designId: string; errors: CompileIssue[]; preview: boolean; onApply: (source: string) => void; onClose: () => void;
}) {
  const design = useResource<Design>(`/studio/designs/${designId}`);
  const [draft, setDraft] = useState<string>();
  const [view, setView] = useState<'mjml' | 'html'>('mjml');
  const check = useAction();
  const [checked, setChecked] = useState<CompileIssue[]>();
  const source = draft ?? design.data?.source ?? '';
  const issues = checked ?? errors;
  return <Modal title="Advanced: MJML and HTML" onClose={onClose} size="wide">
    <Text color="secondary">For experts. Edit the MJML directly, or copy the compiled HTML. The visual editor stays the source of truth; applying replaces the canvas{preview ? ' (sample data in this preview)' : ''}.</Text>
    <div className="ov-studio-tabs ov-studio-tabs--inline" role="tablist">
      <button type="button" role="tab" aria-selected={view === 'mjml'} onClick={() => setView('mjml')}>MJML source</button>
      <button type="button" role="tab" aria-selected={view === 'html'} onClick={() => setView('html')}>Compiled HTML</button>
    </div>
    {issues.length ? <Banner status="warning" title={`${issues.length} MJML ${issues.length === 1 ? 'warning' : 'warnings'}`} description={issues.slice(0, 5).map(item => `Line ${item.line}: ${item.message}`).join(' · ')} /> : null}
    {!design.data ? <AsyncState loading={design.loading} error={design.error} retry={design.refresh} />
      : view === 'mjml' ? <TextArea label="MJML source" isLabelHidden rows={20} hasSpellCheck={false} value={source} onChange={setDraft} />
        : <TextArea label="Compiled HTML" isLabelHidden rows={20} hasSpellCheck={false} value={design.data.html} isReadOnly />}
    <Feedback error={check.error} notice={check.notice} />
    <FormActions>
      <Button label="Close" onClick={onClose} />
      {view === 'mjml' ? <>
        {checked && !checked.length ? <Text type="supporting" color="secondary">No MJML problems found.</Text> : null}
        <Button label="Check MJML" isLoading={check.busy} onClick={() => void check.run(async () => {
          const result = await api<{ errors: CompileIssue[] }>('/studio/compile', 'POST', { source });
          setChecked(result.errors);
        })} />
        <Button variant="primary" label="Apply to canvas" isDisabled={draft === undefined} onClick={() => onApply(source)} />
      </> : null}
    </FormActions>
  </Modal>;
}

function SaveBlockDialog({ onSave, onClose }: { onSave: (name: string) => Promise<void>; onClose: () => void }) {
  const action = useAction();
  const [name, setName] = useState('');
  return <Modal title="Save as a reusable block" onClose={onClose}>
    <form className="ov-stack-sm" onSubmit={event => { event.preventDefault(); void action.run(() => onSave(name.trim())); }}>
      <TextInput label="Block name" value={name} onChange={setName} placeholder="e.g. Spring offer banner" isRequired />
      <Text type="supporting" color="secondary">It appears under Saved blocks in every email.</Text>
      <Feedback error={action.error} />
      <FormActions><Button label="Cancel" onClick={onClose} /><Button type="submit" variant="primary" label="Save block" isDisabled={!name.trim()} isLoading={action.busy} /></FormActions>
    </form>
  </Modal>;
}
