import { test, expect, type Page } from './fixtures';

/**
 * Regressions for the failure modes found by the performance/robustness audit.
 * Each test drives the public entry points the way an application would and
 * asserts the visible result (computed width, event order, DOM/API state), not
 * an internal implementation detail.
 */

const settle = (page: Page, frames = 3) => page.evaluate((count) => new Promise<void>((resolve) => {
  const step = () => (count -= 1) <= 0 ? resolve() : requestAnimationFrame(step);
  step();
}), frames);

async function clean(page: Page, width = 1280) {
  await page.setViewportSize({ width, height: 1080 });
  await page.goto('/examples/clean/');
  await page.evaluate(async () => {
    (window as any).audit = await import('/src/index.ts');
  });
}

test('constructed sheets re-adapt on every replace, including in-place adoption', async ({ page }) => {
  await clean(page);
  const result = await page.evaluate(async () => {
    const controller = (window as any).audit.mountViewport({ designWidth: 1920 });
    const settle = () => new Promise<void>((resolve) => { let left = 3; const step = () => (left -= 1) ? requestAnimationFrame(step) : resolve(); step(); });
    const widths: number[] = [];
    const sheet = new CSSStyleSheet();
    sheet.replaceSync('#probe-px{width:10vw}');
    document.adoptedStyleSheets = [sheet];
    widths.push(parseFloat(getComputedStyle(document.querySelector('#probe-px')!).width));
    sheet.replaceSync('#probe-px{width:20vw}');
    await settle();
    widths.push(parseFloat(getComputedStyle(document.querySelector('#probe-px')!).width));
    await sheet.replace('#probe-px{width:30vw}');
    await settle();
    widths.push(parseFloat(getComputedStyle(document.querySelector('#probe-px')!).width));
    const prefilled = new CSSStyleSheet();
    prefilled.replaceSync('#probe-px{width:15vw}');
    document.adoptedStyleSheets.push(prefilled);
    await settle();
    widths.push(parseFloat(getComputedStyle(document.querySelector('#probe-px')!).width));
    controller.destroy();
    return widths;
  });
  expect(result).toEqual([192, 384, 576, 288]);
});

test('Text.data, grouping insertRule and @import-only styles adapt without refresh', async ({ page }) => {
  await page.route('**/audit-import.css', (route) => route.fulfill({ contentType: 'text/css', body: '#probe-px{width:20vw}' }));
  await clean(page);
  const result = await page.evaluate(async () => {
    const controller = (window as any).audit.mountViewport({ designWidth: 1920 });
    const settle = () => new Promise<void>((resolve) => { let left = 4; const step = () => (left -= 1) ? requestAnimationFrame(step) : resolve(); step(); });
    const style = document.createElement('style');
    style.textContent = '#probe-px{width:10vw}';
    document.head.append(style);
    style.firstChild!.data = '#probe-px{width:12vw}';
    await settle();
    const textWidth = parseFloat(getComputedStyle(document.querySelector('#probe-px')!).width);

    const grouped = document.createElement('style');
    grouped.textContent = '@supports (display: grid) {}';
    document.head.append(grouped);
    (grouped.sheet!.cssRules[0] as CSSGroupingRule).insertRule('#probe-px{width:13vw}');
    await settle();
    const groupedWidth = parseFloat(getComputedStyle(document.querySelector('#probe-px')!).width);

    const imported = document.createElement('style');
    imported.textContent = '@import url("/audit-import.css");';
    document.head.append(imported);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await settle();
    const importWidth = parseFloat(getComputedStyle(document.querySelector('#probe-px')!).width);
    controller.destroy();
    return { textWidth, groupedWidth, importWidth };
  });
  expect(result.textWidth).toBeCloseTo(230.4, 0);
  expect(result.groupedWidth).toBeCloseTo(249.6, 0);
  expect(result.importWidth).toBeCloseTo(384, 0);
});

