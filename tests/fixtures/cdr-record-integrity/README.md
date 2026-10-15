# CDR compressed record integrity

All committed sources are deterministic repository-authored triangles. No user files or Corel tutorial originals are redistributed.

- `before.json`: 24 sources, eight record scenarios × zlib levels 0/6/9. Original bytes, valid compression checksums and original reader results retained.
- `expanded-before.json`: 26 combinations of direct sizes, prefix/nested zeros, two colors/translations, odd unknown chunks and root/nested broken tails.
- `host-before.json`: actual Node reader loaded with original base file-inspector exports; original source hashes asserted.
- `native-reference.json`: raw and XHTML results from native libcdr 0.1.9 `cdr2raw`/`cdr2xhtml` on all 50 exact inputs. 35 valid drawings; eight anomalous files rejected; seven declared out-of-bounds files tolerated by native seeking. The latter still get explicit structural failure in the reader, not a false native-rejection claim.

Before: 25 valid files lost artwork and 15 anomaly contracts lacked clear failure (12 showed partial SVG, three showed no SVG without the structural reason). An interim oral count of 23 was corrected by counting preserved rows; no source or output was replaced.

After: 35 same-fit native artwork pixel comparisons and 15 structural-error contracts pass. The native converter supplies a default Letter page in points; the reader fits artwork in inches. The verifier explicitly maps page center and scale into the same source-declared content-fit view, retaining native path/style data. It independently asserts the native path coordinates and color first. These are artwork comparisons, not whole-page layout certification.

`tests/cdr-record-integrity.test.js` also checks the 2500-record/12-level bounds, true independent-thumbnail bytes, reopen recovery and late/detached reads. `scripts/verify-cdr-record-integrity.js` runs 50 actual host opens and Chrome checks; `--before` reads only the preserved old host evidence. No WeChat or physical-device claim.

Native syntax source: https://github.com/LibreOffice/libcdr/blob/77f52f694362ba0f01b3fdac6ebcc91e5debe400/src/lib/CDRParser.cpp#L565 . In-range size values are table indexes; larger values remain literal lengths. Zero padding can occur between records. This observation prevents a blanket invalid-index rejection from erasing supported content.

Corel CoffeeShop/final_logo originals were separately checked by their registered hashes. Their supported SVG output is unchanged; previously recorded text/bitmap/native visual gaps remain pending. Those licensed files and derived native artwork stay local.
