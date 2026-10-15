# Ai/EPS strings, DSC scope and arrays

Repository-authored, deterministic sources; no private user files. No randomness.

- `before.json`: 90 original sources, five contexts × six DSC-looking strings × three physical line endings. The original probe used nonexistent `pathCount`; the retained correction recomputes `paths` on unchanged inputs (75 wrong vectors, not 90). Original raw report remains local.
- `expanded-before.json`: 45 further sources and original-base model results. Escapes, continuation, comments, dictionaries, hex/ASCII85, documents, opaque bytes and raster fallback.
- `array-before.json`: 12 additional array/string combinations, captured after the first DSC patch and before the array repair; all exposed a spurious third path. Four LF sources were independently rendered by Ghostscript.
- `fallback-before.json`: actual unchanged design component with base parser exports. Fake-only EPSI data and fake-before-real EPSI both wrote a black JPEG. Expected results are respectively no preview and the real white JPEG.
- `native-reference.json`: 63 original-byte Ghostscript 9.56.0 PNGs (42 original, 17 expanded, four array sources), exact source/output hashes. EPSCrop uses the original header; no source rewrites. 62 red/blue drawings and one blank source. The blank source proves that its string is not a black preview; the app reports absence rather than inventing one.

`tests/ai-lexical.test.js` checks the same source bytes, vectors, real raster pixels, malformed/over-limit data and component lifecycle. `scripts/verify-ai-lexical.js` opens all 147 sources with the real Node design component and decodes its emitted SVGs in Chrome against retained native PNGs. Both are composited on white. It checks every 40×20 pixel plus aspect ratio; one expected no-preview is checked separately. Node and Chrome are not WeChat/device verification.

Primary syntax reference: Adobe PostScript Language Reference, third edition, section 3.2, https://www.adobe.com/jp/print/postscript/pdfs/PLRM.pdf . The repair recognizes data boundaries, not full PostScript execution or all malformed encoded-string data. Opaque byte payloads are DSC isolation controls, not native-executable artwork.
