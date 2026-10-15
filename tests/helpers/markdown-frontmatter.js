'use strict'
// Deterministic boundary combinations; prior failures retain their exact bytes.
const cases = require('../../compatibility/runs/2026-09-05-next-markdown-frontmatter.json').results.map(c => ({ name: c.name, source: c.source }))
for (const opening of ['---', '--- \t']) for (const closing of ['---', '--- \t', '...', '...\t']) for (const newline of ['\n', '\r\n', '\r']) {
  const source = `${opening}\ntitle: Example\n${closing}\n# KEEP HEADER\n\nBODY\n`.replace(/\n/g, newline)
  cases.push({ name: 'line-combination-' + cases.length, source })
}
const edges = {
  'bom-empty-later-rule': '\uFEFF---\n---\n# KEEP HEADER\n\n---\nBODY',
  'empty-dot-eof': '---\n...',
  'empty-dash-eof': '---\n---',
  'unclosed-short': '---\ntitle: Example',
  'unclosed-opening': '---\n',
  'not-opening-eof': '---',
  'opening-suffix': '---suffix\ntitle: Example\n---\nBODY',
  'indented-opening': ' ---\ntitle: Example\n---\nBODY',
  'indented-close': '---\ntitle: Example\n ---\nBODY',
  'dot-suffix': '---\ntitle: Example\n...suffix\nBODY',
  'four-dots': '---\ntitle: Example\n....\nBODY',
  'unicode-line-separator': '---\ntitle: Example\u2028---\nBODY',
  'unicode-paragraph-separator': '---\ntitle: Example\u2029---\nBODY',
  'marker-before-unicode-separator': '---\ntitle: Example\n---\u2028BODY',
  'indented-scalar-markers': '---\ntitle: Example\nexample: |\n  ---\n  ...\n---\n# KEEP HEADER\nBODY',
  'body-code-fence': '---\ntitle: Example\n---\n```yaml\n---\nKEEP CODE\n...\n```\nBODY'
}
for (const [name, source] of Object.entries(edges)) cases.push({ name, source, ...(name === 'body-code-fence' ? { knownVisibleGap: 'Existing code renderer omits terminal code newline; identical before and after front-matter fix.' } : {}) })
module.exports = { cases }
