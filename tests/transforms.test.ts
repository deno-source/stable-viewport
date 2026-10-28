import { describe, it, expect } from 'vitest';
import { normalizeOptions, viewportMetrics } from '../src/model';
import { transformValue, transformMedia } from '../src/transforms';

describe('public configuration and CSS transformations', () => {
  it('rejects invalid widths before installing side effects', () => {
    for (const designWidth of [0, -1, NaN, Infinity]) expect(() => normalizeOptions({ designWidth })).toThrow(RangeError);
    expect(normalizeOptions({}).designWidth).toBe(1920);
  });
  it('preserves the logical viewport through native 500% dimensions', () => {
    expect(viewportMetrics(384, 216, 1920)).toEqual({scale:0.2,vw:19.2,vh:10.8,vmin:10.8,vmax:19.2});
  });
  it('transforms only CSS dimension tokens, never strings or URLs', () => {
    expect(transformValue('min(80vh, calc(100vw - 24px))')).toBe('min(calc(80 * var(--sv-vh)), calc(calc(100 * var(--sv-vw)) - 24px))');
    expect(transformValue('url("10vw.svg") "20vh"')).toBe('url("10vw.svg") "20vh"');
    expect(transformValue('1dvh -2.5vmin 3svw')).toBe('calc(1 * var(--sv-vh)) calc(-2.5 * var(--sv-vmin)) calc(3 * var(--sv-vw))');
  });
  it('adjusts width and height conditions while preserving device and user preferences', () => {
    expect(transformMedia('(400px <= width <= 980px) and (min-height: 40em)',0.2)).toBe('(80px <= width <= 196px) and (min-height: 8em)');
    const untouched='(min-device-width: 980px) and (resolution: 2dppx) and (prefers-reduced-motion: reduce)';
    expect(transformMedia(untouched,0.2)).toBe(untouched);
  });
  it('handles nested boolean feature groups and calc lengths',()=>{
    expect(transformMedia('((min-width: 900px) or (max-width: 400px))',0.2)).toBe('((min-width: 180px) or (max-width: 80px))');
    expect(transformMedia('(min-width: calc(900px + 2rem))',0.5)).toBe('(min-width: calc(450px + 1rem))');
  });
});
