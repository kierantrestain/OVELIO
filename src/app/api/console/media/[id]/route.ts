import { rateLimit, requireUser } from '@/server/auth';
import { AppError, assertOrigin } from '@/server/config';
import { assertPreviewOrigin, handleDevPreviewConsole, isDevPreviewMode } from '@/server/dev-preview';
import { respondError } from '@/server/http';
import { listmonk } from '@/server/listmonk';
import { deleteMedia } from '@/server/media';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Deletes a file from OVELIO's store, or from the newsletter engine when the id is one of its files. */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser('marketer');
    const raw = (await context.params).id;
    if (!/^\d{1,18}$/.test(raw)) throw new AppError(404, 'That media file was not found.');
    const id = Number(raw);
    if (isDevPreviewMode()) assertPreviewOrigin(request);
    else {
      assertOrigin(request);
      await rateLimit('console:write:' + user.id, 180, 60);
    }
    if (await deleteMedia(id)) return new Response(null, { status: 204 });
    if (isDevPreviewMode()) return await handleDevPreviewConsole(request, ['media', raw]);
    await listmonk.deleteMedia(id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return respondError('console-media', error);
  }
}
