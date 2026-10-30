import { mountViewport, type ViewportController, type ViewportState } from './index';

export interface StableViewportElement extends HTMLElement {
  designWidth: number;
  disabled: boolean;
  refresh(): void;
  getState(): ViewportState | undefined;
}

type BrowserWindow = Window & typeof globalThis;
type ElementConstructor = CustomElementConstructor & { stableViewportVersion?: number };

const VERSION = 1;
const DEFAULT_WIDTH = 1920;

/** An absent/empty attribute means the default; a malformed one stays NaN so it fails loudly. */
function parseDesignWidth(value: string | null): number {
  if (value === null || value.trim() === '') return DEFAULT_WIDTH;
  return Number(value);
}

/**
 * Explicit registration keeps SSR imports side-effect free. The host keeps
 * Light DOM (`display: contents`) so existing selectors, events and aria
 * relationships are untouched; it is a lifecycle owner, not a layout box.
 */
export function defineStableViewport(tagName = 'stable-viewport', window: BrowserWindow = globalThis.window): CustomElementConstructor {
  if (!window?.customElements) throw new Error('Custom elements require a browser window');
  const existing = window.customElements.get(tagName) as ElementConstructor | undefined;
  if (existing) {
    if (existing.stableViewportVersion === VERSION) return existing;
    throw new Error(`Custom element name already registered: ${tagName}`);
  }

  class Element extends window.HTMLElement implements StableViewportElement {
    static readonly stableViewportVersion = VERSION;
    static get observedAttributes() {
      return ['design-width', 'disabled'];
    }

    private controller?: ViewportController;
    private boundDocument?: Document;
    /** Set only when this component actually wrote `display`. */
    private displayBefore?: { value: string; priority: string };

    get designWidth(): number {
      return parseDesignWidth(this.getAttribute('design-width'));
    }

    set designWidth(value: number) {
      this.setAttribute('design-width', String(value));
    }

    get disabled(): boolean {
      return this.hasAttribute('disabled');
    }

    set disabled(value: boolean) {
      this.toggleAttribute('disabled', value);
    }

    refresh() {
      this.controller?.refresh();
    }

    getState() {
      return this.controller?.getState();
    }

    connectedCallback() {
      this.sync();
    }

    disconnectedCallback() {
      // Deferred so a same-task move (append elsewhere) keeps one lease.
      const defer = typeof window.queueMicrotask === 'function'
        ? window.queueMicrotask.bind(window)
        : (callback: () => void) => void window.setTimeout(callback, 0);
      defer(() => {
        if (!this.isConnected) this.dispose();
      });
    }

    adoptedCallback() {
      this.sync();
    }

    attributeChangedCallback() {
      this.sync();
    }

    private options() {
      return {
        designWidth: this.designWidth,
        enabled: !this.disabled,
        document: this.ownerDocument,
        onDiagnostic: (detail: unknown) => this.emit('stable-viewport-diagnostic', detail),
      };
    }

    private emit(name: string, detail: unknown) {
      this.dispatchEvent(new window.CustomEvent(name, { detail, bubbles: true, composed: true }));
    }

    private sync() {
      if (!this.isConnected) return;
      // An invalid design-width must not tear down a working lease; the error
      // event tells the page, and the previous canvas stays in place.
      // Adopted into another document: the old document's lease must be
      // released before the new one is taken, never both at once.
      if (this.controller && this.boundDocument !== this.ownerDocument) this.dispose();
      try {
        if (this.controller) {
          this.controller.update(this.options());
          return;
        }
        this.controller = mountViewport(this.options());
        this.boundDocument = this.ownerDocument;
        this.hideBox();
      } catch (error) {
        this.emit('stable-viewport-error', error);
      }
    }

    private hideBox() {
      // Already content-less: nothing was written, so teardown must not touch it.
      if (this.style.getPropertyValue('display') === 'contents') return;
      this.displayBefore = {
        value: this.style.getPropertyValue('display'),
        priority: this.style.getPropertyPriority('display'),
      };
      this.style.setProperty('display', 'contents');
    }

    private dispose() {
      this.controller?.destroy();
      this.controller = undefined;
      this.boundDocument = undefined;
      const before = this.displayBefore;
      this.displayBefore = undefined;
      // Only a value still written by us is restored; a later host value wins.
      if (!before) return;
      if (this.style.getPropertyValue('display') !== 'contents' || this.style.getPropertyPriority('display') !== '') return;
      if (before.value) this.style.setProperty('display', before.value, before.priority);
      else this.style.removeProperty('display');
    }
  }

  window.customElements.define(tagName, Element);
  return Element;
}
