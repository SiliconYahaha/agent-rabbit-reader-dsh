# DXF grid traversal originals

`before.json` retains 11 authored, saved/re-read ezdxf 1.4.4 originals with their source hashes, native LINE coordinates and original reader failures. Cases cover 21 rows/columns, 21x21, 1200/1201 primitives, coincident zero spacing, and 7/64/65 nested blocks. There are no nested grids in these chain cases, so the prior ezdxf nested-grid convenience discrepancy does not apply.

Nine files now match complete native geometry. The 1201-line file retains its complete reference; policy explicitly displays first 1200 with truncation metadata. The 65-level file retains native content but explicitly fails the reader's depth limit. Neither is counted as complete native rendering.

`adversarial-before.json` retains six minimal authored inputs and isolated process observations. Three previously exceeded a 2-second cap: cycles and exponential empty/unsupported block expansion. Limits protect the reader, and recovery remains required. No private files are included. Regeneration can change DXF metadata; retained bytes are authoritative.
