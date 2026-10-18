# Inline Office reader

All output stays in the existing reader and file queue. There is no external-viewer fallback.

- Word: Mammoth 1.13.0 (DOCX/DOCM) and JSDoc at pinned commit (DOC). Text, basic tables and embedded DOCX images; desktop layout is not reproduced. Legacy DOC hidden runs are omitted through the semantic model.
- Excel: SheetJS 0.20.3. Visible cell values and merges, all sheets within limits; formulas use saved values. No chart/macro execution.
- PPTX: OOXML slide order, paragraph text, raster images and tables. Reflowed reading, not a precise slide renderer.
- PPT: latest UserEdit/PersistDirectory and current SlideListWithText only. Reads current slide text rather than scanning obsolete/deleted records. Binary pictures/layout are not rendered.

Bounds: 25 MiB source, 64 MiB expanded ZIP, 4096 members, no external XML entities, at most 200 slides, 100 sheets, 1000 rows / 50 columns per sheet and 40000 cells total. Limits and failures are visible in-page. Parser output is escaped/allowlisted before the existing HTML presentation pipeline.

Rebuild: `npm ci --ignore-scripts --prefix tools/office-runtime` then `node scripts/vendor-office-runtime.js`. Add `--fetch` to re-download pinned standalone sources with SHA-256 checks. The Word package uses a local timer adapter (no global mutation) and strict XML adapter. Third-party notices accompany vendored code. CLI-only argparse/sprintf-js advisories from Mammoth's install are not in the runtime bundle.

Node and WeChat DevTools checks are separate; neither proves physical-device compatibility.
