import {it,expect} from 'vitest';
import {execFileSync} from 'node:child_process';
it('ESM and CommonJS imports are browser-global safe and framework-independent',()=>{
  const esm="await import('./dist/index.js'); await import('./dist/react.js'); await import('./dist/vue.js'); await import('./dist/web-component.js'); const {mountViewport}=await import('./dist/index.js'); if(mountViewport().getState().status!=='unsupported') throw Error('SSR state'); console.log('ok')";
  expect(execFileSync(process.execPath,['--input-type=module','-e',esm],{encoding:'utf8'}).trim()).toBe('ok');
  expect(execFileSync(process.execPath,['-e',"require('./dist/index.cjs'); require('./dist/react.cjs');require('./dist/vue.cjs');require('./dist/web-component.cjs');console.log('ok')"],{encoding:'utf8'}).trim()).toBe('ok');
});
