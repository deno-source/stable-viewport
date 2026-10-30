import { mountViewport, type ViewportController, type ViewportOptions } from '../../src/index';
import { StableViewport } from '../../src/react.tsx';
import { defineStableViewport } from '../../src/web-component.ts';
import { createRoot, type Root } from 'react-dom/client';
import React from 'react';

type Mode = 'core' | 'react' | 'wc' | 'auto' | 'none';

const params = new URLSearchParams(location.search);
const mode = (params.get('mode') ?? 'core') as Mode;
const host = document.querySelector('#framework')!;
let controller: ViewportController | undefined;
let extra: ViewportController | undefined;
let react: Root | undefined;
const diagnostics: unknown[] = [];

function unmount() {
  controller?.destroy();
  controller = undefined;
  react?.unmount();
  react = undefined;
  document.querySelector('stable-viewport')?.remove();
}

function mount(options: ViewportOptions = {}) {
  unmount();
  if (mode === 'react') {
    react = createRoot(host);
    react.render(React.createElement(React.StrictMode, null, React.createElement(StableViewport, options, React.createElement('div', { id: 'adapter-ready' }, 'react'))));
    return;
  }
  if (mode === 'wc') {
    defineStableViewport();
    const element = document.createElement('stable-viewport');
    element.setAttribute('design-width', String(options.designWidth ?? 1920));
    if (options.enabled === false) element.setAttribute('disabled', '');
    element.innerHTML = '<div id="adapter-ready">custom element</div>';
    element.addEventListener('stable-viewport-diagnostic', (event) => diagnostics.push((event as CustomEvent).detail));
    host.append(element);
    return;
  }
  if (mode === 'auto') return; // the auto script mounted itself
  if (mode === 'none') return;
  controller = mountViewport({ ...options, onDiagnostic: (value) => diagnostics.push(value) });
}

document.querySelector('#mount')!.addEventListener('click', () => mount());
document.querySelector('#unmount')!.addEventListener('click', unmount);
document.querySelector('#add-owner')!.addEventListener('click', () => { extra = mountViewport(); });
document.querySelector('#drop-owner')!.addEventListener('click', () => { extra?.destroy(); extra = undefined; });
document.querySelector('#open-modal')!.addEventListener('click', () => {
  document.querySelector('#portal')?.remove();
  const portal = document.createElement('div');
  portal.id = 'portal';
  portal.innerHTML = '<div id="dialog"><h2>Body-mounted dialog</h2><label for="modal-input">input</label><input id="modal-input"><button id="modal-close">close</button><div style="height:30vh">tall content</div></div>';
  document.body.append(portal);
  portal.querySelector('#modal-close')!.addEventListener('click', () => portal.remove());
});
document.querySelector('#inject-style')!.addEventListener('click', () => {
  const style = document.createElement('style');
  style.id = 'injected';
  style.textContent = '@media (min-width:1500px){#p-safe{display:block;background:#7c3aed;height:10px}} #p-injected{width:12vw;height:20px;background:#334155}';
  document.head.append(style);
  const probe = document.createElement('div');
  probe.id = 'p-injected';
  document.querySelector('main')!.append(probe);
});
document.querySelector('#adopt-sheet')!.addEventListener('click', () => {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync('#p-adopted{width:14vw;height:18px;background:#065f46} @media (max-width:1200px){#p-adopted{background:#7f1d1d}}');
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  const probe = document.createElement('div');
  probe.id = 'p-adopted';
  document.querySelector('main')!.append(probe);
});
document.querySelector('#late-shadow')!.addEventListener('click', () => {
  const root = document.querySelector('#shadow-host')!;
  if (root.shadowRoot) return;
  const shadow = root.attachShadow({ mode: 'open' });
  shadow.innerHTML = '<style>#inner{width:11vw;height:22px;background:#be123c}@media (max-width:1100px){#inner{height:33px}}</style><div id="inner"></div>';
});

// Closed shadow root, set up before any controller exists (negative capability).
const closedHost = document.createElement('div');
closedHost.id = 'closed-host';
document.body.append(closedHost);
const closed = closedHost.attachShadow({ mode: 'closed' });
closed.innerHTML = '<style>#closed-probe{width:10vw;height:20px;background:#000}</style><div id="closed-probe"></div>';
Object.assign(window, { closedProbe: closed.querySelector('#closed-probe') });

Object.assign(window, {
  fixture: {
    mount,
    unmount,
    mode,
    diagnostics,
    state: () => controller?.getState(),
    update: (options: ViewportOptions) => controller?.update(options),
    addOwner: () => { extra = mountViewport(); },
    dropOwner: () => { extra?.destroy(); extra = undefined; },
    extraState: () => extra?.getState(),
    media: (query: string) => matchMedia(query).matches,
    mediaInfo: (query: string) => ({ matches: matchMedia(query).matches, media: matchMedia(query).media }),
  },
});

if (mode === 'auto') {
  await import('../../src/auto.ts');
}

if (!params.has('manual') && mode !== 'auto' && mode !== 'none') mount();
