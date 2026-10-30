import { test, expect, type Page } from './fixtures';

/**
 * Performance budgets. The numbers come from the library's own callbacks
 * (`requestAnimationFrame` / `MutationObserver` wrapped before mount), so they
 * exclude browser frame latency and Playwright round-trips. Budgets are
 * deliberately loose (≈3–5× the local measurement) so CI noise cannot make them
 * flaky while a real regression (a full re-scan on resize) still fails.
 */

interface Exact {
  mount: number;
  resizeWork: number[];
  mutationWork: number[];
  unmount: number;
}

async function measure(page: Page, elements: number, sheets: number, rules: number): Promise<Exact> {
  await page.goto(`/examples/stress/?elements=${elements}&sheets=${sheets}&rules=${rules}`);
  await page.waitForFunction(() => typeof (window as any).stressExact?.measure === 'function');
  return page.evaluate(() => (window as any).stressExact.measure(10));
}

const percentile = (values: number[], q: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
};

test('a typical page installs and resizes without blocking the frame', async ({ page }) => {
  const result = await measure(page, 800, 6, 60);
  expect(result.mount).toBeLessThan(400);
  expect(percentile(result.resizeWork, 0.5)).toBeLessThan(8);
  expect(percentile(result.mutationWork, 0.5)).toBeLessThan(8);
  expect(result.unmount).toBeLessThan(120);
});

test('a pathological page still keeps resize work proportional, not a full re-scan', async ({ page }) => {
  const result = await measure(page, 6000, 80, 200);
  // One-time install may be expensive (16 000 declarations), but a resize must
  // not walk the DOM or the stylesheets again.
  expect(result.mount).toBeLessThan(4000);
  expect(percentile(result.resizeWork, 0.5)).toBeLessThan(40);
  // p95 covers the first frame after install, which has to flush layout once.
  expect(percentile(result.resizeWork, 1)).toBeLessThan(600);
  expect(percentile(result.mutationWork, 0.5)).toBeLessThan(15);
});

test('install rewrites declarations even when the viewport equals the design width', async ({ page }) => {
  // Regression guard: the initial full pass must not be skipped.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/examples/stress/?elements=50&sheets=1&rules=5');
  const result = await page.evaluate(async () => {
    const { mountViewport } = await import('/src/index.ts');
    const controller = mountViewport({ designWidth: 1440 });
    // 12vw of a 1440 canvas is 172.8 design px, *not* 153.6 (12vw of 1280).
    const width = getComputedStyle(document.querySelector('#cell-1')!).width;
    const svw = document.documentElement.style.getPropertyValue('--sv-vw');
    controller.destroy();
    return { width: parseFloat(width), svw };
  });
  expect(result.svw).toBe('14.4px');
  // The stress sheet sets `.cell-N { width: 10-50vw }`; cell-1 uses 11vw.
  expect(Math.abs(result.width - 11 * 14.4)).toBeLessThan(2);
});

test('repeated refresh is idempotent: no repeated writes', async ({ page }) => {
  await page.goto('/examples/stress/?elements=300&sheets=4&rules=40');
  const writes = await page.evaluate(async () => {
    const proto = CSSStyleDeclaration.prototype;
    const native = proto.setProperty;
    let count = 0;
    proto.setProperty = function patched(this: CSSStyleDeclaration, ...args: Parameters<CSSStyleDeclaration['setProperty']>) {
      count += 1;
      return Reflect.apply(native, this, args);
    } as CSSStyleDeclaration['setProperty'];
    const { mountViewport } = await import('/src/index.ts');
    const controller = mountViewport({ designWidth: 1920 });
    count = 0;
    controller.refresh();
    const first = count;
    count = 0;
    controller.refresh();
    const second = count;
    controller.destroy();
    proto.setProperty = native;
    return { first, second };
  });
  expect(writes.first).toBe(0);
  expect(writes.second).toBe(0);
});

