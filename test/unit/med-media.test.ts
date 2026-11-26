import assert from 'node:assert/strict';
import { after, test } from 'node:test';

process.env.OVELIO_DEV_PREVIEW = 'true';
delete process.env.DATABASE_URL;
delete process.env.APP_ORIGIN;

const { db } = await import('../../src/server/db');
const { sniffMediaType, sanitizeSvg, saveMedia, listMedia, deleteMedia, readMedia, mediaFilename, maxMediaBytes } = await import('../../src/server/media');
const publicRoute = await import('../../src/app/media/[id]/[filename]/route');

after(async () => { await db.close(); });

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
const text = (value: string) => new TextEncoder().encode(value);

async function fetchPublic(url: string, init?: RequestInit) {
  const [, , id, filename] = url.split('/');
  return publicRoute.GET(new Request('http://localhost' + url, init), { params: Promise.resolve({ id, filename }) });
}

test('MED-01 the type comes from the bytes: every supported format is recognised and anything else is refused', () => {
  assert.equal(sniffMediaType(png), 'image/png');
  assert.equal(sniffMediaType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16])), 'image/jpeg');
  assert.equal(sniffMediaType(text('GIF89a\x01\x00')), 'image/gif');
  assert.equal(sniffMediaType(text('RIFF\x10\x00\x00\x00WEBPVP8 ')), 'image/webp');
  assert.equal(sniffMediaType(text('%PDF-1.7\n')), 'application/pdf');
  assert.equal(sniffMediaType(text('\uFEFF<?xml version="1.0"?>\n<!-- logo -->\n<svg xmlns="http://www.w3.org/2000/svg"/>')), 'image/svg+xml');
  assert.equal(sniffMediaType(text('<html><script>alert(1)</script></html>')), null);
  assert.equal(sniffMediaType(text('RIFF\x10\x00\x00\x00WAVEfmt ')), null, 'a RIFF that is not WebP is refused');
  assert.equal(mediaFilename('C:\\Users\\me\\Hero image (final).PNG', 'image/jpeg'), 'Hero-image-final.jpg', 'the extension follows the detected type');
});

test('MED-02 a malicious SVG keeps its drawing and loses scripts, handlers, foreignObject and external or data references', () => {
  const evil = `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10" onload="alert(1)">
  <script>alert('xss')</script>
  <style>@import url(https://evil.example/x.css);</style>
  <defs><linearGradient id="g"><stop offset="0" stop-color="#2457d6"/></linearGradient></defs>
  <rect width="10" height="10" fill="url(#g)" onclick="steal()"/>
  <circle r="4" style="fill:url(https://evil.example/track.png)"/>
  <use xlink:href="https://evil.example/sprite.svg#icon"/><use href="#g"/>
  <a href="javascript:alert(1)"><text>Click</text></a>
  <image href="data:image/svg+xml;base64,PHN2Zz4="/>
  <foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><iframe src="https://evil.example"></iframe></body></foreignObject>
  <animate attributeName="href" values="javascript:alert(1)"/>
  <path d="M0 0L10 10" stroke="JaVaScRiPt:alert(1)"/>
</svg>`;
  const clean = sanitizeSvg(evil);
  for (const banned of ['script', 'alert', 'onload', 'onclick', 'foreignObject', 'iframe', 'evil.example', 'data:', '@import', 'ENTITY', 'animate', '<a', 'image', 'javascript']) {
    assert.ok(!clean.toLowerCase().includes(banned.toLowerCase()), `removed: ${banned}\n${clean}`);
  }
  assert.match(clean, /^<svg[^>]*viewBox="0 0 10 10"/, 'the root and its case-sensitive attributes survive');
  assert.match(clean, /<rect width="10" height="10" fill="url\(#g\)"/, 'internal references are kept');
  assert.match(clean, /<linearGradient id="g">/);
  assert.match(clean, /<use href="#g"/);
  assert.throws(() => sanitizeSvg('<svg><script>x</script></svg>'.replace('<svg>', '<SVG>')), /no drawing/);
});

test('MED-03 a spoofed upload is stored as what it really is, and non-media is refused whatever it claims', async () => {
  // The browser said image/svg+xml, the name says .svg, the bytes are a PNG: it is stored and served as a PNG.
  const item = await saveMedia({ filename: 'logo.svg', bytes: png });
  assert.equal(item.contentType, 'image/png');
  assert.equal(item.filename, 'logo.png');
  assert.ok(item.id >= 1_000_000_000, 'store ids never collide with the newsletter engine');
  assert.match(item.url, /^\/media\/[0-9a-f-]{36}\/logo\.png$/);
  await assert.rejects(saveMedia({ filename: 'photo.png', bytes: text('<html><body onload="x()"></body></html>') }), /none of them/);
  await assert.rejects(saveMedia({ filename: 'big.png', bytes: new Uint8Array(maxMediaBytes + 1) }), /smaller than 8 MB/);
  await assert.rejects(saveMedia({ filename: 'empty.png', bytes: new Uint8Array(0) }), /Choose/);
});

test('MED-04 stored files persist in the database and are served with safe headers', async () => {
  const svg = await saveMedia({ filename: 'badge.svg', bytes: text('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script><circle r="2"/></svg>') });
  const pdf = await saveMedia({ filename: 'Price list.pdf', bytes: text('%PDF-1.4\n%sample\n') });
  const image = await saveMedia({ filename: 'pixel.png', bytes: png });

  const listed = await listMedia();
  for (const item of [svg, pdf, image]) assert.ok(listed.some(entry => entry.uuid === item.uuid));
  const stored = await readMedia(image.uuid);
  assert.deepEqual(new Uint8Array(stored!.bytes), png, 'bytes round-trip through bytea');

  const svgResponse = await fetchPublic(svg.url);
  assert.equal(svgResponse.status, 200);
  assert.equal(svgResponse.headers.get('content-type'), 'image/svg+xml');
  assert.equal(svgResponse.headers.get('x-content-type-options'), 'nosniff');
  assert.match(svgResponse.headers.get('content-security-policy') ?? '', /^sandbox/);
  assert.match(svgResponse.headers.get('cache-control') ?? '', /max-age=31536000/);
  const body = await svgResponse.text();
  assert.ok(!body.includes('script') && !body.includes('onload'), 'the stored SVG is the sanitised one');

  const pdfResponse = await fetchPublic(pdf.url);
  assert.equal(pdfResponse.headers.get('content-type'), 'application/pdf');
  assert.match(pdfResponse.headers.get('content-disposition') ?? '', /^attachment; filename="Price-list.pdf"/);
  assert.equal(pdfResponse.headers.get('content-security-policy'), null);

  const imageResponse = await fetchPublic(image.url);
  assert.match(imageResponse.headers.get('content-disposition') ?? '', /^inline/);
  const etag = imageResponse.headers.get('etag')!;
  assert.equal((await fetchPublic(image.url, { headers: { 'if-none-match': etag } })).status, 304);

  assert.equal(await deleteMedia(image.id), true);
  assert.equal(await deleteMedia(42), false, 'engine ids are not this store’s');
  assert.equal((await fetchPublic(image.url)).status, 404);
  assert.equal((await fetchPublic('/media/not-a-uuid/x.png')).status, 404);
});
