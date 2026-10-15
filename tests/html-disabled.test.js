'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto')
const { createRuntime } = require('../miniprogram/file-reader/document/html-runtime/html-script-runtime')
const { renderHtmlDomTree } = require('../miniprogram/file-reader/document/document-renderer')
const { samples, sourceFor, styles } = require('./helpers/html-disabled')
const reference = require('./fixtures/html-disabled-reference.json')
const { loadReaderHost } = require('./helpers/reader-host')
const normalize = value => JSON.parse(JSON.stringify(value).replace(/rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)/g, 'rgb($1,$2,$3)'))
function find (nodes, id) { for (const node of nodes || []) { if (node.nid === id || node.attrs && node.attrs.id === id) return node; const child = find(node.children, id); if (child) return child } }
const tick = () => new Promise(resolve => setImmediate(resolve))

for (const group of ['checkbox', 'text', 'radio', 'textarea', 'select', 'submit', 'reset', 'fieldset', 'option', 'optgroup', 'div', 'output']) {
  test(`disabled ${group}: native script behavior, form entries, CSS and host flags`, () => {
    for (const sample of samples.filter(sample => sample.name.startsWith(group + '-'))) {
      const runtime = createRuntime(sourceFor(sample))
      try {
        runtime.run(); assert.deepEqual(runtime.errors, [])
        const actual = normalize(JSON.parse(runtime.document.getElementById('out').textContent)), expected = reference.results.find(r => r.name === sample.name).expected
        assert.equal(reference.results.find(r => r.name === sample.name).sourceSha256, crypto.createHash('sha256').update(sourceFor(sample)).digest('hex'))
        assert.deepEqual(actual, expected, sample.name)
        const node = find(renderHtmlDomTree({ document: runtime.document, styles: [styles] }).nodes, 'target')
        assert.match(node.attrs.style, new RegExp('color:' + expected.before.color.replace(/[()]/g, '\\$&')), sample.name)
        if (sample.hostControl) assert.equal(node.attrs.disabled !== undefined, expected.before.disabled, sample.name)
        assert.equal(runtime.document.getElementById('target').hasAttribute('disabled'), expected.before.own, 'host inheritance must not mutate source DOM')
      } finally { runtime.destroy() }
    }
  })
}

test('disabled state updates through nested fieldsets, legend reorder and DOM moves', () => {
  const retained = require('../compatibility/runs/2026-09-05-next-html-disabled-fieldset.json').dynamic
  const runtime = createRuntime(retained.source)
  try { runtime.run(); assert.deepEqual(runtime.errors, []); assert.deepEqual(JSON.parse(runtime.document.getElementById('out').textContent), retained.results.map(r => r.native)) } finally { runtime.destroy() }
})

test('disabled controls reject queued host input but programmatic changes and dispatchEvent remain usable', () => {
  const runtime = createRuntime('<fieldset disabled id="fs"><input id="t" type="checkbox" name="x" checked><input id="text" value="before"></fieldset>')
  try {
    runtime.run(); const target = runtime.document.getElementById('t'), text = runtime.document.getElementById('text'); let events = 0
    target.addEventListener('click', () => events++)
    assert.equal(runtime.dispatchTap(target._nid), false)
    assert.equal(runtime.syncInput(target._nid, { checked: false }, 'change', true), false)
    assert.equal(runtime.syncInput(text._nid, { value: 'wrong' }), false)
    assert.equal(target.checked, true); assert.equal(text.value, 'before'); assert.equal(events, 0)
    target.checked = false; text.value = 'script'; assert.equal(target.checked, false); assert.equal(text.value, 'script')
    runtime.dispatchEvent(target._nid, 'click'); assert.equal(events, 1)
    runtime.document.getElementById('fs').disabled = false
    assert.equal(runtime.syncInput(target._nid, { checked: true }, 'change', true), true); assert.equal(events, 2)
  } finally { runtime.destroy() }
})

test('actual reader component preserves disabled controls over file switches and delayed host callbacks', async () => {
  const { reader } = loadReaderHost({ getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, pixelRatio: 1 }) })
  try {
    for (const sample of samples.filter(sample => sample.hostControl)) {
      reader.openSelectedFile({ name: sample.name + '.html', inlineHtml: sourceFor(sample) }); await tick(); await tick()
      assert.equal(reader.data.error, '', sample.name); assert.equal(reader.data.domMode, true)
      const target = reader._htmlRuntime.document.getElementById('target'), expected = reference.results.find(r => r.name === sample.name).expected
      assert.equal(find(reader.data.domTree, target._nid).attrs.disabled !== undefined, expected.before.disabled, sample.name)
      if (target.localName === 'input' && target.type === 'checkbox' && expected.before.disabled) {
        reader.onDomChoiceChange({ currentTarget: { dataset: { nid: target._nid, kind: 'checkbox' } }, detail: { value: [] } })
        assert.equal(target.checked, true, sample.name)
      }
    }
    const stale = reader._htmlRuntime.document.getElementById('target')._nid
    reader.openSelectedFile({ name: 'recovery.html', inlineHtml: '<input id="new" value="new file">' }); await tick(); await tick()
    reader.onDomInput({ currentTarget: { dataset: { nid: stale } }, detail: { value: 'old event' } })
    assert.equal(reader._htmlRuntime.document.getElementById('new').value, 'new file')
  } finally { reader.disposeHtmlRuntime() }
})

