import { describe, it, expect } from 'vitest';
import { evaluatePreflight, formatPreflight, type RuntimeFacts, type SourceFacts } from '../src/preflight';

const healthyRuntime: RuntimeFacts = {
  cssZoom: true,
  designWidth: 1920,
  rootZoom: '1',
  rootTransform: 'none',
  clientWidth: 1905,
  innerWidth: 1920,
  hasClassicScrollbar: true,
  containerQueries: 0,
  unsupportedMediaUnits: [],
  opaqueStylesheets: 0,
  iframes: 0,
  mobile: false,
};

const healthySource: SourceFacts = {
  viewportUnits: ['vh', 'vw'],
  adaptableBreakpoints: 6,
  unsupportedBreakpoints: [],
  deviceBreakpoints: 0,
  containerQueries: 0,
  viewportReads: 0,
  closedShadowRoots: 0,
  rootZoomRules: 0,
  rootTransformRules: 0,
  fixedElements: 1,
  runtimeStyles: 0,
};

const level = (verdict: ReturnType<typeof evaluatePreflight>, code: string) =>
  verdict.findings.find((finding) => finding.code === code)?.level;

describe('preflight verdicts', () => {
  it('passes a project that meets every minimum condition', () => {
    const verdict = evaluatePreflight({ runtime: healthyRuntime, source: healthySource });
    expect(verdict.verdict).toBe('ready');
    expect(verdict.summary.errors).toBe(0);
    expect(verdict.summary.warnings).toBe(0);
    expect(level(verdict, 'css-zoom')).toBe('ok');
    expect(level(verdict, 'root-zoom')).toBe('ok');
    expect(level(verdict, 'root-transform')).toBe('ok');
  });

  it('blocks an engine without CSS zoom', () => {
    const verdict = evaluatePreflight({ runtime: { ...healthyRuntime, cssZoom: false }, source: healthySource });
    expect(verdict.verdict).toBe('blocked');
    expect(level(verdict, 'css-zoom')).toBe('error');
  });

  it('blocks a document that already zooms or transforms its root', () => {
    const zoom = evaluatePreflight({ runtime: { ...healthyRuntime, rootZoom: '1.25' }, source: healthySource });
    expect(zoom.verdict).toBe('blocked');
    expect(level(zoom, 'root-zoom')).toBe('error');

    const transform = evaluatePreflight({ runtime: { ...healthyRuntime, rootTransform: 'matrix(1, 0, 0, 1, 0, 0)' }, source: healthySource });
    expect(transform.verdict).toBe('blocked');
    expect(level(transform, 'root-transform')).toBe('error');

    const appCss = evaluatePreflight({ runtime: healthyRuntime, source: { ...healthySource, rootZoomRules: 2, rootTransformRules: 1 } });
    expect(appCss.verdict).toBe('blocked');
    expect(level(appCss, 'root-rules')).toBe('error');
  });

  it('warns about conditions that degrade but never block', () => {
    const verdict = evaluatePreflight({
      runtime: { ...healthyRuntime, unsupportedMediaUnits: ['ch'], opaqueStylesheets: 1, iframes: 2, mobile: true },
      source: { ...healthySource, viewportReads: 4, closedShadowRoots: 1 },
    });
    expect(verdict.verdict).toBe('ready-with-caveats');
    expect(verdict.summary.errors).toBe(0);
    for (const code of ['media-units', 'opaque-stylesheets', 'iframes', 'mobile', 'viewport-reads', 'closed-shadow']) {
      expect(level(verdict, code), code).toBe('warn');
    }
  });

  it('treats container queries and device breakpoints as informational, not failures', () => {
    const verdict = evaluatePreflight({
      runtime: { ...healthyRuntime, containerQueries: 2 },
      source: { ...healthySource, deviceBreakpoints: 3, containerQueries: 1 },
    });
    expect(verdict.verdict).toBe('ready');
    expect(level(verdict, 'container-queries')).toBe('info');
    expect(verdict.findings.find((finding) => finding.code === 'container-queries')?.detail).toContain('2 container size queries are evaluated');
    expect(level(verdict, 'device-breakpoints')).toBe('info');
  });

  it('blocks framework versions below the documented minimum', () => {
    const verdict = evaluatePreflight({
      runtime: healthyRuntime,
      source: healthySource,
      project: { nodeVersion: '18.19.0', reactVersion: '17.2.0', vueVersion: '3.2.0', nextVersion: '13.5.0' },
    });
    expect(verdict.verdict).toBe('blocked');
    expect(level(verdict, 'version-nodeVersion')).toBe('error');
    expect(level(verdict, 'version-reactVersion')).toBe('error');
    expect(level(verdict, 'version-vueVersion')).toBe('error');
    expect(level(verdict, 'version-nextVersion')).toBe('error');
  });

  it('accepts caret and workspace version ranges', () => {
    const verdict = evaluatePreflight({
      runtime: healthyRuntime,
      source: healthySource,
      project: { reactVersion: '^18.2.0', vueVersion: '~3.4.21', nextVersion: '15.1.0' },
    });
    expect(verdict.verdict).toBe('ready');
  });

  it('reports a classic scrollbar as informational because the canvas uses the content box', () => {
    const verdict = evaluatePreflight({ runtime: healthyRuntime, source: healthySource });
    expect(level(verdict, 'scrollbar')).toBe('info');
    expect(verdict.findings.find((finding) => finding.code === 'scrollbar')?.detail).toContain('1905');
  });

  it('formats a readable report with a headline and counters', () => {
    const verdict = evaluatePreflight({ runtime: { ...healthyRuntime, cssZoom: false }, source: healthySource });
    const text = formatPreflight(verdict);
    expect(text).toContain('BLOCKED');
    expect(text).toContain('FAIL  CSS zoom is not supported');
    expect(text).toContain('→');
    expect(text).toMatch(/\d+ pass · \d+ info · \d+ warn · \d+ fail/);
  });

  it('works without runtime facts, e.g. before the component is mounted anywhere', () => {
    const verdict = evaluatePreflight({ source: healthySource });
    expect(verdict.verdict).toBe('ready');
    expect(verdict.findings.some((finding) => finding.code === 'css-zoom')).toBe(false);
  });
});

