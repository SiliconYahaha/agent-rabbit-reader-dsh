# SVG overflow public references

Three complete, unmodified WPT HTML originals and two references are pinned to `b09f5cdca2bec4e3095a0dedc2e5d62102252de3`; URLs and hashes are in sources.json and the repository license is retained. Expected results are green squares without overflow.

The auto test covers an open interoperability dispute, https://github.com/w3c/svgwg/issues/1072 . Its official expected image follows Firefox clipping; Chrome/Blink and WebKit expose inner SVG overflow. Preserve the official reference unchanged and report the mismatch. Do not claim the current Chrome-compatible renderer passes this WPT test or that the SVGWG issue is resolved.

These full HTML originals are screenshot-tested in Chrome. This is separate from the standalone SVG player and its generated WeChat inputs; no full-original WeChat conformance claim is made. The reference-preserving 116 generated/pinned SVG checks remain a separate corpus.