test('a detached node keeps author units, re-adapts after offline edits, and the root keeps business variables', async ({ page }) => {
  await clean(page);
  const result = await page.evaluate(async () => {
    document.documentElement.style.setProperty('--audit-width', '20vw');
    const target = document.createElement('div');
    target.id = 'detached';
    target.style.width = 'var(--audit-width)';
    document.body.append(target);
    const controller = (window as any).audit.mountViewport({ designWidth: 1920 });
    const settle = () => new Promise<void>((resolve) => { let left = 3; const step = () => (left -= 1) ? requestAnimationFrame(step) : resolve(); step(); });
    await settle();
    const rootVariable = document.documentElement.style.getPropertyValue('--audit-width');
    const rootWidth = parseFloat(getComputedStyle(target).width);

    target.style.width = '10vw';
    await settle();
    const adapted = parseFloat(getComputedStyle(target).width);
    target.remove();
    await settle();
    const afterRemoval = target.style.width;
    target.style.width = '20vw';
    document.body.append(target);
    await settle();
    const reinserted = parseFloat(getComputedStyle(target).width);
    controller.destroy();
    return { rootVariable, rootWidth, adapted, afterRemoval, reinserted };
  });
  expect(result).toEqual({
    rootVariable: 'calc(20 * var(--sv-vw))',
    rootWidth: 384,
    adapted: 192,
    afterRemoval: '10vw',
    reinserted: 384,
  });
});

test('deleted media rules and repeated same-target writes do bounded work', async ({ page }) => {
  await clean(page);
  const setup = await page.evaluate(async () => {
    const controller = (window as any).audit.mountViewport({ designWidth: 1920 });
    const style = document.createElement('style');
    document.head.append(style);
    const sheet = style.sheet!;
    const deleted = new Set<MediaList>();
    for (let index = 0; index < 500; index += 1) {
      const ruleIndex = sheet.insertRule('@media (min-width:1000px){.audit-deleted{color:red}}', sheet.cssRules.length);
      const rule = sheet.cssRules[ruleIndex] as CSSMediaRule;
      deleted.add(rule.media);
      sheet.deleteRule(ruleIndex);
    }
    const descriptor = Object.getOwnPropertyDescriptor(MediaList.prototype, 'mediaText')!;
    let writes = 0;
    Object.defineProperty(MediaList.prototype, 'mediaText', {
      ...descriptor,
      set(value: string) { if (deleted.has(this as MediaList)) writes += 1; return descriptor.set!.call(this, value); },
    });

    const node = document.createElement('div');
    node.style.width = '10vw';
    document.body.append(node);
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const styleProto = CSSStyleDeclaration.prototype;
    const nativeRead = styleProto.getPropertyValue;
    let reads = 0;
    styleProto.getPropertyValue = function (property: string) {
      if (this === node.style) reads += 1;
      return nativeRead.call(this, property);
    };
    for (let index = 0; index < 1000; index += 1) node.style.width = `${10 + (index % 5)}vw`;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    styleProto.getPropertyValue = nativeRead;
    Object.assign(window, { auditState: { controller, writes: () => writes, reads: () => reads, descriptor } });
    return { final: node.style.width };
  });
  expect(setup.final).toContain('var(--sv-vw)');

  await page.setViewportSize({ width: 1600, height: 1080 });
  await settle(page);
  const counts = await page.evaluate(() => {
    const state = (window as any).auditState;
    Object.defineProperty(MediaList.prototype, 'mediaText', state.descriptor);
    state.controller.destroy();
    return { writes: state.writes(), reads: state.reads() };
  });
  expect(counts.writes).toBe(0);
  expect(counts.reads).toBeLessThanOrEqual(30);
});

test('same-config update keeps the session; an invalid document never drops it', async ({ page }) => {
  await clean(page);
  const result = await page.evaluate(async () => {
    const controller = (window as any).audit.mountViewport({ designWidth: 1920 });
    const styleProto = CSSStyleDeclaration.prototype;
    const nativeSet = styleProto.setProperty;
    let writes = 0;
    styleProto.setProperty = function (...args: [string, string, string?]) { writes += 1; return nativeSet.apply(this, args); };
    controller.update({});
    controller.update({ onDiagnostic: () => {} });
    const sameConfigWrites = writes;
    let error = '';
    try { controller.update({ document: {} as Document }); } catch (caught) { error = String(caught); }
    const state = controller.getState();
    const zoom = document.documentElement.style.zoom;
    styleProto.setProperty = nativeSet;
    controller.destroy();
    return { sameConfigWrites, error, state, zoom };
  });
  expect(result.sameConfigWrites).toBe(0);
  expect(result.error).toContain('document must be a Document');
  expect(result.state.status).toBe('active');
  expect(result.zoom).not.toBe('');
});

