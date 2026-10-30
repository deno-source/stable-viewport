import { isMobile, type Diagnostic, type NormalizedOptions, type ViewportStatus } from './model';

type BrowserWindow = Window & typeof globalThis;

export function browserWindow(document: Document | undefined): BrowserWindow | undefined {
  return document?.defaultView ?? (typeof window === 'undefined' ? undefined : window);
}

/**
 * `CSS.supports('zoom', '1')` is not enough: some engines parse the property and
 * ignore it, and older Safari/Firefox report nothing at all. The only honest
 * check is layout: a box with `zoom: 0.5` must measure narrower than the same
 * box with `zoom: 1`, in the *same* document so a host zoom cancels out.
 */
export function zoomAffectsLayout(measure: (zoom: string) => number): boolean {
  const single = measure('1');
  const half = measure('0.5');
  if (!Number.isFinite(single) || single <= 0 || !Number.isFinite(half)) return false;
  return half > 0 && half < single * 0.75;
}

/**
 * The layout probe is the expensive part (two rectangles and a forced layout),
 * and its answer is a property of the engine/document, not of the owner count.
 * The cheap `CSS.supports` gate is still re-checked on every call.
 */
const ZOOM_LAYOUT = new WeakMap<Document, boolean>();

function probeZoomLayout(document: Document, window: BrowserWindow): boolean {
  const cached = ZOOM_LAYOUT.get(document);
  if (cached !== undefined) return cached;
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:absolute;left:-10000px;top:0;width:100px;height:10px;visibility:hidden;pointer-events:none';
  document.documentElement.append(host);
  const measure = (zoom: string) => {
    host.style.zoom = zoom;
    return host.getBoundingClientRect().width;
  };
  try {
    const result = zoomAffectsLayout(measure);
    ZOOM_LAYOUT.set(document, result);
    return result;
  } finally {
    host.remove();
  }
}

export function supportsZoom(document: Document | undefined, window: BrowserWindow | undefined): boolean {
  if (!document || !window) return false;
  if (!window.CSS?.supports?.('zoom', '1')) return false;
  return probeZoomLayout(document, window);
}

/** Capability gate; runs before anything is written to the document. */
export function checkCapability(document: Document | undefined, options: NormalizedOptions): { status?: ViewportStatus; diagnostics: Diagnostic[] } {
  if (!options.enabled) return { status: 'disabled', diagnostics: [] };
  const window = browserWindow(document);
  if (!document || !window) {
    return { status: 'unsupported', diagnostics: [{ code: 'no-document', message: 'No browser document is available; render this on the client' }] };
  }
  if (typeof window.MutationObserver !== 'function' || typeof window.requestAnimationFrame !== 'function') {
    return { status: 'unsupported', diagnostics: [{ code: 'missing-browser-api', message: 'MutationObserver and requestAnimationFrame are required; this engine is too old' }] };
  }
  if (!supportsZoom(document, window)) {
    return { status: 'unsupported', diagnostics: [{ code: 'no-css-zoom', message: 'This engine does not apply CSS zoom to layout; upgrade the browser or keep native zoom' }] };
  }
  if (!options.mobile && isMobile(window)) {
    return { status: 'disabled', diagnostics: [{ code: 'mobile-disabled', message: 'Mobile devices keep native behaviour unless options.mobile is true' }] };
  }
  return { status: undefined, diagnostics: [] };
}

function rootHasForeignZoom(document: Document, expected: number): boolean {
  const zoom = document.defaultView!.getComputedStyle(document.documentElement).zoom;
  if (!zoom || zoom === 'normal' || zoom === '1') return false;
  return Math.abs(Number(zoom) - expected) > 0.001;
}

/** Conditions that would make adaptation destructive rather than additive. */
export function findHostConflicts(document: Document, options: NormalizedOptions): Diagnostic[] {
  const window = document.defaultView!;
  const diagnostics: Diagnostic[] = [];
  const expected = document.documentElement.clientWidth / options.designWidth;
  if (rootHasForeignZoom(document, expected)) {
    diagnostics.push({
      code: 'host-root-zoom',
      message: 'The document root already has a zoom value; remove it before enabling stable-viewport',
      detail: { zoom: window.getComputedStyle(document.documentElement).zoom },
    });
  }
  for (const [name, element] of [['html', document.documentElement], ['body', document.body]] as const) {
    if (!element) continue;
    const style = window.getComputedStyle(element);
    const translated = !!style.translate && style.translate !== 'none';
    if (style.transform === 'none' && !translated) continue;
    diagnostics.push({
      code: 'host-root-transform',
      message: `${name} has a transform; it changes the containing block for fixed elements and breaks full-page adaptation`,
      detail: { transform: style.transform, translate: style.translate },
    });
  }
  return diagnostics;
}
