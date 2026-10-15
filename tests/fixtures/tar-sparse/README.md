# GNU PAX sparse original-byte regression

Authored deterministic archives cover sparse0.0/0.1/1.0 and five hole layouts. `before.json` retains the initial probe; `complete-before.json` additionally extracts each actual listed first member, including synthetic names. Neither baseline is rewritten. Generation and independent extraction are in `scripts/probe-tar-sparse.py`; current reproduction writes a separate output with `scripts/probe-tar-sparse.js`.

`tests/helpers/tar-sparse.js` adds malformed maps, output-size bounds, adjacent members and old GNU extension-map controls. `tar-sparse-image.js` creates a64x48RGB PNG with stored DEFLATE and sparse zero runs. `scripts/verify-tar-sparse-content.js` checks native body bytes, actual host selection/handoff/following HTML/recovery, and Chrome decoded pixel hashes. Node host uses wx stubs; it is not a WeChat preview or device test.

Source basis: https://www.gnu.org/software/tar/manual/html_chapter/Tar-Internals.html . All fixture bytes created here are authored for this repository; no private documents or third-party binaries are redistributed. Evidence and pending combinations are in `compatibility/runs/2026-09-13-tar-sparse.json`.
