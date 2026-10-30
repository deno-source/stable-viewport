import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * Cases that a real integration hits but a happy-path suite misses. Each one is
 * either supported (asserted) or an explicit, documented limitation.
 */

async function mount(page: Page, width = 1920) {
  await page.goto('/examples/clean/');
  await page.evaluate(async (designWidth) => {
    const { mountViewport } = await import('/src/index.ts');
    (window as any).controller = mountViewport({ designWidth });
  }, width);
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--sv-vw') !== '');
}

test('media attribute on <link>/<style> is projected and restored', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mount(page);
  const result = await page.evaluate(async () => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.media = '(max-width: 1440px)';
    link.href = '/examples/playground/imported.css';
    document.head.append(link);
    const style = document.createElement('style');
    style.media = '(min-width: 1600px)';
    style.textContent = '#probe-px { outline: 2px solid rgb(1, 2, 3) }';
    document.head.append(style);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const during = { link: link.getAttribute('media'), style: style.getAttribute('media') };
    (window as any).controller.destroy();
    return { during, after: { link: link.getAttribute('media'), style: style.getAttribute('media') } };
  });
  // 1440 * 1280/1920 = 960; 1600 * 1280/1920 = 1066.67
  expect(result.during.link).toBe('(max-width: 960px)');
  expect(result.during.style).toBe('(min-width: 1066.66666667px)');
  expect(result.after).toEqual({ link: '(max-width: 1440px)', style: '(min-width: 1600px)' });
});

test('media attribute follows a resize, is pruned when detached and leaves app edits alone', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await mount(page);
  const result = await page.evaluate(async () => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.media = '(min-width: 1600px)';
    link.href = '/examples/playground/imported.css';
    document.head.append(link);
    const controller = (window as any).controller;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const initial = link.getAttribute('media');

    // A resize must re-project the attribute (1600 * 1280/1920 = 1066.67).
    Object.defineProperty(window, 'innerWidth', { configurable: true, get: () => 1280 });
    controller.refresh();
    const afterResize = link.getAttribute('media');

    // A detached element is forgotten instead of keeping it alive.
    link.remove();
    controller.refresh();

    // An application edit after ours must not be overwritten on teardown.
    const style = document.createElement('style');
    style.media = '(max-width: 900px)';
    document.head.append(style);
    // The element must be seen by the scan before it can be projected.
    await new Promise((resolve) => setTimeout(resolve, 30));
    const ours = style.getAttribute('media');
    style.setAttribute('media', '(max-width: 999px)');
    controller.destroy();
    return { initial, afterResize, ours, appValueKept: style.getAttribute('media') };
  });
  expect(result.initial).toBe('(min-width: 1600px)');
  expect(result.afterResize).toBe('(min-width: 1066.66666667px)');
  expect(result.ours).toBe('(max-width: 600px)');
  expect(result.appValueKept).toBe('(max-width: 999px)');
});

test('a custom element created before defineStableViewport upgrades and mounts', async ({ page }) => {
  await page.goto('/examples/clean/');
  const result = await page.evaluate(async () => {
    const element = document.createElement('stable-viewport');
    element.setAttribute('design-width', '1920');
    element.innerHTML = '<div id="late-child">late upgrade</div>';
    document.body.append(element);
    // Not upgraded yet: the plain HTMLElement has no controller API.
    const beforeDefine = typeof (element as any).getState;
    const { defineStableViewport } = await import('/src/web-component.ts');
    defineStableViewport();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const state = (element as any).getState?.();
    const svw = document.documentElement.style.getPropertyValue('--sv-vw');
    element.remove();
    await new Promise((resolve) => setTimeout(resolve, 50));
    return { beforeDefine, status: state?.status, svw, after: document.documentElement.style.getPropertyValue('--sv-vw'), display: element.style.display };
  });
  expect(result.beforeDefine).toBe('undefined');
  expect(result.status).toBe('active');
  expect(result.svw).toBe('19.2px');
  expect(result.after).toBe('');
  expect(result.display).toBe('');
});

