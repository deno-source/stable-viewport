import { defineComponent, h, Fragment, getCurrentInstance, onMounted, onUnmounted, onActivated, onDeactivated, onScopeDispose, shallowRef, watch, type PropType, type ShallowRef } from 'vue';
import { mountViewport, type ViewportOptions, type ViewportController, type Diagnostic } from './index';

type OptionsSource = ViewportOptions | (() => ViewportOptions);

/**
 * One lease per mounted component. `onActivated`/`onDeactivated` make KeepAlive
 * behave like mount/unmount, and SSR never touches browser globals because
 * mounting only happens in `onMounted`.
 *
 * Outside a component (a store, a plugin, a plain `effectScope`) there are no
 * lifecycle hooks to attach: the lease starts immediately and is released by
 * `onScopeDispose` or by calling `destroy()` on `controller.value`.
 */
export function useStableViewport(options: OptionsSource = {}): ShallowRef<ViewportController | null> {
  const controller = shallowRef<ViewportController | null>(null);
  const read = () => (typeof options === 'function' ? options() : options);
  let mounted = false;

  const start = () => {
    mounted = true;
    if (!controller.value) controller.value = mountViewport(read());
  };
  const stop = () => {
    mounted = false;
    controller.value?.destroy();
    controller.value = null;
  };
  const apply = (value: ViewportOptions) => {
    if (!mounted || !controller.value) return;
    try {
      controller.value.update(value);
    } catch (error) {
      // A rejected reactive update must not break the render: report it instead.
      const onDiagnostic = read().onDiagnostic;
      onDiagnostic?.({ code: 'update-rejected', message: (error as Error).message });
    }
  };

  const bindLifecycle = (insideComponent: boolean) => {
    if (!insideComponent) {
      start();
      onScopeDispose(stop);
      return;
    }
    onMounted(start);
    onActivated(start);
    onDeactivated(stop);
    onUnmounted(stop);
  };
  bindLifecycle(getCurrentInstance() !== null);
  watch(() => ({ ...read() }), apply);
  return controller;
}

export const StableViewport = defineComponent({
  name: 'StableViewport',
  inheritAttrs: false,
  props: {
    designWidth: { type: Number, default: 1920 },
    enabled: { type: Boolean, default: true },
    mobile: { type: Boolean, default: false },
    onDiagnostic: Function as PropType<(value: Diagnostic) => void>,
  },
  setup(props, { slots }) {
    useStableViewport(() => ({
      designWidth: props.designWidth,
      enabled: props.enabled,
      mobile: props.mobile,
      onDiagnostic: props.onDiagnostic,
    }));
    return () => h(Fragment, slots.default?.());
  },
});
