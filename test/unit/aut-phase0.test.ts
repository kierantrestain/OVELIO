import assert from 'node:assert/strict';
import test from 'node:test';
import { maxWorkflowSteps } from '../../src/contracts';
import type { WorkflowInput } from '../../src/contracts';
import { workflowPayload } from '../../src/server/mautic/workflows';
import { UpstreamError } from '../../src/server/upstream';

const input = (count: number): WorkflowInput => ({
  name: 'Limit check',
  segmentId: 3,
  steps: Array.from({ length: count }, (_, index) => ({ emailId: index + 1, delayMinutes: 0 })),
});

test('AUT-01 the editor, route and adapter share one workflow step limit', () => {
  assert.equal(maxWorkflowSteps, 20);
  assert.doesNotThrow(() => workflowPayload(input(maxWorkflowSteps)));
  assert.throws(() => workflowPayload(input(maxWorkflowSteps + 1)), (error: unknown) =>
    error instanceof UpstreamError && error.status === 400 && /between 1 and 20/.test(error.message));
});
