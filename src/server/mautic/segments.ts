import type { Segment, SegmentInput } from '../../contracts';
import { requiredId, toSegment, type ApiRecord } from './normalize';
import { segmentFiltersPayload } from './helpers';
import type { Client } from './client';

export function segmentsApi(client: Client) {
  const { request, list, write, remove } = client;
  return {
    async segments(): Promise<Segment[]> {
      return (await list('/segments', 'lists')).map(toSegment).sort((a, b) => a.name.localeCompare(b.name));
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
