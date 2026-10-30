import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';

/** SSR safety: import and render on the server, with no `window`/`document` at all. */
describe('server rendering', () => {
  it('imports every entry point without browser globals', () => {
    const script = `
      await import('./dist/index.js');
      await import('./dist/react.js');
      await import('./dist/vue.js');
      await import('./dist/web-component.js');
      await import('./dist/preflight.js');
      await import('./dist/preflight-browser.js');
      const { mountViewport } = await import('./dist/index.js');
      if (mountViewport().getState().status !== 'unsupported') throw new Error('SSR must not install');
      console.log('ok');
    `;
    expect(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }).trim()).toBe('ok');
  });

  it('supports CommonJS require in a server process', () => {
    const script = "require('./dist/index.cjs');require('./dist/react.cjs');require('./dist/vue.cjs');require('./dist/web-component.cjs');require('./dist/preflight.cjs');console.log('ok')";
    expect(execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' }).trim()).toBe('ok');
  });

  it('renders the React component on the server without a DOM', () => {
    const script = `
      const { createElement } = await import('react');
      const { renderToString } = await import('react-dom/server');
      const { StableViewport } = await import('./dist/react.js');
      const html = renderToString(createElement(StableViewport, { designWidth: 1920 }, createElement('main', null, 'server')));
      if (!html.includes('<main>server</main>')) throw new Error('children were not rendered: ' + html);
      if (html.includes('<div')) throw new Error('the wrapper must not add a box: ' + html);
      console.log('ok');
    `;
    expect(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }).trim()).toBe('ok');
  });

  it('renders the Vue component on the server and marks no client-only assumptions', () => {
    const script = `
      const { createSSRApp, h } = await import('vue');
      const { renderToString } = await import('vue/server-renderer');
      const { StableViewport } = await import('./dist/vue.js');
      const app = createSSRApp({ render: () => h(StableViewport, { designWidth: 1920 }, () => h('main', null, 'server')) });
      const html = await renderToString(app);
      if (!html.includes('<main>server</main>')) throw new Error('children were not rendered: ' + html);
      if (html.includes('<div')) throw new Error('the wrapper must not add a box: ' + html);
      console.log('ok');
    `;
    expect(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }).trim()).toBe('ok');
  });

  it('evaluates preflight rules on the server', () => {
    const script = `
      const { evaluatePreflight, formatPreflight } = await import('./dist/preflight.js');
      const verdict = evaluatePreflight({ source: { viewportUnits: ['vw'], adaptableBreakpoints: 3, unsupportedBreakpoints: [], deviceBreakpoints: 0, containerQueries: 0, viewportReads: 0, closedShadowRoots: 0, rootZoomRules: 0, rootTransformRules: 0, fixedElements: 0, runtimeStyles: 0 }, project: { nodeVersion: '20.0.0' } });
      if (verdict.verdict !== 'blocked') throw new Error('Node 20 must be blocked');
      if (!formatPreflight(verdict).includes('BLOCKED')) throw new Error('report missing');
      console.log('ok');
    `;
    expect(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }).trim()).toBe('ok');
  });
});
