# SVG path animation corpus

`tests/helpers/svg-path-morph.js` generates 33 normal/invalid/boundary cases and 32 dimension/timing mutations. Three real WPT files in `public/` are pinned with SHA-256, source URLs and BSD-3-Clause licensing in `public/sources.json`; their license is retained. Upstream files are tentative. Our Chrome oracle extracts literal path and animate attributes plus original sample times, without executing the upstream WPT harness.

Run `npm run verify:svg-path-morph` for the permanent 68-case corpus. Pass an output directory and a local SVG directory to the script to add user originals. Full user SVGs and derived paths have unknown redistribution rights and stay in ignored local outputs. Public run records contain only file identities, hashes and measurements.

Expected content is continuous intermediate geometry for compatible SMIL path commands and native discrete switching for incompatible commands. Invalid animation values preserve the base path. Geometry, native serialization drift and Canvas pixel differences are separate measurements. Pixel differences and physical iOS/Android results remain open; a geometry pass does not establish full SVG fidelity.
