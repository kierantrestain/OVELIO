// Small helpers shared by the Sites & Forms screens.
import type { LandingPageSummary } from '@/contracts/sites';
import type { Tone } from '../ui';

/** Page addresses are relative on the workspace address (/s/<slug>) and absolute on custom domains. */
export function absoluteUrl(url: string) {
  if (/^https?:\/\//.test(url)) return url;
  return (typeof window === 'undefined' ? '' : window.location.origin) + url;
}

export function pageStatusTone(page: Pick<LandingPageSummary, 'status' | 'hasDraftChanges'>): Tone {
  if (page.status === 'published') return page.hasDraftChanges ? 'warning' : 'success';
  return page.status === 'archived' ? 'neutral' : 'info';
}

export const percent = (value: number | null | undefined) => value == null ? '—' : `${value.toLocaleString('en-GB', { maximumFractionDigits: 1 })}%`;