describe('version boundaries and counters (mutation-hardening)', () => {
  const withProject = (project: Record<string, string>) =>
    evaluatePreflight({ runtime: healthyRuntime, source: healthySource, project });

  it('accepts exactly the documented minimum and blocks one patch below', () => {
    expect(withProject({ reactVersion: '18.0.0', vueVersion: '3.3.0', nextVersion: '15.0.0', nodeVersion: '22.0.0' }).verdict).toBe('ready');
    expect(withProject({ reactVersion: '17.9.9' }).verdict).toBe('blocked');
    expect(withProject({ vueVersion: '3.2.9' }).verdict).toBe('blocked');
    expect(withProject({ nextVersion: '14.9.9' }).verdict).toBe('blocked');
    expect(withProject({ nodeVersion: '21.9.9' }).verdict).toBe('blocked');
  });
  it('compares minor and patch independently of the major version', () => {
    expect(withProject({ reactVersion: '18.0.1' }).verdict).toBe('ready');
    expect(withProject({ vueVersion: '3.3.1' }).verdict).toBe('ready');
    expect(withProject({ nextVersion: '15.0.1' }).verdict).toBe('ready');
    expect(withProject({ nodeVersion: '22.0.1' }).verdict).toBe('ready');
  });
  it('counts every finding exactly once per level', () => {
    const verdict = evaluatePreflight({
      runtime: { ...healthyRuntime, cssZoom: false, unsupportedMediaUnits: ['ch'] },
      source: { ...healthySource, viewportReads: 1 },
    });
    expect(verdict.summary.errors).toBe(1);
    expect(verdict.summary.warnings).toBe(2);
    expect(verdict.summary.passes).toBe(verdict.findings.filter((finding) => finding.level === 'ok').length);
    expect(verdict.summary.errors + verdict.summary.warnings + verdict.summary.infos + verdict.summary.passes).toBe(verdict.findings.length);
    expect(verdict.verdict).toBe('blocked');
  });
  it('merges, de-duplicates and sorts the units seen at runtime and in source', () => {
    const verdict = evaluatePreflight({
      runtime: { ...healthyRuntime, unsupportedMediaUnits: ['ch', 'vh'], containerQueries: 3 },
      source: { ...healthySource, unsupportedBreakpoints: ['lh', 'ch'], containerQueries: 1 },
    });
    const finding = verdict.findings.find((entry) => entry.code === 'media-units');
    expect(finding?.detail).toContain('units: ch, lh, vh.');
    expect(verdict.findings.find((entry) => entry.code === 'container-queries')?.detail).toContain('3 container size queries');
  });
  it('formats detail and fix lines only when they exist', () => {
    const text = formatPreflight({
      verdict: 'ready-with-caveats',
      summary: { errors: 0, warnings: 1, infos: 0, passes: 1 },
      findings: [
        { code: 'a', level: 'ok', title: 'plain pass' },
        { code: 'b', level: 'warn', title: 'with detail', detail: 'because', fix: 'do this' },
      ],
    });
    const detailLines = text.split(String.fromCharCode(10)).filter((line) => /because|do this/.test(line));
    expect(detailLines).toEqual(['        because', '        → do this']);
    expect(text).toContain('READY WITH CAVEATS');
    expect(text).toContain('1 pass · 0 info · 1 warn · 0 fail');
  });
  it('paints levels only when color is requested', () => {
    const verdict = evaluatePreflight({ runtime: healthyRuntime, source: healthySource });
    expect(formatPreflight(verdict, false)).not.toContain('\u001b[');
    expect(formatPreflight(verdict, true)).toContain('\u001b[32mPASS');
  });
});
