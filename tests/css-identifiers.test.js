'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path')
const { parseDeclaration, normalizeValueIdentifiers, serializeIdentifier } = require('../miniprogram/file-reader/document/css-identifiers')
const { parseCssRules, renderHtmlDomTree, resolveVariables, splitStyleDeclarations } = require('../miniprogram/file-reader/document/document-renderer')
const { parseHtmlDocument } = require('../miniprogram/file-reader/document/html-runtime/html-dom-shim')
const { cases, htmlFor, visualHtml } = require('./helpers/css-identifiers')
const find = (ns, id) => { for (const n of ns) { if (n.attrs && n.attrs.id === id) return n; const c = find(n.children || [], id); if (c) return c } }
const style = (html, id = 'probe') => find(renderHtmlDomTree(html).nodes, id).attrs.style

test('CSS identifier property/value escapes are canonical before WeChat styles are emitted', () => {
  for (const c of cases.filter(c => !['escaped-digit-is-unit-not-number', 'rgb-fallback'].includes(c.name))) {
    const value = style(htmlFor(c)).split(';').find(s => s.startsWith(c.property + ':'))
    assert.equal(value, `${c.property}:${c.expected}`, c.name)
  }
})
test('CSS decoded punctuation cannot manufacture declarations, functions, quotes or numeric values', () => {
  assert.equal(parseDeclaration(String.raw`co\:lor:green`), null)
  assert.equal(parseDeclaration(String.raw`color\;background:red`), null)
  assert.equal(normalizeValueIdentifiers(String.raw`red\;background\:blue`), String.raw`red\3b background\3a blue`)
  assert.equal(normalizeValueIdentifiers(String.raw`url\(x\)`), String.raw`url\28 x\29 `)
  assert.equal(normalizeValueIdentifiers(String.raw`1\32 p\78`), String.raw`1\32 px`)
  assert.equal(normalizeValueIdentifiers(String.raw`12p\78`), '12px')
  assert.equal(normalizeValueIdentifiers(String.raw`"\67 reen;url(x)"`), String.raw`"\67 reen;url(x)"`)
  assert.equal(normalizeValueIdentifiers(String.raw`#\30 08000`), '#008000')
  assert.equal(serializeIdentifier('--a;b'), String.raw`--a\3b b`)
})
test('CSSOM custom property set/get/remove and serialization preserve case and escaped names', () => {
  const p = parseHtmlDocument(String.raw`<p style="--Brand:green;--brand:red;--a\:b:blue;\63 olor:var(--Brand)"></p>`).document.querySelector('p')
  assert.equal(p.style.getPropertyValue('--Brand'), 'green'); assert.equal(p.style.getPropertyValue('--brand'), 'red')
  assert.equal(p.style.getPropertyValue('--a:b'), 'blue')
  p.style.setProperty('--Brand', 'blue'); assert.equal(p.style.getPropertyValue('--Brand'), 'blue')
  assert.equal(p.style.getPropertyValue('--brand'), 'red')
  assert.equal(p.style.removeProperty('--Brand'), 'blue'); assert.equal(p.style.getPropertyValue('--brand'), 'red')
  p.style['--Brand'] = 'green'; assert.equal(p.style['--Brand'], 'green'); assert.match(p.style.cssText, /--Brand:green/)
  const copy = parseHtmlDocument(p.outerHTML).document.querySelector('p')
  assert.equal(copy.style.getPropertyValue('--a:b'), 'blue'); assert.equal(copy.style.getPropertyValue('--Brand'), 'green')
  p.style.setProperty('COLOR', 'green'); assert.equal(p.style.getPropertyValue('color'), 'green')
})
test('CSS variables preserve literal strings and support Unicode, escaped punctuation and function fallbacks', () => {
  assert.equal(resolveVariables('"var(--missing)"', {}), '"var(--missing)"')
  assert.equal(resolveVariables('var(--missing, "literal var(--x)")', {}), '"literal var(--x)"')
  assert.equal(resolveVariables('var(--主题)', { '--主题': 'green' }), 'green')
  assert.equal(resolveVariables(String.raw`var(--a\:b)`, { '--a:b': 'green' }), 'green')
  assert.equal(resolveVariables('var(--missing,rgb(0,128,0))', {}), 'rgb(0,128,0)')
  assert.equal(resolveVariables('var(--missing,var(--other,green))', {}), 'green')
  assert.equal(resolveVariables('var(--missing)', {}), '')
  assert.equal(resolveVariables('var(--a)', { '--a': 'var(--b)', '--b': 'var(--a)' }), '')
})
test('escaped executable/resource keywords do not bypass local-only CSS policy', () => {
  for (const source of [String.raw`background:u\72l(https://example.invalid/x)`, String.raw`background:\75rl("javascript:alert(1)")`, String.raw`background:U\52L(//example.invalid/x)`]) {
    assert.deepEqual(splitStyleDeclarations(source).map(d => d.value), ['none'], source)
  }
  for (const source of [String.raw`width:e\78pression(1)`, String.raw`\62 ehavior:url(x)`]) assert.equal(splitStyleDeclarations(source).length, 0, source)
  assert.equal(splitStyleDeclarations(String.raw`background:u\72l("data:image/png;base64,AAAA")`)[0].value, 'url("data:image/png;base64,AAAA")')
  assert.equal(splitStyleDeclarations(String.raw`content:"u\72l(https://example.invalid/x)"`)[0].value, String.raw`"u\72l(https://example.invalid/x)"`)
})
test('escaped !important wins the actual cascade, not just browser interpretation of raw text', () => {
  assert.equal(parseCssRules(String.raw`p{color:green!\69mportant}`)[0].declarations[0].important, true)
  assert.match(style(String.raw`<style>#probe{color:green!\69mportant;color:red}</style><p id="probe">正文</p>`), /(?:^|;)color:green(?:;|$)/)
})
test('real sandbox tap changes case-sensitive variables and actual emitted colors', () => {
  const { createRuntime } = require('../miniprogram/file-reader/document/html-runtime/html-script-runtime'), rt = createRuntime(visualHtml)
  const rendered = () => renderHtmlDomTree(rt.document, { styles: parseHtmlDocument(visualHtml).styles })
  try {
    rt.run(); assert.deepEqual(rt.errors, [])
    for (const id of ['escaped', 'variable', 'inline']) assert.match(find(rendered().nodes, id).attrs.style, /(?:^|;)color:green(?:;|$)/)
    assert.equal(rt.dispatchTap(rt.document.getElementById('change')._nid), true)
    for (const id of ['variable', 'inline']) assert.match(find(rendered().nodes, id).attrs.style, /(?:^|;)color:blue(?:;|$)/)
    assert.equal(rt.document.getElementById('result').textContent, '点击已生效'); assert.deepEqual(rt.errors, [])
  } finally { rt.destroy() }
})
test('long CSS identifier streams and cyclic variables stay bounded in an isolated process', () => {
  const { execFileSync } = require('node:child_process')
  const code = String.raw`const a=require('node:assert/strict'),c=require('./miniprogram/file-reader/document/css-identifiers'),r=require('./miniprogram/file-reader/document/document-renderer');a.equal(c.normalizeValueIdentifiers('\\67 '.repeat(30000)),'g'.repeat(30000));a.equal(r.resolveVariables('var(--a)',{'--a':'var(--a)'}),'');a.equal(c.normalizeValueIdentifiers('1px '.repeat(30000)).length,120000)`
  execFileSync(process.execPath, ['-e', code], { cwd: path.join(__dirname, '..'), timeout: 5000 })
})
