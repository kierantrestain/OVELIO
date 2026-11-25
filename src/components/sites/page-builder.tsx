'use client';

// Full-screen landing-page builder (Lane 3): GrapesJS 0.23.9 inside an OVELIO chrome. Blocks, layers and saved sections
// on the left, styles and settings on the right, Desktop/Tablet/Mobile editing that writes responsive CSS, autosave
// with an optimistic version, version history, preview and a publish drawer with SEO, tracking and A/B settings.
import 'grapesjs/dist/css/grapes.min.css';
import '@/styles/sites.css';
import { ArrowLeft, Eye, History, Monitor, Redo2, Rocket, Settings2, Smartphone, Tablet, Undo2 } from 'lucide-react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Component, Editor } from 'grapesjs';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Selector } from '@astryxdesign/core/Selector';
import { Spinner } from '@astryxdesign/core/Spinner';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import type { FormSummary, LandingPageDetail, PageDesign, SavedSection } from '@/contracts/sites';
import { api, message } from '../client';
import { Empty, Modal } from '../ui';
import { blockDefinitions } from './blocks';
import { MediaPicker, PublishDrawer, VersionsDrawer } from './builder-panels';
import { formCss as formPreviewCss } from '@/templates/pages/form-css';

type SaveState = { kind: 'saved' | 'saving' | 'dirty' | 'error' | 'conflict'; message?: string; at?: string };
type Selected = { type: string; tagName: string; formId: string; href: string; videoUrl: string } | null;
type AssetRequest = { select: (asset: string, complete: boolean) => void; close: () => void };

const devices = [
  { id: 'Desktop', name: 'Desktop', width: '' },
  { id: 'Tablet', name: 'Tablet', width: '768px', widthMedia: '992px' },
  { id: 'Mobile', name: 'Mobile', width: '390px', widthMedia: '480px' },
];

const fontOptions = [
  { id: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif", label: 'System sans' },
  { id: "Georgia, 'Iowan Old Style', 'Palatino Linotype', 'Times New Roman', serif", label: 'Serif' },
  { id: "ui-rounded, 'SF Pro Rounded', 'Segoe UI', Roboto, Arial, sans-serif", label: 'Rounded' },
  { id: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace", label: 'Monospace' },
  { id: 'Arial, Helvetica, sans-serif', label: 'Arial' },
];

const escapeAttr = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export function videoEmbedUrl(url: string): string | null {
  const youtube = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,20})/.exec(url);
  if (youtube) return `https://www.youtube-nocookie.com/embed/${youtube[1]}`;
  const vimeo = /vimeo\.com\/(?:video\/)?(\d{5,12})/.exec(url);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  return null;
}

const previewCache = new Map<string, Promise<string>>();
function formPreview(formId: string) {
  if (!previewCache.has(formId)) {
    previewCache.set(formId, fetch(`/api/public/forms/${formId}`, { cache: 'no-store' })
      .then(response => response.json() as Promise<{ html?: string; error?: string }>)
      .then(data => data.html ?? `<p class="ov-sites-slot-note">${escapeAttr(data.error ?? 'This form is not published.')}</p>`)
      .catch(() => '<p class="ov-sites-slot-note">The form preview could not be loaded.</p>'));
  }
  return previewCache.get(formId)!;
}

