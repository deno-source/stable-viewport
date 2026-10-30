import { test, expect } from './fixtures';

type Report = {
  verdict: 'ready' | 'ready-with-caveats' | 'blocked';
  summary: { errors: number; warnings: number; infos: number; passes: number };
  findings: { code: string; level: string; title: string }[];
};

async function preflight(page: import('@playwright/test').Page, setup?: () => Promise<void>, path = '/examples/clean/'): Promise<Report> {
  await page.goto(path);
  if (setup) await setup();
  return page.evaluate(async () => {
    const module = await import('/src/preflight-browser.ts');
    return module.runPreflight({ designWidth: 1920 }) as unknown as Report;
  });
}

test('browser preflight passes a minimum-condition page and never mutates it', async ({ page }) => {
  const before = await page.goto('/examples/clean/').then(() => page.evaluate(() => document.documentElement.getAttribute('style')));
  const report = await preflight(page);
  const after = await page.evaluate(() => document.documentElement.getAttribute('style'));
  expect(after).toBe(before);
  expect(report.verdict).toBe('ready');
  expect(report.summary.errors).toBe(0);
  const codes = report.findings.map((finding) => finding.code);
  for (const code of ['css-zoom', 'root-zoom', 'root-transform', 'media-units', 'container-queries', 'opaque-stylesheets', 'iframes', 'scrollbar']) {
    expect(codes, code).toContain(code);
  }
});

test('browser preflight blocks a page whose root is already zoomed or transformed', async ({ page }) => {
  const report = await preflight(page, async () => {
    await page.evaluate(() => {
      document.documentElement.style.zoom = '1.1';
      document.body.style.transform = 'translateX(4px)';
    });
  });
  expect(report.verdict).toBe('blocked');
  const failing = report.findings.filter((finding) => finding.level === 'error').map((finding) => finding.code);
  expect(failing).toContain('root-zoom');
  expect(failing).toContain('root-transform');
});

test('browser preflight reports relative breakpoint units, opaque sheets and iframes as caveats', async ({ page }) => {
  const report = await preflight(page, async () => {
    await page.evaluate(() => {
      const style = document.createElement('style');
      style.textContent = '@media (min-width: 60ch) { body { color: red } } @container (max-width: 200px) { body { color: blue } }';
      document.head.append(style);
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'http://localhost:4379/examples/playground/foreign.css';
      document.head.append(link);
      const frame = document.createElement('iframe');
      document.body.append(frame);
    });
    await page.waitForTimeout(500);
  });
  expect(report.verdict).toBe('ready-with-caveats');
  const byCode = Object.fromEntries(report.findings.map((finding) => [finding.code, finding.level]));
  expect(byCode['media-units']).toBe('warn');
  expect(byCode['container-queries']).toBe('info');
  expect(byCode['opaque-stylesheets']).toBe('warn');
  expect(byCode['iframes']).toBe('warn');
});

test('the browser check is side-effect free until it is explicitly installed', async ({ page }) => {
  await page.goto('/examples/clean/');
  const result = await page.evaluate(async () => {
    // Ignore instrumentation/DevTools globals (__coverage__, __vite__…).
    const stable = () => Object.keys(window).filter((key) => !key.startsWith('__')).length;
    const globalsBefore = stable();
    const checkBefore = typeof window.stableViewportCheck;
    const module = await import('/src/preflight-browser.ts');
    const afterImport = stable();
    const installed = module.installConsoleCheck();
    const afterInstall = typeof window.stableViewportCheck;
    const verdict = window.stableViewportCheck?.({ designWidth: 1920 })?.verdict;
    installed();
    const afterUninstall = typeof window.stableViewportCheck;
    return { globalsBefore, checkBefore, afterImport, afterInstall, verdict, afterUninstall, exports: Object.keys(module).sort() };
  });
  // Importing must not add a global; only installConsoleCheck() does.
  expect(result.checkBefore).toBe('undefined');
  expect(result.afterImport).toBe(result.globalsBefore);
  expect(result.afterInstall).toBe('function');
  expect(result.verdict).toBe('ready');
  expect(result.afterUninstall).toBe('undefined');
  expect(result.exports).toEqual(['collectBrowserFacts', 'installConsoleCheck', 'printPreflight', 'runPreflight']);
});

test('no diagnostic runs on its own: a plain page load never reports anything', async ({ page }) => {
  const messages: string[] = [];
  page.on('console', (message) => messages.push(message.text()));
  await page.goto('/examples/clean/');
  await page.waitForTimeout(300);
  expect(messages.filter((text) => text.includes('stable-viewport'))).toEqual([]);
  expect(await page.evaluate(() => typeof window.stableViewportCheck)).toBe('undefined');
});

test('the component keeps a clean page ready, and the check still reports caveats for a hostile page', async ({ page }) => {
  await page.goto('/examples/compat/?mode=core');
  await page.waitForTimeout(300);
  // The compat fixture deliberately includes a cross-origin sheet and ch/vw breakpoints.
  const hostile = await page.evaluate(async () => {
    const module = await import('/src/preflight-browser.ts');
    return module.runPreflight({ designWidth: 1920 }) as unknown as Report;
  });
  expect(hostile.verdict).toBe('ready-with-caveats');
  expect(hostile.summary.errors).toBe(0);
  const levels = Object.fromEntries(hostile.findings.map((finding) => [finding.code, finding.level]));
  expect(levels['opaque-stylesheets']).toBe('warn');
  expect(levels['media-units']).toBe('warn');
  expect(levels['container-queries']).toBe('info');

  await page.goto('/examples/clean/');
  const clean = await preflight(page);
  expect(clean.verdict).toBe('ready');
});
