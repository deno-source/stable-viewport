import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const CLI = join(process.cwd(), 'scripts', 'check.mjs');

/** Exit code 2 (blocked) is a normal verdict, not a failure to run. */
function check(arguments_: string[]): string {
  try {
    return execFileSync(process.execPath, [CLI, ...arguments_], { encoding: 'utf8' });
  } catch (error) {
    const failure = error as { status?: number; stdout?: string };
    expect([1, 2]).toContain(failure.status);
    return failure.stdout ?? '';
  }
}

async function fingerprint(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        await walk(full);
        continue;
      }
      const info = await stat(full);
      const hash = createHash('sha1').update(await readFile(full)).digest('hex');
      out[full.replaceAll(process.cwd(), '')] = `${info.size}:${hash}:${info.mtimeMs}`;
    }
  };
  await walk(root);
  return out;
}

describe('the self check never touches the project', () => {
  it('leaves every file byte-identical after a static run', async () => {
    const before = await fingerprint('fixtures/hostile-project');
    const report = check(['--root', 'fixtures/hostile-project', '--json']);
    expect(JSON.parse(report).verdict).toBe('blocked');
    const after = await fingerprint('fixtures/hostile-project');
    expect(after).toEqual(before);
  });

  it('adds no files and no dot-directories anywhere in the scanned tree', async () => {
    const entries = await readdir('fixtures/hostile-project');
    check(['--root', 'fixtures/hostile-project', '--quiet']);
    expect(await readdir('fixtures/hostile-project')).toEqual(entries);
  });
});

describe('the package installs no hooks', () => {
  it('declares no pre/post install or prepare scripts', async () => {
    const manifest = JSON.parse(await readFile('package.json', 'utf8'));
    const scripts = Object.keys(manifest.scripts ?? {});
    for (const hook of ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish']) {
      expect(scripts, hook).not.toContain(hook);
    }
  });

  it('marks only the browser bootstrap entry as side-effectful', async () => {
    const manifest = JSON.parse(await readFile('package.json', 'utf8'));
    expect(manifest.sideEffects).toEqual(['./dist/auto.js']);
    expect(manifest.bin['stable-viewport-check']).toBe('./scripts/check.mjs');
  });

  it('does not import the checker, the component or the browser probe from the main entry', async () => {
    const source = await readFile('src/index.ts', 'utf8');
    expect(source).not.toMatch(/preflight|check\.mjs|console\.(log|info|warn)/);
  });
});
