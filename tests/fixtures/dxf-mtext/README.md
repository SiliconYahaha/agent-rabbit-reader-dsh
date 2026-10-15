# DXF MTEXT original content and drawing contracts

All 46 files are authored for this repository and exported with ezdxf 1.4.4. They contain no user data, external images or external font files. `samples.json` stores gzip/base64 original bytes plus SHA-256; uncompress before using the DXF parser. ezdxf fixed-metadata mode makes the 40-case main corpus byte-identical across two independently generated runs. Existing earlier timestamped exploratory files remain in ignored outputs.

Generation:

- `python scripts/probe-dxf-mtext.py <output>`: 20 fixed cases, R2000 and R2007, 40 documents, zero independent audit errors.
- `python scripts/probe-dxf-mtext-roles.py <output>`: six TEXT/MTEXT role and MTextEditor tolerance cases, including actual independent SVG drawings. Drawing requires Pillow as well as ezdxf.
- `node scripts/probe-dxf-mtext-reader.js <output>`: checks retained original hashes, opens all 46 through the actual Node reader host and saves actual preview SVG labels. This is a discovery probe, not a compatibility pass gate.

## Independent-reference audit

Autodesk documents escaped braces/backslashes, nonbreaking space, paragraph controls, character formatting and stacks:

- https://help.autodesk.com/cloudhelp/2025/ENU/AutoCAD-Core/files/GUID-7D8BB40F-5C4E-4AE5-BD75-9ED7112E5967.htm
- https://help.autodesk.com/cloudhelp/2026/ENU/OARX-DevGuide-Managed/files/GUID-ECEEF65E-C327-44B8-AFB9-C0ACA2CAEF55.htm

Do not blindly use `plain_text` as the visual reference:

- Its slow path turns nonbreaking space into ordinary space; its fast path retains the control. The official requirement is U+00A0.
- Ordinary CIF Unicode requires decoding, but applying that helper after collapsing an escaped literal backslash wrongly turns literal `\U+0041` into `A`.
- Stacked fractions need numerator/denominator positions and a divider, not an ambiguous string such as `11/2` or `11#2`. Actual independent drawing SVGs were rendered and inspected for these cases.
- The published tolerance example without a space after `^` becomes `k` in ezdxf's caret decoder. Its own `MTextEditor.stack` adds a space: `\S+0.010^ -0.000;`. The editor-authored six-case supplement establishes a usable stack reference; the original no-space conflict remains separate.
- Unknown and unterminated controls differ between fast and slow extraction. Preserve original content or explicitly explain unsupported input rather than deleting arbitrary backslash-to-semicolon substrings.
- A plain TEXT `A\PB` must retain `\P`; the identical MTEXT source represents two paragraphs. Parsing must remain type-scoped.

Preserved pre-repair baseline: 30 certified main-corpus content checks, 28 wrong; 10 cases separately track reference/input-policy uncertainty. Six supplemental role/stack cases add concrete path requirements. That baseline is retained unchanged in the exploration record. Native CAD application, WeChat WXML and physical-device validation have not been performed.

## Local repair verification

`node scripts/verify-dxf-mtext.js` opens these 46 originals plus three boundary cases through the actual Node reader host and renders its returned SVG in Chrome. The 49 views verify content, bounds, style restoration, paragraph spacing and stack position/dividers. `tests/dxf-mtext.test.js` also covers source splitting, bounded malformed input and recovery/stale callbacks. See `compatibility/runs/2026-09-13-dxf-mtext.json`. This candidate has not been released. Basic formatting support does not imply exact CAD fonts, wrapping, alignment or device fidelity.
