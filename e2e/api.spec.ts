import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * Public API surface: every documented state, transition and error path, driven
 * through the shipping entry points rather than internal hooks.
 */

async function blank(page: Page) {
  await page.goto('/examples/clean/');
}

test('core: statuses, update, refresh and idempotent teardown', async ({ page }) => {
  await blank(page);
  const report = await page.evaluate(async () => {
    const { mountViewport } = await import('/src/index.ts');
    const out: Record<string, unknown> = {};
    const controller = mountViewport();
    out.active = controller.getState().status;
    out.scale = controller.getState().scale;
    controller.refresh();
    controller.update({ designWidth: 1600 });
    out.updated = controller.getState().designWidth;
    controller.update({ enabled: false });
    out.disabled = controller.getState().status;
    out.vwWhileDisabled = document.documentElement.style.getPropertyValue('--sv-vw');
    controller.update({ enabled: true, mobile: true });
    out.reenabled = controller.getState().status;
    controller.destroy();
    out.destroyed = controller.getState().status;
    controller.destroy();
    out.stillDestroyed = controller.getState().status;
    out.updateThrows = (() => { try { controller.update({ designWidth: 1440 }); return false; } catch { return true; } })();
    out.zoomAfter = document.documentElement.style.zoom;
    return out;
  });
  expect(report).toMatchObject({
    active: 'active',
    updated: 1600,
    disabled: 'disabled',
    vwWhileDisabled: '',
    reenabled: 'active',
    destroyed: 'destroyed',
    stillDestroyed: 'destroyed',
    updateThrows: true,
    zoomAfter: '',
  });
  expect(report.scale).toBeGreaterThan(0);
});

test('core: invalid input is rejected before any side effect', async ({ page }) => {
  await blank(page);
  const result = await page.evaluate(async () => {
    const { mountViewport } = await import('/src/index.ts');
    const before = document.documentElement.getAttribute('style');
    const errors: string[] = [];
    for (const input of [{ designWidth: 0 }, { designWidth: Number.NaN }, { designWidth: -5 }, null, { onDiagnostic: 1 }, { document: null }]) {
      try {
        mountViewport(input as never).destroy();
        errors.push('accepted');
      } catch (error) {
        errors.push((error as Error).constructor.name);
      }
    }
    return { errors, unchanged: document.documentElement.getAttribute('style') === before };
  });
  expect(result).toEqual({ errors: ['RangeError', 'RangeError', 'RangeError', 'TypeError', 'TypeError', 'TypeError'], unchanged: true });
});

test('core: diagnostics reach every registered owner and survive on state', async ({ page }) => {
  await blank(page);
  const result = await page.evaluate(async () => {
    // Two caveats the page can actually produce: an iframe and a foreign sheet.
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'http://localhost:4379/examples/playground/foreign.css';
    document.head.append(link);
    const { mountViewport } = await import('/src/index.ts');
    const seen: string[][] = [[], []];
    const first = mountViewport({ onDiagnostic: (diagnostic) => seen[0]!.push(diagnostic.code) });
    const second = mountViewport({ onDiagnostic: (diagnostic) => seen[1]!.push(diagnostic.code) });
    await new Promise((resolve) => setTimeout(resolve, 400));
    const state = second.getState();
    first.destroy();
    const afterFirst = second.getState().status;
    second.destroy();
    return { seen, diagnostics: state.diagnostics.map((diagnostic) => diagnostic.code), afterFirst };
  });
  // Live callbacks fire for the owners that exist at that moment...
  expect(result.seen[0]).toEqual(expect.arrayContaining(['opaque-stylesheet', 'iframe-document']));
  expect(result.seen[1]).toEqual([]);
  // ...while the shared session keeps the history for every owner.
  expect(result.diagnostics).toEqual(expect.arrayContaining(['opaque-stylesheet', 'iframe-document']));
  expect(result.afterFirst).toBe('active');
});

test('react: Strict Mode double effect and a failed bootstrap asset still mount once', async ({ page }) => {
  await page.route('**/stable-viewport.auto.js', (route) => route.abort());
  await page.goto('/examples/compat/?mode=react');
  const scale = await page.evaluate(() => parseFloat(document.documentElement.style.zoom));
  const expected = await page.evaluate(() => document.documentElement.clientWidth / 1920);
  expect(Math.abs(scale - expected)).toBeLessThan(0.01);
  expect(await page.evaluate(() => typeof document.querySelector('#adapter-ready'))).toBe('object');
  await page.goto('/examples/compat/?mode=react&manual');
  await page.locator('#mount').click();
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--sv-vw'))).not.toBe('');
  await page.locator('#unmount').click();
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--sv-vw'))).toBe('');
});

