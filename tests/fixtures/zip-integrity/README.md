# ZIP integrity reference fixtures

Seven unchanged Apache Commons Compress archives, pinned to commit
`f8106cd28e8787c4c1e1efc90f5316b969681d8a`:

- [bla.zip](https://github.com/apache/commons-compress/blob/f8106cd28e8787c4c1e1efc90f5316b969681d8a/src/test/resources/bla.zip): two Deflate XML files.
- [bla-stored.zip](https://github.com/apache/commons-compress/blob/f8106cd28e8787c4c1e1efc90f5316b969681d8a/src/test/resources/bla-stored.zip): the same two XML files, stored.
- [mixed.zip](https://github.com/apache/commons-compress/blob/f8106cd28e8787c4c1e1efc90f5316b969681d8a/src/test/resources/mixed.zip): stored and Deflate copies of a 48,891-byte text.
- [bla-stored-dd.zip](https://github.com/apache/commons-compress/blob/f8106cd28e8787c4c1e1efc90f5316b969681d8a/src/test/resources/bla-stored-dd.zip): signed-descriptor fixture with stale directory offsets; recovered in candidate1.4.56, with both body hashes verified against the normal counterpart.
- [bla-stored-dd-nosig.zip](https://github.com/apache/commons-compress/blob/f8106cd28e8787c4c1e1efc90f5316b969681d8a/src/test/resources/bla-stored-dd-nosig.zip): unsigned-descriptor variant, same two recovered bodies.
- [bla-stored-dd-sizes-differ.zip](https://github.com/apache/commons-compress/blob/f8106cd28e8787c4c1e1efc90f5316b969681d8a/src/test/resources/bla-stored-dd-sizes-differ.zip): contradictory descriptor sizes, explicitly rejected.
- [bla-stored-dd-contradicts-actualsize.zip](https://github.com/apache/commons-compress/blob/f8106cd28e8787c4c1e1efc90f5316b969681d8a/src/test/resources/bla-stored-dd-contradicts-actualsize.zip): descriptor/body-size disagreement, explicitly rejected.

Apache-2.0; upstream LICENSE and NOTICE are preserved. SHA-256 values:

- LICENSE: `51b88fd3e9e24edcdce1dd145a4fca2dcd12911407f00b06dfa6ff600f9733c1`
- NOTICE: `5318998af3591f72e0e3e80667d32ba334c080399011a767f93e611d907036ca`

Archive identities, individual entry sizes and independently extracted SHA-256
values are in `samples.json`; `.gitattributes` prevents archive byte rewriting.
No Apache Java parser is copied or executed. Expected hashes were obtained from
CPython zipfile and independently checked with bsdtar/libarchive and 7-Zip WASM.
All six entries in the first three files match, without whitespace normalization.

In candidate1.4.55 the fourth file was an explicitly retained gap, not converted
into a valid sample. The reader rejected its directory, CPython could list it but rejected the
first local header, bsdtar reports a damaged archive, and 7-Zip exits 2. Upstream
[ZipArchiveInputStreamTest](https://github.com/apache/commons-compress/blob/f8106cd28e8787c4c1e1efc90f5316b969681d8a/src/test/java/org/apache/commons/compress/archivers/zip/ZipArchiveInputStreamTest.java)
expects a sequential reader to recover the first 610-byte entry when stored-data
descriptor support is enabled. Candidate1.4.56 adds narrow safe recovery: signed
and unsigned originals yield both XML bodies with exact SHA-256 values matching
the normal counterpart read independently by all three tools. Those tools still
reject the malformed originals; this is **not** a three-engine same-file recovery
pass. No Java test ran. Both size-contradiction originals remain rejected.

For the signed original, the physical central directory is842 but EOCD says826;
the second local header is693 but the central record says677. The first remains0.
Recovery starts at byte0 and requires complete sequential local/central identity,
exact cumulative omitted-descriptor accounting, exact sizes, bounded inflation,
and every CRC. It patches only an owned in-memory central-directory copy.
Limits:8MiB archive,500 records,20MiB total decoded output. No arbitrary offsets,
SFX prefixes, reordered records, ZIP64, split or encrypted archives are repaired.

`tests/helpers/zip-integrity.js` independently constructs 60 records using Node
native zlib, not the product inflater. Method 0/8, signed/unsigned descriptors,
UTF-8 body and compression strategies retain exact payloads. The matching 60
CRC-zero corruptions must fail, while empty files and `9d0ad96d` (a genuine
nonempty CRC32-zero payload, confirmed with Python zlib) must succeed.

The format references are [PKWARE APPNOTE 6.3.10](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT)
sections 4.1.5, 4.3.8–9 and 4.4.7–9, and [RFC1951](https://www.rfc-editor.org/rfc/rfc1951).
The central CRC is mandatory for this unencrypted fast path; zero is a value,
not absence. Descriptor-mode zeroes in the local header are not used as the
expected checksum. A zero-size member without file data is permitted.

Run `node scripts/verify-zip-integrity.js EXISTING_SCRATCH_DIR` with Python3 and
bsdtar available (`ZIP_PYTHON` / `ZIP_BSDTAR` may specify configured executable
paths). The report records raw hashes and each independent result. Native 7-Zip
error handling runs in a separate process to retain its real failure exit code.

The raw inflater rejects trailing whole bytes after the final Deflate block;
Node zlib accepts them. This is a documented stricter integrity policy, not a
claim of complete native parity. The 16,384-block and 32 MiB decoder ceilings
remain in force; ordinary ZIP preview is capped at 20 MiB per entry. No WeChat
simulator/device outcome is implied by these Node and reference-tool tests.
