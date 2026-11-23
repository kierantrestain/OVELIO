import { z } from 'zod';
import { addUser, changeUser, rateLimit } from '@/server/auth';
import { testSmtpRelay } from '@/server/delivery';
import { json, readBody } from '@/server/http';
import { retryDeadJob } from '@/server/jobs';
import { recordActivity } from '@/server/activity';
import { deliveryLimits, listmonk } from '@/server/listmonk';
import { saveCompany, senderDomain, settings } from '@/server/reporting';
import { name, email, address, siteId, company, route } from './shared';
import type { Entry } from './shared';

const roles = z.enum(['admin', 'marketer', 'analyst']);
const limited = (name: keyof typeof deliveryLimits) => z.number().int().min(deliveryLimits[name].min).max(deliveryLimits[name].max).optional();
const deliverySettings = z.object({
  concurrency: limited('concurrency'),
  messageRate: limited('messageRate'),
  batchSize: limited('batchSize'),
  maxSendErrors: limited('maxSendErrors'),
  slidingWindow: z.boolean().optional(),
  slidingWindowDuration: z.string().trim().max(10).optional(),
  slidingWindowRate: limited('slidingWindowRate'),
  trackingMode: z.enum(['off', 'anonymous', 'individual']).optional(),
  recordOptinIp: z.boolean().optional(),
});

export const settingsEndpoints: Entry[] = [
  /* ── Settings, Team, SMTP Diagnostics & Maintenance ─────────────────────── */
  route('GET', /^settings$/, async ({ user }) => settings(user.role === 'admin')),
  route('PATCH', /^settings$/, async ({ request }) => {
    const input = await readBody(request, z.object({ company }));
    await saveCompany(input.company);
    return settings(true);
  }, 'admin'),
  route('GET', /^settings\/delivery$/, async () => listmonk.deliverySettings(), 'admin'),
  route('PATCH', /^settings\/delivery$/, async ({ request }) => {
    const saved = await listmonk.saveDeliverySettings(await readBody(request, deliverySettings));
    await recordActivity('Delivery settings changed', '/settings?view=connections');
    return saved;
  }, 'admin'),
  route('GET', /^settings\/sender-domain$/, senderDomain, 'admin'),
  route('POST', /^settings\/smtp\/test$/, async ({ request, user }) => {
    const { email: targetEmail } = await readBody(request, address);
    await rateLimit('smtp-test:' + user.id, 5, 60);
    await testSmtpRelay(targetEmail);
    return { sent: true };
  }, 'admin'),
  route('POST', /^settings\/maintenance$/, async ({ request }) => {
    const input = await readBody(request, z.object({
      action: z.enum(['gc_unconfirmed', 'gc_orphan', 'gc_blocklisted', 'gc_analytics']),
      beforeDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }));
    const cutoffIso = input.beforeDate
      ? new Date(input.beforeDate + 'T00:00:00.000Z').toISOString()
      : new Date(Date.now() - 90 * 86_400_000).toISOString();
    if (input.action === 'gc_unconfirmed') return listmonk.cleanupUnconfirmed(input.beforeDate ? cutoffIso : new Date().toISOString());
    if (input.action === 'gc_orphan') return listmonk.cleanupSubscribers('orphan');
    if (input.action === 'gc_blocklisted') return listmonk.cleanupSubscribers('blocklisted');
    await listmonk.cleanupAnalytics('all', cutoffIso);
    return { count: 0 };
  }, 'admin'),
  route('POST', /^settings\/jobs\/(\d+)\/retry$/, async context => retryDeadJob(context.params[0]), 'admin'),
  route('POST', /^settings\/team$/, async ({ request }) => {
    const input = await readBody(request, z.object({ name, email, role: roles, password: z.string().min(14).max(128) }));
    return json(await addUser(input), 201);
  }, 'admin'),
  route('PATCH', /^settings\/team\/([0-9a-f-]+)$/i, async context => {
    const input = await readBody(context.request, z.object({
      role: roles.optional(), password: z.string().min(14).max(128).optional(), disabled: z.boolean().optional(),
    }));
    return changeUser(siteId.parse(context.params[0]), input);
  }, 'admin'),
];
