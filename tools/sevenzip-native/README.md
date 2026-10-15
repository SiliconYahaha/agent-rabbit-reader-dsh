# Reproducible 7-Zip native listing bridge

The 7-Zip CLI deliberately replaces control characters in filenames before
printing them. `7z l -slt` is therefore not a lossless member identity protocol.
This build leaves normal terminal output unchanged and adds structured callbacks
before escaping: listing begin/end, native member index/path/directory, nine typed-property string values, and two exact unsigned attribute fields.
API 2 also exposes bounded raw extraction through an optional binary callback,
selected by native index before the decoder chooses its solid-block endpoint; Unix symlinks never become host filesystem links.
API 3 additionally preserves the native Characteristics property. The pinned TAR
handler puts its type flag first; this distinguishes an empty-target hard link
from a legitimate empty regular file even though Hard Link is omitted for an
empty target. The local TAR parser extension also reconstructs GNU PAX sparse
0.0/0.1/1.0 files through the existing native sparse stream. It preserves logical
sizes and names, consumes aligned 1.0 maps before packed data, and validates
ordered nonoverlapping extents and exact packed sizes. Maps are limited to
65,536 entries; the existing selected logical output limit is checked before
extraction. Invalid sparse input returns a hard parse failure so archive
autodetection cannot skip its PAX header and expose condensed bytes as a file.
PAX scalar/map duplicates use the last value; 0.0 offset/length pairs retain
their defined order. No extraction codec is replaced.

The local old GNU TAR sparse parser also accepts byte-granular
extent offsets and lengths, while retaining 512-byte archive record handling.
It validates the packed byte total and bounds maps to 65,536 records (including
zero-length records). Invalid sparse maps return a hard parse failure so native
autodetection cannot silently skip the member and reopen at a later header.
The existing sparse stream restores holes; no extraction codec is replaced.
Selected logical output remains limited to 20 MiB before extraction.

Sources (fixed, not latest):

- 7-Zip 24.09: `e5431fa6f5505e385c6f9367260717e9c47dc2ee`, https://github.com/ip7z/7zip/tree/24.09
- 7z-wasm 1.2.0 build patch: `521d2cf93f5964f4e77b01049e19f1b29305c454`, https://github.com/use-strict/7z-wasm/tree/521d2cf93f5964f4e77b01049e19f1b29305c454
- Emscripten 4.0.10, SDK commit `62a853cd3b3134398ce85cde8bb5cbb2ef0194cb`, SDK release `8103ffedfb0c42d231c6af6859a5a1a832260b43`.
- Local modifications are entirely in `native-listing.patch`; `7zz-emcc.patch`
  is the upstream platform patch, without changes to its contents.

Activate an isolated Emscripten 4.0.10 SDK **in the current shell only**, then run:

```sh
node scripts/build-sevenzip-native.js
npm run check
```

The script clones and verifies the pinned source in a fresh temporary build
directory, applies both patches, compiles, adapts the JS glue for WXWebAssembly,
and writes the checked-in runtime plus SHA-256 manifest. It does not change
shell startup files or install a global SDK. Retains the build directory for
inspection; no automatic deletion. Normal `vendor:formats`/CI verifies artifacts
and patches against the manifest; it must never overwrite them with npm binaries.
`--package-built <Alone2/_wasm>` only packages an already equivalent local build.

License: native 7-Zip code is GNU LGPL 2.1 or later plus the upstream unRAR
restriction. The runtime ships `LICENSE-7ZIP`, `LICENSE-UNRAR`, and `NOTICE-7ZIP`.
The pinned upstream source + both full patches + rebuild script provide the
corresponding source and relinking instructions; no proprietary kernel is used.

Safety: 10,000 native items, 65,536 characters per field and 2 Mi characters total
metadata. Missing/duplicated callbacks, NUL, invalid sizes/CRC, incomplete native
listing and oversized metadata fail explicitly. Native indices can have gaps
(7-Zip auxiliary streams) and are not confused with sorted UI row indices.
Existing path, CRC, selected-member size and duplicate-ordinal checks remain.
This is not a claim that all solid archives have bounded decompressor memory.

Repeated calls: the local post.js wrapper saves/restores the WASM stack around
every synchronous callMain, including exceptions. Emscripten 4.0.10 callMain
allocates argv on the stack without restoring it. The wrapper prevents cumulative
stack exhaustion during listing and multi-hop link reads. stackSave/stackRestore
are exported explicitly by the rebuild script. Binary member capture checks its
remaining byte budget (4096 for 7z link data, the selected file limit for TAR) before copying each native byte span; original member
size and CRC remain mandatory when declared.
