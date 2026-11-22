import { z } from 'zod';
import { recordActivity } from '@/server/activity';
import { rateLimit } from '@/server/auth';
import { emailKey } from '@/server/config';
import { approvedCampaign, changeCampaign, mailContent, sendTest, sendTransactional, withUnsubscribeCounts } from '@/server/delivery';
import { json, readBody } from '@/server/http';
import { listmonk } from '@/server/listmonk';
import { name, subject, html, email, numberId, address, route, id, page, date } from './shared';
import type { Entry } from './shared';

const campaign = z.object({
  name, subject, body: html, listIds: z.array(numberId).min(1).max(50),
  altBody: z.string().max(100_000).optional(),
  contentType: z.enum(['html', 'richtext', 'markdown', 'plain']).optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  archive: z.boolean().optional(),
  fromEmail: email.optional(), templateId: numberId.optional(),
});

export const campaignsEndpoints: Entry[] = [
  /* ── Campaigns, Templates, Media, Bounces & Transactional (Listmonk) ─────── */
  route('GET', /^campaigns$/, async ({ query }) => {
    const statusParam = query.get('status')?.trim();
    const statuses = statusParam && statusParam !== 'all' ? [statusParam] : undefined;
    const search = z.string().trim().max(120).optional().parse(query.get('q') ?? undefined);
    const result = await listmonk.campaigns({ page: page(query), status: statuses, query: search });
    return { ...result, items: await withUnsubscribeCounts(result.items) };
  }),
  route('GET', /^campaigns\/running$/, async () => listmonk.runningCampaignStats()),
  route('POST', /^campaigns$/, async ({ request }) => {
    const made = await listmonk.createCampaign(approvedCampaign(await readBody(request, campaign)));
    await recordActivity('Newsletter draft created', '/campaigns');
    return json(made, 201);
  }, 'marketer'),
  route('GET', /^campaigns\/(\d+)$/, async context => (await withUnsubscribeCounts([await listmonk.campaign(id(context))]))[0]),
  route('PATCH', /^campaigns\/(\d+)$/, async context => listmonk.updateCampaign(id(context), approvedCampaign(await readBody(context.request, campaign))), 'marketer'),
  route('DELETE', /^campaigns\/(\d+)$/, async context => {
    await listmonk.deleteCampaign(id(context));
    await recordActivity('Newsletter deleted', '/campaigns');
    return new Response(null, { status: 204 });
  }, 'marketer'),
  route('POST', /^campaigns\/(\d+)\/clone$/, async context => {
    const body = await readBody(context.request, z.object({ name: name.optional() })).catch(() => ({ name: undefined }));
    const cloned = await listmonk.cloneCampaign(id(context), body.name);
    await recordActivity('Newsletter cloned', `/campaigns/${cloned.id}`);
    return json(cloned, 201);
  }, 'marketer'),
  route('POST', /^campaigns\/(\d+)\/cancel$/, async context => {
    const cancelled = await listmonk.cancelCampaign(id(context));
    await recordActivity('Newsletter cancelled', `/campaigns/${cancelled.id}`);
    return cancelled;
  }, 'marketer'),
  route('PATCH', /^campaigns\/(\d+)\/archive$/, async context => {
    const input = await readBody(context.request, z.object({
      archive: z.boolean(),
      archiveSlug: z.string().trim().regex(/^[a-z0-9-]*$/i, 'Use letters, numbers and dashes for archive slugs.').max(120).optional(),
    }));
    const updated = await listmonk.updateCampaignArchive(id(context), input);
    await recordActivity(input.archive ? 'Newsletter published to public archive' : 'Newsletter removed from public archive', `/campaigns/${updated.id}`);
    return updated;
  }, 'marketer'),
  route('GET', /^campaigns\/(\d+)\/preview$/, async context => new Response(await listmonk.previewCampaign(id(context)), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  }), 'marketer'),
  route('GET', /^campaigns\/(\d+)\/analytics$/, async context => {
    const campaignId = id(context);
    const range = date(context.query);
    const [views, clicks, bounces, links] = await Promise.all([
      listmonk.campaignTrend([campaignId], range, 'views').catch(() => null),
      listmonk.campaignTrend([campaignId], range, 'clicks').catch(() => null),
      listmonk.campaignTrend([campaignId], range, 'bounces').catch(() => null),
      listmonk.campaignLinks([campaignId], range).catch(() => []),
    ]);
    return { views, clicks, bounces, links };
  }),
  route('GET', /^campaigns\/(\d+)\/analytics\/export$/, async context => {
    const campaignId = id(context);
    const range = date(context.query);
    const metric = z.enum(['views', 'clicks', 'links', 'bounces']).parse(context.query.get('type') ?? 'views');
    let csv: string;
    if (metric === 'views' || metric === 'clicks') {
      csv = await listmonk.exportCampaignAnalytics(metric, [campaignId], range);
    } else if (metric === 'links') {
      const rows = await listmonk.campaignLinks([campaignId], range);
      csv = ['url,count', ...rows.map(r => `"${r.url.replaceAll('"', '""')}",${r.count}`)].join('\n') + '\n';
    } else {
      const all = await listmonk.allBounces(campaignId);
      csv = ['id,email,type,source,created_at', ...all.map(b =>
        `${b.id},"${b.email.replaceAll('"', '""')}","${b.type.replaceAll('"', '""')}","${b.source.replaceAll('"', '""')}","${b.createdAt ?? ''}"`,
      )].join('\n') + '\n';
    }
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="campaign-${campaignId}-${metric}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  }, 'marketer'),
  route('POST', /^campaigns\/(\d+)\/test$/, async context => {
    const { email: targetEmail } = await readBody(context.request, address);
    await rateLimit('test:' + context.user.id, 8, 60);
    await rateLimit('test:repeat:' + id(context) + ':' + emailKey(targetEmail), 1, 30);
    await sendTest(id(context), targetEmail);
    return json({ queued: true }, 202);
  }, 'marketer'),
  route('POST', /^campaigns\/(\d+)\/schedule$/, async context => {
    const { sendAt } = await readBody(context.request, z.object({ sendAt: z.iso.datetime({ offset: true }) }));
    await rateLimit('send:' + context.user.id, 10, 60);
    return changeCampaign(id(context), 'schedule', sendAt);
  }, 'marketer'),
  route('POST', /^campaigns\/(\d+)\/start$/, async context => {
    await rateLimit('send:' + context.user.id, 10, 60);
    return changeCampaign(id(context), 'start');
  }, 'marketer'),
  route('POST', /^campaigns\/(\d+)\/pause$/, async context => changeCampaign(id(context), 'pause'), 'marketer'),
  route('GET', /^templates$/, async ({ query }) => {
    const kind = z.enum(['campaign', 'tx', 'all']).optional().parse(query.get('type') ?? undefined);
    return kind ? listmonk.templates({ type: kind }) : listmonk.templates();
  }, 'marketer'),
  route('POST', /^templates$/, async ({ request }) => {
    const input = await readBody(request, z.object({
      name, body: html, type: z.enum(['campaign', 'tx']).optional(), subject: subject.optional(),
    }));
    const body = input.type === 'tx' ? input.body : mailContent(input.body, true, true);
    return json(await listmonk.createTemplate({ ...input, body }), 201);
  }, 'marketer'),
  route('PATCH', /^templates\/(\d+)$/, async context => {
    const input = await readBody(context.request, z.object({
      name, body: html, type: z.enum(['campaign', 'tx']).optional(), subject: subject.optional(),
    }));
    const body = input.type === 'tx' ? input.body : mailContent(input.body, true, true);
    return listmonk.updateTemplate(id(context), { ...input, body });
  }, 'marketer'),
  route('DELETE', /^templates\/(\d+)$/, async context => {
    await listmonk.deleteTemplate(id(context));
    return new Response(null, { status: 204 });
  }, 'marketer'),
  route('POST', /^templates\/(\d+)\/default$/, async context => {
    await listmonk.setDefaultTemplate(id(context));
    return { isDefault: true };
  }, 'marketer'),
  route('GET', /^templates\/(\d+)\/preview$/, async context => new Response(await listmonk.previewTemplate(id(context)), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  }), 'marketer'),
  route('POST', /^templates\/preview$/, async ({ request }) => {
    const input = await readBody(request, z.object({ body: html, type: z.enum(['campaign', 'tx']).optional() }));
    return new Response(await listmonk.previewTemplateBody(input.body, input.type), {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }, 'marketer'),
  route('DELETE', /^media\/(\d+)$/, async context => {
    await listmonk.deleteMedia(id(context));
    return new Response(null, { status: 204 });
  }, 'marketer'),
  route('GET', /^bounces$/, async ({ query }) => listmonk.bounces({
    page: page(query),
    campaignId: query.has('campaignId') ? numberId.parse(query.get('campaignId')) : undefined,
  }), 'marketer'),
  route('DELETE', /^bounces\/(\d+)$/, async context => {
    await listmonk.deleteBounce(id(context));
    return new Response(null, { status: 204 });
  }, 'marketer'),
  route('POST', /^bounces\/blocklist$/, async ({ request }) => {
    const { ids } = await readBody(request, z.object({ ids: z.array(numberId).min(1).max(100) }));
    // Blocklists only the subscribers behind these bounces and reports how many were really blocked.
    return { blocklisted: await listmonk.blocklistBounceSubscribers(ids) };
  }, 'marketer'),
  route('POST', /^tx$/, async ({ request, user }) => {
    const input = await readBody(request, z.object({
      email, templateId: numberId, subject: subject.optional(),
      data: z.record(z.string(), z.unknown()).optional(),
    }));
    await rateLimit('tx:' + user.id, 15, 60);
    await sendTransactional(input);
    return json({ queued: true }, 202);
  }, 'marketer'),
];