test('a throwing diagnostic rolls the mount back and a later adopted setter survives destroy', async ({ page }) => {
  await clean(page);
  const result = await page.evaluate(async () => {
    const NativeObserver = window.MutationObserver;
    let observing = 0;
    window.MutationObserver = class Counted extends NativeObserver {
      private live = false;
      observe(target: Node, options?: MutationObserverInit) { if (!this.live) { this.live = true; observing += 1; } return super.observe(target, options); }
      disconnect() { if (this.live) { this.live = false; observing -= 1; } super.disconnect(); }
    };
    const nativeInsert = CSSStyleSheet.prototype.insertRule;
    const nativeShadow = Element.prototype.attachShadow;
    const frame = document.createElement('iframe');
    document.body.append(frame);
    let error = '';
    try {
      (window as any).audit.mountViewport({ designWidth: 1920, onDiagnostic: () => { throw new Error('audit diagnostic callback'); } });
    } catch (caught) { error = String(caught); }
    window.MutationObserver = NativeObserver;
    return {
      error,
      observing,
      hooksRestored: CSSStyleSheet.prototype.insertRule === nativeInsert && Element.prototype.attachShadow === nativeShadow,
    };
  });
  expect(result.error).toContain('audit diagnostic callback');
  expect(result.observing).toBe(0);
  expect(result.hooksRestored).toBe(true);

  const wrapper = await page.evaluate(async () => {
    const controller = (window as any).audit.mountViewport({ designWidth: 1920 });
    const prototype = Document.prototype;
    const original = Object.getOwnPropertyDescriptor(prototype, 'adoptedStyleSheets')!;
    let calls = 0;
    Object.defineProperty(prototype, 'adoptedStyleSheets', {
      ...original,
      set(value: CSSStyleSheet[]) { calls += 1; return original.set!.call(this, value); },
    });
    controller.destroy();
    document.adoptedStyleSheets = [];
    const survived = calls > 0;
    Object.defineProperty(prototype, 'adoptedStyleSheets', original);
    return survived;
  });
  expect(wrapper).toBe(true);
});

test('sessions survive destroy-time reentrancy, nested mount conflicts and cross-realm owners', async ({ page }) => {
  await clean(page);
  const reload = await page.evaluate(async () => {
    let replacement: any;
    const first = (window as any).audit.mountViewport({ designWidth: 1920 });
    const query = matchMedia('(min-width:1600px)');
    query.addEventListener('change', () => { replacement = (window as any).audit.mountViewport({ designWidth: 1920 }); }, { once: true });
    first.destroy();
    const state = replacement?.getState();
    const zoom = document.documentElement.style.zoom;
    replacement?.destroy();
    return { state, zoom };
  });
  expect(reload.state?.status).toBe('active');
  expect(reload.zoom).not.toBe('');

  const nested = await page.evaluate(async () => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    let nestedError = '';
    let outer: any;
    outer = (window as any).audit.mountViewport({
      designWidth: 1920,
      onDiagnostic: () => {
        try { (window as any).audit.mountViewport({ designWidth: 1600 }); } catch (caught) { nestedError = String(caught); }
      },
    });
    const state = outer.getState();
    outer.destroy();
    return { nestedError, status: state.status };
  });
  expect(nested.nestedError).toContain('initializing');
  expect(nested.status).toBe('active');

  const realms = await page.evaluate(async () => {
    const frame = document.createElement('iframe');
    frame.id = 'audit-child';
    frame.src = '/examples/clean/';
    await new Promise<void>((resolve) => { frame.onload = () => resolve(); document.body.append(frame); });
    const childDocument = frame.contentDocument!;
    const first = (window as any).audit.mountViewport({ document: childDocument, designWidth: 1920 });
    const child = frame.contentWindow as any;
    const script = child.document.createElement('script');
    script.type = 'module';
    script.textContent = "import('/src/index.ts').then((module) => { window.__childController = module.mountViewport({ designWidth: 1920 }); });";
    child.document.head.append(script);
    await new Promise((resolve) => setTimeout(resolve, 300));
    first.destroy();
    const zoom = childDocument.documentElement.style.zoom;
    const status = child.__childController?.getState().status;
    child.__childController?.destroy();
    return { zoom, status };
  });
  expect(realms.zoom).not.toBe('');
  expect(realms.status).toBe('active');
});

