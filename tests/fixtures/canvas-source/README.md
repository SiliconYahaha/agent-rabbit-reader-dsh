# Canvas image-source public tests

Source: [web-platform-tests/wpt drawing-images-to-the-canvas](https://github.com/web-platform-tests/wpt/tree/9bd47eefe9095a8464fdcce401747dcd737d1eec/html/canvas/element/drawing-images-to-the-canvas), fixed commit `9bd47eefe9095a8464fdcce401747dcd737d1eec`. Original bodies and all expectations are retained; only trailing blank lines are normalized. The upstream BSD license is in `LICENSE`.

| File | Local SHA-256 |
| --- | --- |
| 2d.drawImage.canvas.html | `70df9143b8b1bc8e26ad53c131c0105d1873768b509548cfdc6411bd0fb532d4` |
| 2d.drawImage.self.2.html | `bdd096392d264a352bc419b2eaab1bee8390f8d2561c2bfd7af1ec0417596e70` |
| 2d.drawImage.zerocanvas.html | `3cfc2aef5d707fc9254413f192269d60116bed7245054113ffe628c9e0ed103d` |

`scripts/verify-canvas-source.js` enforces these hashes. The small synchronous harness supplies only the original bodies' APIs (`async_test`, `_addTest`, `_assert`, `_assertSame`, `_assertPixelApprox`, `assert_throws_dom`). It executes the same unmodified bodies in native Chrome and the real reader Page/script runtime. The first test uses a detached HTMLCanvas and a blank canvas without a prior context; the second covers self-overlap; the third retains all three zero-area exceptions. Gallery images/CSS are not the oracle. The separate transferred OffscreenCanvas/MessageChannel test is not selected or claimed supported.

For each host mode, 16 generated files run at initial load and after a real Page button event (32 states). Three-argument, five-argument and cropped draws, out-of-range crops, negative sizes, transformations, alpha, clipping, source mutation/reset/removal and self-overlap compare script readback, actual Page drawing target and author PNG against native Chrome. SHA-256 covers every RGBA byte, not sampled pixels.

The complete suite runs twice: native `toDataURL`, then an actual native Canvas host without that method, forcing the reader's pixel PNG encoder. This totals 64 generated states and two executions of each of the three public files. It does not prove complete WebIDL, WXML, Android, iOS, WebGL sources, transferred OffscreenCanvas, readiness of broken images, ICC/float16 precision, patterns, or unbounded animation. No user original or personal image is redistributed.
