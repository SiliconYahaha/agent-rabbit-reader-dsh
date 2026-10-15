# ZIP local identity reference files

Original files downloaded unchanged from Apache Commons Compress commit
`f8106cd28e8787c4c1e1efc90f5316b969681d8a`, under `src/test/resources/`:

- [utf8-winzip-test.zip](https://github.com/apache/commons-compress/blob/f8106cd28e8787c4c1e1efc90f5316b969681d8a/src/test/resources/utf8-winzip-test.zip): legacy byte names plus Unicode Path metadata. Three exact bodies pass. Display names must use the valid Unicode extension while local identity still compares original bytes.
- [archive_with_trailer.zip](https://github.com/apache/commons-compress/blob/f8106cd28e8787c4c1e1efc90f5316b969681d8a/src/test/resources/archive_with_trailer.zip): two XML bodies, terminal extra data does not invalidate local identity.
- [archive_with_bytes_after_data.zip](https://github.com/apache/commons-compress/blob/f8106cd28e8787c4c1e1efc90f5316b969681d8a/src/test/resources/archive_with_bytes_after_data.zip): central compressed lengths include the two bytes `03 00` after each real raw Deflate stream. Those bytes form one complete empty fixed-Huffman Deflate stream. The reader now accepts only complete zero-output trailing streams (at most four), after the first stream already matches the declared size, and still requires the central CRC. Python extracts the same bodies; raw7z emits both correct bodies but exits2; bsdtar exits1 without output. Random/truncated bytes and a second visible payload remain rejected.

Apache-2.0. Original [LICENSE](../zip-integrity/LICENSE.txt) and [NOTICE](../zip-integrity/NOTICE.txt)
from that same pinned upstream commit are retained in the adjacent fixture folder.
`samples.json` records original SHA-256 and independent per-member expected hashes.
No original file was modified, transcoded or repackaged; `.gitattributes` marks ZIP binary.

`node scripts/verify-zip-local-identity.js EXISTING_SCRATCH_DIR` runs installed Python3,
bsdtar and the pinned raw7zWASM, storing real exit codes and byte hashes. Raw7z files
are read directly from its virtual FS, not our archive-listing parser. Native fatal
exit codes are isolated in child processes, never cleared to disguise failure.

Python3.9 names the WinZip euro member `Ç_for_Dollar.txt` because it ignores Unicode
Path; the reader/raw7z display `€_for_Dollar.txt`. Byte hashes agree. This difference
is explicitly recorded, not called a three-engine filename match. bsdtar is recorded
as combined output (archive-order), not individual-member proof.

Normative references: [PKWARE APPNOTE](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT)
4.3.7–9, 4.4.17, 4.5.3 and 4.6.9; [CPython ZipFile.open](https://github.com/python/cpython/blob/v3.13.7/Lib/zipfile/__init__.py)
rejects conflicting local/central names. Do not compare display-normalized strings
or CRC32(name) alone instead of original filename bytes. Data-descriptor placeholder
CRC/sizes are not used as actual payload identity; ordinary CRC and size checks remain.

The generated fixtures cover60 normal/60 same-length local-name conflicts,6 localZIP64
variants,128 high CP437 bytes,65535-byte names and extra fields. Shared payload CRC
cannot make a mismatched local name acceptable. Node page tests verify rejection
before reading compressed payload or writing a temporary file, then successful text
retry and public XML bodies. WeChat UI/phone results remain pending.