function registerTypes(editor: Editor) {
  const attrsToHtml = (attrs: Record<string, unknown>) => Object.entries(attrs)
    .filter(([, value]) => value !== undefined && value !== null && value !== false)
    .map(([key, value]) => value === true ? ` ${key}` : ` ${key}="${escapeAttr(String(value))}"`).join('');

  editor.Components.addType('ovelio-form', {
    isComponent: el => (el as HTMLElement).hasAttribute?.('data-ovelio-form') ? { type: 'ovelio-form', components: [] } : undefined,
    model: {
      defaults: { name: 'Form', droppable: false, editable: false, attributes: { class: 'ovp-form-slot', 'data-ovelio-form': '' }, traits: [] },
      toHTML(this: Component) { return `<div${attrsToHtml(this.getAttrToHTML())}></div>`; },
    },
    view: {
      init(this: { listenTo: (model: unknown, event: string, handler: () => void) => void; model: Component; render: () => void }) {
        this.listenTo(this.model, 'change:attributes', this.render);
      },
      onRender(this: { el: HTMLElement; model: Component }) {
        const el = this.el;
        const formId = String(this.model.getAttributes()['data-ovelio-form'] ?? '');
        if (!formId) {
          el.innerHTML = '<div class="ov-sites-slot">Form block · select it and choose a form in <strong>Settings</strong></div>';
          return;
        }
        el.innerHTML = '<div class="ov-sites-slot">Loading form…</div>';
        void formPreview(formId).then(html => { el.innerHTML = `<div style="pointer-events:none">${html}</div>`; });
      },
    },
  });

  editor.Components.addType('ovelio-video', {
    isComponent: el => (el as HTMLElement).classList?.contains('ovp-video') ? { type: 'ovelio-video', components: [], attributes: { class: 'ovp-video', 'data-video-url': (el as HTMLElement).getAttribute('data-video-url') ?? '' } } : undefined,
    model: {
      defaults: {
        name: 'Video', droppable: false, editable: false, attributes: { class: 'ovp-video', 'data-video-url': '' },
        traits: [{ type: 'text', name: 'data-video-url', label: 'YouTube or Vimeo link', placeholder: 'https://www.youtube.com/watch?v=…' }],
      },
      toHTML(this: Component) {
        const attrs = this.getAttrToHTML();
        const src = videoEmbedUrl(String(attrs['data-video-url'] ?? ''));
        const frame = src ? `<iframe src="${src}" title="Video" loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen></iframe>` : '';
        return `<div${attrsToHtml(attrs)}>${frame}</div>`;
      },
    },
    view: {
      init(this: { listenTo: (model: unknown, event: string, handler: () => void) => void; model: Component; render: () => void }) {
        this.listenTo(this.model, 'change:attributes', this.render);
      },
      onRender(this: { el: HTMLElement; model: Component }) {
        const url = String(this.model.getAttributes()['data-video-url'] ?? '');
        const ok = videoEmbedUrl(url);
        this.el.innerHTML = `<div class="ov-sites-video"><span>▶</span><small>${ok ? escapeAttr(url) : 'Select the video and paste a YouTube or Vimeo link in Settings'}</small></div>`;
      },
    },
  });
}

function styleSectors() {
  return [
    { name: 'Typography', open: true, properties: [{ extend: 'font-family', options: fontOptions }, 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'color', 'text-align', 'text-transform'] },
    { name: 'Background', open: false, properties: ['background-color', 'background'] },
    { name: 'Spacing', open: false, properties: ['margin', 'padding'] },
    { name: 'Size', open: false, properties: ['width', 'max-width', 'height', 'min-height'] },
    { name: 'Layout', open: false, properties: ['display', 'flex-direction', 'justify-content', 'align-items', 'gap'] },
    { name: 'Borders & effects', open: false, properties: ['border-radius', 'border', 'box-shadow', 'opacity'] },
  ];
}

