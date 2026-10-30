/**
 * Generates a page large enough to expose O(n) work in the hot paths: many
 * elements, many stylesheets with many rules, and inline styles everywhere.
 * Controlled by ?elements=2000&sheets=40&rules=200.
 */
const params = new URLSearchParams(location.search);
const count = (name: string, fallback: number) => Number(params.get(name) ?? fallback);

const ELEMENTS = count('elements', 2000);
const SHEETS = count('sheets', 40);
const RULES = count('rules', 200);

function buildStylesheets() {
  for (let sheet = 0; sheet < SHEETS; sheet += 1) {
    const style = document.createElement('style');
    style.dataset.sheet = String(sheet);
    const rules: string[] = [];
    for (let rule = 0; rule < RULES; rule += 1) {
      const index = (sheet * RULES + rule) % ELEMENTS;
      rules.push(`.cell-${index}{width:${10 + (rule % 40)}vw;height:${1 + (rule % 5)}rem}`);
      if (rule % 7 === 0) rules.push(`@media (min-width:${1000 + rule}px){.cell-${index}{outline:1px solid #93c5fd}}`);
    }
    style.textContent = rules.join('\n');
    document.head.append(style);
  }
}

function buildElements() {
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < ELEMENTS; index += 1) {
    const cell = document.createElement('div');
    cell.className = `cell cell-${index}`;
    cell.id = `cell-${index}`;
    if (index % 3 === 0) cell.style.height = '2rem';
    if (index % 5 === 0) cell.style.width = '12vw';
    if (index % 11 === 0) cell.setAttribute('style', `height:${1 + (index % 4)}rem`);
    fragment.append(cell);
  }
  document.querySelector('#app')!.append(fragment);
}

buildStylesheets();
buildElements();

interface Timings {
  mount: number;
  resize: number[];
  mutations: number[];
  unmount: number;
  counters: Record<string, number>;
}

const app = document.querySelector<HTMLElement>('#app')!;

const api = {
  async measure(repeat = 10): Promise<Timings> {
    const { mountViewport } = await import('/src/index.ts');
    const counters: Record<string, number> = {};
    const counter = (name: string, delta = 1) => { counters[name] = (counters[name] ?? 0) + delta; };

    // Count the work the library does, independent of wall-clock noise.
    const styleProto = CSSStyleDeclaration.prototype;
    const nativeSet = styleProto.setProperty;
    styleProto.setProperty = function patched(this: CSSStyleDeclaration, ...args: Parameters<CSSStyleDeclaration['setProperty']>) {
      counter('setProperty');
      return Reflect.apply(nativeSet, this, args);
    } as CSSStyleDeclaration['setProperty'];
    const mediaProto = MediaList.prototype;
    const nativeText = Object.getOwnPropertyDescriptor(mediaProto, 'mediaText')!;
    Object.defineProperty(mediaProto, 'mediaText', {
      configurable: true,
      get() { return nativeText.get!.call(this); },
      set(value: string) { counter('mediaText'); nativeText.set!.call(this, value); },
    });

    const start = performance.now();
    const controller = mountViewport({ designWidth: 1920 });
    const mount = performance.now() - start;

    const resize: number[] = [];
    for (let index = 0; index < repeat; index += 1) {
      const tick = performance.now();
      await new Promise<void>((resolve) => {
        // The real resize path: the runtime re-projects media conditions on its
        // animation frame instead of a public full refresh.
        window.dispatchEvent(new Event('resize'));
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
      resize.push(performance.now() - tick);
    }

    const mutations: number[] = [];
    for (let index = 0; index < repeat; index += 1) {
      const tick = performance.now();
      const node = document.createElement('div');
      node.className = `cell cell-${index}`;
      node.style.width = '11vw';
      node.innerHTML = '<span style="height:3vh">x</span>'.repeat(4);
      app.append(node);
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      mutations.push(performance.now() - tick);
      node.remove();
    }

    const stop = performance.now();
    controller.destroy();
    const unmount = performance.now() - stop;

    styleProto.setProperty = nativeSet;
    Object.defineProperty(mediaProto, 'mediaText', nativeText);

    return { mount, resize, mutations, unmount, counters };
  },
  size: () => ({ elements: document.querySelectorAll('*').length, sheets: document.styleSheets.length }),
};

Object.assign(window, { stress: api });

/**
 * Exact instrumentation: wraps `requestAnimationFrame` and `MutationObserver`
 * *before* the library loads, so the numbers are the library's own callback
 * time rather than browser frame latency or Playwright round-trips.
 */
interface Exact {
  mount: number;
  resizeWork: number[];
  mutationWork: number[];
  unmount: number;
}

async function measureExact(repeat = 12): Promise<Exact> {
  const nativeRaf = window.requestAnimationFrame.bind(window);
  const NativeObserver = window.MutationObserver;
  let rafWork = 0;
  let observerWork = 0;
  window.requestAnimationFrame = ((callback: FrameRequestCallback) => nativeRaf((time) => {
    const start = performance.now();
    callback(time);
    rafWork += performance.now() - start;
  })) as typeof window.requestAnimationFrame;
  window.MutationObserver = class TimedObserver extends NativeObserver {
    constructor(callback: MutationCallback) {
      super((records, observer) => {
        const start = performance.now();
        callback(records, observer);
        observerWork += performance.now() - start;
      });
    }
  } as typeof window.MutationObserver;

  const { mountViewport } = await import('/src/index.ts');
  const start = performance.now();
  const controller = mountViewport({ designWidth: 1920 });
  const mount = performance.now() - start;

  const resizeWork: number[] = [];
  for (let index = 0; index < repeat; index += 1) {
    rafWork = 0;
    window.dispatchEvent(new Event('resize'));
    await new Promise<void>((resolve) => nativeRaf(() => nativeRaf(() => resolve())));
    resizeWork.push(rafWork);
  }

  const mutationWork: number[] = [];
  for (let index = 0; index < repeat; index += 1) {
    observerWork = 0;
    const node = document.createElement('div');
    node.className = `cell cell-${index}`;
    node.style.width = '11vw';
    node.innerHTML = '<span style="height:3vh">x</span>'.repeat(4);
    app.append(node);
    await new Promise<void>((resolve) => nativeRaf(() => nativeRaf(() => resolve())));
    mutationWork.push(observerWork);
    node.remove();
  }

  const stop = performance.now();
  controller.destroy();
  const unmount = performance.now() - stop;

  window.requestAnimationFrame = nativeRaf as typeof window.requestAnimationFrame;
  window.MutationObserver = NativeObserver;
  return { mount, resizeWork, mutationWork, unmount };
}

Object.assign(window, { stressExact: { measure: measureExact } });
