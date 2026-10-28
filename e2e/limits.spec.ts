import {test,expect,open,inactive,measure} from './fixtures';

test('pre-existing root zoom fails closed rather than overwriting host scaling',async({lab})=>{
  await open(lab,'core',true);await lab.evaluate(()=>document.documentElement.style.zoom='1.2');await lab.locator('#mount').click();
  expect(await lab.evaluate(()=>(window as any).fixture.state().status)).toBe('unsupported');
  expect(await lab.evaluate(()=>document.documentElement.style.zoom)).toBe('1.2');
  expect(await lab.evaluate(()=>(window as any).fixture.diagnostics.some((d:any)=>d.code==='host-root-zoom'))).toBe(true);
});
test('transformed body is diagnosed and does not change existing UI',async({lab})=>{
  await open(lab,'core',true);await lab.evaluate(()=>document.body.style.transform='translateX(10px)');await lab.locator('#mount').click();
  expect(await lab.evaluate(()=>(window as any).fixture.state().status)).toBe('unsupported');await inactive(lab);
});
test('opaque cross-origin stylesheets are diagnosed without bypassing access controls',async({lab})=>{
  await open(lab);await lab.evaluate(()=>{const link=document.createElement('link');link.rel='stylesheet';link.href='http://localhost:4379/examples/playground/foreign.css';document.head.append(link);});
  await expect.poll(()=>lab.evaluate(()=>(window as any).fixture.diagnostics.some((d:any)=>d.code==='opaque-stylesheet'))).toBe(true);
});
test('direct innerWidth-driven business JS is outside automatic adaptation',async({lab,zoom})=>{
  await open(lab);await lab.evaluate(()=>{
    const update=()=>document.querySelector<HTMLElement>('#px')!.style.width=innerWidth/2+'px';
    addEventListener('resize',update);update();
  });
  const before=await measure(lab,'#px');await zoom(5);const after=await measure(lab,'#px');
  // Explicit negative capability test: changing application decisions cannot be undone by CSS.
  expect(after.width).toBeLessThan(before.width/2);
});
test('mobile detection disables adaptation by default',async({browser})=>{
  const page=await browser.newPage({viewport:{width:390,height:844},userAgent:'Mozilla/5.0 iPhone Mobile Safari/604.1'});
  await open(page,'core',true);await page.locator('#mount').click();expect(await page.evaluate(()=>(window as any).fixture.state().status)).toBe('disabled');await page.close();
});
