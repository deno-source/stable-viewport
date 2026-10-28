import { normalizeOptions, isMobile, type ViewportOptions, type ViewportState, type Diagnostic, type ViewportController, type NormalizedOptions } from './model';
import { startRuntime } from './runtime';
export type { ViewportOptions, ViewportState, Diagnostic, ViewportController } from './model';

interface Session { runtime:ReturnType<typeof startRuntime>; width:number; owners:Set<symbol>; diagnostics:Diagnostic[]; callbacks:Map<symbol,ViewportOptions['onDiagnostic']> }
// Bundled framework entries and multiple package copies share one browser registry.
const registryKey=Symbol.for('stable-viewport.sessions.v1');
function registry():WeakMap<Document,Session> {
  const host=globalThis as typeof globalThis & {[key:symbol]:WeakMap<Document,Session>|undefined};
  return host[registryKey] ??= new WeakMap<Document,Session>();
}

function acquire(document:Document, options:NormalizedOptions, owner:symbol):Session {
  let session=registry().get(document);
  if(session && session.width!==options.designWidth) throw new Error('Conflicting designWidth for the same document');
  if(!session){
    const diagnostics:Diagnostic[]=[];
    const callbacks=new Map<symbol,ViewportOptions['onDiagnostic']>([[owner,options.onDiagnostic]]);
    const runtime=startRuntime(document,options,value=>{
      diagnostics.push(value);
      for(const callback of callbacks.values()) callback?.(value);
    });
    session={runtime,width:options.designWidth,owners:new Set(),diagnostics,callbacks};registry().set(document,session);
  }
  session.owners.add(owner);session.callbacks.set(owner,options.onDiagnostic);
  return session;
}
function release(document:Document|undefined, session:Session|undefined, owner:symbol) {
  if(!document || !session) return;
  session.owners.delete(owner);session.callbacks.delete(owner);
  if(session.owners.size) return;
  session.runtime.destroy();registry().delete(document);
}
function availability(options:NormalizedOptions, document:Document|undefined):'disabled'|'unsupported'|undefined {
  if(!options.enabled) return 'disabled';
  const window=document?.defaultView;
  if(!window?.CSS?.supports('zoom','1')) return 'unsupported';
  if(!options.mobile && isMobile(window)) return 'disabled';
}
function hostConflict(document:Document):Diagnostic|undefined {
  const window=document.defaultView!;
  const root=window.getComputedStyle(document.documentElement);
  if(Number(root.zoom)!==1 && root.zoom!=='normal') return {code:'host-root-zoom',message:'Remove existing html zoom before enabling stable-viewport'};
  for(const element of [document.documentElement,document.body]) {
    if(element && window.getComputedStyle(element).transform!=='none') return {code:'host-root-transform',message:'html/body transforms change fixed containing blocks; remove them before enabling'};
  }
}

/** No side effects at import time. One independently disposable lease per call. */
export function mountViewport(input:ViewportOptions={}):ViewportController {
  let options=normalizeOptions(input);
  let document=options.document ?? globalThis.document;
  const owner=Symbol('stable-viewport-owner');
  let destroyed=false;
  let session:Session|undefined;
  let status:'disabled'|'unsupported'|undefined;
  let rejected:Diagnostic[]=[];
  function start() {
    status=availability(options,document);
    rejected=[];
    if(!status && document && !registry().has(document)) {
      const conflict=hostConflict(document);
      if(conflict){status='unsupported';rejected=[conflict];options.onDiagnostic?.(conflict);}
    }
    if(!status && document) session=acquire(document,options,owner);
  }
  start();
  // Hand a pre-hydration auto bootstrap lease to the first explicit controller.
  const bootstrapKey=Symbol.for('stable-viewport.auto.v1');
  const bootstrapWindow:(Window & {[bootstrapKey]?:ViewportController})|null|undefined=document?.defaultView;
  const bootstrap=bootstrapWindow?.[bootstrapKey];
  if(session && bootstrap && bootstrapWindow){bootstrap.destroy();delete bootstrapWindow[bootstrapKey];}
  return {
    refresh:()=>{if(!destroyed) session?.runtime.refresh();},
    getState:()=>({status:destroyed?'destroyed':status??'active',scale:session?.runtime.state().scale??1,designWidth:options.designWidth,diagnostics:session?.diagnostics.slice()??rejected.slice()}),
    update:patch=>{
      if(destroyed) throw new Error('Cannot update a destroyed viewport controller');
      const next=normalizeOptions({...options,...patch});
      const nextDocument=next.document ?? globalThis.document;
      const other=nextDocument && registry().get(nextDocument);
      const otherOwners=other ? other.owners.size-(other.owners.has(owner)?1:0):0;
      if(next.enabled && otherOwners>0 && other?.width!==next.designWidth) throw new Error('Conflicting designWidth for the same document');
      release(document,session,owner);session=undefined;options=next;document=nextDocument;start();
    },
    destroy:()=>{if(destroyed) return;destroyed=true;release(document,session,owner);session=undefined;},
  };
}
