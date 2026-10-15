# Canvas readback public tests

Source: [web-platform-tests/wpt pixel-manipulation](https://github.com/web-platform-tests/wpt/tree/9bd47eefe9095a8464fdcce401747dcd737d1eec/html/canvas/element/pixel-manipulation), fixed revision `9bd47eefe9095a8464fdcce401747dcd737d1eec`. The original bodies/expectations are retained; only trailing blank lines are normalized. The upstream BSD license is in `LICENSE`.

| File | Local SHA-256 |
| --- | --- |
| 2d.imageData.get.source.outside.html | `f2d15f49a6c6ce3d965478fe93a4dbfa2367d96f4d210fba9cb44893a94062eb` |
| 2d.imageData.get.unaffected.html | `838226d2b9f2129f5429d91c27321726f2dc0e187d93cb88109def563cfb4274` |
| 2d.imageData.get.nonpremul.html | `817d4452c512d75ee03afe159c3e86dd59f4bdc6882041db2fc26b8d908b1140` |

`scripts/verify-canvas-readback.js` verifies these hashes. A small synchronous harness supplies only the APIs those bodies use (`async_test`, `_addTest`, `_assert`, `_assertSame`, `_assertPixelApprox`). The same source runs in a native Chrome frame and in the real reader Page/script runtime, without rewriting test bodies, dropping assertions or replacing drawn content. Reference gallery images/styles are not used as the oracle. Runtime image requests are not needed by these three bodies.

The script compares the original assertion results and the entire visible Canvas pixel buffer. Sixteen generated files additionally compare the complete script-readback arrays, the Page drawing target and the PNG exported by author code, at initial load and after a Page button event (32 states). Geometry, alpha, gradients, clipping, negative/outside crops, ImageData editing/putback and blank size-copy creation are covered.

This is not a claim of complete ImageData/WebIDL conformance, full WPT infrastructure, WXML, Android or iOS coverage. DOMException identity, float16/display-p3 settings and long-running resource accounting remain separate requirements. No user original or personal image is stored here.