export function PageBuilder({ pageId, variant }: { pageId: string; variant: string | null }) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const blocksRef = useRef<HTMLDivElement>(null);
  const layersRef = useRef<HTMLDivElement>(null);
  const stylesRef = useRef<HTMLDivElement>(null);
  const traitsRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const versionRef = useRef(0);
  const savingRef = useRef(false);
  const pendingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [page, setPage] = useState<LandingPageDetail>();
  const [loadError, setLoadError] = useState<string>();
  const [ready, setReady] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'saved' });
  const [device, setDevice] = useState('Desktop');
  const [leftTab, setLeftTab] = useState<'blocks' | 'layers' | 'saved'>('blocks');
  const [rightTab, setRightTab] = useState<'style' | 'settings'>('style');
  const [selected, setSelected] = useState<Selected>(null);
  const [assetRequest, setAssetRequest] = useState<AssetRequest | null>(null);
  const [drawer, setDrawer] = useState<'versions' | 'publish' | null>(null);
  const [history, setHistory] = useState({ undo: false, redo: false });
  const [name, setName] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null);
  const router = useRouter();
  const query = variant && variant !== 'a' ? `?variant=${variant}` : '';

  const saveRef = useRef<(label?: string) => Promise<boolean>>(async () => false);
  useEffect(() => {
    saveRef.current = async (label?: string): Promise<boolean> => {
    const editor = editorRef.current;
    if (!editor) return false;
    if (savingRef.current) { pendingRef.current = true; return false; }
    savingRef.current = true;
    setSaveState({ kind: 'saving' });
    try {
      const result = await api<{ version: number; updatedAt: string }>(`/sites/pages/${pageId}/design${query}`, 'PATCH', {
        version: versionRef.current, document: editor.getProjectData(), html: editor.getHtml(), css: editor.getCss({ keepUnusedStyles: true }) ?? '', label,
      });
      versionRef.current = result.version;
      editor.clearDirtyCount();
      setSaveState({ kind: 'saved', at: result.updatedAt });
      return true;
    } catch (error) {
      const text = message(error);
      setSaveState({ kind: /saved elsewhere/.test(text) ? 'conflict' : 'error', message: text });
      return false;
    } finally {
      savingRef.current = false;
      if (pendingRef.current) {
        pendingRef.current = false;
        timerRef.current = setTimeout(() => void saveRef.current(), 400);
      }
    }
    };
  }, [pageId, query]);
  const save = useCallback((label?: string) => saveRef.current(label), []);

  const reloadDesign = useCallback((design: PageDesign) => {
    const editor = editorRef.current;
    if (!editor) return;
    versionRef.current = design.version;
    if (Array.isArray((design.document as { pages?: unknown[] }).pages)) editor.loadProjectData(design.document);
    else {
      editor.setComponents(design.html);
      editor.setStyle(design.css);
    }
    editor.UndoManager.clear();
    editor.clearDirtyCount();
    setSaveState({ kind: 'saved', at: design.updatedAt });
  }, []);

  useEffect(() => {
    let cancelled = false;
    let instance: Editor | null = null;
    (async () => {
      try {
        const [detail, design, grapesjs] = await Promise.all([
          api<LandingPageDetail>(`/sites/pages/${pageId}`),
          api<PageDesign>(`/sites/pages/${pageId}/design${query}`),
          import('grapesjs').then(module => module.default),
        ]);
        if (cancelled || !canvasRef.current) return;
        setPage(detail);
        setName(detail.name);
        versionRef.current = design.version;
        const hasProject = Array.isArray((design.document as { pages?: unknown[] }).pages);
        const created = grapesjs.init({
          container: canvasRef.current,
          height: '100%',
          width: 'auto',
          storageManager: false,
          cssIcons: '',
          noticeOnUnload: false,
          panels: { defaults: [] },
          showOffsets: true,
          deviceManager: { devices },
          selectorManager: { componentFirst: true },
          canvasCss: formPreviewCss,
          styleManager: { appendTo: stylesRef.current!, sectors: styleSectors() },
          layerManager: { appendTo: layersRef.current! },
          traitManager: { appendTo: traitsRef.current! },
          blockManager: { appendTo: blocksRef.current!, blocks: blockDefinitions.map(block => ({ id: block.id, label: block.label, category: block.category, media: block.media, content: block.content, activate: block.activate })) },
          assetManager: {
            custom: {
              open: (props: { select: (asset: string, complete: boolean) => void; close: () => void }) => setAssetRequest({ select: props.select, close: props.close }),
              close: () => setAssetRequest(null),
            },
          },
          canvas: { styles: [] },
          ...(hasProject ? { projectData: design.document } : { components: design.html, style: design.css }),
          plugins: [registerTypes],
        });
        instance = created;
        editorRef.current = created;
        setEditor(created);
        const refreshSelection = () => {
          const component = created.getSelected();
          if (!component) { setSelected(null); return; }
          const attrs = component.getAttributes();
          setSelected({ type: String(component.get('type') ?? ''), tagName: String(component.get('tagName') ?? ''), formId: String(attrs['data-ovelio-form'] ?? ''), href: String(attrs.href ?? ''), videoUrl: String(attrs['data-video-url'] ?? '') });
        };
        created.on('component:toggled', refreshSelection);
        created.on('component:update:attributes', refreshSelection);
        created.on('update', () => {
          setHistory({ undo: created.UndoManager.hasUndo(), redo: created.UndoManager.hasRedo() });
          if (!created.getDirtyCount()) return;
          setSaveState(current => current.kind === 'conflict' ? current : { kind: 'dirty' });
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => void saveRef.current(), 1800);
        });
        created.on('load', () => { created.clearDirtyCount(); setReady(true); });
      } catch (error) {
        if (!cancelled) setLoadError(message(error));
      }
    })();
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      instance?.destroy();
      editorRef.current = null;
    };
  }, [pageId, query]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (editorRef.current?.getDirtyCount()) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const changeDevice = (next: string) => {
    setDevice(next);
    editorRef.current?.setDevice(next);
  };

  const rename = async () => {
    if (!page || !name.trim() || name.trim() === page.name) return;
    try {
      setPage(await api<LandingPageDetail>(`/sites/pages/${pageId}`, 'PATCH', { name: name.trim() }));
    } catch (error) {
      setSaveState({ kind: 'error', message: message(error) });
    }
  };

  const updateSelectedAttrs = (attrs: Record<string, string>) => {
    const component = editorRef.current?.getSelected();
    if (!component) return;
    component.addAttributes(attrs);
  };

  if (loadError) {
    return <div className="ov-sites-studio ov-sites-studio--message">
      <Banner status="error" title="The builder could not open this page" description={loadError} />
      <Button label="Back to landing pages" href="/sites" as={NextLink} />
    </div>;
  }

  const status = saveState.kind === 'saving' ? 'Saving…'
    : saveState.kind === 'dirty' ? 'Unsaved changes'
      : saveState.kind === 'saved' ? (saveState.at ? 'All changes saved' : 'Saved')
        : saveState.kind === 'conflict' ? 'Newer version elsewhere' : 'Not saved';

  return <div className="ov-sites-studio">
    <header className="ov-sites-topbar">
      <div className="ov-sites-topbar-start">
        <IconButton label="Back to landing pages" icon={<ArrowLeft size={18} />} variant="ghost" href="/sites" as={NextLink} />
        <div className="ov-sites-name">
          <TextInput label="Page name" isLabelHidden size="sm" value={name} onChange={setName} onEnter={() => void rename()} onKeyDown={event => { if (event.key === 'Escape') setName(page?.name ?? ''); }} />
        </div>
        {page && page.variants.length ? <Selector label="Variant" isLabelHidden size="sm" width={150} value={variant ?? 'a'}
          options={[{ value: 'a', label: 'Variant A (control)' }, ...page.variants.map(item => ({ value: item.key, label: item.name }))]}
          onChange={value => { if (value) router.push(`/studio/page/${pageId}${value === 'a' ? '' : `?variant=${value}`}`); }} /> : null}
      </div>
      <div className="ov-sites-devices" role="group" aria-label="Device">
        {[{ id: 'Desktop', icon: Monitor }, { id: 'Tablet', icon: Tablet }, { id: 'Mobile', icon: Smartphone }].map(item => <button key={item.id} type="button"
          className={'ov-sites-device' + (device === item.id ? ' is-active' : '')} aria-pressed={device === item.id} onClick={() => changeDevice(item.id)} title={`${item.id} view`}>
          <item.icon size={16} aria-hidden="true" /><span>{item.id}</span>
        </button>)}
      </div>
      <div className="ov-sites-topbar-end">
        <IconButton label="Undo" icon={<Undo2 size={17} />} variant="ghost" size="sm" isDisabled={!history.undo} onClick={() => editorRef.current?.UndoManager.undo()} />
        <IconButton label="Redo" icon={<Redo2 size={17} />} variant="ghost" size="sm" isDisabled={!history.redo} onClick={() => editorRef.current?.UndoManager.redo()} />
        <span className={`ov-sites-save ov-sites-save--${saveState.kind}`} role="status" title={saveState.message}>{saveState.kind === 'saving' ? <Spinner size="sm" /> : null}{status}</span>
        {saveState.kind === 'error' ? <Button label="Retry" size="sm" variant="ghost" onClick={() => void save()} /> : null}
        <Button label="Versions" size="sm" variant="ghost" icon={<History size={16} />} onClick={() => setDrawer('versions')} isDisabled={!ready} />
        <Button label="Preview" size="sm" variant="secondary" icon={<Eye size={16} />} isDisabled={!ready} onClick={async () => {
          const tab = window.open('about:blank', '_blank');
          await save();
          if (tab) tab.location.href = `/api/console/sites/pages/${pageId}/preview${query}`;
        }} />
        <Button label="Settings" size="sm" variant="secondary" icon={<Settings2 size={16} />} onClick={() => setDrawer('publish')} isDisabled={!page} />
        <Button label={page?.status === 'published' ? 'Update' : 'Publish'} size="sm" variant="primary" icon={<Rocket size={16} />} onClick={() => setDrawer('publish')} isDisabled={!ready} />
      </div>
    </header>
    {saveState.kind === 'conflict' || saveState.kind === 'error' ? <div className="ov-sites-alert">
      <Banner status={saveState.kind === 'conflict' ? 'warning' : 'error'} title={saveState.kind === 'conflict' ? 'This page changed in another window' : 'Your latest changes are not saved'}
        description={saveState.message} endContent={saveState.kind === 'conflict' ? <Button size="sm" label="Reload the latest version" onClick={() => window.location.reload()} /> : undefined} />
    </div> : null}
    <div className="ov-sites-body">
      <aside className="ov-sites-left" aria-label="Blocks and layers">
        <div className="ov-sites-tabs" role="tablist">
          {(['blocks', 'layers', 'saved'] as const).map(tab => <button key={tab} type="button" role="tab" aria-selected={leftTab === tab} className={leftTab === tab ? 'is-active' : ''} onClick={() => setLeftTab(tab)}>
            {tab === 'blocks' ? 'Add' : tab === 'layers' ? 'Layers' : 'Saved'}
          </button>)}
        </div>
        <div className="ov-sites-panel" hidden={leftTab !== 'blocks'}>
          <Text type="supporting" color="secondary">Drag a block onto the page.</Text>
          <div ref={blocksRef} />
        </div>
        <div className="ov-sites-panel" hidden={leftTab !== 'layers'}><div ref={layersRef} /></div>
        <div className="ov-sites-panel" hidden={leftTab !== 'saved'}>
          {leftTab === 'saved' ? <SavedSections editor={editor} /> : null}
        </div>
      </aside>
      <main className="ov-sites-canvas">
        {!ready ? <div className="ov-sites-loading"><Spinner /><Text color="secondary">Opening the builder…</Text></div> : null}
        <div ref={canvasRef} className="ov-sites-gjs" />
      </main>
      <aside className="ov-sites-right" aria-label="Styles and settings">
        <div className="ov-sites-tabs" role="tablist">
          {(['style', 'settings'] as const).map(tab => <button key={tab} type="button" role="tab" aria-selected={rightTab === tab} className={rightTab === tab ? 'is-active' : ''} onClick={() => setRightTab(tab)}>
            {tab === 'style' ? 'Style' : 'Settings'}
          </button>)}
        </div>
        <div className="ov-sites-panel" hidden={rightTab !== 'style'}>
          {!selected ? <Empty title="Select an element" description={`Click anything on the page to style it. Changes in ${device} view apply ${device === 'Desktop' ? 'to every screen size' : `to ${device.toLowerCase()} screens and smaller`}.`} /> : null}
          <div ref={stylesRef} hidden={!selected} />
        </div>
        <div className="ov-sites-panel" hidden={rightTab !== 'settings'}>
          {!selected ? <Empty title="Select an element" description="Links, images, videos and form blocks have settings here." /> : null}
          {selected?.type === 'ovelio-form' ? <FormBlockPanel formId={selected.formId} pageName={page?.name ?? 'Landing page'} onChange={formId => {
            updateSelectedAttrs({ 'data-ovelio-form': formId });
            previewCache.delete(formId);
          }} /> : null}
          {selected?.tagName === 'a' ? <div className="ov-sites-hint">
            <Button size="sm" variant="secondary" label="Link to the next funnel step" onClick={() => updateSelectedAttrs({ href: '#ovelio-next-step' })} />
            <Text type="supporting" color="secondary">When this page is a funnel step, the link opens the next step.</Text>
          </div> : null}
          <div ref={traitsRef} hidden={!selected} />
          {selected && selected.type !== 'wrapper' ? <SaveSectionButton editor={editor} /> : null}
        </div>
      </aside>
    </div>
    {assetRequest ? <MediaPicker onClose={() => { assetRequest.close(); setAssetRequest(null); }} onPick={url => { assetRequest.select(url, true); setAssetRequest(null); }} /> : null}
    {drawer === 'versions' ? <VersionsDrawer pageId={pageId} query={query} onClose={() => setDrawer(null)} beforeSave={save} onRestored={design => { reloadDesign(design); setDrawer(null); }} /> : null}
    {drawer === 'publish' && page ? <PublishDrawer page={page} onClose={() => setDrawer(null)} onChange={next => { setPage(next); setName(next.name); }} beforePublish={save} /> : null}
  </div>;
}

