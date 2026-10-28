import { StyleChanges } from './changes';
import { transformMedia, transformValue } from './transforms';
import type { Diagnostic } from './model';
type BrowserWindow = Window & typeof globalThis;
interface MediaChange { before: string; written: string }

export function installStyles(document: Document, window: BrowserWindow, getScale:()=>number, diagnostic:(value:Diagnostic)=>void) {
  const changes=new StyleChanges();
  const media=new Map<CSSMediaRule,MediaChange>();
  const opaque=new WeakSet<CSSStyleSheet>();
  const shadows=new Map<ShadowRoot,MutationObserver>();
  const frames=new WeakSet<Element>();
  let active=true;
  const adaptStyle=(style:CSSStyleDeclaration)=>{
    if(!active || style===document.documentElement.style) return;
    for(const property of Array.from(style)) {
      if(changes.owns(style,property)) continue;
      const value=style.getPropertyValue(property);
      const result=transformValue(value);
      if(result!==value) changes.set(style,property,result,style.getPropertyPriority(property));
    }
  };
  const adaptMedia=(rule:CSSMediaRule)=>{
    const value=rule.media.mediaText;
    const previous=media.get(rule);
    const before=previous?.written===value?previous.before:value;
    const result=transformMedia(before,getScale());
    if(result!==value) rule.media.mediaText=result;
    media.set(rule,{before,written:rule.media.mediaText});
  };
  function visit(rules: CSSRuleList | CSSRule[]) {
    for(const rule of Array.from(rules)) {
      if(rule instanceof window.CSSMediaRule) adaptMedia(rule);
      if('style' in rule) adaptStyle((rule as CSSStyleRule).style);
      if('cssRules' in rule) visit((rule as CSSGroupingRule).cssRules);
      if(rule instanceof window.CSSImportRule && rule.styleSheet) adaptSheet(rule.styleSheet);
    }
  }
  function adaptSheet(sheet:CSSStyleSheet|null) {
    if(!sheet || !active) return;
    try{visit(sheet.cssRules);}catch(error){
      if(!(error instanceof window.DOMException) || error.name!=='SecurityError') throw error;
      if(!opaque.has(sheet)){opaque.add(sheet);diagnostic({code:'opaque-stylesheet',message:`Cannot inspect cross-origin stylesheet: ${sheet.href ?? 'unknown'}`});}
    }
  }
  const scan=(node:Node)=>{
    if(!(node instanceof window.Element)) return;
    if(node instanceof window.HTMLStyleElement || node instanceof window.HTMLLinkElement) adaptSheet(node.sheet);
    if(node instanceof window.HTMLElement || node instanceof window.SVGElement) adaptStyle(node.style);
    for(const element of node.querySelectorAll('style,link[rel="stylesheet"],[style]')) {
      if(element instanceof window.HTMLStyleElement || element instanceof window.HTMLLinkElement) adaptSheet(element.sheet);
      if(element instanceof window.HTMLElement || element instanceof window.SVGElement) adaptStyle(element.style);
    }
    for(const element of [node,...node.querySelectorAll('*')]) {
      if(element.shadowRoot) watchShadow(element.shadowRoot);
      if(element instanceof window.HTMLIFrameElement && !frames.has(element)) {
        frames.add(element);diagnostic({code:'iframe-document',message:'An iframe needs a separate controller in its own document; cross-origin internals cannot be inspected'});
      }
    }
  };
  const observeOptions:MutationObserverInit={childList:true,subtree:true,attributes:true,attributeFilter:['style']};
  const processMutations:MutationCallback=records=>{
    for(const record of records) {
      if(record.type==='attributes'){const element=record.target;if(element instanceof window.HTMLElement || element instanceof window.SVGElement) adaptStyle(element.style);}
      else {if(record.target instanceof window.HTMLStyleElement) adaptSheet(record.target.sheet);for(const node of record.addedNodes) scan(node);}
    }
  };
  function watchShadow(root:ShadowRoot) {
    if(!shadows.has(root)) {
      const observer=new window.MutationObserver(processMutations);observer.observe(root,observeOptions);shadows.set(root,observer);
      root.addEventListener('load',load,true);
    }
    for(const sheet of root.adoptedStyleSheets) adaptSheet(sheet);
    for(const child of root.children) scan(child);
  }
  const observer=new window.MutationObserver(processMutations);
  const load=(event:Event)=>{if(event.target instanceof window.HTMLLinkElement) adaptSheet(event.target.sheet);};
  const prototype=window.CSSStyleSheet.prototype;
  const insert=prototype.insertRule;
  const replace=prototype.replace;
  const replaceSync=prototype.replaceSync;
  const wrappedInsert: typeof insert=function(this:CSSStyleSheet,...args){const index=Reflect.apply(insert,this,args);if(active) visit([this.cssRules[index]!]);return index;};
  const wrappedReplace: typeof replace=function(this:CSSStyleSheet,...args){return Reflect.apply(replace,this,args).then((sheet:CSSStyleSheet)=>{adaptSheet(sheet);return sheet;});};
  const wrappedSync: typeof replaceSync=function(this:CSSStyleSheet,...args){Reflect.apply(replaceSync,this,args);adaptSheet(this);};
  prototype.insertRule=wrappedInsert;
  if(typeof replace==='function') prototype.replace=wrappedReplace;
  if(typeof replaceSync==='function') prototype.replaceSync=wrappedSync;
  observer.observe(document.documentElement,observeOptions);
  document.addEventListener('load',load,true);
  const refresh=()=>{
    for(const sheet of document.styleSheets) adaptSheet(sheet);
    for(const sheet of document.adoptedStyleSheets) adaptSheet(sheet);
    for(const [rule] of media) {
      if(rule.parentStyleSheet?.ownerNode && !rule.parentStyleSheet.ownerNode.isConnected) media.delete(rule);
      else adaptMedia(rule);
    }
    if(document.body) scan(document.body);
    for(const [root,observer] of shadows) if(!root.host.isConnected){observer.disconnect();root.removeEventListener('load',load,true);shadows.delete(root);}
  };
  return {refresh,destroy:()=>{
    active=false;observer.disconnect();document.removeEventListener('load',load,true);
    for(const [root,observer] of shadows){observer.disconnect();root.removeEventListener('load',load,true);}shadows.clear();
    if(prototype.insertRule===wrappedInsert) prototype.insertRule=insert;
    if(prototype.replace===wrappedReplace) prototype.replace=replace;
    if(prototype.replaceSync===wrappedSync) prototype.replaceSync=replaceSync;
    for(const [rule,entry] of media) if(rule.media.mediaText===entry.written) rule.media.mediaText=entry.before;
    media.clear();changes.restore();
  }};
}
