'use client';

import { BookOpenCheck, ChartNoAxesCombined, LayoutDashboard, LogOut, Mail, Menu, Moon, Settings2, Sun, UsersRound, Workflow } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { CompanySettings, Role, User } from '@/contracts';
import { request, useAction } from './client';
import { Button, Empty, Feedback, Panel } from './ui';

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
  return <span className="brand"><span className="brand-mark" aria-hidden="true" />OVELIO</span>;
}

export function Shell({ user, workspace, theme, children }: {
  user: User; workspace: Pick<CompanySettings, 'name' | 'accent'>; theme: 'light' | 'dark'; children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [mode, setMode] = useState(theme);
  const logout = useAction();
  const section = links.find(item => pathname === item.href || pathname.startsWith(item.href + '/'));
  const menuOpen = openPath === pathname;
  const initials = user.name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();

  function toggleTheme() {
    const next = mode === 'light' ? 'dark' : 'light';
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `ovelio_theme=${next}; Path=/; SameSite=Lax; Max-Age=31536000${secure}`;
    document.documentElement.dataset.theme = next;
    setMode(next);
  }

  return <UserContext.Provider value={user}>
    <a href="#main" className="skip-link">Skip to content</a>
    <div className="shell" style={{ '--company-accent': /^#[0-9a-f]{6}$/i.test(workspace.accent) ? workspace.accent : undefined } as CSSProperties}>
      {menuOpen ? <button className="nav-overlay" aria-label="Close navigation" onClick={() => setOpenPath(null)} /> : null}
      <aside id="sidebar" className={`sidebar ${menuOpen ? 'sidebar--open' : ''}`}>
        <Link href="/overview" className="brand-link" onClick={() => setOpenPath(null)} aria-label="OVELIO overview"><Brand /></Link>
        {workspace.name !== 'OVELIO' ? <div className="workspace-info"><span className="workspace-icon"><BookOpenCheck size={17} /></span><strong>{workspace.name}</strong></div> : null}
        <nav aria-label="Main navigation">
          {links.filter(item => ranks[user.role] >= ranks[item.role]).map(item => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/');
            return <Link href={item.href} key={item.href} aria-current={active ? 'page' : undefined}
              onClick={() => setOpenPath(null)} className={`nav-link ${active ? 'nav-link--selected' : ''}`}>
              <item.icon size={18} strokeWidth={1.85} /> {item.label}
            </Link>;
          })}
        </nav>
        <div className="sidebar-footer">
          <Button variant="quiet" className="sidebar-signout" onClick={() => void logout.run(async () => {
            await request('/api/auth/logout', { method: 'POST' });
            router.replace('/login');
            router.refresh();
          })} disabled={logout.busy}><LogOut size={17} /> Sign out</Button>
          <Feedback error={logout.error} />
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-section">
            <Button variant="quiet" className="icon-button menu-toggle" onClick={() => setOpenPath(menuOpen ? null : pathname)}
              aria-expanded={menuOpen} aria-controls="sidebar" aria-label="Open navigation"><Menu size={21} /></Button>
            <span className="breadcrumb-parent">Workspace</span><span className="breadcrumb-divider" aria-hidden="true">/</span><span>{section?.label || 'Workspace'}</span>
          </div>
          <div className="topbar-actions">
            <Button variant="quiet" className="icon-button theme-toggle" onClick={toggleTheme} aria-label={mode === 'light' ? 'Use dark theme' : 'Use light theme'}>
              {mode === 'light' ? <Moon size={19} /> : <Sun size={19} />}
            </Button>
            <span className="topbar-rule" />
            <div className="account"><span className="avatar">{initials}</span><span className="account-label"><strong>{user.name}</strong><small>{user.role}</small></span></div>
          </div>
        </header>
        <main className="main-content" id="main">
          {section && ranks[user.role] < ranks[section.role] ? <Panel><Empty title="Your role cannot access this section">
            <Link className="text-link" href="/overview">Return to Overview</Link>
          </Empty></Panel> : children}
        </main>
      </div>
    </div>
  </UserContext.Provider>;
}
