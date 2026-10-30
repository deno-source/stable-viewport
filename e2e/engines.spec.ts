import { firefox, webkit, chromium, type Browser, type Page } from '@playwright/test';
import { test, expect } from './fixtures';

/**
 * Engine compatibility. `chrome.settingsPrivate` is Chromium-only, so these
 * engines are driven by the *equivalent* condition: a browser zoom of N % gives
 * `innerWidth / N` CSS pixels with `devicePixelRatio = N`. Setting the viewport
 * and the device scale factor reproduces exactly the geometry our canvas math
 * reads, so identical assertions are valid.
 */
const ENGINES = { firefox, webkit, chromium } as const;
type EngineName = keyof typeof ENGINES;

interface Probe {
  width: number;
  height: number;
  right: number;
  designWidth: number;
  zoom: number;
  clientWidth: number;
  breakpoints: string[];
  media1440: boolean;
  media1600: boolean;
  containerColor: string;
  scrollWidth: number;
  status: string;
}

async function launch(name: EngineName): Promise<Browser> {
  return ENGINES[name].launch();
}

/** 1920×1080 window at `factor` zoom → viewport/factor CSS px, dpr = factor. */
async function zoomedPage(browser: Browser, factor: number): Promise<Page> {
  const page = await browser.newPage({
    viewport: { width: Math.round(1920 / factor), height: Math.round(1080 / factor) },
    deviceScaleFactor: factor,
  });
  return page;
}

const PROBE_SELECTORS = ['#p-px', '#p-rem', '#p-em', '#p-clamp', '#p-max', '#p-calc', '#p-grid > div:nth-child(1)', '#p-svg', '#p-icon-font', '#p-nowrap'];
const BREAKPOINTS = ['#bp-block-1440', '#bp-min-1600', '#bp-min-90rem', '#bp-range', '#bp-dark', '#bp-landscape'];

async function measure(page: Page, selector: string) {
  return page.locator(selector).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height, right: rect.right };
  });
}

async function snapshot(page: Page, designWidth = 1920): Promise<Probe> {
  const boxes = await Promise.all(PROBE_SELECTORS.map((selector) => measure(page, selector)));
  const base = await page.evaluate((selectors) => ({
    designWidth: Number(document.documentElement.style.getPropertyValue('--sv-vw')) * 100,
    zoom: parseFloat(document.documentElement.style.zoom),
    clientWidth: document.documentElement.clientWidth,
    breakpoints: selectors.map((selector) => getComputedStyle(document.querySelector(selector)!).display),
    media1440: matchMedia('(max-width: 1440px)').matches,
    media1600: matchMedia('(min-width: 1600px)').matches,
    containerColor: getComputedStyle(document.querySelector('#p-cq')!).backgroundColor,
    scrollWidth: document.documentElement.scrollWidth,
  }), BREAKPOINTS);
  return {
    ...base,
    designWidth: base.designWidth || designWidth,
    width: boxes[0]!.width,
    height: boxes[0]!.height,
    right: boxes[0]!.right,
    status: await page.evaluate(() => (window as any).fixture?.state?.()?.status ?? 'active'),
  };
}

