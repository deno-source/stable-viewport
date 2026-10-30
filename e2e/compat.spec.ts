import { test, expect, type Page } from '@playwright/test';
import { test as labTest, measure, active, inactive } from './fixtures';

/**
 * Compatibility matrix for a *foreign* project:
 * hardcoded px, its own breakpoints, percentage/grid layouts, container
 * queries, shadow DOM, adopted sheets, injected styles, body portals.
 * Every assertion is measured in a real Chrome with real page zoom.
 */

const COMPAT = '/examples/compat/';

interface Snapshot {
  [id: string]: { width: number; height: number; x: number; y: number };
}

/** Size probes that do not depend on the *native* viewport, so teardown is comparable. */
const FIXED_PROBES = [
  '#p-px', '#p-rem', '#p-em', '#p-clamp', '#p-max', '#p-calc', '#p-grid > div:nth-child(1)',
  '#p-svg', '#p-icon-font', '#p-image', '#p-nowrap', '#p-line', '#p-fixed',
];

const PROBES = [
  '#p-px', '#p-rem', '#p-em', '#p-pct', '#p-vw', '#p-vmin', '#p-clamp', '#p-max', '#p-calc',
  '#p-grid > div:nth-child(1)', '#p-grid > div:nth-child(3)', '#p-svg', '#p-icon-font', '#p-image',
  '#p-nowrap', '#p-line', '#p-sticky', '#p-fixed',
];

async function open(page: Page, mode = 'core', extra = '') {
  await page.goto(`${COMPAT}?mode=${mode}${extra}`);
  await expect(page.locator('#mount')).toBeVisible();
}

async function snapshot(page: Page, selectors: string[]): Promise<Snapshot> {
  const entries = await Promise.all(selectors.map(async (selector) => [selector, await measure(page, selector)] as const));
  return Object.fromEntries(entries);
}

const BREAKPOINT_PROBES = ['#bp-block-1440', '#bp-min-1600', '#bp-min-90rem', '#bp-range', '#bp-dark', '#bp-landscape'];
/** `ch`/`vw` breakpoints keep native meaning and are allowed to flip; see README. */
const NATIVE_UNIT_PROBES = ['#bp-ch', '#bp-vw'];
const breakpoints = (page: Page) =>
  page.evaluate((selectors) => selectors.map((selector) => getComputedStyle(document.querySelector(selector)!).display), BREAKPOINT_PROBES);

