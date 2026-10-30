import { hasSizeFeatures, transformMedia } from './transforms';

type BrowserWindow = Window & typeof globalThis;

interface Refresher {
  /** Returns false once the public list is gone, so the registry can drop it. */
  refresh(): boolean;
  dispose(): void;
}

function createChangeEvent(window: BrowserWindow, matches: boolean, media: string): Event {
  if (typeof window.MediaQueryListEvent === 'function') {
    return new window.MediaQueryListEvent('change', { matches, media });
  }
  const event = new window.Event('change');
  Object.defineProperties(event, {
    matches: { value: matches, enumerable: true },
    media: { value: media, enumerable: true },
  });
  return event;
}

/**
 * Builds a MediaQueryList backed by the native list for the transformed query.
 * The object keeps the caller's original media text and remains a real
 * EventTarget, so `once`, `signal`, `addListener` and `onchange` behave as they
 * do natively. A native subscription is kept for the object's lifetime so
 * `matches` stays current even before anyone listens.
 */
interface MediaState {
  target: EventTarget;
  source: MediaQueryList;
  /** The resolved query the current `source` was created for. */
  resolved: string;
  /** The last design-space match value that was reported. */
  delivered: boolean;
  handler: ((event: Event) => void) | null;
  handlerAttached: boolean;
  /** Re-evaluates the design-space match after a native change. */
  notify: () => void;
}

/**
 * An `onchange` handler keeps its slot in the listener order while its target
 * function is replaced, exactly like the native event handler attribute.
 */
function defineOnChange(target: MediaQueryList, state: MediaState) {
  const invoke = (event: Event) => {
    if (state.handler) state.handler.call(target, event);
  };
  Object.defineProperty(target, 'onchange', {
    configurable: true,
    get: () => state.handler,
    set(value: unknown) {
      state.handler = typeof value === 'function' ? (value as (event: Event) => void) : null;
      if (state.handler && !state.handlerAttached) {
        target.addEventListener('change', invoke);
        state.handlerAttached = true;
      } else if (!state.handler && state.handlerAttached) {
        target.removeEventListener('change', invoke);
        state.handlerAttached = false;
      }
    },
  });
}

function defineLegacyListeners(target: MediaQueryList) {
  Object.assign(target, {
    addListener: (callback?: ((event: Event) => void) | null) => { if (callback) target.addEventListener('change', callback); },
    removeListener: (callback?: ((event: Event) => void) | null) => { if (callback) target.removeEventListener('change', callback); },
  });
}

function rebind(window: BrowserWindow, native: typeof window.matchMedia, state: MediaState, resolved: string) {
  state.source.removeEventListener('change', state.notify);
  state.source = native(resolved);
  state.resolved = resolved;
  state.source.addEventListener('change', state.notify);
}

function createList(window: BrowserWindow, native: typeof window.matchMedia, query: string, resolve: (query: string) => string) {
  const target = new window.EventTarget() as MediaQueryList;
  if (window.MediaQueryList) Object.setPrototypeOf(target, window.MediaQueryList.prototype);
  const initial = resolve(query);
  const state: MediaState = {
    target,
    source: native(initial),
    resolved: initial,
    delivered: false,
    handler: null,
    handlerAttached: false,
    notify: () => {},
  };
  state.delivered = state.source.matches;
  // A native change can fire before the runtime re-projects the query. Report
  // the design-space result of the fresh scale instead of the stale projection.
  state.notify = () => {
    const matches = native(resolve(query)).matches;
    if (matches === state.delivered) return;
    state.delivered = matches;
    target.dispatchEvent(createChangeEvent(window, matches, query));
  };
  state.source.addEventListener('change', state.notify);
  Object.defineProperties(target, {
    matches: { get: () => state.source.matches, configurable: true },
    media: { get: () => query, configurable: true },
  });
  defineOnChange(target, state);
  defineLegacyListeners(target);
  const stateRef = typeof WeakRef === 'function' ? new WeakRef(state) : { deref: () => state };
  const refresher: Refresher = {
    refresh() {
      const live = stateRef.deref();
      if (!live) return false;
      const resolved = resolve(query);
      if (resolved !== live.resolved) rebind(window, native, live, resolved);
      if (live.source.matches !== live.delivered) {
        live.delivered = live.source.matches;
        (live.target as MediaQueryList).dispatchEvent(createChangeEvent(window, live.delivered, query));
      }
      return true;
    },
    dispose() {
      stateRef.deref()?.source.removeEventListener('change', state.notify);
    },
  };
  return { list: target, refresher };
}

export function installMedia(window: BrowserWindow, getScale: () => number) {
  const original = window.matchMedia;
  const native = original.bind(window);
  const refreshers = new Set<Refresher>();
  let active = true;
  const resolve = (query: string) => (active ? transformMedia(query, getScale()) : query);
  const wrapped = function matchMedia(query: string): MediaQueryList {
    // Native accepts anything stringifiable; only Symbol keeps its native error.
    const text = typeof query === 'string' ? query : typeof query === 'symbol' ? query : String(query);
    if (typeof text === 'symbol') return original.call(window, text as never);
    const created = createList(window, native, text, resolve);
    // A query without a size feature never changes with the canvas scale, so it
    // costs no refresher and no native query is rebuilt on resize or teardown.
    if (hasSizeFeatures(text)) refreshers.add(created.refresher);
    return created.list;
  } as typeof window.matchMedia;
  window.matchMedia = wrapped;
  return {
    refresh() {
      for (const entry of refreshers) {
        if (!entry.refresh()) refreshers.delete(entry);
      }
    },
    destroy() {
      active = false;
      if (window.matchMedia === wrapped) window.matchMedia = original;
      // Surviving lists keep working with native semantics; the browser owns
      // their lifetime from here, exactly as it would for a native list.
      for (const entry of refreshers) entry.refresh();
      refreshers.clear();
    },
  };
}
