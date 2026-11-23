import type { Segment, SegmentInput, SegmentOptions } from '../../contracts';
import { items, requiredId, text, toSegment, type ApiRecord } from './normalize';
import { segmentFiltersPayload } from './helpers';
import type { Client } from './client';

export function segmentsApi(client: Client) {
  const { request, list, write, remove } = client;
  return {
    /** AUD-06: `withCounts` adds each segment's member count (Controller/Api/ListApiController.php:91-120). */
    async segments(): Promise<Segment[]> {
      const query = new URLSearchParams({ withCounts: '1' });
      return (await list('/segments', 'lists', query)).map(toSegment).sort((a, b) => a.name.localeCompare(b.name));
    },

    /** AUD-04: owners and point groups feed the owner and point-group filters (LeadApiController.php:96-115). */
    async segmentOptions(): Promise<SegmentOptions> {
      const [owners, groups] = await Promise.all([
        request('/contacts/list/owners?limit=200').then(response => items(response), () => []),
        request('/points/groups?limit=200').then(response => items(response.pointGroups), () => []),
      ]);
      return {
        owners: owners.map(owner => ({
          id: requiredId(owner.id),
          name: `${text(owner.firstName)} ${text(owner.lastName)}`.trim() || text(owner.email) || `User ${owner.id}`,
        })),
        pointGroups: groups.map(group => ({ id: requiredId(group.id), name: text(group.name) || `Group ${group.id}` })),
      };
    },

    async createSegment(input: SegmentInput): Promise<Segment> {
      return toSegment(await write('/segments/new', 'list', 'POST', {
        name: input.name,
        description: input.description,
        isPublished: input.published ?? true,
        ...(input.filters !== undefined ? { filters: segmentFiltersPayload(input.filters) } : {}),
      }));
    },

    async updateSegment(id: number, input: Partial<SegmentInput>): Promise<Segment> {
      const payload: ApiRecord = {};
      if (input.name !== undefined) payload.name = input.name;
      if (input.description !== undefined) payload.description = input.description;
      if (input.published !== undefined) payload.isPublished = input.published;
      if (input.filters !== undefined) payload.filters = segmentFiltersPayload(input.filters);
      return toSegment(await write(`/segments/${requiredId(id)}/edit`, 'list', 'PATCH', payload));
    },

    async deleteSegment(id: number): Promise<void> {
      await remove(`/segments/${requiredId(id)}/delete`);
    },

    async addToSegment(segmentId: number, contactId: number) {
      await request(`/segments/${requiredId(segmentId)}/contact/${requiredId(contactId)}/add`, 'POST');
    },

    async removeFromSegment(segmentId: number, contactId: number) {
      await request(`/segments/${requiredId(segmentId)}/contact/${requiredId(contactId)}/remove`, 'POST');
    },
  };
}
