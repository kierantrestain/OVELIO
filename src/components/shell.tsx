'use client';

import { LogOut, Moon, Plus, Search, Sun } from 'lucide-react';
import NextLink from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { AppShell } from '@astryxdesign/core/AppShell';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Banner } from '@astryxdesign/core/Banner';
import { BreadcrumbItem, Breadcrumbs } from '@astryxdesign/core/Breadcrumbs';
import { CommandPalette } from '@astryxdesign/core/CommandPalette';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Kbd } from '@astryxdesign/core/Kbd';
import { Link } from '@astryxdesign/core/Link';
import { SideNav, SideNavItem, SideNavSection } from '@astryxdesign/core/SideNav';
import { Text } from '@astryxdesign/core/Text';
import { TopNav } from '@astryxdesign/core/TopNav';
import type { SearchableItem, SearchSource } from '@astryxdesign/core/Typeahead/utils';
import type { CompanySettings, User } from '@/contracts';
import type { SearchResult } from '@/contracts/platform';
import { api, request, useAction } from './client';
import { allowed, createActions, locate, workspaces } from './nav';
import { useColorMode } from './providers';
import { Empty, Feedback, Panel } from './ui';

const UserContext = createContext<User | null>(null);
const PreviewContext = createContext(false);

export function useUser() {
  const user = useContext(UserContext);
  if (!user) throw new Error('The workspace is unavailable.');
  return user;
}

/** True in the developer preview, where every record is sample data in an embedded database. */
export function usePreview() {
  return useContext(PreviewContext);
}

export function Brand() {
  return <span className="ov-brand"><span className="ov-brand-mark" aria-hidden="true" />OVELIO</span>;
}

type CommandMeta = { href: string; group: string; subtitle?: string; aliases: string[] };
type CommandEntry = SearchableItem<CommandMeta>;

const defaultAccent = '#2457d6';

const kindLabel: Record<SearchResult['kind'], string> = {
  contact: 'Contact', company: 'Company', deal: 'Deal', task: 'Task', campaign: 'Campaign', email: 'Email',
  template: 'Template', page: 'Landing page', form: 'Form', funnel: 'Funnel', flow: 'Workflow',
};

function navigationCommands(user: User): CommandEntry[] {
  const entries: CommandEntry[] = [];
  for (const space of workspaces) {
    if (!allowed(user.role, space.role)) continue;
    entries.push({ id: 'ws:' + space.id, label: space.label, auxiliaryData: { href: space.href, group: 'Go to', subtitle: space.description, aliases: [] } });
    for (const leaf of space.items) {
      if (!allowed(user.role, leaf.role ?? space.role) || leaf.href === space.href) continue;
      entries.push({ id: 'leaf:' + leaf.href, label: `${space.label} › ${leaf.label}`, auxiliaryData: { href: leaf.href, group: 'Go to', aliases: leaf.aliases ?? [] } });
    }
  }
  for (const action of createActions) {
    if (!allowed(user.role, action.role)) continue;
    entries.push({ id: 'new:' + action.href, label: `Create ${action.label.toLowerCase()}`, auxiliaryData: { href: action.href, group: 'Create', aliases: ['new', 'add'] } });
  }
  return entries;
}

function matches(entry: CommandEntry, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [entry.label, ...(entry.auxiliaryData?.aliases ?? [])].join(' ').toLowerCase();
  return q.split(/\s+/).every(part => haystack.includes(part));
}

