/**
 * Converts the coverage objects Playwright collected during the E2E run into an
 * LCOV report that crapper can consume, so CRAP scores come from real browser
 * executions rather than guesses.
 *
 * Two corrections are required:
 *   1. vite-plugin-istanbul reports positions in the *transpiled* module, so the
 *      coverage is remapped through the recorded `inputSourceMap` back to the
 *      TypeScript source before it is turned into LCOV.
 *   2. LCOV paths are normalised to forward slashes; crapper is POSIX-first.
 *
 * Unit-test coverage (vitest) is merged in as well, because a browser suite can
 * never exercise the pure decision functions on their own.
 */
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createCoverageMap } from '@vitest/istanbul-lib-coverage';
import { createContext } from '@vitest/istanbul-lib-report';
import { create as createReport } from 'istanbul-reports';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';

const input = '.nyc_output';

/** Maps generated positions back to the original TypeScript positions. */
function remap(fileCoverage) {
  const map = fileCoverage.inputSourceMap;
  if (!map?.mappings || !map.sources?.length) return fileCoverage;
  let tracer;
  try {
    tracer = new TraceMap(map);
  } catch {
    return fileCoverage;
  }
  const at = (position) => {
    if (!position) return position;
    try {
      const original = originalPositionFor(tracer, { line: position.line, column: position.column });
      return original.line == null ? position : { line: original.line, column: original.column ?? 0 };
    } catch {
      return position;
    }
  };
  const span = (location) => (location ? { start: at(location.start), end: at(location.end) } : location);
  const statements = {};
  for (const [key, statement] of Object.entries(fileCoverage.statementMap ?? {})) statements[key] = span(statement);
  const functions = {};
  for (const [key, entry] of Object.entries(fileCoverage.fnMap ?? {})) {
    functions[key] = { ...entry, decl: span(entry.decl), loc: span(entry.loc) };
  }
  const branches = {};
  for (const [key, entry] of Object.entries(fileCoverage.branchMap ?? {})) {
    branches[key] = { ...entry, loc: span(entry.loc), locations: (entry.locations ?? []).map(span) };
  }
  return { ...fileCoverage, path: resolve(fileCoverage.path), statementMap: statements, fnMap: functions, branchMap: branches };
}

if (!existsSync(input)) {
  console.error('coverage-e2e: no .nyc_output directory; run `npm run test:e2e:coverage` first');
  process.exit(2);
}

const map = createCoverageMap({});
const parts = (await readdir(input)).filter((name) => name.endsWith('.json'));
for (const part of parts) {
  const raw = JSON.parse(await readFile(join(input, part), 'utf8'));
  for (const coverage of Object.values(raw)) map.addFileCoverage(remap(coverage));
}

// Unit-test coverage is authoritative for pure logic; merge it with the browser run.
const unitJson = join('coverage-unit', 'coverage-final.json');
if (existsSync(unitJson)) map.merge(JSON.parse(await readFile(unitJson, 'utf8')));

// Keep only the library sources; fixtures, examples and node_modules are not the product.
const filtered = createCoverageMap({});
for (const file of map.files()) {
  const normalized = file.replaceAll(String.fromCharCode(92), '/');
  if (!/(^|\/)src\//.test(normalized) || normalized.includes('node_modules')) continue;
  const coverage = map.fileCoverageFor(file).toJSON();
  filtered.addFileCoverage({ ...coverage, path: `src/${normalized.split('/src/').pop()}` });
}

await mkdir('coverage', { recursive: true });
const context = createContext({ dir: 'coverage', coverageMap: filtered, defaultSummarizer: 'nested' });
createReport('lcov', { projectRoot: process.cwd() }).execute(context);
createReport('text-summary').execute(context);

const summary = filtered.getCoverageSummary();
await writeFile(join('coverage', 'summary.json'), JSON.stringify({ files: filtered.files().length, ...summary.toJSON() }, null, 2));
console.log(`coverage-e2e: merged ${parts.length} browser part(s)${existsSync(unitJson) ? ' + unit coverage' : ''} into ${filtered.files().length} source file(s)`);
