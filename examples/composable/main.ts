import { createApp, defineComponent, h, ref, computed, effectScope, nextTick } from 'vue';
import { useStableViewport } from '../../src/vue';

const designWidth = ref(1920);
const mounted = ref(true);
const log: string[] = [];
const diagnostics: string[] = [];
const mode = new URLSearchParams(location.search).get('mode') ?? 'component';

const Inner = defineComponent({
  setup() {
    const controller = useStableViewport(() => ({ designWidth: designWidth.value, onDiagnostic: (value) => diagnostics.push(value.code) }));
    // Reading the ref in render proves the canvas width is reactive end to end.
    return () => h('div', { id: 'inner', 'data-width': String(designWidth.value) }, `width=${designWidth.value} controller=${controller.value?.getState().designWidth ?? 'none'}`);
  },
});

const app = createApp({
  setup() {
    return () => (mode === 'component' && mounted.value ? h(Inner) : h('div', { id: 'empty' }, 'unmounted'));
  },
});
app.mount('#app');

// Outside a component there is no setup() instance: the composable must start on
// its own and release through the effect scope.
const scope = effectScope();
let scoped: ReturnType<typeof useStableViewport> | null = null;
if (mode === 'scope') {
  scope.run(() => {
    scoped = useStableViewport(() => ({ designWidth: designWidth.value }));
  });
}

Object.assign(window, {
  lab: {
    designWidth,
    mounted,
    log,
    diagnostics,
    state: () => ({
      inner: document.querySelector('#inner')?.getAttribute('data-width') ?? null,
      zoom: document.documentElement.style.zoom,
      svw: document.documentElement.style.getPropertyValue('--sv-vw'),
      scoped: scoped?.value?.getState().designWidth ?? null,
    }),
    setWidth: async (value: number) => {
      designWidth.value = value;
      await nextTick();
      await new Promise((resolve) => setTimeout(resolve, 50));
    },
    toggle: async (value: boolean) => {
      mounted.value = value;
      await nextTick();
      await new Promise((resolve) => setTimeout(resolve, 50));
    },
    stop: () => {
      scope.stop();
      app.unmount();
    },
    computedWidth: computed(() => designWidth.value),
  },
});
