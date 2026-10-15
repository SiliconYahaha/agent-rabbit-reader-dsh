# DXF MINSERT spacing and independent reference audit

before.json retains16authored R12/R2007 originals, their initial readerSVG line coordinates and ezdxf1.4.4 recursive_decompose results. Twelve drawings with scaled/mirrored/rotated/nested grids are wrong; four unit/single controls are exact. Source bytes and hashes are immutable regression input.

reference-review.json adds a second independent native-library path: expand child arrays in their own coordinates, then transform leaf entities using the parent's matrix44. The original convenience path and this path agree on14drawings. For2nested drawings, Insert.transform changes block scale but leaves row/column spacing unchanged before recursive_decompose expands it. Child column spacing12 under parent uniform1.25 must become15worldunits; the convenience path incorrectly gives12. Both outputs are retained and the analytical distance check is a test.

The first reference review regenerated files, whose metadatahashes differed despite fixed-meta option. Final review explicitly reads original retained bytes, reproduces the initial convenience results exactly, and verifies all16source hashes. Use scripts/review-dxf-insert-grid-reference.py for exact original-byte reanalysis. Geometry generation is deterministic; regenerated DXF GUIDs may vary.

ActualSVG coordinates serialize to4decimalplaces, so comparison uses0.000051world-unit tolerance (half a quantization unit). It is not a screenshot tolerance or a claim of allDXF support. All drawings are authored for this repository; no private or third-party binary files are redistributed.
