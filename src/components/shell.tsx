'use client';

import {
  ChartNoAxesCombined, LayoutDashboard, LogOut, Mail, Moon, Search, Settings2, Sun, UsersRound, Workflow,
} from 'lucide-react';
import NextLink from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { AppShell } from '@astryxdesign/core/AppShell';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Banner } from '@astryxdesign/core/Banner';
import { BreadcrumbItem, Breadcrumbs } from '@astryxdesign/core/Breadcrumbs';
import { CommandPalette } from '@astryxdesign/core/CommandPalette';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Kbd } from '@astryxdesign/core/Kbd';
import { Link } from '@astryxdesign/core/Link';
import { SideNav, SideNavItem, SideNavSection } from '@astryxdesign/core/SideNav';
import { Text } from '@astryxdesign/core/Text';
import { TopNav } from '@astryxdesign/core/TopNav';
import { createStaticSource } from '@astryxdesign/core/Typeahead/utils';
import type { SearchableItem } from '@astryxdesign/core/Typeahead/utils';
import type { CompanySettings, Role, User } from '@/contracts';
import { request, useAction } from './client';
import { useColorMode } from './providers';
import { Empty, Feedback, Panel } from './ui';

const links = [
  { label: 'Overview', href: '/overview', icon: LayoutDashboard, role: 'analyst' },
  { label: 'Audience', href: '/audience', icon: UsersRound, role: 'marketer' },
  { label: 'Campaigns', href: '/campaigns', icon: Mail, role: 'marketer' },
  { label: 'Automations', href: '/automations', icon: Workflow, role: 'marketer' },
  { label: 'Analytics', href: '/analytics', icon: ChartNoAxesCombined, role: 'analyst' },
  { label: 'Settings', href: '/settings', icon: Settings2, role: 'admin' },
] as const;
const ranks: Record<Role, number> = { analyst: 0, marketer: 1, admin: 2 };
const UserContext = createContext<User | null>(null);

export function useUser() {
  const user = useContext(UserContext);
  if (!user) throw new Error('The workspace is unavailable.');
  return user;
}

export function Brand() {
  return <span className="ov-brand"><span className="ov-brand-mark" aria-hidden="true" />OVELIO</span>;
}

type CommandMeta = { href: string; group: string; aliases: string[]; role: Role };
type CommandEntry = SearchableItem<CommandMeta>;

const defaultAccent = '#2457d6';

