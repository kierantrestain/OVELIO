// Validated MJML layout components for the template factory. Every component checks its input (throws on empty or
// oversized copy) and escapes text, then returns MJML that uses [[brand.*]] tokens, so one layout renders in any brand.
import { badge, button, column, divider, heading, heroArt, image, rows, section, spacer, text, thumb } from '../shared';

export type LayoutStyle = 'bold' | 'editorial' | 'minimal' | 'commerce' | 'showcase';
export type Item = { title: string; body: string; meta?: string };

const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Copy may contain OVELIO merge tags; everything else is escaped. */
export function copy(value: string, max = 400) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('Factory copy must not be empty.');
  if (trimmed.length > max) throw new Error(`Factory copy is longer than ${max} characters: ${trimmed.slice(0, 40)}…`);
  return escape(trimmed);
}

function items(list: Item[], min: number, max: number) {
  if (list.length < min || list.length > max) throw new Error(`A layout needs ${min}-${max} items, got ${list.length}.`);
  return list;
}

export function hero(style: LayoutStyle, variant: number, kicker: string, headline: string, intro: string) {
  const k = copy(kicker.toUpperCase(), 40);
  const h = copy(headline, 90);
  const i = copy(intro, 320);
  if (style === 'bold') {
    return section(column(text(k, { size: 12, color: '[[brand.accent]]', weight: 700, padding: '32px 32px 0', align: 'center' })
      + heading(h, 34, { align: 'center', color: '#ffffff', padding: '8px 40px 8px' })
      + text(i, { size: 16, align: 'center', color: '#e5e7eb', padding: '0 48px 24px' })
      + image(heroArt(variant, 600, 240), 'Abstract illustration in brand colours')), { background: '[[brand.text]]' });
  }
  if (style === 'editorial') {
    return section(column(text(k, { size: 12, color: '[[brand.primary]]', weight: 700, padding: '28px 48px 0', align: 'center' })
      + heading(h, 30, { align: 'center', padding: '8px 48px 8px' })
      + divider('8px 220px', '[[brand.primary]]')
      + text(i, { size: 16, align: 'center', padding: '8px 56px 24px', lineHeight: '1.75' })));
  }
  if (style === 'minimal') {
    return section(column(heading(h, 28, { padding: '32px 32px 8px' }) + text(i, { size: 16, padding: '0 32px 16px' })));
  }
  return section(column(image(heroArt(variant, 600, 260), 'Banner illustration in brand colours')))
    + section(column(text(k, { size: 12, color: '[[brand.primary]]', weight: 700, padding: '28px 32px 0' }) + heading(h, 30, { padding: '6px 32px 8px' }) + text(i, { size: 16 })));
}

/** Three or four items: stacked rows with thumbnails, a numbered list, icon columns or a product grid. */
export function cards(style: LayoutStyle, list: Item[]) {
  const entries = items(list, 2, 4);
  if (style === 'editorial') {
    return entries.map((item, n) => section(column(image(thumb(n, 240, 170), copy(item.title, 80), { radius: '6px' }), { width: '36%', padding: '12px 0 12px 32px' })
      + column(heading(copy(item.title, 80), 18, { padding: '12px 32px 2px 20px' }) + text(copy(item.body, 220), { size: 14, padding: '2px 32px 12px 20px' }), { width: '64%' }))).join('');
  }
  if (style === 'minimal') {
    return section(column(entries.map((item, n) => text(`<span style="color:[[brand.primary]];font-weight:700">${String(n + 1).padStart(2, '0')}</span>&nbsp;&nbsp;<strong>${copy(item.title, 80)}</strong><br>${copy(item.body, 220)}`, { size: 15, padding: '10px 32px' })).join('') + spacer(8)));
  }
  if (style === 'commerce' || style === 'showcase') {
    const cells = entries.map((item, n) => column(image(thumb(n + (style === 'showcase' ? 1 : 0), 250, 200), copy(item.title, 80), { padding: '16px 10px 6px', radius: '8px' })
      + text(`<strong>${copy(item.title, 80)}</strong>${item.meta ? `<br><span style="color:[[brand.primary]];font-weight:700">${copy(item.meta, 40)}</span>` : ''}<br><span style="color:[[brand.muted]];font-size:13px">${copy(item.body, 160)}</span>`, { size: 15, align: 'center', padding: '0 10px 12px' })));
    const pairs: string[] = [];
    for (let i = 0; i < cells.length; i += 2) pairs.push(section(cells.slice(i, i + 2).join(''), { padding: '0 22px' }));
    return pairs.join('');
  }
  return section(entries.map((item, n) => column(image(badge(['1', '2', '3', '4'][n]), copy(item.title, 80), { width: 44, padding: '24px 0 6px' })
    + heading(copy(item.title, 80), 16, { align: 'center', padding: '4px 12px 0' }) + text(copy(item.body, 200), { size: 14, align: 'center', padding: '4px 12px 16px' }))).join(''), { padding: '0 12px' });
}

export function stats(list: { value: string; label: string }[]) {
  if (list.length !== 3) throw new Error('Stats need exactly three values.');
  return section(list.map(item => column(heading(copy(item.value, 12), 28, { align: 'center', color: '[[brand.primary]]', padding: '18px 8px 0' })
    + text(copy(item.label, 40), { size: 13, align: 'center', color: '[[brand.muted]]', padding: '0 8px 18px' }))).join(''), { background: '[[brand.background]]', padding: '4px 0' });
}

export function quote(textValue: string, author: string) {
  return section(column(text(`“${copy(textValue, 260)}”`, { size: 18, heading: true, padding: '24px 40px 6px', lineHeight: '1.5' })
    + text(copy(author, 80), { size: 13, color: '[[brand.muted]]', padding: '0 40px 24px' })));
}

export function details(list: [string, string][]) {
  if (list.length < 2 || list.length > 5) throw new Error('Details need 2-5 rows.');
  return section(column(rows(list.map(([label, value]) => [copy(label, 40), copy(value, 80)]), { bold: true })), { padding: '4px 0 8px' });
}

export function offer(code: string, terms: string) {
  if (!/^[A-Z0-9]{3,16}$/.test(code)) throw new Error('An offer code is 3-16 capital letters or digits.');
  return section(column(text(`<span style="display:inline-block;border:2px dashed [[brand.primary]];padding:10px 24px;border-radius:6px;letter-spacing:3px;font-weight:700;color:[[brand.primary]]">${code}</span>`, { size: 20, align: 'center', padding: '20px 32px 6px' })
    + text(copy(terms, 160), { size: 13, align: 'center', color: '[[brand.muted]]', padding: '0 32px 12px' })));
}

export function cta(label: string, note = '', align: 'left' | 'center' = 'left') {
  return section(column(button(copy(label, 40), '[[brand.website]]', { align }) + (note ? text(copy(note, 200), { size: 13, color: '[[brand.muted]]', align, padding: '0 32px 20px' }) : spacer(12))));
}

export function signoff(lines: string) {
  return section(column(text(copy(lines, 160).replace(/\n/g, '<br>'), { size: 15, padding: '8px 32px 24px' })));
}
