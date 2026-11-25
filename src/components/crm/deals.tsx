'use client';

// Sales › Deals: Kanban board (dnd-kit; drag between stages and within a column, keyboard dragging, optimistic with
// rollback) and a table view with saved views, plus the deal page.
import '@/styles/crm.css';
import {
  DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor, closestCorners, useDroppable, useSensor, useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent, DragOverEvent, DragStartEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Download, Filter, Flame, LayoutGrid, MoreHorizontal, Plus, Rows3, Trophy, XCircle } from 'lucide-react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { DateInput } from '@astryxdesign/core/DateInput';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { MultiSelector } from '@astryxdesign/core/MultiSelector';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Selector } from '@astryxdesign/core/Selector';
import { Table, pixel } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useToast } from '@astryxdesign/core/Toast';
import type { BoardColumn, Deal, DealBoard, DealDetail, DealPage, DealSortKey, Pipeline, SalesFilterOptions } from '@/contracts/crm';
import type { SavedView } from '@/contracts/platform';
import { api, message, saveFile, useAction, useResource } from '../client';
import { AsyncState, ConfirmDialog, Empty, Feedback, FilterBar, FormActions, Modal, PageHeader, Pager, Panel, StatusBadge } from '../ui';
import {
  ActivityLogger, CompanyPicker, ContactPicker, DealDrawer, EmailDrawer, Estimate, Kv, OwnerChip, OwnerSelect, SourceBadge, TaskDrawer, TaskLine,
  Timeline, companyOption, contactOption, followUpDefaults, money, shortDate, statusLabel, statusTone, useTeam,
} from './common';
import type { TaskDefaults } from './common';

type Filters = { q: string; ownerId: string; status: string; closeFrom: string; closeTo: string; minAmount: string; maxAmount: string; campaignId: string };
const emptyFilters: Filters = { q: '', ownerId: '', status: 'open', closeFrom: '', closeTo: '', minAmount: '', maxAmount: '', campaignId: '' };

function filterQuery(filters: Filters, pipelineId?: string) {
  const params = new URLSearchParams();
  if (pipelineId) params.set('pipelineId', pipelineId);
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  return params;
}

/* ── Board ────────────────────────────────────────────────────────────── */

type Columns = Record<string, Deal[]>;

function DealCard({ deal, overlay, onClose }: { deal: Deal; overlay?: boolean; onClose?: (deal: Deal, outcome: 'won' | 'lost') => void }) {
  const sortable = useSortable({ id: deal.id, data: { stageId: deal.stageId } });
  const style = overlay ? undefined : { transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition };
  const who = [deal.companyName, deal.contactName].filter(Boolean).join(' · ');
  return <div ref={overlay ? undefined : node => { sortable.setNodeRef(node); sortable.setActivatorNodeRef(node); }}
    style={style} className={`ov-crm-card ${sortable.isDragging && !overlay ? 'ov-crm-card--dragging' : ''} ${overlay ? 'ov-crm-card--overlay' : ''}`}
    {...(overlay ? {} : sortable.attributes)} {...(overlay ? {} : sortable.listeners)}
    aria-roledescription="Deal card. Press space to pick up, arrow keys to move, space to drop."
    aria-label={`${deal.name}, ${money(deal.amount, deal.currency)}, ${deal.stageName}`}>
    <div className="ov-crm-card-top">
      <NextLink href={`/sales/deals/${deal.id}`} className="ov-crm-card-name" draggable={false}>{deal.name}</NextLink>
      {onClose && !overlay ? <div onMouseDown={event => event.stopPropagation()} onTouchStart={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
        <DropdownMenu button={{ label: `Actions for ${deal.name}`, isIconOnly: true, icon: <MoreHorizontal size={16} />, variant: 'ghost', size: 'sm' }} hasChevron={false} items={[
          { label: 'Open deal', href: `/sales/deals/${deal.id}` },
          { label: 'Mark as won', icon: <Trophy size={14} />, onClick: () => onClose(deal, 'won') },
          { label: 'Mark as lost', icon: <XCircle size={14} />, onClick: () => onClose(deal, 'lost') },
        ]} />
      </div> : null}
    </div>
    <span className="ov-crm-card-value">{money(deal.amount, deal.currency)}</span>
    {who ? <span className="ov-crm-card-sub" title={who}>{who}</span> : null}
    <div className="ov-crm-card-foot">
      <span>
        {deal.ownerName ? <Avatar name={deal.ownerName} size={20} tooltip={`Owner: ${deal.ownerName}`} /> : <Text type="supporting" color="secondary">Unassigned</Text>}
        {deal.expectedCloseDate ? <span className={deal.overdue ? 'ov-crm-overdue' : undefined} title="Expected close date">{deal.overdue ? 'Overdue · ' : ''}{shortDate(deal.expectedCloseDate)}</span> : null}
      </span>
      <span className={deal.rotting ? 'ov-crm-rot' : undefined} title={deal.rotting ? 'Longer in this stage than its rotting limit' : 'Days in this stage'}>
        {deal.rotting ? <Flame size={12} aria-hidden="true" /> : null}{deal.daysInStage}d in stage
      </span>
    </div>
    {deal.source && deal.source !== 'manual' ? <div><SourceBadge source={deal.source} label={deal.sourceLabel} /></div> : null}
  </div>;
}

function Column({ column, deals, currency, onClose }: { column: BoardColumn; deals: Deal[]; currency: string; onClose: (deal: Deal, outcome: 'won' | 'lost') => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'column:' + column.stage.id, data: { stageId: column.stage.id } });
  const total = deals.reduce((sum, deal) => sum + deal.amount, 0);
  const weighted = deals.reduce((sum, deal) => sum + deal.weightedAmount, 0);
  return <section className={`ov-crm-column ${isOver ? 'ov-crm-column--over' : ''}`} aria-label={`${column.stage.name}: ${deals.length} deals`}>
    <header className="ov-crm-column-head">
      <div className="ov-crm-column-title"><span>{column.stage.name}</span><span>{deals.length}</span></div>
      <div className="ov-crm-column-meta">
        <span><strong>{money(total, currency, true)}</strong> total</span>
        <span title={`Each deal's value × its win probability (stage default ${column.stage.probability}%). An estimate, not revenue.`}>≈ {money(weighted, currency, true)} weighted</span>
      </div>
    </header>
    <div ref={setNodeRef} className="ov-crm-cards">
      <SortableContext items={deals.map(deal => deal.id)} strategy={verticalListSortingStrategy}>
        {deals.map(deal => <DealCard key={deal.id} deal={deal} onClose={onClose} />)}
      </SortableContext>
      {!deals.length ? <div className="ov-crm-empty-col">Drop a deal here</div> : null}
    </div>
  </section>;
}

