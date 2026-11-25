import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { test as base, expect } from '@playwright/test';
import type { APIResponse, Page, TestInfo } from '@playwright/test';

/** True only when playwright.preview.config.ts loaded the spec; the CI config (Compose stack) skips these files. */
export const isPreviewRun = process.env.OVELIO_PREVIEW_E2E === '1';

export type Guard = {
  /** Uncaught page errors, console errors and console API responses ≥ 500 seen since the page opened. */
  problems: () => string[];
};

function watch(page: Page): Guard {
  const problems: string[] = [];
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') problems.push(`console.error: ${message.text()} (${message.location().url || 'inline'})`);
  });
  page.on('response', response => {
    if (response.status() >= 500 && new URL(response.url()).pathname.startsWith('/api/console')) {
      problems.push(`HTTP ${response.status()} ${response.request().method()} ${new URL(response.url()).pathname}`);
    }
  });
  return { problems: () => [...problems] };
}

/** Signed-out browser with the error guard. */
export const anonymous = base.extend<{ guard: Guard }>({
  guard: async ({ page }, provide) => { await provide(watch(page)); },
});

/** Signed in as the preview's developer admin through POST /api/auth/dev-login (same Origin check as the button). */
export const test = anonymous.extend({
  context: async ({ context, baseURL }, provide) => {
    const origin = new URL(baseURL ?? 'http://localhost:3206').origin;
    const response = await context.request.post('/api/auth/dev-login', { headers: { origin } });
    if (!response.ok()) throw new Error(`Preview sign-in failed: HTTP ${response.status()} ${await response.text()}`);
    await provide(context);
  },
});

export { expect };

/** Waits for the route to settle: network idle (bounded) and no loading placeholders left. */
export async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
  await page.locator('[role="status"][aria-label="Loading"], [aria-busy="true"]').first()
    .waitFor({ state: 'hidden', timeout: 8_000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

/** Elements that overflow the page horizontally (document or the shell's scrolling main). */
export async function horizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const found: string[] = [];
    if (doc.scrollWidth > window.innerWidth + 1) found.push(`document ${doc.scrollWidth}px > viewport ${window.innerWidth}px`);
    // The shell's main region and the layout box that scrolls it.
    for (const main of new Set(document.querySelectorAll<HTMLElement>('main, [role="main"], .astryx-layout-content'))) {
      if (main.scrollWidth <= main.clientWidth + 1) continue;
      // Name the widest offenders so the report says what to fix.
      const limit = main.getBoundingClientRect().right + 1;
      const offenders = [...main.querySelectorAll<HTMLElement>('*')]
        .filter(element => {
          const rect = element.getBoundingClientRect();
          if (!rect.width || rect.right <= limit) return false;
          // Content inside its own horizontal scroller is fine.
          for (let parent = element.parentElement; parent && parent !== main; parent = parent.parentElement) {
            if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowX)) return false;
          }
          return true;
        })
        .slice(0, 3)
        .map(element => `${element.tagName.toLowerCase()}${typeof element.className === 'string' ? '.' + element.className.trim().split(/\s+/).filter(name => name.startsWith('ov-')).join('.') : ''} right=${Math.round(element.getBoundingClientRect().right)}`);
      found.push(`${main.tagName.toLowerCase()} ${main.scrollWidth}px > ${main.clientWidth}px: ${offenders.join(', ') || 'unknown element'}`);
    }
    return found;
  });
}

/** Controls cut off by an ancestor that clips instead of scrolling (a filter row wider than its card, say). */
export async function clippedControls(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector('main[aria-label], [role="main"], main');
    if (!main) return [];
    const controls = main.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea, [role="combobox"]');
    const found: string[] = [];
    for (const element of controls) {
      const rect = element.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1 || element.closest('[aria-hidden="true"], [inert]')) continue;
      for (let parent = element.parentElement; parent && parent !== main; parent = parent.parentElement) {
        const overflow = getComputedStyle(parent).overflowX;
        if (overflow === 'visible') continue;
        if (overflow === 'hidden' || overflow === 'clip') {
          const box = parent.getBoundingClientRect();
          // Far off to the side means deliberately hidden (a carousel slide), not cut off.
          if (rect.right > box.right + 2 && rect.left < box.right + 240) {
            const name = (element.getAttribute('aria-label') || element.textContent || element.getAttribute('placeholder') || element.tagName).trim().slice(0, 40);
            found.push(`${element.tagName.toLowerCase()} "${name}" ends at ${Math.round(rect.right)}px, clipped at ${Math.round(box.right)}px`);
          }
        }
        break;
      }
      if (found.length >= 5) break;
    }
    return found;
  });
}

