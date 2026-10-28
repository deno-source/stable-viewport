import { defineComponent, h, Fragment, onMounted, onUnmounted, onActivated, onDeactivated, shallowRef, watch, type PropType } from 'vue';
import { mountViewport, type ViewportOptions, type ViewportController, type Diagnostic } from './index';

export function useStableViewport(options:ViewportOptions|(()=>ViewportOptions)={}) {
  const controller=shallowRef<ViewportController|null>(null);
  const read=()=>typeof options==='function'?options():options;
  let mounted=false;
  const start=()=>{mounted=true;if(!controller.value) controller.value=mountViewport(read());};
  const stop=()=>{mounted=false;controller.value?.destroy();controller.value=null;};
  onMounted(start);onActivated(start);onDeactivated(stop);onUnmounted(stop);
  watch(()=>({...read()}),value=>{if(mounted) controller.value?.update(value);});
  return controller;
}
export const StableViewport=defineComponent({
  name:'StableViewport',inheritAttrs:false,
  props:{designWidth:{type:Number,default:1920},enabled:{type:Boolean,default:true},mobile:{type:Boolean,default:false},onDiagnostic:Function as PropType<(value:Diagnostic)=>void>},
  setup(props,{slots}) {
    useStableViewport(()=>({designWidth:props.designWidth,enabled:props.enabled,mobile:props.mobile,onDiagnostic:props.onDiagnostic}));
    return ()=>h(Fragment,slots.default?.());
  },
});
