// Published landing pages on the workspace address: /s/<slug>. Server-rendered, complete HTML documents.
import { respondError } from '@/server/http';
import { servePage } from '@/server/sites/public';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;
    return await servePage(request, slug.toLowerCase());
  } catch (error) {
    return respondError('sites-page', error);
  }
}