function FormBlockPanel({ formId, pageName, onChange }: { formId: string; pageName: string; onChange: (formId: string) => void }) {
  const [forms, setForms] = useState<FormSummary[]>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ items: FormSummary[] }>('/sites/forms').then(result => setForms(result.items), cause => setError(message(cause)));
  }, []);
  return <div className="ov-sites-hint">
    <Text weight="medium">Form shown in this block</Text>
    {error ? <Banner status="error" title={error} /> : null}
    <Selector label="Form" isLabelHidden placeholder={forms ? 'Choose a form' : 'Loading forms…'} value={formId}
      options={(forms ?? []).map(form => ({ value: form.id, label: form.name, description: form.status === 'published' ? `${form.fieldCount} fields` : 'Draft: publish it before publishing this page' }))}
      onChange={value => { if (value) onChange(value); }} />
    <div className="ov-actions">
      <Button size="sm" variant="secondary" label="New form" isLoading={busy} onClick={async () => {
        setBusy(true);
        try {
          const created = await api<{ id: string; name: string }>('/sites/forms', 'POST', { name: `${pageName} form`.slice(0, 120) });
          setForms(current => [{ id: created.id, name: created.name, status: 'published', description: '', fieldCount: 1, submissions: 0, lastSubmissionAt: null, updatedAt: new Date().toISOString() }, ...(current ?? [])]);
          onChange(created.id);
        } catch (cause) {
          setError(message(cause));
        } finally {
          setBusy(false);
        }
      }} />
      {formId ? <Button size="sm" variant="ghost" label="Edit form fields" href={`/sites/forms/${formId}`} target="_blank" /> : null}
    </div>
    <Text type="supporting" color="secondary">Edits to the form apply to every page that uses it, without republishing.</Text>
  </div>;
}

