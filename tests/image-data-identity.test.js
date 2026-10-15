'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { createInlineImageStore } = require('../miniprogram/file-reader/document/inline-image-store')
const { parseImageScript } = require('../miniprogram/file-reader/document/image-script-budget')
const Sval = require('../miniprogram/file-reader/document/html-runtime/vendor/sval')
const { readerPage, flush } = require('./helpers/reader-page')
const { image, variants, htmlFor } = require('./helpers/image-data-identity')
const flatten = nodes => nodes.flatMap(n => [n, ...flatten(n.children || [])])

for (const variant of variants) test(`real Page preserves image script/DOM/text values: ${variant}`, async () => {
  const writes = []
  const page = readerPage({ env: { USER_DATA_PATH: '/local' }, getFileSystemManager: () => ({ writeFile: o => { writes.push(o); o.success() }, unlink () {} }) })
  try {
    page.openSelectedFile({ name: variant + '.html', inlineHtml: htmlFor(variant) }); await flush()
    assert.equal(page.data.error, ''); assert.equal(page.data.domMode, true); assert.deepEqual(page._htmlRuntime.errors, [])
    const d = page._htmlRuntime.document, out = JSON.parse(d.getElementById('result').textContent)
    assert.equal(out.prefix, true); assert.equal(out.png, 'PNG'); assert.equal(out.src, true); assert.equal(out.text, true); assert.equal(out.field, true)
    assert.equal(out.bytes, Buffer.from(image.split(',')[1], 'base64').length)
    const nodes = flatten(page.data.domTree)
    assert.ok(nodes.some(n => n.type === 'text' && (n.textFragments ? n.textFragments.map(fragment => fragment.text).join('') : n.text) === image), 'WXML text stays original')
    assert.ok(nodes.some(n => n.name === 'input' && n.attrs.value === image), 'input data stays original')
    assert.ok(nodes.some(n => n.name === 'img' && /^\/local\/reader-inline-/.test(n.attrs.src)), 'only presentation resource is cached')
    assert.equal(writes.length, 1)
    assert.deepEqual(Buffer.from(writes[0].data, 'base64'), Buffer.from(image.split(',')[1], 'base64'))
    const before = d.getElementById('result').textContent
    page.onDomTap({ currentTarget: { dataset: { nid: d.getElementById('check')._nid } } }); await flush()
    assert.equal(d.getElementById('result').textContent, before)
  } finally { page.disposeHtmlRuntime() }
})

test('presentation CSS cache does not rewrite quoted content, comments or unrelated fields', async () => {
  const writes = [], store = createInlineImageStore({ writeFile: o => { writes.push(o); o.success() }, unlink () {} }, '/local')
  const css = `/*url(${image})*/content:"url(${image})";background:url('${image}')`
  const out = await store.css(css)
  assert.ok(out.startsWith(`/*url(${image})*/content:"url(${image})";background:url("/local/`))
  const rendered = { nodes: [{ type:'element',name:'div',attrs:{value:image,title:image},displayText:image,options:[{label:image,value:image}],children:[{type:'text',text:image}]}],wrapperStyle:`background:url(${image})` }
  await store.rewriteView(rendered)
  assert.equal(rendered.nodes[0].children[0].text,image);assert.equal(rendered.nodes[0].displayText,image);assert.equal(rendered.nodes[0].attrs.value,image)
  assert.equal(rendered.nodes[0].options[0].label,image);assert.match(rendered.wrapperStyle,/reader-inline-/);assert.equal(writes.length,1)
  const fallback=await store.rewriteStaticHtml(`<pre>${image}</pre><style>.x{${css}}</style><img src="${image}">`)
  assert.ok(fallback.includes(`<pre>${image}</pre>`));assert.ok(fallback.includes('reader-inline-'));store.dispose()
})

test('WPT base64 matrix: cached bytes agree; malformed padding/characters never become success', async () => {
  const rows = require('./fixtures/image-data/base64.json')
  for (const [input, expected] of rows) {
    let bytes
    const store=createInlineImageStore({writeFile:o=>{bytes=Buffer.from(o.data,'base64');o.success()},unlink(){}},'/local')
    const url='data:image/png;base64,'+'AAAA'.repeat(2050)+input
    if(expected===null)await assert.rejects(store.resource(url),/不完整/,JSON.stringify(input))
    else {await store.resource(url);assert.deepEqual(bytes,Buffer.concat([Buffer.alloc(6150),Buffer.from(expected)]),JSON.stringify(input))}
    store.dispose()
  }
})

test('large source accepts asset literals without changing AST values and rejects executable/syntax abuse', () => {
  const parser=new Sval(), budget=2*1024*1024
  const source=`const images=[${Array(24).fill(JSON.stringify(image)).join(',')}];`
  const ast=parseImageScript(parser,source,budget)
  assert.equal(ast.body[0].declarations[0].init.elements[0].value,image)
  assert.equal(ast.body[0].declarations[0].init.elements[0].raw,JSON.stringify(image))
  assert.throws(()=>parseImageScript(parser,';'.repeat(budget+1),budget),/safety limit/)
  assert.throws(()=>parseImageScript(parser,'//'+image.repeat(24),budget),/safety limit/, 'comments are not data literals')
  assert.throws(()=>parseImageScript(parser,'const r=/data:image\\/png;base64,'+'A'.repeat(budget)+'/;',budget),/safety limit/, 'regex is executable syntax')
  assert.throws(()=>parseImageScript(parser,'const x="'+'A'.repeat(budget)+'"',budget),/safety limit/, 'ordinary oversized string is not exempt')
  assert.throws(()=>parseImageScript(parser,';'.repeat(20*1024*1024+1),budget),/safety limit/)
  assert.throws(()=>parseImageScript(parser,';'.repeat(100001),budget),/safety limit/, 'AST node budget')
})

test('dynamic image caching cannot alter a later document, and write failure retains source identity', async () => {
  let pending
  const page=readerPage({env:{USER_DATA_PATH:'/local'},getFileSystemManager:()=>({writeFile:o=>{pending=o},unlink(){}})})
  page.openSelectedFile({name:'old.html',inlineHtml:'<img id="out">'});await flush()
  const d=page._htmlRuntime.document;d.getElementById('out').src=image;page._htmlRuntime.flush(true)
  assert.equal(d.getElementById('out').src,image)
  page.openSelectedFile({name:'new.html',inlineHtml:'<h1>new</h1>'});pending.fail({errMsg:'disk full'});await flush()
  assert.equal(page.data.sourceName,'new.html');assert.equal(page.data.error,'');page.disposeHtmlRuntime()
})