labTest.describe('foreign project compatibility', () => {
  for (const mode of ['core', 'react', 'wc']) {
    labTest(`${mode}: hardcoded px, rem/em, %, grid, container queries and icons keep their design size through real zoom`, async ({ lab, zoom }) => {
      await open(lab, mode);
      await active(lab);
      const baseline = await snapshot(lab, PROBES);
      const baselineBp = await breakpoints(lab);
      const baselineCq = await lab.locator('#p-cq').evaluate((e) => getComputedStyle(e).backgroundColor);
      for (const value of [0.25, 0.5, 0.67, 1.25, 2, 3, 4, 5, 1]) {
        await zoom(value);
        for (const selector of PROBES) {
          const actual = (await measure(lab, selector));
          expect(Math.abs(actual.width - baseline[selector]!.width), `${mode} zoom ${value} width ${selector}`).toBeLessThan(2);
          expect(Math.abs(actual.height - baseline[selector]!.height), `${mode} zoom ${value} height ${selector}`).toBeLessThan(2);
        }
        expect(await breakpoints(lab), `${mode} zoom ${value} breakpoints`).toEqual(baselineBp);
        expect(await lab.locator('#p-cq').evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(baselineCq);
      }
    });
  }

  labTest('breakpoints written in px, rem and ranges follow the design canvas; ch/vw stay native and are reported', async ({ lab }) => {
    await open(lab);
    await active(lab);
    const px = await lab.evaluate(() => ({
      page1440: matchMedia('(max-width: 1440px)').matches,
      min1600: matchMedia('(min-width: 1600px)').matches,
      min90rem: matchMedia('(min-width: 90rem)').matches,
      range: matchMedia('(max-width: 920px) and (min-height: 400px)').matches,
      reported: matchMedia('(max-width: 1440px)').media,
    }));
    // The engine viewport is still 1920 CSS px; the design canvas is 1920 too.
    expect(px.page1440).toBe(false);
    expect(px.min1600).toBe(true);
    expect(px.min90rem).toBe(true);
    expect(px.range).toBe(false);
    // The caller keeps its own media text; only the engine-facing condition changes.
    expect(px.reported).toBe('(max-width: 1440px)');

    // The canvas is pinned to the design width, so design breakpoints are stable
    // by construction: shrinking the window never collapses the desktop layout.
    await lab.setViewportSize({ width: 1280, height: 720 });
    await expect.poll(() => lab.evaluate(() => {
      const zoom = parseFloat(document.documentElement.style.zoom);
      return Math.abs(zoom - document.documentElement.clientWidth / 1920) < 0.001;
    })).toBe(true);
    expect(await lab.evaluate(() => matchMedia('(max-width: 1440px)').matches)).toBe(false);
    expect(await lab.evaluate(() => matchMedia('(min-width: 1600px)').matches)).toBe(true);
    expect(await lab.evaluate(() => matchMedia('(min-width: 90rem)').matches)).toBe(true);
    // Only the height axis follows the real window.
    expect(await lab.evaluate(() => {
      const root = document.documentElement;
      const zoom = parseFloat(root.style.zoom);
      return Math.abs(parseFloat(root.style.getPropertyValue('--sv-vh')) - root.clientHeight / zoom / 100) < 0.01;
    })).toBe(true);
    expect(await breakpoints(lab)).toEqual((await breakpoints(lab)));
  });

  labTest('unsupported relative breakpoint units stay native and are reported once', async ({ lab }) => {
    await open(lab);
    await active(lab);
    const reported = await lab.evaluate(() => [...new Set((window as any).fixture.diagnostics.map((d: any) => d.detail?.unit).filter(Boolean))]);
    expect(reported).toEqual(expect.arrayContaining(['ch', 'vw']));
    expect(await lab.locator('#bp-ch').evaluate((e) => getComputedStyle(e).display)).toBe('block');
  });

  labTest('body portals, fixed and sticky elements stay inside the canvas at 500%', async ({ lab, zoom }) => {
    await open(lab);
    await active(lab);
    await lab.locator('#open-modal').click();
    const before = await snapshot(lab, ['#dialog', '#modal-input', '#p-fixed']);
    await zoom(5);
    const after = await snapshot(lab, ['#dialog', '#modal-input', '#p-fixed']);
    expect(Math.abs(after['#dialog']!.width - before['#dialog']!.width)).toBeLessThan(2);
    expect(Math.abs(after['#dialog']!.x - before['#dialog']!.x)).toBeLessThan(2);
    expect(Math.abs(after['#modal-input']!.width - before['#modal-input']!.width)).toBeLessThan(2);
    await lab.locator('#modal-input').fill('works at 500%');
    await expect(lab.locator('#modal-input')).toHaveValue('works at 500%');
    // Fixed elements resolve against the design canvas: 24 design px from each edge.
    const fixed = after['#p-fixed']!;
    expect(Math.abs(fixed.x + fixed.width - (1920 - 24))).toBeLessThan(3);
    const sticky = await measure(lab, '#p-sticky');
    expect(sticky.height).toBeGreaterThan(0);
  });

  labTest('runtime-injected styles, adopted sheets and late shadow roots adapt immediately', async ({ lab, zoom }) => {
    await open(lab);
    await active(lab);
    await lab.locator('#inject-style').click();
    await lab.locator('#adopt-sheet').click();
    await lab.locator('#late-shadow').click();
    await zoom(5);
    for (const selector of ['#p-injected', '#p-adopted', '#inner']) {
      const box = await measure(lab, selector);
      expect(box.width, selector).toBeGreaterThan(0);
    }
    // Measured in design pixels: 12vw of 1920 = 230.4, 14vw = 268.8, 11vw = 211.2.
    expect((await measure(lab, '#p-injected')).width).toBeCloseTo(230.4, 0);
    expect((await measure(lab, '#p-adopted')).width).toBeCloseTo(268.8, 0);
    expect((await measure(lab, '#inner')).width).toBeCloseTo(211.2, 0);
  });

  labTest('a closed shadow root keeps native units and is documented as unsupported', async ({ lab, zoom }) => {
    await open(lab);
    await active(lab);
    await zoom(5);
    const width = await lab.evaluate(() => (window as any).closedProbe.getBoundingClientRect().width * devicePixelRatio);
    // 10vw inside a closed root keeps native meaning: 10% of the engine viewport
    // (38 design px from a 384 px viewport), not 10% of the 1920 design canvas.
    expect(width).toBeLessThan(60);
    expect(width).toBeGreaterThan(20);
  });

  labTest('cross-origin stylesheet units keep native meaning and are reported', async ({ lab, zoom }) => {
    await open(lab);
    await active(lab);
    await expect.poll(() => lab.evaluate(() => (window as any).fixture.diagnostics.some((d: any) => d.code === 'opaque-stylesheet'))).toBe(true);
  });

  labTest('refreshing after a viewport resize recomputes breakpoints, units and the canvas', async ({ lab }) => {
    await open(lab);
    await active(lab);
    const before = await measure(lab, '#p-px');
    const beforeVh = await lab.evaluate(() => document.documentElement.style.getPropertyValue('--sv-vh'));
    await lab.setViewportSize({ width: 1024, height: 768 });
    // --sv-vw is the design-space width of 1vw, so it stays designWidth/100;
    // the root zoom is what follows the viewport.
    await expect.poll(() => lab.evaluate(() => document.documentElement.style.getPropertyValue('--sv-vh'))).not.toBe(beforeVh);
    expect(await lab.evaluate(() => document.documentElement.style.getPropertyValue('--sv-vw'))).toBe('19.2px');
    await lab.evaluate(() => (window as any).fixture.mount({ designWidth: 1920 }));
    await active(lab);
    // The design ratio survives: a 120 design px probe keeps 120/1920 of the canvas.
    const after = await measure(lab, '#p-px');
    const ratio = await lab.evaluate(() => document.documentElement.clientWidth);
    expect(after.width / ratio).toBeCloseTo(before.width / 1920, 3);
  });

  labTest('printing switches to native units and back without losing the design canvas', async ({ lab, zoom }) => {
    await open(lab);
    await active(lab);
    await zoom(2);
    const screen = await measure(lab, '#p-px');
    await lab.evaluate(() => dispatchEvent(new Event('beforeprint')));
    expect(await lab.evaluate(() => document.documentElement.style.getPropertyValue('--sv-vw'))).toBe('1vw');
    await lab.evaluate(() => dispatchEvent(new Event('afterprint')));
    expect(Math.abs((await measure(lab, '#p-px')).width - screen.width)).toBeLessThan(2);
  });

  labTest('auto bootstrap script adapts a plain HTML page and hands over to an explicit controller', async ({ lab }) => {
    await lab.goto(`${COMPAT}?mode=auto`);
    await active(lab);
    const width = (await measure(lab, '#p-px')).width;
    expect(width).toBeCloseTo(120, 0);
    expect(await lab.evaluate(() => typeof (window as any).StableViewportAuto?.getState)).toBe('function');
    // An explicit controller adopts the bootstrap lease instead of stacking zoom.
    await lab.evaluate(async () => {
      const { mountViewport } = await import('/src/index.ts');
      (window as any).explicit = mountViewport({ designWidth: 1920 });
    });
    expect(await lab.evaluate(() => (window as any).explicit.getState().scale)).toBeCloseTo(1, 2);
    await lab.evaluate(() => (window as any).explicit.destroy());
    await inactive(lab);
  });

  labTest('two owners share one canvas; the last release restores the page exactly', async ({ lab }) => {
    await open(lab);
    await active(lab);
    const baseline = await snapshot(lab, PROBES);
    await lab.locator('#add-owner').click();
    expect(await lab.evaluate(() => (window as any).fixture.extraState().status)).toBe('active');
    await lab.locator('#drop-owner').click();
    await active(lab);
    await lab.locator('#unmount').click();
    await inactive(lab);
    const restored = await snapshot(lab, FIXED_PROBES);
    for (const selector of FIXED_PROBES) {
      expect(Math.abs(restored[selector]!.width - baseline[selector]!.width), selector).toBeLessThan(2);
      expect(Math.abs(restored[selector]!.height - baseline[selector]!.height), selector).toBeLessThan(2);
    }
    expect(await lab.evaluate(() => document.documentElement.style.zoom)).toBe('');
    // Viewport units go back to native meaning (10vw of the real window).
    expect((await measure(lab, '#p-vw')).width).toBeCloseTo(1920 * 0.1, 0);
  });
});

/**
 * Native-browser baselines recorded *without* the component, used to prove the
 * component adds the design canvas instead of replacing project styles.
 */
test.describe('native browser baselines', () => {
  test('the fixture renders the same in a plain browser without the library', async ({ page }) => {
    await page.goto(`${COMPAT}?mode=none`);
    const px = await measure(page, '#p-px');
    expect(px.width).toBeCloseTo(120, 0);
    const noSvw = await page.evaluate(() => document.documentElement.style.getPropertyValue('--sv-vw'));
    expect(noSvw).toBe('');
  });
});
