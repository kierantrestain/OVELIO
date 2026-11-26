import { rateLimit } from '@/server/auth';
import { appOrigin } from '@/server/config';
import { requestOrigin } from '@/server/dev-preview';
import { json, readBody, respondError } from '@/server/http';
import { drainAfterResponse } from '@/server/platform/after';
import { clientIp, hashIp } from '@/server/sites/public';
import { book, bookingInput, publicBooking } from '@/server/calendar/booking';

type Context = { params: Promise<{ slug: string }> };

export async function GET(request: Request, context: Context) {
  try {
    await rateLimit('booking-availability:' + hashIp(clientIp(request)), 60, 60);
    return json(await publicBooking((await context.params).slug));
  }
  catch (error) { return respondError('public-booking', error); }
}

export async function POST(request: Request, context: Context) {
  try {
    await rateLimit('booking:' + hashIp(clientIp(request)), 25, 60);
    const input = await readBody(request, bookingInput, 12_288);
    const result = await book((await context.params).slug, input, process.env.APP_ORIGIN ? appOrigin() : requestOrigin(request));
    drainAfterResponse();
    return json(result, 201);
  } catch (error) {
    return respondError('public-booking', error);
  }
}
