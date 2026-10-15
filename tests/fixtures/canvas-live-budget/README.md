# Canvas live-allocation tests

Three unmodified WPT HTML files in `wpt.json`, pinned to
`9bd47eefe9095a8464fdcce401747dcd737d1eec`; source URL and exact SHA-256 included.
BSD-3-Clause, web-platform-tests contributors; full retained license:
[../visible-canvas/LICENSE](../visible-canvas/LICENSE).

The public assertion bodies run unchanged in independent Chrome and the reader
Page using a minimal synchronous harness. They assert transparent clearing after
different/same width assignment, and default width after attribute removal.
Every assertion and the full final Canvas pixel hash are compared.

Eight generated documents run forty resize cycles at load and again after a
button tap. Readback state, visible Canvas and decoded exported PNG are checked
against native Chrome, not a second invocation of the reader implementation.
Oversized concurrent surfaces and native refusal are covered by Node tests.
This does not claim GC-driven release, unlimited Canvas, GPU memory profiling,
all WebIDL dimension parsing, or physical iOS/Android conformance.
