import { patchCssom, type CssomPatch } from './cssom-patch';
import { createInlineStyles } from './inline-styles';
import { createElementMedia } from './element-media';
import { createMediaRules } from './media-rules';
import { ruleChildren, ruleStyle } from './css-om';
import { visitRules } from './rule-walker';
import type { Diagnostic } from './model';

type BrowserWindow = Window & typeof globalThis;
type Report = (diagnostic: Diagnostic) => void;

export interface StylesPatch {
  /** Full re-scan: for a new document, or after the app rewrote CSS behind our back. */
  refresh(): void;
  /**
   * Cheap path for a resize/print: the declarations only reference
   * `var(--sv-*)`, so the only thing that has to move is a media condition.
   */
  reflow(): void;
  destroy(): void;
}

const OBSERVE: MutationObserverInit = {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['style', 'media'],
  characterData: true,
};

/** Retry budgets: while parsing, an inline sheet may briefly report no rules. */
const EMPTY_RETRIES_PARSING = 10;
const EMPTY_RETRIES_STABLE = 2;

export interface StylesState {
  document: Document;
  window: BrowserWindow;
  active: boolean;
  report: Report;
  reported: Set<string>;
  opaque: WeakSet<CSSStyleSheet>;
  frames: WeakSet<Element>;
  shadows: Map<ShadowRoot, MutationObserver>;
  /** Elements and sheets already inspected; a full refresh resets both. */
  inspected: WeakSet<Element>;
  /**
   * Sheet → the `<style>` text it was processed for (`null` for links/imports).
   * An inline sheet whose text changed must be re-read: an engine may expose it
   * empty for one frame while the document is still parsing.
   */
  visited: WeakMap<CSSStyleSheet, string | null>;
  /** Empty sheets still waiting for rules, and how many frames we tried. */
  retry: Set<CSSStyleSheet>;
  retries: WeakMap<CSSStyleSheet, number>;
  retryFrame: number;
  /** Sheets seen so far, and how many follow-up frames are left after install. */
  sheetCount: number;
  rescanFrames: number;
  lateFrame: number;
  media: ReturnType<typeof createMediaRules>;
  elementMedia: ReturnType<typeof createElementMedia>;
  inline: ReturnType<typeof createInlineStyles>;
  cssom?: CssomPatch;
  observer?: MutationObserver;
  onLoad?: (event: Event) => void;
}

function createState(document: Document, window: BrowserWindow, getScale: () => number, report: Report): StylesState {
  return {
    document,
    window,
    active: true,
    report,
    reported: new Set(),
    opaque: new WeakSet(),
    frames: new WeakSet(),
    shadows: new Map(),
    inspected: new WeakSet(),
    visited: new WeakMap(),
    retry: new Set(),
    retries: new WeakMap(),
    retryFrame: 0,
    sheetCount: 0,
    rescanFrames: 0,
    lateFrame: 0,
    media: createMediaRules(getScale, report),
    elementMedia: createElementMedia(getScale, report),
    inline: createInlineStyles(document.documentElement),
  };
}

function warnOnce(state: StylesState, diagnostic: Diagnostic) {
  const key = `${diagnostic.code}:${diagnostic.detail?.unit ?? diagnostic.detail?.href ?? ''}`;
  if (state.reported.has(key)) return;
  state.reported.add(key);
  state.report(diagnostic);
}

function visit(state: StylesState, rules: CSSRuleList) {
  if (!state.active) return;
  visitRules(rules, state.window, {
    media: state.media.adapt,
    style: state.inline.adapt,
    container: () => warnOnce(state, {
      code: 'container-query',
      message: 'Container queries resolve against their container in design space; they are not rewritten',
    }),
    sheet: (sheet) => adaptSheet(state, sheet),
  }, () => state.active);
}

function isSecurityError(state: StylesState, error: unknown): boolean {
  return error instanceof state.window.DOMException && error.name === 'SecurityError';
}

function reportOpaque(state: StylesState, sheet: CSSStyleSheet) {
  if (state.opaque.has(sheet)) return;
  state.opaque.add(sheet);
  warnOnce(state, {
    code: 'opaque-stylesheet',
    message: `Cannot inspect cross-origin stylesheet: ${sheet.href ?? 'unknown'}`,
    detail: { href: sheet.href ?? null },
  });
}

function readRules(state: StylesState, sheet: CSSStyleSheet): CSSRuleList | undefined {
  try {
    return sheet.cssRules;
  } catch (error) {
    if (!isSecurityError(state, error)) throw error;
    reportOpaque(state, sheet);
    return undefined;
  }
}

