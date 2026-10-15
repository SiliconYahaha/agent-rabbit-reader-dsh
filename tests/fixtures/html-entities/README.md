# Immutable character-reference sources

- `entities.json`: https://html.spec.whatwg.org/entities.json , retrieved 2026-08-31. WHATWG source-code portions use BSD-3-Clause; see `../../../miniprogram/utils/html-entities.LICENSE`. The generated name map preserves all 2231 entries, including legacy semicolonless names. Source bytes are SHA-256 pinned by `scripts/vendor-html-entities.js`. This source-data copy is used exclusively to generate and verify the source-code table.
- `entities.test`, `namedEntities.test`, `numericEntities.test`: html5lib/html5lib-tests commit `224991ec10db04f056a89eed8b0bd8695fd2950e`, under `tokenizer/`. MIT, copyright James Graham, Geoffrey Sneddon and other contributors; full notice in `html5lib.LICENSE`. Original bytes and expected outputs are unchanged.
- These independent tokenization corpora contain 80, 4210 and 336 cases. Tests compare actual DOM text/attributes, not tokenizer error lists or the whole HTML tree-building standard. Chrome checks independently exercise the same inputs and contexts.
- No user files, browser profile or credentials are included. Fixture files are outside the mini-program package.
- `.gitattributes` preserves original trailing blank lines in the numeric corpus and two license notices; only their EOF-blank whitespace check is disabled, not checks on project source. SHA-256 checks still enforce the original corpus bytes.

Generated bundled mp-html's entity decoder delegates to the shared HTML reference module. Its original MIT notice remains unchanged; static and dynamic reading must both pass content regressions.
