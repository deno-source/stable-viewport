import { mountViewport, type ViewportController, type ViewportOptions } from '../../src/index';
import { StableViewport as ReactViewport } from '../../dist/react.js';
import { StableViewport as VueViewport } from '../../dist/vue.js';
import { defineStableViewport } from '../../dist/web-component.js';
import React from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {createApp,h,ref,KeepAlive,defineComponent, type App} from 'vue';

let controller:ViewportController|undefined, second:ViewportController|undefined, react:Root|undefined, vue:App|undefined, element:HTMLElement|undefined;
const host=document.querySelector('#framework')!;
const mode=new URLSearchParams(location.search).get('mode')??'core';
const vueEnabled=ref(true),vueWidth=ref(1920),vueVisible=ref(true);
const listeners:unknown[]=[];
function unmount(){controller?.destroy();controller=undefined;react?.unmount();react=undefined;vue?.unmount();vue=undefined;element?.remove();element=undefined;}
function mount(options:ViewportOptions={}){
  unmount();
  if(mode==='react'){react=createRoot(host);react.render(<React.StrictMode><ReactViewport {...options}><div id="adapter-ready">React Strict Mode</div></ReactViewport></React.StrictMode>);}
  else if(mode==='vue'){
    vueWidth.value=options.designWidth??1920;vueEnabled.value=options.enabled??true;
    const Inner=defineComponent({setup:()=>()=>h(VueViewport,{designWidth:vueWidth.value,enabled:vueEnabled.value},()=>h('div',{id:'adapter-ready'},'Vue 3'))});
    vue=createApp({setup:()=>()=>h(KeepAlive,()=>vueVisible.value?h(Inner):null)});vue.mount(host);
  }else if(mode==='wc'){
    defineStableViewport();element=document.createElement('stable-viewport');element.setAttribute('design-width',String(options.designWidth??1920));
    if(options.enabled===false) element.setAttribute('disabled','');element.innerHTML='<div id="adapter-ready">Native custom element</div>';host.append(element);
  }else controller=mountViewport({...options,onDiagnostic:value=>listeners.push(value)});
}
function modal(){document.querySelector('#portal')?.remove();const portal=document.createElement('div');portal.id='portal';portal.innerHTML='<div id="dialog"><h2>Body-mounted modal</h2><p>Outside the framework wrapper.</p><input id="modal-input" placeholder="Type here"><div style="height:40vh">Viewport height content</div></div>';document.body.append(portal);}
Object.assign(window,{fixture:{mount,unmount,mode,diagnostics:listeners,state:()=>controller?.getState(),update:(options:ViewportOptions)=>controller?.update(options),addOwner:()=>{second=mountViewport();},releaseOwner:()=>{second?.destroy();second=undefined;},vueEnabled,vueWidth,vueVisible}});
document.querySelector('#mount')!.addEventListener('click',()=>mount());document.querySelector('#unmount')!.addEventListener('click',unmount);
document.querySelector('#open-modal')!.addEventListener('click',modal);document.querySelector('#close-modal')!.addEventListener('click',()=>document.querySelector('#portal')?.remove());
document.querySelector('#second')!.addEventListener('click',()=>{second=mountViewport();});document.querySelector('#release-second')!.addEventListener('click',()=>{second?.destroy();second=undefined;});
if(!new URLSearchParams(location.search).has('manual')) mount();
