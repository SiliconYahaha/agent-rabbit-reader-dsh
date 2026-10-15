# SVG path grammar corpus

Three Bootstrap icons pinned in sources.json retain the MIT license. Each original path is compared with a compact-flag variant and an invalid-tail variant. Native Chrome must confirm the explicit expected path has identical pixels before reader comparisons are accepted. Tests/helpers/svg-path-grammar.js also replays 64 prior failures and generates 22 syntax boundaries.

The Canvas reader grammar comparison is separate from native raster fidelity: all alpha differences remain recorded. WeChat tests read actual files and add constant opacity animation to exercise Canvas static paths; pure static SVG native image rendering is not the target of this gate. User originals remain in local ignored outputs and are not redistributed.
