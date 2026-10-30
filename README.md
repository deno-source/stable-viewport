# stable-viewport

[![CI](https://github.com/deno-source/stable-viewport/actions/workflows/ci.yml/badge.svg)](https://github.com/deno-source/stable-viewport/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Wrap a desktop web app once and it keeps its **1920 px design layout at every desktop browser
zoom level** — hardcoded pixels, `rem`, `%`, grid, `flex`, `clamp()`, `vw/vh`, SVG icons,
`position: fixed`, body portals and CSS-in-JS all follow the same reference — while the
browser's own zoom indicator stays untouched.

```tsx
import { StableViewport } from 'stable-viewport/react';

<StableViewport designWidth={1920}>
  <App />
</StableViewport>
```

One core, six entry points (core, React, Next.js, Vue 3, Web Component, plain `<script>`),
SSR-safe, and reversible: `destroy()` restores the document byte for byte.

> **Status:** v0.1.0, pre-release. The package is not on npm yet — see
> [Install](#install) for the tarball route.

---

## Contents

1. [The problem](#the-problem)
2. [What you get](#what-you-get)
3. [Install](#install)
4. [Quick start](#quick-start)
5. [How it works](#how-it-works)
6. [Minimum conditions: when it will not work](#minimum-conditions-when-it-will-not-work)
7. [API](#api)
8. [Self check](#self-check)
9. [Testing](#testing)
10. [Performance](#performance)
11. [Accessibility](#accessibility)
12. [Repository layout](#repository-layout)
13. [Contributing](#contributing)

## The problem

A desktop product is designed on a 1920 px canvas and built with real design pixels. The moment
a user zooms the browser — 80 %, 110 %, 150 % — the layout viewport changes, breakpoints fire,
`vw` units grow, `position: fixed` panels re-anchor, and the page stops matching the design.
Everything looks "responsive" and nothing looks like the mockup.

The usual CSS-only answers each fix one symptom and break another:

| Attempt | What breaks |
| --- | --- |
| Convert everything to `rem` | `%`, `vw`, media queries, `clamp()`, fixed elements and canvas/SVG geometry still follow the viewport |
| Wrap the app in `max-width: 1920px` | the page is capped, not scaled; typography and spacing shrink relative to the window |
| `transform: scale()` on a wrapper | creates a containing block: `position: fixed` and portals escape the canvas; scrollbars and hit-testing drift |
| `zoom` on `html` alone | `vw/vh` and `@media` still resolve against the *engine* viewport, so they fight the canvas |
| Resize the window / fake the viewport | changes what the user sees and what the browser reports; not the same as zoom |

`stable-viewport` owns exactly one thing — the **design canvas** — and projects *every* viewport
consumer onto it: layout, viewport units and media conditions.

## What you get

| The page says | Rendered at 500 % browser zoom | Why |
| --- | --- | --- |
| `width: 120px` | still 120 design px | nothing is rewritten; the root carries `zoom` |
| `width: 8rem` | still 8 rem | root font-size is untouched |
| `width: 50%` | still 50 % of its container | the container is the design canvas |
| `height: 40vh` | still 40 % of the design *height* | `vh` → `calc(40 * var(--sv-vh))` |
| `@media (max-width: 1440px)` | **never fires** on a desktop canvas | breakpoints are projected onto the engine viewport |
| `@media (min-width: 60ch)` | fires natively | `ch` cannot be projected; reported by the check |
| `@container (max-width: 400px)` | evaluates in design space | container queries already use layout pixels |

At the same time, `window.matchMedia()` answers the way the CSS does, printing drops back to
native units, and teardown restores only the values the library still owns.

## Install

The package is not published to npm yet; build a tarball from this repository and install that
(the same path `npm run verify:package` tests):

```bash
git clone https://github.com/deno-source/stable-viewport.git
cd stable-viewport
npm ci && npm run build && npm pack
# in your app:
npm install ../stable-viewport/stable-viewport-0.1.0.tgz
```

Requirements: Node ≥ 22 for the self check, and — in the browser — Chrome/Edge ≥ 128,
Safari ≥ 16.4 or Firefox ≥ 126. React ≥ 18, Vue ≥ 3.3, Next.js ≥ 15 for the framework entries.
Nothing touches `window`/`document` at import time, so every entry is safe on the server.

Optional one-shot self check (see [Self check](#self-check)):

```bash
npx stable-viewport-check --root .        # 0 ready · 1 caveats · 2 blocked · 3 tool error
```

## Quick start

**React / Next.js** (client component; `stable-viewport/next` adds a `beforeInteractive`
`ViewportBootstrap` so the canvas exists before hydration):

```tsx
import { StableViewport } from 'stable-viewport/react';

export default function Layout({ children }: { children: React.ReactNode }) {
  return <StableViewport designWidth={1920}>{children}</StableViewport>;
}
```

**Vue 3**:

```vue
<script setup lang="ts">
import { StableViewport } from 'stable-viewport/vue';
</script>
<template><StableViewport :design-width="1920"><RouterView /></StableViewport></template>
```

**Framework free**:

```ts
import { mountViewport } from 'stable-viewport';

const controller = mountViewport({ designWidth: 1920 });
controller.destroy(); // restores the document byte for byte
```

**Web component** (registered by you, no build magic):

```html
<stable-viewport design-width="1920">…</stable-viewport>
<script type="module">
  import { defineStableViewport } from 'stable-viewport/web-component';
  defineStableViewport();
</script>
```

**No build step at all** — the only side-effectful file in the package, and it only runs if you
add the tag:

```html
<script defer src="/stable-viewport.auto.js" data-design-width="1920"></script>
```

The React, Vue and web-component adapters render children with no wrapper box, and adapters
translate only — all scaling logic lives in one core.

## How it works

1. **The canvas is the root's content box.** `html { zoom: clientWidth / designWidth }` pins the
   layout canvas to the design width. `innerWidth` moves with browser zoom, `clientWidth` does
   not, so a classic scrollbar can never push the canvas wider than the design.
2. **Viewport units become design pixels.** `--sv-vw / --sv-vh / --sv-vmin / --sv-vmax` are
   published as design-space values, and every `vw/vh/vmin/vmax` (including `sv*/dv*/lv*`
   variants) in stylesheets, `<style>`, `style="…"`, constructed stylesheets and open shadow
   roots is rewritten to `calc(<n> * var(--sv-…))`.
3. **Media conditions are projected.** `@media` width/height conditions are rescaled
   (`px/em/rem/pt/pc/in/cm/mm/q`), the `media` attribute on `<link>`/`<style>` follows, and
   `window.matchMedia()` is proxied so application code sees the same answer as the CSS.
4. **Printing is native.** `beforeprint` drops back to native units, `afterprint` restores the
   canvas — a design canvas is a screen concept.

Everything the library writes is tracked. `destroy()` — or the last owner releasing its lease —
restores only what is *still* the library's own value, so later application writes win.

## Minimum conditions: when it will not work

This is CSS-level adaptation. It cannot rewrite your JavaScript, reach into a cross-origin
document, or undo a decision your code already made. **If any row below is true, the wrapper will
not work — and in the “blocked” cases it deliberately refuses to install instead of damaging the
page.** The self check enforces exactly this table.

### Blocked — the component refuses to run (`verdict: blocked`)

| Condition | Why it cannot work | What you must change |
| --- | --- | --- |
| Engine does not apply `zoom` to layout (detected by a real layout probe, not `CSS.supports`) | the canvas is built on CSS `zoom` | Chrome/Edge ≥ 128, Safari ≥ 16.4, Firefox ≥ 126 |
| Engine lacks `MutationObserver` / `requestAnimationFrame` | styles and lifecycle cannot be observed | any supported browser since 2015 |
| `<html>` already has a computed `zoom` | two zoom owners fight; layout jumps | remove `zoom` from `html/:root/body` |
| `<html>` or `<body>` has `transform` / `translate` | a transformed ancestor becomes the containing block: `position: fixed` and full-page scaling break | move the transform to an inner wrapper |
| Your CSS writes `zoom`/`transform` on `html/:root/body` | same as above, and it would be overwritten | scope those rules to a container |
| React < 18 / Vue < 3.3 / Next.js < 15 / Node < 22 | unsupported API surface | upgrade |

### Caveats — works, with a documented difference (`verdict: ready-with-caveats`)

| Condition | Behaviour you get | Mitigation |
| --- | --- | --- |
| Breakpoints in `ch` `ex` `lh` `rlh` `vw` `vh` | keep native meaning, so they flip differently from `px`/`rem` | rewrite those breakpoints in `px/rem/em` |
| Cross-origin stylesheet (`<link>` without CORS) | rules are unreadable, its units stay native | serve it same-origin or with CORS, or import it into the build |
| Closed shadow roots (`attachShadow({mode:'closed'})`) | styles inside are unreachable | use `mode: 'open'` |
| Same-origin iframes | need their own controller *inside* that document | mount one controller per document |
| Cross-origin iframes | cannot be adapted at all | out of scope by browser security |
| JS reading `innerWidth` / `clientWidth` / `matchMedia` by hand | CSS cannot change the number your JS reads; layouts computed from it still follow the physical viewport | use `ResizeObserver`, container queries, or `var(--sv-*)` |
| Mobile user agents | disabled by default (`enabled: false`), native behaviour kept | pass `mobile: true` deliberately |
| Classic scrollbar | detected, canvas measured on the content box — no horizontal overflow | none needed |
| Container queries | not rewritten (they already work in design space) | none needed |

### Explicitly out of scope

- Operating-system magnification, OS display scaling and mobile pinch-zoom are *not* page zoom.
- Anything rendered in a cross-origin iframe, in a cross-origin stylesheet, or inside a closed
  shadow root.
- Layout decisions already taken in JavaScript from raw viewport numbers.
- Printing keeps native CSS pixels on purpose.

## API

### `mountViewport(options?) → ViewportController`

| Option | Default | Meaning |
| --- | --- | --- |
| `designWidth` | `1920` | design canvas width in CSS px; must be finite and > 0 |
| `enabled` | `true` | `false` keeps the page completely native |
| `mobile` | `false` | opt in on phones/tablets |
| `document` | global `document` | target document (iframes, tests) |
| `onDiagnostic` | — | receives every capability gap |

`ViewportController`: `refresh()`, `update(options)`, `getState()`, `destroy()`.
`getState()` → `{ status: 'active' | 'disabled' | 'unsupported' | 'destroyed', scale, designWidth, diagnostics }`.

Diagnostic codes: `no-document`, `missing-browser-api`, `no-css-zoom`, `mobile-disabled`,
`host-root-zoom`, `host-root-transform`, `opaque-stylesheet`, `unsupported-media-unit`,
`container-query`, `iframe-document`, `zero-width`, `update-rejected`.

### Framework entries

| Entry | Exports |
| --- | --- |
| `stable-viewport` | `mountViewport`, `checkCapability`, `findHostConflicts`, `transformValue`, `transformMedia` |
| `stable-viewport/react` | `StableViewport`, `useStableViewport` |
| `stable-viewport/next` | same as React plus `ViewportBootstrap` (`beforeInteractive` script) |
| `stable-viewport/vue` | `StableViewport`, `useStableViewport` |
| `stable-viewport/web-component` | `defineStableViewport(tagName?, window?)` |
| `stable-viewport/auto.js` | IIFE: `<script defer src data-design-width>` |
| `stable-viewport/preflight` | `evaluatePreflight`, `formatPreflight` (pure) |
| `stable-viewport/preflight-browser` | `runPreflight`, `collectBrowserFacts`, `window.stableViewportCheck()` |

### Ownership rules

- One document has exactly one session. The first mount installs it, every later mount joins as
  an owner, and the *last* `destroy()` restores the document.
- Two active sessions on one document with different `designWidth` throw instead of silently
  fighting (`Conflicting designWidth for the same document`).
- `destroy()` is idempotent; a destroyed controller cannot be updated (`update` throws) but
  `getState()` still reports `destroyed`.
- React Strict Mode's setup → cleanup → setup equals a single mount; Vue `KeepAlive`
  deactivate/reactivate equals unmount/mount; a custom element moved in the DOM keeps one lease
  (release is deferred one microtask) and an element adopted into another document releases the
  old document before taking the new one.
- The `auto.js` bootstrap lease is adopted by the first explicit controller, so hydration never
  double-scales.

## Self check

An **optional, read-only, one-shot** diagnostic — not a runtime dependency:

- **Optional.** Nothing breaks if you never run it.
- **Read-only.** It opens your files, prints a report and exits. No file is created, edited,
  moved or deleted — asserted by a test that fingerprints the whole project before and after.
- **Not injected.** No import from application code, no build plugin, no `postinstall`, no
  service worker, no interval. The package declares exactly one side-effectful file
  (`dist/auto.js`), and that one only runs if *you* add the `<script>` tag.
- **One shot.** It runs when you invoke it, not on page load or build.

```bash
npx stable-viewport-check --root .                                # static scan, no browser needed
npx stable-viewport-check --root . --url http://localhost:3000    # + live probe if playwright exists
npx stable-viewport-check --root . --json > sv-report.json        # CI artefact
npx stable-viewport-check --root . --strict                       # warnings fail the build
```

Options: `--root`, `--url`, `--design-width`, `--json`, `--strict`, `--quiet`,
`--exclude <fragment>` (repeatable), `--max-files`.
Exit codes: `0` ready · `1` caveats under `--strict` · `2` blocked · `3` tool error.

The static pass reads CSS/SCSS/Less/HTML/Vue/Svelte/Astro/JS/TS for root zoom or transform,
projectable and non-projectable breakpoints, `@container`, viewport units, closed shadow roots,
runtime style injection, and reads `package.json` for framework versions. The runtime pass only
*reads* the live document (CSS `zoom` support, existing root zoom/transform, opaque sheets,
iframes, breakpoints, scrollbar) and creates at most one off-screen probe element, removed
immediately. Without `playwright` installed the runtime pass is reported as *skipped*, not as a
pass.

Explicit console helper, only where you want it (dev tools, a debug page, never production):

```js
const { installConsoleCheck } = await import('stable-viewport/preflight-browser');
const uninstall = installConsoleCheck();   // window.stableViewportCheck(...)
uninstall();                                // removes the global again
```

## Testing

```bash
npm test                 # unit: transforms, metrics, preflight rules, CLI, SSR, non-invasiveness
npm run test:e2e         # Playwright: real Chrome zoom 25 %…500 %, plus Firefox and WebKit
npm run coverage         # unit + real-browser coverage merged into coverage/lcov.info
npm run quality:crap     # ub-mode/crapper: CRAP score per function
npm run quality:dry      # ub-mode/dryer: structural duplication
npm run quality:mutate   # ub-mode/mutator: mutation testing
npm run verify:package   # pack → install into a throwaway project → run the check there
npm run typecheck && npm run build
```

The three quality tools are Python programs (`git clone` + `pip install -e`), not npm packages:
run `node scripts/quality.mjs install` once; they live in `.tools/` and never enter the published
package.

### What is verified, and what is not

Verified by automated tests:

| Area | Cases |
| --- | --- |
| Size invariance | hardcoded px, rem, em, %, grid, flex, `clamp/min/max/calc`, SVG, icon fonts, images, single-line clipping, fixed line-height, at 25/50/67/125/200/300/400/500 % real Chrome zoom (`compat.spec.ts`, `adapters.spec.ts`) |
| Breakpoints | px/rem/em/range/boolean media queries, `media` attribute on `<link>`/`<style>`, design widths 1440/1920/2560, `ch`/`ex`/`lh`/`vw` kept native and reported (`compat.spec.ts`, `gaps.spec.ts`) |
| Layout pieces | body portals, `position: fixed`, `sticky`, inputs, container queries, long pages, scrollbar gutter, no horizontal overflow (`compat.spec.ts`, `performance.spec.ts`) |
| Late CSS | `<style>` injected later, `insertRule`, `replace`, `replaceSync`, `adoptedStyleSheets`, late and nested shadow roots, `@import` + `@layer` + `@supports` (`robustness.spec.ts`, `shadow.spec.ts`) |
| Lifecycle | two owners, last-release restore, remount, Strict Mode, Vue `KeepAlive`, custom-element move/adoption/late upgrade, `auto.js` hand-over (`lifecycle.spec.ts`, `api.spec.ts`, `gaps.spec.ts`) |
| Public API | every status, `update`/`refresh`/`destroy` idempotence, invalid input rejection, all diagnostic codes (`api.spec.ts`, `adapters.spec.ts`) |
| Engines | Chromium, Firefox, WebKit: geometry, breakpoints, hooks, teardown, plus a simulated engine without zoom (`engines.spec.ts`) |
| Server | every entry point imports on the server, React and Vue render children with no wrapper box, preflight rules run headless (`tests/ssr.test.ts`) |
| Install check | ready/blocked fixtures, JSON output, exit codes, bad arguments, probe failure, zero writes to the project, no install hooks, tarball contents (`tests/cli.test.ts`, `tests/non-invasive.test.ts`, `scripts/verify-package.mjs`) |

Known gaps, stated rather than hidden:

- **Real page zoom is only programmable in Chromium-family browsers.** Firefox and WebKit run
  the same assertions with the equivalent geometry (`viewport ÷ factor`, `deviceScaleFactor =
  factor`). A physical Safari/Edge device pass is still on the roadmap.
- **Cross-origin stylesheets, closed shadow roots, cross-origin iframes** are reported, never
  adapted — asserted as negative capability tests.
- **JavaScript that reads `innerWidth`/`clientWidth`** keeps its own behaviour; a test proves the
  library does *not* pretend otherwise.
- **Operating-system magnification and mobile pinch-zoom** are out of scope by definition.
- React 18 / Vue 3.3 / Next.js 15 minimums are enforced by the self check, but the suite runs the
  current majors (React 19, Vue 3.5, Next 16); older supported majors are covered by the type
  surface and the documented minimum, not by a second CI matrix yet.

### Recorded quality results

| Gate | Command | Result |
| --- | --- | --- |
| Types | `npm run typecheck` | clean (strict, `noUncheckedIndexedAccess`) |
| Unit + CLI + SSR | `npm test` | 50 tests |
| Browser suite | `npm run test:e2e` | 109 tests: Chromium (real page zoom) + Firefox + WebKit |
| Packaging | `npm run verify:package` | tarball contents, install, CLI run, SSR imports, no hooks |
| Non-invasive | `npm test` (`tests/non-invasive.test.ts`) | project byte-identical after a check run |
| Dryer | `npm run quality:dry` | no duplicate candidates at ≥ 0.8 |
| Mutator | `npm run quality:mutate` | 85/85 mutation sites killed (100 %) in `transforms.ts` + `capability.ts` |
| Crapper | `npm run quality:crap` | 171 functions scored, worst CRAP **47.2**, 41 functions ≥ 10 — **above the gate**, see note |

Honest note on CRAP: coverage is merged from unit tests **and** real browser runs
(`npm run coverage`), so functions that only run in a browser are scored on their real
executions (line coverage 95.8 %, branch coverage 54.7 %). The gate is `--threshold 35` and the
current worst is 47.2 (`styles.processMutations`, unchanged defensive branching in the batch
pipeline), so the gate is recorded as **failing**, not as passed. ub-mode's target is < 10;
raising it needs more branch-level browser assertions, not weaker tests. `crapper`'s sibling
tools run from `.tools/` on Windows with `--max-workers 1`; long mutation runs can hit a Windows
file lock while cleaning their worker overlay, which is a tool limitation, not a test failure.

The Playwright suite drives a **real Chrome browser zoom** through
`chrome.settingsPrivate.setDefaultZoom` (never CSS `zoom`, never a resized viewport pretending to
be zoom) against deliberately foreign fixtures:

- `examples/compat` — hardcoded px, rem/em/%, grid, container queries, SVG + icon fonts, sticky,
  fixed, body portals, own breakpoints in px/rem/ch/vw, cross-origin stylesheet, closed shadow
  root, injected styles, adopted sheets, late shadow roots, 4 adapters.
- `examples/playground` — lifecycle laboratory (kinds of mount, owners, CSSOM, media events).
- `examples/next` — SSR, hydration, client navigation, missing bootstrap asset.
- `examples/clean` — reference page that meets every minimum condition.

## Performance

Measured on Windows 11 / Chrome 141, viewport 1920×1080, from the library's own callbacks
(`requestAnimationFrame` and `MutationObserver` wrapped before mount), so browser frame latency
is excluded. Reproduce with `npx playwright test e2e/performance.spec.ts`.

| Fixture | install (first paint) | resize frame (p50) | DOM mutation (p50) | teardown |
| --- | --- | --- | --- | --- |
| 16 elements, 1 sheet (a simple page) | 1.5 ms | < 0.1 ms | < 0.1 ms | < 1 ms |
| 66 elements, 3 sheets (the hostile fixture) | 2.7 ms | 0.1 ms | 0.1 ms | < 1 ms |
| 815 elements, 720 declarations | 30 ms | 0.2 ms | 0.2 ms | 2.8 ms |
| 2 049 elements, 8 000 declarations | 107 ms | 1.3 ms | 0.2 ms | 14.7 ms |
| 6 089 elements, 16 000 declarations | 243 ms | 1.8 ms | 0.2 ms | 20.3 ms |

- **Install is the only expensive step**, proportional to the number of declarations containing a
  viewport unit (the fixtures are deliberately worst-case: every rule has one). It happens once,
  before the canvas is painted.
- **Resize is cheap on purpose.** Declarations are rewritten to `calc(n * var(--sv-*))`, so a
  resize only re-projects media conditions — it never walks the DOM or the stylesheets again.
  This is a 30–45× improvement over the first implementation; a budget test fails if a full
  re-scan creeps back in.
- **DOM mutations cost O(inserted subtree)**; already-inspected elements are skipped via a
  `WeakSet`, so appending a list does not re-walk the page.
- **Idempotent writes.** A repeat `refresh()` performs zero `setProperty` calls; the test asserts
  it.
- **Nothing is retained after teardown.** 30 mount/unmount cycles leave zero observers, zero
  inline styles on `<html>`, the native `matchMedia`/`insertRule`/`attachShadow` back in place,
  and measured heap growth under 24 MB (asserted in the same suite).

## Accessibility

- Disabling page zoom *does* remove a magnifier that some users rely on. Keep a visible way out:
  `<StableViewport enabled={userPreference}>` or a “use native zoom” toggle.
- `prefers-reduced-motion` / `forced-colors` are never rewritten.
- Never claim the physical millimetres are identical across screens; only the *design canvas* is
  stable.
- `zoom` support is detected by **layout**, not by `CSS.supports`: an engine that parses `zoom`
  but ignores it fails closed with `no-css-zoom` instead of half-applying a canvas.

## Repository layout

```
src/                one core + thin adapters
  model, transforms, capability          pure / observable logic
  runtime, styles, rule-walker,          the canvas: CSSOM rewrite, media projection,
  media, media-rules, inline-styles,     lifecycle, patch + restore
  changes, cssom-patch, css-om, session
  index, react, next, vue, web-component, auto, preflight, preflight-browser
scripts/            build, self check (bin), coverage merge, package verification, quality gates
tests/              vitest: transforms, preflight, CLI, SSR, non-invasiveness
e2e/                Playwright: compat, adapters, engines, gaps, robustness, shadow, lifecycle,
                    api, next, performance, preflight, combinations, limits, audit regressions
examples/           clean · compat (hostile) · playground · composable · stress · next
fixtures/           clean-project / hostile-project consumed by the CLI tests
```

## Contributing

- `CONTRIBUTING.md` — the loop, the non-negotiable rules, commit style.
- `CHANGELOG.md` — what changed in each release.
- `RELEASING.md` — version bump, verification, publish, tarball contract.
- `SECURITY.md` — private reporting, and exactly what the library patches in a page.

In short: a behaviour change needs a test that fails without it, teardown must restore the
document exactly, and a new limitation is a README change *and* a preflight rule.

## License

MIT — see [LICENSE](./LICENSE).
