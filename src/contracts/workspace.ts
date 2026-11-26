// Per-user workspace features (Product Engineering): notifications, starred and recent records, preferences.

export type AppNotification = {
  id: string;
  kind: 'task.assigned' | 'task.reminder' | 'form.lead' | 'flow.failed' | 'deal.won' | string;
  title: string;
  body: string;
  href: string | null;
  read: boolean;
  createdAt: string;
};

export type NotificationList = { items: AppNotification[]; unread: number };

export const recordKinds = ['deal', 'contact', 'company', 'campaign', 'page', 'flow'] as const;
export type RecordKind = (typeof recordKinds)[number];

export type RecordMark = { kind: RecordKind; recordId: string; label: string; href: string; at: string };

export type RecordMarks = { starred: RecordMark[]; recent: RecordMark[] };

export type TableDensity = 'comfortable' | 'compact';

/** Overview widgets in display order, and which are hidden. */
export type OverviewLayout = { order: string[]; hidden: string[] };

export type Preferences = { density: TableDensity; overview: OverviewLayout | null };

/** Record pages that are tracked as recents and can be starred, by path. */
export const recordRoutes: { kind: RecordKind; pattern: RegExp; href: (id: string) => string }[] = [
  { kind: 'deal', pattern: /^\/sales\/deals\/([0-9a-f-]{36})$/, href: id => `/sales/deals/${id}` },
  { kind: 'contact', pattern: /^\/crm\/contacts\/(\d+)$/, href: id => `/crm/contacts/${id}` },
  { kind: 'company', pattern: /^\/crm\/companies\/(\d+)$/, href: id => `/crm/companies/${id}` },
  { kind: 'campaign', pattern: /^\/marketing\/campaigns\/([0-9a-f-]{36})$/, href: id => `/marketing/campaigns/${id}` },
  { kind: 'page', pattern: /^\/studio\/page\/([0-9a-f-]{36})$/, href: id => `/studio/page/${id}` },
  { kind: 'flow', pattern: /^\/automations\/flows\/([0-9a-f-]{36})$/, href: id => `/automations/flows/${id}` },
];

export function recordAt(pathname: string): { kind: RecordKind; recordId: string } | null {
  for (const item of recordRoutes) {
    const match = item.pattern.exec(pathname);
    if (match) return { kind: item.kind, recordId: match[1] };
  }
  return null;
}
