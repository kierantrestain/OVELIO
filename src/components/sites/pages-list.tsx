'use client';

// /sites: landing pages with live thumbnails, status, address and 30-day results, the template gallery
// (category filter, search, preview) and per-page stats including A/B variants.
import '@/styles/sites.css';
import { BarChart3, ExternalLink, MoreHorizontal, Pencil, Plus } from 'lucide-react';
import NextLink from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { Link } from '@astryxdesign/core/Link';
import { Selector } from '@astryxdesign/core/Selector';
import { Table } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import type { FormSummary, LandingPageSummary, PageStats, PageTemplate, PageTemplateSummary } from '@/contracts/sites';
import { pageTemplateCategories } from '@/contracts/sites';
import { api, date, message, number, request, useResource } from '../client';
import { AsyncState, Bars, ConfirmDialog, Distribution, Empty, Metric, Modal, PageHeader, Panel, SlideDrawer, StatusBadge } from '../ui';
import { absoluteUrl, pageStatusTone, percent } from './shared';

/** A scaled, script-free rendering of an HTML document, loaded when the card scrolls into view. */
export function Thumbnail({ load, label, large = false }: { load: () => Promise<string>; label: string; large?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState<string>();
  const [scale, setScale] = useState(0.25);
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const resize = () => setScale(element.clientWidth / 1280);
    resize();
    const sizes = new ResizeObserver(resize);
    sizes.observe(element);
    let started = false;
    const visible = new IntersectionObserver(entries => {
      if (started || !entries.some(entry => entry.isIntersecting)) return;
      started = true;
      load().then(setHtml, () => setHtml('<p style="font:14px sans-serif;padding:24px">Preview unavailable</p>'));
    }, { rootMargin: '200px' });
    visible.observe(element);
    return () => { sizes.disconnect(); visible.disconnect(); };
  }, [load]);
  return <div ref={box} className={'ov-sites-thumb' + (large ? ' ov-sites-thumb--lg' : '')} style={{ ['--ov-sites-scale' as string]: scale }} aria-label={label} role="img">
    {html ? <iframe title={label} srcDoc={html} sandbox="" loading="lazy" tabIndex={-1} aria-hidden="true" /> : null}
  </div>;
}

const templateCache = new Map<string, Promise<string>>();
export function templateDocument(key: string) {
  if (!templateCache.has(key)) {
    templateCache.set(key, request<PageTemplate>(`/api/console/sites/templates/${key}`).then(template => `<!doctype html><html><head><meta charset="utf-8"><style>${template.css}</style></head><body>${template.html}</body></html>`));
  }
  return templateCache.get(key)!;
}

