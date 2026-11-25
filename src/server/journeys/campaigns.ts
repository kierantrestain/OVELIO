// Marketing campaign hub (lane 4): campaigns on the shared marketing_campaigns/campaign_assets tables (migration 008,
// extended by 041), their assets and tracked links, launch, and measured performance from events, deals and messages.
import { randomUUID } from 'node:crypto';
import type {
  CampaignAsset, CampaignAssetType, CampaignDetail, CampaignInput, CampaignPerformance, CampaignStatus, MarketingCampaign,
} from '@/contracts/journeys';
import { buildTrackedUrl, slugify } from '@/contracts/journeys';
import { AppError } from '../config';
import { db, transaction } from '../db';
import { audit, emitEvent } from '../events';

type CampaignRow = {
  id: string; name: string; objective: string; description: string; status: CampaignStatus; owner_id: string | null; owner_name: string | null;
  starts_on: string | null; ends_on: string | null; budget: string | null; currency: string; utm_campaign: string; utm_source: string;
  utm_medium: string; launched_at: Date | null; asset_count: string; created_at: Date; updated_at: Date;
};

const select = `SELECT c.*, u.name AS owner_name, (SELECT count(*) FROM campaign_assets a WHERE a.campaign_id = c.id) AS asset_count
  FROM marketing_campaigns c LEFT JOIN users u ON u.id = c.owner_id`;