function OutcomeZone({ outcome }: { outcome: 'won' | 'lost' }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'outcome:' + outcome });
  return <div ref={setNodeRef} className={`ov-crm-dropzone ov-crm-dropzone--${outcome} ${isOver ? 'ov-crm-dropzone--over' : ''}`}>
    <span>{outcome === 'won' ? 'Drop to mark won' : 'Drop to mark lost'}</span>
  </div>;
}

function Board({ board, onChanged, onNotice }: { board: DealBoard; onChanged: () => void; onNotice: (text: string) => void }) {
  const toast = useToast();
  const initial = useMemo(() => Object.fromEntries(board.columns.map(column => [column.stage.id, column.deals])) as Columns, [board]);
  const [columns, setColumns] = useState<Columns>(initial);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [lost, setLost] = useState<Deal | null>(null);
  const snapshot = useRef<Columns>(initial);
  const [synced, setSynced] = useState(initial);
  if (synced !== initial) { setSynced(initial); setColumns(initial); }
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // Touch waits for a short press so a swipe still scrolls the board sideways.
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const canClose = board.pipeline.stages.some(stage => stage.outcome === 'won');
  const find = (id: string) => Object.keys(columns).find(stageId => columns[stageId].some(deal => deal.id === id));
  const active = activeId ? Object.values(columns).flat().find(deal => deal.id === activeId) : undefined;

  function fail(error: unknown) {
    setColumns(snapshot.current);
    toast({ body: `The deal was not moved: ${message(error)}`, type: 'error' });
  }

  async function close(deal: Deal, outcome: 'won' | 'lost', reason?: string) {
    snapshot.current = columns;
    setColumns(current => Object.fromEntries(Object.entries(current).map(([id, deals]) => [id, deals.filter(item => item.id !== deal.id)])));
    try {
      await api(`/sales/deals/${deal.id}/close`, 'POST', { outcome, lostReason: reason });
      onNotice(outcome === 'won' ? `${deal.name} marked as won.` : `${deal.name} marked as lost.`);
      onChanged();
    } catch (error) {
      fail(error);
    }
  }

  function onDragStart(event: DragStartEvent) {
    snapshot.current = columns;
    setActiveId(String(event.active.id));
  }

  function onDragOver(event: DragOverEvent) {
    const id = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    if (!overId || overId.startsWith('outcome:')) return;
    const from = find(id);
    const to = overId.startsWith('column:') ? overId.slice(7) : find(overId);
    if (!from || !to || from === to) return;
    setColumns(current => {
      const moving = current[from].find(deal => deal.id === id);
      if (!moving) return current;
      const target = current[to];
      const index = overId.startsWith('column:') ? target.length : Math.max(0, target.findIndex(deal => deal.id === overId));
      const stage = board.pipeline.stages.find(item => item.id === to);
      const moved = { ...moving, stageId: to, stageName: stage?.name ?? moving.stageName };
      return { ...current, [from]: current[from].filter(deal => deal.id !== id), [to]: [...target.slice(0, index), moved, ...target.slice(index)] };
    });
  }

  async function onDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const id = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    const deal = Object.values(snapshot.current).flat().find(item => item.id === id);
    if (!overId || !deal) { setColumns(snapshot.current); return; }
    if (overId.startsWith('outcome:')) {
      setColumns(snapshot.current);
      const outcome = overId.slice(8) as 'won' | 'lost';
      if (outcome === 'lost') setLost(deal);
      else await close(deal, 'won');
      return;
    }
    const stageId = find(id);
    if (!stageId) return;
    let list = columns[stageId];
    const from = list.findIndex(item => item.id === id);
    const to = overId.startsWith('column:') ? from : list.findIndex(item => item.id === overId);
    if (to >= 0 && to !== from) {
      const next = [...list];
      const [moving] = next.splice(from, 1);
      next.splice(to, 0, moving);
      list = next;
      setColumns(current => ({ ...current, [stageId]: next }));
    }
    const index = list.findIndex(item => item.id === id);
    const original = snapshot.current[deal.stageId] ?? [];
    if (stageId === deal.stageId && original.findIndex(item => item.id === id) === index) return;
    try {
      await api(`/sales/deals/${id}/move`, 'POST', { stageId, previousId: list[index - 1]?.id ?? null, nextId: list[index + 1]?.id ?? null });
      if (stageId !== deal.stageId) onNotice(`${deal.name} moved to ${board.pipeline.stages.find(stage => stage.id === stageId)?.name}.`);
      onChanged();
    } catch (error) {
      fail(error);
    }
  }

  return <>
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={event => void onDragEnd(event)}
      onDragCancel={() => { setActiveId(null); setColumns(snapshot.current); }}
      accessibility={{ screenReaderInstructions: { draggable: 'To pick up a deal, press space or enter. Use the arrow keys to move it between stages or up and down a column. Press space or enter again to drop it, or escape to cancel.' } }}>
      <div className="ov-crm-board" role="region" aria-label={`${board.pipeline.name} board`}>
        {board.columns.map(column => <Column key={column.stage.id} column={column} deals={columns[column.stage.id] ?? []} currency={board.pipeline.currency}
          onClose={canClose ? (deal, outcome) => outcome === 'lost' ? setLost(deal) : void close(deal, 'won') : () => onNotice('Add Won and Lost stages to this pipeline in Sales › Pipelines first.')} />)}
      </div>
      {activeId && canClose ? <div className="ov-crm-dropzones"><OutcomeZone outcome="won" /><OutcomeZone outcome="lost" /></div> : null}
      <DragOverlay>{active ? <DealCard deal={active} overlay /> : null}</DragOverlay>
    </DndContext>
    {lost ? <LostDialog deal={lost} onClose={() => setLost(null)} onConfirm={reason => { setLost(null); void close(lost, 'lost', reason); }} /> : null}
  </>;
}

