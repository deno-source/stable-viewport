/**
 * Same suite, instrumented. The dev server runs with SV_COVERAGE so Vite adds
 * Istanbul counters; the fixtures then export `window.__coverage__` per worker
 * into .nyc_output, and `npm run coverage:e2e` turns that into LCOV for crapper.
 */
process.env.SV_COVERAGE = '1';

import base from './playwright.config';

const config = {
  ...base,
  webServer: (base.webServer as { command: string; url: string; reuseExistingServer: boolean; timeout: number }[]).map((server) => ({
    ...server,
    env: { ...process.env, SV_COVERAGE: '1' },
  })),
};

export default config;
