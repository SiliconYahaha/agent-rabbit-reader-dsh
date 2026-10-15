# Korean RTF byte combinations

The reader already has a bounded CP949 decoder, but its RTF accepted-encoding set omitted CP949. Document `ansicpg949`, font `fcharset129`, and explicit font `cpg949` consequently rejected valid Korean body bytes.

`scripts/generate-rtf-korean-fixtures.py` generates the compact character-byte fixtures using Python's standard CP949 codec, independently of the reader's tables. Seed: `94920261013`. `tests/helpers/rtf-korean-cases.js` creates eighteen reproducible documents: common/extended Hangul, Hanja and ASCII, font/document selection, scope changes, Unicode two-byte fallback, raw/hex byte combinations, and a lead byte crossing the reader's 8192-byte run boundary. Malformed and hidden malformed runs remain explicit errors; Johab charset 130 is not declared supported.

References:

- [Microsoft RTF 1.9.1](https://officeprotocoldoc.z19.web.core.windows.net/files/Archive_References/%5BMSFT-RTF%5D.pdf), pp.12–14 and 19–20: document ANSI page 949; font charset 129 maps to Hangul 949, charset 130 to Johab 1361; explicit font `cpgN` takes precedence.
- [Python standard codecs](https://docs.python.org/3/library/codecs.html#standard-encodings): CP949/ms949/UHC.

`scripts/verify-rtf-korean.js` imports the actual bytes into Cocoa and LibreOffice, compares whole text, and records differing reference outputs without changing the independent expectation. The initial eighteen-file investigation found fifteen reader failures before repair, twelve Cocoa matches, and sixteen Writer matches. Cocoa differs for explicit font codepages and some long document-page runs; Writer differs for two mixed literal/hex runs. These exploratory combinations and reference differences do not prove all applications agree.

`scripts/verify-rtf-korean-wechat.js` opens real RTF files from the DevTools filesystem and checks the reader's entire parsed text, actual WXML text, and visible geometry. No rich RTF layout, embedded-picture support, or physical iOS/Android evidence is implied. No private file is redistributed.