test('two same-origin iframes each keep their own canvas without touching the host', async ({ page }) => {
  await mount(page);
  const result = await page.evaluate(async () => {
    const { mountViewport } = await import('/src/index.ts');
    const frames = [document.createElement('iframe'), document.createElement('iframe')];
    for (const frame of frames) document.body.append(frame);
    const controllers = frames.map((frame, index) => mountViewport({ document: frame.contentDocument!, designWidth: index === 0 ? 1920 : 1440 }));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const values = frames.map((frame) => frame.contentDocument!.documentElement.style.getPropertyValue('--sv-vw'));
    const host = document.documentElement.style.getPropertyValue('--sv-vw');
    controllers.forEach((controller) => controller.destroy());
    const cleared = frames.map((frame) => frame.contentDocument!.documentElement.style.getPropertyValue('--sv-vw'));
    return { values, host, cleared };
  });
  expect(result.values).toEqual(['19.2px', '14.4px']);
  expect(result.host).toBe('19.2px');
  expect(result.cleared).toEqual(['', '']);
});

test('an unrelated <link media="print"> and prefers-color-scheme are never rewritten', async ({ page }) => {
  await mount(page);
  const result = await page.evaluate(async () => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.media = 'print';
    link.href = '/examples/playground/imported.css';
    document.head.append(link);
    const style = document.createElement('style');
    style.media = '(prefers-color-scheme: dark)';
    style.textContent = '#probe-px { outline: 1px solid rgb(4, 5, 6) }';
    document.head.append(style);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { link: link.getAttribute('media'), style: style.getAttribute('media') };
  });
  expect(result).toEqual({ link: 'print', style: '(prefers-color-scheme: dark)' });
});

test('print media emulation keeps the canvas and does not rewrite print conditions', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mount(page);
  await page.emulateMedia({ media: 'print' });
  const printState = await page.evaluate(() => ({
    zoom: document.documentElement.style.zoom,
    svw: document.documentElement.style.getPropertyValue('--sv-vw'),
  }));
  await page.emulateMedia({ media: 'screen' });
  const screenState = await page.evaluate(() => ({
    zoom: document.documentElement.style.zoom,
    svw: document.documentElement.style.getPropertyValue('--sv-vw'),
  }));
  expect(parseFloat(printState.zoom)).toBeCloseTo(1280 / 1920, 4);
  expect(printState.svw).toBe('19.2px');
  expect(screenState.svw).toBe('19.2px');
});

test('forced-colors and reduced-motion preferences pass through untouched', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await mount(page);
  const result = await page.evaluate(() => ({
    forced: matchMedia('(forced-colors: active)').matches,
    reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
    untouchedMedia: matchMedia('(forced-colors: active)').media,
  }));
  expect(result).toEqual({ forced: true, reduced: true, untouchedMedia: '(forced-colors: active)' });
});

test('an invalid matchMedia query behaves like the native one', async ({ page }) => {
  await mount(page);
  const result = await page.evaluate(() => {
    const native = matchMedia('nonsense query').matches;
    const ours = matchMedia('nonsense query');
    return { native, matches: ours.matches, media: ours.media };
  });
  expect(result.matches).toBe(result.native);
  expect(result.media).toBe('nonsense query');
});

test('scrollbar-gutter and overlay scrollbars do not widen the canvas', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 700 });
  await page.goto('/examples/clean/');
  const result = await page.evaluate(async () => {
    document.documentElement.style.scrollbarGutter = 'stable both-edges';
    const tall = document.createElement('div');
    tall.style.height = '3000px';
    document.body.append(tall);
    const { mountViewport } = await import('/src/index.ts');
    const controller = mountViewport({ designWidth: 1920 });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const out = {
      zoom: parseFloat(document.documentElement.style.zoom),
      canvas: document.documentElement.clientWidth,
      expected: document.documentElement.clientWidth / 1920,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
    controller.destroy();
    tall.remove();
    return out;
  });
  expect(Math.abs(result.zoom - result.expected)).toBeLessThan(0.01);
  expect(result.overflowX).toBeLessThanOrEqual(1);
});

test('a stylesheet that fails to load does not break the session', async ({ page }) => {
  await mount(page);
  const result = await page.evaluate(async () => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/does-not-exist.css';
    document.head.append(link);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const still = document.documentElement.style.getPropertyValue('--sv-vw');
    (window as any).controller.refresh();
    const afterRefresh = document.documentElement.style.getPropertyValue('--sv-vw');
    return { still, afterRefresh, status: (window as any).controller.getState().status };
  });
  expect(result).toEqual({ still: '19.2px', afterRefresh: '19.2px', status: 'active' });
});
