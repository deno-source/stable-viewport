import {test,expect,open,active,inactive,measure} from './fixtures';

test('leases across independently bundled adapters do not double scale',async({lab,zoom})=>{
  await open(lab,'react');await lab.locator('#second').click();await zoom(5);
  expect((await measure(lab,'#px')).width).toBeCloseTo(120,0);
  await lab.locator('#unmount').click();await active(lab);await lab.locator('#release-second').click();await inactive(lab);
});
test('invalid options and conflicting owners leave the existing session unchanged',async({lab})=>{
  await open(lab);await lab.locator('#second').click();
  for(const options of [{designWidth:0},{designWidth:-1},{designWidth:1440}]){
    expect(await lab.evaluate(options=>{try{(window as any).fixture.update(options);return false;}catch{return true;}},options)).toBe(true);
    expect(await lab.evaluate(()=>(window as any).fixture.state().designWidth)).toBe(1920);
  }
});
test('later application styles and browser hooks survive destruction',async({lab})=>{
  await open(lab);await lab.evaluate(()=>{
    document.documentElement.style.zoom='1.3';
    document.documentElement.style.setProperty('--app-color','purple');
    document.querySelector<HTMLElement>('#inline')!.style.width='77px';
    const previous=window.matchMedia;window.matchMedia=query=>previous(query);
    (window as any).laterMedia=window.matchMedia;
  });
  await lab.locator('#unmount').click();await inactive(lab);
  expect(await lab.evaluate(()=>({zoom:document.documentElement.style.zoom,color:document.documentElement.style.getPropertyValue('--app-color'),inline:document.querySelector<HTMLElement>('#inline')!.style.width,hook:window.matchMedia===(window as any).laterMedia}))).toEqual({zoom:'1.3',color:'purple',inline:'77px',hook:true});
});
test('CSSOM insertion, replacement, inline updates and exact restoration',async({lab,zoom})=>{
  await open(lab);await lab.evaluate(()=>{
    const style=document.createElement('style');style.id='dynamic-sheet';document.head.append(style);
    style.sheet!.insertRule('#px{width:15vw !important}');
    const sheet=new CSSStyleSheet();sheet.replaceSync('#rem{width:10vw}');document.adoptedStyleSheets=[sheet];
    document.querySelector<HTMLElement>('#inline')!.style.width='18vw';
  });
  await zoom(5);
  expect((await measure(lab,'#px')).width).toBeCloseTo(288,0);
  expect((await measure(lab,'#rem')).width).toBeCloseTo(192,0);
  expect((await measure(lab,'#inline')).width).toBeCloseTo(345.6,0);
  await lab.locator('#unmount').click();await inactive(lab);
  expect(await lab.evaluate(()=>document.querySelector<HTMLStyleElement>('#dynamic-sheet')!.sheet!.cssRules[0]!.cssText)).toContain('15vw');
});
test('media event contracts include once, abort, removal, and native behavior after destruction',async({lab})=>{
  await open(lab);await lab.evaluate(()=>{
    const query=matchMedia('(min-height:800px)');const abort=new AbortController();const state={normal:0,once:0,aborted:0,legacy:0};
    query.addEventListener('change',()=>state.normal++);query.addEventListener('change',()=>state.once++,{once:true});
    query.addEventListener('change',()=>state.aborted++,{signal:abort.signal});abort.abort();query.addListener(()=>state.legacy++);
    Object.assign(window,{events:state,query});
  });
  await lab.setViewportSize({width:1920,height:600});await expect.poll(()=>lab.evaluate(()=>(window as any).events.normal)).toBe(1);
  await lab.setViewportSize({width:1920,height:1080});await expect.poll(()=>lab.evaluate(()=>(window as any).events.normal)).toBe(2);
  expect(await lab.evaluate(()=>(window as any).events)).toEqual({normal:2,once:1,aborted:0,legacy:2});
  await lab.locator('#unmount').click();await lab.setViewportSize({width:1920,height:600});await expect.poll(()=>lab.evaluate(()=>(window as any).events.normal)).toBe(3);
});
test('Vue reactive props and KeepAlive deactivate and reactivate without leaks',async({lab})=>{
  await open(lab,'vue');await lab.evaluate(()=>(window as any).fixture.vueEnabled.value=false);await inactive(lab);
  await lab.evaluate(()=>(window as any).fixture.vueEnabled.value=true);await active(lab);
  await lab.evaluate(()=>(window as any).fixture.vueWidth.value=1440);await expect.poll(()=>lab.evaluate(()=>document.documentElement.style.getPropertyValue('--sv-vw'))).toBe('14.4px');
  await lab.evaluate(()=>(window as any).fixture.vueVisible.value=false);await inactive(lab);
  await lab.evaluate(()=>(window as any).fixture.vueVisible.value=true);await active(lab);
});
test('custom element attributes, movement, removal, and reattachment',async({lab,zoom})=>{
  await open(lab,'wc');await lab.evaluate(()=>document.querySelector('stable-viewport')!.setAttribute('disabled','false'));await inactive(lab);
  await lab.evaluate(()=>document.querySelector('stable-viewport')!.removeAttribute('disabled'));await active(lab);
  await lab.evaluate(()=>document.body.append(document.querySelector('stable-viewport')!));await active(lab);
  await zoom(5);expect((await measure(lab,'#px')).width).toBeCloseTo(120,0);
  await lab.evaluate(()=>{const element=document.querySelector('stable-viewport')!;(window as any).savedElement=element;element.remove();});await inactive(lab);
  await lab.evaluate(()=>document.body.append((window as any).savedElement));await active(lab);
});
test('printing restores screen scaling and reduced-motion is left native',async({lab,zoom})=>{
  await open(lab);await zoom(5);await lab.evaluate(()=>dispatchEvent(new Event('beforeprint')));
  expect(await lab.evaluate(()=>document.documentElement.style.zoom)).toBe('1');
  await lab.evaluate(()=>dispatchEvent(new Event('afterprint')));expect(await lab.evaluate(()=>document.documentElement.style.zoom)).toBe('0.2');
  await lab.emulateMedia({reducedMotion:'reduce'});expect(await lab.evaluate(()=>matchMedia('(prefers-reduced-motion:reduce)').matches)).toBe(true);
});
