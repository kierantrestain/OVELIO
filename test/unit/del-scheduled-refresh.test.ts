import assert from 'node:assert/strict';
import test from 'node:test';
import type { Campaign } from '../../src/contracts';
import {
  holdMarginMs, refreshLeadMs, registerRefresh, runCampaignRefresh, sweepScheduledRefreshes, withPreSendRefresh,
} from '../../src/server/delivery';
import type { CampaignRefreshJob, RefreshDeps, RefreshRecord, RefreshState, RefreshStore } from '../../src/server/delivery';
import { createListmonk } from '../../src/server/listmonk';

const minute = 60_000;
const sendAt = Date.parse('2030-01-01T12:00:00Z');

/** In-memory twin of the Postgres store, with the same fencing rules. */
function memoryStore() {
  const records = new Map<number, RefreshRecord>();
  const contacts = new Map<string, 'member'>();
  const stale = new Map<string, { subscriberId: number; mauticId: number | null }>();
  let runs = 0;
  const key = (run: string, segment: number, contact: number) => `${run}/${segment}/${contact}`;
  const active: RefreshState[] = ['waiting', 'refreshing', 'held'];
  const locks = new Set<number>();
  const store: RefreshStore & { records: typeof records; contacts: typeof contacts; stale: typeof stale } = {
    records, contacts, stale,
    async get(id) { return records.get(id) && { ...records.get(id)! }; },
    async byCampaigns(ids) { return ids.flatMap(id => records.has(id) ? [{ ...records.get(id)! }] : []); },
    async active() { return [...records.values()].filter(item => active.includes(item.state)).map(item => ({ ...item })); },
    async register(id, at) {
      const old = records.get(id);
      if (old && Date.parse(old.sendAt) === Date.parse(at) && active.includes(old.state)) return;
      if (old) for (const m of [contacts, stale]) for (const k of [...m.keys()]) if (k.startsWith(old.runId + '/')) m.delete(k);
      records.set(id, { campaignId: id, sendAt: new Date(at).toISOString(), state: 'waiting', runId: 'run-' + ++runs, progress: null, errors: 0, message: '', updatedAt: '' });
    },
    async update(rec, patch, from = active) {
      const row = records.get(rec.campaignId);
      if (!row || row.runId !== rec.runId || !from.includes(row.state)) return false;
      records.set(rec.campaignId, { ...row, ...patch, progress: patch.progress === undefined ? row.progress : structuredClone(patch.progress) });
      return true;
    },
    async cancel(id, message) {
      const row = records.get(id);
      if (row && active.includes(row.state)) records.set(id, { ...row, state: 'cancelled', message });
    },
    async remember(run, segment, ids) { for (const id of ids) if (!contacts.has(key(run, segment, id))) contacts.set(key(run, segment, id), 'member'); },
    async notMembers(run, segment, ids) { return ids.filter(id => contacts.get(key(run, segment, id)) !== 'member'); },
    async rememberStale(run, segment, entries) { for (const entry of entries) stale.set(key(run, segment, entry.subscriberId), entry); },
    async staleBatch(run, segment, limit) {
      return [...stale].filter(([k]) => k.startsWith(`${run}/${segment}/`)).map(([, entry]) => entry).sort((a, b) => a.subscriberId - b.subscriberId).slice(0, limit);
    },
    async forgetStale(run, segment, ids) { for (const id of ids) stale.delete(key(run, segment, id)); },
    async clear(run) { for (const m of [contacts, stale]) for (const k of [...m.keys()]) if (k.startsWith(run + '/')) m.delete(k); },
    async prune() {},
    async lock(id, work) {
      if (locks.has(id)) return undefined;
      locks.add(id);
      try { return await work(); } finally { locks.delete(id); }
    },
  };
  return store;
}

