import { mountViewport, type ViewportController, type ViewportState } from './index';

const KEY = Symbol.for('stable-viewport.auto.v1');

interface AutoHost {
  [KEY]?: ViewportController;
}

interface AutoApi {
  getState(): ViewportState | undefined;
  refresh(): void;
  destroy(): void;
}

const script = document.currentScript as HTMLScriptElement | null;
const host = window as Window & AutoHost;
const declared = script?.getAttribute('data-design-width');
const width = declared === null || declared === undefined || declared.trim() === '' ? undefined : Number(declared);

// The first explicit framework controller adopts and releases this lease, so a
// pre-hydration paint never double-scales after hydration.
if (!host[KEY]) {
  host[KEY] = mountViewport({ designWidth: width });
}

const api: AutoApi = {
  getState: () => host[KEY]?.getState(),
  refresh: () => host[KEY]?.refresh(),
  destroy: () => {
    host[KEY]?.destroy();
    delete host[KEY];
  },
};

Object.defineProperty(window, 'StableViewportAuto', { value: api, configurable: true });
