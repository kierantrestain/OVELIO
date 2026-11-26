// Content schema for the page template factory: every industry kit is validated against it before any layout uses it.
import { z } from 'zod';
import { templateIndustries } from '@/contracts/sites';

const text = (max: number) => z.string().trim().min(2).max(max);
const icon = z.enum(['bolt', 'chart', 'shield', 'users', 'clock', 'star', 'heart', 'target', 'mail', 'calendar', 'book', 'leaf', 'globe', 'check', 'play', 'rocket']);

export const contentSchema = z.object({
  industry: z.enum(templateIndustries),
  slug: z.string().regex(/^[a-z][a-z-]{1,30}$/),
  brand: text(40),
  links: z.array(text(20)).min(2).max(4),
  eyebrow: text(60),
  headline: text(80),
  lead: text(220),
  bullets: z.array(text(80)).length(3),
  logosTitle: text(60),
  logos: z.array(text(16)).min(4).max(6),
  features: z.object({ title: text(70), lead: text(160), items: z.array(z.object({ icon, title: text(40), text: text(140) })).min(3).max(6) }),
  stats: z.array(z.object({ value: z.string().trim().min(1).max(10), label: text(40) })).length(4),
  testimonials: z.array(z.object({ quote: text(180), name: text(40), role: text(60) })).length(3),
  plans: z.array(z.object({ name: text(24), price: text(12), period: text(16).optional(), text: text(80), features: z.array(text(60)).min(2).max(4), cta: text(24) })).length(3),
  faq: z.array(z.object({ q: text(90), a: text(240) })).min(3).max(5),
  steps: z.array(z.object({ title: text(40), text: text(140) })).length(3),
  story: z.object({ eyebrow: text(40), title: text(80), text: text(260), bullets: z.array(text(70)).length(3) }),
  cta: z.object({ title: text(70), lead: text(160), label: text(28) }),
  waitlist: z.object({ pill: text(40), title: text(80), lead: text(200), note: text(80) }),
  magnet: z.object({ eyebrow: text(50), title: text(80), lead: text(200), bullets: z.array(text(70)).length(3), inside: z.array(z.object({ title: text(40), text: text(120) })).length(3) }),
  event: z.object({
    eyebrow: text(70), title: text(80), lead: text(220), date: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$/),
    speakers: z.array(z.object({ name: text(40), role: text(60) })).min(3).max(4),
    agenda: z.array(z.object({ time: text(12), title: text(80), who: text(60) })).min(3).max(5),
  }),
  art: z.enum(['dashboard', 'blob', 'product', 'report', 'phone', 'calendar', 'stage', 'webinar']),
});

export type IndustryContent = z.infer<typeof contentSchema>;
