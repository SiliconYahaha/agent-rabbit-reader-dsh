# Design package regression sources

These fixtures exercise saved-preview extraction, not complete canvas rendering. They are not bundled in the mini-program or presented as gallery artwork.

- `circle.fig`: [OpenFig-org/openfig-core](https://github.com/OpenFig-org/openfig-core/blob/0d67354fcd6d14c37b89c42f55330faf0a79e1ce/test-fixtures/circle.fig), revision `0d67354fcd6d14c37b89c42f55330faf0a79e1ce`. Original 32,231 bytes. SHA-256 `5f8d89ce07c06615323ad5406cacc41e8da78d8fc0439ad0cdb2c2ba7e0d4038`. Upstream declares MIT in its `package.json`, retained as `openfig-package.json`; no separate LICENSE file was present. Attribution: OpenFig contributors. This is a third-party real FIG fixture, not Figma's official sample.
- `image.sketch`: [Sketch's assistant utilities](https://github.com/sketch-hq/sketch-assistant-utils/blob/4fc1c8173a5325c205499bd243a74ccbad8ca002/src/get-image-metadata/__tests__/image.sketch), revision `4fc1c8173a5325c205499bd243a74ccbad8ca002`. Original 1,326,617 bytes. SHA-256 `af7783fc7afe8fd1e17282f19cf5ec8caa58136e02f1af5531decc9babc30b0a`. MIT license retained in `sketch-assistant-utils-LICENSE.txt`.

Checks independently unzip with `fflate` and decode the author-saved PNG with `pngjs`. DevTools additionally verifies the actual written preview bytes, native image dimensions, WXML image visibility, queue switching and recovery from an invalid document.