function SaveSectionButton({ editor }: { editor: Editor | null }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [state, setState] = useState<{ busy?: boolean; error?: string; done?: string }>({});
  return <div className="ov-sites-hint">
    <Button size="sm" variant="ghost" label="Save as reusable section" onClick={() => { setOpen(true); setState({}); }} />
    {state.done ? <Text type="supporting" color="secondary">{state.done}</Text> : null}
    {open ? <Modal title="Save as a reusable section" onClose={() => setOpen(false)}>
      <form className="ov-stack-sm" onSubmit={async event => {
        event.preventDefault();
        const component = editor?.getSelected();
        if (!component || !name.trim()) return;
        setState({ busy: true });
        try {
          await api('/sites/sections', 'POST', { name: name.trim(), html: component.toHTML(), css: editor?.getCss({ component }) ?? '' });
          setOpen(false);
          setName('');
          setState({ done: 'Saved. Find it under Saved on the left.' });
        } catch (cause) {
          setState({ error: message(cause) });
        }
      }}>
        <TextInput label="Section name" value={name} onChange={setName} isRequired hasAutoFocus />
        {state.error ? <Banner status="error" title={state.error} /> : null}
        <div className="ov-actions ov-actions--end">
          <Button label="Cancel" variant="ghost" onClick={() => setOpen(false)} />
          <Button label="Save section" type="submit" variant="primary" isLoading={state.busy} isDisabled={!name.trim()} />
        </div>
      </form>
    </Modal> : null}
  </div>;
}