/** Navigation and create commands answer instantly; live records from every workspace are appended when they arrive. */
function useCommandSource(user: User): { source: SearchSource<CommandEntry>; lookup: Map<string, CommandEntry> } {
  return useMemo(() => {
    const commands = navigationCommands(user);
    const lookup = new Map(commands.map(entry => [entry.id, entry]));
    const inflight: { controller?: AbortController } = {};
    const source: SearchSource<CommandEntry> = {
      bootstrap: () => commands.slice(0, 12),
      cancel: () => inflight.controller?.abort(),
      async search(query, context) {
        const local = commands.filter(entry => matches(entry, query)).slice(0, 8);
        if (query.trim().length < 2) return local;
        context?.update(local);
        inflight.controller?.abort();
        const controller = new AbortController();
        inflight.controller = controller;
        try {
          const found = await request<{ items: SearchResult[] }>('/api/console/platform/search?q=' + encodeURIComponent(query.trim()), { signal: controller.signal });
          const records = found.items.map(item => ({
            id: 'rec:' + item.kind + ':' + item.id,
            label: item.title,
            auxiliaryData: { href: item.href, group: kindLabel[item.kind], subtitle: item.subtitle, aliases: [] },
          } satisfies CommandEntry));
          for (const record of records) lookup.set(record.id, record);
          return [...local, ...records];
        } catch {
          return local;
        }
      },
    };
    return { source, lookup };
  }, [user]);
}

