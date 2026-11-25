// Lead-owned platform endpoints shared by every workspace: global search, team directory, saved views, event timeline.
import { z } from 'zod';
import type { Role } from '@/contracts';
import type { SavedView, SearchResult } from '@/contracts/platform';
import { platformEventTypes } from '@/contracts/platform';
import { AppError } from '../config';
import { db } from '../db';
import { isDevPreviewMode } from '../dev-preview';
import { searchCompanies, searchContacts } from '../directory';
import { listEvents } from '../events';
import { laneModules } from '../platform/modules';
import { route } from './shared';
import type { Entry } from './shared';

const rank: Record<Role, number> = { analyst: 1, marketer: 2, admin: 3 };

const viewFilter = z.object({
  field: z.string().trim().min(1).max(80),
  operator: z.enum(['eq', 'neq', 'contains', 'gt', 'gte', 'lt', 'lte', 'in', 'empty', 'not_empty', 'before', 'after']),
  value: z.union([z.string().max(500), z.number(), z.array(z.string().max(200)).max(100)]).optional(),
});
const viewInput = z.object({
  object: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(80),
  filters: z.array(viewFilter).max(30).default([]),
  columns: z.array(z.string().trim().min(1).max(80)).max(40).default([]),
  sort: z.object({ field: z.string().trim().min(1).max(80), direction: z.enum(['asc', 'desc']) }).nullable().default(null),
  shared: z.boolean().default(true),
});

type ViewRow = { id: string; object: string; name: string; filters: SavedView['filters']; columns: string[]; sort: SavedView['sort']; shared: boolean; owner_id: string | null; created_at: Date };
const toView = (row: ViewRow): SavedView => ({
  id: row.id, object: row.object, name: row.name, filters: row.filters, columns: row.columns, sort: row.sort,
  shared: row.shared, ownerId: row.owner_id, createdAt: new Date(row.created_at).toISOString(),
});

async function globalSearch(query: string, role: Role, user: Parameters<typeof laneModules[number]['search']>[1]): Promise<SearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const tasks: Promise<SearchResult[]>[] = [];
  if (rank[role] >= rank.marketer) {
    tasks.push(searchContacts(q, 5).then(items => items.map(item => ({
      id: 'contact:' + item.id, kind: 'contact' as const, title: item.name, subtitle: [item.email, item.company].filter(Boolean).join(' · '), href: `/crm/contacts/${item.id}`,
    }))));
    tasks.push(searchCompanies(q, 5).then(items => items.map(item => ({
      id: 'company:' + item.id, kind: 'company' as const, title: item.name, subtitle: item.website || item.industry, href: `/crm/companies/${item.id}`,
    }))));
  }
  for (const lane of laneModules) tasks.push(lane.search(q, user));
  const settled = await Promise.allSettled(tasks);
  return settled.flatMap(result => result.status === 'fulfilled' ? result.value.slice(0, 5) : []).slice(0, 40);
}

export const platformEndpoints: Entry[] = [
  route('GET', /^platform\/status$/, async () => ({
    preview: isDevPreviewMode(),
    database: process.env.DATABASE_URL ? 'postgresql' : 'embedded',
  })),
  route('GET', /^platform\/search$/, async ({ query, user }) => ({ items: await globalSearch(query.get('q') ?? '', user.role, user) })),
  route('GET', /^platform\/users$/, async () => {
    const result = await db.query<{ id: string; email: string; name: string; role: Role }>(
      'SELECT id, email, name, role FROM users WHERE disabled_at IS NULL ORDER BY name',
    );
    return result.rows;
  }),
  route('GET', /^platform\/events$/, async ({ query }) => {
    const types = (query.get('types') ?? '').split(',').filter(type => (platformEventTypes as readonly string[]).includes(type));
    return listEvents({
      contactId: query.get('contactId') ? Number(query.get('contactId')) : undefined,
      companyId: query.get('companyId') ? Number(query.get('companyId')) : undefined,
      dealId: query.get('dealId') ?? undefined,
      campaignId: query.get('campaignId') ?? undefined,
      entityType: query.get('entityType') ?? undefined,
      entityId: query.get('entityId') ?? undefined,
      types: types as never,
      limit: Number(query.get('limit') ?? 100),
    });
  }),
  route('GET', /^platform\/views$/, async ({ query, user }) => {
    const object = z.string().min(1).max(40).parse(query.get('object'));
    const result = await db.query<ViewRow>(
      `SELECT * FROM saved_views WHERE object = $1 AND (shared OR owner_id = $2) ORDER BY lower(name)`,
      [object, user.id],
    );
    return result.rows.map(toView);
  }, 'marketer'),
  route('POST', /^platform\/views$/, async ({ request, user }) => {
    const input = viewInput.parse(await request.json());
    const result = await db.query<ViewRow>(
      `INSERT INTO saved_views (object, name, filters, columns, sort, shared, owner_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [input.object, input.name, JSON.stringify(input.filters), JSON.stringify(input.columns), input.sort ? JSON.stringify(input.sort) : null, input.shared, user.id],
    );
    return toView(result.rows[0]);
  }, 'marketer'),
  route('PATCH', /^platform\/views\/([0-9a-f-]{36})$/, async ({ request, params, user }) => {
    const input = viewInput.partial().parse(await request.json());
    const current = (await db.query<ViewRow>('SELECT * FROM saved_views WHERE id = $1', [params[0]])).rows[0];
    if (!current) throw new AppError(404, 'That view was not found.');
    if (current.owner_id && current.owner_id !== user.id && user.role !== 'admin') throw new AppError(403, 'Only the owner or an admin can change this view.');
    const next = { ...toView(current), ...input };
    const result = await db.query<ViewRow>(
      `UPDATE saved_views SET name = $2, filters = $3, columns = $4, sort = $5, shared = $6, updated_at = now() WHERE id = $1 RETURNING *`,
      [params[0], next.name, JSON.stringify(next.filters), JSON.stringify(next.columns), next.sort ? JSON.stringify(next.sort) : null, next.shared],
    );
    return toView(result.rows[0]);
  }, 'marketer'),
  route('DELETE', /^platform\/views\/([0-9a-f-]{36})$/, async ({ params, user }) => {
    const current = (await db.query<ViewRow>('SELECT * FROM saved_views WHERE id = $1', [params[0]])).rows[0];
    if (!current) return new Response(null, { status: 204 });
    if (current.owner_id && current.owner_id !== user.id && user.role !== 'admin') throw new AppError(403, 'Only the owner or an admin can delete this view.');
    await db.query('DELETE FROM saved_views WHERE id = $1', [params[0]]);
    return new Response(null, { status: 204 });
  }, 'marketer'),
];