function SavedSections({ editor }: { editor: Editor | null }) {
  const [items, setItems] = useState<SavedSection[]>();
  const [error, setError] = useState<string>();
  const load = useCallback(() => api<{ items: SavedSection[] }>('/sites/sections').then(result => setItems(result.items), cause => setError(message(cause))), []);
  useEffect(() => { void load(); }, [load]);
  if (error) return <Banner status="error" title={error} />;
  if (!items) return <div className="ov-actions"><Spinner size="sm" /><Text color="secondary">Loading…</Text></div>;
  if (!items.length) return <Empty title="No saved sections yet" description="Select a section on the page, open Settings and choose “Save as reusable section”." />;
  return <ul className="ov-sites-saved">
    {items.map(item => <li key={item.id}>
      <span>{item.name}</span>
      <span className="ov-actions">
        <Button size="sm" variant="secondary" label="Insert" onClick={() => {
          if (!editor) return;
          // Only element-specific (#id) rules travel with a section; class styles come from this page's theme.
          const own = item.css.match(/(@media[^{]+\{)?#[\w-]+[^{]*\{[^}]*\}\}?/g)?.join('') ?? '';
          const html = item.html + (own ? `<style>${own}</style>` : '');
          const target = editor.getSelected();
          const parent = target?.parent();
          const added = parent && target ? parent.append(html, { at: parent.components().indexOf(target) + 1 }) : editor.addComponents(html);
          editor.select(added[0]);
        }} />
        <Button size="sm" variant="ghost" label="Delete" onClick={async () => {
          try { await api(`/sites/sections/${item.id}`, 'DELETE'); void load(); } catch (cause) { setError(message(cause)); }
        }} />
      </span>
    </li>)}
  </ul>;
}
