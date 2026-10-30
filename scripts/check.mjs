#!/usr/bin/env node
/**
 * stable-viewport-check
 *
 * Two passes, both read-only:
 *   1. static  — scan the project's CSS/JS/package.json for the conditions that
 *                make adaptation impossible or destructive.
 *   2. runtime — optional; open a URL in a real browser and read live facts.
 *
 * The CLI never installs anything and never edits the project. Exit codes:
 *   0 ready · 1 ready with caveats (unless --strict) · 2 blocked · 3 tool error
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, relative, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

const CODE_EXTENSIONS = new Set(['.css', '.scss', '.sass', '.less', '.styl', '.html', '.htm', '.vue', '.svelte', '.astro', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const SKIP_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.output', 'coverage', 'test-results', 'playwright-report', '.svelte-kit', 'out', 'target']);
const MAX_FILE_BYTES = 2 * 1024 * 1024;

function parseArguments(argv) {
  const options = { root: process.cwd(), url: undefined, designWidth: 1920, json: false, strict: false, quiet: false, help: false, maxFiles: 4000, exclude: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = () => {
      index += 1;
      const value = argv[index];
      if (value === undefined) throw new Error(`${argument} requires a value`);
      return value;
    };
    if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument === '--root') options.root = resolve(next());
    else if (argument === '--url') options.url = next();
    else if (argument === '--design-width') options.designWidth = Number(next());
    else if (argument === '--json') options.json = true;
    else if (argument === '--strict') options.strict = true;
    else if (argument === '--quiet') options.quiet = true;
    else if (argument === '--max-files') options.maxFiles = Number(next());
    else if (argument === '--exclude') options.exclude.push(next());
    else if (argument.startsWith('-')) throw new Error(`Unknown option: ${argument}`);
    else options.root = resolve(argument);
  }
  if (!Number.isFinite(options.designWidth) || options.designWidth <= 0) throw new Error('--design-width must be a positive number');
  return options;
}

async function* walk(directory, budget) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (budget.count >= budget.max) return;
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name) || entry.name.startsWith('.')) continue;
      yield* walk(full, budget);
      continue;
    }
    if (!entry.isFile() || !CODE_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;
    const normalized = full.replaceAll(String.fromCharCode(92), '/');
    if (budget.exclude.some((fragment) => normalized.includes(fragment))) continue;
    budget.count += 1;
    yield full;
  }
}

async function readText(path) {
  try {
    const info = await stat(path);
    if (info.size > MAX_FILE_BYTES) return undefined;
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}

const RULES = [
  { kind: 'viewportUnits', pattern: /(?:^|[^\w-])[-+]?\d*\.?\d+(svw|svh|svmin|svmax|dvw|dvh|dvmin|dvmax|lvw|lvh|lvmin|lvmax|vw|vh|vmin|vmax)\b/gi },
  { kind: 'rootZoom', pattern: /(?:^|[\s,;{}])(?:html|:root|body)\s*(?:,[^{]*)?\{[^}]*?(?:^|[;\s])zoom\s*:/gim },
  { kind: 'rootTransform', pattern: /(?:^|[\s,;{}])(?:html|:root|body)\s*(?:,[^{]*)?\{[^}]*?(?:^|[;\s])(?:transform|translate)\s*:/gim },
  { kind: 'fixedElements', pattern: /position\s*:\s*fixed/gi },
  { kind: 'viewportReads', pattern: /\b(?:window\.)?(?:innerWidth|innerHeight|clientWidth|documentElement\.clientWidth)\b/g },
  { kind: 'closedShadowRoots', pattern: /attachShadow\s*\(\s*\{[^}]*mode\s*:\s*['"]closed['"]/g },
  { kind: 'runtimeStyles', pattern: /(?:insertRule|adoptedStyleSheets|styled\.|css`|createGlobalStyle|makeStyles|useStyles)/g },
  { kind: 'deviceBreakpoints', pattern: /\(\s*(?:min-|max-)?device-(?:width|height)\s*:/gi },
  { kind: 'containerQueries', pattern: /@container[^{]*\{/gi },
];

const BREAKPOINT_RULE = /\(\s*(?:min-|max-)?(?:width|height)\s*:\s*([^)]+)\)|\(\s*([\d.]+)([a-z%]+)\s*[<>]=?\s*(?:width|height)\s*\)/gi;
const SUPPORTED_BREAKPOINT_UNIT = /^(?:px|em|rem|pt|pc|in|cm|mm|q)$/i;

function collectBreakpoints(text) {
  const adaptable = [];
  const unsupported = new Set();
  for (const match of text.matchAll(BREAKPOINT_RULE)) {
    const conditions = match[1] ?? `${match[2]}${match[3]}`;
    for (const token of conditions.split(/[\s,]+/)) {
      const unit = /^[+-]?[\d.]+([a-z%]+)$/i.exec(token)?.[1];
      if (!unit) continue;
      if (SUPPORTED_BREAKPOINT_UNIT.test(unit)) adaptable.push(token);
      else unsupported.add(unit.toLowerCase());
    }
  }
  return { adaptable, unsupported };
}

function scanText(text) {
  const facts = { viewportUnits: new Set(), rootZoomRules: 0, rootTransformRules: 0, fixedElements: 0, viewportReads: 0, closedShadowRoots: 0, runtimeStyles: 0, deviceBreakpoints: 0, containerQueries: 0, adaptable: 0, unsupportedUnits: new Set() };
  for (const rule of RULES) {
    const matches = [...text.matchAll(rule.pattern)];
    if (!matches.length) continue;
    if (rule.kind === 'viewportUnits') {
      for (const match of matches) facts.viewportUnits.add(match[1].toLowerCase());
      continue;
    }
    if (rule.kind === 'rootZoom') facts.rootZoomRules += matches.length;
    else if (rule.kind === 'rootTransform') facts.rootTransformRules += matches.length;
    else if (rule.kind === 'fixedElements') facts.fixedElements += matches.length;
    else if (rule.kind === 'viewportReads') facts.viewportReads += matches.length;
    else if (rule.kind === 'closedShadowRoots') facts.closedShadowRoots += matches.length;
    else if (rule.kind === 'runtimeStyles') facts.runtimeStyles += matches.length;
    else if (rule.kind === 'deviceBreakpoints') facts.deviceBreakpoints += matches.length;
    else if (rule.kind === 'containerQueries') facts.containerQueries += matches.length;
  }
  const breakpoints = collectBreakpoints(text);
  facts.adaptable += breakpoints.adaptable.length;
  for (const unit of breakpoints.unsupported) facts.unsupportedUnits.add(unit);
  return facts;
}

function mergeFacts(target, source) {
  for (const unit of source.viewportUnits) target.viewportUnits.add(unit);
  for (const unit of source.unsupportedUnits) target.unsupportedUnits.add(unit);
  target.rootZoomRules += source.rootZoomRules;
  target.rootTransformRules += source.rootTransformRules;
  target.fixedElements += source.fixedElements;
  target.viewportReads += source.viewportReads;
  target.closedShadowRoots += source.closedShadowRoots;
  target.runtimeStyles += source.runtimeStyles;
  target.deviceBreakpoints += source.deviceBreakpoints;
  target.containerQueries += source.containerQueries;
  target.adaptable += source.adaptable;
  return target;
}

async function scanProject(options) {
  const aggregate = mergeFacts(
    { viewportUnits: new Set(), rootZoomRules: 0, rootTransformRules: 0, fixedElements: 0, viewportReads: 0, closedShadowRoots: 0, runtimeStyles: 0, deviceBreakpoints: 0, containerQueries: 0, adaptable: 0, unsupportedUnits: new Set() },
    scanText(''),
  );
  const budget = { count: 0, max: options.maxFiles, exclude: options.exclude };
  const hits = [];
  for await (const file of walk(options.root, budget)) {
    const text = await readText(file);
    if (!text) continue;
    const facts = scanText(text);
    mergeFacts(aggregate, facts);
    if (facts.rootZoomRules || facts.rootTransformRules) hits.push(relative(options.root, file));
  }
  const source = {
    viewportUnits: [...aggregate.viewportUnits].sort(),
    adaptableBreakpoints: aggregate.adaptable,
    unsupportedBreakpoints: [...aggregate.unsupportedUnits].sort(),
    deviceBreakpoints: aggregate.deviceBreakpoints,
    containerQueries: aggregate.containerQueries,
    viewportReads: aggregate.viewportReads,
    closedShadowRoots: aggregate.closedShadowRoots,
    rootZoomRules: aggregate.rootZoomRules,
    rootTransformRules: aggregate.rootTransformRules,
    fixedElements: aggregate.fixedElements,
    runtimeStyles: aggregate.runtimeStyles,
  };
  return { source, scannedFiles: budget.count, suspiciousFiles: hits };
}

async function readProjectVersions(root) {
  const manifestPath = join(root, 'package.json');
  if (!existsSync(manifestPath)) return {};
  const raw = await readText(manifestPath);
  if (!raw) return {};
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch {
    return {};
  }
  const dependency = (name) => manifest.dependencies?.[name] ?? manifest.devDependencies?.[name] ?? manifest.peerDependencies?.[name];
  const clean = (value) => (typeof value === 'string' ? value.replace(/^[^\d]*/, '').split(/[^\d.]/)[0] || undefined : undefined);
  return {
    nodeVersion: manifest.engines?.node ? clean(manifest.engines.node) : process.versions.node,
    reactVersion: clean(dependency('react')),
    vueVersion: clean(dependency('vue')),
    nextVersion: clean(dependency('next')),
  };
}

