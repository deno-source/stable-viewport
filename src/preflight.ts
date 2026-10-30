/**
 * Minimum-condition self check. `evaluatePreflight` is pure: every fact comes
 * from `collectBrowserFacts` (live document) or `scanProject` (source tree), so
 * the decision can be unit-tested without a browser.
 */

export type Level = 'error' | 'warn' | 'info' | 'ok';

export interface Finding {
  code: string;
  level: Level;
  title: string;
  detail?: string;
  fix?: string;
}

export interface Verdict {
  verdict: 'ready' | 'ready-with-caveats' | 'blocked';
  findings: Finding[];
  summary: { errors: number; warnings: number; infos: number; passes: number };
}

export interface RuntimeFacts {
  /** `CSS.supports('zoom','1')` */
  cssZoom: boolean;
  /** Design canvas width that will be requested. */
  designWidth: number;
  /** Computed zoom currently on <html> before the library runs. */
  rootZoom: string;
  /** Computed transform/translate currently on <html> or <body>. */
  rootTransform: string;
  /** `document.documentElement.clientWidth` in the current engine. */
  clientWidth: number;
  innerWidth: number;
  /** True when the engine reports a classic scrollbar (clientWidth < innerWidth). */
  hasClassicScrollbar: boolean;
  /** Container size queries found in reachable CSS. */
  containerQueries: number;
  /** Media-query size units the library cannot project (ch, ex, lh, vw, ...). */
  unsupportedMediaUnits: string[];
  /** Stylesheets whose rules cannot be read (cross-origin). */
  opaqueStylesheets: number;
  iframes: number;
  /** Mobile user agent detected. */
  mobile: boolean;
}

export interface SourceFacts {
  /** Design units found in CSS/JS strings, e.g. ['vw','vh']. */
  viewportUnits: string[];
  /** Width/height breakpoints that are plain px/rem/em: these are rescaled. */
  adaptableBreakpoints: number;
  /** Width/height breakpoints using ch/ex/em? (em is fine) — recorded for honesty. */
  unsupportedBreakpoints: string[];
  /** `@media` size features on the device axis (min-device-width). */
  deviceBreakpoints: number;
  /** `@container` size queries in CSS. */
  containerQueries: number;
  /** Direct `innerWidth` / `clientWidth` reads in application JS. */
  viewportReads: number;
  /** `attachShadow({mode: 'closed'})` call sites: their internals cannot be adapted. */
  closedShadowRoots: number;
  /** Root-level `zoom` or `transform` declarations written by app CSS. */
  rootZoomRules: number;
  rootTransformRules: number;
  /** `position: fixed` usages: supported, recorded for the report only. */
  fixedElements: number;
  /** Styles produced at runtime (CSS-in-JS) are re-scanned when injected. */
  runtimeStyles: number;
}

export interface ProjectFacts {
  nodeVersion?: string;
  reactVersion?: string;
  vueVersion?: string;
  nextVersion?: string;
}

export interface PreflightInput {
  runtime?: RuntimeFacts;
  source: SourceFacts;
  project?: ProjectFacts;
  /** Minimum supported versions, so the report explains a blocked install. */
  minimums?: ProjectFacts;
}

const MINIMUMS: Required<Pick<ProjectFacts, 'nodeVersion' | 'reactVersion' | 'vueVersion' | 'nextVersion'>> = {
  nodeVersion: '22.0.0',
  reactVersion: '18.0.0',
  vueVersion: '3.3.0',
  nextVersion: '15.0.0',
};

function versionParts(version: string | undefined): [number, number, number] | undefined {
  if (!version) return undefined;
  const match = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(version);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

/** -1, 0 or 1 for two `major.minor.patch` strings. */
function compareVersions(left: string | undefined, right: string | undefined): number | undefined {
  const a = versionParts(left);
  const b = versionParts(right);
  if (!a || !b) return undefined;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index]! < b[index]! ? -1 : 1;
  }
  return 0;
}

