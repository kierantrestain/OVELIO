// Hosted form page: share /f/<formId> as a link when there is no landing page.
import { respondError } from '@/server/http';
import { serveFormPage } from '@/server/sites/public';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request: Request, context: { params: Promise<{ formId: string }> }) {
  try {
    return await serveFormPage((await context.params).formId);
  } catch (error) {
    return respondError('sites-form-page', error);
  }
}