async function importPreflight(root) {
  const candidates = [
    pathToFileURL(join(root, 'node_modules', 'stable-viewport', 'dist', 'preflight.js')).href,
    pathToFileURL(join(root, 'stable-viewport', 'dist', 'preflight.js')).href,
  ];
  for (const candidate of candidates) {
    try {
      return await import(candidate);
    } catch {
      continue;
    }
  }
  // Running inside the package itself (development):
  return import(pathToFileURL(join(import.meta.dirname, '..', 'dist', 'preflight.js')).href);
}

async function probeRuntime(url, designWidth) {
  let playwright;
  try {
    playwright = await import('playwright');
  } catch {
    return { skipped: 'playwright is not installed in this project (npm i -D playwright)' };
  }
  const browser = await playwright.chromium.launch({ channel: process.env.SV_CHANNEL ?? undefined, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.goto(url, { waitUntil: 'load', timeout: 45000 });
    const runtime = await page.evaluate(async (width) => {
      const module = await import('/@stable-viewport/preflight-browser.js').catch(() => undefined);
      if (module?.collectBrowserFacts) return module.collectBrowserFacts({ designWidth: width });
      return undefined;
    }, designWidth).catch(() => undefined);
    if (runtime) return { runtime };
    // Fallback: read the essential facts without the package's probe module.
    const fallback = await page.evaluate((width) => {
      const root = document.documentElement;
      const computed = getComputedStyle(root);
      const bodyComputed = document.body ? getComputedStyle(document.body) : undefined;
      const transform = [computed.transform, bodyComputed?.transform, computed.translate, bodyComputed?.translate].filter((value) => value && value !== 'none').join(' ');
      return {
        cssZoom: typeof CSS?.supports === 'function' && CSS.supports('zoom', '1'),
        designWidth: width,
        rootZoom: computed.zoom ?? '1',
        rootTransform: transform || 'none',
        clientWidth: root.clientWidth,
        innerWidth: innerWidth,
        hasClassicScrollbar: root.clientWidth < innerWidth,
        containerQueries: 0,
        unsupportedMediaUnits: [],
        opaqueStylesheets: 0,
        iframes: document.querySelectorAll('iframe').length,
        mobile: /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent),
      };
    }, designWidth);
    return { runtime: fallback };
  } finally {
    await browser.close();
  }
}

