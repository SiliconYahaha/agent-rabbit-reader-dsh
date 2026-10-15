# Visible Canvas public fixtures

Source: [web-platform-tests/wpt](https://github.com/web-platform-tests/wpt/tree/9bd47eefe9095a8464fdcce401747dcd737d1eec/html/canvas/element/drawing-images-to-the-canvas), fixed commit `9bd47eefe9095a8464fdcce401747dcd737d1eec`.

The three `2d.drawImage.*.html` files retain their original test bodies; only trailing blank lines were normalized. `red.png.base64` contains the exact upstream `images/red.png` bytes encoded as Base64. License is retained in `LICENSE`.

`scripts/verify-visible-canvas.js` runs those bodies with a small harness in native Chrome, preserves the original pixel assertion, records the drawing commands, then compares the entire RGBA output of the actual reader Page presenter. This verifies the replay boundary, **not** sandbox `fetch`/`createImageBitmap`, the complete WPT harness, WXML, or physical devices. The reference gallery image and stylesheet are not used as the oracle.

Local SHA-256:

| File | SHA-256 |
| --- | --- |
| 2d.drawImage.alpha.html | `2a696834cde1abebc7cd3c0f48f65836686f91df88f35caa83c9b8f1975ee8e8` |
| 2d.drawImage.clip.html | `65b85c6da9704e382cd3daa2dbfd511a7d3786ff27d83670e2c1c0969f7e399c` |
| 2d.drawImage.transform.html | `b6f8cac1d9c8d3bab2f131a08126e068f7a2280f91aa7d10cd57694d0b353599` |
| red.png.base64 | `7a9357fcce632bb1efa9ae55f98324375f9f8f7cdc98137c7562a29ee8ff3e49` |
| decoded red.png | `ef9ab918abed37fad8896c0fd05d597b8584acbb6a0efe855b4ed93b5a6d4604` |

Generated cases additionally cover 3/5/9-argument drawing, crop, transform, alpha, clipping, compositing, smoothing, gradients, dimension reset, real Page initial rendering and button updates. A real decoded-image notification is delayed until a newer frame has painted to check cancellation at the pixel boundary. Errors and resource limits have separate Node tests. No user originals or personal images are committed.