type Setup = {
  members?: number[]; listed?: { id: number; email: string; mauticId: number | null }[];
  status?: string; pageSize?: number; isMember?: (id: number) => boolean; failSync?: (id: number) => boolean; published?: boolean; maxSteps?: number;
};

function harness(options: Setup = {}) {
  const store = memoryStore();
  const state = { now: sendAt - 20 * minute, status: options.status ?? 'scheduled', sendAt: new Date(sendAt).toISOString() as string | null };
  const calls: string[] = [];
  const activity: string[] = [];
  const queued: CampaignRefreshJob[] = [];
  const synced: number[] = [];
  const unlisted: number[] = [];
  const members = options.members ?? [1, 2, 3];
  const listed = options.listed ?? [];
  const pageSize = options.pageSize ?? 100;
  const campaign = (): Campaign => ({
    id: 7, name: 'Launch', subject: 'Hi', body: '', listIds: [70], status: state.status, sendAt: state.sendAt, createdAt: null,
    metrics: { sent: null, delivered: null, opens: null, clicks: null, bounces: null, unsubscribes: null },
  });
  const deps: RefreshDeps = {
    store, now: () => state.now,
    campaign: async () => campaign(),
    scheduled: async () => state.status === 'scheduled' ? [campaign()] : [],
    hold: async () => { calls.push('hold'); assert.equal(state.status, 'scheduled'); state.status = 'draft'; },
    resume: async () => { calls.push('resume'); assert.equal(state.status, 'draft'); state.status = 'scheduled'; },
    pause: async () => { calls.push('pause'); state.status = 'paused'; },
    locked: async (_id, work) => work(),
    sync: {
      mappings: async () => [{ segmentId: 5, listId: 70 }],
      segments: async () => [{ id: 5, name: 'Customers', published: options.published ?? true }],
      members: async (_segment, page) => ({ ids: members.slice((page - 1) * pageSize, page * pageSize), total: members.length, limit: pageSize }),
      listSubscribers: async (_list, page) => ({ items: listed.slice((page - 1) * pageSize, page * pageSize), total: listed.length, limit: pageSize, page } as never),
      syncContact: async id => { if (options.failSync?.(id)) throw new Error('mautic down'); synced.push(id); },
      isMember: async id => options.isMember ? options.isMember(id) : members.includes(id),
      removeFromList: async id => { unlisted.push(id); },
    },
    activity: async text => { activity.push(text); },
    queue: async job => { queued.push(job); },
    maxSteps: options.maxSteps,
  };
  const record = () => store.records.get(7)!;
  /** One worker tick: the housekeeping sweep, then the queued job if there is one. */
  const tick = async () => {
    queued.length = 0;
    await sweepScheduledRefreshes(deps);
    for (const job of [...queued]) await runCampaignRefresh(job.campaignId, job.runId, deps);
  };
  return { deps, store, state, calls, activity, queued, synced, unlisted, record, tick };
}

test('DEL-22 the refresh stays closed until shortly before send_at', async () => {
  const h = harness();
  await h.tick();
  assert.equal(h.record().state, 'waiting', 'discovered and registered, but nothing refreshed yet');
  assert.deepEqual(h.synced, []);
  assert.deepEqual(h.queued, []);
  h.state.now = sendAt - refreshLeadMs + 1000;
  await h.tick();
  assert.equal(h.record().state, 'ready');
  assert.deepEqual(h.synced.sort(), [1, 2, 3]);
  assert.deepEqual(h.calls, [], 'a refresh that finishes in time never touches the campaign');
});

test('DEL-22 contacts that left the segment are removed from the list before the send', async () => {
  const h = harness({ members: [1, 2], listed: [{ id: 1, email: 'a@x.test', mauticId: 1 }, { id: 9, email: 'gone@x.test', mauticId: 9 }, { id: 10, email: 'n@x.test', mauticId: null }] });
  h.state.now = sendAt - 5 * minute;
  await h.tick();
  assert.equal(h.record().state, 'ready');
  assert.ok(h.synced.includes(9), 'the departed contact is reconciled so it leaves the list');
  assert.equal(h.synced.filter(id => id === 9).length, 1);
  assert.deepEqual([...h.unlisted].sort((a, b) => a - b), [9, 10], 'subscribers 9 and 10 are taken off the list');
  assert.equal(h.store.contacts.size + h.store.stale.size, 0, 'working rows are cleared');
});

