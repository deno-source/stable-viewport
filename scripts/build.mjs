import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdir, copyFile } from 'node:fs/promises';
for(const name of ['index','react','next','vue','web-component']) {
  for(const format of ['esm','cjs']) await build({entryPoints:[`src/${name}.${['react','next'].includes(name)?'tsx':'ts'}`],outfile:`dist/${name}.${format==='esm'?'js':'cjs'}`,bundle:true,format,platform:'neutral',mainFields:['module','main'],target:'es2022',external:['react','react-dom','vue','next/script'],sourcemap:true,banner:['react','next'].includes(name)?{js:"'use client';"}:undefined});
}
await build({entryPoints:['src/auto.ts'],outfile:'dist/auto.js',bundle:true,format:'iife',platform:'browser',target:'es2022',minify:true,sourcemap:true});
execFileSync(process.execPath,['node_modules/typescript/bin/tsc','--emitDeclarationOnly'],{stdio:'inherit'});
await mkdir('examples/next/public',{recursive:true});
await copyFile('dist/auto.js','examples/next/public/stable-viewport.auto.js');
