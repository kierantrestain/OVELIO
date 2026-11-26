// Lane module: see docs/rebuild/TRACKER.md for ownership. The lead registers this file once; keep its export shape.
import type { SearchResult } from '@/contracts/platform';
import { db } from '../db';
import type { LaneModule } from '../platform/types';
import { dealEndpoints } from './deals';
import { forecastEndpoints } from './forecast';
import { duplicateEndpoints } from './duplicates';
import { importEndpoints } from './imports';
import { listEndpoints } from './lists';
import { MAILBOX_SYNC_JOB, mailboxEndpoints, runMailboxSync } from './mailboxes';
import { peopleEndpoints } from './people';
import { pipelineEndpoints } from './pipelines';
import { seedCrmPreview } from './seed';
import { SEQUENCE_JOB, runSequenceStep, sequenceEndpoints, stopOnEvent } from './sequences';
import { REMINDER_JOB, runTaskReminder, taskEndpoints } from './tasks';

const money = (amount: string, currency: string) => new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(amount));

export async function searchSales(query: string): Promise<SearchResult[]> {
  const like = `%${query.trim().replace(/[%_\\]/g, '\\$&')}%`;
  const [deals, tasks] = await Promise.all([
    db.query<{ id: string; name: string; amount: string; currency: string; company_name: string; status: string }>(
      `SELECT id, name, amount, currency, company_name, status FROM deals
       WHERE archived_at IS NULL AND (name ILIKE $1 OR company_name ILIKE $1 OR contact_name ILIKE $1 OR contact_email ILIKE $1)
       ORDER BY status = 'open' DESC, updated_at DESC LIMIT 4`, [like]),
    db.query<{ id: string; title: string; due_at: Date | null }>(
      `SELECT id, title, due_at FROM tasks WHERE status = 'open' AND title ILIKE $1 ORDER BY due_at NULLS LAST LIMIT 2`, [like]),
  ]);
  return [
    ...deals.rows.map(deal => ({
      id: 'deal:' + deal.id, kind: 'deal' as const, title: deal.name,
      subtitle: [money(deal.amount, deal.currency), deal.status === 'open' ? '' : deal.status === 'won' ? 'Won' : 'Lost', deal.company_name].filter(Boolean).join(' · '),
      href: `/sales/deals/${deal.id}`,
    })),
    ...tasks.rows.map(task => ({
      id: 'task:' + task.id, kind: 'task' as const, title: task.title,
      subtitle: task.due_at ? `Due ${new Date(task.due_at).toISOString().slice(0, 10)}` : 'No due date', href: `/sales/tasks?task=${task.id}`,
    })),
  ].slice(0, 5);
}

export const crmModule: LaneModule = {
  name: 'crm',
  endpoints: [...pipelineEndpoints, ...dealEndpoints, ...taskEndpoints, ...peopleEndpoints, ...forecastEndpoints, ...sequenceEndpoints, ...mailboxEndpoints, ...importEndpoints, ...listEndpoints, ...duplicateEndpoints],
  jobHandlers: {
    [REMINDER_JOB]: runTaskReminder,
    [SEQUENCE_JOB]: runSequenceStep,
    [MAILBOX_SYNC_JOB]: runMailboxSync,
  },
  async onPlatformEvent(event) {
    await stopOnEvent(event);
  },
  async search(query) {
    return searchSales(query);
  },
  async seedPreview(sql) {
    await seedCrmPreview(sql);
  },
};
