# Public reference samples

Upstream: web-platform-tests/wpt, commit `9bd47eefe9095a8464fdcce401747dcd737d1eec`.
License retained in `LICENSE`. Downloaded 2026-08-31; files below are unmodified
apart from final newline normalization. User artwork is NOT in this directory.

- `base64.json`: [upstream](https://github.com/web-platform-tests/wpt/blob/9bd47eefe9095a8464fdcce401747dcd737d1eec/fetch/data-urls/resources/base64.json).
  Its 80 base64 cases are used as independent byte/invalid-input expectations.
  Our cache tests prefix complete zero-byte quartets to cross the 8KiB threshold;
  this is a derivative cache test, not a claim that all WPT fetch tests pass.
- `data-url.html`: [upstream](https://github.com/web-platform-tests/wpt/blob/9bd47eefe9095a8464fdcce401747dcd737d1eec/html/semantics/embedded-content/the-img-element/data-url.html).
  v1.4.59 inspection found createElement('img') missing native load registration.
  v1.4.60 runs the original body via a small assertion adapter in Chrome/native
  and shim: load, Canvas draw, 400 RGBA byte checks and export now pass.
- `image-constructor.html`: [upstream](https://github.com/web-platform-tests/wpt/blob/9bd47eefe9095a8464fdcce401747dcd737d1eec/html/semantics/embedded-content/the-img-element/Image-constructor.html).
  v1.4.60 runs all five original cases: native 5 pass; shim 4 pass and one fails
  at `Image's prototype is Function.prototype`. The sandbox dynamic Function
  implementation has its own prototype; full NamedConstructor is NOT a pass.
- `image-decode.html`: [upstream](https://github.com/web-platform-tests/wpt/blob/9bd47eefe9095a8464fdcce401747dcd737d1eec/html/semantics/embedded-content/the-img-element/decode/image-decode.html).
  SHA-256 `104a4187ec29e0ddda96ca7bd9d1cae08d1050b9c024f2998c41ffefdb8f6ac4`.
  v1.4.60 runs unchanged bodies for PNG data URL, corrupt data and both empty-src
  creation paths (4 pass). External SVG/paths, srcset and cross-document cases
  remain unexecuted; resources are not rewritten to manufacture success.

Current scope also includes generated five-route native/shim decoded-pixel
comparisons. The adapter supplies only the assertion subset these cases need;
it is not the complete WPT runner. EncodingError is checked by name here, not
full DOMException interface conformance. No WeChat/device pass is claimed.
