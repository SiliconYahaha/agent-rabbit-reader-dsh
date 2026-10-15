# CSS escape public sources

Unmodified WPT originals, pinned to `web-platform-tests/wpt` commit `9bd47eefe9095a8464fdcce401747dcd737d1eec`, `css/css-syntax/`:

- `escaped-eof.html`: https://github.com/web-platform-tests/wpt/blob/9bd47eefe9095a8464fdcce401747dcd737d1eec/css/css-syntax/escaped-eof.html
- `input-preprocessing.html`: https://github.com/web-platform-tests/wpt/blob/9bd47eefe9095a8464fdcce401747dcd737d1eec/css/css-syntax/input-preprocessing.html

BSD-3-Clause, copyright web-platform-tests contributors; full original `LICENSE.md` included. SHA-256 checks in `tests/css-escapes.test.js` prevent fixture drift. No personal files included; outside the mini-program package.

The two originals run 5 and 10 cases in Chrome with the original WPT harness. This is browser evidence, **not** a claim the reader implements CSSOM, dimension/URL serialization or all WPT tests. Reader regressions cover escaped EOF in identifier/string contexts and the 10 original type-selector preprocessing expectations with actual applied styles. Prefixing those raw inputs with `#` changes the token type; three observed raw-NUL hash differences are recorded separately in the oracle and release limitations, not counted as passing.
