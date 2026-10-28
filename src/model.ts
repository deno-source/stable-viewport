export interface ViewportOptions {
  designWidth?: number;
  enabled?: boolean;
  mobile?: boolean;
  document?: Document;
  onDiagnostic?: (diagnostic: Diagnostic) => void;
}
export interface Diagnostic { code: string; message: string }
export interface ViewportState { status: 'active' | 'disabled' | 'unsupported' | 'destroyed'; scale: number; designWidth: number; diagnostics: readonly Diagnostic[] }
export interface ViewportController { refresh(): void; update(options: Partial<ViewportOptions>): void; getState(): ViewportState; destroy(): void }
export function normalizeOptions(options: ViewportOptions) {
  const designWidth = options.designWidth ?? 1920;
  if (!Number.isFinite(designWidth) || designWidth <= 0) throw new RangeError('designWidth must be a finite positive number');
  return { ...options, designWidth, enabled: options.enabled ?? true, mobile: options.mobile ?? false };
}
export type NormalizedOptions = ReturnType<typeof normalizeOptions>;
export function viewportMetrics(width: number, height: number, designWidth: number) {
  const scale = width / designWidth;
  const vw = designWidth / 100;
  const vh = height / scale / 100;
  return { scale, vw, vh, vmin: Math.min(vw, vh), vmax: Math.max(vw, vh) };
}
export function isMobile(window: Window): boolean {
  const navigator = window.navigator;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
