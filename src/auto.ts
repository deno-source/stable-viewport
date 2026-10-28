import { mountViewport, type ViewportController } from './index';
const script=document.currentScript;
const width=script?.getAttribute('data-design-width');
const key=Symbol.for('stable-viewport.auto.v1');
const host:Window & {[key]?:ViewportController}=window;
// The first explicit framework controller takes over this pre-hydration lease.
if(!host[key]) host[key]=mountViewport({designWidth:width===null || width===undefined?1920:Number(width)});
Object.defineProperty(window,'StableViewportAuto',{value:{getState:()=>host[key]?.getState(),destroy:()=>{host[key]?.destroy();delete host[key];}},configurable:true});
