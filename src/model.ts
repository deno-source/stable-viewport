export type ViewportStatus = 'active' | 'disabled' | 'unsupported' | 'destroyed';

export interface Diagnostic {
  code: string;
  message: string;
  detail?: Record<string, unknown>;
}

export interface ViewportOptions {
  /** Design canvas width in CSS pixels. Defaults to 1920. */
  designWidth?: number;
  /** Master switch. Disabled sessions keep native behaviour untouched. */
  enabled?: boolean;
  /** Opt in on phones/tablets; mobile is disabled by default. */
  mobile?: boolean;
  /** Target document; defaults to the global document. */
  document?: Document;
  /** Receives capability gaps and conflict reports. */
  onDiagnostic?: (diagnostic: Diagnostic) => void;
}

export interface ViewportState {
  status: ViewportStatus;
  scale: number;
  designWidth: number;
  diagnostics: readonly Diagnostic[];
}

export interface ViewportController {
  /** Re-scan stylesheets and recompute metrics. Safe to call from app code. */
  refresh(): void;
  /** Update options in place. Throws on an invalid or conflicting configuration. */
  update(options: Partial<ViewportOptions>): void;
  getState(): ViewportState;
  /** Idempotent teardown; the last owner restores the document to its prior state. */
  destroy(): void;
}

export interface NormalizedOptions extends Required<Pick<ViewportOptions, 'designWidth' | 'enabled' | 'mobile'>> {
  document?: Document;
  onDiagnostic?: (diagnostic: Diagnostic) => void;
}

function readDesignWidth(value: number | undefined): number {
  const designWidth = value ?? 1920;
  if (!Number.isFinite(designWidth) || designWidth <= 0) {
    throw new RangeError('designWidth must be a finite positive number');
  }
  return designWidth;
}

function readCallback(value: ViewportOptions['onDiagnostic']): ViewportOptions['onDiagnostic'] {
  if (value !== undefined && typeof value !== 'function') throw new TypeError('onDiagnostic must be a function');
  return value;
}

/**
 * Duck-typed so a Document from another realm (an iframe) is accepted, while a
 * plain object that only looks like one is rejected before anything is written.
 */
function isDocument(value: unknown): value is Document {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Document;
  return candidate.nodeType === 9 &&
    typeof candidate.createElement === 'function' &&
    typeof candidate.createElementNS === 'function' &&
    typeof candidate.addEventListener === 'function' &&
    candidate.documentElement !== null &&
    candidate.documentElement !== undefined;
}

function readDocument(value: ViewportOptions['document']): ViewportOptions['document'] {
  if (value !== undefined && !isDocument(value)) throw new TypeError('document must be a Document');
  return value;
}

/** Parses caller input once, at the boundary; everything inside trusts it. */
export function normalizeOptions(options: ViewportOptions): NormalizedOptions {
  if (options === null || typeof options !== 'object') throw new TypeError('Viewport options must be an object');
  return {
    designWidth: readDesignWidth(options.designWidth),
    enabled: options.enabled ?? true,
    mobile: options.mobile ?? false,
    document: readDocument(options.document),
    onDiagnostic: readCallback(options.onDiagnostic),
  };
}

export interface ViewportMetrics {
  /** CSS zoom applied to the root: layout width is always designWidth. */
  layoutScale: number;
  /** Factor that maps design breakpoints onto the engine's media viewport. */
  mediaScale: number;
  vw: number;
  vh: number;
  vmin: number;
  vmax: number;
}

export interface ViewportMeasures {
  innerWidth: number;
  clientWidth: number;
  clientHeight: number;
}

/**
 * The design canvas is the root's content box. A classic scrollbar therefore
 * cannot push the canvas wider than the design width, while media queries keep
 * using innerWidth, which is what the engine evaluates them against.
 */
export function viewportMetrics(measures: ViewportMeasures, designWidth: number): ViewportMetrics {
  const layoutScale = measures.clientWidth / designWidth;
  const vw = designWidth / 100;
  const vh = layoutScale > 0 && Number.isFinite(layoutScale) ? measures.clientHeight / layoutScale / 100 : 0;
  return {
    layoutScale: layoutScale || 0,
    mediaScale: measures.innerWidth / designWidth,
    vw,
    vh,
    vmin: Math.min(vw, vh),
    vmax: Math.max(vw, vh),
  };
}

const MOBILE_USER_AGENT = /Android|iPhone|iPad|iPod|Mobile/i;

export function isMobile(window: Pick<Window, 'navigator'>): boolean {
  const navigator = window.navigator;
  return MOBILE_USER_AGENT.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
