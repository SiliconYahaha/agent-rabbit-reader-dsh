# SVG container bounds references

Four unmodified WPT SVG sources and their published references, pinned to
`d317428a65e0312e0a199d5db69591e252431dfe`. BSD-3-Clause; original source and
reference SHA-256 values are in sources.json. The source authors and reference
links remain in each original. This folder contains no private user originals.

The test helper normalizes viewport dimensions in memory only: 256 output pixels,
200 SVG units except objectboundingbox-002, whose original 400-unit percentage
viewport is preserved. Expected content is the published green square/circle.
The 51 generated cases in tests/helpers/svg-container-bounds.js use Chrome DOM
getBBox and independently specified Canvas Path2D paints; production bounds never
supply their expected geometry. Current Chrome 55/55 full RGBA results are exact.

Run `npm run verify:svg-container-bounds`. `--baseline --discover` compares the
same cases with v1.4.104. `--input-file file.json --discover` runs additional inputs.
The next 32 failed viewport variants and inputs are recorded in compatibility/runs.

WeChat: `node scripts/verify-svg-container-bounds-wechat.js /tmp/svg-bounds-wx
outputs/svg-container-bounds/report.json --discover` records all actual imports.
Default strict mode rejects any pixel difference. On SDK 3.16.2, 23/25 are exact;
WPT rectangle 001/002 retain four-corner AA differences at 1170 device pixels.
Do not count those as exact or treat DevTools as a physical-device result.
