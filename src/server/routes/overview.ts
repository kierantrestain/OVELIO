import { dashboard } from '@/server/reporting';
import { route } from './shared';
import type { Entry } from './shared';

export const overviewEndpoints: Entry[] = [
  /* ── Overview ────────────────────────────────────────────────────────────── */
  route('GET', /^overview$/, dashboard),
];
