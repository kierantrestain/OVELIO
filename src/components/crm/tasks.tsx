'use client';

// Sales › Tasks: views by due date, create/edit drawer, complete/reopen, bulk complete and due reminders.
import '@/styles/crm.css';
import { BellRing, Plus } from 'lucide-react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import type { CrmTask, TaskPage, TaskView } from '@/contracts/crm';
import { api, useAction, useResource } from '../client';
import { AsyncState, Empty, Feedback, PageHeader, Panel, Tabs } from '../ui';
import { TaskDrawer, TaskLine } from './common';

const views: { value: TaskView; label: string }[] = [
  { value: 'mine', label: 'My tasks' }, { value: 'today', label: 'Today' }, { value: 'overdue', label: 'Overdue' },
  { value: 'upcoming', label: 'Upcoming' }, { value: 'completed', label: 'Completed' }, { value: 'all', label: 'All' }, { value: 'reminders', label: 'Due reminders' },
];

function bucket(task: CrmTask) {
  if (task.status === 'done') return 'Completed';
  if (!task.dueAt) return 'No due date';
  const due = new Date(task.dueAt);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const days = Math.floor((due.getTime() - start.getTime()) / 86_400_000);
  if (task.overdue) return 'Overdue';
  if (days <= 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days < 7) return 'This week';
  return 'Later';
}
const order = ['Overdue', 'Today', 'Tomorrow', 'This week', 'Later', 'No due date', 'Completed'];

export function SalesTasks({ initialCreate = false, initialTask }: { initialCreate?: boolean; initialTask?: string }) {
  const router = useRouter();
  const [view, setView] = useState<TaskView>('mine');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [drawer, setDrawer] = useState<'new' | CrmTask | null>(initialCreate ? 'new' : null);
  const action = useAction();
  const params = new URLSearchParams({ view });
  if (search) params.set('q', search);
  const tasks = useResource<TaskPage>(`/sales/tasks?${params}`);
  const linked = useResource<CrmTask>(initialTask ? `/sales/tasks/${initialTask}` : null);
  const [openedLinked, setOpenedLinked] = useState(false);
  if (linked.data && !openedLinked) { setOpenedLinked(true); setDrawer(linked.data); }
  const counts = tasks.data?.counts;
  const label = (item: (typeof views)[number]) => counts && item.value !== 'completed' && item.value !== 'all' ? `${item.label} (${counts[item.value]})` : item.label;
  const items = tasks.data?.items ?? [];
  const groups = order.map(name => ({ name, items: items.filter(task => bucket(task) === name) })).filter(group => group.items.length);
  const openIds = items.filter(task => task.status === 'open').map(task => task.id);

  return <div className="ov-stack">
    <PageHeader title="Tasks" description="Calls, emails, meetings and follow-ups for you and your team."
      actions={<Button label="New task" variant="primary" icon={<Plus size={16} />} onClick={() => setDrawer('new')} />} />
    <Tabs label="Task views" value={label(views.find(item => item.value === view)!)} items={views.map(label)}
      onChange={value => { setView(views.find(item => label(item) === value)?.value ?? 'mine'); setSelected([]); }} />
    <Feedback error={action.error} />
    {view === 'reminders' ? <Text color="secondary"><BellRing size={14} aria-hidden="true" /> Tasks whose reminder time has passed. Complete them or dismiss the reminder.</Text> : null}
    <Panel>
      <div className="ov-toolbar">
        <form onSubmit={event => { event.preventDefault(); setSearch(query.trim()); }}>
          <TextInput label="Search tasks" isLabelHidden type="search" startIcon="search" placeholder="Search tasks or deals" width={260} value={query} onChange={setQuery} />
        </form>
        {openIds.length ? <div className="ov-actions">
          <CheckboxInput label="Select all open tasks" value={openIds.every(id => selected.includes(id)) ? true : selected.length ? 'indeterminate' : false}
            onChange={checked => setSelected(checked ? openIds : [])} />
          <Button size="sm" label={`Complete ${selected.length || ''} selected`.replace('  ', ' ')} isDisabled={!selected.length} isLoading={action.busy}
            onClick={() => void action.run(async () => { await api('/sales/tasks/bulk-complete', 'POST', { ids: selected }); setSelected([]); tasks.refresh(); }, 'Tasks completed.')} />
        </div> : null}
      </div>
      {!tasks.data ? <AsyncState loading={tasks.loading} error={tasks.error} retry={tasks.refresh} />
        : !items.length ? <Empty title={view === 'reminders' ? 'No due reminders' : search ? 'No tasks match' : 'Nothing to do here'}
          description={view === 'overdue' ? 'Nothing is overdue.' : 'Create a task or schedule a follow-up from a contact or deal.'} />
          : groups.map(group => <section key={group.name} aria-label={group.name}>
            <div className="ov-crm-group">{group.name} · {group.items.length}</div>
            {group.items.map(task => <div key={task.id} className="ov-actions" style={{ flexWrap: 'nowrap', alignItems: 'center' }}>
              {task.status === 'open' ? <CheckboxInput label={`Select ${task.title}`} isLabelHidden value={selected.includes(task.id)}
                onChange={checked => setSelected(current => checked ? [...current, task.id] : current.filter(id => id !== task.id))} /> : <span style={{ width: 20 }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <TaskLine task={task} onChanged={tasks.refresh} onEdit={setDrawer} />
                <div className="ov-crm-task-meta" style={{ paddingLeft: 44, marginTop: -6, paddingBottom: 8 }}>
                  {task.dealId ? <NextLink href={`/sales/deals/${task.dealId}`}>{task.dealName}</NextLink> : null}
                  {task.contactId ? <NextLink href={`/crm/contacts/${task.contactId}`}>{task.contactName || 'Contact'}</NextLink> : null}
                  {task.companyId ? <NextLink href={`/crm/companies/${task.companyId}`}>{task.companyName || 'Company'}</NextLink> : null}
                  {task.source.startsWith('sequence:') ? <span>From a sequence</span> : task.source.startsWith('flow:') ? <span>From a workflow</span> : null}
                  {view === 'reminders' ? <Button size="sm" variant="ghost" label="Dismiss reminder"
                    onClick={() => void action.run(async () => { await api(`/sales/tasks/${task.id}/dismiss-reminder`, 'POST'); tasks.refresh(); })} /> : null}
                  {task.status === 'done' ? <Button size="sm" variant="ghost" label="Delete"
                    onClick={() => void action.run(async () => { await api(`/sales/tasks/${task.id}`, 'DELETE'); tasks.refresh(); }, 'Task deleted.')} /> : null}
                </div>
              </div>
            </div>)}
          </section>)}
    </Panel>
    {drawer ? <TaskDrawer task={drawer === 'new' ? undefined : drawer} onClose={() => { setDrawer(null); if (initialCreate || initialTask) router.replace('/sales/tasks'); }}
      onSaved={() => { setDrawer(null); tasks.refresh(); if (initialCreate || initialTask) router.replace('/sales/tasks'); }} /> : null}
  </div>;
}
