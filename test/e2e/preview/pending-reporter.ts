import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';

/** Lists routes that still render a lane placeholder, so pending work is visible without failing the run. */
export default class PendingReporter implements Reporter {
  private pending: string[] = [];

  onTestEnd(test: TestCase, result: TestResult) {
    for (const note of [...test.annotations, ...result.annotations]) {
      if (note.type === 'pending') this.pending.push(`${test.parent.project()?.name ?? ''} ${test.title}: ${note.description ?? ''}`);
    }
  }

  onEnd() {
    if (!this.pending.length) return;
    console.log(`\n${this.pending.length} pending (lane placeholder, not a failure):`);
    for (const line of [...new Set(this.pending)].sort()) console.log('  - ' + line);
  }

  printsToStdio() {
    return false;
  }
}