/** Parses a console API response, failing with the server's message when it is not OK. */
export async function json<T>(response: APIResponse): Promise<T> {
  if (!response.ok()) throw new Error(`HTTP ${response.status()} ${response.url()}: ${await response.text()}`);
  return await response.json() as T;
}

/** A short unique suffix for records a test creates. */
export const unique = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/**
 * Visible interactive elements without an accessible name. A small approximation of the accessible-name algorithm:
 * aria-labelledby, aria-label, associated labels, alt, title, placeholder, value of input buttons, and text content.
 */
export async function unnamedControls(page: Page) {
  return page.evaluate(() => {
    const selector = [
      'a[href]', 'button', 'input:not([type="hidden"])', 'select', 'textarea', 'summary',
      '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]', '[role="switch"]', '[role="tab"]',
      '[role="combobox"]', '[role="menuitem"]', '[role="option"]', '[role="slider"]', '[role="textbox"]', '[role="searchbox"]',
    ].join(',');
    function visible(element: Element) {
      if (element.closest('[aria-hidden="true"], [inert]')) return false;
      const rect = element.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return false;
      const style = getComputedStyle(element);
      return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0;
    }
    function text(node: Node): string {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
      if (!(node instanceof Element)) return '';
      if (node.getAttribute('aria-hidden') === 'true') return '';
      if (node instanceof HTMLElement && node.hidden) return '';
      const own = node.getAttribute('aria-label') || (node instanceof HTMLImageElement ? node.alt : '')
        || (node.tagName.toLowerCase() === 'svg' ? node.querySelector('title')?.textContent ?? '' : '');
      if (own) return own;
      return [...node.childNodes].map(text).join(' ');
    }
    function name(element: Element): string {
      const labelledBy = element.getAttribute('aria-labelledby');
      if (labelledBy) {
        const joined = labelledBy.split(/\s+/).map(id => document.getElementById(id)).filter(Boolean).map(node => text(node!)).join(' ').trim();
        if (joined) return joined;
      }
      const label = element.getAttribute('aria-label')?.trim();
      if (label) return label;
      if ('labels' in element) {
        const labels = (element as HTMLInputElement).labels;
        const fromLabels = labels ? [...labels].map(node => text(node)).join(' ').trim() : '';
        if (fromLabels) return fromLabels;
      }
      if (element instanceof HTMLInputElement && ['submit', 'button', 'reset'].includes(element.type)) return element.value;
      const tag = element.tagName.toLowerCase();
      const isField = ['input', 'select', 'textarea'].includes(tag) || ['combobox', 'textbox', 'searchbox', 'slider'].includes(element.getAttribute('role') ?? '');
      if (!isField || element.getAttribute('role') === 'combobox' && tag !== 'input') {
        const content = text(element).replace(/\s+/g, ' ').trim();
        if (content) return content;
      }
      return element.getAttribute('title')?.trim() || element.getAttribute('placeholder')?.trim() || '';
    }
    return [...document.querySelectorAll(selector)]
      .filter(element => visible(element) && !name(element))
      .slice(0, 10)
      .map(element => {
        const html = element.outerHTML.replace(/\s+/g, ' ');
        return html.length > 160 ? html.slice(0, 157) + '…' : html;
      });
  });
}

/** Saves a full-length screenshot: the shell's main scrolls internally, so the viewport grows to show all of it. */
export async function evidence(page: Page, testInfo: TestInfo, route: string) {
  const file = path.join('test-results', 'evidence', testInfo.project.name, routeFile(route) + '.png');
  await mkdir(path.dirname(file), { recursive: true });
  const size = page.viewportSize();
  const extra = await page.evaluate(() => {
    const main = document.querySelector('main, [role="main"]');
    return main ? Math.max(0, main.scrollHeight - main.clientHeight) : 0;
  });
  if (size && extra > 0) await page.setViewportSize({ width: size.width, height: Math.min(size.height + extra, 12_000) });
  await page.screenshot({ path: file, fullPage: true, animations: 'disabled' });
  if (size && extra > 0) await page.setViewportSize(size);
  return file;
}

export function routeFile(route: string) {
  return route.replace(/^\/+/, '').replace(/[^a-z0-9]+/gi, '-').replace(/-+$/, '') || 'root';
}
