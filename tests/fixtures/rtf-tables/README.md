# RTF table and list text fixtures

These files test extracted **text**, not full RTF layout. `samples.json` keeps the
reader contract and both independent tool outputs separately. No output is
silently whitespace-collapsed to make mismatches disappear.

## Three public originals

Unmodified Apache Tika resources pinned to commit
`519866c7da5138d346a0ad982c29de996cd8cf46`:

- [testRTFTableCellSeparation.rtf](https://github.com/apache/tika/blob/519866c7da5138d346a0ad982c29de996cd8cf46/tika-parsers/tika-parsers-standard/tika-parsers-standard-modules/tika-parser-microsoft-module/src/test/resources/test-documents/testRTFTableCellSeparation.rtf)
- [testRTFTableCellSeparation2.rtf](https://github.com/apache/tika/blob/519866c7da5138d346a0ad982c29de996cd8cf46/tika-parsers/tika-parsers-standard/tika-parsers-standard-modules/tika-parser-microsoft-module/src/test/resources/test-documents/testRTFTableCellSeparation2.rtf)
- [testRTFListMicrosoftWord.rtf](https://github.com/apache/tika/blob/519866c7da5138d346a0ad982c29de996cd8cf46/tika-parsers/tika-parsers-standard/tika-parsers-standard-modules/tika-parser-microsoft-module/src/test/resources/test-documents/testRTFListMicrosoftWord.rtf)

These are ordinary-table/list regressions, **not public nested-table examples**.
Their SHA-256 values are checked in `samples.json`. Original bytes, line endings
and metadata are preserved; `.gitattributes` prevents text conversion.

Apache-2.0 applies; the upstream root `LICENSE.txt` and `NOTICE.txt` are included
without editing, including their additional notices. License SHA-256:
`ad5f4c4d0d4a04ac264ee55539191e1d36eb5d43ff63bbfc2cf97d541dc7ce8c`.
Notice SHA-256:
`407c430392d86b3eca6df93f62d9c07625f1968f4ed0bd68d817e00da44945aa`.
No Tika Java parser implementation is copied into the product.

The upstream license includes trailing spaces. Its file-scoped `.gitattributes`
exception preserves those bytes while leaving source-code whitespace checks
enabled; tests verify the exact license, notice and authored HTML hashes.

## Writer-generated nested table

`libreoffice-nested-source.html` is a self-authored, non-personal nested 2×2 table.
Its SHA-256 is
`f5c39b238fc6705cca0bc2903f4f304dbd04b0657237b06554eb2eb2794f4708`.
`libreoffice-nested.rtf` is the **unchanged output of actual LibreOffice Writer**,
not handwritten pseudo-RTF or a publicly sourced document. It contains four
`nestcell`, two `nestrow` and two `nonesttables` controls.

Generated and independently reopened on 2026-08-31 using LibreOfficeDev
26.8.0.0.alpha0 (`2c87e51eeaa2b413ff4ae097b2705eea1995d8e5`). Use an isolated,
explicitly created temporary profile and an empty output directory:

```sh
soffice -env:UserInstallation=file:///absolute/scratch/lo-profile --headless \
  --convert-to 'rtf:Rich Text Format' --outdir /absolute/scratch/converted \
  tests/fixtures/rtf-tables/libreoffice-nested-source.html
```

Re-export bytes may vary by software version; the checked-in RTF SHA-256 is the
test identity. Regeneration must produce a new reviewed identity, not overwrite
the baseline. The original was reopened into TXT and XHTML through Writer.

## Expected results and observed differences

- Ordinary and nested table text: preserve internal cell tabs, row newlines and
  subsequent body text, without duplicate `nonesttables` fallback. Compared with
  LibreOffice TXT, the reader additionally retains the final cell tab before a
  row newline. Tests remove **only** `\t\n` → `\n` for that stated comparison;
  the primary reader assertion remains exact. Cocoa emits one cell per line.
- The small second public table lacks full geometry. Both software TXT exports
  concatenate its two cells; this reader preserves the explicit `cell` separator.
  The [upstream Tika test](https://github.com/apache/tika/blob/519866c7da5138d346a0ad982c29de996cd8cf46/tika-parsers/tika-parsers-standard/tika-parsers-standard-modules/tika-parser-microsoft-module/src/test/java/org/apache/tika/parser/microsoft/rtf/RTFParserTest.java)
  independently requires separation between `Station` and `Fax`. That source was
  inspected, not executed as a Java test in this environment.
- The list sample preserves file-supplied `pntext`/`listtext`. Cocoa drops its
  markers; LibreOffice computes numbering, bullets and indentation from styles.
  These are recorded differences, not evidence of complete list rendering.
- The [Microsoft RTF 1.9.1 specification](https://officeprotocoldoc.z19.web.core.windows.net/files/Archive_References/%5BMSFT-RTF%5D.pdf)
  pp.94–96 and 108–109 define nested cells, the optional `nesttableprops` row
  destination and legacy `nonesttables` fallback; pp.84–85 explain literal list
  number text. File source CR/LF do not become body characters.

`scripts/verify-rtf-tables.js EXISTING_SCRATCH_DIR` runs Cocoa (`textutil`) and
LibreOffice TXT extraction against original bytes on macOS, using a fresh
isolated profile. Set `RTF_LIBREOFFICE` when `soffice` is not on PATH. It saves
tool versions, hashes, exact outputs and differences; a changed oracle output
fails for investigation rather than updating fixtures automatically.

The 75 synthetic cases in `tests/helpers/rtf-tables.js` exercise lexer/text
boundaries and hidden branches. Their abbreviated table definitions are not
full-layout fixtures; the Writer-generated file supplies real nested structure.

Empty-cell topology, merged cells, table widths, nested visual layout and
calculated list numbering remain unimplemented. Browser reconstruction checks
plain body visibility only. No current WeChat simulator or device result is
claimed by these files.
