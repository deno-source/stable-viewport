import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * Robustness: nested stylesheet layers that are rare but real, repeated hooks,
 * detached nodes, and reconfiguration between documents. These paths are what
 * break a wrapper in production, so they are asserted explicitly.
 */

async function mountCompat(page: Page) {
  await page.goto('/examples/compat/?mode=core');
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--sv-vw') !== '');
}

test('nested @import, @layer and @supports are adapted and restored', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await mountCompat(page);
  const result = await page.evaluate(async () => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/examples/playground/nested.css';
    document.head.append(link);
    await new Promise((resolve) => link.addEventListener('load', resolve, { once: true }));
    const probe = document.createElement('div');
    probe.id = 'imported-probe';
    document.body.append(probe);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const before = probe.getBoundingClientRect().width;
    const mediaTexts: string[] = [];
    const collect = (rules: CSSRuleList) => {
      for (const rule of Array.from(rules)) {
        const media = (rule as CSSMediaRule).media;
        if (media && typeof media.mediaText === 'string') mediaTexts.push(media.mediaText);
        const children = (rule as CSSGroupingRule).cssRules;
        if (children) collect(children);
        const imported = (rule as CSSImportRule).styleSheet;
        if (imported) collect(imported.cssRules);
      }
    };
    collect(link.sheet!.cssRules);
    (window as any).fixture.unmount();
    await new Promise((resolve) => setTimeout(resolve, 60));
    const after = probe.getBoundingClientRect().width;
    const restored: string[] = [];
    const collectRestored = (rules: CSSRuleList) => {
      for (const rule of Array.from(rules)) {
        const media = (rule as CSSMediaRule).media;
        if (media && typeof media.mediaText === 'string') restored.push(media.mediaText);
        const children = (rule as CSSGroupingRule).cssRules;
        if (children) collectRestored(children);
        const imported = (rule as CSSImportRule).styleSheet;
        if (imported) collectRestored(imported.cssRules);
      }
    };
    collectRestored(link.sheet!.cssRules);
    return { before, after, mediaTexts, restored };
  });
  // 300 design px inside a 1280 px viewport on a 1920 px canvas: 300 * 1280/1920.
  expect(result.before).toBeCloseTo(200, 0);
  // Nested rules were projected onto the 1280 px engine viewport: 1200 * 1280/1920.
  expect(result.mediaTexts).toEqual(expect.arrayContaining(['(min-width: 800px)']));
  expect(result.after).toBeCloseTo(300, 0);
  expect(result.mediaTexts).toEqual(expect.arrayContaining(['(min-width: 800px)']));
  // Every author text is back, including the one inside the imported sheet.
  expect(result.restored).toEqual(expect.arrayContaining(['(min-width: 1200px)']));
  expect(result.restored).not.toEqual(expect.arrayContaining(['(min-width: 800px)']));
});

