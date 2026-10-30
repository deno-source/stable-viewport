import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdir, copyFile, readFile, rm, writeFile } from 'node:fs/promises';

const ENTRIES = {
  index: 'ts',
  react: 'tsx',
  next: 'tsx',
  vue: 'ts',
  'web-component': 'ts',
  preflight: 'ts',
  'preflight-browser': 'ts',
};

const EXTERNAL = ['react', 'react-dom', 'next/script', 'vue', 'react/jsx-runtime'];

// Chunk names are content-hashed; a stale chunk from an earlier build would
// otherwise linger in the published dist directory.
await rm('dist', { recursive: true, force: true });
const CLIENT_ENTRIES = ['react', 'next'];

// ESM: one build with a shared core chunk instead of seven copies. Splitting is
// ESM-only, so CJS keeps per-entry bundles below.
await build({
  entryPoints: Object.entries(ENTRIES).map(([name, extension]) => ({ in: `src/${name}.${extension}`, out: name })),
  outdir: 'dist',
  entryNames: '[name]',
  chunkNames: 'chunks/[name]-[hash]',
  bundle: true,
  format: 'esm',
  splitting: true,
  platform: 'neutral',
  mainFields: ['module', 'main'],
  target: 'es2022',
  external: EXTERNAL,
  sourcemap: true,
});

// `use client` marks an entry boundary only; a shared chunk must stay usable by
// server components, so the directive is prepended to the client entries alone.
for (const name of CLIENT_ENTRIES) {
  const file = `dist/${name}.js`;
  const text = await readFile(file, 'utf8');
  if (!text.startsWith("'use client'")) await writeFile(file, `'use client';\n${text}`);
}

for (const [name, extension] of Object.entries(ENTRIES)) {
  await build({
    entryPoints: [`src/${name}.${extension}`],
    outfile: `dist/${name}.cjs`,
    bundle: true,
    format: 'cjs',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    target: 'es2022',
    external: EXTERNAL,
    sourcemap: true,
    banner: CLIENT_ENTRIES.includes(name) ? { js: "'use client';" } : undefined,
  });
}

await build({
  entryPoints: ['src/auto.ts'],
  outfile: 'dist/auto.js',
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  sourcemap: true,
});

execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '--emitDeclarationOnly'], { stdio: 'inherit' });

await mkdir('examples/next/public', { recursive: true });
await copyFile('dist/auto.js', 'examples/next/public/stable-viewport.auto.js');
