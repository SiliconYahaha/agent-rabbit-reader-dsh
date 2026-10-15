# RTF note references

These files are generated specifically for this project and contain no private input.

- `writer-notes.fodt` is the authored source for `writer-notes.rtf`. It contains two paragraphs of footnote text, an endnote, and a custom `*` reference. LibreOfficeDev 26.8.0.0.alpha0 exported the RTF; its SHA-256 is pinned in the test. Actual PDF pages were independently inspected. Writer emits known starred footnote destinations.
- `writer-numbering-base.rtf` is a second actual Writer export with two simple automatically numbered footnotes. The deterministic helper varies only its explicit document/section numbering controls. This complete structure revealed the repeated-letter and four-symbol numbering rules that Writer's minimal RTF import did not apply.
- `../rtf-notes-reference.json` retains actual PDF text and every mismatch classification. It does not certify page layout or whitespace. Core, component and Chrome comparisons independently check exact note text and reciprocal references.

Reproduce the native observations with `RTF_SOFFICE=/path/to/soffice RTF_PYTHON=/path/to/python-with-pypdf npm run verify:rtf-notes -- outputs/rtf-notes-reference --writer`. The command writes new observations to outputs; it does not overwrite the retained fixture. Normal `npm run verify:rtf-notes` validates the retained source identities and all expected content contracts.
