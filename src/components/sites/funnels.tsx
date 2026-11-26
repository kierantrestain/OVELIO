'use client';

// /sites/funnels: multi-step funnels built from landing pages, ordered by drag and drop, with per-step visitors,
// conversion, drop-off and completion rate from tracked visits.
import '@/styles/sites.css';
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ExternalLink, GitBranch, GripVertical, Plus, Trash2 } from 'lucide-react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Link } from '@astryxdesign/core/Link';
import { Selector } from '@astryxdesign/core/Selector';
import { Table } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import type { FieldRule, FunnelDetail, FunnelStats, FunnelStep, FunnelSummary, LandingPageSummary, RuleOperator } from '@/contracts/sites';
import { api, date, message, number, useResource } from '../client';
import { AsyncState, ConfirmDialog, Empty, Metric, Modal, PageHeader, Panel, StatusBadge } from '../ui';
import { absoluteUrl, percent } from './shared';

const tone = (status: string) => status === 'active' ? 'success' as const : status === 'draft' ? 'info' as const : 'neutral' as const;

export function FunnelsList() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [state, setState] = useState<{ busy?: boolean; error?: string }>({});
  const funnels = useResource<{ items: FunnelSummary[] }>('/sites/funnels');
  return <div className="ov-stack ov-wide">
    <PageHeader title="Funnels" description="Guide visitors through a sequence of pages and see where they drop off."
      actions={<Button label="New funnel" variant="primary" icon={<Plus size={16} />} onClick={() => setCreating(true)} />} />
    <Panel>
      {!funnels.data ? <AsyncState loading={funnels.loading} error={funnels.error} retry={funnels.refresh} />
        : funnels.data.items.length ? <Table data={funnels.data.items} idKey="id" hasHover columns={[
          { key: 'name', header: 'Funnel', renderCell: item => <Link href={`/sites/funnels/${item.id}`} as={NextLink}>{item.name}</Link> },
          { key: 'status', header: 'Status', renderCell: item => <StatusBadge label={item.status === 'active' ? 'Active' : item.status === 'draft' ? 'Draft' : 'Archived'} tone={tone(item.status)} /> },
          { key: 'stepCount', header: 'Steps', renderCell: item => number(item.stepCount) },
          { key: 'visitors', header: 'Entered (30 days)', renderCell: item => number(item.visitors) },
          { key: 'completions', header: 'Completed', renderCell: item => number(item.completions) },
          { key: 'completionRate', header: 'Completion rate', renderCell: item => percent(item.completionRate) },
          { key: 'updatedAt', header: 'Updated', renderCell: item => date(item.updatedAt) },
        ]} /> : <Empty title="No funnels yet" description="A funnel links landing pages in order, for example: guide download → webinar → demo request."
          action={<Button label="New funnel" variant="primary" onClick={() => setCreating(true)} />} />}
    </Panel>
    {creating ? <Modal title="New funnel" onClose={() => setCreating(false)}>
      <form className="ov-stack-sm" onSubmit={async event => {
        event.preventDefault();
        setState({ busy: true });
        try {
          const created = await api<FunnelDetail>('/sites/funnels', 'POST', { name: name.trim() });
          router.push(`/sites/funnels/${created.id}`);
        } catch (cause) {
          setState({ error: message(cause) });
        }
      }}>
        <TextInput label="Funnel name" value={name} onChange={setName} isRequired hasAutoFocus />
        {state.error ? <Banner status="error" title={state.error} /> : null}
        <div className="ov-actions ov-actions--end">
          <Button label="Cancel" variant="ghost" onClick={() => setCreating(false)} />
          <Button label="Create and add steps" type="submit" variant="primary" isLoading={state.busy} isDisabled={!name.trim()} />
        </div>
      </form>
    </Modal> : null}
  </div>;
}

type DraftRoute = FieldRule & { toUid: string };
type DraftStep = { uid: string; name: string; pageId: string; routes: DraftRoute[] };

const routeOperators: { value: RuleOperator; label: string }[] = [
  { value: 'equals', label: 'is' }, { value: 'not_equals', label: 'is not' }, { value: 'contains', label: 'contains' },
  { value: 'checked', label: 'is ticked' }, { value: 'not_checked', label: 'is not ticked' }, { value: 'not_empty', label: 'is filled in' },
];