test('vue: composable matches the component and updates reactively', async ({ page }) => {
  await page.goto('/examples/composable/');
  await expect(page.locator('#inner')).toBeVisible();
  const initial = await page.evaluate(() => (window as any).lab.state());
  expect(initial.inner).toBe('1920');
  expect(parseFloat(initial.zoom)).toBeGreaterThan(0);

  await page.evaluate(() => (window as any).lab.setWidth(1440));
  const updated = await page.evaluate(() => (window as any).lab.state());
  expect(updated.inner).toBe('1440');

  await page.evaluate(() => (window as any).lab.toggle(false));
  const unmounted = await page.evaluate(() => (window as any).lab.state());
  expect(unmounted.zoom).toBe('');

  await page.evaluate(() => (window as any).lab.stop());
  expect(await page.evaluate(() => document.documentElement.style.zoom)).toBe('');
});

test('vue: the composable also works outside a component instance', async ({ page }) => {
  await page.goto('/examples/composable/?mode=scope');
  const mounted = await page.evaluate(() => (window as any).lab.state());
  expect(mounted.scoped).toBe(1920);
  expect(parseFloat(mounted.zoom)).toBeGreaterThan(0);
  await page.evaluate(() => (window as any).lab.setWidth(1600));
  expect(await page.evaluate(() => (window as any).lab.state())).toMatchObject({ scoped: 1600 });
  await page.evaluate(() => (window as any).lab.stop());
  expect(await page.evaluate(() => document.documentElement.style.zoom)).toBe('');
});

test('custom element: invalid width, disabled attribute and teardown keep the page usable', async ({ page }) => {
  await page.goto('/examples/compat/?mode=wc');
  const result = await page.evaluate(async () => {
    const element = document.querySelector('stable-viewport') as HTMLElement & { getState(): { status: string }; designWidth: number };
    const errors: unknown[] = [];
    element.addEventListener('stable-viewport-error', (event) => errors.push((event as CustomEvent).detail));
    element.setAttribute('design-width', 'abc');
    const afterInvalid = element.getState().status;
    element.setAttribute('design-width', '1920');
    const afterValid = element.getState().status;
    element.setAttribute('disabled', '');
    const afterDisabled = element.getState().status;
    element.removeAttribute('disabled');
    const afterEnabled = element.getState().status;
    (element as unknown as { disabled: boolean }).disabled = true;
    const propertyDisabled = element.getState().status;
    (element as unknown as { designWidth: number }).designWidth = 1440;
    const propertyWidth = element.getAttribute('design-width');
    element.remove();
    await new Promise((resolve) => setTimeout(resolve, 50));
    return {
      errors: errors.length,
      afterInvalid,
      afterValid,
      afterDisabled,
      afterEnabled,
      propertyDisabled,
      propertyWidth,
      cleaned: document.documentElement.style.zoom,
      displayRestored: element.style.display,
    };
  });
  expect(result.errors).toBeGreaterThan(0);
  expect(result.afterInvalid).toBe('active');
  expect(result.afterValid).toBe('active');
  expect(result.afterDisabled).toBe('disabled');
  expect(result.afterEnabled).toBe('active');
  expect(result.propertyDisabled).toBe('disabled');
  expect(result.propertyWidth).toBe('1440');
  expect(result.cleaned).toBe('');
  expect(result.displayRestored).toBe('');
});

test('media: legacy listeners, onchange and the query text contract', async ({ page }) => {
  await page.goto('/examples/compat/?mode=core');
  const result = await page.evaluate(() => {
    const query = matchMedia('(max-width: 1440px)');
    const log: string[] = [];
    const legacy = () => log.push('legacy');
    query.addListener(legacy);
    query.removeListener(legacy);
    query.addListener(legacy);
    query.onchange = () => log.push('onchange');
    const text = query.media;
    const matches = query.matches;
    query.onchange = null;
    query.removeListener(legacy);
    return { text, matches, log };
  });
  expect(result.text).toBe('(max-width: 1440px)');
  expect(result.matches).toBe(false);
  expect(result.log).toEqual([]);
});
