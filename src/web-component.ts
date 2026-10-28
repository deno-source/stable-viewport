import { mountViewport, type ViewportController } from './index';
export interface StableViewportElement extends HTMLElement {
  designWidth:number;disabled:boolean;refresh():void;getState():ReturnType<ViewportController['getState']>|undefined;
}
type ElementConstructor=CustomElementConstructor & {stableViewportVersion?:number};
/** Explicit registration makes importing this entry safe on servers. */
export function defineStableViewport(tagName='stable-viewport',window:Window & typeof globalThis=globalThis.window):CustomElementConstructor {
  if(!window?.customElements) throw new Error('Custom elements require a browser window');
  const existing=window.customElements.get(tagName) as ElementConstructor|undefined;
  if(existing){if(existing.stableViewportVersion===1) return existing;throw new Error(`Custom element name already registered: ${tagName}`);}
  class Element extends window.HTMLElement implements StableViewportElement {
    static stableViewportVersion=1;
    static observedAttributes=['design-width','disabled'];
    private controller?:ViewportController;
    private boundDocument?:Document;
    private display?:string;
    get designWidth(){return this.hasAttribute('design-width')?Number(this.getAttribute('design-width')):1920;}
    set designWidth(value:number){this.setAttribute('design-width',String(value));}
    get disabled(){return this.hasAttribute('disabled');}
    set disabled(value:boolean){this.toggleAttribute('disabled',value);}
    private options(){return {designWidth:this.designWidth,enabled:!this.disabled,document:this.ownerDocument,onDiagnostic:(detail:unknown)=>this.dispatchEvent(new window.CustomEvent('stable-viewport-diagnostic',{detail,bubbles:true,composed:true}))};}
    private sync() {
      if(!this.isConnected) return;
      try{
        if(this.controller && this.boundDocument!==this.ownerDocument) this.dispose();
        if(this.controller) this.controller.update(this.options());
        else {this.controller=mountViewport(this.options());this.boundDocument=this.ownerDocument;this.display=this.style.display;this.style.display='contents';}
      }catch(error){this.dispatchEvent(new window.CustomEvent('stable-viewport-error',{detail:error,bubbles:true,composed:true}));}
    }
    connectedCallback(){this.sync();}
    attributeChangedCallback(){this.sync();}
    disconnectedCallback(){queueMicrotask(()=>{if(!this.isConnected) this.dispose();});}
    adoptedCallback(){this.sync();}
    private dispose(){this.controller?.destroy();this.controller=undefined;if(this.style.display==='contents') this.style.display=this.display??'';}
    refresh(){this.controller?.refresh();}
    getState(){return this.controller?.getState();}
  }
  window.customElements.define(tagName,Element);
  return Element;
}
