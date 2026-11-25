import { recordActivity } from '@/server/activity';
import { rateLimit, requireUser } from '@/server/auth';
import { AppError, assertOrigin } from '@/server/config';
import { assertPreviewOrigin, devPreviewMediaList, devPreviewMediaUpload, isDevPreviewMode } from '@/server/dev-preview';
import { json, respondError } from '@/server/http';
import { listmonk } from '@/server/listmonk';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const allowedTypes = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'application/pdf',
]);
const maxBytes = 8 * 1024 * 1024;

export async function GET() {
  try {
    await requireUser('marketer');
    if (isDevPreviewMode()) return json(devPreviewMediaList());
    return json(await listmonk.media());
  } catch (error) {
    return respondError('console-media', error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser('marketer');
    if (isDevPreviewMode()) {
      assertPreviewOrigin(request);
      const form = await request.formData();
      const file = form.get('file');
      if (!(file instanceof File) || !file.size) throw new AppError(400, 'Choose an image or PDF file to upload.');
      if (file.size > maxBytes) throw new AppError(413, 'Upload a file smaller than 8 MB.');
      const contentType = file.type || 'application/octet-stream';
      if (!allowedTypes.has(contentType)) throw new AppError(400, 'Supported formats: PNG, JPEG, GIF, WebP, SVG and PDF.');
      // The preview has no file store: small files stay viewable as data URLs.
      const dataUrl = file.size <= 2 * 1024 * 1024 ? `data:${contentType};base64,${Buffer.from(await file.arrayBuffer()).toString('base64')}` : undefined;
      return json(devPreviewMediaUpload(file.name, contentType, dataUrl), 201);
    }
    assertOrigin(request);
    await rateLimit('console:media:' + user.id, 30, 60);
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File) || !file.size) {
      throw new AppError(400, 'Choose an image or PDF file to upload.');
    }
    if (file.size > maxBytes) {
      throw new AppError(413, 'Upload a file smaller than 8 MB.');
    }
    const contentType = file.type || 'application/octet-stream';
    if (!allowedTypes.has(contentType)) {
      throw new AppError(400, 'Supported formats: PNG, JPEG, GIF, WebP, SVG and PDF.');
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const uploaded = await listmonk.uploadMedia(file.name, contentType, bytes);
    await recordActivity('Media file uploaded', '/campaigns?tab=Media');
    return json(uploaded, 201);
  } catch (error) {
    return respondError('console-media', error);
  }
}
