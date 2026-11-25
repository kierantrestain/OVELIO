// /api/console/journeys/campaigns endpoints: the campaign hub (lane 4).
import { z } from 'zod';
import { campaignAssetTypes, campaignStatuses } from '@/contracts/journeys';
import { listEvents } from '../events';
import { json } from '../http';
import { route } from '../routes/shared';
import type { Entry } from '../routes/shared';
import {
  addTrackedLink, campaignPerformance, createCampaign, deleteCampaign, getCampaign, linkAsset, listCampaigns, setCampaignStatus, unlinkAsset,
  updateCampaign,
} from './campaigns';

const uuid = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';
const pattern = (path: string) => new RegExp('^journeys/' + path.replaceAll(':id', uuid) + '$');
const parse = async <T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> => schema.parse(await request.json().catch(() => ({})));

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date.').nullable().optional().or(z.literal(''));
const utmPart = z.string().trim().max(80).regex(/^[A-Za-z0-9._ -]*$/, 'Use letters, digits, dots, hyphens and underscores in UTM values.');
const campaignInput = z.object({
  name: z.string().trim().min(1, 'Name the campaign.').max(120),
  objective: z.string().trim().max(120).optional(),
  description: z.string().trim().max(2000).optional(),
  ownerId: z.uuid().nullable().optional(),
  startsOn: isoDate,
  endsOn: isoDate,
  budget: z.number().min(0, 'Enter a budget of zero or more.').max(1e12).nullable().optional(),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/, 'Use a three-letter currency code.').optional(),
  utmCampaign: z.string().trim().max(80).regex(/^$|^[a-z0-9][a-z0-9_-]{0,79}$/, 'Use lowercase letters, digits, hyphens and underscores, starting with a letter or digit.').optional(),
  utmSource: utmPart.optional(),
  utmMedium: utmPart.optional(),
});

export const campaignEndpoints: Entry[] = [
  route('GET', pattern('campaigns'), async ({ query }) => ({
    items: await listCampaigns({
      status: z.enum(campaignStatuses).optional().parse(query.get('status') || undefined),
      q: query.get('q') ?? undefined,
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().parse(query.get('from') || undefined),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().parse(query.get('to') || undefined),
    }),
  })),
  route('POST', pattern('campaigns'), async ({ request, user }) => {
    const input = await parse(request, campaignInput);
    return json(await createCampaign({ ...input, startsOn: input.startsOn || null, endsOn: input.endsOn || null }, user.id), 201);
  }, 'marketer'),
  route('GET', pattern('campaigns/:id'), async ({ params }) => getCampaign(params[0])),
  route('PATCH', pattern('campaigns/:id'), async ({ request, params, user }) => updateCampaign(params[0], await parse(request, campaignInput.partial()), user.id), 'marketer'),
  route('DELETE', pattern('campaigns/:id'), async ({ params, user }) => {
    await deleteCampaign(params[0], user.id);
    return new Response(null, { status: 204 });
  }, 'marketer'),
  route('POST', pattern('campaigns/:id/(launch|pause|resume|complete|archive|restore)'), async ({ params, user }) =>
    setCampaignStatus(params[0], params[1] as 'launch', user.id), 'marketer'),
  route('POST', pattern('campaigns/:id/assets'), async ({ request, params, user }) => linkAsset(params[0], await parse(request, z.object({
    type: z.enum(campaignAssetTypes), id: z.string().trim().min(1).max(200), label: z.string().trim().min(1).max(200),
  })), user.id), 'marketer'),
  route('DELETE', pattern('campaigns/:id/assets/([a-z_]+)/([^/]{1,200})'), async ({ params, user }) =>
    unlinkAsset(params[0], params[1], decodeURIComponent(params[2]), user.id), 'marketer'),
  route('POST', pattern('campaigns/:id/links'), async ({ request, params, user }) => addTrackedLink(params[0], await parse(request, z.object({
    name: z.string().trim().max(120).default(''),
    destination: z.url({ protocol: /^https?$/ }).max(1000),
    source: utmPart.optional(), medium: utmPart.optional(), content: utmPart.optional(), term: utmPart.optional(),
  })), user.id), 'marketer'),
  route('GET', pattern('campaigns/:id/performance'), async ({ params }) => campaignPerformance(params[0])),
  route('GET', pattern('campaigns/:id/timeline'), async ({ params }) => ({ items: await listEvents({ campaignId: params[0], limit: 60 }) })),
];
