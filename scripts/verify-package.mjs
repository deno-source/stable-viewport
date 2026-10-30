#!/usr/bin/env node
/**
 * Packaging check: packs the tarball, installs it into a throwaway project, and
 * verifies the shipped surface works there without touching the app.
 *
 *   node scripts/verify-package.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Windows needs a shell for .cmd shims; arguments are static and quoted. */
const run = (command, args, cwd, expectFailure = false) => {
  const options = { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' };
  try {
    return execFileSync(command, args, options);
  } catch (error) {
    if (!expectFailure) throw error;
    return `${error.stdout ?? ''}${error.stderr ?? ''}`;
  }
};

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
/** Node itself never needs a shell; keep inline scripts quoting-safe. */
const runNode = (args, cwd) => execFileSync(process.execPath, args, { cwd, encoding: 'utf8' });
const failures = [];
const check = (condition, message) => {
  if (condition) {
    console.log(`  PASS  ${message}`);
    return;
  }
  failures.push(message);
  console.log(`  FAIL  ${message}`);
};

const workdir = await mkdtemp(join(tmpdir(), 'stable-viewport-package-'));
console.log(`package check in ${workdir}`);

try {
  const packOutput = run(npm, ['pack', '--silent', '--pack-destination', workdir], process.cwd());
  const tarball = packOutput.trim().split(/\r?\n/).pop();
  const tarballPath = join(workdir, tarball);
  check(tarball.endsWith('.tgz'), `packed ${tarball}`);

  const contents = run('tar', ['-tzf', tarball], workdir).split(/\r?\n/).filter(Boolean);
  for (const expected of ['package/dist/index.js', 'package/dist/index.d.ts', 'package/dist/react.js', 'package/dist/vue.js', 'package/dist/web-component.js', 'package/dist/auto.js', 'package/dist/preflight.js', 'package/scripts/check.mjs', 'package/README.md', 'package/LICENSE']) {
    check(contents.includes(expected), `tarball contains ${expected}`);
  }
  for (const forbidden of ['package/src/', 'package/tests/', 'package/e2e/', 'package/node_modules/']) {
    check(!contents.some((entry) => entry.startsWith(forbidden)), `tarball excludes ${forbidden}`);
  }

  // A consumer project: package.json + one stylesheet + an app entry.
  const consumer = join(workdir, 'consumer');
  await writeFile(join(workdir, 'placeholder'), '');
  run(npm, ['init', '-y', '--silent'], workdir);
  const { mkdir } = await import('node:fs/promises');
  await mkdir(join(consumer, 'src'), { recursive: true });
  await writeFile(join(consumer, 'package.json'), JSON.stringify({
    name: 'consumer',
    private: true,
    type: 'module',
    dependencies: { 'stable-viewport': `file:${tarballPath}` },
    engines: { node: '>=22' },
  }, null, 2));
  await writeFile(join(consumer, 'index.html'), '<!doctype html><style>.card{width:320px}@media (max-width: 1200px){.card{width:100%}}</style><div class="card">x</div>');
  run(npm, ['install', '--silent', '--no-audit', '--no-fund'], consumer);
  const bin = join(consumer, 'node_modules', '.bin', process.platform === 'win32' ? 'stable-viewport-check.cmd' : 'stable-viewport-check');
  const rawReport = run(bin, ['--root', '.', '--json'], consumer);
  const report = JSON.parse(rawReport.slice(rawReport.indexOf('{')));
  check(report.verdict === 'ready', `self check reports ready in an installed project (${report.verdict})`);
  check(Array.isArray(report.findings) && report.findings.length > 0, 'self check produced findings');

  const before = await readdir(consumer);
  run(bin, ['--root', '.', '--quiet'], consumer);
  const after = await readdir(consumer);
  check(JSON.stringify(after.sort()) === JSON.stringify(before.sort()), `the check added nothing to the project (${after.join(', ')})`);

  const importCheck = runNode(['--input-type=module', '-e', `
    const core = await import('stable-viewport');
    const preflight = await import('stable-viewport/preflight');
    const probe = await import('stable-viewport/preflight-browser');
    const state = core.mountViewport({ designWidth: 1920 }).getState();
    const verdict = preflight.evaluatePreflight({ source: { viewportUnits: [], adaptableBreakpoints: 1, unsupportedBreakpoints: [], deviceBreakpoints: 0, containerQueries: 0, viewportReads: 0, closedShadowRoots: 0, rootZoomRules: 0, rootTransformRules: 0, fixedElements: 0, runtimeStyles: 0 } });
    console.log(JSON.stringify({ status: state.status, verdict: verdict.verdict, exports: Object.keys(probe).sort(), global: typeof globalThis.stableViewportCheck }));
  `], consumer);
  const imported = JSON.parse(importCheck.trim());
  check(imported.status === 'unsupported', 'SSR import is safe and reports unsupported (no document)');
  check(imported.verdict === 'ready', 'preflight rules run outside a browser');
  check(JSON.stringify(imported.exports) === JSON.stringify(['collectBrowserFacts', 'installConsoleCheck', 'printPreflight', 'runPreflight']), 'browser probe exports the documented API');
  check(imported.global === 'undefined', 'importing the probe installs no global');

  const manifest = JSON.parse(await readFile(join(consumer, 'node_modules', 'stable-viewport', 'package.json'), 'utf8'));
  check(!Object.keys(manifest.scripts ?? {}).some((name) => ['preinstall', 'install', 'postinstall', 'prepare'].includes(name)), 'no install hooks in the published manifest');

  const readme = await readFile(join(consumer, 'node_modules', 'stable-viewport', 'README.md'), 'utf8');
  check(readme.includes('Minimum conditions'), 'README ships the minimum-conditions contract');
} finally {
  await rm(workdir, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`\n${failures.length} packaging check(s) failed`);
  process.exitCode = 1;
} else {
  console.log('\npackaging checks passed');
}
