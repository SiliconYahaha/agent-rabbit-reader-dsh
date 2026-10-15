# Old GNU sparse original-byte regression

All archive bytes are authored deterministically by scripts/probe-tar-oldgnu.js. Python tarfile and system bsdtar independently restore all9 logical bodies. The original native engine silently omits7 members with byte-granular lengths/offsets, including extended maps, while2 aligned/empty controls remain exact.

before.json is the actual baseline, explicitly run with TAR_OLDGNU_ENGINE_ROOT pointing at the clean canonical main original runtime (Brotli WASM SHA25686948951fad4b26b0226af791b1ec058e0315585c16bf1220444dba115f37071). first-fixed-probe.json retains an earlier measurement made after the background build had already completed; it is a fixed result, not baseline evidence. Both preserve source hashes, expected bodies and independent extraction results.

The new helper adds invalid extension flags/numbers, truncation, overlaps and inconsistent packed lengths. Tests also check65536zero-map records and20MiB logical output boundaries. verify-tar-oldgnu-content.js checks three authored PNG storage layouts, Python/bsdtar bytes, Chrome pixel hashes, Node actual host handoff/repeated opens/followingHTML and stale callbacks. It does not claim WeChat UI or device execution.

Format reference: https://www.gnu.org/software/tar/manual/html_chapter/Tar-Internals.html . No private files or third-party sample binaries are redistributed.
