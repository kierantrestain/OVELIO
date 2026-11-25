// Lane module: see docs/rebuild/TRACKER.md for ownership. The lead registers this file once; keep its export shape.
import type { LaneModule } from '../platform/types';
import { dealEndpoints } from './deals';
import { pipelineEndpoints } from './pipelines';
import { REMINDER_JOB, runTaskReminder, taskEndpoints } from './tasks';

export const crmModule: LaneModule = {
  name: 'crm',
  endpoints: [...pipelineEndpoints, ...dealEndpoints, ...taskEndpoints],
  jobHandlers: {
    [REMINDER_JOB]: runTaskReminder,
  },
  async onPlatformEvent() {},
  async search() { return []; },
  async seedPreview() {},
};
