# Canvas reset public tests

Source: [web-platform-tests/wpt reset](https://github.com/web-platform-tests/wpt/tree/9bd47eefe9095a8464fdcce401747dcd737d1eec/html/canvas/element/reset), fixed revision `9bd47eefe9095a8464fdcce401747dcd737d1eec`. Original bodies/assertions/reference pixels are unchanged; only trailing blank lines are normalized. BSD license retained in `LICENSE`.

| File | Local SHA-256 |
| --- | --- |
| 2d.reset.basic.html | `5303f2308f75d33138a40453ee3fb7b73058257f51d95d60d3010d88dc696aaf` |
| 2d.reset.state.global_alpha.html | `4b08eab9339389557c66af19e2bb839b96f30258fac6a6d4a68713012425c140` |
| 2d.reset.state.clip.html | `8bf77b9269e2ed727f5cedeef30e8a0a076d192dfb37694a0c7319fdc52e64e1` |
| 2d.reset.state.clip-expected.html | `6721713a26c5802c94a67b1c0fee41d6ef3b2fb5dca660936d03ea2d82a08f5c` |

The verifier checks all four hashes, runs both original assertion bodies in native Chrome and the real reader Page runtime, and retains every assertion (including outside-canvas transparent pixels). The small synchronous harness implements only the necessary APIs; it is not the whole WPT harness. The clip reftest runs unchanged, compares the entire real Page Canvas with native rendering of both the original and its separate upstream expected file. Gallery CSS is not an oracle. Readiness instrumentation is outside original test bodies.

Sixteen generated files each run at initial Page load and after a Page button event. Every RGBA byte of script readback, actual drawing target and exported PNG is hashed and compared to an independent native Canvas running the same function. Tests include transparent clearing, current-path and clip reset, saved state, old gradient reuse, text, line dashes, transform, repeated reset and image-source snapshots across reset.

Both native reset and an actual native host with reset removed are exercised (the latter forces same-width fallback), totaling 64 generated states and three public files twice. Generated state checks require each engine to restore its own initial values, and require all tested cross-engine values to match except the explicitly reported direction getter difference. On the tested Chrome host its getter returns `ltr`, while the reader retains the [HTML standard's initial `inherit`](https://html.spec.whatwg.org/multipage/canvas.html#dom-context-2d-direction). `style-differences.json` records every differing state; values are not rewritten. This is not a claim that all getters or bidirectional text rendering match Chrome.

No WXML, Android, iOS, full WebIDL/Canvas or GPU-memory validation is implied. No user source or personal image is redistributed.