export function LostDialog({ deal, onClose, onConfirm }: { deal: Deal; onClose: () => void; onConfirm: (reason: string) => void }) {
  const options = useResource<SalesFilterOptions>('/sales/filter-options');
  const [reason, setReason] = useState('');
  return <Modal title={`Mark “${deal.name}” as lost`} onClose={onClose}>
    <form className="ov-stack-sm" onSubmit={event => { event.preventDefault(); onConfirm(reason.trim()); }}>
      <TextInput label="Lost reason" isOptional value={reason} onChange={setReason} placeholder="Chose a competitor, no budget, timing…" hasAutoFocus />
      {options.data?.lostReasons.length ? <div className="ov-actions">{options.data.lostReasons.slice(0, 6).map(item =>
        <Button key={item} size="sm" variant="secondary" label={item} onClick={() => setReason(item)} />)}</div> : null}
      <FormActions>
        <Button label="Cancel" onClick={onClose} />
        <Button type="submit" variant="destructive" label="Mark as lost" />
      </FormActions>
    </form>
  </Modal>;
}

/* ── Table ────────────────────────────────────────────────────────────── */

const tableColumns: { key: string; label: string; sort?: DealSortKey; render: (deal: Deal) => React.ReactNode }[] = [
  { key: 'stage', label: 'Stage', sort: 'stage', render: deal => deal.stageName },
  { key: 'amount', label: 'Value', sort: 'amount', render: deal => money(deal.amount, deal.currency) },
  { key: 'weighted', label: 'Weighted (estimate)', render: deal => money(deal.weightedAmount, deal.currency) },
  { key: 'probability', label: 'Probability', sort: 'probability', render: deal => `${deal.effectiveProbability}%` },
  { key: 'owner', label: 'Owner', sort: 'owner', render: deal => <OwnerChip name={deal.ownerName} /> },
  { key: 'contact', label: 'Contact', render: deal => deal.contactId ? <NextLink href={`/crm/contacts/${deal.contactId}`}>{deal.contactName || deal.contactEmail}</NextLink> : '—' },
  { key: 'company', label: 'Company', sort: 'company', render: deal => deal.companyId ? <NextLink href={`/crm/companies/${deal.companyId}`}>{deal.companyName}</NextLink> : deal.companyName || '—' },
  { key: 'close', label: 'Expected close', sort: 'expectedCloseDate', render: deal => <span className={deal.overdue ? 'ov-crm-overdue' : undefined}>{shortDate(deal.expectedCloseDate)}</span> },
  { key: 'status', label: 'Status', render: deal => <StatusBadge label={statusLabel[deal.status]} tone={statusTone[deal.status]} /> },
  { key: 'campaign', label: 'Campaign', render: deal => deal.campaignName || '—' },
  { key: 'source', label: 'Source', render: deal => deal.sourceLabel },
  { key: 'created', label: 'Created', sort: 'createdAt', render: deal => shortDate(deal.createdAt) },
  { key: 'updated', label: 'Updated', sort: 'updatedAt', render: deal => shortDate(deal.updatedAt) },
];
const defaultColumns = ['stage', 'amount', 'owner', 'company', 'close', 'status'];