export function LandingPages() {
  const router = useRouter();
  const params = useSearchParams();
  const [status, setStatus] = useState('active');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(params.get('create') === 'page');
  const [statsFor, setStatsFor] = useState<LandingPageSummary | null>(null);
  const [confirm, setConfirm] = useState<{ page: LandingPageSummary; action: 'delete' | 'archive' } | null>(null);
  const [notice, setNotice] = useState<{ error?: string; notice?: string }>({});
  const pages = useResource<{ items: LandingPageSummary[] }>(`/sites/pages${status === 'active' ? '' : `?status=${status}`}`);
  const items = (pages.data?.items ?? []).filter(item => !search.trim() || `${item.name} ${item.slug}`.toLowerCase().includes(search.trim().toLowerCase()));

  const act = async (label: string, task: () => Promise<unknown>) => {
    setNotice({});
    try {
      await task();
      setNotice({ notice: label });
      pages.refresh();
    } catch (cause) {
      setNotice({ error: message(cause) });
    }
  };

  return <div className="ov-stack ov-wide">
    <PageHeader title="Landing pages" description="Design, publish and measure pages that turn visitors into contacts."
      actions={<Button label="New landing page" variant="primary" icon={<Plus size={16} />} onClick={() => setCreating(true)} />} />
    <div className="ov-sites-toolbar">
      <div>
        <TextInput label="Search pages" isLabelHidden placeholder="Search by name or address" value={search} onChange={setSearch} width={280} hasClear />
        <Selector label="Status" isLabelHidden width={170} value={status} onChange={value => setStatus(value ?? 'active')}
          options={[{ value: 'active', label: 'Drafts and published' }, { value: 'published', label: 'Published' }, { value: 'draft', label: 'Drafts' }, { value: 'archived', label: 'Archived' }]} />
      </div>
      <div className="ov-sites-links">
        <Link href="/sites/funnels" as={NextLink}>Funnels</Link>
        <Link href="/sites/forms" as={NextLink}>Forms</Link>
        <Link href="/sites/domains" as={NextLink}>Domains</Link>
        <Link href="/sites/classic-pages" as={NextLink}>Classic pages (audience engine)</Link>
      </div>
    </div>
    {notice.error ? <Banner status="error" title={notice.error} /> : null}
    {notice.notice ? <Banner status="success" title={notice.notice} /> : null}
    {!pages.data ? <AsyncState loading={pages.loading} error={pages.error} retry={pages.refresh} />
      : !items.length ? <Panel><Empty title={search ? 'No pages match your search' : status === 'archived' ? 'No archived pages' : 'No landing pages yet'}
        description="Start from one of the professionally designed templates, then edit it visually."
        action={<Button label="Choose a template" variant="primary" onClick={() => setCreating(true)} />} /></Panel>
        : <div className="ov-sites-cards">
          {items.map(page => <article key={page.id} className="ov-sites-card">
            <NextLink href={`/studio/page/${page.id}`} aria-label={`Edit ${page.name}`}>
              <Thumbnail label={`Preview of ${page.name}`} load={() => request<string>(`/api/console/sites/pages/${page.id}/preview`).then(html => html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<div style="position:sticky[^"]*">[^<]*<\/div>/, ''))} />
            </NextLink>
            <div className="ov-sites-card-body">
              <div className="ov-sites-card-title">
                <NextLink href={`/studio/page/${page.id}`}>{page.name}</NextLink>
                <StatusBadge label={page.status === 'published' ? (page.hasDraftChanges ? 'Edited' : 'Published') : page.status === 'archived' ? 'Archived' : 'Draft'} tone={pageStatusTone(page)} />
              </div>
              {page.status === 'published'
                ? <a className="ov-sites-url" href={absoluteUrl(page.url)} target="_blank" rel="noreferrer">{page.domain ? page.url : page.url} <ExternalLink size={12} aria-hidden="true" /></a>
                : <span className="ov-sites-url">{page.url} · not live</span>}
              <div className="ov-sites-kpis" aria-label="Last 30 days">
                <div><strong>{number(page.views)}</strong><span>Views</span></div>
                <div><strong>{number(page.conversions)}</strong><span>Conversions</span></div>
                <div><strong>{percent(page.conversionRate)}</strong><span>Conv. rate</span></div>
              </div>
              <Text type="supporting" color="secondary">{page.publishedAt ? `Published ${date(page.publishedAt)}` : `Edited ${date(page.updatedAt)}`}</Text>
              <div className="ov-actions">
                <Button size="sm" variant="secondary" label="Edit" icon={<Pencil size={14} />} href={`/studio/page/${page.id}`} as={NextLink} />
                <Button size="sm" variant="ghost" label="Stats" icon={<BarChart3 size={14} />} onClick={() => setStatsFor(page)} />
                <DropdownMenu button={{ label: 'More actions', isIconOnly: true, icon: <MoreHorizontal size={16} />, variant: 'ghost', size: 'sm' }} items={[
                  { label: 'Duplicate', onClick: () => void act('Page duplicated.', async () => { const copy = await api<{ id: string }>(`/sites/pages/${page.id}/duplicate`, 'POST', {}); router.push(`/studio/page/${copy.id}`); }) },
                  ...(page.status === 'published' ? [{ label: 'Unpublish', onClick: () => void act('Page unpublished.', () => api(`/sites/pages/${page.id}/unpublish`, 'POST', {})) }] : []),
                  ...(page.status !== 'archived' ? [{ label: 'Archive', onClick: () => setConfirm({ page, action: 'archive' as const }) }] : [{ label: 'Restore as draft', onClick: () => void act('Page restored as a draft.', () => api(`/sites/pages/${page.id}/unpublish`, 'POST', {})) }]),
                  { type: 'divider' as const },
                  { label: 'Delete permanently', variant: 'destructive' as const, onClick: () => setConfirm({ page, action: 'delete' as const }) },
                ]} />
              </div>
            </div>
          </article>)}
        </div>}
    {creating ? <TemplateGallery onClose={() => { setCreating(false); if (params.get('create')) router.replace('/sites'); }} onCreated={id => router.push(`/studio/page/${id}`)} /> : null}
    {statsFor ? <PageStatsDrawer page={statsFor} onClose={() => setStatsFor(null)} /> : null}
    {confirm ? <ConfirmDialog
      title={confirm.action === 'delete' ? `Delete “${confirm.page.name}”?` : `Archive “${confirm.page.name}”?`}
      description={confirm.action === 'delete' ? 'The page, its design and its version history are removed. Its recorded visits stay in analytics. This cannot be undone.' : 'The page goes offline and moves to Archived. You can restore it as a draft later.'}
      actionLabel={confirm.action === 'delete' ? 'Delete page' : 'Archive page'} onClose={() => setConfirm(null)}
      onConfirm={() => { const target = confirm; setConfirm(null); void act(target.action === 'delete' ? 'Page deleted.' : 'Page archived.', () => api(`/sites/pages/${target.page.id}${target.action === 'delete' ? '' : '/archive'}`, target.action === 'delete' ? 'DELETE' : 'POST', target.action === 'delete' ? undefined : {})); }} /> : null}
  </div>;
}

function TemplateGallery({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const templates = useResource<{ items: PageTemplateSummary[] }>('/sites/templates');
  const forms = useResource<{ items: FormSummary[] }>('/sites/forms');
  const [category, setCategory] = useState<string>('All');
  const [search, setSearch] = useState('');
  const [chosen, setChosen] = useState<PageTemplateSummary | null>(null);
  const [name, setName] = useState('');
  const [formChoice, setFormChoice] = useState('new');
  const [state, setState] = useState<{ busy?: boolean; error?: string }>({});
  const all = useMemo(() => templates.data?.items ?? [], [templates.data]);
  const visible = all.filter(item => (category === 'All' || item.category === category)
    && (!search.trim() || `${item.name} ${item.description} ${item.category}`.toLowerCase().includes(search.trim().toLowerCase())));
  const blank: PageTemplateSummary = { key: 'blank', name: 'Blank page', category: 'Lead generation', description: 'An empty canvas with the OVELIO styles.', palette: ['#ffffff', '#2457d6'], hasForm: false };

  if (chosen) {
    return <Modal title={`New page from “${chosen.name}”`} onClose={onClose} size="large">
      <form className="ov-stack-sm" onSubmit={async event => {
        event.preventDefault();
        setState({ busy: true });
        try {
          const created = await api<{ id: string }>('/sites/pages', 'POST', {
            name: name.trim(), templateKey: chosen.key,
            ...(chosen.hasForm ? formChoice === 'new' ? { createForm: true } : formChoice === 'none' ? { createForm: false } : { formId: formChoice } : {}),
          });
          onCreated(created.id);
        } catch (cause) {
          setState({ error: message(cause) });
        }
      }}>
        {chosen.key !== 'blank' ? <Thumbnail large label={`Preview of ${chosen.name}`} load={() => templateDocument(chosen.key)} /> : null}
        <TextInput label="Page name" description="Only your team sees this. The address is made from it and can be changed later." value={name} onChange={setName} isRequired hasAutoFocus />
        {chosen.hasForm ? <Selector label="Form on this page" value={formChoice} onChange={value => setFormChoice(value ?? 'new')} options={[
          { value: 'new', label: 'Create a new form from the template', description: 'Fields suggested for this kind of page; edit them any time.' },
          ...(forms.data?.items ?? []).filter(item => item.status !== 'archived').map(item => ({ value: item.id, label: item.name, description: `${item.fieldCount} fields · ${item.submissions} submissions` })),
          { value: 'none', label: 'Choose later in the builder' },
        ]} /> : null}
        {state.error ? <Banner status="error" title={state.error} /> : null}
        <div className="ov-actions ov-actions--end">
          <Button label="Back to templates" variant="ghost" onClick={() => setChosen(null)} />
          <Button label="Create and open the builder" type="submit" variant="primary" isLoading={state.busy} isDisabled={!name.trim()} />
        </div>
      </form>
    </Modal>;
  }

  return <Modal title="Choose a template" onClose={onClose} size="wide">
    <div className="ov-stack-sm">
      <TextInput label="Search templates" isLabelHidden placeholder="Search templates" value={search} onChange={setSearch} hasClear />
      {!templates.data ? <AsyncState loading={templates.loading} error={templates.error} retry={templates.refresh} /> : <div className="ov-sites-gallery">
        <nav className="ov-sites-categories" aria-label="Template categories">
          {['All', ...pageTemplateCategories].map(item => <button key={item} type="button" className={category === item ? 'is-active' : ''} aria-pressed={category === item} onClick={() => setCategory(item)}>
            <span>{item}</span><span>{item === 'All' ? all.length : all.filter(template => template.category === item).length}</span>
          </button>)}
        </nav>
        <div className="ov-sites-cards">
          {visible.map(template => <button type="button" key={template.key} className="ov-sites-card ov-sites-template" onClick={() => { setChosen(template); setName(template.name); }}>
            <Thumbnail label={`Preview of the ${template.name} template`} load={() => templateDocument(template.key)} />
            <div className="ov-sites-card-body">
              <div className="ov-sites-card-title"><strong>{template.name}</strong><span className="ov-sites-palette" aria-hidden="true">{template.palette.map(colour => <span key={colour} style={{ background: colour }} />)}</span></div>
              <Text type="supporting" color="secondary">{template.category}{template.hasForm ? ' · includes a form' : ''}</Text>
              <Text type="supporting">{template.description}</Text>
            </div>
          </button>)}
          {category === 'All' && !search ? <button type="button" className="ov-sites-card ov-sites-template" onClick={() => { setChosen(blank); setName('Untitled page'); }}>
            <div className="ov-sites-thumb" style={{ display: 'grid', placeContent: 'center' }}><Plus size={28} aria-hidden="true" /></div>
            <div className="ov-sites-card-body"><strong>Blank page</strong><Text type="supporting" color="secondary">Start from an empty canvas.</Text></div>
          </button> : null}
          {!visible.length ? <Empty title="No templates match" description="Try another category or search term." /> : null}
        </div>
      </div>}
    </div>
  </Modal>;
}

export function PageStatsDrawer({ page, onClose }: { page: Pick<LandingPageSummary, 'id' | 'name'>; onClose: () => void }) {
  const [days, setDays] = useState('30');
  const stats = useResource<PageStats>(`/sites/pages/${page.id}/stats?days=${days}`);
  return <SlideDrawer title={page.name} subtitle="Page performance" onClose={onClose} width={620}>
    <div className="ov-stack">
      <div className="ov-actions ov-actions--between">
        <Selector label="Period" isLabelHidden width={160} value={days} onChange={value => setDays(value ?? '30')} options={[{ value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }, { value: '90', label: 'Last 90 days' }]} />
        {stats.data?.provenance === 'preview_sample' ? <StatusBadge label="Preview sample data" tone="info" /> : null}
      </div>
      {!stats.data ? <AsyncState loading={stats.loading} error={stats.error} retry={stats.refresh} /> : <>
        <div className="ov-grid">
          <Metric label="Views" value={stats.data.views} />
          <Metric label="Unique visitors" value={stats.data.visitors} />
          <Metric label="Converted visitors" value={stats.data.conversions} hint={`${number(stats.data.submissions)} form submissions`} />
          <Metric label="Conversion rate" formatted={percent(stats.data.conversionRate)} info="Visitors who submitted a form on the page, divided by unique visitors." />
        </div>
        <Panel title="Views per day"><Bars label="Views per day" points={stats.data.series.map(point => ({ label: point.date, value: point.views }))} /></Panel>
        {stats.data.variants.length > 1 || stats.data.variants.some(item => item.key !== 'a') ? <Panel title="A/B variants">
          <Table data={stats.data.variants.map(item => ({ ...item, id: item.key }))} idKey="id" columns={[
            { key: 'name', header: 'Variant' },
            { key: 'visitors', header: 'Visitors', renderCell: item => number(item.visitors) },
            { key: 'conversions', header: 'Conversions', renderCell: item => number(item.conversions) },
            { key: 'conversionRate', header: 'Rate', renderCell: item => percent(item.conversionRate) },
          ]} />
        </Panel> : null}
        <Panel title="Traffic sources"><Distribution points={stats.data.sources} /></Panel>
      </>}
    </div>
  </SlideDrawer>;
}