export function Shell({ user, workspace, devPreview = false, children }: {
  user: User; workspace: Pick<CompanySettings, 'name' | 'accent'>; devPreview?: boolean; children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { mode, toggle } = useColorMode();
  const logout = useAction();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { workspace: current, leaf, isDetail } = locate(pathname);
  const { source, lookup } = useCommandSource(user);
  const normalizedAccent = (workspace.accent ?? '').trim().toLowerCase();
  const accent = /^#[0-9a-f]{6}$/.test(normalizedAccent) && normalizedAccent !== defaultAccent
    ? {
        '--ov-chart': normalizedAccent,
        '--color-accent': normalizedAccent,
        '--color-text-accent': normalizedAccent,
        '--color-icon-accent': normalizedAccent,
      } as CSSProperties
    : undefined;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(open => !open);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const visible = workspaces.filter(space => allowed(user.role, space.role));
  const creatable = createActions.filter(action => allowed(user.role, action.role));

  const sideNav = <SideNav
    topContent={workspace.name !== 'OVELIO' ? <Text type="supporting" color="secondary">{workspace.name}</Text> : undefined}
    footer={<div className="ov-stack-sm">
      <SideNavItem label="Sign out" icon={LogOut} isDisabled={logout.busy} onClick={() => void logout.run(async () => {
        const result = await request<{ ok: boolean; logoutUrl?: string }>('/api/auth/logout', { method: 'POST' });
        if (result?.logoutUrl) {
          window.location.assign(result.logoutUrl);
          return;
        }
        router.replace('/login');
        router.refresh();
      })} />
      <Feedback error={logout.error} />
    </div>}>
    <SideNavSection title="Workspaces" isHeaderHidden>
      {visible.map(space => {
        const active = current?.id === space.id;
        const leaves = space.items.filter(item => allowed(user.role, item.role ?? space.role));
        if (!active || !leaves.length) {
          return <SideNavItem key={space.id} label={space.label} href={space.href} icon={space.icon} isSelected={active} />;
        }
        return <SideNavItem key={space.id} label={space.label} href={space.href} icon={space.icon} collapsible={{ isCollapsed: false }}>
          {leaves.map(item => <SideNavItem key={item.href} label={item.label} href={item.href} isSelected={leaf?.href === item.href} />)}
        </SideNavItem>;
      })}
    </SideNavSection>
  </SideNav>;

  const topNav = <TopNav label="Workspace"
    heading={<NextLink href="/overview" aria-label="OVELIO overview" className="ov-brand-link"><Brand /></NextLink>}
    startContent={<Breadcrumbs label="Location">
      <BreadcrumbItem href="/overview">{workspace.name || 'Workspace'}</BreadcrumbItem>
      {current ? <BreadcrumbItem href={leaf || isDetail ? current.href : undefined} isCurrent={!leaf && !isDetail}>{current.label}</BreadcrumbItem> : null}
      {leaf && leaf.href !== current?.href ? <BreadcrumbItem href={isDetail ? leaf.href : undefined} isCurrent={!isDetail}>{leaf.label}</BreadcrumbItem> : null}
      {isDetail ? <BreadcrumbItem isCurrent>Details</BreadcrumbItem> : null}
    </Breadcrumbs>}
    endContent={<div className="ov-actions">
      <button type="button" className="ov-cmd-trigger" onClick={() => setPaletteOpen(true)} aria-label="Search records and pages">
        <Search size={14} aria-hidden="true" />
        <span>Search…</span>
        <Kbd keys="mod+k" />
      </button>
      {creatable.length ? <DropdownMenu
        button={{ label: 'Create', variant: 'primary', size: 'sm', icon: <Plus size={16} aria-hidden="true" /> }}
        items={[...new Set(creatable.map(action => action.group))].map(group => ({
          type: 'section' as const,
          title: group,
          items: creatable.filter(action => action.group === group).map(action => ({ label: action.label, href: action.href })),
        }))}
      /> : null}
      <IconButton variant="ghost" label={mode === 'light' ? 'Use dark theme' : 'Use light theme'} icon={mode === 'light' ? <Moon size={18} /> : <Sun size={18} />} onClick={toggle} />
      <Avatar name={user.name} size="sm" tooltip={`${user.name} · ${user.role}`} />
    </div>} />;

  return <UserContext.Provider value={user}>
    <PreviewContext.Provider value={devPreview}>
      <div style={accent}>
        <AppShell sideNav={sideNav} topNav={topNav} variant="elevated">
          <div className="ov-page">
            {devPreview ? <PreviewBanner /> : null}
            {current && !allowed(user.role, current.role)
              ? <Panel><Empty title="Your role cannot access this workspace" action={<Link href="/overview">Return to Overview</Link>} /></Panel>
              : children}
          </div>
        </AppShell>
        <CommandPalette
          isOpen={paletteOpen}
          onOpenChange={setPaletteOpen}
          searchSource={source}
          label="Search records, pages and actions"
          emptySearchText="Nothing matches. Try a name, email, deal or page."
          renderItem={item => <div className="ov-cmd-item">
            <span className="ov-cmd-item-title">{item.label}</span>
            <span className="ov-cmd-item-meta">{[item.auxiliaryData?.group, item.auxiliaryData?.subtitle].filter(Boolean).join(' · ')}</span>
          </div>}
          onValueChange={selectedId => {
            const match = lookup.get(selectedId);
            if (match?.auxiliaryData?.href) {
              setPaletteOpen(false);
              router.push(match.auxiliaryData.href);
            }
          }}
        />
      </div>
    </PreviewContext.Provider>
  </UserContext.Provider>;
}

const noSubscription = () => () => {};

function readBannerHidden() {
  try { return sessionStorage.getItem('ov-preview-banner') === 'hidden'; } catch { return false; }
}

function PreviewBanner() {
  // The server render always shows the banner; the client hides it once dismissed in this tab.
  const hidden = useSyncExternalStore(noSubscription, readBannerHidden, () => false);
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || hidden) return null;
  return <Banner
    status="info"
    title="Developer preview · sample data"
    description="Every record here is demonstration data, labelled as such, in an embedded database that resets when the preview restarts. Email delivery, the audience engine and website tracking are simulated. Run OVELIO with Docker Compose for live engines."
    onDismiss={() => {
      setDismissed(true);
      try { sessionStorage.setItem('ov-preview-banner', 'hidden'); } catch { /* storage unavailable */ }
    }}
  />;
}

/** Fetches the workspace's team for owner and assignee pickers. */
export async function loadTeam() {
  return api<Pick<User, 'id' | 'name' | 'email' | 'role'>[]>('/platform/users');
}

/** Full-screen editors (email studio, page builder) render without the workspace chrome but share the user and preview state. */
export function StudioFrame({ user, devPreview = false, children }: { user: User; devPreview?: boolean; children: ReactNode }) {
  return <UserContext.Provider value={user}>
    <PreviewContext.Provider value={devPreview}>{children}</PreviewContext.Provider>
  </UserContext.Provider>;
}
