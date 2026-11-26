'use client';

// Per-user workspace chrome (Product Engineering): environment indicator, notification bell, starred and recent
// records, and display preferences. Mounted by the shell; Overview reads the same context.
import { Bell, Check, Database, Rows3, Rows4, Star } from 'lucide-react';
import NextLink from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Button } from '@astryxdesign/core/Button';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Popover } from '@astryxdesign/core/Popover';
import { Text } from '@astryxdesign/core/Text';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import type { User } from '@/contracts';
import type { NotificationList, Preferences, RecordMarks } from '@/contracts/workspace';
import { recordAt } from '@/contracts/workspace';
import { api } from './client';

type Workspace = {
  marks: RecordMarks;
  refreshMarks: () => void;
  preferences: Preferences;
  savePreferences: (patch: Partial<Preferences>) => Promise<void>;
  preferencesLoaded: boolean;
};

const emptyMarks: RecordMarks = { starred: [], recent: [] };
const defaultPreferences: Preferences = { density: 'comfortable', overview: null };
const WorkspaceContext = createContext<Workspace>({
  marks: emptyMarks, refreshMarks: () => {}, preferences: defaultPreferences, savePreferences: async () => {}, preferencesLoaded: false,
});

export const useWorkspace = () => useContext(WorkspaceContext);

/** Loads the signed-in user's marks and preferences once, and records record pages as recents. */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [marks, setMarks] = useState<RecordMarks>(emptyMarks);
  const [preferences, setPreferences] = useState<Preferences>(defaultPreferences);
  const [preferencesLoaded, setLoaded] = useState(false);
  const refreshMarks = useCallback(() => { api<RecordMarks>('/platform/marks').then(setMarks, () => {}); }, []);

  useEffect(() => {
    refreshMarks();
    api<Preferences>('/platform/preferences').then(value => { setPreferences(value); setLoaded(true); }, () => setLoaded(true));
  }, [refreshMarks]);

  useEffect(() => {
    const record = recordAt(pathname);
    if (record) api<RecordMarks>('/platform/marks/recent', 'POST', record).then(setMarks, () => {});
  }, [pathname]);

  const savePreferences = useCallback(async (patch: Partial<Preferences>) => {
    setPreferences(current => ({ ...current, ...patch }));
    setPreferences(await api<Preferences>('/platform/preferences', 'PATCH', patch));
  }, []);

  const value = useMemo(() => ({ marks, refreshMarks, preferences, savePreferences, preferencesLoaded }),
    [marks, refreshMarks, preferences, savePreferences, preferencesLoaded]);
  return <WorkspaceContext.Provider value={value}>
    <div data-ov-density={preferences.density} className="ov-density">{children}</div>
  </WorkspaceContext.Provider>;
}

/** A small, always-visible label for where you are. Only the developer preview shows one. */
export function EnvironmentBadge({ preview }: { preview: boolean }) {
  if (!preview) return null;
  return <Popover label="About this environment" placement="below" width={320} content={<div className="ov-stack-sm">
    <Text weight="semibold">Developer preview</Text>
    <Text type="supporting">Every record is labelled sample data in an embedded database. It resets when the preview restarts.</Text>
    <Text type="supporting">Email delivery, the audience engine and website tracking are simulated: nothing reaches a real inbox or site.</Text>
    <Text type="supporting" color="secondary">Run OVELIO with Docker Compose for live engines and persistent data.</Text>
  </div>}>
    {trigger => <button type="button" {...trigger} className="ov-env" aria-label="Preview environment with sample data. About this environment">
      <Database size={13} aria-hidden="true" /><span className="ov-env-full">Preview · sample data</span><span className="ov-env-short">Preview</span>
    </button>}
  </Popover>;
}