function toCampaign(row: CampaignRow): MarketingCampaign {
  return {
    id: row.id, name: row.name, objective: row.objective, description: row.description, status: row.status, ownerId: row.owner_id,
    ownerName: row.owner_name, startsOn: row.starts_on, endsOn: row.ends_on, budget: row.budget == null ? null : Number(row.budget),
    currency: row.currency, utmCampaign: row.utm_campaign, utmSource: row.utm_source, utmMedium: row.utm_medium,
    launchedAt: row.launched_at ? new Date(row.launched_at).toISOString() : null, assetCount: Number(row.asset_count),
    createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function listCampaigns(filter: { status?: string; q?: string; from?: string; to?: string } = {}): Promise<MarketingCampaign[]> {
  const where: string[] = [];
  const values: unknown[] = [];
  if (filter.status) { values.push(filter.status); where.push(`c.status = $${values.length}`); }
  else where.push(`c.status <> 'archived'`);
  if (filter.q?.trim()) { values.push(`%${filter.q.trim().toLowerCase()}%`); where.push(`(lower(c.name) LIKE $${values.length} OR c.utm_campaign LIKE $${values.length})`); }
  if (filter.to) { values.push(filter.to); where.push(`(c.starts_on IS NULL OR c.starts_on <= $${values.length}::date)`); }
  if (filter.from) { values.push(filter.from); where.push(`(c.ends_on IS NULL OR c.ends_on >= $${values.length}::date)`); }
  const result = await db.query<CampaignRow>(`${select} WHERE ${where.join(' AND ')} ORDER BY coalesce(c.starts_on, c.created_at::date) DESC, c.name LIMIT 500`, values);
  return result.rows.map(toCampaign);
}

async function campaignRow(id: string): Promise<CampaignRow> {
  const result = await db.query<CampaignRow>(`${select} WHERE c.id = $1`, [id]);
  if (!result.rows[0]) throw new AppError(404, 'That campaign was not found.');
  return result.rows[0];
}

export async function getCampaign(id: string): Promise<CampaignDetail> {
  const row = await campaignRow(id);
  const assets = await db.query<{ asset_type: CampaignAssetType; asset_id: string; label: string; added_at: Date; meta: CampaignAsset['meta'] }>(
    'SELECT asset_type, asset_id, label, added_at, meta FROM campaign_assets WHERE campaign_id = $1 ORDER BY asset_type, added_at DESC', [id],
  );
  return {
    ...toCampaign(row),
    assets: assets.rows.map(asset => ({ type: asset.asset_type, id: asset.asset_id, label: asset.label, addedAt: new Date(asset.added_at).toISOString(), meta: asset.meta ?? {} })),
  };
}

async function uniqueSlug(base: string, exceptId?: string): Promise<string> {
  const root = slugify(base, 70) || 'campaign';
  const clean = /^[a-z0-9]/.test(root) ? root : `c-${root}`.slice(0, 70);
  for (let n = 1; n < 200; n += 1) {
    const candidate = n === 1 ? clean : `${clean}-${n}`;
    const taken = await db.query('SELECT 1 FROM marketing_campaigns WHERE utm_campaign = $1 AND id::text <> $2', [candidate, exceptId ?? '']);
    if (!taken.rows.length) return candidate;
  }
  return `${clean}-${randomUUID().slice(0, 6)}`;
}

function checkDates(startsOn?: string | null, endsOn?: string | null) {
  if (startsOn && endsOn && endsOn < startsOn) throw new AppError(400, 'The end date must be on or after the start date.');
}

export async function createCampaign(input: CampaignInput, actorId: string | null): Promise<CampaignDetail> {
  checkDates(input.startsOn, input.endsOn);
  const slug = input.utmCampaign ? slugify(input.utmCampaign) : await uniqueSlug(input.name);
  if (input.utmCampaign) {
    const taken = await db.query('SELECT 1 FROM marketing_campaigns WHERE utm_campaign = $1', [slug]);
    if (taken.rows.length) throw new AppError(409, `Another campaign already uses the UTM slug “${slug}”.`);
  }
  const result = await db.query<{ id: string }>(
    `INSERT INTO marketing_campaigns (name, objective, description, owner_id, starts_on, ends_on, budget, currency, utm_campaign, utm_source, utm_medium, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [input.name.trim(), input.objective ?? '', input.description ?? '', input.ownerId ?? actorId, input.startsOn || null, input.endsOn || null,
      input.budget ?? null, (input.currency || 'GBP').toUpperCase(), slug, input.utmSource ?? '', input.utmMedium ?? '', actorId],
  );
  await audit(actorId, 'create', 'campaign', result.rows[0].id, input.name);
  return getCampaign(result.rows[0].id);
}

export async function updateCampaign(id: string, input: Partial<CampaignInput>, actorId: string | null): Promise<CampaignDetail> {
  const current = await campaignRow(id);
  const next = {
    name: input.name?.trim() || current.name,
    objective: input.objective ?? current.objective,
    description: input.description ?? current.description,
    ownerId: input.ownerId === undefined ? current.owner_id : input.ownerId,
    startsOn: input.startsOn === undefined ? current.starts_on : input.startsOn || null,
    endsOn: input.endsOn === undefined ? current.ends_on : input.endsOn || null,
    budget: input.budget === undefined ? current.budget : input.budget,
    currency: (input.currency || current.currency).toUpperCase(),
    utmCampaign: input.utmCampaign ? slugify(input.utmCampaign) : current.utm_campaign,
    utmSource: input.utmSource ?? current.utm_source,
    utmMedium: input.utmMedium ?? current.utm_medium,
  };
  checkDates(next.startsOn, next.endsOn);
  if (next.utmCampaign !== current.utm_campaign) {
    const taken = await db.query('SELECT 1 FROM marketing_campaigns WHERE utm_campaign = $1 AND id <> $2', [next.utmCampaign, id]);
    if (taken.rows.length) throw new AppError(409, `Another campaign already uses the UTM slug “${next.utmCampaign}”.`);
  }
  await db.query(
    `UPDATE marketing_campaigns SET name = $2, objective = $3, description = $4, owner_id = $5, starts_on = $6, ends_on = $7, budget = $8,
       currency = $9, utm_campaign = $10, utm_source = $11, utm_medium = $12, updated_at = now() WHERE id = $1`,
    [id, next.name, next.objective, next.description, next.ownerId, next.startsOn, next.endsOn, next.budget, next.currency, next.utmCampaign, next.utmSource, next.utmMedium],
  );
  await audit(actorId, 'update', 'campaign', id, next.name);
  return getCampaign(id);
}

export async function deleteCampaign(id: string, actorId: string | null) {
  const current = await campaignRow(id);
  await db.query('DELETE FROM marketing_campaigns WHERE id = $1', [id]);
  await audit(actorId, 'delete', 'campaign', id, current.name);
}

/** Launch makes a planned campaign active and emits campaign.launched (once); other moves change status only. */
export async function setCampaignStatus(id: string, action: 'launch' | 'pause' | 'resume' | 'complete' | 'archive' | 'restore', actorId: string | null): Promise<CampaignDetail> {
  const current = await campaignRow(id);
  const from: Record<typeof action, CampaignStatus[]> = {
    launch: ['planned'], pause: ['active'], resume: ['paused'], complete: ['active', 'paused'], archive: ['planned', 'active', 'paused', 'completed'], restore: ['archived'],
  };
  if (!from[action].includes(current.status)) throw new AppError(409, `A ${current.status} campaign cannot be ${action === 'launch' ? 'launched' : action === 'pause' ? 'paused' : action === 'resume' ? 'resumed' : action === 'complete' ? 'completed' : action + 'd'}.`);
  const to: Record<typeof action, CampaignStatus> = { launch: 'active', pause: 'paused', resume: 'active', complete: 'completed', archive: 'archived', restore: 'planned' };
  await transaction(async client => {
    await client.query(
      `UPDATE marketing_campaigns SET status = $2, launched_at = CASE WHEN $3 THEN now() ELSE launched_at END, updated_at = now() WHERE id = $1`,
      [id, to[action], action === 'launch'],
    );
    if (action === 'launch') {
      await emitEvent({
        type: 'campaign.launched', campaignId: id, entityType: 'campaign', entityId: id, actorId,
        utm: { campaign: current.utm_campaign, source: current.utm_source || undefined, medium: current.utm_medium || undefined },
        properties: { name: current.name, objective: current.objective }, idempotencyKey: `campaign.launched:${id}`,
      }, client);
    }
    await audit(actorId, action, 'campaign', id, current.name, client);
  });
  return getCampaign(id);
}

export async function linkAsset(id: string, input: { type: CampaignAssetType; id: string; label: string }, actorId: string | null): Promise<CampaignDetail> {
  await campaignRow(id);
  if (input.type === 'link') throw new AppError(400, 'Use the tracked link builder to add links.');
  await db.query(
    `INSERT INTO campaign_assets (campaign_id, asset_type, asset_id, label) VALUES ($1, $2, $3, $4)
     ON CONFLICT (campaign_id, asset_type, asset_id) DO UPDATE SET label = EXCLUDED.label`,
    [id, input.type, input.id, input.label],
  );
  if (input.type === 'flow') await db.query('UPDATE journey_flows SET campaign_id = $1, updated_at = now() WHERE id::text = $2 AND campaign_id IS NULL', [id, input.id]);
  await audit(actorId, 'link', 'campaign', id, `${input.type}: ${input.label}`);
  return getCampaign(id);
}

export async function unlinkAsset(id: string, type: string, assetId: string, actorId: string | null): Promise<CampaignDetail> {
  await db.query('DELETE FROM campaign_assets WHERE campaign_id = $1 AND asset_type = $2 AND asset_id = $3', [id, type, assetId]);
  if (type === 'flow') await db.query('UPDATE journey_flows SET campaign_id = NULL, updated_at = now() WHERE id::text = $2 AND campaign_id = $1', [id, assetId]);
  await audit(actorId, 'unlink', 'campaign', id, `${type}: ${assetId}`);
  return getCampaign(id);
}

export async function addTrackedLink(id: string, input: { name: string; destination: string; source?: string; medium?: string; content?: string; term?: string }, actorId: string | null): Promise<CampaignDetail> {
  const campaign = await campaignRow(id);
  let url: string;
  try {
    url = buildTrackedUrl(input.destination, {
      campaign: campaign.utm_campaign, source: input.source || campaign.utm_source, medium: input.medium || campaign.utm_medium, content: input.content, term: input.term,
    });
  } catch {
    throw new AppError(400, 'Enter the full destination address, starting with https://.');
  }
  if (!/^https?:/.test(url)) throw new AppError(400, 'Links must start with http:// or https://.');
  const meta = {
    destination: input.destination, url, source: input.source || campaign.utm_source, medium: input.medium || campaign.utm_medium,
    content: input.content ?? '', term: input.term ?? '',
  };
  await db.query(
    `INSERT INTO campaign_assets (campaign_id, asset_type, asset_id, label, meta) VALUES ($1, 'link', $2, $3, $4)`,
    [id, randomUUID(), input.name.trim() || new URL(input.destination).host, JSON.stringify(meta)],
  );
  await audit(actorId, 'link', 'campaign', id, `link: ${url}`);
  return getCampaign(id);
}

export async function campaignPerformance(id: string): Promise<CampaignPerformance> {
  const campaign = toCampaign(await campaignRow(id));
  const [events, messages, deals, revenue, flows] = await Promise.all([
    db.query<{ leads: string; submissions: string; conversions: string }>(
      `SELECT count(DISTINCT contact_id) FILTER (WHERE type = 'form.submitted') AS leads, count(*) FILTER (WHERE type = 'form.submitted') AS submissions,
         count(*) FILTER (WHERE type = 'page.converted') AS conversions FROM events WHERE campaign_id = $1`, [id]),
    db.query<{ status: string; n: string }>('SELECT status, count(*) AS n FROM messages WHERE campaign_id = $1 GROUP BY status', [id]),
    db.query<{ status: string; n: string }>('SELECT status, count(*) AS n FROM deals WHERE campaign_id = $1 AND archived_at IS NULL GROUP BY status', [id]),
    db.query<{ currency: string; amount: string }>(`SELECT currency, sum(amount) AS amount FROM deals WHERE campaign_id = $1 AND status = 'won' AND archived_at IS NULL GROUP BY currency`, [id]),
    db.query<{ enrolled: string; completed: string; failed: string }>(
      `SELECT count(*) AS enrolled, count(*) FILTER (WHERE e.status IN ('completed', 'exited')) AS completed, count(*) FILTER (WHERE e.status = 'failed') AS failed
       FROM journey_enrolments e JOIN journey_flows f ON f.id = e.flow_id WHERE f.campaign_id = $1`, [id]),
  ]);
  const count = (rows: { status: string; n: string }[], status: string) => Number(rows.find(row => row.status === status)?.n ?? 0);
  const leads = Number(events.rows[0]?.leads ?? 0);
  const wonRevenue = revenue.rows.map(row => ({ currency: row.currency, amount: Number(row.amount) }));
  const inCurrency = wonRevenue.find(row => row.currency === campaign.currency)?.amount ?? 0;
  const notes: CampaignPerformance['notes'] = {};
  let costPerLead: number | null = null;
  let roi: number | null = null;
  if (campaign.budget == null || campaign.budget <= 0) notes.costPerLead = 'Add a budget to see cost per lead.';
  else if (!leads) notes.costPerLead = 'No leads are attributed to this campaign yet.';
  else costPerLead = Math.round((campaign.budget / leads) * 100) / 100;
  if (campaign.budget == null || campaign.budget <= 0) notes.roi = 'Add a budget to see return on investment.';
  else if (!wonRevenue.length) notes.roi = 'No won deals are attributed to this campaign yet.';
  else if (!inCurrency) notes.roi = `Won revenue is in ${wonRevenue.map(row => row.currency).join(', ')} but the budget is in ${campaign.currency}; ROI needs one currency.`;
  else roi = Math.round(((inCurrency - campaign.budget) / campaign.budget) * 1000) / 10;
  return {
    leads,
    formSubmissions: Number(events.rows[0]?.submissions ?? 0),
    conversions: Number(events.rows[0]?.conversions ?? 0),
    emails: { sent: count(messages.rows, 'sent'), notSent: count(messages.rows, 'not_sent'), blocked: count(messages.rows, 'blocked'), failed: count(messages.rows, 'failed') },
    deals: {
      created: deals.rows.reduce((sum, row) => sum + Number(row.n), 0), open: count(deals.rows, 'open'), won: count(deals.rows, 'won'), lost: count(deals.rows, 'lost'), wonRevenue,
    },
    flows: { enrolled: Number(flows.rows[0]?.enrolled ?? 0), completed: Number(flows.rows[0]?.completed ?? 0), failed: Number(flows.rows[0]?.failed ?? 0) },
    costPerLead,
    roi,
    notes,
  };
}