/**
 * Text-level pre-filter for `<style>`: if the author text has neither a
 * viewport unit nor a size breakpoint, walking its rules cannot change
 * anything. An `@import` is the exception: its text says nothing about the
 * imported sheet, so the walk has to happen.
 */
const MAY_NEED_ADAPTATION = /(?:^|[^\w-])[-+]?\d*\.?\d*(?:s|d|l)?v(?:w|h|min|max)(?![\w-])|(?:min-|max-)?(?:width|height)\s*[:<>=]/i;
const IMPORTS_OTHER_CSS = /@import/i;

/**
 * Only an inline `<style>` carries its own text. A `<link>` (or an imported
 * sheet) has none, so its rules must be read to find out — that is also how an
 * opaque cross-origin sheet is detected, which the pre-filter must not hide.
 */
/** The inline text a `<style>` sheet was built from, or `null` for links. */
function sheetText(state: StylesState, sheet: CSSStyleSheet): string | null {
  const owner = sheet.ownerNode;
  return owner instanceof state.window.HTMLStyleElement ? owner.textContent ?? '' : null;
}

function needsVisit(state: StylesState, sheet: CSSStyleSheet, text: string | null): boolean {
  if (!state.visited.has(sheet)) return true;
  const seen = state.visited.get(sheet);
  // Links and imported sheets cannot change text under us; inline ones can.
  return text !== null && text !== seen;
}

function scheduleRetry(state: StylesState, sheet: CSSStyleSheet) {
  if (!state.active) return;
  state.retry.add(sheet);
  if (state.retryFrame) return;
  state.retryFrame = state.window.requestAnimationFrame(() => {
    state.retryFrame = 0;
    if (!state.active) return;
    const pending = Array.from(state.retry);
    state.retry.clear();
    for (const pendingSheet of pending) adaptSheet(state, pendingSheet);
  });
}

/**
 * An engine may expose an inline `<style>` with zero rules for one frame while
 * the document is still parsing. Such a sheet is retried a bounded number of
 * times, then left to the regular event entries (text change, CSSOM, `load`),
 * so a genuinely empty table cannot drive an endless frame loop.
 */
function retryOrGiveUp(state: StylesState, sheet: CSSStyleSheet, text: string | null) {
  const owner = sheet.ownerNode;
  if (owner && !owner.isConnected) {
    state.retries.delete(sheet);
    state.visited.set(sheet, text);
    return;
  }
  const attempts = (state.retries.get(sheet) ?? 0) + 1;
  const budget = state.document.readyState === 'loading' ? EMPTY_RETRIES_PARSING : EMPTY_RETRIES_STABLE;
  if (attempts > budget) {
    state.retry.delete(sheet);
    state.visited.set(sheet, text);
    return;
  }
  state.retries.set(sheet, attempts);
  scheduleRetry(state, sheet);
}

function adaptSheet(state: StylesState, sheet: CSSStyleSheet | null | undefined, replaced = false) {
  if (!state.active || !sheet) return;
  if (replaced) {
    // The same constructed sheet may be filled again; its previous visit is stale.
    state.visited.delete(sheet);
    state.retries.delete(sheet);
  }
  const text = sheetText(state, sheet);
  if (!needsVisit(state, sheet, text)) return;
  // A `<style>` whose text holds nothing relevant cannot need a walk; the
  // marker is still recorded so a later text edit is picked up.
  const irrelevant = text !== null && text.trim() !== '' && !MAY_NEED_ADAPTATION.test(text) && !IMPORTS_OTHER_CSS.test(text);
  if (irrelevant) {
    state.visited.set(sheet, text);
    return;
  }
  const rules = readRules(state, sheet);
  if (!rules) return;
  if (rules.length === 0) {
    retryOrGiveUp(state, sheet, text);
    return;
  }
  state.visited.set(sheet, text);
  state.retries.delete(sheet);
  visit(state, rules);
}

function inspectTree(state: StylesState, root: ParentNode) {
  for (const element of Array.from(root.querySelectorAll('*'))) inspectElement(state, element);
}

function inspectElement(state: StylesState, element: Element) {
  if (state.inspected.has(element)) return;
  state.inspected.add(element);
  if (element instanceof state.window.HTMLStyleElement || element instanceof state.window.HTMLLinkElement) adaptSheet(state, element.sheet);
  if ((element instanceof state.window.HTMLStyleElement || element instanceof state.window.HTMLLinkElement) && element.hasAttribute('media')) {
    state.elementMedia.adapt(element);
  }
  if ((element instanceof state.window.HTMLElement || element instanceof state.window.SVGElement) && element.hasAttribute('style')) {
    state.inline.adapt(element.style);
  }
  if (element.shadowRoot) watchShadow(state, element.shadowRoot);
  if (element instanceof state.window.HTMLIFrameElement && !state.frames.has(element)) {
    state.frames.add(element);
    warnOnce(state, {
      code: 'iframe-document',
      message: 'Same-origin iframes need their own controller inside that document; cross-origin internals cannot be inspected',
    });
  }
}

