# Contributing

Thanks for helping. This project follows `ub-mode`: first make it work, then make it right,
then follow practice (log, gate, commit in small steps).

## Setup

```bash
npm ci
npm run build              # dist/ is what the examples and the E2E server load
npx playwright install chromium firefox webkit
node scripts/quality.mjs install   # crapper / dryer / mutator (Python, one time)
```

## The loop

```bash
npm run typecheck          # strict TS, noUncheckedIndexedAccess
npm test                   # unit + CLI + SSR + non-invasiveness (vitest)
npm run test:e2e           # Chromium (real page zoom) + Firefox + WebKit
npm run coverage           # unit + real-browser coverage → coverage/lcov.info
npm run quality:crap       # CRAP per function (needs the coverage step)
npm run quality:dry        # structural duplication
npm run quality:mutate     # mutation testing
npm run verify:package     # pack → install in a temp project → run the CLI there
```

## Rules that are not negotiable

1. **A behaviour change needs a test that fails without it.** No exceptions for "obvious"
   fixes; every regression in this project was found by a test, not by reading code.
2. **Teardown must restore the document exactly.** Anything the library writes is tracked
   and restored only if it is still the library's own value. New write paths need a test in
   `e2e/robustness.spec.ts` or `e2e/lifecycle.spec.ts`.
3. **Never claim a browser was verified when it was not.** Real page zoom only exists in
   Chromium-family channels; Firefox/WebKit use the equivalent geometry condition and that
   difference is stated in the README.
4. **A new limitation is a README change.** If a project condition cannot be adapted, it goes
   into the "Minimum conditions" table *and* into the preflight rules, with a test in
   `tests/preflight.test.ts`.
5. **The self check stays read-only and optional.** No build plugin, no `postinstall`, no
   interval, no import-time global. `tests/non-invasive.test.ts` fingerprints the project
   before and after a run and will fail if that changes.
6. **One source of truth for the canvas.** Adapters translate only; they never reimplement
   scaling logic.

## Commit style

Small, ordered, each one says *why*, *what changed*, and *how it was proved*:

```
fix(shadow): adapt roots attached after mount

Late `attachShadow()` calls were invisible to the light-DOM observer, so their
declarations kept native viewport units.

Hooked Element.prototype.attachShadow, restored on teardown.

Proved by e2e/robustness.spec.ts "runtime-injected … late shadow roots" in
Chromium, Firefox and WebKit.
```

## Reporting a problem

Open an issue with the self-check output (`npx stable-viewport-check --root . --json`) and the
zoom levels that show it. If the check reports `blocked`, the component refused to install on
purpose — the report names the condition and how to remove it.
