import { rateLimit } from '@/server/auth';
import { json, readBody, respondError } from '@/server/http';
import { drainAfterResponse } from '@/server/platform/after';
import { clientIp, hashIp } from '@/server/sites/public';
import { changeBooking, manageBooking, manageInput } from '@/server/calendar/booking';

type Context = { params: Promise<{ token: string }> };

export async function POST(request: Request, context: Context) {
  try {
    await rateLimit('booking-manage:' + hashIp(clientIp(request)), 25, 60);
    const result = await changeBooking((await context.params).token, await readBody(request, manageInput, 4096));
    drainAfterResponse();
    return json(result);
  } catch (error) {
    return respondError('manage-booking', error);
  }
}

export async function GET(request: Request, context: Context) {
  try {
    await rateLimit('booking-availability:' + hashIp(clientIp(request)), 60, 60);
    return json(await manageBooking((await context.params).token));
  }
  catch (error) { return respondError('manage-booking', error); }
}
