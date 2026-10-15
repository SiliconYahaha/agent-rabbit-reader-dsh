# SVG clipping references

Three unmodified WPT test SVGs and their unmodified published reference SVGs at commit d317428a65e0312e0a199d5db69591e252431dfe. sources.json records source URLs, expected content, both SHA-256 values and the BSD-3-Clause license.

The oracle fixes only the test viewport to 200 user units / 256 pixels so source and reference have an explicit shared embedding. The original files remain unchanged. Generated cases use independent explicit Canvas clip paths and transformations as a geometry oracle, while retaining every native SVG image difference separately. A multi-child union remains a recorded failure, not a passing sample. No physical phone result is inferred from Chrome or DevTools.
