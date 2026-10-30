# Security

## Reporting

Open a private advisory (Security → Advisories → New draft) or e-mail the maintainer listed in
`package.json`. Please do not open a public issue for a vulnerability.

## Scope notes

- The library runs in the page. It patches `window.matchMedia`, `CSSStyleSheet.prototype`,
  `Document.prototype.adoptedStyleSheets`, `ShadowRoot.prototype.adoptedStyleSheets` and
  `Element.prototype.attachShadow`, and removes every patch on teardown. A hostile page can
  therefore observe those patches while a session is active — this is the mechanism, not a
  vulnerability.
- It never fetches anything, never evaluates strings, never writes storage, and has one
  runtime dependency (`postcss-value-parser`, used for CSS parsing).
- Cross-origin stylesheets are not read: a `SecurityError` is caught and reported as a
  capability gap. The library does not attempt to bypass same-origin policy.
- The `stable-viewport-check` CLI only reads files (plus an optional headless-browser probe of
  a URL you pass) and writes its report to stdout. It has no install hooks.
