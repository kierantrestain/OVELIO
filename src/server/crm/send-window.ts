// Sequence send windows: the recipient's local time zone (from the contact's country, else the workspace zone in
// OVELIO_TIMEZONE, else UTC), the allowed weekdays and hours, and the next moment a step may send.

const zones: Record<string, string> = {
  'united kingdom': 'Europe/London', uk: 'Europe/London', gb: 'Europe/London', 'great britain': 'Europe/London', england: 'Europe/London',
  scotland: 'Europe/London', wales: 'Europe/London', 'northern ireland': 'Europe/London', ireland: 'Europe/Dublin', ie: 'Europe/Dublin',
  'united states': 'America/New_York', usa: 'America/New_York', us: 'America/New_York', canada: 'America/Toronto', ca: 'America/Toronto',
  mexico: 'America/Mexico_City', brazil: 'America/Sao_Paulo', argentina: 'America/Argentina/Buenos_Aires',
  germany: 'Europe/Berlin', de: 'Europe/Berlin', france: 'Europe/Paris', fr: 'Europe/Paris', spain: 'Europe/Madrid', es: 'Europe/Madrid',
  italy: 'Europe/Rome', it: 'Europe/Rome', netherlands: 'Europe/Amsterdam', nl: 'Europe/Amsterdam', belgium: 'Europe/Brussels',
  portugal: 'Europe/Lisbon', switzerland: 'Europe/Zurich', austria: 'Europe/Vienna', sweden: 'Europe/Stockholm', norway: 'Europe/Oslo',
  denmark: 'Europe/Copenhagen', finland: 'Europe/Helsinki', poland: 'Europe/Warsaw', greece: 'Europe/Athens', turkey: 'Europe/Istanbul',
  'united arab emirates': 'Asia/Dubai', uae: 'Asia/Dubai', india: 'Asia/Kolkata', in: 'Asia/Kolkata', singapore: 'Asia/Singapore',
  japan: 'Asia/Tokyo', china: 'Asia/Shanghai', 'hong kong': 'Asia/Hong_Kong', australia: 'Australia/Sydney', au: 'Australia/Sydney',
  'new zealand': 'Pacific/Auckland', nz: 'Pacific/Auckland', 'south africa': 'Africa/Johannesburg', nigeria: 'Africa/Lagos', kenya: 'Africa/Nairobi',
};

export function workspaceZone(env: NodeJS.ProcessEnv = process.env) {
  const zone = env.OVELIO_TIMEZONE?.trim();
  return zone && validZone(zone) ? zone : 'UTC';
}

function validZone(zone: string) {
  try { new Intl.DateTimeFormat('en-GB', { timeZone: zone }); return true; } catch { return false; }
}

/** The recipient's zone: from their country when OVELIO knows it, otherwise the workspace zone. */
export function zoneForCountry(country: string | null | undefined, env: NodeJS.ProcessEnv = process.env) {
  return zones[(country ?? '').trim().toLowerCase()] ?? workspaceZone(env);
}

export type SendWindow = { start: number; end: number; days: number[] };

const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Local weekday (0 = Sunday) and hour of an instant in a zone. */
export function localTime(at: Date, zone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(at);
  return { day: weekdays[parts.find(part => part.type === 'weekday')?.value ?? 'Mon'], hour: Number(parts.find(part => part.type === 'hour')?.value ?? 0) };
}

export const insideWindow = (at: Date, zone: string, window: SendWindow) => {
  const local = localTime(at, zone);
  return window.days.includes(local.day) && local.hour >= window.start && local.hour < window.end;
};

/** `from` when it is inside the window, otherwise the start of the next window hour (checked hour by hour for 8 days). */
export function nextSendTime(from: Date, zone: string, window: SendWindow): Date {
  if (insideWindow(from, zone, window)) return from;
  const probe = new Date(from);
  probe.setUTCMinutes(0, 0, 0);
  for (let step = 0; step < 24 * 8; step++) {
    probe.setUTCHours(probe.getUTCHours() + 1);
    if (insideWindow(probe, zone, window)) return new Date(probe);
  }
  return from;
}

const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const describeWindow = (window: SendWindow, zone: string) =>
  `${window.days.map(day => dayNames[day]).join(', ')} ${String(window.start).padStart(2, '0')}:00–${String(window.end).padStart(2, '0')}:00 ${zone}`;
