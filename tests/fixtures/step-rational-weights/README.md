# STEP rational surface originals

Seven authored STEP sources retain SHA256, initial reader models, original weights, independent geomdl 5.3.1 surface output, and 80-digit Decimal Bernstein coordinates. steputils 0.1 parses all sources; this is lexical validity, not native CAD schema validation. Four sources lost their curved mesh before the fix; every original also received two extra flat triangles from its curved face boundary.

The high precision evaluation uses original decimal weights. geomdl agrees within 3.6e-15 for six cases; homogeneous-coordinate overflow for scale1e307 is explicitly retained. Its first exploratory setup mistakenly supplied Euclidean triples to weighted set_ctrlpts; that local failure is retained, with final reference setup using documented ctrlpts/weights properties. Source bytes are deterministic and immutable.

Reference geometry is a quadratic full-domain patch, with 13x13 samples and 288 grid triangles. Source corner boundary edges remain real geometry; they are not a separate flat face. Tests also retain a legitimate explicit planar sibling. No private or third-party binary files are redistributed. Complex trims and native CAD tessellation are not certified.
