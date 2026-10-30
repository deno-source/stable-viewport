# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `stable-viewport/preflight` (pure rule engine) and `stable-viewport/preflight-browser`
  (read-only DOM probe) plus the `stable-viewport-check` CLI for a one-shot, non-invasive
  install check. Importing the browser probe has no side effects; `installConsoleCheck()`
  is opt-in and reversible.
- `media` attribute on `<link>`/`<style>` is projected like `@media` and restored on teardown.
- Diagnostics: `unsupported-media-unit`, `container-query`, `opaque-stylesheet`,
  `iframe-document`, `host-root-zoom`, `host-root-transform`, `no-css-zoom`,
  `missing-browser-api`, `mobile-disabled`, `zero-width`, `update-rejected`.
- Firefox and WebKit are covered by the automated suite, not just Chromium.
- Performance and leak suites (`e2e/performance.spec.ts`), including a 30× mount/unmount
  observer-leak assertion and a resize-work budget.
- Packaging verification (`npm run verify:package`) and CI workflows.

### Changed

- Resize/print now re-projects only media conditions instead of re-scanning every
  stylesheet and element: measured resize work dropped from 40–83 ms p50 to 0.2–1.8 ms p50
  on the same 800–6000 element fixtures.
- `zoom` support is detected by a real layout probe rather than `CSS.supports('zoom','1')`.
- A `<style>` sheet with an empty rule list (some engines expose one for a frame) is retried
  instead of being marked as processed; late stylesheets are adopted on the next frames.
- The Vue composable works outside a component instance (store, plugin, `effectScope`) and
  reports rejected reactive updates as a diagnostic instead of throwing into render.
- A malformed `design-width` on the custom element keeps the previous lease and dispatches
  `stable-viewport-error` instead of silently falling back to 1920.
- `stable-viewport/preflight-browser` no longer installs `window.stableViewportCheck` on import.

### Fixed

- Shadow roots attached after mount were never adapted (now hooked through `attachShadow`).
- The initial full pass could be skipped when the viewport equalled the design width.
- Cross-origin stylesheet warnings were suppressed by an over-eager pre-filter.
- Applying `zoom` on the root no longer lets a classic scrollbar widen the canvas past the
  design width (the canvas is measured on the content box).

Audit follow-up:

- Dynamic CSS entry points are complete: the same constructed sheet can be replaced again,
  `Text.data` edits are observed, `CSSGroupingRule.insertRule` is proxied, `@import`-only
  styles are not pre-filtered away, their async load is picked up, and in-place
  `adoptedStyleSheets.push` is adapted.
- Inline viewport units on `<html>` are adapted for business custom properties; only the
  runtime-owned `zoom` and `--sv-*` are left alone.
- Teardown restores an html `style` attribute that did not exist before, and releases
  per-node style registrations and shadow observers as components are removed. A diagnostic
  callback that throws during install now rolls every hook and observer back.
- Sessions belong to the target `Document` (cross-realm iframes share one), a nested mount
  during initialization is rejected, and a controller mounted from a destroy-triggered media
  callback no longer receives an already-stopped session.
- `matchMedia` keeps native listener ordering, accepts string-coercible input, and no longer
  emits a transient false→true pair when a fixed design width makes a width breakpoint
  constant. A later `adoptedStyleSheets` wrapper survives teardown.
- `installConsoleCheck` and the custom element only restore values they own, including
  `!important` display priority and pre-existing `display: contents`.
- Preflight now inspects `<style>` sheets inside open shadow roots.
- Performance: empty sheets retry a bounded number of frames, non-size media queries are not
  rebuilt, identical `update()` calls do not reinstall, repeated media texts and scales are
  cached, and one mutation batch inspects each target once. The zoom layout probe runs once
  per document. ESM output shares one core chunk; `use client` stays on the React/Next entries.

## [0.1.0] — unreleased

First functional cut: core, React, Next.js, Vue 3, Web Components and the `auto.js`
bootstrap, with the documented minimum conditions in `README.md`.