function DealTable({ pipelineId, filters, pipelines, onApplyFilters }: { pipelineId: string; filters: Filters; pipelines: Pipeline[]; onApplyFilters: (filters: Filters) => void }) {
  const { members } = useTeam();
  const action = useAction();
  const [columns, setColumns] = useState(defaultColumns);
  const [sort, setSort] = useState<{ field: DealSortKey; direction: 'asc' | 'desc' }>({ field: 'updatedAt', direction: 'desc' });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [viewId, setViewId] = useState<string | null>(null);
  const [viewName, setViewName] = useState('');
  const params = filterQuery(filters, pipelineId);
  params.set('sort', sort.field); params.set('dir', sort.direction); params.set('page', String(page)); params.set('limit', '50');
  const deals = useResource<DealPage>(`/sales/deals?${params}`);
  const views = useResource<SavedView[]>('/platform/views?object=deals');
  const pipeline = pipelines.find(item => item.id === pipelineId);
  const pageIds = deals.data?.items.map(deal => deal.id) ?? [];
  const all = pageIds.length > 0 && pageIds.every(id => selected.includes(id));
  const bulk = (body: Record<string, unknown>, done: string) => void action.run(async () => {
    const result = await api<{ updated: number; failed: { error: string }[] }>('/sales/deals/bulk', 'POST', { ids: selected, ...body });
    setSelected([]);
    deals.refresh();
    if (result.failed.length) throw new Error(`${result.updated} updated; ${result.failed.length} could not be changed: ${result.failed[0].error}`);
  }, done);

  return <Panel title="Deals" description={deals.data ? `${deals.data.total} deal${deals.data.total === 1 ? '' : 's'}` : undefined}
    action={<div className="ov-actions">
      <MultiSelector label="Columns" isLabelHidden width={220} placeholder="Columns" value={columns} onChange={next => setColumns(next.length ? next : defaultColumns)}
        options={tableColumns.map(column => ({ value: column.key, label: column.label }))} />
      <Selector label="Sort by" isLabelHidden width={190} value={`${sort.field}:${sort.direction}`} onChange={value => {
        const [field, direction] = (value ?? 'updatedAt:desc').split(':');
        setSort({ field: field as DealSortKey, direction: direction === 'asc' ? 'asc' : 'desc' });
      }} options={tableColumns.filter(column => column.sort).flatMap(column => [
        { value: `${column.sort}:desc`, label: `${column.label} ↓` }, { value: `${column.sort}:asc`, label: `${column.label} ↑` },
      ]).concat([{ value: 'updatedAt:desc', label: 'Recently updated' }, { value: 'name:asc', label: 'Name A–Z' }])} />
    </div>}>
    <div className="ov-toolbar">
      <div className="ov-actions">
        <Selector label="Saved views" isLabelHidden width={220} placeholder="Saved views" hasClear value={viewId}
          options={(views.data ?? []).map(view => ({ value: view.id, label: view.name }))}
          onChange={value => {
            setViewId(value);
            const view = views.data?.find(item => item.id === value);
            if (!view) return;
            if (view.columns.length) setColumns(view.columns);
            if (view.sort) setSort({ field: view.sort.field as DealSortKey, direction: view.sort.direction });
            onApplyFilters({ ...emptyFilters, ...Object.fromEntries(view.filters.map(filter => [filter.field, String(filter.value ?? '')])) });
            setPage(1);
          }} />
        <TextInput label="View name" isLabelHidden placeholder="Name this view" width={170} value={viewName} onChange={setViewName} />
        <Button size="sm" label="Save view" isDisabled={!viewName.trim()} isLoading={action.busy} onClick={() => void action.run(async () => {
          const saved = await api<SavedView>('/platform/views', 'POST', {
            object: 'deals', name: viewName.trim(), columns, sort,
            filters: Object.entries(filters).filter(([, value]) => value).map(([field, value]) => ({ field, operator: 'eq', value })),
          });
          setViewName(''); setViewId(saved.id); views.refresh();
        }, 'View saved for the team.')} />
        {viewId ? <Button size="sm" variant="ghost" label="Delete view" onClick={() => void action.run(async () => { await api(`/platform/views/${viewId}`, 'DELETE'); setViewId(null); views.refresh(); })} /> : null}
      </div>
    </div>
    {selected.length ? <div className="ov-filter-bar" role="region" aria-label="Bulk deal actions">
      <Text weight="semibold">{selected.length} selected</Text>
      <Selector label="Set owner" isLabelHidden width={180} placeholder="Set owner…" value={null as unknown as string}
        options={[{ value: 'none', label: 'Unassigned' }, ...members.map(member => ({ value: member.id, label: member.name }))]}
        onChange={value => value && bulk({ ownerId: value === 'none' ? null : value }, 'Owner updated.')} />
      <Selector label="Move to stage" isLabelHidden width={180} placeholder="Move to stage…" value={null as unknown as string}
        options={(pipeline?.stages ?? []).filter(stage => stage.outcome === 'open').map(stage => ({ value: stage.id, label: stage.name }))}
        onChange={value => value && bulk({ stageId: value }, 'Deals moved.')} />
      <Button size="sm" label="Mark won" onClick={() => bulk({ status: 'won' }, 'Deals marked as won.')} />
      <Button size="sm" label="Mark lost" onClick={() => bulk({ status: 'lost' }, 'Deals marked as lost.')} />
      <Button size="sm" variant="ghost" label="Archive" onClick={() => bulk({ archive: true }, 'Deals archived.')} />
      <Button size="sm" variant="ghost" label="Clear selection" onClick={() => setSelected([])} />
    </div> : null}
    <Feedback error={action.error} />
    {!deals.data ? <AsyncState loading={deals.loading} error={deals.error} retry={deals.refresh} /> : <>
      <Table data={deals.data.items} idKey="id" hasHover
        emptyState={<Empty title="No deals match" description="Change the filters or create a deal." />}
        columns={[
          { key: 'select', width: pixel(44), header: <CheckboxInput label="Select all deals on this page" isLabelHidden size="sm" value={all ? true : selected.length ? 'indeterminate' : false}
            onChange={checked => setSelected(checked ? pageIds : [])} />,
            renderCell: deal => <CheckboxInput label={`Select ${deal.name}`} isLabelHidden size="sm" value={selected.includes(deal.id)}
              onChange={checked => setSelected(current => checked ? [...current, deal.id] : current.filter(id => id !== deal.id))} /> },
          { key: 'name', header: 'Deal', renderCell: deal => <span className="ov-cell"><NextLink href={`/sales/deals/${deal.id}`}><Text weight="medium">{deal.name}</Text></NextLink>
            {deal.source && deal.source !== 'manual' ? <Text type="supporting" color="secondary">{deal.sourceLabel}</Text> : null}</span> },
          ...tableColumns.filter(column => columns.includes(column.key)).map(column => ({ key: column.key, header: column.label, renderCell: column.render })),
        ]} />
      <Pager page={deals.data.page} limit={deals.data.limit} total={deals.data.total} onPage={setPage} />
    </>}
  </Panel>;
}