function BranchEditor({ step, steps, fields, onChange }: { step: DraftStep; steps: DraftStep[]; fields: FunnelStep['fields'] | undefined; onChange: (routes: DraftRoute[]) => void }) {
  const others = steps.filter(item => item.uid !== step.uid);
  const update = (index: number, patch: Partial<DraftRoute>) => onChange(step.routes.map((route, other) => other === index ? { ...route, ...patch } : route));
  return <div className="ov-sites-branches">
    {step.routes.map((route, index) => {
      const source = fields?.find(item => item.key === route.field);
      const needsValue = ['equals', 'not_equals', 'contains'].includes(route.operator);
      return <div key={index} className="ov-sites-branch">
        <Text type="supporting" weight="medium">{index ? 'Else if' : 'If'}</Text>
        {fields?.length ? <Selector label="Answer" isLabelHidden width={170} value={route.field} onChange={value => update(index, { field: value ?? route.field, value: '' })} options={fields.map(item => ({ value: item.key, label: item.label }))} />
          : <TextInput label="Field key" isLabelHidden width={150} placeholder="field_key" value={route.field} onChange={value => update(index, { field: value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} />}
        <Selector label="Condition" isLabelHidden width={130} value={route.operator} onChange={value => update(index, { operator: (value ?? 'equals') as RuleOperator })} options={routeOperators} />
        {needsValue ? source?.options?.length && route.operator !== 'contains'
          ? <Selector label="Value" isLabelHidden width={150} placeholder="Answer" value={route.value ?? ''} onChange={value => update(index, { value: value ?? '' })} options={source.options.map(option => ({ value: option, label: option }))} />
          : <TextInput label="Value" isLabelHidden width={140} placeholder="Answer" value={route.value ?? ''} onChange={value => update(index, { value })} /> : null}
        <Text type="supporting" weight="medium">go to</Text>
        <Selector label="Go to step" isLabelHidden width={170} placeholder="Choose a step" value={route.toUid} onChange={value => update(index, { toUid: value ?? '' })}
          options={others.map(item => ({ value: item.uid, label: `${steps.indexOf(item) + 1}. ${item.name || 'Untitled step'}` }))} />
        <IconButton label="Remove branch" icon={<Trash2 size={14} />} variant="ghost" size="sm" onClick={() => onChange(step.routes.filter((_, other) => other !== index))} />
      </div>;
    })}
    <div className="ov-actions">
      <Button size="sm" variant="ghost" icon={<GitBranch size={14} />} label={step.routes.length ? 'Add another branch' : 'Branch by form answer'} isDisabled={!others.length || step.routes.length >= 8}
        onClick={() => onChange([...step.routes, { field: fields?.[0]?.key ?? '', operator: 'equals', value: '', toUid: others.at(-1)?.uid ?? '' }])} />
      {step.routes.length ? <Text type="supporting" color="secondary">Otherwise visitors continue to the next step.</Text> : null}
      {!fields ? <Text type="supporting" color="secondary">Save the funnel to load this page&apos;s form fields.</Text> : null}
    </div>
  </div>;
}


function SortableStep({ step, index, steps, fields, pages, onChange, onRemove }: { step: DraftStep; index: number; steps: DraftStep[]; fields: FunnelStep['fields'] | undefined; pages: LandingPageSummary[]; onChange: (step: DraftStep) => void; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: step.uid });
  const page = pages.find(item => item.id === step.pageId);
  return <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={'ov-sites-step' + (isDragging ? ' ov-sites-field is-dragging' : '')}>
    <button type="button" className="ov-sites-handle" aria-label={`Reorder step ${index + 1}`} {...attributes} {...listeners}><GripVertical size={16} aria-hidden="true" /></button>
    <span className="ov-sites-step-num" aria-hidden="true">{index + 1}</span>
    <TextInput label={`Step ${index + 1} name`} value={step.name} onChange={name => onChange({ ...step, name })} />
    <Selector label="Page" placeholder="Choose a page" value={step.pageId} onChange={pageId => onChange({ ...step, pageId: pageId ?? '', name: step.name || pages.find(item => item.id === pageId)?.name || '' })}
      options={pages.map(item => ({ value: item.id, label: item.name, description: item.status === 'published' ? item.url : 'Draft: publish it before activating' }))}
      status={page && page.status !== 'published' ? { type: 'warning', message: 'Not published yet' } : undefined} />
    <IconButton label={`Remove step ${index + 1}`} icon={<Trash2 size={15} />} variant="ghost" onClick={onRemove} />
    <BranchEditor step={step} steps={steps} fields={fields} onChange={routes => onChange({ ...step, routes })} />
  </li>;
}

export function FunnelEditor({ id }: { id: string }) {
  const router = useRouter();
  const loaded = useResource<FunnelDetail>(`/sites/funnels/${id}`);
  const pages = useResource<{ items: LandingPageSummary[] }>('/sites/pages');
  const [days, setDays] = useState('30');
  const stats = useResource<FunnelStats>(`/sites/funnels/${id}/stats?days=${days}`);
  const [name, setName] = useState('');
  const [steps, setSteps] = useState<DraftStep[]>([]);
  const [state, setState] = useState<{ busy?: boolean; error?: string; notice?: string }>({});
  const [archive, setArchive] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const [synced, setSynced] = useState<FunnelDetail>();
  if (loaded.data && loaded.data !== synced) {
    setSynced(loaded.data);
    setName(loaded.data.name);
    setSteps(loaded.data.steps.map(step => ({ uid: step.id, name: step.name, pageId: step.pageId,
      routes: step.routes.map(route => ({ field: route.field, operator: route.operator, value: route.value, toUid: loaded.data!.steps.find(other => other.position === route.toPosition)?.id ?? '' })) })));
  }
  if (!loaded.data) return <div className="ov-stack"><PageHeader title="Funnel" back={{ href: '/sites/funnels', label: 'Funnels' }} /><AsyncState loading={loaded.loading} error={loaded.error} retry={loaded.refresh} /></div>;
  const funnel = loaded.data;
  const toRoutes = (step: DraftStep) => step.routes.filter(route => route.toUid && route.field).map(route => ({ field: route.field, operator: route.operator, value: route.value ?? '', toPosition: steps.findIndex(other => other.uid === route.toUid) })).filter(route => route.toPosition >= 0);
  const dirty = name !== funnel.name || JSON.stringify(steps.map(step => [step.name, step.pageId, toRoutes(step)])) !== JSON.stringify(funnel.steps.map(step => [step.name, step.pageId, step.routes.map(route => ({ field: route.field, operator: route.operator, value: route.value ?? '', toPosition: route.toPosition }))]));
  const fieldsByPage = new Map(funnel.steps.map(step => [step.pageId, step.fields]));
  const save = async (status?: FunnelDetail['status']) => {
    setState({ busy: true });
    try {
      if (steps.some(step => !step.pageId)) throw new Error('Choose a page for every step, or remove the empty step.');
      await api<FunnelDetail>(`/sites/funnels/${id}`, 'PATCH', { name: name.trim(), steps: steps.map(step => ({ name: step.name, pageId: step.pageId, routes: toRoutes(step) })), ...(status ? { status } : {}) });
      loaded.refresh();
      stats.refresh();
      setState({ notice: status === 'active' ? 'Funnel activated. Steps now record visits and form submissions continue to the next step.' : status === 'draft' ? 'Funnel paused.' : 'Funnel saved.' });
    } catch (cause) {
      setState({ error: message(cause) });
    }
  };
  const max = Math.max(1, ...(stats.data?.steps.map(step => step.visitors) ?? [1]));

  return <div className="ov-stack ov-wide">
    <PageHeader title={funnel.name} back={{ href: '/sites/funnels', label: 'Funnels' }} description={funnel.description || `${funnel.steps.length} steps`}
      actions={<>
        <StatusBadge label={funnel.status === 'active' ? 'Active' : funnel.status === 'draft' ? 'Draft' : 'Archived'} tone={tone(funnel.status)} />
        <Button label="Archive" variant="ghost" onClick={() => setArchive(true)} />
        <Button label="Save" variant="secondary" isDisabled={!dirty} isLoading={state.busy} onClick={() => void save()} />
        {funnel.status === 'active' ? <Button label="Pause" variant="secondary" onClick={() => void save('draft')} /> : <Button label="Activate funnel" variant="primary" isLoading={state.busy} onClick={() => void save('active')} />}
      </>} />
    {state.error ? <Banner status="error" title={state.error} /> : null}
    {state.notice ? <Banner status="success" title={state.notice} /> : null}
    <div className="ov-grid">
      <Panel title="Steps" description="Drag to reorder. A form on a step sends visitors to the next step; buttons can link to it too.">
        <div className="ov-stack-sm">
          <TextInput label="Funnel name" value={name} onChange={setName} />
          {!pages.data ? <AsyncState loading={pages.loading} error={pages.error} /> : steps.length ? <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event: DragEndEvent) => {
            const { active, over } = event;
            if (!over || active.id === over.id) return;
            setSteps(current => arrayMove(current, current.findIndex(step => step.uid === active.id), current.findIndex(step => step.uid === over.id)));
          }}>
            <SortableContext items={steps.map(step => step.uid)} strategy={verticalListSortingStrategy}>
              <ul className="ov-sites-steps">
                {steps.map((step, index) => <SortableStep key={step.uid} step={step} index={index} steps={steps} fields={fieldsByPage.get(step.pageId)} pages={pages.data!.items}
                  onChange={next => setSteps(current => current.map(item => item.uid === step.uid ? next : item))}
                  onRemove={() => setSteps(current => current.filter(item => item.uid !== step.uid))} />)}
              </ul>
            </SortableContext>
          </DndContext> : <Empty title="No steps yet" description="Add at least two pages, in the order visitors should see them." />}
          <div className="ov-actions">
            <Button label="Add step" variant="secondary" icon={<Plus size={15} />} isDisabled={steps.length >= 20} onClick={() => setSteps(current => [...current, { uid: `new-${Date.now()}`, name: '', pageId: '', routes: [] }])} />
            <Link href="/sites?create=page" as={NextLink}>Create a new page</Link>
          </div>
          {funnel.steps.length ? <Text type="supporting" color="secondary">Entry address: <Link href={absoluteUrl(funnel.steps[0].url)} target="_blank"><span className="ov-actions">{funnel.steps[0].url}<ExternalLink size={12} aria-hidden="true" /></span></Link></Text> : null}
        </div>
      </Panel>
      <Panel title="Conversion" action={<Selector label="Period" isLabelHidden width={150} value={days} onChange={value => setDays(value ?? '30')} options={[{ value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }, { value: '90', label: 'Last 90 days' }]} />}>
        {!stats.data ? <AsyncState loading={stats.loading} error={stats.error} retry={stats.refresh} /> : <div className="ov-stack-sm">
          {stats.data.provenance === 'preview_sample' ? <StatusBadge label="Preview sample data" tone="info" /> : null}
          <div className="ov-grid">
            <Metric label="Entered" value={stats.data.entered} flat hint="Unique visitors on step 1" />
            <Metric label="Completed" value={stats.data.completed} flat hint={`Completion rate ${percent(stats.data.completionRate)}`} />
          </div>
          {stats.data.steps.length ? <div className="ov-sites-funnel-chart" role="list" aria-label="Visitors per step">
            {stats.data.steps.map((step, index) => <div key={step.position} className="ov-sites-funnel-row" role="listitem">
              <span><strong>{index + 1}.</strong> {step.name}</span>
              <div className="ov-sites-funnel-bar"><span style={{ width: `${Math.max(4, (step.visitors / max) * 100)}%` }}>{number(step.visitors)}</span></div>
              <span className="ov-sites-funnel-drop">{index === 0 ? 'Entry step' : `${percent(step.conversionFromPrevious)} continued · ${number(step.dropOff)} dropped off`}</span>
              {step.branches.length ? <ul className="ov-sites-branch-stats">{step.branches.map(branch => <li key={branch.label + branch.toPosition}>
                <GitBranch size={13} aria-hidden="true" /> {branch.label} → {branch.toName}: <strong>{number(branch.visitors)}</strong> took this path, {number(branch.reached)} arrived ({percent(branch.conversion)})
              </li>)}</ul> : null}
            </div>)}
          </div> : <Empty title="No steps to measure yet" />}
          {funnel.status !== 'active' ? <Banner status="info" title="Activate the funnel to record step visits." /> : null}
        </div>}
      </Panel>
    </div>
    {archive ? <ConfirmDialog title="Archive this funnel?" description="Its pages stay published; they simply stop counting as funnel steps." actionLabel="Archive" onClose={() => setArchive(false)}
      onConfirm={async () => { try { await api(`/sites/funnels/${id}`, 'DELETE'); router.push('/sites/funnels'); } catch (cause) { setArchive(false); setState({ error: message(cause) }); } }} /> : null}
  </div>;
}