const commandDefinitions: CommandEntry[] = [
  { id: 'go-overview', label: 'Overview dashboard', auxiliaryData: { href: '/overview', group: 'Navigate', aliases: ['home', 'summary', 'kpi'], role: 'analyst' } },
  { id: 'go-audience', label: 'Audience — Contacts directory', auxiliaryData: { href: '/audience', group: 'Audience', aliases: ['contacts', 'people', 'import', 'csv'], role: 'marketer' } },
  { id: 'go-segments', label: 'Audience — Segments & filters', auxiliaryData: { href: '/audience?tab=Segments', group: 'Audience', aliases: ['segments', 'groups', 'sync'], role: 'marketer' } },
  { id: 'go-lists', label: 'Audience — Mailing lists', auxiliaryData: { href: '/audience?tab=Mailing+lists', group: 'Audience', aliases: ['lists', 'subscribers'], role: 'marketer' } },
  { id: 'go-tags-stages', label: 'Audience — Tags & stages', auxiliaryData: { href: '/audience?tab=Tags+%26+stages', group: 'Audience', aliases: ['tags', 'stages', 'lifecycle', 'labels'], role: 'marketer' } },
  { id: 'go-companies', label: 'Audience — Companies', auxiliaryData: { href: '/audience?tab=Companies', group: 'Audience', aliases: ['companies', 'accounts', 'organizations', 'b2b'], role: 'marketer' } },
  { id: 'go-scoring', label: 'Audience — Lead scoring & triggers', auxiliaryData: { href: '/audience?tab=Lead+scoring', group: 'Audience', aliases: ['points', 'score', 'triggers'], role: 'marketer' } },
  { id: 'go-custom-fields', label: 'Audience — Custom fields', auxiliaryData: { href: '/audience?tab=Custom+fields', group: 'Audience', aliases: ['fields', 'schema', 'attributes', 'properties'], role: 'marketer' } },
  { id: 'go-suppressions', label: 'Audience — Suppressions & bounces', auxiliaryData: { href: '/audience?tab=Suppressions', group: 'Audience', aliases: ['unsubscribe', 'bounce', 'dnc', 'optout'], role: 'marketer' } },
  { id: 'go-campaigns', label: 'Campaigns — Newsletters', auxiliaryData: { href: '/campaigns', group: 'Campaigns', aliases: ['newsletter', 'email', 'broadcast'], role: 'marketer' } },
  { id: 'go-templates', label: 'Campaigns — Email templates', auxiliaryData: { href: '/campaigns?tab=Templates', group: 'Campaigns', aliases: ['templates', 'layouts'], role: 'marketer' } },
  { id: 'go-media', label: 'Campaigns — Media library', auxiliaryData: { href: '/campaigns?tab=Media', group: 'Campaigns', aliases: ['images', 'uploads', 'files'], role: 'marketer' } },
  { id: 'go-transactional', label: 'Campaigns — Transactional email', auxiliaryData: { href: '/campaigns?tab=Transactional', group: 'Campaigns', aliases: ['transactional', 'tx', 'single', 'receipt', 'trigger email'], role: 'marketer' } },
  { id: 'go-automations', label: 'Automations — Workflows', auxiliaryData: { href: '/automations', group: 'Automations', aliases: ['workflows', 'journeys', 'welcome', 'nurture'], role: 'marketer' } },
  { id: 'go-journey-emails', label: 'Automations — Journey emails', auxiliaryData: { href: '/automations?tab=Journey+emails', group: 'Automations', aliases: ['journey', 'automated emails', 'drip', 'sequence'], role: 'marketer' } },
  { id: 'go-forms', label: 'Automations — Lead forms', auxiliaryData: { href: '/automations?tab=Lead+forms', group: 'Automations', aliases: ['forms', 'capture', 'submissions'], role: 'marketer' } },
  { id: 'go-assets', label: 'Automations — Downloadable assets', auxiliaryData: { href: '/automations?tab=Assets', group: 'Automations', aliases: ['assets', 'downloads', 'lead magnet'], role: 'marketer' } },
  { id: 'go-pages', label: 'Automations — Landing pages', auxiliaryData: { href: '/automations?tab=Landing+pages', group: 'Automations', aliases: ['pages', 'landing'], role: 'marketer' } },
  { id: 'go-dynamic-content', label: 'Automations — Dynamic content', auxiliaryData: { href: '/automations?tab=Dynamic+content', group: 'Automations', aliases: ['dynamic', 'personalization', 'slots', 'blocks'], role: 'marketer' } },
  { id: 'go-focus-items', label: 'Automations — Popups & bars', auxiliaryData: { href: '/automations?tab=Popups+%26+bars', group: 'Automations', aliases: ['popups', 'bars', 'modals', 'banners', 'focus'], role: 'marketer' } },
  { id: 'go-categories', label: 'Automations — Categories', auxiliaryData: { href: '/automations?tab=Categories', group: 'Automations', aliases: ['categories', 'taxonomy', 'organize', 'colors'], role: 'marketer' } },
  { id: 'go-webhooks', label: 'Automations — Outbound webhooks', auxiliaryData: { href: '/automations?tab=Webhooks', group: 'Automations', aliases: ['webhooks', 'hooks', 'events'], role: 'admin' } },
  { id: 'go-analytics', label: 'Analytics — Website traffic', auxiliaryData: { href: '/analytics', group: 'Analytics', aliases: ['traffic', 'visitors', 'utm', 'pages'], role: 'analyst' } },
  { id: 'go-realtime', label: 'Analytics — Realtime live visitors', auxiliaryData: { href: '/analytics?tab=Realtime', group: 'Analytics', aliases: ['live', 'realtime', 'active'], role: 'analyst' } },
  { id: 'go-sessions', label: 'Analytics — Sessions & heatmap', auxiliaryData: { href: '/analytics?tab=Sessions', group: 'Analytics', aliases: ['sessions', 'heatmap', 'activity'], role: 'analyst' } },
  { id: 'go-goals', label: 'Analytics — Goals & funnels', auxiliaryData: { href: '/analytics?tab=Goals+%26+Funnels', group: 'Analytics', aliases: ['goals', 'funnels', 'conversions'], role: 'analyst' } },
  { id: 'go-insights', label: 'Analytics — Journeys, retention & attribution', auxiliaryData: { href: '/analytics?tab=Insights', group: 'Analytics', aliases: ['journeys', 'retention', 'attribution', 'breakdown'], role: 'analyst' } },
  { id: 'go-links-pixels', label: 'Analytics — Tracked links & pixels', auxiliaryData: { href: '/analytics?tab=Links+%26+Pixels', group: 'Analytics', aliases: ['links', 'pixels', 'short'], role: 'analyst' } },
  { id: 'go-email-reports', label: 'Analytics — Email performance reports', auxiliaryData: { href: '/analytics?tab=Email+reports', group: 'Analytics', aliases: ['email reports', 'opens', 'clicks'], role: 'analyst' } },
  { id: 'go-marketing-reports', label: 'Analytics — Marketing reports', auxiliaryData: { href: '/analytics?tab=Marketing+reports', group: 'Analytics', aliases: ['marketing reports', 'crm reports', 'contacts report', 'tables'], role: 'analyst' } },
  { id: 'go-settings', label: 'Settings — Company & branding', auxiliaryData: { href: '/settings', group: 'Settings', aliases: ['company', 'profile', 'branding'], role: 'admin' } },
  { id: 'go-team', label: 'Settings — Team access', auxiliaryData: { href: '/settings?view=team', group: 'Settings', aliases: ['team', 'users', 'members', 'roles', 'access'], role: 'admin' } },
  { id: 'go-connections', label: 'Settings — Connections & SMTP', auxiliaryData: { href: '/settings?view=connections', group: 'Settings', aliases: ['smtp', 'dns', 'health', 'jobs'], role: 'admin' } },
  { id: 'go-data-privacy', label: 'Settings — Data & privacy', auxiliaryData: { href: '/settings?view=data+%26+privacy', group: 'Settings', aliases: ['privacy', 'gdpr', 'backup', 'maintenance', 'export', 'licences'], role: 'admin' } },
];