const RUNTIME_RULES: ((facts: RuntimeFacts) => Finding[])[] = [
  (facts) => facts.cssZoom
    ? [{ code: 'css-zoom', level: 'ok', title: 'Engine supports CSS zoom' }]
    : [{
        code: 'css-zoom',
        level: 'error',
        title: 'CSS zoom is not supported by this engine',
        detail: 'stable-viewport scales the root with CSS zoom; without it the component cannot install.',
        fix: 'Use Chrome/Edge/Safari 16.4+ or Firefox 126+, or keep native browser zoom.',
      }],
  (facts) => {
    const zoom = facts.rootZoom === '' || facts.rootZoom === 'normal' ? 1 : Number(facts.rootZoom);
    if (!Number.isFinite(zoom) || Math.abs(zoom - 1) <= 0.001) return [{ code: 'root-zoom', level: 'ok', title: '<html> has no competing zoom' }];
    return [{
      code: 'root-zoom',
      level: 'error',
      title: '<html> already has a zoom value',
      detail: `computed zoom is "${facts.rootZoom}". Writing our own zoom would fight the existing rule.`,
      fix: 'Remove zoom from html/body or scope it to the container that needs it.',
    }];
  },
  (facts) => facts.rootTransform === 'none' || facts.rootTransform === ''
    ? [{ code: 'root-transform', level: 'ok', title: '<html>/<body> has no transform' }]
    : [{
        code: 'root-transform',
        level: 'error',
        title: '<html> or <body> has a transform',
        detail: `computed transform is "${facts.rootTransform}". A transformed ancestor becomes the containing block, so position:fixed elements and full-page adaptation break.`,
        fix: 'Move the transform to an inner wrapper, or disable stable-viewport on that page.',
      }],
  (facts) => facts.opaqueStylesheets === 0
    ? [{ code: 'opaque-stylesheets', level: 'ok', title: 'All stylesheets are readable' }]
    : [{
        code: 'opaque-stylesheets',
        level: 'warn',
        title: 'Cross-origin stylesheets cannot be inspected',
        detail: `${facts.opaqueStylesheets} stylesheet(s) expose no rules (CORS). Their viewport units and breakpoints keep native meaning.`,
        fix: 'Serve those stylesheets from the same origin or with a CORS header, or import them into your build.',
      }],
  (facts) => facts.iframes === 0
    ? [{ code: 'iframes', level: 'ok', title: 'No iframes' }]
    : [{
        code: 'iframes',
        level: 'warn',
        title: 'Iframes need their own controller',
        detail: `${facts.iframes} iframe(s) found. Same-origin documents need one controller each; cross-origin documents cannot be adapted.`,
        fix: 'Add a controller or the auto script inside each same-origin iframe document.',
      }],
  (facts) => facts.hasClassicScrollbar
    ? [{
        code: 'scrollbar',
        level: 'info',
        title: 'Classic scrollbar detected',
        detail: `clientWidth ${facts.clientWidth}px vs innerWidth ${facts.innerWidth}px: the canvas is measured on the content box, so the design width stays exact.`,
      }]
    : [{ code: 'scrollbar', level: 'ok', title: 'No classic scrollbar narrowing the canvas' }],
  (facts) => {
    if (!facts.mobile) return [{ code: 'mobile', level: 'ok', title: 'Desktop engine/viewport' }];
    return [{
      code: 'mobile',
      level: 'warn',
      title: 'Mobile user agent detected',
      detail: 'Adaptation is disabled by default on phones/tablets and must be enabled with mobile: true.',
    }];
  },
];