function watchShadow(state: StylesState, root: ShadowRoot) {
  if (!state.shadows.has(root)) {
    const watcher = new state.window.MutationObserver((records) => processMutations(state, records));
    watcher.observe(root, OBSERVE);
    state.shadows.set(root, watcher);
  }
  for (const sheet of Array.from(root.adoptedStyleSheets ?? [])) adaptSheet(state, sheet);
  for (const child of Array.from(root.children)) inspectElement(state, child);
  inspectTree(state, root);
}

function scan(state: StylesState, node: Node) {
  if (!(node instanceof state.window.Element)) return;
  inspectElement(state, node);
  inspectTree(state, node);
}

function isStyled(state: StylesState, target: Node): target is HTMLElement | SVGElement {
  return target instanceof state.window.HTMLElement || target instanceof state.window.SVGElement;
}

/** Frees one element's registrations once it is really out of the document. */
function releaseElement(state: StylesState, element: Element) {
  state.inspected.delete(element);
  if (isStyled(state, element)) state.inline.release(element.style);
  if (element instanceof state.window.HTMLStyleElement || element instanceof state.window.HTMLLinkElement) {
    // The sheet leaves the document with its owner; its media registrations can go now.
    if (element.sheet) state.media.forgetSheet(element.sheet);
  }
  if (element.shadowRoot && state.shadows.has(element.shadowRoot)) releaseShadow(state, element.shadowRoot);
}

function releaseShadow(state: StylesState, root: ShadowRoot) {
  state.shadows.get(root)?.disconnect();
  state.shadows.delete(root);
  for (const child of Array.from(root.querySelectorAll('*'))) releaseElement(state, child);
}

function releaseDetached(state: StylesState, nodes: Node[]) {
  const detached = nodes.filter((node) => !node.isConnected);
  for (const node of detached) {
    if (!(node instanceof state.window.Element)) continue;
    if (detached.some((other) => other !== node && other.contains(node))) continue;
    releaseElement(state, node);
    for (const child of Array.from(node.querySelectorAll('*'))) releaseElement(state, child);
  }
}

/** Drops nodes already covered by an ancestor in the same batch. */
function outermost(nodes: Node[]): Node[] {
  const unique = new Set(nodes);
  return Array.from(unique).filter((node) => {
    for (let parent = node.parentNode; parent; parent = parent.parentNode) {
      if (unique.has(parent)) return false;
    }
    return true;
  });
}

/** A removed rule's declarations were only registered for that rule. */
function releaseRule(state: StylesState, rule: CSSRule) {
  const style = ruleStyle(rule);
  if (style) state.inline.release(style);
  state.media.forget(rule);
  const children = ruleChildren(rule);
  if (children) for (const child of Array.from(children)) releaseRule(state, child);
}

function processAttribute(state: StylesState, target: Node) {
  if (isStyled(state, target)) state.inline.adapt(target.style);
  if (target instanceof state.window.HTMLStyleElement || target instanceof state.window.HTMLLinkElement) {
    state.elementMedia.adapt(target);
  }
}

/**
 * One batch is handled per final state, not per record: repeated attribute
 * writes on the same node and nested additions cost one inspection.
 */
function processMutations(state: StylesState, records: MutationRecord[]) {
  if (!state.active) return;
  const attributes = new Set<Node>();
  const added: Node[] = [];
  const removed: Node[] = [];
  for (const record of records) {
    if (record.type === 'attributes') {
      attributes.add(record.target);
      continue;
    }
    if (record.type === 'characterData') {
      const parent = record.target.parentElement;
      if (parent instanceof state.window.HTMLStyleElement) adaptSheet(state, parent.sheet);
      continue;
    }
    if (record.target instanceof state.window.HTMLStyleElement) adaptSheet(state, record.target.sheet);
    for (const node of Array.from(record.addedNodes)) added.push(node);
    for (const node of Array.from(record.removedNodes)) removed.push(node);
  }
  for (const target of attributes) processAttribute(state, target);
  for (const node of outermost(added)) scan(state, node);
  if (removed.length) {
    releaseDetached(state, removed);
    pruneShadows(state);
  }
}

