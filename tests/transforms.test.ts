import { describe, it, expect } from 'vitest';
import { normalizeOptions, viewportMetrics, isMobile } from '../src/model';
import { transformValue, transformMedia, hasSizeFeatures, unsupportedMediaUnits } from '../src/transforms';
import { checkCapability, zoomAffectsLayout } from '../src/capability';

describe('configuration', () => {
  it('defaults to a 1920 design canvas and rejects illegal widths before side effects', () => {
    expect(normalizeOptions({}).designWidth).toBe(1920);
    expect(normalizeOptions({ designWidth: 1440 }).enabled).toBe(true);
    for (const designWidth of [0, -1, NaN, Infinity, -Infinity]) {
      expect(() => normalizeOptions({ designWidth })).toThrow(RangeError);
    }
    expect(() => normalizeOptions({ designWidth: 1440, onDiagnostic: 'nope' as never })).toThrow(TypeError);
  });
  it('disables mobile user agents unless explicitly opted in', () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148';
    expect(isMobile({ navigator: { userAgent: ua, platform: 'iPhone', maxTouchPoints: 5 } } as Window)).toBe(true);
    expect(isMobile({ navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0)', platform: 'Win32', maxTouchPoints: 0 } } as Window)).toBe(false);
  });
});

describe('viewport metrics', () => {
  it('keeps the layout canvas exactly at the design width without a scrollbar', () => {
    expect(viewportMetrics({ innerWidth: 1280, clientWidth: 1280, clientHeight: 720 }, 1920)).toEqual({
      layoutScale: 1280 / 1920,
      mediaScale: 1280 / 1920,
      vw: 19.2,
      vh: 720 / (1280 / 1920) / 100,
      vmin: 720 / (1280 / 1920) / 100,
      vmax: 19.2,
    });
  });
  it('excludes a classic scrollbar from the layout canvas but keeps media queries on innerWidth', () => {
    const metrics = viewportMetrics({ innerWidth: 1280, clientWidth: 1265, clientHeight: 705 }, 1920);
    expect(metrics.layoutScale).toBe(1265 / 1920);
    expect(metrics.mediaScale).toBe(1280 / 1920);
    expect(metrics.vw * 100).toBeCloseTo(1920, 10);
    expect(metrics.vh * 100).toBeCloseTo(705 / (1265 / 1920), 10);
  });
  it('survives a zero-width document without producing non-finite values', () => {
    const metrics = viewportMetrics({ innerWidth: 0, clientWidth: 0, clientHeight: 0 }, 1920);
    expect(metrics.layoutScale).toBe(0);
    expect(Number.isFinite(metrics.vh)).toBe(true);
  });
});

describe('viewport unit rewriting', () => {
  it('rewrites dynamic viewport units to design-canvas variables and leaves unrelated tokens alone', () => {
    expect(transformValue('min(80vh, calc(100vw - 24px))')).toBe(
      'min(calc(80 * var(--sv-vh)), calc(calc(100 * var(--sv-vw)) - 24px))',
    );
    expect(transformValue('1dvh -2.5vmin 3svw 4lvw 5svh 6dvmin 7lvh 8svmax')).toBe(
      'calc(1 * var(--sv-vh)) calc(-2.5 * var(--sv-vmin)) calc(3 * var(--sv-vw)) calc(4 * var(--sv-vw)) calc(5 * var(--sv-vh)) calc(6 * var(--sv-vmin)) calc(7 * var(--sv-vh)) calc(8 * var(--sv-vmax))',
    );
    expect(transformValue('0px 100% auto')).toBe('0px 100% auto');
  });
  it('never rewrites strings, URLs, comments, selectors or custom-property names', () => {
    expect(transformValue('url("10vw.svg") "20vh"')).toBe('url("10vw.svg") "20vh"');
    expect(transformValue("url(data:image/svg+xml,10vw) '1vw'")).toBe("url(data:image/svg+xml,10vw) '1vw'");
    expect(transformValue('var(--gap-vw) 2vw')).toBe('var(--gap-vw) calc(2 * var(--sv-vw))');
  });
  it('is idempotent for already adapted declarations', () => {
    const once = transformValue('calc(50vw + 10px)');
    expect(transformValue(once)).toBe(once);
  });
});

describe('breakpoint rewriting', () => {
  it('scales px, rem, em and absolute units inside width/height features', () => {
    expect(transformMedia('(min-width: 900px)', 0.5)).toBe('(min-width: 450px)');
    expect(transformMedia('(400px <= width <= 980px) and (min-height: 40em)', 0.2)).toBe(
      '(80px <= width <= 196px) and (min-height: 8em)',
    );
    expect(transformMedia('(min-width: 30rem)', 0.5)).toBe('(min-width: 15rem)');
    expect(transformMedia('(min-width: 10in) and (max-width: 20cm)', 0.5)).toBe(
      '(min-width: 480px) and (max-width: 377.95275591px)',
    );
    expect(transformMedia('(min-width: 72pt)', 0.5)).toBe('(min-width: 48px)');
  });
  it('handles boolean groups, media query lists and negation', () => {
    expect(transformMedia('((min-width: 900px) or (max-width: 400px))', 0.2)).toBe(
      '((min-width: 180px) or (max-width: 80px))',
    );
    expect(transformMedia('screen and (min-width: 1200px), print and (min-width: 40em)', 0.5)).toBe(
      'screen and (min-width: 600px), print and (min-width: 20em)',
    );
    expect(transformMedia('not all and (max-width: 600px)', 0.5)).toBe('not all and (max-width: 300px)');
  });
  it('leaves device, resolution and preference features untouched', () => {
    const untouched =
      '(min-device-width: 980px) and (resolution: 2dppx) and (prefers-reduced-motion: reduce) and (orientation: landscape)';
    expect(transformMedia(untouched, 0.2)).toBe(untouched);
  });
  it('leaves unsupported relative units native and reports them', () => {
    expect(transformMedia('(min-width: 60ch)', 0.5)).toBe('(min-width: 60ch)');
    expect(transformMedia('(min-width: 50vw)', 0.5)).toBe('(min-width: 50vw)');
    expect(unsupportedMediaUnits('(min-width: 60ch) and (max-height: 40lh)')).toEqual(['ch', 'lh']);
    expect(unsupportedMediaUnits('(min-width: 900px)')).toEqual([]);
  });
  it('classifies size features without depending on a particular scale', () => {
    expect(hasSizeFeatures('(max-width: 1440px)')).toBe(true);
    expect(hasSizeFeatures('(width < 48rem)')).toBe(true);
    expect(hasSizeFeatures('(min-height: 600px)')).toBe(true);
    expect(hasSizeFeatures('(prefers-color-scheme: dark)')).toBe(false);
    expect(hasSizeFeatures('screen and (min-width: 900px)')).toBe(true);
    expect(hasSizeFeatures('(min-width: 0px)')).toBe(true);
  });
});

describe('engine feature detection', () => {
  it('accepts an engine where zoom halves the layout', () => {
    expect(zoomAffectsLayout(() => 100)).toBe(false);
    expect(zoomAffectsLayout((zoom) => (zoom === '0.5' ? 50 : 100))).toBe(true);
    expect(zoomAffectsLayout((zoom) => (zoom === '0.5' ? 80 : 100))).toBe(false);
  });
  it('rejects engines that ignore zoom or report nonsense', () => {
    expect(zoomAffectsLayout(() => 0)).toBe(false);
    expect(zoomAffectsLayout(() => Number.NaN)).toBe(false);
    expect(zoomAffectsLayout((zoom) => (zoom === '0.5' ? -1 : 100))).toBe(false);
  });
});

describe('capability gate', () => {
  it('fails closed without a document', () => {
    const result = checkCapability(undefined, normalizeOptions({}));
    expect(result.status).toBe('unsupported');
    expect(result.diagnostics[0]?.code).toBe('no-document');
  });
  it('reports disabled before any browser check when opted out', () => {
    expect(checkCapability(undefined, normalizeOptions({ enabled: false }))).toEqual({ status: 'disabled', diagnostics: [] });
  });
});
