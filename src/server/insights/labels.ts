// Names for pages, forms, funnels and flows owned by other lanes, read through their published console API
// (docs/rebuild/TRACKER.md cross-lane contracts) in-process. A lane that is absent or failing yields no names,
// and reports fall back to the names recorded on the events.
import type { User } from '@/contracts';
import type { Role } from '@/contracts';

export type LaneItem = { id: string; name?: string; status?: string; url?: string };

const rank: Record<Role, number> = { analyst: 1, marketer: 2, admin: 3 };

export async function laneItems(path: string, user: User): Promise<LaneItem[] | null> {
  const { laneModules } = await import('../platform/modules');
  for (const lane of laneModules) {
    for (const entry of lane.endpoints) {
      if (entry.method !== 'GET') continue;
      const match = entry.path.exec(path);
      if (!match) continue;
      if (rank[user.role] < rank[entry.role]) return null;
      try {
        const result = await entry.handler({
          request: new Request('http://ovelio.internal/api/console/' + path), user, params: match.slice(1), query: new URLSearchParams(),
        });
        if (result instanceof Response) return null;
        const items = (result as { items?: unknown } | null)?.items;
        return Array.isArray(items) ? items.map(item => ({ ...item, id: String((item as LaneItem).id) })) as LaneItem[] : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export async function laneNames(path: string, user: User): Promise<Map<string, string>> {
  const items = await laneItems(path, user);
  return new Map((items ?? []).filter(item => item.name).map(item => [item.id, String(item.name)]));
}

export const shortId = (id: string) => id.length > 10 ? id.slice(0, 8) : id;