test('optgroup structure, visible options, selection indexing and disabled choice rejection share one path', async () => {
  const { reader } = loadReaderHost({ getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, pixelRatio: 1 }) })
  try {
    reader.openSelectedFile({ name: 'groups.html', inlineHtml: '<form id="f"><select id="s" name="choice"><optgroup disabled label="Closed"><option value="a">Closed A</option></optgroup><optgroup label="Open"><option value="b" selected>Open B</option><option value="c">Open C</option></optgroup></select></form>' }); await tick(); await tick()
    const select = reader._htmlRuntime.document.getElementById('s'), node = find(reader.data.domTree, select._nid)
    assert.equal(select.options[0].parentNode.localName, 'optgroup')
    assert.deepEqual(node.options.map(o => o.label), ['Closed A', 'Open B', 'Open C'])
    reader.onDomSelect({ currentTarget: { dataset: { nid: select._nid } }, detail: { value: '2' } }); assert.equal(select.value, 'c')
    reader.onDomSelect({ currentTarget: { dataset: { nid: select._nid } }, detail: { value: '0' } }); assert.equal(select.value, 'c')
    reader.onDomSelect({ currentTarget: { dataset: { nid: select._nid } }, detail: { value: '99' } }); assert.equal(select.value, 'c')
    select.disabled = true
    reader.onDomSelect({ currentTarget: { dataset: { nid: select._nid } }, detail: { value: '1' } }); assert.equal(select.value, 'c')
  } finally { reader.disposeHtmlRuntime() }
})

test('selected disabled options are excluded from FormData without losing their display value', () => {
  for (const multiple of ['', 'multiple']) {
    const runtime = createRuntime(`<form id="f"><select id="s" name="choice" ${multiple}><optgroup disabled><option selected value="a">Closed</option></optgroup>${multiple ? '<option selected value="b">Open</option>' : ''}</select></form><pre id="out"></pre><script>document.getElementById('out').textContent=JSON.stringify(Array.from(new FormData(document.getElementById('f'))));</script>`)
    try { runtime.run(); assert.deepEqual(runtime.errors, []); assert.deepEqual(JSON.parse(runtime.document.getElementById('out').textContent), multiple ? [['choice', 'b']] : []); assert.equal(runtime.document.getElementById('s').value, 'a') } finally { runtime.destroy() }
  }
})

test('optional option and optgroup end tags preserve sibling groups and disabled inheritance', () => {
  const runtime = createRuntime('<select id="s"><option>A<optgroup disabled><option>B<option>C<optgroup><option>D</select>')
  try {
    runtime.run(); const select = runtime.document.getElementById('s')
    assert.deepEqual(select.children.map(n => n.localName), ['option', 'optgroup', 'optgroup'])
    assert.deepEqual(select.options.map(n => n.textContent), ['A', 'B', 'C', 'D'])
    assert.deepEqual(select.options.map(n => n.matches(':disabled')), [false, true, true, false])
  } finally { runtime.destroy() }
})

test('same-value and empty-value grouped options preserve selected index and visible label', () => {
  const runtime = createRuntime('<select id="s"><optgroup><option value="x">First</option><option value="x">Second</option><option value="" selected>Empty</option></optgroup></select>')
  try {
    runtime.run(); const select = runtime.document.getElementById('s')
    const display = () => find(renderHtmlDomTree({ document: runtime.document, styles: [] }).nodes, 's').displayText
    assert.equal(select.value, ''); assert.equal(select.selectedIndex, 2); assert.equal(display(), 'Empty')
    runtime.syncInput(select._nid, { selectedIndex: 1 }, 'change')
    assert.equal(select.selectedIndex, 1); assert.equal(select.value, 'x'); assert.equal(display(), 'Second')
    select.value = 'x'; assert.equal(select.selectedIndex, 0); assert.deepEqual(select.options.map(o => o.selected), [true, false, false]); assert.equal(display(), 'First')
    runtime.syncInput(select._nid, { selectedIndex: 2 }, 'change')
    assert.equal(select.selectedIndex, 2); assert.equal(select.value, ''); assert.equal(display(), 'Empty')
    select.selectedIndex = -1; assert.equal(select.selectedIndex, -1); assert.equal(display(), '')
  } finally { runtime.destroy() }
})
