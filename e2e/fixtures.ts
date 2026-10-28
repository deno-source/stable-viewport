import {test as base,expect,chromium,type Page,type BrowserContext} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
interface NativeBrowser {context:BrowserContext;settings:Page}
export const test=base.extend<{lab:Page;zoom:(value:number)=>Promise<void>},{native:NativeBrowser}>({
  native:[async({},use)=>{
    const prefix=resolve(join(tmpdir(),'stable-viewport-'));
    const profile=await mkdtemp(prefix);
    const context=await chromium.launchPersistentContext(profile,{channel:'chrome',headless:true,viewport:{width:1920,height:1080}});
    const settings=await context.newPage();await settings.goto('chrome://settings/appearance');
    try{await use({context,settings});}finally{await context.close();if(!resolve(profile).startsWith(prefix)) throw new Error('Unsafe profile cleanup path');await rm(profile,{recursive:true,force:true});}
  },{scope:'worker'}],
  lab:async({native},use)=>{
    await native.settings.evaluate(()=>new Promise<void>(resolve=>chrome.settingsPrivate.setDefaultZoom(1,resolve)));
    const page=await native.context.newPage();await use(page);await page.close();
  },
  zoom:async({native,lab},use)=>{
    await use(async value=>{
      await native.settings.evaluate(value=>new Promise<void>(resolve=>chrome.settingsPrivate.setDefaultZoom(value,resolve)),value);
      await lab.waitForFunction(value=>Math.abs(devicePixelRatio-value)<0.02,value);
      await lab.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
    });
  },
});
export {expect};
export async function open(page:Page,mode='core',manual=false){await page.goto(`/examples/playground/?mode=${mode}${manual?'&manual':''}`);await expect(page.locator('#mount')).toBeVisible();if(!manual) await active(page);}
export async function active(page:Page){await expect.poll(()=>page.evaluate(()=>document.documentElement.style.getPropertyValue('--sv-vw'))).not.toBe('');}
export async function inactive(page:Page){await expect.poll(()=>page.evaluate(()=>document.documentElement.style.getPropertyValue('--sv-vw'))).toBe('');}
export async function measure(page:Page,selector:string){return page.locator(selector).evaluate(e=>{const r=e.getBoundingClientRect();return {width:r.width*devicePixelRatio,height:r.height*devicePixelRatio,x:r.x*devicePixelRatio,y:r.y*devicePixelRatio};});}

declare global {const chrome:{settingsPrivate:{setDefaultZoom(value:number,callback:()=>void):void}};}
