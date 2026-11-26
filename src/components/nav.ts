// OVELIO 2.0 information architecture (lead-owned). Every workspace route and quick-create action lives here, so the
// side navigation, breadcrumbs, command palette and Create menu stay consistent. Lanes add pages at these routes.
import {
  BarChart3, BriefcaseBusiness, Globe, LayoutDashboard, Megaphone, Settings2, UsersRound, Workflow,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Role } from '@/contracts';

export type NavLeaf = { label: string; href: string; role?: Role; aliases?: string[] };
export type Workspace = {
  id: 'overview' | 'crm' | 'sales' | 'marketing' | 'sites' | 'automations' | 'analytics' | 'settings';
  label: string;
  href: string;
  icon: LucideIcon;
  role: Role;
  description: string;
  items: NavLeaf[];
};

export const workspaces: Workspace[] = [
  {
    id: 'overview', label: 'Overview', href: '/overview', icon: LayoutDashboard, role: 'analyst',
    description: 'Today across sales, marketing and your websites.', items: [],
  },
  {
    id: 'crm', label: 'CRM', href: '/crm', icon: UsersRound, role: 'marketer',
    description: 'People, companies and everything you know about them.',
    items: [
      { label: 'Contacts', href: '/crm', aliases: ['people', 'leads', 'customers'] },
      { label: 'Companies', href: '/crm/companies', aliases: ['accounts', 'organisations', 'b2b'] },
      { label: 'Segments', href: '/crm/segments', aliases: ['lists', 'filters', 'audiences'] },
      { label: 'Lifecycle & tags', href: '/crm/lifecycle', aliases: ['stages', 'tags', 'labels'] },
      { label: 'Lead scoring', href: '/crm/scoring', aliases: ['points', 'score', 'triggers'] },
      { label: 'Custom fields', href: '/crm/fields', aliases: ['properties', 'attributes', 'schema'] },
      { label: 'Consent & suppressions', href: '/crm/consent', aliases: ['gdpr', 'unsubscribe', 'bounces', 'dnc'] },
    ],
  },
  {
    id: 'sales', label: 'Sales', href: '/sales', icon: BriefcaseBusiness, role: 'marketer',
    description: 'Pipelines, deals, follow-ups and forecast.',
    items: [
      { label: 'Deals', href: '/sales', aliases: ['pipeline', 'kanban', 'opportunities'] },
      { label: 'Tasks', href: '/sales/tasks', aliases: ['to-do', 'follow-ups', 'reminders', 'activities'] },
      { label: 'Sequences', href: '/sales/sequences', aliases: ['cadences', 'outreach', 'follow-up emails'] },
      { label: 'Inbox', href: '/sales/inbox', aliases: ['email', 'gmail', 'outlook', 'conversations'] },
      { label: 'Proposals', href: '/sales/proposals', aliases: ['quotes', 'quotations', 'estimates', 'contracts', 'e-signature'] },
      { label: 'Invoices', href: '/sales/invoices', aliases: ['billing', 'payments', 'stripe', 'refunds'] },
      { label: 'Revenue', href: '/sales/revenue', aliases: ['cash', 'collected', 'mrr', 'subscriptions', 'recurring revenue'] },
      { label: 'Forecast', href: '/sales/forecast', aliases: ['quota', 'win rate'] },
      { label: 'Products', href: '/sales/products', aliases: ['catalogue', 'catalog', 'services', 'price list', 'tax rates'] },
      { label: 'Pipelines', href: '/sales/pipelines', aliases: ['stages', 'sales process'] },
    ],
  },
  {
    id: 'marketing', label: 'Marketing', href: '/marketing', icon: Megaphone, role: 'marketer',
    description: 'Campaigns, emails, templates and brand.',
    items: [
      { label: 'Campaigns', href: '/marketing', aliases: ['initiatives', 'launches', 'calendar'] },
      { label: 'Emails', href: '/marketing/emails', aliases: ['newsletters', 'broadcasts', 'sends'] },
      { label: 'Templates', href: '/marketing/templates', aliases: ['gallery', 'designs', 'layouts'] },
      { label: 'Transactional', href: '/marketing/transactional', aliases: ['receipts', 'system email'] },
      { label: 'Brand kit', href: '/marketing/brand', aliases: ['logo', 'colours', 'fonts', 'blocks'] },
      { label: 'Deliverability', href: '/marketing/deliverability', aliases: ['spf', 'dkim', 'dmarc', 'bounces', 'complaints', 'broken links', 'inbox'] },
      { label: 'Media', href: '/marketing/media', aliases: ['images', 'uploads', 'files'] },
      { label: 'Mailing lists', href: '/marketing/lists', aliases: ['subscribers', 'lists'] },
    ],
  },
  {
    id: 'sites', label: 'Sites & Forms', href: '/sites', icon: Globe, role: 'marketer',
    description: 'Landing pages, funnels, forms and publishing.',
    items: [
      { label: 'Landing pages', href: '/sites', aliases: ['pages', 'website', 'builder'] },
      { label: 'Funnels', href: '/sites/funnels', aliases: ['steps', 'conversion path'] },
      { label: 'Forms', href: '/sites/forms', aliases: ['lead capture', 'submissions', 'sign-up'] },
      { label: 'Domains', href: '/sites/domains', aliases: ['custom domain', 'subdomain', 'publishing'] },
      { label: 'Downloads', href: '/sites/assets', aliases: ['assets', 'lead magnets', 'files'] },
      { label: 'Popups & bars', href: '/sites/popups', aliases: ['modals', 'focus items', 'banners'] },
      { label: 'Dynamic content', href: '/sites/dynamic-content', aliases: ['personalisation', 'slots'] },
    ],
  },
  {
    id: 'automations', label: 'Automations', href: '/automations', icon: Workflow, role: 'marketer',
    description: 'Workflows that act on forms, deals, emails and visits.',
    items: [
      { label: 'Workflows', href: '/automations', aliases: ['journeys', 'flows', 'nurture'] },
      { label: 'Templates', href: '/automations/templates', aliases: ['recipes', 'playbooks'] },
      { label: 'Run history', href: '/automations/runs', aliases: ['logs', 'enrolments', 'failures'] },
      { label: 'Journey emails', href: '/automations/emails', aliases: ['drip', 'automated emails'] },
      { label: 'Webhooks', href: '/automations/webhooks', role: 'admin', aliases: ['hooks', 'integrations'] },
      { label: 'Categories', href: '/automations/categories', aliases: ['taxonomy', 'organise'] },
    ],
  },
  {
    id: 'analytics', label: 'Analytics', href: '/analytics', icon: BarChart3, role: 'analyst',
    description: 'Revenue, pipeline, marketing and website performance.',
    items: [
      { label: 'Executive', href: '/analytics', aliases: ['dashboard', 'kpi', 'summary'] },
      { label: 'Sales', href: '/analytics/sales', aliases: ['pipeline', 'win rate', 'revenue'] },
      { label: 'Marketing', href: '/analytics/marketing', aliases: ['email performance', 'campaign roi', 'leads'] },
      { label: 'Attribution', href: '/analytics/attribution', aliases: ['first touch', 'last touch', 'linear'] },
      { label: 'Funnels', href: '/analytics/funnels', aliases: ['conversion', 'abandonment'] },
      { label: 'Website', href: '/analytics/website', aliases: ['traffic', 'visitors', 'umami', 'realtime'] },
      { label: 'Reports', href: '/analytics/reports', aliases: ['exports', 'tables'] },
    ],
  },
  {
    id: 'settings', label: 'Settings', href: '/settings', icon: Settings2, role: 'admin',
    description: 'Workspace, team, connections and privacy.',
    items: [
      { label: 'Company', href: '/settings', aliases: ['branding', 'profile'] },
      { label: 'Team', href: '/settings/team', aliases: ['users', 'roles', 'permissions'] },
      { label: 'Mailboxes', href: '/settings/mailboxes', aliases: ['gmail', 'outlook', 'email accounts'] },
      { label: 'Connections', href: '/settings/connections', aliases: ['smtp', 'dns', 'engines', 'health'] },
      { label: 'Data & privacy', href: '/settings/privacy', aliases: ['gdpr', 'backup', 'export', 'licences'] },
    ],
  },
];

