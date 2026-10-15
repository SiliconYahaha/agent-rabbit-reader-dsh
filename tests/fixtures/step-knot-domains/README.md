# STEP knot domain originals

Eight authored STEP sources retain original hashes, old reader models, original decimal knots and independent geomdl 5.3.1 surface points. The reference normalizes original knots affinely in 80-digit Decimal before evaluation; it does not copy reader coordinates. This preserves the same mathematical surface while avoiding reference double cancellation/overflow. Four affine controls agree exactly in the independently generated samples; repeated unequal-degree controls also agree.

Before repair, four originals had wrong or absent surfaces. The largest observed coordinate error was 0.8544 world units; the opposite-extreme domain lost its complete mesh. All eight now agree within 4.5e-15 on 1444 evaluated points, with exact mesh topology. Browser projection/style is shared with the viewer and is not an independent CAD renderer.

Five malformed originals retain observations from unchanged dependency commit4e40b3: two were silently healed by filtering nonfinite values; three returned no surface without error. They now explicitly fail and host recovery is required. Old zero-face assertions were strengthened to require errors. No private files; no native CAD schema, complex trim, or device certification.
