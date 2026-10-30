## What changed and why

<!-- One paragraph. Link the issue if there is one. -->

## How it was proved

- [ ] `npm run typecheck`
- [ ] `npm test` (unit, CLI, SSR, non-invasiveness)
- [ ] `npm run test:e2e` (Chromium + real page zoom, Firefox, WebKit)
- [ ] `npm run verify:package` when the public surface changed
- [ ] New behaviour has a test that fails without the change

## Risk

- Affected paths: <!-- core / styles / media / adapters / check CLI / docs -->
- Does teardown still restore the document exactly? <!-- yes / tested by … -->
- Does this change a documented minimum condition? <!-- no / README updated -->
