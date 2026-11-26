// Public invoice page: balance, payment instructions and Stripe Checkout (src/server/revenue/public.ts).
import { respondError } from '@/server/http';
import { postInvoice, serveInvoice } from '@/server/revenue/public';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Context = { params: Promise<{ token: string }> };

export async function GET(request: Request, context: Context) {
  try {
    return await serveInvoice((await context.params).token, request);
  } catch (error) {
    return respondError('revenue-invoice-page', error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    return await postInvoice((await context.params).token, request);
  } catch (error) {
    return respondError('revenue-invoice-pay', error);
  }
}