test('DEL-22 a large segment is refreshed over several slices and resumes from its saved cursor', async () => {
  const members = Array.from({ length: 250 }, (_, i) => i + 1);
  const h = harness({ members, pageSize: 100, maxSteps: 1 }); // one page per slice
  h.state.now = sendAt - 9 * minute;
  await h.tick();
  assert.equal(h.record().state, 'refreshing');
  assert.equal(h.record().progress?.[0].phase, 'members');
  const first = h.synced.length;
  assert.ok(first > 0 && first < 250);
  for (let i = 0; i < 20 && h.record().state === 'refreshing'; i++) await h.tick();
  assert.equal(h.record().state, 'ready');
  assert.equal(new Set(h.synced).size, 250);
  assert.equal(h.calls.length, 0);
});

test('DEL-22 an unfinished refresh near send_at holds the campaign, then resumes it on time', async () => {
  const h = harness({ members: Array.from({ length: 150 }, (_, i) => i + 1), pageSize: 100, maxSteps: 1 });
  h.state.now = sendAt - 3 * minute;
  await h.tick();
  assert.equal(h.record().state, 'refreshing');
  h.state.now = sendAt - holdMarginMs + 1000;
  await h.tick();
  assert.deepEqual(h.calls, ['hold']);
  assert.equal(h.state.status, 'draft', 'Listmonk cannot start a draft');
  assert.equal(h.record().state, 'held');
  assert.match(h.activity.join('\n'), /held while its recipients finish refreshing/);
  h.deps.maxSteps = undefined;
  h.state.now = sendAt - 30_000;
  await h.tick();
  assert.deepEqual(h.calls, ['hold', 'resume']);
  assert.equal(h.state.status, 'scheduled');
  assert.equal(h.record().state, 'ready');
});

test('DEL-22 a refresh that finishes after send_at starts at once and is shown as sent late with the reason', async () => {
  const h = harness();
  h.state.now = sendAt - 60_000;
  await sweepScheduledRefreshes(h.deps); // opens the refresh and holds, it is inside the hold margin
  assert.equal(h.record().state, 'held');
  h.state.now = sendAt + 4 * minute;
  await runCampaignRefresh(7, h.record().runId, h.deps);
  assert.equal(h.record().state, 'late');
  assert.deepEqual(h.calls, ['hold', 'resume'], 'resumed straight away, never silently');
  assert.match(h.record().message, /Sent late: .*4 minutes after the scheduled time/);
  assert.match(h.activity.join('\n'), /started late/);
});

test('DEL-22 a failed refresh unschedules the campaign and tells the user why', async () => {
  const h = harness({ failSync: id => id === 2 });
  h.state.now = sendAt - 5 * minute;
  for (let i = 0; i < 3; i++) await h.tick();
  assert.equal(h.record().state, 'failed');
  assert.equal(h.state.status, 'draft', 'it must not send');
  assert.deepEqual(h.calls, ['hold']);
  assert.match(h.record().message, /could not be refreshed before the scheduled send.*was not sent/);
  assert.match(h.activity.join('\n'), /was not sent: its recipients could not be refreshed/);
  assert.equal(h.store.contacts.size, 0);
});

test('DEL-22 an unpublished segment fails at once without retries', async () => {
  const h = harness({ published: false });
  h.state.now = sendAt - 5 * minute;
  await h.tick();
  assert.equal(h.record().state, 'failed');
  assert.match(h.record().message, /"Customers" is no longer published/);
  assert.equal(h.state.status, 'draft');
});