const HELP = `stable-viewport-check — verify that a project can run stable-viewport

Usage
  npx stable-viewport-check [--root <dir>] [--url <page>] [--design-width 1920]
                            [--json] [--strict] [--quiet] [--max-files 4000]

Options
  --root <dir>          Project to scan (default: current directory)
  --url <page>          Also probe a running page in headless Chromium. Without
                        the "playwright" package this pass is reported as skipped.
  --design-width <n>    Design canvas width used for the runtime probe
  --json                Machine readable report on stdout
  --strict              Exit 1 for warnings as well as failures
  --quiet               Print only the summary line
  --max-files <n>       Static scan budget (default 4000 files)
  --exclude <fragment>  Skip paths containing this fragment (repeatable)

Exit codes
  0 ready · 1 ready with caveats (0 under --strict) · 2 blocked · 3 tool error
`;

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(`stable-viewport-check: ${error.message}\n`);
    console.error(HELP);
    return 3;
  }
  if (options.help) {
    console.log(HELP);
    return 0;
  }
  if (!existsSync(options.root)) {
    console.error(`stable-viewport-check: no such directory: ${options.root}`);
    return 3;
  }

  const preflight = await importPreflight(options.root);
  const scan = await scanProject(options);
  const project = await readProjectVersions(options.root);
  let runtimeProbe = {};
  if (options.url) {
    try {
      runtimeProbe = await probeRuntime(options.url, options.designWidth);
    } catch (error) {
      // A failed probe must never hide the static verdict.
      runtimeProbe = { failed: error?.message ?? String(error) };
    }
  }
  const verdict = preflight.evaluatePreflight({ source: scan.source, project, runtime: runtimeProbe.runtime });

  if (options.json) {
    console.log(JSON.stringify({
      ...verdict,
      root: options.root,
      url: options.url ?? null,
      scannedFiles: scan.scannedFiles,
      suspiciousFiles: scan.suspiciousFiles,
      source: scan.source,
      project,
      runtimeProbeSkipped: runtimeProbe.skipped ?? null,
      runtimeProbeError: runtimeProbe.failed ?? null,
    }, null, 2));
  } else {
    console.log(`\nstable-viewport self check — ${options.root}`);
    console.log(`scanned ${scan.scannedFiles} file(s) · design width ${options.designWidth}${options.url ? ` · runtime probe ${options.url}` : ' · static only'}`);
    if (runtimeProbe.skipped) console.log(`runtime probe skipped: ${runtimeProbe.skipped}`);
    if (runtimeProbe.failed) console.log(`runtime probe failed: ${runtimeProbe.failed} (static results below are unaffected)`);
    if (!options.quiet) {
      console.log('');
      console.log(preflight.formatPreflight(verdict, process.stdout.isTTY));
      if (scan.suspiciousFiles.length) {
        console.log('\nFiles that write root zoom/transform:');
        for (const file of scan.suspiciousFiles.slice(0, 20)) console.log(`  - ${file}`);
      }
    } else {
      console.log(preflight.formatPreflight(verdict));
    }
  }

  if (verdict.verdict === 'blocked') return 2;
  if (verdict.verdict === 'ready-with-caveats') return options.strict ? 1 : 0;
  return 0;
}

main().then((code) => {
  process.exitCode = code;
}).catch((error) => {
  console.error(`stable-viewport-check: ${error?.stack ?? error}`);
  process.exitCode = 3;
});