for (const name of Object.keys(ENGINES) as EngineName[]) {
  test.describe(`${name}`, () => {
    test(`${name}: capability, canvas geometry and breakpoints at 100 %, 200 % and 400 %`, async () => {
      const browser = await launch(name);
      try {
        const reference = await zoomedPage(browser, 1);
        await reference.goto('/examples/compat/?mode=core');
        await reference.waitForFunction(() => document.documentElement.style.getPropertyValue('--sv-vw') !== '');
        const baseline = await snapshot(reference);
        expect(baseline.status).toBe('active');
        expect(baseline.designWidth).toBe(1920);
        const baselineBoxes = await Promise.all(PROBE_SELECTORS.map((selector) => measure(reference, selector)));
        const baselineBreakpoints = baseline.breakpoints;
        // Design-space width is invariant: measured CSS px scale with the canvas.
        const designOf = (width: number, clientWidth: number) => (width * 1920) / clientWidth;

        for (const factor of [2, 4]) {
          const page = await zoomedPage(browser, factor);
          await page.goto('/examples/compat/?mode=core');
          await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--sv-vw') !== '');
          const zoom = await page.evaluate(() => parseFloat(document.documentElement.style.zoom));
          const expected = await page.evaluate(() => document.documentElement.clientWidth / 1920);
          expect(Math.abs(zoom - expected), `${name} ${factor}x zoom factor`).toBeLessThan(0.005);
          const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
          for (const [index, selector] of PROBE_SELECTORS.entries()) {
            const box = await measure(page, selector);
            const design = designOf(box.width, clientWidth);
            const reference = designOf(baselineBoxes[index]!.width, 1920);
            expect(Math.abs(design - reference), `${name} ${factor}x ${selector}`).toBeLessThan(2);
          }
          const state = await snapshot(page);
          expect(state.breakpoints).toEqual(baselineBreakpoints);
          expect(state.media1440).toBe(false);
          expect(state.media1600).toBe(true);
          expect(state.containerColor).toBe(baseline.containerColor);
          // No horizontal overflow: the canvas is the content box.
          expect(state.scrollWidth).toBeLessThanOrEqual(state.clientWidth + 1);
          await page.close();
        }
        await reference.close();
      } finally {
        await browser.close();
      }
    });

    test(`${name}: no CSS zoom support fails closed and leaves the page untouched`, async () => {
      const browser = await launch(name);
      try {
        const page = await zoomedPage(browser, 1);
        await page.goto('/examples/compat/?mode=none');
        const result = await page.evaluate(async () => {
          // Simulate an engine whose zoom property is parsed but ignored.
          const descriptor = Object.getOwnPropertyDescriptor(CSS, 'supports');
          const original = CSS.supports.bind(CSS);
          Object.defineProperty(CSS, 'supports', {
            configurable: true,
            value: (property: string, value: string) => (property === 'zoom' ? false : original(property, value)),
          });
          const { mountViewport } = await import('/src/index.ts');
          const controller = mountViewport({ designWidth: 1920 });
          const state = controller.getState();
          const style = document.documentElement.getAttribute('style');
          controller.destroy();
          Object.defineProperty(CSS, 'supports', descriptor ?? { configurable: true, value: original });
          return { status: state.status, codes: state.diagnostics.map((diagnostic) => diagnostic.code), style };
        });
        expect(result.status).toBe('unsupported');
        expect(result.codes).toContain('no-css-zoom');
        expect(result.style).toBe(null);
        await page.close();
      } finally {
        await browser.close();
      }
    });

    test(`${name}: runtime hooks (CSSOM, shadow DOM, adopted sheets, media events) and full restore`, async () => {
      const browser = await launch(name);
      try {
        const page = await zoomedPage(browser, 2);
        await page.goto('/examples/compat/?mode=core&manual');
        // Capture the pristine APIs before anything is installed.
        await page.evaluate(() => {
          Object.assign(window, {
            native: {
              insert: CSSStyleSheet.prototype.insertRule,
              replace: CSSStyleSheet.prototype.replace,
              replaceSync: CSSStyleSheet.prototype.replaceSync,
              media: window.matchMedia,
              attachShadow: Element.prototype.attachShadow,
            },
          });
        });
        await page.locator('#mount').click();
        await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--sv-vw') !== '');

        const features = await page.evaluate(async () => {
          const sheet = new CSSStyleSheet();
          sheet.replaceSync('#p-adopted{width:14vw;height:18px}');
          document.adoptedStyleSheets = [...(document.adoptedStyleSheets ?? []), sheet];
          const host = document.querySelector('#shadow-host')!;
          const shadow = host.attachShadow({ mode: 'open' });
          shadow.innerHTML = '<style>#inner{width:11vw;height:22px}</style><div id="inner"></div>';
          const style = document.createElement('style');
          style.textContent = '#p-injected{width:12vw;height:20px}';
          document.head.append(style);
          const dynamic = document.createElement('style');
          document.head.append(dynamic);
          dynamic.sheet!.insertRule('#p-rule{width:13vw;height:24px}');
          for (const [id, selector] of [['p-adopted', '#p-adopted'], ['p-injected', '#p-injected'], ['p-rule', '#p-rule']]) {
            const element = document.createElement('div');
            element.id = id;
            document.body.append(element);
            void selector;
          }
          const query = matchMedia('(max-width: 1440px)');
          const tall = matchMedia('(min-height: 2000px)');
          const events: boolean[] = [];
          const tallEvents: boolean[] = [];
          query.addEventListener('change', (event) => events.push((event as MediaQueryListEvent).matches));
          tall.addEventListener('change', (event) => tallEvents.push((event as MediaQueryListEvent).matches));
          Object.assign(window, { query, events, tall, tallEvents });
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const widths = ['#p-adopted', '#p-injected', '#p-rule', '#inner'].map((selector) => {
            const element = selector === '#inner' ? shadow.querySelector('#inner')! : document.querySelector(selector)!;
            return element.getBoundingClientRect().width;
          });
          return {
            widths,
            mediaText: query.media,
            matches: query.matches,
            patched: {
              insert: CSSStyleSheet.prototype.insertRule !== (window as any).native.insert,
              media: window.matchMedia !== (window as any).native.media,
              attachShadow: Element.prototype.attachShadow !== (window as any).native.attachShadow,
            },
          };
        });
        // 14vw / 12vw / 13vw / 11vw of the 1920 design canvas, converted back from CSS px.
        expect(features.widths.map((width) => Math.round(width * 2))).toEqual([269, 230, 250, 211]);
        expect(features.patched).toEqual({ insert: true, media: true, attachShadow: true });
        expect(features.mediaText).toBe('(max-width: 1440px)');
        expect(features.matches).toBe(false);

        // Fixed design width: a width breakpoint must not emit a transient
        // false→true pair; the design-space answer never changes.
        await page.setViewportSize({ width: 480, height: 270 });
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        expect(await page.evaluate(() => (window as any).events)).toEqual([]);
        expect(await page.evaluate(() => (window as any).query.matches)).toBe(false);

        // A real design-space change still notifies: scale stays 0.25 while the
        // window gets taller, so the projected height breakpoint flips.
        await page.setViewportSize({ width: 480, height: 800 });
        await expect.poll(() => page.evaluate(() => (window as any).tallEvents.length)).toBeGreaterThan(0);
        expect(await page.evaluate(() => (window as any).tallEvents.at(-1))).toBe(true);
        expect(await page.evaluate(() => (window as any).events)).toEqual([]);

        await page.locator('#unmount').click();
        await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--sv-vw'))).toBe('');

        const after = await page.evaluate(() => {
          const sheet = new CSSStyleSheet();
          sheet.replaceSync('#p-late{width:10vw;height:10px}');
          document.adoptedStyleSheets = [...(document.adoptedStyleSheets ?? []), sheet];
          const late = document.createElement('div');
          late.id = 'p-late';
          document.body.append(late);
          return {
            restored: {
              insert: CSSStyleSheet.prototype.insertRule === (window as any).native.insert,
              replace: CSSStyleSheet.prototype.replace === (window as any).native.replace,
              replaceSync: CSSStyleSheet.prototype.replaceSync === (window as any).native.replaceSync,
              attachShadow: Element.prototype.attachShadow === (window as any).native.attachShadow,
            },
            zoom: document.documentElement.style.zoom,
            lateWidth: late.getBoundingClientRect().width,
            viewport: document.documentElement.clientWidth,
          };
        });
        expect(after.restored).toEqual({ insert: true, replace: true, replaceSync: true, attachShadow: true });
        expect(after.zoom).toBe('');
        // 10vw of the engine viewport proves native semantics returned after teardown.
        expect(after.lateWidth).toBeCloseTo(after.viewport * 0.1, 0);
        await page.close();
      } finally {
        await browser.close();
      }
    });
  });
}