/** Global quick-create actions. Each href opens the creation flow directly. */
export const createActions: { label: string; href: string; role: Role; group: string }[] = [
  { label: 'Contact', href: '/crm?create=contact', role: 'marketer', group: 'CRM' },
  { label: 'Company', href: '/crm/companies?create=company', role: 'marketer', group: 'CRM' },
  { label: 'Deal', href: '/sales?create=deal', role: 'marketer', group: 'Sales' },
  { label: 'Task', href: '/sales/tasks?create=task', role: 'marketer', group: 'Sales' },
  { label: 'Campaign', href: '/marketing?create=campaign', role: 'marketer', group: 'Marketing' },
  { label: 'Email', href: '/marketing/templates?create=email', role: 'marketer', group: 'Marketing' },
  { label: 'Landing page', href: '/sites?create=page', role: 'marketer', group: 'Sites & Forms' },
  { label: 'Form', href: '/sites/forms?create=form', role: 'marketer', group: 'Sites & Forms' },
  { label: 'Workflow', href: '/automations/templates', role: 'marketer', group: 'Automations' },
];

export const roleRank: Record<Role, number> = { analyst: 0, marketer: 1, admin: 2 };

export function allowed(role: Role, needed: Role | undefined) {
  return roleRank[role] >= roleRank[needed ?? 'analyst'];
}

/** The workspace and sub-page for a pathname. The longest matching href wins. */
export function locate(pathname: string): { workspace?: Workspace; leaf?: NavLeaf; isDetail: boolean } {
  const workspace = workspaces
    .filter(item => pathname === item.href || pathname.startsWith(item.href + '/'))
    .sort((a, b) => b.href.length - a.href.length)[0];
  if (!workspace) return { isDetail: false };
  const leaf = workspace.items
    .filter(item => pathname === item.href || pathname.startsWith(item.href + '/'))
    .sort((a, b) => b.href.length - a.href.length)[0];
  const exact = workspace.items.some(item => item.href === pathname) || workspace.href === pathname;
  return { workspace, leaf, isDetail: !exact };
}
