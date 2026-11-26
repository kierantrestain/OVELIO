// Developer-preview sample data for Sites & Forms. Runs once on the embedded database through the `sql` handle only
// (the shared `db` is still booting). Every record is named "(sample)" and every event is tagged source 'sites-sample'.
import type { Sql } from '../db';
import { devPreviewContacts } from '../dev-preview';
import { createPage } from './pages';
import { sanitizePageCss, sanitizePageHtml } from './sanitize';

async function publish(sql: Sql, pageId: string) {
  const row = (await sql.query<{ design_id: string; source: string; css: string; version: number }>(
    'SELECT p.design_id, d.source, d.css, d.version FROM landing_pages p JOIN designs d ON d.id = p.design_id WHERE p.id = $1', [pageId],
  )).rows[0];
  await sql.query(
    `UPDATE landing_pages SET status = 'published', published_html = $2, published_css = $3, published_version = $4, published_at = now() - interval '20 days' WHERE id = $1`,
    [pageId, sanitizePageHtml(row.source), sanitizePageCss(row.css), row.version],
  );
  await sql.query(
    `INSERT INTO page_publications (page_id, design_version, html, css, label, published_at) VALUES ($1, $2, $3, $4, 'Published version ' || $2, now() - interval '20 days')`,
    [pageId, row.version, sanitizePageHtml(row.source), sanitizePageCss(row.css)],
  );
}

const sources = `(ARRAY['google','linkedin','newsletter','','facebook','partner'])`;
const mediums = `(ARRAY['cpc','social','email','','paid_social','referral'])`;

/** page.viewed for every day of the last 30, and page.converted for a share of visitors. */
async function seedPageEvents(sql: Sql, pageId: string, tag: string, perDay: number, convertEvery: number) {
  await sql.query(
    `INSERT INTO events (type, occurred_at, entity_type, entity_id, source, visitor_id, utm, properties)
     SELECT 'page.viewed', date_trunc('day', now()) - make_interval(days => d) + make_interval(mins => (v * 47 + d * 13) % 1380),
       'page', $1, 'sites-sample', 'sample-' || $2 || '-' || d || '-' || v,
       CASE WHEN ${sources}[1 + (v + d) % 6] = '' THEN '{}'::jsonb ELSE jsonb_build_object('source', ${sources}[1 + (v + d) % 6], 'medium', ${mediums}[1 + (v + d) % 6]) END,
       jsonb_build_object('variant', 'a', 'sample', true)
     FROM generate_series(0, 29) AS d, LATERAL generate_series(1, $3 + (d * 7) % 9) AS v`,
    [pageId, tag, perDay],
  );
  await sql.query(
    `INSERT INTO events (type, occurred_at, entity_type, entity_id, source, visitor_id, utm, properties)
     SELECT 'page.converted', occurred_at + interval '3 minutes', 'page', entity_id, 'sites-sample', visitor_id, utm, jsonb_build_object('variant', 'a', 'sample', true)
     FROM events WHERE type = 'page.viewed' AND entity_id = $1 AND source = 'sites-sample' AND (hashtext(visitor_id) & 2147483647) % $2 = 0`,
    [pageId, convertEvery],
  );
}

async function seedFunnelEvents(sql: Sql, funnelId: string, pageIds: string[]) {
  // Every sample visitor enters at step 0; roughly 45% reach step 1 and 20% complete.
  for (const [index, pageId] of pageIds.entries()) {
    const share = index === 0 ? 'true' : index === 1 ? '(hashtext(v::text || d::text) & 2147483647) % 100 < 45' : '(hashtext(v::text || d::text) & 2147483647) % 100 < 20';
    await sql.query(
      `INSERT INTO events (type, occurred_at, entity_type, entity_id, source, visitor_id, utm, properties, idempotency_key)
       SELECT 'funnel.step_viewed', date_trunc('day', now()) - make_interval(days => d) + make_interval(mins => v * 31 % 1300 + $3 * 4),
         'funnel', $1, 'sites-sample', 'sample-f-' || d || '-' || v, '{}'::jsonb, jsonb_build_object('stepIndex', $3::int, 'pageId', $2::text, 'sample', true),
         'sample:funnel.step:' || $1 || ':' || $3 || ':' || d || '-' || v
       FROM generate_series(0, 29) AS d, LATERAL generate_series(1, 6 + d % 4) AS v WHERE ${share}`,
      [funnelId, pageId, index],
    );
  }
  await sql.query(
    `INSERT INTO events (type, occurred_at, entity_type, entity_id, source, visitor_id, utm, properties, idempotency_key)
     SELECT 'funnel.completed', occurred_at + interval '1 minute', 'funnel', entity_id, 'sites-sample', visitor_id, '{}'::jsonb, jsonb_build_object('stepIndex', 2, 'sample', true),
       'sample:funnel.completed:' || visitor_id
     FROM events WHERE type = 'funnel.step_viewed' AND entity_id = $1 AND properties->>'stepIndex' = '2'`,
    [funnelId],
  );
}

