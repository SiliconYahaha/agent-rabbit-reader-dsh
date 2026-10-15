# Inline cache recovery oracles

Three unmodified PNG files from web-platform-tests, pinned to commit
`9bd47eefe9095a8464fdcce401747dcd737d1eec`. `wpt-images.json` stores exact
source bytes as base64, source URLs, sizes and SHA-256 hashes.

License: BSD-3-Clause, copyright web-platform-tests contributors; the full
retained license is [../visible-canvas/LICENSE](../visible-canvas/LICENSE).

Expected: red/green images are 100×50; `2x2.png` is a 512×512 quadrant image.
Chrome independently decodes source and recovered cache output and compares
every RGBA byte. WeChat decodes recovered native files with OffscreenCanvas.
Tiny PNGs explicitly force cache materialization; the generated valid PNG in
the Page gate also tests the ordinary >8 KB path and the real retry button.
The initial I/O failure is deliberately injected, not claimed to be a native
platform incident. User artwork is never included or uploaded.

The same three pinned source images also cover interrupted cache lifecycle:
`verify-inline-cache-recovery.js` compares another four cold-module restart
outputs against source pixels with a simulated disk quota fitting one image.
`verify-inline-cache-lifecycle-wechat.js prepare` leaves actual native files
alive; restart the DevTools JS runtime, then run `finish` with the Chrome report.
It requires the old App object to be gone while the original bytes persist,
checks orphan removal and active-lease preservation, decodes all four images,
and taps the real WXML button across three opens. This is not physical-device,
chat-picker or automator screenshot-quota evidence.
