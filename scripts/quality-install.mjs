#!/usr/bin/env node
/**
 * Installs the ub-mode quality tools (unclebob/crapper, unclebob/dryer,
 * unclebob/mutator) into .tools/venv. They are Python packages, not npm
 * packages, so this is a one-time developer setup step, not an install hook.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const TOOLS = ['crapper', 'dryer', 'mutator'];
const venv = join('.tools', 'venv');
const python = process.platform === 'win32' ? join(venv, 'Scripts', 'python.exe') : join(venv, 'bin', 'python');

function run(command, args, cwd) {
  console.log(`$ ${command} ${args.join(' ')}`);
  execFileSync(command, args, { cwd, stdio: 'inherit' });
}

if (!existsSync(python)) {
  await mkdir('.tools', { recursive: true });
  const launcher = process.platform === 'win32' ? ['py', ['-3']] : ['python3', []];
  run(launcher[0], [...launcher[1], '-m', 'venv', venv]);
}

for (const name of TOOLS) {
  const source = join('.tools', 'src', name);
  if (!existsSync(source)) {
    await mkdir(join('.tools', 'src'), { recursive: true });
    run('git', ['clone', '--depth', '1', `https://github.com/unclebob/${name}`, source]);
  }
  run(python, ['-m', 'pip', 'install', '--quiet', '-e', source]);
}

console.log('\nquality tools installed:');
for (const name of TOOLS) console.log(`  ${join(venv, process.platform === 'win32' ? 'Scripts' : 'bin', name)}`);
