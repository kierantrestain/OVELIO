import { ZodError } from 'zod';
import type { ZodType } from 'zod';
import { AppError, logError } from './config';
import { UpstreamError } from './upstream';

export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function readBody<T>(request: Request, schema: ZodType<T>, limit = 1024 * 1024): Promise<T> {
  const reader = request.body?.getReader();
  if (!reader || Number(request.headers.get('content-length')) > limit) {
    throw new AppError(413, 'The request is missing data or exceeds the upload limit.');
  }
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > limit) {
      await reader.cancel();
      throw new AppError(413, 'The request exceeds the upload limit.');
    }
    chunks.push(value);
  }
  let data: unknown;
  try {
    data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AppError(400, 'Send a valid JSON request.');
  }
  return schema.parse(data);
}

export function respondError(scope: string, error: unknown) {
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    return json({ error: (issue?.path.join('.') ? issue.path.join('.') + ' — ' : '') + (issue?.message ?? 'Check the submitted values.') }, 400);
  }
  if (error instanceof AppError) return json({ error: error.message }, error.status);
  if (error instanceof UpstreamError) {
    const status = error.status === 400 ? 400 : error.status === 404 ? 404 : error.status === 409 ? 409 : 502;
    return json({ error: error.message }, status);
  }
  logError(scope, error);
  return json({ error: 'Something went wrong. Check connection health and try again.' }, 500);
}
