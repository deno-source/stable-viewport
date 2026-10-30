#!/usr/bin/env node
/**
 * ub-mode quality gates, using unclebob's crapper / dryer / mutator.
 *
 *   node scripts/quality.mjs crap    CRAP = CC² × (1 − coverage)³ + CC, with coverage
 *                                    merged from unit + real-browser runs
 *   node scripts/quality.mjs dry     structural duplication (threshold 0.82)
 *   node scripts/quality.mjs mutate  mutation testing
 *
 * The tools live in .tools/venv (installed by `node scripts/quality.mjs install`).
 * They are Python packages cloned from github.com/unclebob/{crapper,dryer,mutator};
 * they are not npm packages, so they cannot be devDependencies.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const BIN = join('.tools', 'venv', process.platform === 'win32' ? 'Scripts' : 'bin');
const tool = (name) => join(BIN, process.platform === 'win32' ? `${name}.exe` : name);
const command = process.argv[2] ?? 'crap';

function ensure(name) {
  if (existsSync(tool(name))) return;
  console.error(`quality: ${name} is not installed. Run: node scripts/quality.mjs install`);
  process.exit(3);
}

function run(name, args) {
  ensure(name);
  try {
    const output = execFileSync(tool(name), args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
    process.stdout.write(output);
    return 0;
  } catch (error) {
    if (typeof error.stdout === 'string') process.stdout.write(error.stdout);
    return typeof error.status === 'number' ? error.status : 1;
  }
}

if (command === 'install') {
  execFileSync(process.platform === 'win32' ? 'node' : 'node', ['scripts/quality-install.mjs'], { stdio: 'inherit' });
  process.exit(0);
}

if (command === 'crap') {
  if (!existsSync(join('coverage', 'lcov.info'))) {
    console.error('quality: run `npm run coverage` first (it produces coverage/lcov.info)');
    process.exit(3);
  }
  process.exit(run('crapper', ['--use-existing-coverage', '--threshold', process.env.SV_CRAP_THRESHOLD ?? '35', 'src']));
}

if (command === 'dry') {
  process.exit(run('dryer', ['--threshold', '0.8', 'src']));
}

if (command === 'mutate') {
  const files = process.argv.slice(3);
  const targets = files.length ? files : ['src/transforms.ts', 'src/capability.ts'];
  process.exit(run('mutator', ['--no-coverage', '--max-workers', '2', '--test-command', 'npx vitest run', ...targets]));
}

console.error(`quality: unknown command "${command}" (use crap | dry | mutate | install)`);
process.exit(3);
