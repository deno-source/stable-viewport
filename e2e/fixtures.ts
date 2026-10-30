import { test as base, expect, chromium, type Page, type BrowserContext } from '@playwright/test';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

interface NativeBrowser { context: BrowserContext; settings: Page }

/**
 * Coverage from instrumented modules is merged per worker into .nyc_output.
 * Read lazily: a worker may evaluate this module before the coverage config
 * has set the environment variable.
 */
const coverageEnabled = () => process.env.SV_COVERAGE === '1';
const shardCoverage: Record<string, unknown> = {};
const instrumented = new WeakSet<BrowserContext>();

type CoverageData = { s: Record<string, number>; f: Record<string, number>; b: Record<string, number[]> };
type CoverageSink = Record<string, CoverageData>;

/** Sums counters into the worker shard; the same file may be reported many times. */
function mergeCoverage(sink: CoverageSink, incoming: Record<string, CoverageData>) {
  for (const [file, data] of Object.entries(incoming)) {
    const existing = sink[file];
    if (!existing) {
      sink[file] = data;
      continue;
    }
    for (const key of Object.keys(data.s)) existing.s[key] = (existing.s[key] ?? 0) + (data.s[key] ?? 0);
    for (const key of Object.keys(data.f)) existing.f[key] = (existing.f[key] ?? 0) + (data.f[key] ?? 0);
    for (const key of Object.keys(data.b)) {
      const left = existing.b[key] ?? [];
      const right = data.b[key] ?? [];
      existing.b[key] = right.map((count, index) => (left[index] ?? 0) + count);
    }
  }
}

/**
 * Coverage lives in the page's JS context, so it is flushed to Node while the
 * page is alive (interval + pagehide), not read once at the end. Otherwise the
 * last navigation of a test would erase everything before it.
 */
async function instrument(context: BrowserContext) {
  if (instrumented.has(context)) return;
  instrumented.add(context);
  await context.exposeBinding('__svCoverage', (_source, data: Record<string, CoverageData>) => {
    mergeCoverage(shardCoverage as CoverageSink, data);
  });
  await context.addInitScript(() => {
    const flush = () => {
      const coverage = (window as unknown as { __coverage__?: unknown }).__coverage__;
      if (coverage) void (window as unknown as { __svCoverage?: (data: unknown) => Promise<void> }).__svCoverage?.(coverage);
    };
    setInterval(flush, 300);
    addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flush);
  });
}

export const test = base.extend<{ lab: Page; zoom: (value: number) => Promise<void> }, { native: NativeBrowser }>({
  // The plain `page` fixture also feeds the coverage shard (preflight suite).
  page: [async ({ page }, use) => {
    if (coverageEnabled()) await instrument(page.context());
    await use(page);
    if (coverageEnabled()) await collect(page, shardCoverage);
  }, { timeout: 20000 }],
  native: [async ({}, use) => {
    const prefix = resolve(join(tmpdir(), 'stable-viewport-'));
    const profile = await mkdtemp(prefix);
    // Real page zoom needs Google Chrome's `chrome.settingsPrivate`. Override with
    // SV_BROWSER_CHANNEL (e.g. `msedge`) when Chrome is not the target channel.
    const context = await chromium.launchPersistentContext(profile, {
      channel: (process.env.SV_BROWSER_CHANNEL ?? 'chrome') as 'chrome',
      headless: true,
      viewport: { width: 1920, height: 1080 },
    });
    if (coverageEnabled()) await instrument(context);
    const settings = await context.newPage();
    await settings.goto('chrome://settings/appearance');
    try {
      await use({ context, settings });
    } finally {
      await context.close();
      if (!resolve(profile).startsWith(prefix)) throw new Error('Unsafe profile cleanup path');
      await rm(profile, { recursive: true, force: true });
    }
  }, { scope: 'worker' }],
  lab: async ({ native }, use) => {
    await native.settings.evaluate(() => new Promise<void>((resolve) => chrome.settingsPrivate.setDefaultZoom(1, resolve)));
    const page = await native.context.newPage();
    await use(page);
    if (coverageEnabled()) await collect(page, shardCoverage);
    await page.close();
  },
  zoom: async ({ native, lab }, use) => {
    await use(async (value: number) => {
      await native.settings.evaluate((zoom) => new Promise<void>((resolve) => chrome.settingsPrivate.setDefaultZoom(zoom, resolve)), value);
      await lab.waitForFunction((zoom) => Math.abs(devicePixelRatio - zoom) < 0.02, value);
      await lab.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    });
  },
});

/**
 * Merges the page's counters and immediately persists a partial shard. Writing
 * per collection (instead of once in afterAll) keeps the data even when
 * Playwright runs each file's hooks in a different context.
 */
async function collect(page: Page, sink: Record<string, unknown>) {
  try {
    const coverage = await page.evaluate(() => (window as { __coverage__?: Record<string, CoverageData> }).__coverage__);
    if (!coverage) return;
    mergeCoverage(sink as CoverageSink, coverage);
    await mkdir('.nyc_output', { recursive: true });
    const name = `part-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
    await writeFile(join('.nyc_output', name), JSON.stringify(coverage));
  } catch {
    // Coverage is best effort; the page may already be gone.
  }
}



export { expect };

export async function open(page: Page, mode = 'core', manual = false) {
  await page.goto(`/examples/playground/?mode=${mode}${manual ? '&manual' : ''}`);
  await expect(page.locator('#mount')).toBeVisible();
  if (!manual) await active(page);
}

export async function active(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--sv-vw'))).not.toBe('');
}

export async function inactive(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--sv-vw'))).toBe('');
}

export async function measure(page: Page, selector: string) {
  return page.locator(selector).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width * devicePixelRatio, height: rect.height * devicePixelRatio, x: rect.x * devicePixelRatio, y: rect.y * devicePixelRatio };
  });
}

declare global { const chrome: { settingsPrivate: { setDefaultZoom(value: number, callback: () => void): void } }; }