const SOURCE_RULES: ((facts: SourceFacts) => Finding[])[] = [
  (facts) => facts.viewportUnits.length === 0
    ? [{ code: 'viewport-units', level: 'ok', title: 'No viewport units in source' }]
    : [{
        code: 'viewport-units',
        level: 'ok',
        title: 'Viewport units found and supported',
        detail: `${facts.viewportUnits.join(', ')} are rewritten to design-canvas variables, including inside calc()/clamp()/min()/max().`,
      }],
  (facts) => facts.adaptableBreakpoints > 0
    ? [{ code: 'breakpoints', level: 'ok', title: `${facts.adaptableBreakpoints} width/height breakpoint(s) are projected` }]
    : [{ code: 'breakpoints', level: 'info', title: 'No responsive width/height breakpoints found' }],
  (facts) => facts.containerQueries === 0
    ? [{ code: 'container-queries', level: 'ok', title: 'No container size queries' }]
    : [{
        code: 'container-queries',
        level: 'info',
        title: 'Container size queries are present',
        detail: facts.containerQueries === 1
          ? '1 container size query is evaluated against its container in design space; it is intentionally not rewritten.'
          : `${facts.containerQueries} container size queries are evaluated against their container in design space; they are intentionally not rewritten.`,
      }],
  (facts) => facts.unsupportedBreakpoints.length === 0
    ? [{ code: 'media-units', level: 'ok', title: 'All size breakpoints can be projected' }]
    : [{
        code: 'media-units',
        level: 'warn',
        title: 'Some breakpoints use relative units and stay native',
        detail: `units: ${facts.unsupportedBreakpoints.join(', ')}. These keep the engine's viewport, so those breakpoints flip differently from px/rem ones.`,
        fix: 'Rewrite those breakpoints in px/rem/em, or accept the native behaviour.',
      }],
  (facts) => facts.deviceBreakpoints === 0
    ? [{ code: 'device-breakpoints', level: 'ok', title: 'No device-axis breakpoints' }]
    : [{
        code: 'device-breakpoints',
        level: 'info',
        title: 'Device-axis breakpoints stay native',
        detail: '(min-device-width) and friends describe the physical screen, not the page zoom, so they are never rewritten.',
      }],
  (facts) => facts.viewportReads === 0
    ? [{ code: 'viewport-reads', level: 'ok', title: 'No JS reads the raw viewport' }]
    : [{
        code: 'viewport-reads',
        level: 'warn',
        title: 'Application JS reads innerWidth/clientWidth',
        detail: `${facts.viewportReads} read(s) found. CSS adaptation cannot change values your JS computes, so layout driven by them will still respond to the physical viewport.`,
        fix: 'Derive those decisions from container width (ResizeObserver) or from the --sv-* variables instead.',
      }],
  (facts) => facts.rootZoomRules === 0 && facts.rootTransformRules === 0
    ? [{ code: 'root-rules', level: 'ok', title: 'No root zoom/transform in app CSS' }]
    : [{
        code: 'root-rules',
        level: 'error',
        title: 'Application CSS writes zoom/transform on the root',
        detail: `zoom rules: ${facts.rootZoomRules}, transform rules: ${facts.rootTransformRules}.`,
        fix: 'Remove them; stable-viewport owns the root zoom and fixed positioning depends on an untransformed root.',
      }],
  (facts) => facts.closedShadowRoots === 0
    ? [{ code: 'closed-shadow', level: 'ok', title: 'No closed shadow roots in source' }]
    : [{
        code: 'closed-shadow',
        level: 'warn',
        title: 'Closed shadow roots cannot be adapted',
        detail: `${facts.closedShadowRoots} attachShadow({ mode: 'closed' }) call site(s). Styles inside them keep native viewport units and cannot be restored.`,
        fix: 'Use mode: "open" for components that must adapt.',
      }],
  (facts) => facts.fixedElements === 0
    ? [{ code: 'fixed', level: 'ok', title: 'No fixed-position elements' }]
    : [{ code: 'fixed', level: 'ok', title: `${facts.fixedElements} fixed element(s) stay inside the design canvas` }],
  (facts) => facts.runtimeStyles === 0
    ? [{ code: 'runtime-styles', level: 'ok', title: 'No runtime-injected styles detected' }]
    : [{ code: 'runtime-styles', level: 'ok', title: 'Runtime-injected styles are re-scanned automatically' }],
];

