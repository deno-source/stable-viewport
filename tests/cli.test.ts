import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const CLI = join(process.cwd(), 'scripts', 'check.mjs');

interface Run {
  code: number;
  stdout: string;
}

function run(arguments_: string[]): Run {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...arguments_], { encoding: 'utf8' });
    return { code: 0, stdout };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string };
    return { code: failure.status ?? -1, stdout: failure.stdout ?? '' };
  }
}

describe('stable-viewport-check CLI', () => {
  it('reports a clean consumer project as ready', () => {
    const { code, stdout } = run(['--root', 'fixtures/clean-project', '--json']);
    const report = JSON.parse(stdout);
    expect(code).toBe(0);
    expect(report.verdict).toBe('ready');
    expect(report.scannedFiles).toBeGreaterThan(2);
    expect(report.findings.some((finding: { code: string }) => finding.code === 'breakpoints')).toBe(true);
    const container = report.findings.find((finding: { code: string }) => finding.code === 'container-queries');
    expect(container.level).toBe('info');
  });

  it('blocks a hostile project and names the files that write root rules', () => {
    const { code, stdout } = run(['--root', 'fixtures/hostile-project']);
    expect(code).toBe(2);
    expect(stdout).toContain('BLOCKED');
    expect(stdout).toContain('root zoom/transform');
    expect(stdout).toContain('legacy.css');
    // 60ch / 40lh breakpoints stay native and must be reported honestly.
    expect(stdout).toContain('ch');
    expect(stdout).toContain('lh');
    // closed shadow roots in source
    expect(stdout).toContain('attachShadow');
  });

  it('returns 1 for warnings under --strict and 0 without it', () => {
    expect(run(['--root', 'fixtures/hostile-project', '--strict']).code).toBe(2);
    const warningsOnly = run(['--root', 'fixtures/clean-project', '--strict', '--json']);
    const report = JSON.parse(warningsOnly.stdout);
    if (report.verdict === 'ready') expect(warningsOnly.code).toBe(0);
    else expect(warningsOnly.code).toBe(1);
  });

  it('excludes directories on request and sorts units deterministically', () => {
    const withSource = run(['--root', 'fixtures/clean-project', '--json']);
    const withoutSource = run(['--root', 'fixtures/clean-project', '--exclude', 'src/', '--json']);
    const a = JSON.parse(withSource.stdout);
    const b = JSON.parse(withoutSource.stdout);
    expect(b.scannedFiles).toBeLessThan(a.scannedFiles);
    expect(a.source.viewportUnits).toEqual([...a.source.viewportUnits].sort());
    expect(b.source.viewportUnits.length).toBeGreaterThan(0);
  });

  it('rejects bad arguments instead of guessing', () => {
    expect(run(['--nope']).code).toBe(3);
    expect(run(['--design-width', '0']).code).toBe(3);
    expect(run(['--root', 'does-not-exist']).code).toBe(3);
  });

  it('prints usage for --help', () => {
    const { code, stdout } = run(['--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('stable-viewport-check');
    expect(stdout).toContain('Exit codes');
  });

  it('keeps the static verdict when the runtime probe cannot reach the page', () => {
    const { code, stdout } = run(['--root', 'fixtures/clean-project', '--url', 'http://127.0.0.1:9/never', '--json']);
    const report = JSON.parse(stdout);
    expect(report.url).toBe('http://127.0.0.1:9/never');
    expect(report.runtimeProbeError).toBeTruthy();
    expect(report.verdict).toBe('ready');
    expect(code).toBe(0);
  });
});
