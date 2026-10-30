import { evaluatePreflight, formatPreflight, type RuntimeFacts, type SourceFacts, type Verdict } from './preflight';
import { hasSizeFeatures, unsupportedMediaUnits } from './transforms';

type BrowserWindow = Window & typeof globalThis;

interface ProbeOptions {
  designWidth?: number;
  /** Treat the raw source facts as unknown; useful before adding the component. */
  source?: Partial<SourceFacts>;
}

function emptySource(): SourceFacts {
  return {
    viewportUnits: [],
    adaptableBreakpoints: 0,
    unsupportedBreakpoints: [],
    deviceBreakpoints: 0,
    containerQueries: 0,
    viewportReads: 0,
    closedShadowRoots: 0,
    rootZoomRules: 0,
    rootTransformRules: 0,
    fixedElements: 0,
    runtimeStyles: 0,
  };
}

/** A shadow root has no `styleSheets` list, so its `<style>`/`<link>` are read directly. */
function elementSheets(root: ParentNode): CSSStyleSheet[] {
  const sheets: CSSStyleSheet[] = [];
  for (const element of Array.from(root.querySelectorAll('style, link'))) {
    const sheet = (element as HTMLStyleElement | HTMLLinkElement).sheet;
    if (sheet) sheets.push(sheet);
  }
  return sheets;
}

/** Every stylesheet the page exposes, including open shadow roots at any depth. */
function allSheets(document: Document): CSSStyleSheet[] {
  const sheets = new Set<CSSStyleSheet>();
  const collect = (root: Document | ShadowRoot) => {
    const own = 'styleSheets' in root ? root.styleSheets : elementSheets(root);
    for (const sheet of Array.from(own)) sheets.add(sheet);
    for (const sheet of Array.from(root.adoptedStyleSheets ?? [])) sheets.add(sheet);
    for (const element of Array.from(root.querySelectorAll('*'))) {
      if (element.shadowRoot) collect(element.shadowRoot);
    }
  };
  collect(document);
  return [...sheets];
}

function eachReadableSheet(document: Document, visit: (sheet: CSSStyleSheet) => void) {
  for (const sheet of allSheets(document)) {
    try {
      void sheet.cssRules;
      visit(sheet);
    } catch {
      // Opaque sheets are counted separately.
    }
  }
}

function walkRules(window: BrowserWindow, document: Document, onMedia: (text: string) => void, onContainer: () => void) {
  const pending: CSSRuleList[] = [];
  eachReadableSheet(document, (sheet) => pending.push(sheet.cssRules));
  while (pending.length) {
    const list = pending.pop()!;
    for (const rule of Array.from(list)) {
      const media = (rule as CSSMediaRule).media;
      if (media && typeof media.mediaText === 'string') onMedia(media.mediaText);
      const children = (rule as CSSGroupingRule).cssRules;
      if (children) pending.push(children);
      if ((rule as { containerQuery?: string }).containerQuery) onContainer();
    }
  }
}

function isOpaque(sheet: CSSStyleSheet): boolean {
  try {
    void sheet.cssRules;
    return false;
  } catch {
    return true;
  }
}

function countOpaqueStylesheets(document: Document): number {
  return allSheets(document).filter(isOpaque).length;
}

function collectMediaFeatures(window: BrowserWindow, document: Document) {
  const units = new Set<string>();
  let containerQueries = 0;
  walkRules(
    window,
    document,
    (text) => {
      if (!hasSizeFeatures(text)) return;
      for (const unit of unsupportedMediaUnits(text)) units.add(unit);
    },
    () => { containerQueries += 1; },
  );
  return { unsupportedMediaUnits: [...units], containerQueries };
}

function rootTransform(window: BrowserWindow, document: Document): string {
  const root = window.getComputedStyle(document.documentElement);
  const body = document.body ? window.getComputedStyle(document.body) : undefined;
  const values = [root.transform, body?.transform, root.translate, body?.translate].filter((value) => value && value !== 'none');
  return values.length ? values.join(' ') : 'none';
}

/** Reads the live document. Never writes to it, never touches application state. */
export function collectBrowserFacts(options: ProbeOptions = {}): RuntimeFacts {
  const window = globalThis as unknown as BrowserWindow;
  const document = window.document;
  const root = document.documentElement;
  const computed = window.getComputedStyle(root);
  const media = collectMediaFeatures(window, document);

  return {
    cssZoom: typeof window.CSS?.supports === 'function' && window.CSS.supports('zoom', '1'),
    designWidth: options.designWidth ?? 1920,
    rootZoom: computed.zoom ?? '1',
    rootTransform: rootTransform(window, document),
    clientWidth: root.clientWidth,
    innerWidth: window.innerWidth,
    hasClassicScrollbar: root.clientWidth < window.innerWidth,
    containerQueries: media.containerQueries,
    unsupportedMediaUnits: media.unsupportedMediaUnits,
    opaqueStylesheets: countOpaqueStylesheets(document),
    iframes: document.querySelectorAll('iframe').length,
    mobile: /Android|iPhone|iPad|iPod|Mobile/i.test(window.navigator.userAgent),
  };
}

/** Full self check for a running page: live facts plus any source facts you pass in. */
export function runPreflight(options: ProbeOptions = {}): Verdict {
  const runtime = collectBrowserFacts(options);
  return evaluatePreflight({ runtime, source: { ...emptySource(), ...options.source } });
}

/** Prints the report and returns it. Leave it out of production code paths. */
export function printPreflight(options: ProbeOptions = {}): Verdict {
  const verdict = runPreflight(options);
  console.log(`\n${formatPreflight(verdict)}\n`);
  return verdict;
}

declare global {
  interface Window {
    stableViewportCheck?: (options?: ProbeOptions) => Verdict;
    [key: string]: unknown;
  }
}

/**
 * Opt-in console helper. Importing this module is side-effect free: only this
 * call writes a global, and it returns an uninstall function, so an application
 * that never calls it stays untouched.
 */
export function installConsoleCheck(name = 'stableViewportCheck'): () => void {
  if (typeof window === 'undefined') return () => {};
  const host = window as Window & Record<string, unknown>;
  const previous = Object.getOwnPropertyDescriptor(host, name);
  const installed = (options?: ProbeOptions) => printPreflight(options);
  host[name] = installed;
  return () => {
    // A host value written before or after this installation is not ours to remove.
    if (host[name] !== installed) return;
    if (previous) Object.defineProperty(host, name, previous);
    else delete host[name];
  };
}
