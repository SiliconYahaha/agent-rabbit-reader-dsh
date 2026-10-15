# SVG viewport reference fixtures

Three unmodified Web Platform Tests SVG files and their shared official blank reference are pinned to commit `d317428a65e0312e0a199d5db69591e252431dfe`. `sources.json` records each original URL, SHA-256 and reference hash. The repository BSD-3-Clause LICENSE is retained here. A zero viewBox dimension disables rendering: the expected result is intentionally blank. Negative or malformed viewBoxes are a separate generated case.

`tests/helpers/svg-viewports.js` generates 113 additional alignment, clipping, percentage, animation and size cases with independent flattened reference geometry. Chrome checks the original SVG, reference SVG and reader pixels separately. The WeChat verifier imports actual files and compares device-resolution Canvas pixels against reference commands obtained from Chrome DOM. Its strict mode rejects any pixel difference; `--discover` only records unresolved differences and does not turn them into passes.

User originals remain private local inputs and are not redistributed in this directory.
