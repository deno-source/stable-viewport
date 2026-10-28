import {test,expect,open,active,inactive,measure} from './fixtures';

for(const mode of ['core','react','vue','wc']) test.describe(mode,()=>{
  test('hardcoded px, mixed units, unrelated breakpoints and icons survive real zoom',async({lab,zoom})=>{
    await open(lab,mode);
    const selectors=['#px','#rem','#vw','#mixed','#svg','#image','#font-icon','#inline'];
    const baseline=await Promise.all(selectors.map(s=>measure(lab,s)));
    for(const value of [0.25,0.67,1.25,2,3,5,1]){
      await zoom(value);
      for(const [i,selector] of selectors.entries()){
        const actual=await measure(lab,selector);
        expect(Math.abs(actual.width-baseline[i]!.width),`${mode} ${value} ${selector}`).toBeLessThan(2);
        expect(Math.abs(actual.height-baseline[i]!.height)).toBeLessThan(2);
      }
      for(const selector of ['#bp640','#bp1024','#bp1440','#range']) await expect(lab.locator(selector)).toBeVisible();
      expect(await lab.evaluate(()=>matchMedia('(max-width: 1440px)').matches)).toBe(false);
    }
  });
  test('body portals, fixed controls and inputs stay usable at 500%',async({lab,zoom})=>{
    await open(lab,mode);await lab.locator('#open-modal').click();const before=await measure(lab,'#dialog');
    await zoom(5);const after=await measure(lab,'#dialog');expect(Math.abs(after.width-before.width)).toBeLessThan(1);
    expect(Math.abs(after.x-before.x)).toBeLessThan(1);
    await lab.locator('#modal-input').fill('500 percent works');await expect(lab.locator('#modal-input')).toHaveValue('500 percent works');
    await lab.evaluate(()=>document.querySelector('#portal')?.remove());
    const fixed=await measure(lab,'#fixed');expect(Math.abs(fixed.y+fixed.height-1060)).toBeLessThan(2);
  });
  test('last unmount restores styles, native APIs and allows remount',async({lab,zoom})=>{
    await open(lab,mode,true);
    await lab.evaluate(()=>Object.assign(window,{before:{media:window.matchMedia,insert:CSSStyleSheet.prototype.insertRule,root:document.documentElement.style.cssText,inline:document.querySelector<HTMLElement>('#inline')!.style.width}}));
    await lab.locator('#mount').click();await active(lab);await zoom(5);await lab.locator('#unmount').click();await inactive(lab);
    expect(await lab.evaluate(()=>{const b=(window as any).before;return window.matchMedia===b.media && CSSStyleSheet.prototype.insertRule===b.insert && document.querySelector<HTMLElement>('#inline')!.style.width===b.inline;})).toBe(true);
    await lab.locator('#mount').click();await active(lab);expect((await measure(lab,'#px')).width).toBeCloseTo(120,0);
  });
});
