import { z } from 'zod';
import type { Availability, WeeklyWindow } from '@/contracts/calendar';

export const minute = 60_000;
export const day = 24 * 60 * minute;
export const slotInterval = 15 * minute;
const notice = 10 * minute;
const bookingHorizon = 14 * day;

export const timeZone = z.string().trim().min(1).max(80).refine(value => {
  try { new Intl.DateTimeFormat('en-GB', { timeZone: value }); return !/^[+-]/.test(value); }
  catch { return false; }
}, 'Choose an IANA time zone, such as Europe/London.');

const clockTime = /^([01]\d|2[0-3]):(00|15|30|45)$/;
const clockMinute = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
export const availabilityInput = z.object({
  timeZone,
  windows: z.array(z.object({
    weekday: z.number().int().min(0).max(6),
    start: z.string().regex(clockTime, 'Use a quarter-hour time, such as 09:00.'),
    end: z.string().regex(/^(?:([01]\d|2[0-3]):(00|15|30|45)|24:00)$/, 'Use a quarter-hour time, such as 17:00.'),
  })).max(21),
}).refine(input => input.windows.every((current, index) =>
  current.start < current.end && !input.windows.slice(0, index).some(other =>
    current.weekday === other.weekday && current.start < other.end && current.end > other.start)),
'Availability windows must run forward and may not overlap.');

const week = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
type Busy = { startsAt: number; blockedUntil: number };

export function slotRange(now: number) {
  return { first: Math.ceil((now + notice) / slotInterval) * slotInterval, last: now + bookingHorizon };
}

export function hostSchedule(availability: Availability, busy: Busy[], durationMinutes: number, bufferMinutes: number) {
  const format = new Intl.DateTimeFormat('en-GB', {
    timeZone: availability.timeZone, weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
  });
  const windows = availability.windows.map(({ weekday, start, end }: WeeklyWindow) => ({
    weekday, start: clockMinute(start), end: clockMinute(end),
  }));
  const wall = (at: number) => {
    const parts = format.formatToParts(at);
    const weekday = week.indexOf(parts.find(part => part.type === 'weekday')?.value ?? '');
    const clock = Number(parts.find(part => part.type === 'hour')?.value) * 60
      + Number(parts.find(part => part.type === 'minute')?.value);
    return { weekday, clock };
  };

  return (at: number) => {
    const until = at + durationMinutes * minute;
    if (busy.some(item => at < item.blockedUntil && until + bufferMinutes * minute > item.startsAt)) return false;
    const start = wall(at);
    const window = windows.find(window => window.weekday === start.weekday && window.start <= start.clock && start.clock < window.end);
    if (!window || (start.clock - window.start) % 15 !== 0) return false;
    const fits = (instant: number) => {
      const local = wall(instant);
      return local.weekday === window.weekday && local.clock >= window.start && local.clock < window.end;
    };
    if (!fits(until - 1)) return false;
    // A repeated or skipped local hour can make matching endpoints misleading.
    // Check the quarter-hour boundaries when the offset changed within this appointment.
    const ending = wall(until - minute);
    if (ending.clock === start.clock + durationMinutes - 1) return true;
    for (let instant = at + slotInterval; instant < until; instant += slotInterval) {
      if (!fits(instant)) return false;
    }
    return true;
  };
}