test('DEL-22 rescheduling mid-refresh starts a new run and the old one stops', async () => {
  const h = harness({ members: Array.from({ length: 150 }, (_, i) => i + 1), pageSize: 100, maxSteps: 1 });
  h.state.now = sendAt - 8 * minute;
  await h.tick();
  const stale = h.record().runId;
  assert.ok(h.store.contacts.size > 0);
  const later = sendAt + 60 * minute;
  h.state.sendAt = new Date(later).toISOString();
  await registerRefresh(7, h.state.sendAt, h.deps);
  assert.notEqual(h.record().runId, stale);
  assert.equal(h.record().state, 'waiting');
  assert.equal(h.store.contacts.size, 0, 'rows of the old run are dropped');
  const before = h.synced.length;
  await runCampaignRefresh(7, stale, h.deps);
  assert.equal(h.synced.length, before, 'stale job does nothing');
  assert.equal(h.record().state, 'waiting');
});

test('DEL-22 registering the same send time again leaves a running refresh alone', async () => {
  const h = harness();
  h.state.now = sendAt - 5 * minute;
  await h.tick();
  h.store.records.set(7, { ...h.record(), state: 'refreshing' });
  const run = h.record().runId;
  await registerRefresh(7, new Date(sendAt).toISOString(), h.deps);
  assert.equal(h.record().runId, run);
});

test('DEL-22 cancelling the schedule while a refresh is pending ends it', async () => {
  const h = harness({ members: Array.from({ length: 150 }, (_, i) => i + 1), pageSize: 100, maxSteps: 1 });
  h.state.now = sendAt - 8 * minute;
  await h.tick();
  h.state.status = 'draft'; // the user cancelled the schedule
  await h.tick();
  assert.equal(h.record().state, 'cancelled');
  assert.equal(h.store.contacts.size, 0);
  assert.deepEqual(h.calls, []);
});

test('DEL-22 a send that began before the refresh finished is reported, not hidden', async () => {
  const h = harness();
  h.state.now = sendAt - 5 * minute;
  await sweepScheduledRefreshes(h.deps);
  h.state.status = 'running'; // Listmonk started it while the worker was down
  await runCampaignRefresh(7, h.record().runId, h.deps);
  assert.equal(h.record().state, 'missed');
  assert.match(h.record().message, /Sending began before the recipient refresh finished/);
  assert.match(h.activity.join('\n'), /started before its recipients were refreshed/);
});

test('DEL-22 only one worker advances a campaign at a time', async () => {
  const h = harness();
  h.state.now = sendAt - 5 * minute;
  await sweepScheduledRefreshes(h.deps);
  const run = h.record().runId;
  let inner: Promise<void> | undefined;
  const original = h.deps.sync.members;
  h.deps.sync.members = async (...args) => {
    inner ??= runCampaignRefresh(7, run, h.deps); // a second worker arrives mid-run
    return original(...args);
  };
  await runCampaignRefresh(7, run, h.deps);
  await inner;
  assert.deepEqual(h.synced.sort(), [1, 2, 3], 'each contact synced once, by the first worker only');
});

test('DEL-22 repeating a finished job after a restart changes nothing', async () => {
  const h = harness();
  h.state.now = sendAt - 5 * minute;
  await h.tick();
  const run = h.record().runId;
  const calls = h.synced.length;
  await runCampaignRefresh(7, run, h.deps);
  await h.tick();
  assert.equal(h.synced.length, calls);
  assert.equal(h.record().state, 'ready');
});