/** Bell with the unread count; the list marks items read when opened from it. */
export function NotificationBell() {
  const [data, setData] = useState<NotificationList>({ items: [], unread: 0 });
  const [open, setOpen] = useState(false);
  const load = useCallback(() => { api<NotificationList>('/platform/notifications').then(setData, () => {}); }, []);
  useEffect(() => {
    load();
    const timer = window.setInterval(load, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);
  const markRead = (ids?: string[]) => api<NotificationList>('/platform/notifications/read', 'POST', ids ? { ids } : {}).then(setData, () => {});
  const label = data.unread ? `Notifications, ${data.unread} unread` : 'Notifications';
  return <Popover label="Notifications" placement="below" alignment="end" width={360} isOpen={open}
    onOpenChange={next => { setOpen(next); if (next) load(); }}
    content={<div className="ov-notes">
      <div className="ov-actions ov-actions--between">
        <Text weight="semibold">Notifications</Text>
        {data.unread ? <Button size="sm" variant="ghost" label="Mark all read" onClick={() => void markRead()} /> : null}
      </div>
      {data.items.length ? <ul className="ov-notes-list">{data.items.map(item => <li key={item.id} data-unread={!item.read}>
        {item.href ? <NextLink href={item.href} onClick={() => { setOpen(false); if (!item.read) void markRead([item.id]); }}>{item.title}</NextLink>
          : <Text weight="medium">{item.title}</Text>}
        {item.body ? <Text type="supporting" color="secondary">{item.body}</Text> : null}
        <Text type="supporting" color="secondary"><Timestamp value={item.createdAt} format="relative_short" /></Text>
      </li>)}</ul> : <Text type="supporting" color="secondary">You are all caught up. Won deals, new leads, task reminders and workflow failures appear here.</Text>}
    </div>}>
    {trigger => <button type="button" {...trigger} className="ov-bell" aria-label={label}>
      <Bell size={18} aria-hidden="true" />
      {data.unread ? <span className="ov-bell-count" aria-hidden="true">{data.unread > 99 ? '99+' : data.unread}</span> : null}
    </button>}
  </Popover>;
}

/** Star toggle for the record page you are on (deal, contact, company, campaign, page or workflow). */
export function StarToggle() {
  const pathname = usePathname();
  const { marks, refreshMarks } = useWorkspace();
  const record = recordAt(pathname);
  const [busy, setBusy] = useState(false);
  if (!record) return null;
  const starred = marks.starred.some(item => item.kind === record.kind && item.recordId === record.recordId);
  const noun = record.kind === 'flow' ? 'workflow' : record.kind;
  return <IconButton size="sm" variant="ghost" isDisabled={busy} aria-pressed={starred}
    label={starred ? `Remove this ${noun} from starred` : `Star this ${noun}`}
    icon={<Star size={17} className={starred ? 'ov-star-on' : undefined} />}
    onClick={() => {
      setBusy(true);
      const done = starred
        ? api(`/platform/marks/star/${record.kind}/${record.recordId}`, 'DELETE')
        : api('/platform/marks/star', 'POST', record);
      void done.finally(() => { setBusy(false); refreshMarks(); });
    }} />;
}

/** The user's avatar opens display preferences. */
export function AccountMenu({ user }: { user: User }) {
  const { preferences, savePreferences } = useWorkspace();
  const pick = (density: Preferences['density']) => () => { void savePreferences({ density }); };
  return <DropdownMenu hasChevron={false}
    button={{ label: `${user.name}, ${user.role}: display settings`, isIconOnly: true, variant: 'ghost', size: 'sm', icon: <Avatar name={user.name} size="sm" /> }}
    items={[{
      type: 'section' as const,
      title: 'Table density',
      items: [
        { label: 'Comfortable', icon: preferences.density === 'comfortable' ? <Check size={14} /> : <Rows3 size={14} />, onClick: pick('comfortable') },
        { label: 'Compact', icon: preferences.density === 'compact' ? <Check size={14} /> : <Rows4 size={14} />, onClick: pick('compact') },
      ],
    }]} />;
}