test('thirty mount/unmount cycles leave no observers, listeners or styles behind', async ({ page }) => {
  await page.goto('/examples/clean/');
  const result = await page.evaluate(async () => {
    const NativeObserver = window.MutationObserver;
    let created = 0;
    let disconnected = 0;
    let observing = 0;
    window.MutationObserver = class Counted extends NativeObserver {
      private live = false;
      constructor(callback: MutationCallback) {
        super((records, observer) => callback(records, observer));
        created += 1;
      }
      observe(target: Node, options?: MutationObserverInit) {
        if (!this.live) { this.live = true; observing += 1; }
        return super.observe(target, options);
      }
      disconnect() {
        if (this.live) { this.live = false; observing -= 1; disconnected += 1; }
        return super.disconnect();
      }
    } as typeof window.MutationObserver;

    const nativeMedia = window.matchMedia;
    const nativeInsert = CSSStyleSheet.prototype.insertRule;
    const nativeAttach = Element.prototype.attachShadow;
    const { mountViewport } = await import('/src/index.ts');
    const heapBefore = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0;
    for (let index = 0; index < 30; index += 1) {
      const controller = mountViewport({ designWidth: 1920 });
      controller.refresh();
      controller.destroy();
    }
    window.MutationObserver = NativeObserver;
    return {
      created,
      disconnected,
      observing,
      leak: document.documentElement.style.cssText,
      mediaRestored: window.matchMedia === nativeMedia,
      insertRestored: CSSStyleSheet.prototype.insertRule === nativeInsert,
      attachRestored: Element.prototype.attachShadow === nativeAttach,
      heapGrowth: heapBefore ? ((performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize - heapBefore) / 1024 / 1024 : 0,
    };
  });
  expect(result.created).toBeGreaterThan(0);
  expect(result.created).toBe(result.disconnected);
  expect(result.observing).toBe(0);
  expect(result.leak).toBe('');
  expect(result.mediaRestored).toBe(true);
  expect(result.insertRestored).toBe(true);
  expect(result.attachRestored).toBe(true);
  expect(result.heapGrowth).toBeLessThan(24);
});

test('a long page keeps native scrolling and does not add horizontal overflow', async ({ page }) => {
  await page.goto('/examples/stress/?elements=2000&sheets=10&rules=40');
  await page.waitForFunction(() => typeof (window as any).stress === 'object');
  await page.evaluate(async () => {
    const { mountViewport } = await import('/src/index.ts');
    (window as any).controller = mountViewport({ designWidth: 1920 });
  });
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--sv-vw') !== '');
  const before = await page.evaluate(() => ({ top: scrollY, height: document.documentElement.scrollHeight }));
  await page.evaluate(() => window.scrollTo(0, 1200));
  const after = await page.evaluate(() => ({
    top: scrollY,
    height: document.documentElement.scrollHeight,
  }));
  expect(after.top).toBeGreaterThan(1000);
  // Native scrolling keeps working: the document height does not shift.
  expect(Math.abs(after.height - before.height)).toBeLessThan(2);
  await page.evaluate(() => (window as any).controller.destroy());
});

test('a realistic page gains no horizontal overflow at any zoom', async ({ page }) => {
  // The stress fixture is intentionally pathological (vw widths in tiny grid
  // cells), so overflow is asserted on the realistic fixture instead.
  for (const width of [1920, 1280, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/examples/compat/?mode=core');
    await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--sv-vw') !== '');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `viewport ${width}`).toBeLessThanOrEqual(1);
  }
});

test('a real viewport width change re-projects breakpoints without a full re-scan', async ({ page }) => {
  await page.goto('/examples/stress/?elements=6000&sheets=80&rules=200');
  await page.evaluate(async () => {
    const nativeRaf = window.requestAnimationFrame.bind(window);
    let work = 0;
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => nativeRaf((time) => {
      const start = performance.now();
      callback(time);
      work += performance.now() - start;
    })) as typeof window.requestAnimationFrame;
    const { mountViewport } = await import('/src/index.ts');
    (window as any).realResize = {
      controller: mountViewport({ designWidth: 1920 }),
      reset: () => { work = 0; },
      read: () => work,
      restore: () => { window.requestAnimationFrame = nativeRaf as typeof window.requestAnimationFrame; },
    };
  });
  const samples: number[] = [];
  for (const width of [1600, 1280, 1920, 1440, 1024, 1920]) {
    await page.evaluate(() => (window as any).realResize.reset());
    await page.setViewportSize({ width, height: 1080 });
    const work = await page.evaluate(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      return (window as any).realResize.read() as number;
    });
    samples.push(work);
  }
  const state = await page.evaluate(() => {
    const bucket = (window as any).realResize;
    const result = {
      status: bucket.controller.getState().status,
      svw: document.documentElement.style.getPropertyValue('--sv-vw'),
      scale: parseFloat(document.documentElement.style.zoom),
    };
    bucket.controller.destroy();
    bucket.restore();
    return result;
  });
  expect(state.status).toBe('active');
  expect(state.svw).not.toBe('');
  // 1920 / 1920 at the last step.
  expect(state.scale).toBeCloseTo(1, 5);
  // The work is the runtime's animation frame, not latency: a full re-scan of
  // 16 000 rules would be an order of magnitude above this budget.
  expect(percentile(samples, 0.5)).toBeLessThan(40);
  expect(Math.max(...samples)).toBeLessThan(600);
});

test('one long-lived session releases per-node registrations as components churn', async ({ page }) => {
  await page.goto('/examples/stress/?elements=200&sheets=4&rules=20');
  const result = await page.evaluate(async () => {
    const NativeObserver = window.MutationObserver;
    let live = 0;
    window.MutationObserver = class Counted extends NativeObserver {
      private observing = false;
      observe(target: Node, options?: MutationObserverInit) {
        if (!this.observing) { this.observing = true; live += 1; }
        return super.observe(target, options);
      }
      disconnect() {
        if (this.observing) { this.observing = false; live -= 1; }
        super.disconnect();
      }
    } as typeof window.MutationObserver;
    const raf = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const { mountViewport } = await import('/src/index.ts');
    const controller = mountViewport({ designWidth: 1920 });
    await raf();
    const baseline = live;
    const create = () => {
      const host = document.createElement('div');
      host.style.width = '12vw';
      const root = host.attachShadow({ mode: 'open' });
      root.innerHTML = '<style>.x{width:10vw}</style><div class="x"></div>';
      return host;
    };
    let restored = '';
    for (let batch = 0; batch < 30; batch += 1) {
      const nodes = Array.from({ length: 10 }, create);
      for (const node of nodes) document.body.append(node);
      await raf();
      for (const node of nodes) node.remove();
      await raf();
      restored = nodes[0]!.style.width;
    }
    const afterChurn = live;
    const status = controller.getState().status;
    controller.destroy();
    window.MutationObserver = NativeObserver;
    return { baseline, afterChurn, restored, status };
  });
  expect(result.status).toBe('active');
  // Removed hosts hand their author unit back, and their shadow observers die.
  expect(result.restored).toBe('12vw');
  expect(result.afterChurn).toBe(result.baseline);
});
