import { StyleChanges } from './changes';
import { installStyles } from './styles';
import { installMedia } from './media';
import { viewportMetrics, type Diagnostic, type NormalizedOptions, type ViewportState } from './model';

export function startRuntime(document: Document, options: NormalizedOptions, diagnostic:(value:Diagnostic)=>void) {
  const window=document.defaultView!;
  const root=document.documentElement;
  const changes=new StyleChanges();
  let printing=false;
  let stopped=false;
  let frame=0;
  let scale=window.innerWidth/options.designWidth;
  const getScale=()=>printing?1:window.innerWidth/options.designWidth;
  const styles=installStyles(document,window,getScale,diagnostic);
  const media=installMedia(window,getScale);
  const state=():ViewportState=>({status:stopped?'destroyed':'active',scale,designWidth:options.designWidth,diagnostics:[]});
  function update() {
    if(stopped) return;
    frame=0;
    const metrics=viewportMetrics(window.innerWidth,window.innerHeight,options.designWidth);
    scale=printing?1:metrics.scale;
    if(!Number.isFinite(scale) || scale<=0) return;
    changes.set(root.style,'zoom',String(scale));
    for(const unit of ['vw','vh','vmin','vmax'] as const) changes.set(root.style,`--sv-${unit}`,printing?`1${unit}`:`${metrics[unit]}px`);
    styles.refresh();media.refresh();
  }
  const resize=()=>{if(!frame) frame=window.requestAnimationFrame(update);};
  const beforePrint=()=>{printing=true;update();};
  const afterPrint=()=>{printing=false;update();};
  const ready=()=>update();
  window.addEventListener('resize',resize);
  window.addEventListener('pageshow',ready);
  window.addEventListener('beforeprint',beforePrint);
  window.addEventListener('afterprint',afterPrint);
  document.addEventListener('DOMContentLoaded',ready,{once:true});
  try{update();}catch(error){destroy();throw error;}
  function destroy() {
    if(stopped) return;
    stopped=true;window.cancelAnimationFrame(frame);
    window.removeEventListener('resize',resize);window.removeEventListener('pageshow',ready);
    window.removeEventListener('beforeprint',beforePrint);window.removeEventListener('afterprint',afterPrint);
    document.removeEventListener('DOMContentLoaded',ready);
    styles.destroy();changes.restore();media.destroy();
  }
  return {refresh:update,state,destroy};
}