test('detached style, shadow host and adopted sheet are pruned without throwing', async ({ page }) => {
  await mountCompat(page);
  const result = await page.evaluate(async () => {
    const style = document.createElement('style');
    style.textContent = '@media (max-width: 1500px) { #p-px { outline: 1px solid red } }';
    document.head.append(style);
    const dynamic = document.createElement('style');
    document.head.append(dynamic);
    dynamic.sheet!.insertRule('@media (min-width: 1400px) { #p-px { color: rgb(1, 2, 3) } }');
    const host = document.querySelector('#shadow-host')!;
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<style>@media (max-width: 1600px) { #inner { width: 9vw } }</style><div id="inner"></div>';
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const whileAttached = getComputedStyle(shadow.querySelector('#inner')!).width;
    host.remove();
    style.remove();
    dynamic.remove();
    // refresh() must survive detached nodes and forget the shadow root.
    (window as any).fixture.refresh?.();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { whileAttached, zoomStillSet: document.documentElement.style.zoom !== '' };
  });
  expect(parseFloat(result.whileAttached)).toBeGreaterThan(0);
  expect(result.zoomStillSet).toBe(true);
});

test('replace / replaceSync / adopted sheets are re-adapted on every assignment', async ({ page }) => {
  await mountCompat(page);
  const result = await page.evaluate(async () => {
    const first = new CSSStyleSheet();
    first.replaceSync('#p-px { width: 10vw }');
    document.adoptedStyleSheets = [first];
    const second = new CSSStyleSheet();
    await second.replace('#p-px { width: 20vw; background: rgb(9, 9, 9) }');
    document.adoptedStyleSheets = [second];
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const box = document.querySelector('#p-px')!.getBoundingClientRect();
    document.adoptedStyleSheets = [];
    return { width: box.width, viewport: document.documentElement.clientWidth };
  });
  // 20vw of the canvas, whatever the zoom level is.
  expect((result.width / result.viewport) * 1920).toBeCloseTo(384, 0);
});

test('reconfiguration moves the canvas between documents and back', async ({ page }) => {
  await mountCompat(page);
  const result = await page.evaluate(async () => {
    const { mountViewport } = await import('/src/index.ts');
    const frame = document.createElement('iframe');
    frame.id = 'target';
    document.body.append(frame);
    const inner = frame.contentDocument!;
    const controller = mountViewport({ document: inner, designWidth: 1920 });
    const inFrame = inner.documentElement.style.getPropertyValue('--sv-vw');
    const inHost = document.documentElement.style.getPropertyValue('--sv-vw');
    (window as any).fixture.unmount();
    await new Promise((resolve) => setTimeout(resolve, 40));
    const frameAfterHostRelease = inner.documentElement.style.getPropertyValue('--sv-vw');
    controller.destroy();
    return { inFrame, inHost, frameAfterHostRelease, frameAfterDestroy: inner.documentElement.style.getPropertyValue('--sv-vw') };
  });
  expect(result.inFrame).toBe('19.2px');
  expect(result.inHost).toBe('19.2px');
  expect(result.frameAfterHostRelease).toBe('19.2px');
  expect(result.frameAfterDestroy).toBe('');
});

test('repeated destroy, refresh after destroy and a second owner stay harmless', async ({ page }) => {
  await mountCompat(page);
  const result = await page.evaluate(async () => {
    const { mountViewport } = await import('/src/index.ts');
    (window as any).fixture.unmount();
    await new Promise((resolve) => setTimeout(resolve, 40));
    const one = mountViewport();
    const two = mountViewport();
    one.destroy();
    one.destroy();
    one.refresh();
    const stillActive = two.getState().status;
    const zoom = document.documentElement.style.zoom;
    two.destroy();
    const cleaned = document.documentElement.style.zoom;
    return { stillActive, zoom, cleaned, destroyedState: one.getState().status };
  });
  expect(result.stillActive).toBe('active');
  expect(result.zoom).not.toBe('');
  expect(result.cleaned).toBe('');
  expect(result.destroyedState).toBe('destroyed');
});

test('a disabled controller never touches the document', async ({ page }) => {
  await page.goto('/examples/compat/?mode=none');
  const result = await page.evaluate(async () => {
    const { mountViewport } = await import('/src/index.ts');
    const before = document.documentElement.getAttribute('style');
    const disabled = mountViewport({ enabled: false }).getState();
    const toggle = mountViewport({ enabled: false });
    toggle.update({ enabled: true });
    const enabledAgain = toggle.getState().status;
    toggle.destroy();
    return {
      disabled: disabled.status,
      disabledDiagnostics: disabled.diagnostics.map((diagnostic) => diagnostic.code),
      enabledAgain,
      untouchedBefore: before === null,
      cleaned: document.documentElement.style.zoom,
    };
  });
  expect(result.disabled).toBe('disabled');
  expect(result.disabledDiagnostics).toEqual([]);
  expect(result.enabledAgain).toBe('active');
  expect(result.untouchedBefore).toBe(true);
  expect(result.cleaned).toBe('');
});

test('mobile user agent disables adaptation unless mobile: true', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148' });
  await page.goto('/examples/compat/?mode=none');
  const result = await page.evaluate(async () => {
    const { mountViewport } = await import('/src/index.ts');
    const auto = mountViewport().getState();
    const forced = mountViewport({ mobile: true, designWidth: 390 });
    forced.destroy();
    return { auto: auto.status, autoCodes: auto.diagnostics.map((diagnostic) => diagnostic.code) };
  });
  expect(result.auto).toBe('disabled');
  expect(result.autoCodes).toContain('mobile-disabled');
  await page.close();
});
