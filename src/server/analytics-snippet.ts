import { z } from 'zod';
import { DEFAULT_SNIPPET_OPTIONS } from '@/contracts/analytics';
import type { SnippetOptions, SnippetPreferences } from '@/contracts/analytics';
import { db } from '@/server/db';
import type { Sql } from '@/server/db';

const domainPattern = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/i;

/** The tracker options Umami 3.5.0 reads from the script tag (src/tracker/index.ts:300-320). */
export const snippetOptionsSchema = z.object({
  domains: z.array(z.string().trim().toLowerCase().regex(domainPattern, 'Enter domains such as example.com.')).max(20),
  doNotTrack: z.boolean(),
  excludeSearch: z.boolean(),
  excludeHash: z.boolean(),
  tag: z.string().trim().max(50).regex(/^[\w .:-]*$/, 'A tag can use letters, numbers, spaces and . : - _'),
  autoTrack: z.boolean(),
  hostUrl: z.union([z.literal(''), z.url({ protocol: /^https?$/ }).max(300)]),
  beforeSend: z.string().trim().max(100).regex(/^([A-Za-z_$][\w$]*)?$/, 'Use the name of a global function.'),
  performance: z.boolean(),
  consentMode: z.boolean(),
});

const escapeAttribute = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Every attribute that differs from the tracker's own default, in a fixed order so the snippet is reproducible. */
export function snippetAttributes(websiteId: string, options: SnippetOptions): [string, string][] {
  const out: [string, string][] = [['data-website-id', websiteId]];
  if (options.hostUrl) out.push(['data-host-url', options.hostUrl.replace(/\/+$/, '')]);
  if (options.domains.length) out.push(['data-domains', options.domains.join(',')]);
  if (options.doNotTrack) out.push(['data-do-not-track', 'true']);
  if (options.excludeSearch) out.push(['data-exclude-search', 'true']);
  if (options.excludeHash) out.push(['data-exclude-hash', 'true']);
  if (options.tag) out.push(['data-tag', options.tag]);
  if (!options.autoTrack) out.push(['data-auto-track', 'false']);
  if (options.beforeSend) out.push(['data-before-send', options.beforeSend]);
  if (options.performance) out.push(['data-performance', 'true']);
  return out;
}

/**
 * The install snippet. Consent mode emits a small loader instead: nothing is fetched and nothing is stored
 * until the site calls ovelioConsent.grant(). revoke() sets Umami's own `umami.disabled` switch (tracker line 459),
 * which stops sending for this browser.
 */
export function buildSnippet(origin: string, websiteId: string, options: SnippetOptions): string {
  const src = `${origin.replace(/\/$/, '')}/script.js`;
  const attributes = snippetAttributes(websiteId, options);
  if (!options.consentMode) {
    return `<script defer src="${escapeAttribute(src)}" ${attributes.map(([k, v]) => `${k}="${escapeAttribute(v)}"`).join(' ')}></script>`;
  }
  return `<script>
(function () {
  var loaded = false;
  window.ovelioConsent = {
    grant: function () {
      try { localStorage.removeItem('umami.disabled'); } catch (e) {}
      if (loaded) return;
      loaded = true;
      var s = document.createElement('script');
      s.defer = true;
      s.src = ${JSON.stringify(src).replace(/</g, '\\u003c')};
${attributes.map(([k, v]) => `      s.setAttribute(${JSON.stringify(k)}, ${JSON.stringify(v).replace(/</g, '\\u003c')});`).join('\n')}
      document.head.appendChild(s);
    },
    revoke: function () {
      try { localStorage.setItem('umami.disabled', '1'); } catch (e) {}
    }
  };
})();
</script>`;
}

export async function getSnippetPreferences(websiteId: string, sql: Sql = db): Promise<SnippetPreferences> {
  const row = (await sql.query<{ options: unknown; updated_at: Date }>(
    'SELECT options, updated_at FROM analytics_snippet_preferences WHERE website_id = $1', [websiteId],
  )).rows[0];
  if (!row) return { websiteId, options: { ...DEFAULT_SNIPPET_OPTIONS }, updatedAt: null };
  const parsed = snippetOptionsSchema.safeParse({ ...DEFAULT_SNIPPET_OPTIONS, ...(row.options as object) });
  return {
    websiteId,
    options: parsed.success ? parsed.data : { ...DEFAULT_SNIPPET_OPTIONS },
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function saveSnippetPreferences(websiteId: string, input: unknown, sql: Sql = db): Promise<SnippetPreferences> {
  const options = snippetOptionsSchema.parse(input);
  await sql.query(
    `INSERT INTO analytics_snippet_preferences (website_id, options) VALUES ($1, $2)
     ON CONFLICT (website_id) DO UPDATE SET options = EXCLUDED.options, updated_at = now()`,
    [websiteId, JSON.stringify(options)],
  );
  return getSnippetPreferences(websiteId, sql);
}
