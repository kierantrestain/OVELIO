import { respondError } from '@/server/http';
import { calendarFeed } from '@/server/calendar/module';

export async function GET(_: Request, context: { params: Promise<{ token: string }> }) {
  try { return await calendarFeed((await context.params).token); }
  catch (error) { return respondError('calendar-feed', error); }
}