export async function seedSites(sql: Sql) {
  const existing = await sql.query(`SELECT 1 FROM landing_pages LIMIT 1`);
  if (existing.rows.length) return;
  const ebook = await createPage({ name: 'Email playbook download (sample)', templateKey: 'ebook-download', slug: 'email-playbook' }, null, sql);
  const webinar = await createPage({ name: 'Scaling outbound webinar (sample)', templateKey: 'live-webinar', slug: 'outbound-webinar' }, null, sql);
  const demo = await createPage({ name: 'Northwind demo request (sample)', templateKey: 'saas-demo', slug: 'book-a-demo' }, null, sql);
  for (const page of [ebook, webinar, demo]) await publish(sql, page.id);
  await sql.query(`UPDATE landing_pages SET utm_defaults = '{"source":"website"}' WHERE id = $1`, [webinar.id]);

  const funnel = (await sql.query<{ id: string }>(
    `INSERT INTO funnels (name, description, status) VALUES ('Guide to demo funnel (sample)', 'Ebook download, then the live webinar, then a demo request.', 'active') RETURNING id`,
  )).rows[0];
  for (const [position, name, pageId] of [[0, 'Download the playbook', ebook.id], [1, 'Register for the webinar', webinar.id], [2, 'Book a demo', demo.id]] as const) {
    await sql.query('INSERT INTO funnel_steps (funnel_id, position, name, page_id) VALUES ($1, $2, $3, $4)', [funnel.id, position, name, pageId]);
  }

  await seedPageEvents(sql, ebook.id, 'eb', 14, 6);
  await seedPageEvents(sql, webinar.id, 'wb', 22, 5);
  await seedPageEvents(sql, demo.id, 'dm', 9, 9);
  await seedFunnelEvents(sql, funnel.id, [ebook.id, webinar.id, demo.id]);

  // A handful of submissions from preview contacts, so the submissions table, CSV export and CRM links have data.
  const contacts = devPreviewContacts().filter(contact => !contact.suppressed).slice(0, 9);
  const plan = [
    { page: webinar, keys: ['first_name', 'last_name', 'email', 'company', 'job_title'] },
    { page: ebook, keys: ['first_name', 'email', 'company'] },
  ];
  for (const [index, contact] of contacts.entries()) {
    const target = plan[index % 2];
    const all: Record<string, string> = { first_name: contact.firstName ?? '', last_name: contact.lastName ?? '', email: contact.email, company: contact.company ?? '', job_title: contact.position ?? '' };
    const values = Object.fromEntries(target.keys.map(key => [key, all[key] ?? '']));
    const days = 2 + index * 3;
    await sql.query(
      `INSERT INTO form_submissions (form_id, contact_id, field_values, page_id, variant, visitor_id, utm, page_url, status, consent_given, created_at)
       VALUES ($1, $2, $3, $4, 'a', $5, $6, $7, 'accepted', $8, now() - make_interval(days => $9))`,
      [target.page.formId, contact.id, JSON.stringify(values), target.page.id, `sample-sub-${index}`, JSON.stringify(index % 3 ? { source: 'linkedin', medium: 'social' } : { source: 'newsletter', medium: 'email' }),
        `/s/${target.page === webinar ? 'outbound-webinar' : 'email-playbook'}`, contact.consent === 'opted_in', days],
    );
    await sql.query(
      `INSERT INTO events (type, occurred_at, contact_id, entity_type, entity_id, source, visitor_id, utm, properties)
       VALUES ('form.submitted', now() - make_interval(days => $5), $1, 'form', $2, 'sites-sample', $3, '{}', $4)`,
      [contact.id, target.page.formId, `sample-sub-${index}`, JSON.stringify({ formName: target.page === webinar ? 'Scaling outbound webinar (sample) form' : 'Email playbook download (sample) form', pageId: target.page.id, fields: values, sample: true }), days],
    );
  }
}