test('media wrappers keep native ordering, coerce objects and emit no transient width flips', async ({ page }) => {
  await clean(page);
  await page.evaluate(async () => {
    (window as any).auditController = (window as any).audit.mountViewport({ designWidth: 1920 });
    const widthQuery = matchMedia('(min-width:1600px)');
    const heightQuery = matchMedia('(min-height:900px)');
    const order: string[] = [];
    heightQuery.onchange = () => order.push('first');
    heightQuery.addEventListener('change', () => order.push('listener'));
    heightQuery.onchange = () => order.push('replacement');
    Object.assign(window, { widthEvents: [] as boolean[], widthQuery, heightQuery, order });
    widthQuery.addEventListener('change', (event) => (window as any).widthEvents.push((event as MediaQueryListEvent).matches));
  });
  await page.setViewportSize({ width: 900, height: 1080 });
  await settle(page, 4);
  expect(await page.evaluate(() => (window as any).widthEvents)).toEqual([]);
  expect(await page.evaluate(() => (window as any).widthQuery.matches)).toBe(true);

  await page.setViewportSize({ width: 1280, height: 500 });
  await expect.poll(() => page.evaluate(() => (window as any).order.length)).toBeGreaterThan(0);
  const result = await page.evaluate(() => {
    const { order, heightQuery, widthQuery } = window as any;
    const coercion = matchMedia({ toString: () => '(min-width:1600px)' } as any).matches;
    const controller = (window as any).auditController;
    const state = { order, heightMatches: heightQuery.matches, widthMatches: widthQuery.matches, coercion, distinct: matchMedia('(min-width:1600px)') !== widthQuery };
    controller.destroy();
    return state;
  });
  expect(result.order[0]).toBe('replacement');
  expect(result.order[1]).toBe('listener');
  expect(result.heightMatches).toBe(false);
  expect(result.widthMatches).toBe(true);
  expect(result.coercion).toBe(true);
  expect(result.distinct).toBe(true);
});

test('root attributes, helper ownership, display priority and shadow preflight are honest', async ({ page }) => {
  await clean(page);
  const result = await page.evaluate(async () => {
    const controller = (window as any).audit.mountViewport({ designWidth: 1920 });
    controller.destroy();
    const styleAttribute = document.documentElement.getAttribute('style');

    const preflight = await import('/src/preflight-browser.ts');
    const host = document.createElement('div');
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<style>@media (min-width:60ch){div{color:red}}</style><div></div>';
    const facts = preflight.collectBrowserFacts({ designWidth: 1920 });

    (window as any).stableViewportCheck = 'host value';
    const uninstall = preflight.installConsoleCheck();
    uninstall();
    const preservedBefore = (window as any).stableViewportCheck;
    const uninstallAgain = preflight.installConsoleCheck();
    (window as any).stableViewportCheck = 'later host value';
    uninstallAgain();
    const preservedLater = (window as any).stableViewportCheck;
    delete (window as any).stableViewportCheck;

    return { styleAttribute, shadowUnits: facts.unsupportedMediaUnits, preservedBefore, preservedLater };
  });
  expect(result.styleAttribute).toBe(null);
  expect(result.shadowUnits).toContain('ch');
  expect(result.preservedBefore).toBe('host value');
  expect(result.preservedLater).toBe('later host value');

  const display = await page.evaluate(async () => {
    const { defineStableViewport } = await import('/src/web-component.ts');
    defineStableViewport('audit-viewport');
    const important = document.createElement('audit-viewport');
    important.style.setProperty('display', 'block', 'important');
    document.body.append(important);
    await new Promise((resolve) => setTimeout(resolve, 50));
    important.remove();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const importantResult = { value: important.style.getPropertyValue('display'), priority: important.style.getPropertyPriority('display') };

    const contents = document.createElement('audit-viewport');
    contents.style.display = 'contents';
    document.body.append(contents);
    await new Promise((resolve) => setTimeout(resolve, 50));
    contents.remove();
    await new Promise((resolve) => setTimeout(resolve, 50));
    return { important: importantResult, contents: contents.style.getPropertyValue('display') };
  });
  expect(display.important).toEqual({ value: 'block', priority: 'important' });
  expect(display.contents).toBe('contents');
});

test('additional owners reuse the per-document zoom layout probe', async ({ page }) => {
  await clean(page);
  const result = await page.evaluate(async () => {
    const prototype = Element.prototype;
    const native = prototype.getBoundingClientRect;
    let reads = 0;
    prototype.getBoundingClientRect = function (this: Element) {
      reads += 1;
      return native.call(this);
    };
    const controllers = Array.from({ length: 20 }, () => (window as any).audit.mountViewport({ designWidth: 1920 }));
    prototype.getBoundingClientRect = native;
    const status = controllers[0].getState().status;
    for (const controller of controllers) controller.destroy();
    return { reads, status };
  });
  expect(result.status).toBe('active');
  // One layout probe is two rectangles; every later owner reuses its answer.
  expect(result.reads).toBeLessThanOrEqual(4);
});
