# Releasing

## One-time

1. Check the package name is free: `npm view stable-viewport version` (currently 404).
2. Enable npm provenance in the publish workflow if you publish from CI.

## Every release

```bash
git switch -c release/vX.Y.Z
npm ci
npm run typecheck && npm test && npm run test:e2e && npm run verify:package
```

1. Bump `version` in `package.json` (SemVer).
2. Move the `## [Unreleased]` section of `CHANGELOG.md` under the new version with today's date.
3. Update the recorded numbers in `README.md` if the measured performance or test counts changed.
4. Commit as `chore(release): vX.Y.Z`, tag `vX.Y.Z`, push the tag.
5. Publish:

```bash
npm publish --access public          # append --provenance when publishing from CI
```

6. Verify the published artifact the way a user will:

```bash
cd "$(mktemp -d)" && npm init -y
npm i stable-viewport
npx stable-viewport-check --root . --json | head -20
```

## What the tarball must contain

`dist/`, `scripts/check.mjs`, `README.md`, `LICENSE` — nothing else. `npm run verify:package`
asserts that `src/`, `tests/`, `e2e/` and `node_modules/` are absent and that the manifest has
no `preinstall`, `install`, `postinstall` or `prepare` hooks.

## Breaking-change policy

Changing a documented minimum condition (a new required browser feature, a new refused
configuration) is a **minor** release with a CHANGELOG "Changed" entry and a README table
update; silently changing one is a bug.