test('DEL-22 console state carries the refresh window and reason', async () => {
  const h = harness();
  await h.tick();
  const [scheduled] = await h.deps.scheduled();
  const items = await withPreSendRefresh([scheduled], async ids => h.store.byCampaigns(ids));
  assert.equal(items[0].preSendRefresh?.state, 'waiting');
  assert.equal(items[0].preSendRefresh?.refreshFrom, new Date(sendAt - refreshLeadMs).toISOString());
  const running = await withPreSendRefresh([{ ...scheduled, status: 'running' }], async ids => h.store.byCampaigns(ids));
  assert.equal(running[0].preSendRefresh, undefined, 'a stale waiting record is not shown on a running campaign');
});

test('DEL-22 Listmonk only puts a held draft with a send time back on the schedule', async () => {
  const puts: unknown[] = [];
  let native: Record<string, unknown> = { id: 7, name: 'n', subject: 's', status: 'draft', send_at: '2030-01-01T12:00:00Z', lists: [{ id: 70 }] };
  const adapter = createListmonk({
    url: 'https://listmonk.example', username: 'service', password: 'secret',
    fetch: async (input, init) => {
      const url = new URL(String(input));
      if (init?.method === 'PUT') { puts.push([url.pathname, JSON.parse(String(init.body))]); native = { ...native, status: 'scheduled' }; }
      return Response.json({ data: native });
    },
  });
  const resumed = await adapter.resumeSchedule(7);
  assert.deepEqual(puts, [['/api/campaigns/7/status', { status: 'scheduled' }]]);
  assert.equal(resumed.status, 'scheduled');
  native = { ...native, status: 'draft', send_at: null };
  await assert.rejects(adapter.resumeSchedule(7), /held newsletter with a send time/);
});

/* ── Stale subscribers are removed directly, not through syncContact ───────── */

const listedStale = (...entries: [number, number | null][]) => entries.map(([id, mauticId]) => ({ id, email: `s${id}@x.test`, mauticId }));

test('DEL-22 a contact deleted in Mautic is taken off the list even though syncContact does nothing', async () => {
  const h = harness({ members: [1], listed: listedStale([101, 1], [109, 9]), isMember: id => id === 1 });
  h.state.now = sendAt - 5 * minute;
  await h.tick();
  assert.equal(h.record().state, 'ready');
  assert.deepEqual(h.unlisted, [109]);
});

test('DEL-22 a contact whose email changed or has unknown consent is still removed from the list', async () => {
  // syncContact returns early for both; the direct removal must still happen.
  const h = harness({ members: [1], listed: listedStale([101, 1], [102, 2], [103, 3]), isMember: id => id === 1 });
  h.state.now = sendAt - 5 * minute;
  await h.tick();
  assert.deepEqual(h.unlisted, [102, 103]);
  assert.equal(h.record().progress, null);
});

test('DEL-22 a mirror-list subscriber with no contact id is stale and removed', async () => {
  const h = harness({ members: [1], listed: listedStale([101, 1], [150, null]) });
  h.state.now = sendAt - 5 * minute;
  await h.tick();
  assert.deepEqual(h.unlisted, [150]);
});

test('DEL-22 a member missed by drifting pages is re-checked, kept and re-synced', async () => {
  // Contact 4 is a real member the member paging skipped, so it looks stale on the list.
  const h = harness({ members: [1, 2], listed: listedStale([101, 1], [104, 4]), isMember: id => [1, 2, 4].includes(id) });
  h.state.now = sendAt - 5 * minute;
  await h.tick();
  assert.deepEqual(h.unlisted, [], 'it keeps its subscription');
  assert.ok(h.synced.includes(4), 'and is synced so it is on the list');
});

test('DEL-22 a failed removal fails the refresh instead of leaving the subscriber on the list', async () => {
  const h = harness({ members: [1], listed: listedStale([101, 1], [109, 9]), isMember: id => id === 1 });
  h.deps.sync.removeFromList = async () => { throw new Error('listmonk down'); };
  h.state.now = sendAt - 5 * minute;
  for (let i = 0; i < 3; i++) await h.tick();
  assert.equal(h.record().state, 'failed');
  assert.equal(h.state.status, 'draft');
});
