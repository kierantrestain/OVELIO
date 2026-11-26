// Creates one of each OVELIO 2.0 record (deal, email design, published page, native flow, media file) so CI's
// restart and backup/restore steps can prove they persist (test/integration/verify-state.ts).
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { test } from 'node:test';
import { apiClient, testEnv } from './client';

test('OVELIO 2.0 records exist for the persistence checks', { timeout: 120000 }, async () => {
  const env = testEnv();
  const api = await apiClient(env);
  const tag = Date.now().toString(36);

  const deal = await api.get<{ id: string }>('/sales/deals', 'POST', { name: 'Persisted deal ' + tag, amount: 1200 });
  const emailTemplates = await api.get<{ items: { key: string }[] }>('/studio/templates');
  const design = await api.get<{ id: string }>('/studio/designs', 'POST', { templateKey: emailTemplates.items[0].key, name: 'Persisted design ' + tag });
  const pageTemplates = await api.get<{ items: { key: string; hasForm: boolean }[] }>('/sites/templates');
  const template = pageTemplates.items.find(item => !item.hasForm) ?? pageTemplates.items[0];
  const page = await api.get<{ id: string }>('/sites/pages', 'POST', { name: 'Persisted page ' + tag, templateKey: template.key, slug: 'persisted-' + tag });
  const published = await api.get<{ status: string }>('/sites/pages/' + page.id + '/publish', 'POST');
  assert.equal(published.status, 'published');
  const flow = await api.get<{ id: string }>('/journeys/flows', 'POST', {
    name: 'Persisted flow ' + tag,
    graph: {
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 }, config: {} },
        { id: 'tag', type: 'add_tag', position: { x: 0, y: 160 }, config: { tags: ['persisted'] } },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'tag', sourceHandle: 'next' }],
    },
  });
  assert.equal((await api.get<{ status: string }>('/journeys/flows/' + flow.id + '/publish', 'POST')).status, 'published');

  const form = new FormData();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  // Declared as SVG on purpose: the store keeps what the bytes are.
  form.append('file', new Blob([png], { type: 'image/svg+xml' }), 'persisted-' + tag + '.svg');
  const upload = await api.response('/media', 'POST', form);
  assert.equal(upload.status, 201);
  const media = await upload.json() as { contentType: string; url: string };
  assert.equal(media.contentType, 'image/png');

  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/records.json', JSON.stringify({
    dealId: deal.id, designId: design.id, pageId: page.id, flowId: flow.id, mediaPath: new URL(media.url, env.origin).pathname,
  }), { mode: 0o600 });
});
