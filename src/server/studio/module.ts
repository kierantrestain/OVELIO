// Lane module: see docs/rebuild/TRACKER.md for ownership. The lead registers this file once; keep its export shape.
import type { LaneModule } from '../platform/types';

export const studioModule: LaneModule = {
  name: 'studio',
  endpoints: [],
  jobHandlers: {},
  async onPlatformEvent() {},
  async search() { return []; },
  async seedPreview() {},
};