export function Shell({ user, workspace, devPreview = false, children }: {
  user: User; workspace: Pick<CompanySettings, 'name' | 'accent'>; devPreview?: boolean; children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { mode, toggle } = useColorMode();
  const logout = useAction();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const section = links.find(item => pathname === item.href || pathname.startsWith(item.href + '/'));
  const isDetail = Boolean(section && pathname !== section.href);
  const normalizedAccent = (workspace.accent ?? '').trim().toLowerCase();
  const accent = /^#[0-9a-f]{6}$/.test(normalizedAccent) && normalizedAccent !== defaultAccent
    ? {
        '--ov-chart': normalizedAccent,
        '--color-accent': normalizedAccent,
        '--color-text-accent': normalizedAccent,
        '--color-icon-accent': normalizedAccent,
      } as CSSProperties
    : undefined;

  const allowedCommands = useMemo(
    () => commandDefinitions.filter(item => ranks[user.role] >= ranks[item.auxiliaryData!.role]),
    [user.role],
  );
  const commandSource = useMemo(
    () => createStaticSource(allowedCommands, { keywords: item => item.auxiliaryData?.aliases ?? [] }),
    [allowedCommands],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(current => !current);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

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
    <SideNavSection title="Workspace" isHeaderHidden>
      {links.filter(item => ranks[user.role] >= ranks[item.role]).map(item => <SideNavItem key={item.href} label={item.label} href={item.href}
        icon={item.icon} isSelected={section?.href === item.href} />)}
    </SideNavSection>
  </SideNav>;

  const topNav = <TopNav label="Workspace"
    heading={<NextLink href="/overview" aria-label="OVELIO overview" style={{ display: 'inline-flex', width: 236, paddingInline: 8 }}><Brand /></NextLink>}
    startContent={<Breadcrumbs label="Location">
      <BreadcrumbItem href="/overview">{workspace.name || 'Workspace'}</BreadcrumbItem>
      {section ? <BreadcrumbItem href={isDetail ? section.href : undefined} isCurrent={!isDetail}>{section.label}</BreadcrumbItem> : null}
      {isDetail ? <BreadcrumbItem isCurrent>Details</BreadcrumbItem> : null}
    </Breadcrumbs>}
    endContent={<div className="ov-actions">
      <button type="button" className="ov-cmd-trigger" onClick={() => setPaletteOpen(true)} aria-label="Open quick navigation">
        <Search size={14} aria-hidden="true" />
        <span>Jump to…</span>
        <Kbd keys="mod+k" />
      </button>
      <IconButton variant="ghost" label={mode === 'light' ? 'Use dark theme' : 'Use light theme'} icon={mode === 'light' ? <Moon size={18} /> : <Sun size={18} />} onClick={toggle} />
      <Avatar name={user.name} size="sm" tooltip={`${user.name} · ${user.role}`} />
    </div>} />;

  return <UserContext.Provider value={user}>
    <div style={accent}>
      <AppShell sideNav={sideNav} topNav={topNav} variant="elevated">
        <div className="ov-page">
          {devPreview ? <Banner
            status="info"
            title="Developer preview mode"
            description="Exploring interactive sample data without connected backend services. Run OVELIO with Docker Compose to connect live audience, email, and analytics engines."
          /> : null}
          {section && ranks[user.role] < ranks[section.role]
            ? <Panel><Empty title="Your role cannot access this section" action={<Link href="/overview">Return to Overview</Link>} /></Panel>
            : children}
        </div>
      </AppShell>
      <CommandPalette
        isOpen={paletteOpen}
        onOpenChange={setPaletteOpen}
        searchSource={commandSource}
        label="Jump to section or tool"
        emptySearchText="No matching workspace tools"
        onValueChange={selectedId => {
          const match = allowedCommands.find(item => item.id === selectedId);
          if (match?.auxiliaryData?.href) {
            setPaletteOpen(false);
            router.push(match.auxiliaryData.href);
          }
        }}
      />
    </div>
  </UserContext.Provider>;
}
