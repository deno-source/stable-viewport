import {test,expect,open,measure} from './fixtures';
test('open shadow styles, nested shadow roots and adopted stylesheets stay stable',async({lab,zoom})=>{
  await open(lab);await lab.evaluate(()=>{
    const host=document.createElement('div');host.id='shadow-host';document.body.prepend(host);
    const shadow=host.attachShadow({mode:'open'});shadow.innerHTML='<style>#shadow-probe{width:10vw;height:40px;background:blue}@media(max-width:900px){#shadow-probe{display:none}}</style><div id="shadow-probe"></div><div id="nested-host"></div>';
    const nested=shadow.querySelector('#nested-host')!.attachShadow({mode:'open'});nested.innerHTML='<div id="nested-probe"></div>';
    const sheet=new CSSStyleSheet();sheet.replaceSync('#nested-probe{width:15vw;height:20px}');nested.adoptedStyleSheets=[sheet];
  });
  await zoom(5);await expect(lab.locator('#shadow-probe')).toBeVisible();expect((await measure(lab,'#shadow-probe')).width).toBeCloseTo(192,0);expect((await measure(lab,'#nested-probe')).width).toBeCloseTo(288,0);
  await lab.locator('#unmount').click();expect(await lab.locator('#shadow-probe').evaluate(e=>getComputedStyle(e).display)).toBe('none');
});
test('already-closed shadow roots are explicitly a negative capability',async({lab,zoom})=>{
  await open(lab,'core',true);await lab.evaluate(()=>{
    const host=document.createElement('div');document.body.prepend(host);const closed=host.attachShadow({mode:'closed'});closed.innerHTML='<style>div{width:10vw;height:20px}</style><div></div>';Object.assign(window,{closedProbe:closed.querySelector('div')});
  });await lab.locator('#mount').click();await zoom(5);
  const width=await lab.evaluate(()=>(window as any).closedProbe.getBoundingClientRect().width*devicePixelRatio);
  expect(width).toBeLessThan(100); // README must not claim existing closed internals are inspected.
});
