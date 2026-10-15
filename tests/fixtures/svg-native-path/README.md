# Native path rasterization samples

Three Bootstrap icons at pinned upstream commit 6945b7006285d444cc17ff2e22c7691719229526, with MIT license, hashes and expected visible content in sources.json. The user's three original files remain local and are not redistributed.

Run `npm run verify:svg-native-path` for 127 generated/earlier path cases plus 9 styled SVGs and these 3 complete icons. Raw paths use independent browser Path2D; complete SVGs use native SVG image decoding. Exact RGBA is required except the explicitly measured radial-bbox edge residual of one alpha channel by at most 4/255. All three unsupported-host failure variants must exactly match the existing fallback; transform-ignored hosts must not increase native-reference error beyond the fallback.

The renderer verifies SVG-string parsing, evenodd holes, arcs and optional addPath matrix semantics at runtime. Official WeChat typings do not promise the SVG-string constructor or addPath matrix overload. Unsupported hosts retain cubic fallback. Node cache tests cover 5000 animated values; they do not certify native/GPU memory limits. Curved clips and non-path primitives still use the earlier geometry; `--next` records 32 curved-clip mutations without treating discovered differences as regression passes.
