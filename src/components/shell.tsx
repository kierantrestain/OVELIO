'use client';

import { ChartNoAxesCombined, LayoutDashboard, LogOut, Mail, Moon, Settings2, Sun, UsersRound, Workflow } from 'lucide-react';
import NextLink from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { AppShell } from '@astryxdesign/core/AppShell';
import { Avatar } from '@astryxdesign/core/Avatar';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Link } from '@astryxdesign/core/Link';
import { SideNav, SideNavItem, SideNavSection } from '@astryxdesign/core/SideNav';
import { Text } from '@astryxdesign/core/Text';
import { TopNav } from '@astryxdesign/core/TopNav';
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

export function Shell({ user, workspace, children }: {
  user: User; workspace: Pick<CompanySettings, 'name' | 'accent'>; children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { mode, toggle } = useColorMode();
  const logout = useAction();
  const section = links.find(item => pathname === item.href || pathname.startsWith(item.href + '/'));
  const accent = /^#[0-9a-f]{6}$/i.test(workspace.accent) ? { '--ov-chart': workspace.accent } as CSSProperties : undefined;

  const sideNav = <SideNav
    topContent={workspace.name !== 'OVELIO' ? <Text type="supporting" color="secondary">{workspace.name}</Text> : undefined}
    footer={<div className="ov-stack-sm">
      <SideNavItem label="Sign out" icon={LogOut} isDisabled={logout.busy} onClick={() => void logout.run(async () => {
        await request('/api/auth/logout', { method: 'POST' });
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
    startContent={<Text color="secondary">Workspace <span aria-hidden="true">/</span> <Text weight="semibold">{section?.label || 'Workspace'}</Text></Text>}
    endContent={<div className="ov-actions">
      <IconButton variant="ghost" label={mode === 'light' ? 'Use dark theme' : 'Use light theme'} icon={mode === 'light' ? <Moon size={18} /> : <Sun size={18} />} onClick={toggle} />
      <Avatar name={user.name} size="sm" tooltip={`${user.name} · ${user.role}`} />
    </div>} />;

  return <UserContext.Provider value={user}>
    <div style={accent}>
      <AppShell sideNav={sideNav} topNav={topNav} variant="elevated">
        <div className="ov-page">
          {section && ranks[user.role] < ranks[section.role]
            ? <Panel><Empty title="Your role cannot access this section" action={<Link href="/overview">Return to Overview</Link>} /></Panel>
            : children}
        </div>
      </AppShell>
    </div>
  </UserContext.Provider>;
}
