import { viewportMetrics, type Diagnostic, type NormalizedOptions, type ViewportState, type ViewportMetrics } from './model';
import { StyleChanges } from './changes';

interface StyleHolder {
  refresh(): void;
  /** Scale-only update; absent for holders that never need it. */
  reflow?(): void;
  destroy(): void;
}

export interface RuntimeDeps {
  styles: StyleHolder;
  media: StyleHolder;
}

export type RuntimeHooks = (getScale: () => number) => RuntimeDeps;

export interface Runtime {
  refresh(): void;
  state(): ViewportState;
  destroy(): void;
}

const UNITS = ['vw', 'vh', 'vmin', 'vmax'] as const;

interface RuntimeState {
  document: Document;
  window: Window & typeof globalThis;
  options: NormalizedOptions;
  writes: StyleChanges;
  deps: RuntimeDeps;
  onChange?: (diagnostic: Diagnostic) => void;
  scale: number;
  /** Whether the root already carried a `style` attribute before our first write. */
  rootHadStyleAttribute?: boolean;
  stopped: boolean;
  printing: boolean;
  frame: number;
  listeners: {
    resize: () => void;
    ready: () => void;
    beforePrint: () => void;
    afterPrint: () => void;
  };
}

function measures(state: RuntimeState) {
  const root = state.document.documentElement;
  return {
    innerWidth: state.window.innerWidth,
    clientWidth: root.clientWidth || state.window.innerWidth,
    clientHeight: root.clientHeight || state.window.innerHeight,
  };
}

/** The design canvas is the root's content box, so a scrollbar never widens it. */
function publish(state: RuntimeState, metrics: ViewportMetrics) {
  if (state.rootHadStyleAttribute === undefined) {
    state.rootHadStyleAttribute = state.document.documentElement.hasAttribute('style');
  }
  const style = state.document.documentElement.style;
  state.writes.set(style, 'zoom', String(state.scale));
  for (const unit of UNITS) {
    state.writes.set(style, `--sv-${unit}`, state.printing ? `1${unit}` : `${metrics[unit]}px`);
  }
}

function update(state: RuntimeState) {
  state.frame = 0;
  if (state.stopped) return;
  const metrics = viewportMetrics(measures(state), state.options.designWidth);
  state.scale = state.printing ? 1 : metrics.layoutScale;
  if (!Number.isFinite(state.scale) || state.scale <= 0) {
    state.onChange?.({ code: 'zero-width', message: 'The document has no measurable width; the viewport stays native' });
    return;
  }
  publish(state, metrics);
  // Declarations reference var(--sv-*), so only media conditions need redoing.
  (state.deps.styles.reflow ?? state.deps.styles.refresh).call(state.deps.styles);
  state.deps.media.refresh();
}

function schedule(state: RuntimeState) {
  if (state.frame || state.stopped) return;
  const frame = state.window.requestAnimationFrame(() => update(state));
  state.frame = typeof frame === 'number' ? frame : 1;
}

function setPrinting(state: RuntimeState, value: boolean) {
  state.printing = value;
  update(state);
}

function attach(state: RuntimeState) {
  state.window.addEventListener('resize', state.listeners.resize);
  state.window.addEventListener('pageshow', state.listeners.ready);
  state.window.addEventListener('beforeprint', state.listeners.beforePrint);
  state.window.addEventListener('afterprint', state.listeners.afterPrint);
  state.document.addEventListener('DOMContentLoaded', state.listeners.ready, { once: true });
}

function detach(state: RuntimeState) {
  state.window.cancelAnimationFrame(state.frame);
  state.frame = 0;
  state.window.removeEventListener('resize', state.listeners.resize);
  state.window.removeEventListener('pageshow', state.listeners.ready);
  state.window.removeEventListener('beforeprint', state.listeners.beforePrint);
  state.window.removeEventListener('afterprint', state.listeners.afterPrint);
  state.document.removeEventListener('DOMContentLoaded', state.listeners.ready);
}

function destroy(state: RuntimeState) {
  if (state.stopped) return;
  state.stopped = true;
  detach(state);
  // Restore the root before any teardown event can reach user code: a callback
  // that mounts a new controller must not be overwritten by this restore.
  state.writes.restore();
  restoreRootAttribute(state);
  state.deps.styles.destroy();
  state.deps.media.destroy();
}

/** A root that had no `style` attribute must not keep an empty one. */
function restoreRootAttribute(state: RuntimeState) {
  if (state.rootHadStyleAttribute !== false) return;
  const root = state.document.documentElement;
  if (root.getAttribute('style') === '') root.removeAttribute('style');
}

/**
 * Owns the root zoom, the design-canvas variables and the browser hooks.
 * Everything it writes is tracked so `destroy` restores the document exactly,
 * and it stays idempotent: a second destroy changes nothing.
 */
export function createRuntime(document: Document, options: NormalizedOptions, hooks: RuntimeHooks, onChange?: (diagnostic: Diagnostic) => void): Runtime {
  const window = document.defaultView as Window & typeof globalThis;
  const state: RuntimeState = {
    document,
    window,
    options,
    writes: new StyleChanges(),
    deps: { styles: { refresh: () => {}, destroy: () => {} }, media: { refresh: () => {}, destroy: () => {} } },
    onChange,
    scale: 1,
    stopped: false,
    printing: false,
    frame: 0,
    listeners: {
      resize: () => schedule(state),
      ready: () => update(state),
      beforePrint: () => setPrinting(state, true),
      afterPrint: () => setPrinting(state, false),
    },
  };
  const getScale = () => (state.printing ? 1 : state.window.innerWidth / state.options.designWidth);
  // A throwing hook must not leave the earlier half installed; the factory owns
  // its own rollback and the caller sees the original error.
  state.deps = hooks(getScale);
  attach(state);
  try {
    update(state);
  } catch (error) {
    destroy(state);
    throw error;
  }
  return {
    // Public refresh is the documented "re-scan stylesheets" escape hatch.
    refresh: () => {
      state.deps.styles.refresh();
      update(state);
    },
    state: () => ({
      status: state.stopped ? 'destroyed' : 'active',
      scale: state.scale,
      designWidth: state.options.designWidth,
      diagnostics: [],
    }),
    destroy: () => destroy(state),
  };
}