/* ── Page ─────────────────────────────────────────────────────────────── */

export function SalesDeals({ initialCreate = false, initialView = 'board' }: { initialCreate?: boolean; initialView?: string }) {
  const router = useRouter();
  const pipelines = useResource<{ items: Pipeline[] }>('/sales/pipelines');
  const options = useResource<SalesFilterOptions>('/sales/filter-options');
  const { members } = useTeam();
  const action = useAction();
  const [pipelineId, setPipelineId] = useState('');
  const [view, setView] = useState(initialView === 'table' ? 'table' : 'board');
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [creating, setCreating] = useState(initialCreate);
  const [notice, setNotice] = useState('');
  const items = pipelines.data?.items ?? [];
  const current = pipelineId || items.find(item => item.isDefault)?.id || items[0]?.id || '';
  const board = useResource<DealBoard>(view === 'board' && current ? `/sales/board?${filterQuery(filters, current)}` : null);
  const set = (patch: Partial<Filters>) => setFilters(value => ({ ...value, ...patch }));
  const memberName = (id: string) => id === 'me' ? 'Me' : id === 'none' ? 'Unassigned' : members.find(member => member.id === id)?.name ?? 'Owner';
  const active = [
    ...(filters.q ? [{ key: 'q', label: `Search: ${filters.q}` }] : []),
    ...(filters.ownerId ? [{ key: 'ownerId', label: `Owner: ${memberName(filters.ownerId)}` }] : []),
    ...(filters.status !== 'open' ? [{ key: 'status', label: `Status: ${filters.status || 'open'}` }] : []),
    ...(filters.closeFrom ? [{ key: 'closeFrom', label: `Closing from ${shortDate(filters.closeFrom)}` }] : []),
    ...(filters.closeTo ? [{ key: 'closeTo', label: `Closing by ${shortDate(filters.closeTo)}` }] : []),
    ...(filters.minAmount ? [{ key: 'minAmount', label: `Value ≥ ${filters.minAmount}` }] : []),
    ...(filters.maxAmount ? [{ key: 'maxAmount', label: `Value ≤ ${filters.maxAmount}` }] : []),
    ...(filters.campaignId ? [{ key: 'campaignId', label: `Campaign: ${options.data?.campaigns.find(item => item.id === filters.campaignId)?.name ?? 'selected'}` }] : []),
  ];
  const totals = board.data?.totals;
  const currency = items.find(item => item.id === current)?.currency ?? 'GBP';

  return <div className="ov-stack ov-wide">
    <PageHeader title="Deals" description="Every opportunity in your pipelines. Drag cards to move them between stages."
      actions={<>
        <Selector label="Pipeline" isLabelHidden width={200} value={current} onChange={value => setPipelineId(value ?? '')}
          options={items.map(item => ({ value: item.id, label: item.name }))} isLoading={pipelines.loading} />
        <SegmentedControl label="Deals view" value={view} onChange={value => { setView(value); router.replace(value === 'table' ? '/sales?view=table' : '/sales', { scroll: false }); }}>
          <SegmentedControlItem value="board" label="Board" icon={<LayoutGrid size={14} />} />
          <SegmentedControlItem value="table" label="Table" icon={<Rows3 size={14} />} />
        </SegmentedControl>
        <Button label="Export CSV" icon={<Download size={15} />} isLoading={action.busy}
          onClick={() => void action.run(async () => saveFile(await api<string>(`/sales/deals/export?${filterQuery(filters, current)}`), 'ovelio-deals.csv', 'text/csv'))} />
        <Button label="New deal" variant="primary" icon={<Plus size={16} />} isDisabled={!items.length} onClick={() => setCreating(true)} />
      </>} />
    <AsyncState loading={pipelines.loading && !pipelines.data} error={pipelines.error} retry={pipelines.refresh} />
    <Feedback error={action.error} notice={notice} />
    <div className="ov-toolbar">
      <form onSubmit={event => { event.preventDefault(); set({ q: search.trim() }); }}>
        <TextInput label="Search deals" isLabelHidden type="search" startIcon="search" placeholder="Deal, person or company" width={260} value={search} onChange={setSearch} />
      </form>
      <div className="ov-actions">
        <Selector label="Owner" isLabelHidden width={170} value={filters.ownerId || 'all'} onChange={value => set({ ownerId: value && value !== 'all' ? value : '' })}
          options={[{ value: 'all', label: 'All owners' }, { value: 'me', label: 'My deals' }, { value: 'none', label: 'Unassigned' }, ...members.map(member => ({ value: member.id, label: member.name }))]} />
        <Selector label="Status" isLabelHidden width={140} value={filters.status || 'open'} onChange={value => set({ status: value || 'open' })}
          options={[{ value: 'open', label: 'Open deals' }, { value: 'won', label: 'Won' }, { value: 'lost', label: 'Lost' }, { value: 'all', label: 'All deals' }]} />
        <Button label="Filters" icon={<Filter size={15} />} variant={showFilters ? 'secondary' : 'ghost'} onClick={() => setShowFilters(value => !value)} />
      </div>
    </div>
    {showFilters ? <div className="ov-crm-fields">
      <DateInput label="Expected close from" value={(filters.closeFrom || undefined) as never} hasClear onChange={value => set({ closeFrom: value ?? '' })} />
      <DateInput label="Expected close to" value={(filters.closeTo || undefined) as never} hasClear onChange={value => set({ closeTo: value ?? '' })} />
      <NumberInput label="Minimum value" min={0} value={filters.minAmount ? Number(filters.minAmount) : null} onChange={value => set({ minAmount: value == null ? '' : String(value) })} />
      <NumberInput label="Maximum value" min={0} value={filters.maxAmount ? Number(filters.maxAmount) : null} onChange={value => set({ maxAmount: value == null ? '' : String(value) })} />
      <Selector label="Campaign" hasClear placeholder="Any campaign" value={filters.campaignId || null} onChange={value => set({ campaignId: value ?? '' })}
        options={(options.data?.campaigns ?? []).map(item => ({ value: item.id, label: item.name }))} emptyText="No marketing campaigns yet." />
    </div> : null}
    <FilterBar items={active} onClear={() => { setFilters(emptyFilters); setSearch(''); }}
      onRemove={key => { set({ [key]: key === 'status' ? 'open' : '' } as Partial<Filters>); if (key === 'q') setSearch(''); }} />
    {view === 'board' ? <>
      {totals ? <div className="ov-crm-summary" role="status">
        <span><strong>{totals.count}</strong> deals</span>
        <span><strong>{money(totals.total, currency)}</strong> total value</span>
        <span><strong>{money(totals.weighted, currency)}</strong> weighted <Estimate /></span>
      </div> : null}
      {!board.data ? <AsyncState loading={board.loading} error={board.error} retry={board.refresh} />
        : board.data.columns.length ? <Board board={board.data} onChanged={board.refresh} onNotice={setNotice} />
          : <Panel><Empty title="This pipeline has no stages for these deals" action={<Button label="Edit pipelines" href="/sales/pipelines" />} /></Panel>}
    </> : current ? <DealTable pipelineId={current} filters={filters} pipelines={items} onApplyFilters={next => { setFilters(next); setSearch(next.q); }} /> : null}
    {creating && items.length ? <DealDrawer pipelines={items} defaults={{ pipelineId: current }} onClose={() => setCreating(false)}
      onCreated={deal => { setCreating(false); setNotice(`${deal.name} created.`); board.refresh(); router.replace(view === 'table' ? '/sales?view=table' : '/sales', { scroll: false }); }} /> : null}
  </div>;
}

