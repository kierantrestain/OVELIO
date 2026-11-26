import type { MediaItem } from '@/contracts';
import { recordActivity } from '@/server/activity';
import { rateLimit, requireUser } from '@/server/auth';
import { AppError, assertOrigin, logError } from '@/server/config';
import { assertPreviewOrigin, devPreviewMediaList, isDevPreviewMode } from '@/server/dev-preview';
import { json, respondError } from '@/server/http';
import { listmonk } from '@/server/listmonk';
import { listMedia, maxMediaBytes, saveMedia } from '@/server/media';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** OVELIO's own media store first, then the newsletter engine's existing media (the preview's sample stand-in). */
export async function GET() {
  try {
    await requireUser('marketer');
    let engine: MediaItem[] = [];
    if (isDevPreviewMode()) engine = devPreviewMediaList();
    else {
      try {
        engine = await listmonk.media();
      } catch (error) {
        // The store's files stay usable while the newsletter engine is unavailable.
        logError('console-media-engine', error);
      }
    }
    return json([...await listMedia(), ...engine]);
  } catch (error) {
    return respondError('console-media', error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser('marketer');
    if (isDevPreviewMode()) assertPreviewOrigin(request);
    else {
      assertOrigin(request);
      await rateLimit('console:media:' + user.id, 30, 60);
    }
    const length = Number(request.headers.get('content-length') ?? 0);
    if (length > maxMediaBytes + 64 * 1024) throw new AppError(413, 'Upload a file smaller than 8 MB.');
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File) || !file.size) throw new AppError(400, 'Choose an image or PDF file to upload.');
    if (file.size > maxMediaBytes) throw new AppError(413, 'Upload a file smaller than 8 MB.');
    const item = await saveMedia({ filename: file.name, bytes: new Uint8Array(await file.arrayBuffer()), uploadedBy: user.id });
    if (!isDevPreviewMode()) await recordActivity('Media file uploaded', '/marketing/media');
    return json(item, 201);
  } catch (error) {
    return respondError('console-media', error);
  }
}
