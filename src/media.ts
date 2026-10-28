import { transformMedia } from './transforms';
type BrowserWindow = Window & typeof globalThis;
type Listener = EventListenerOrEventListenerObject;
interface Entry { listener: Listener; capture: boolean; wrapped: EventListener; signal?: AbortSignal; abort: () => void }

function invoke(listener: Listener, target: EventTarget, event: Event) {
  if (typeof listener === 'function') listener.call(target,event);
  else listener.handleEvent(event);
}
/** Owns matchMedia interception, not the caller's subscriptions to returned lists. */
export function installMedia(window: BrowserWindow, getScale: () => number) {
  const original = window.matchMedia;
  const native = original.bind(window);
  const refreshers = new Set<() => void>();
  let active = true;
  const current = (query: string) => native(active ? transformMedia(query,getScale()) : query);

  function createList(query: string): MediaQueryList {
    const target = new window.EventTarget() as MediaQueryList;
    Object.setPrototypeOf(target,window.MediaQueryList.prototype);
    const add = window.EventTarget.prototype.addEventListener;
    const remove = window.EventTarget.prototype.removeEventListener;
    const entries: Entry[]=[];
    let source: MediaQueryList | undefined;
    let handler: MediaQueryList['onchange']=null;
    let previous=current(query).matches;
    const notify=()=>{
      const matches=current(query).matches;
      if(matches===previous) return;
      previous=matches;
      target.dispatchEvent(new window.MediaQueryListEvent('change',{matches,media:query}));
    };
    const refresh=()=>{
      source?.removeEventListener('change',notify);
      source=current(query);
      source.addEventListener('change',notify);
      notify();
    };
    const subscribe=()=>{
      if(entries.length || handler) {
        if(!source){previous=current(query).matches;refresh();}
        if(active) refreshers.add(refresh);
      } else {
        source?.removeEventListener('change',notify);source=undefined;refreshers.delete(refresh);
      }
    };
    Object.defineProperties(target,{
      matches:{get:()=>current(query).matches},media:{get:()=>query},
      onchange:{get:()=>handler,set:(value: MediaQueryList['onchange'])=>{handler=typeof value==='function'?value:null;subscribe();}},
    });
    add.call(target,'change',event=>handler?.call(target,event as MediaQueryListEvent));
    target.addEventListener=(type:string,listener: Listener|null,options?:boolean|AddEventListenerOptions)=>{
      if(type!=='change' || !listener){add.call(target,type,listener,options);return;}
      const capture=typeof options==='boolean'?options:!!options?.capture;
      const settings=typeof options==='object'?options:undefined;
      if(settings?.signal?.aborted || entries.some(entry=>entry.listener===listener && entry.capture===capture)) return;
      const wrapped: EventListener=event=>{
        if(settings?.once) target.removeEventListener(type,listener,options);
        invoke(listener,target,event);
      };
      const entry: Entry={listener,capture,wrapped,signal:settings?.signal,abort:()=>target.removeEventListener(type,listener,options)};
      entries.push(entry);add.call(target,type,wrapped,options);
      entry.signal?.addEventListener('abort',entry.abort,{once:true});subscribe();
    };
    target.removeEventListener=(type:string,listener: Listener|null,options?:boolean|EventListenerOptions)=>{
      const capture=typeof options==='boolean'?options:!!options?.capture;
      const index=type==='change'?entries.findIndex(entry=>entry.listener===listener && entry.capture===capture):-1;
      const entry=entries[index];
      if(!entry){remove.call(target,type,listener,options);return;}
      remove.call(target,type,entry.wrapped,capture);entry.signal?.removeEventListener('abort',entry.abort);
      entries.splice(index,1);subscribe();
    };
    target.addListener=callback=>{if(callback) target.addEventListener('change',callback);};
    target.removeListener=callback=>{if(callback) target.removeEventListener('change',callback);};
    return target;
  }
  const wrapped: typeof window.matchMedia=query=>{
    const canonical=native(query).media;
    return active && transformMedia(canonical,2)!==canonical?createList(canonical):native(query);
  };
  window.matchMedia=wrapped;
  return {
    refresh:()=>{for(const refresh of refreshers) refresh();},
    destroy:()=>{
      active=false;
      if(window.matchMedia===wrapped) window.matchMedia=original;
      // Existing application-held MQLs remain useful with native semantics.
      for(const refresh of refreshers) refresh();
      refreshers.clear();
    },
  };
}