function adaptDocumentSheets(state: StylesState) {
  const sheets = Array.from(state.document.styleSheets);
  state.sheetCount = sheets.length;
  for (const sheet of sheets) adaptSheet(state, sheet);
  for (const sheet of Array.from(state.document.adoptedStyleSheets ?? [])) adaptSheet(state, sheet);
}

/**
 * Some engines do not expose an inline `<style>` (or a `<link>`'s sheet) at the
 * instant we install: `document.styleSheets` still lacks it. Watch the sheet
 * count for a few frames and on `load`, then adopt whatever appeared. Only new
 * sheets are walked, so this costs a handful of map lookups.
 */
function watchLateSheets(state: StylesState) {
  if (!state.active || state.rescanFrames >= 4 || state.lateFrame) return;
  state.lateFrame = state.window.requestAnimationFrame(() => {
    state.lateFrame = 0;
    if (!state.active) return;
    state.rescanFrames += 1;
    const count = state.document.styleSheets.length;
    if (count !== state.sheetCount) {
      adaptDocumentSheets(state);
      state.elementMedia.refresh();
    }
    watchLateSheets(state);
  });
}

function pruneShadows(state: StylesState) {
  for (const [root, watcher] of Array.from(state.shadows)) {
    if (root.host.isConnected) continue;
    watcher.disconnect();
    state.shadows.delete(root);
  }
}

/** Full pass: forget what was inspected, then look at everything again. */
function refresh(state: StylesState) {
  if (!state.active) return;
  state.visited = new WeakMap();
  state.inspected = new WeakSet();
  state.retry.clear();
  state.retries = new WeakMap();
  adaptDocumentSheets(state);
  state.media.refresh();
  state.elementMedia.refresh();
  // The root can carry business custom properties of its own; the inline
  // adapter skips only the declarations the runtime owns.
  inspectElement(state, state.document.documentElement);
  if (state.document.body) scan(state, state.document.body);
  pruneShadows(state);
}

/** Resize/print path: only media conditions depend on the scale. */
function reflow(state: StylesState) {
  if (!state.active) return;
  state.media.refresh();
  state.elementMedia.refresh();
}

function destroy(state: StylesState) {
  if (!state.active) return;
  state.active = false;
  state.window.cancelAnimationFrame(state.retryFrame);
  state.window.cancelAnimationFrame(state.lateFrame);
  state.retryFrame = 0;
  state.lateFrame = 0;
  state.retry.clear();
  state.observer?.disconnect();
  if (state.onLoad) state.document.removeEventListener('load', state.onLoad, true);
  for (const [, watcher] of state.shadows) watcher.disconnect();
  state.shadows.clear();
  state.cssom?.restore();
  state.media.restore();
  state.elementMedia.restore();
  state.inline.restore();
}

/**
 * One stylesheet pipeline: rules are visited once, media conditions go to the
 * media adapter, declarations to the inline adapter, and every entry point that
 * can add CSS later (mutation, `load`, CSSOM, adopted sheets) feeds the same
 * visitor. Container queries are deliberately left native.
 */
export function installStyles(document: Document, window: BrowserWindow, getScale: () => number, report: Report): StylesPatch {
  const state = createState(document, window, getScale, report);
  try {
    state.cssom = patchCssom(window, {
      rules: (rules) => visit(state, rules),
      sheet: (sheet, replaced) => adaptSheet(state, sheet, replaced),
      removed: (rule) => releaseRule(state, rule),
      // Styles inside a freshly attached shadow root are adapted immediately.
      shadow: (root) => { if (state.active) watchShadow(state, root); },
    });
    state.observer = new window.MutationObserver((records) => processMutations(state, records));
    state.observer.observe(document.documentElement, OBSERVE);
    // A `<link>` and a `<style>` with `@import` both report their finished
    // sheet here; the imported content appeared after the first walk, so the
    // sheet is walked again even though its own text did not change.
    state.onLoad = (event: Event) => {
      const target = event.target;
      if (target instanceof window.HTMLLinkElement || target instanceof window.HTMLStyleElement) {
        adaptSheet(state, target.sheet, true);
      }
    };
    document.addEventListener('load', state.onLoad, true);
    // The install itself is the first full pass: declarations must be rewritten
    // before the first paint, and they do not depend on the current scale.
    refresh(state);
    watchLateSheets(state);
  } catch (error) {
    destroy(state);
    throw error;
  }
  return {
    refresh: () => refresh(state),
    reflow: () => reflow(state),
    destroy: () => destroy(state),
  };
}