function projectRules(project: ProjectFacts | undefined, minimums: ProjectFacts): Finding[] {
  if (!project) return [];
  const findings: Finding[] = [];
  const checks: [keyof ProjectFacts, string][] = [
    ['nodeVersion', 'Node'],
    ['reactVersion', 'React'],
    ['vueVersion', 'Vue'],
    ['nextVersion', 'Next.js'],
  ];
  for (const [key, label] of checks) {
    const declared = project[key];
    if (!declared) continue;
    const comparison = compareVersions(declared, minimums[key]);
    if (comparison === undefined || comparison >= 0) {
      findings.push({ code: `version-${key}`, level: 'ok', title: `${label} ${declared} meets the minimum ${minimums[key]}` });
      continue;
    }
    findings.push({
      code: `version-${key}`,
      level: 'error',
      title: `${label} ${declared} is below the minimum ${minimums[key]}`,
      fix: `Upgrade ${label} to ${minimums[key]} or newer.`,
    });
  }
  return findings;
}

/** A unit seen at runtime and a unit seen in source are the same caveat. */
function sourceFacts(input: PreflightInput): SourceFacts {
  return {
    ...input.source,
    unsupportedBreakpoints: [...new Set([...(input.runtime?.unsupportedMediaUnits ?? []), ...input.source.unsupportedBreakpoints])].sort(),
    containerQueries: Math.max(input.source.containerQueries, input.runtime?.containerQueries ?? 0),
  };
}

function summarize(findings: Finding[]) {
  const summary = { errors: 0, warnings: 0, infos: 0, passes: 0 };
  const bucket: Record<Level, keyof typeof summary> = { error: 'errors', warn: 'warnings', info: 'infos', ok: 'passes' };
  for (const finding of findings) summary[bucket[finding.level]] += 1;
  return summary;
}

function verdictOf(summary: ReturnType<typeof summarize>): Verdict['verdict'] {
  if (summary.errors > 0) return 'blocked';
  return summary.warnings > 0 ? 'ready-with-caveats' : 'ready';
}

export function evaluatePreflight(input: PreflightInput): Verdict {
  const source = sourceFacts(input);
  const findings: Finding[] = [
    ...(input.runtime ? RUNTIME_RULES.flatMap((rule) => rule(input.runtime!)) : []),
    ...SOURCE_RULES.flatMap((rule) => rule(source)),
    ...projectRules(input.project, { ...MINIMUMS, ...input.minimums }),
  ];
  const summary = summarize(findings);
  return { verdict: verdictOf(summary), findings, summary };
}

const LABEL: Record<Level, string> = { error: 'FAIL', warn: 'WARN', info: 'INFO', ok: 'PASS' };

export function formatPreflight(verdict: Verdict, color = false): string {
  const paint = (level: Level) => {
    if (!color) return LABEL[level];
    const code = level === 'error' ? 31 : level === 'warn' ? 33 : level === 'info' ? 36 : 32;
    return `\u001b[${code}m${LABEL[level]}\u001b[0m`;
  };
  const lines = verdict.findings.map((finding) => {
    const head = `${paint(finding.level)}  ${finding.title}`;
    const detail = finding.detail ? `\n        ${finding.detail}` : '';
    const fix = finding.fix ? `\n        → ${finding.fix}` : '';
    return head + detail + fix;
  });
  const { errors, warnings, infos, passes } = verdict.summary;
  const headline =
    verdict.verdict === 'ready'
      ? 'READY: this project meets every minimum condition.'
      : verdict.verdict === 'ready-with-caveats'
        ? 'READY WITH CAVEATS: it works, but read the warnings before shipping.'
        : 'BLOCKED: fix the failures before installing, otherwise the UI can break.';
  return [headline, '', ...lines, '', `${passes} pass · ${infos} info · ${warnings} warn · ${errors} fail`].join('\n');
}
