# Public cascade sources

Original bytes from web-platform-tests/wpt commit `9bd47eefe9095a8464fdcce401747dcd737d1eec`, retrieved 2026-08-31; repository BSD-3-Clause terms are preserved in LICENSE.md.

- [sort-by-order-001.xht](https://github.com/web-platform-tests/wpt/blob/9bd47eefe9095a8464fdcce401747dcd737d1eec/css/CSS2/cascade/sort-by-order-001.xht): source instruction requires a green square without red. Check `#child` actual green background and 100×100 dimensions.
- [specificity-011.xht](https://github.com/web-platform-tests/wpt/blob/9bd47eefe9095a8464fdcce401747dcd737d1eec/css/CSS2/cascade/specificity-011.xht): source requires generated PASSED text with teal top and blue bottom solid borders. Check original `p::after` versus emitted synthetic text/span.

Chrome loads the originals unchanged as application/xhtml+xml. The reader now receives the same raw source and explicit XHTML MIME through its XML reader; there is no CDATA-stripping or CSS-extraction adapter. Reader output is a separate HTML document, with its real wrapper and node styles.

Historical baseline at reference snapshot: the HTML-only parser retained XML CDATA markers and lost the square's CSS (transparent, 390×0 instead of green, 100×100). The MIME-aware candidate fixes that exact failure; both original outcomes now pass with source hashes and expectations unchanged. This is not a full WPT reftest screenshot comparison, arbitrary XML/DTD support, cascade layers, or WeChat/device verification. Hashes in css-cascade-order.test.js prevent silently changing the oracle inputs. XML limitations and pending device evidence are in compatibility/profiles/xhtml.json.
