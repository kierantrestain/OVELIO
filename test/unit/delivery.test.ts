import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mailContent } from '../../src/server/delivery';

test('email sanitization permits the template content slot only in saved templates', () => {
  const slot = '{{ template "content" . }}';
  const html = '<main>' + slot + '<img src="https://example.test/logo.png" onerror="alert(1)">{{ other }}</main>';
  const safeTemplate = mailContent(html, true);
  assert.ok(safeTemplate.includes('<main>' + slot));
  assert.ok(!safeTemplate.includes('{{ other }}'));
  assert.ok(!safeTemplate.includes('onerror'));
  assert.ok(!mailContent(html).includes(slot));
});
