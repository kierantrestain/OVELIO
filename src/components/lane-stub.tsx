'use client';

// Temporary route body while a lane builds this page. Acceptance fails while any LaneStub remains (docs/rebuild/TRACKER.md).
import { Panel, PageHeader, Empty } from './ui';

export function LaneStub({ title, lane }: { title: string; lane: string }) {
  return <div className="ov-stack">
    <PageHeader title={title} />
    <Panel><Empty title="Not built yet" description={`Owned by ${lane}.`} /></Panel>
  </div>;
}
