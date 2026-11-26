// Public serving for OVELIO's media store (src/server/media.ts): /media/<uuid>/<filename>. Used in emails and
// published pages, so no session is required; ids are random UUIDs, not enumerable.
import { mediaHeaders, readMedia } from '@/server/media';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function serve(request: Request, context: { params: Promise<{ id: string; filename: string }> }, body: boolean) {
  const { id } = await context.params;
  const file = await readMedia(id).catch(() => null);
  if (!file) return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' } });
  const headers = mediaHeaders(file);
  if (request.headers.get('if-none-match') === headers.ETag) return new Response(null, { status: 304, headers: { ETag: headers.ETag, 'Cache-Control': headers['Cache-Control'] } });
  return new Response(body ? new Uint8Array(file.bytes) : null, { status: 200, headers });
}

export function GET(request: Request, context: { params: Promise<{ id: string; filename: string }> }) {
  return serve(request, context, true);
}

export function HEAD(request: Request, context: { params: Promise<{ id: string; filename: string }> }) {
  return serve(request, context, false);
}