/* ── Deal page ────────────────────────────────────────────────────────── */

export function DealView({ id }: { id: string }) {
  const router = useRouter();
  const detail = useResource<DealDetail>(`/sales/deals/${id}`);
  const options = useResource<SalesFilterOptions>('/sales/filter-options');
  const { members } = useTeam();
  const action = useAction();
  const [lost, setLost] = useState(false);
  const [taskDrawer, setTaskDrawer] = useState<TaskDefaults | null>(null);
  const [editingTask, setEditingTask] = useState<DealDetail['tasks'][number] | null>(null);
  const [emailTo, setEmailTo] = useState<{ id: number; name: string; email: string } | null>(null);
  const [archive, setArchive] = useState(false);
  const [person, setPerson] = useState<ReturnType<typeof contactOption>>(null);
  const [name, setName] = useState<string>();
  const data = detail.data;
  const deal = data?.deal;
  const patch = (body: Record<string, unknown>, done = 'Deal updated.') => void action.run(async () => { await api(`/sales/deals/${id}`, 'PATCH', body); detail.refresh(); }, done);
  const post = (path: string, body: unknown, done: string) => void action.run(async () => { await api(`/sales/deals/${id}/${path}`, 'POST', body); detail.refresh(); }, done);

  if (!data || !deal) return <div className="ov-stack">
    <PageHeader title="Deal" back={{ href: '/sales', label: 'Deals' }} />
    <Panel><AsyncState loading={detail.loading} error={detail.error} retry={detail.refresh} /></Panel>
  </div>;
  const openStages = data.pipeline.stages.filter(stage => stage.outcome === 'open');
  const currentIndex = openStages.findIndex(stage => stage.id === deal.stageId);
  const primary = data.people.find(item => item.primary);

  return <div className="ov-stack">
    <PageHeader back={{ href: '/sales', label: 'Deals' }} title={deal.name}
      description={[deal.pipelineName, deal.companyName, deal.sourceLabel !== 'Created by hand' ? deal.sourceLabel : ''].filter(Boolean).join(' · ')}
      actions={<>
        {primary ? <Button label="Email" onClick={() => setEmailTo({ id: primary.contactId, name: primary.name, email: primary.email })} /> : null}
        <Button label="Schedule follow-up" onClick={() => setTaskDrawer(followUpDefaults({ title: `Follow up: ${deal.name}`, dealId: deal.id, dealName: deal.name, contactId: deal.contactId, contactName: deal.contactName, companyId: deal.companyId, companyName: deal.companyName }))} />
        {deal.status === 'open' ? <>
          <Button label="Mark won" variant="primary" icon={<Trophy size={15} />} isLoading={action.busy} onClick={() => post('close', { outcome: 'won' }, 'Deal marked as won.')} />
          <Button label="Mark lost" variant="destructive" onClick={() => setLost(true)} />
        </> : <Button label="Reopen deal" onClick={() => post('reopen', {}, 'Deal reopened.')} />}
        <DropdownMenu button={{ label: 'More', variant: 'ghost' }} items={[
          { label: deal.archivedAt ? 'Restore deal' : 'Archive deal', onClick: () => setArchive(true) },
        ]} />
      </>} />
    <Feedback error={action.error} />
    <Panel>
      <div className="ov-stack-sm">
        <div className="ov-crm-headline">
          <span className="ov-crm-big">{money(deal.amount, deal.currency)}</span>
          <StatusBadge label={deal.status === 'open' ? deal.stageName : statusLabel[deal.status]} tone={statusTone[deal.status]} />
          {deal.status === 'open' ? <Text color="secondary">{deal.effectiveProbability}% probability · {money(deal.weightedAmount, deal.currency)} weighted <Estimate /></Text>
            : <Text color="secondary">Closed {shortDate(deal.closedAt)}{deal.lostReason ? ` · ${deal.lostReason}` : ''}</Text>}
          <SourceBadge source={deal.source} label={deal.sourceLabel} />
          {deal.archivedAt ? <StatusBadge label="Archived" tone="warning" /> : null}
        </div>
        <nav className="ov-crm-stages" aria-label="Pipeline stage">
          {openStages.map((stage, index) => <button key={stage.id} type="button" disabled={action.busy || stage.id === deal.stageId}
            className={`ov-crm-stage ${stage.id === deal.stageId ? 'ov-crm-stage--current' : deal.status === 'won' || (currentIndex >= 0 && index < currentIndex) ? 'ov-crm-stage--done' : ''}`}
            aria-current={stage.id === deal.stageId ? 'step' : undefined}
            title={`Move to ${stage.name} (${stage.probability}%)`} onClick={() => post('move', { stageId: stage.id }, `Moved to ${stage.name}.`)}>{stage.name}</button>)}
        </nav>
        <div className="ov-crm-fields">
          <TextInput label="Deal name" value={name ?? deal.name} onChange={setName} onBlur={() => { if (name !== undefined && name.trim() && name.trim() !== deal.name) patch({ name: name.trim() }); setName(undefined); }} />
          <NumberInput label={`Value (${deal.currency})`} min={0} value={deal.amount} onChange={value => { if (value != null && value !== deal.amount) patch({ amount: value }); }} />
          <NumberInput label="Probability %" min={0} max={100} isIntegerOnly value={deal.probability} placeholder={`Stage default`}
            description={deal.probability == null ? `Using the stage’s ${deal.effectiveProbability}%` : undefined}
            onChange={value => { if (value !== deal.probability) patch({ probability: value ?? null }); }} />
          <OwnerSelect value={deal.ownerId} onChange={value => patch({ ownerId: value }, 'Owner updated.')} members={members} />
          <DateInput label="Expected close" hasClear value={(deal.expectedCloseDate ?? undefined) as never} onChange={value => patch({ expectedCloseDate: value ?? null }, 'Close date updated.')} />
          <Selector label="Campaign" hasClear placeholder="None" value={deal.campaignId} onChange={value => patch({ campaignId: value ?? null }, 'Campaign updated.')}
            options={(options.data?.campaigns ?? []).map(item => ({ value: item.id, label: item.name }))} emptyText="No marketing campaigns yet." />
        </div>
      </div>
    </Panel>
    <div className="ov-crm-detail">
      <div className="ov-stack">
        <Panel title="Log activity">
          <ActivityLogger dealId={deal.id} contactId={deal.contactId} companyId={deal.companyId} onLogged={detail.refresh} />
        </Panel>
        <Panel title="Timeline" description="Activities, emails and changes from every part of OVELIO, newest first.">
          <Timeline items={data.timeline} />
        </Panel>
      </div>
      <div className="ov-crm-side">
        <Panel title="People">
          <div className="ov-stack-sm">
            {data.people.length ? data.people.map(item => <div key={item.contactId} className="ov-actions ov-actions--between">
              <span className="ov-cell"><NextLink href={`/crm/contacts/${item.contactId}`}>{item.name || item.email}</NextLink>
                <Text type="supporting" color="secondary">{[item.role, item.email].filter(Boolean).join(' · ')}</Text></span>
              {!item.primary ? <Button size="sm" variant="ghost" label="Remove" onClick={() => void action.run(async () => { await api(`/sales/deals/${id}/people/${item.contactId}`, 'DELETE'); detail.refresh(); })} /> : null}
            </div>) : <Text color="secondary">No people on this deal yet.</Text>}
            <ContactPicker label={deal.contactId ? 'Add a person' : 'Primary contact'} value={person} onChange={next => {
              setPerson(null);
              if (!next?.auxiliaryData) return;
              if (!deal.contactId) patch({ contactId: next.auxiliaryData.id }, 'Primary contact set.');
              else post('people', { contactId: next.auxiliaryData.id, role: '' }, 'Person added.');
            }} />
          </div>
        </Panel>
        <Panel title="Company">
          {deal.companyId ? <NextLink href={`/crm/companies/${deal.companyId}`}>{deal.companyName}</NextLink> : <Text color="secondary">{deal.companyName || 'No company linked.'}</Text>}
          <CompanyPicker label="Change company" value={companyOption(deal.companyId, deal.companyName)} linkContactId={deal.contactId}
            onChange={next => patch({ companyId: next?.auxiliaryData?.id ?? null }, 'Company updated.')} />
        </Panel>
        <Panel title="Tasks" action={<Button size="sm" label="Add task" icon={<Plus size={14} />} onClick={() => setTaskDrawer({ dealId: deal.id, dealName: deal.name, contactId: deal.contactId, contactName: deal.contactName, title: '' })} />}>
          {data.tasks.length ? data.tasks.map(task => <TaskLine key={task.id} task={task} onChanged={detail.refresh} onEdit={setEditingTask} />) : <Text color="secondary">No tasks for this deal.</Text>}
        </Panel>
        <Panel title="Details">
          <div className="ov-stack-sm">
            <Kv label="Owner"><OwnerChip name={deal.ownerName} /></Kv>
            <Kv label="Created">{shortDate(deal.createdAt)}</Kv>
            <Kv label="In current stage">{deal.daysInStage} day{deal.daysInStage === 1 ? '' : 's'}</Kv>
            <Kv label="Source">{deal.sourceLabel}</Kv>
          </div>
        </Panel>
        <Panel title="Stage history">
          {data.history.length ? <ul className="ov-rows">{data.history.map(change => <li key={change.id}>
            <span><Text>{change.fromStageName ? `${change.fromStageName} → ${change.toStageName}` : `Created in ${change.toStageName}`}</Text>
              {change.changedByName ? <Text type="supporting" color="secondary">{change.changedByName}</Text> : null}</span>
            <Text type="supporting" color="secondary">{shortDate(change.changedAt)}</Text>
          </li>)}</ul> : <Text color="secondary">No stage changes yet.</Text>}
        </Panel>
      </div>
    </div>
    {lost ? <LostDialog deal={deal} onClose={() => setLost(false)} onConfirm={reason => { setLost(false); post('close', { outcome: 'lost', lostReason: reason }, 'Deal marked as lost.'); }} /> : null}
    {taskDrawer || editingTask ? <TaskDrawer task={editingTask ?? undefined} defaults={taskDrawer ?? undefined} onClose={() => { setTaskDrawer(null); setEditingTask(null); }}
      onSaved={() => { setTaskDrawer(null); setEditingTask(null); detail.refresh(); }} /> : null}
    {emailTo ? <EmailDrawer contact={emailTo} dealId={deal.id} onClose={() => setEmailTo(null)} onDone={() => { setEmailTo(null); detail.refresh(); }} /> : null}
    {archive ? <ConfirmDialog title={deal.archivedAt ? 'Restore deal' : 'Archive deal'} destructive={!deal.archivedAt}
      description={deal.archivedAt ? 'The deal returns to its pipeline board.' : 'The deal leaves boards, tables and the forecast. Its history is kept and you can restore it.'}
      actionLabel={deal.archivedAt ? 'Restore' : 'Archive'} busy={action.busy} onClose={() => setArchive(false)}
      onConfirm={() => void action.run(async () => {
        await api(`/sales/deals/${id}/archive`, 'POST', { archived: !deal.archivedAt });
        setArchive(false);
        if (!deal.archivedAt) router.push('/sales'); else detail.refresh();
      }, deal.archivedAt ? 'Deal restored.' : 'Deal archived.')} /> : null}
  </div>;
}

