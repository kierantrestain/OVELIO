// Brand token sets for the page template factory. Each becomes a kit Theme (concrete values, no CSS variables).
import { fonts, theme } from '../kit';
import type { Theme } from '../kit';

export type BrandTokens = { key: string; name: string; theme: Theme };

export const brandTokens: BrandTokens[] = [
  { key: 'clarity', name: 'Clarity', theme: theme({ accent: '#2457d6', accentSoft: '#e7eefc', heroBg: 'linear-gradient(160deg, #f3f7ff 0%, #ffffff 65%)', radius: 12 }) },
  {
    key: 'editorial', name: 'Editorial', theme: theme({
      headingFont: fonts.serif, bg: '#fffdf8', alt: '#f7f2e8', ink: '#231a12', muted: '#6b5c4b', accent: '#9a3412', accentSoft: '#fde8d7', border: '#ece2d2',
      heroBg: 'linear-gradient(180deg, #f9f1e4 0%, #fffdf8 100%)', headingWeight: 600, headingSpacing: '-0.01em', radius: 6,
    }),
  },
  {
    key: 'midnight', name: 'Midnight', theme: theme({
      accent: '#0891b2', accentSoft: '#cffafe', ink: '#0b1220', heroBg: 'linear-gradient(140deg, #020617 0%, #0f172a 55%, #164e63 100%)', heroInk: '#ffffff', heroMuted: '#cbd5e1', radius: 10,
    }),
  },
  {
    key: 'fresh', name: 'Fresh', theme: theme({
      font: fonts.rounded, headingFont: fonts.rounded, accent: '#15803d', accentSoft: '#dcfce7', alt: '#f2faf4', heroBg: 'linear-gradient(180deg, #ecfdf3 0%, #ffffff 100%)', radius: 18,
    }),
  },
  {
    key: 'mono', name: 'Mono', theme: theme({
      accent: '#111827', accentInk: '#ffffff', accentSoft: '#f3f4f6', muted: '#4b5563', heroBg: 'linear-gradient(180deg, #fafafa 0%, #ffffff 100%)', radius: 4, headingSpacing: '-0.04em', headingWeight: 800,
    }),
  },
  {
    key: 'vivid', name: 'Vivid', theme: theme({
      accent: '#7c3aed', accentSoft: '#ede9fe', heroBg: 'linear-gradient(135deg, #4c1d95 0%, #7c3aed 55%, #db2777 100%)', heroInk: '#ffffff', heroMuted: '#ede9fe', radius: 14,
    }),
  },
];
