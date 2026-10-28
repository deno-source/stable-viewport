import {test,expect,open,active,inactive,measure} from './fixtures';
for(const designWidth of [1440,1920,2560]) test(`design width ${designWidth}, mixed units and host breakpoints`,async({lab,zoom})=>{
  await open(lab,'core',true);await lab.evaluate(width=>(window as any).fixture.mount({designWidth:width}),designWidth);await active(lab);
  const baseline=await Promise.all(['#px','#rem','#mixed','#inline'].map(s=>measure(lab,s)));
  const visibility=await lab.evaluate(()=>['#bp640','#bp1024','#bp1440','#range'].map(s=>getComputedStyle(document.querySelector(s)!).display));
  await zoom(5);
  for(const [index,selector] of ['#px','#rem','#mixed','#inline'].entries()) expect(Math.abs((await measure(lab,selector)).width-baseline[index]!.width)).toBeLessThan(2);
  expect(await lab.evaluate(()=>['#bp640','#bp1024','#bp1440','#range'].map(s=>getComputedStyle(document.querySelector(s)!).display))).toEqual(visibility);
});
test('async style injection, nested media, complex values and viewport resize',async({lab,zoom})=>{
  await open(lab);await lab.evaluate(()=>{
    const style=document.createElement('style');style.textContent='@media (min-width:900px){@media (min-height:500px){#px{width:clamp(100px,calc(15vw + 2rem),400px)}}}';document.head.append(style);
  });
  const before=await measure(lab,'#px');await zoom(5);expect(Math.abs((await measure(lab,'#px')).width-before.width)).toBeLessThan(1);
  await lab.setViewportSize({width:1366,height:768});await zoom(1);const resized=await measure(lab,'#px');await zoom(5);expect(Math.abs((await measure(lab,'#px')).width-resized.width)).toBeLessThan(2);
});
test('custom element duplicate registration, conflict, invalid attributes and adoption',async({lab})=>{
  await open(lab,'wc');
  expect(await lab.evaluate(async()=>{const module=await import('/src/web-component.ts');const a=module.defineStableViewport();return a===module.defineStableViewport();})).toBe(true);
  await lab.evaluate(()=>{customElements.define('foreign-viewport',class extends HTMLElement{});});
  expect(await lab.evaluate(async()=>{try{(await import('/src/web-component.ts')).defineStableViewport('foreign-viewport');return false;}catch{return true;}})).toBe(true);
  await lab.evaluate(()=>{const e=document.querySelector('stable-viewport')!;e.addEventListener('stable-viewport-error',()=>Object.assign(window,{attributeError:true}));e.setAttribute('design-width','invalid');});
  expect(await lab.evaluate(()=>(window as any).attributeError)).toBe(true);await active(lab);
  await lab.evaluate(()=>document.querySelector('stable-viewport')!.setAttribute('design-width','1920'));
  await lab.evaluate(()=>{const iframe=document.createElement('iframe');iframe.id='adoption';document.body.append(iframe);const element=document.querySelector('stable-viewport')!;iframe.contentDocument!.body.append(iframe.contentDocument!.adoptNode(element));});
  await inactive(lab);
  expect(await lab.locator('#adoption').evaluate((frame:HTMLIFrameElement)=>frame.contentDocument!.documentElement.style.getPropertyValue('--sv-vw'))).toBe('19.2px');
});
test('native CSS media semantics are restored after unmount',async({lab,zoom})=>{
  await open(lab);await zoom(5);await expect(lab.locator('#bp640')).toBeVisible();await lab.locator('#unmount').click();await inactive(lab);await expect(lab.locator('#bp640')).toBeHidden();
});
