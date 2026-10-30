import { defineConfig } from 'vite';
import istanbul from 'vite-plugin-istanbul';

/**
 * The dev server is also the E2E target. Instrumentation is opt-in so normal
 * development keeps the original module bodies.
 */
export default defineConfig({
  // Vue's esm-bundler build expects these compile-time flags. Explicit values
  // keep the Options API (consumers may rely on it) and silence the warning.
  define: {
    __VUE_OPTIONS_API__: 'true',
    __VUE_PROD_DEVTOOLS__: 'false',
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
  },
  plugins: process.env.SV_COVERAGE
    ? [istanbul({ include: ['src/**/*.{ts,tsx}'], exclude: ['**/*.d.ts'], extension: ['.ts', '.tsx'], requireEnv: false, cwd: process.cwd() })]
    : [],
  server: { host: '127.0.0.1', port: 4379, strictPort: true },
  build: { target: 'es2022' },
});
