'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const { computeCustomProperties, resolveVariables, MAX_EXPANDED_CHARS } = require('../miniprogram/file-reader/document/css-variables')
const { renderHtmlDomTree, splitStyleDeclarations } = require('../miniprogram/file-reader/document/document-renderer')
const { parseHtmlDocument } = require('../miniprogram/file-reader/document/html-runtime/html-dom-shim')
const { cycles, root } = require('./helpers/css-variable-public')
const { cases, htmlFor, visualHtml } = require('./helpers/css-variables')
const find = (ns, id) => { for (const n of ns) { if (n.attrs && n.attrs.id === id) return n; const c = find(n.children || [], id); if (c) return c } }

test('public variable files retain fixed upstream bytes and license notices', () => {
  const hashes = {
    'variable-cycles.html': 'a787dbc45d029c765d144309e0c003e731986595ced4555dae217e531dae39f7',
    'variable-declaration-48.html': '9a6af27fd79faa94a8ae566150ce3cfbfb28c5a90a9024f296111535524dc8d7',
    'css-vars-custom-property-inheritance.html': '3cded4005de38ed5dfaae355963029c4e97069fd13d37550aba030d2940bf07d',
    'LICENSE.md': '5fac07febb0e2a97fb0d7b0def149ec08b642e1ba4b9c345283ab1cbd2af6570'
  }
  for (const [name, sha] of Object.entries(hashes)) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex'), sha, name)
})

test('variable chains, cyclic fallbacks and computed inheritance emit correct visible colors', () => {
  for (const c of cases.filter(c => c.property === 'color' && c.expected === 'green')) {
    assert.match(find(renderHtmlDomTree(htmlFor(c)).nodes, 'probe').attrs.style, /(?:^|;)color:green(?:;|$)/, c.name)
  }
})
test('all 11 upstream cycle graphs preserve original invalid and valid expectations', () => {
  for (const c of cycles) {
    const raw = Object.fromEntries(c.declarations.map(s => { const i = s.indexOf(':'); return [s.slice(0, i), s.slice(i + 1)] }))
    const result = computeCustomProperties(raw)
    for (const name of c.invalid) assert.equal(result[name], null, c.name + name)
    for (const name of c.valid) assert.ok(result[name], c.name + name)
  }
})
test('invalid fragments never survive as partial values and empty values suppress fallback', () => {
  assert.equal(resolveVariables('var(--a,green)', { '--a': 'red var(--missing)' }), 'green')
  assert.equal(resolveVariables('var(--a)', { '--a': 'red var(--missing)' }), '')
  assert.equal(resolveVariables('var(--a,red)', { '--a': '' }), '')
  assert.equal(resolveVariables('var(--a,green)', { '--a': 'initial' }), 'green')
  assert.equal(splitStyleDeclarations('--a:;color:var(--a)')[0].value, '')
})
test('CSSOM changes retain explicit empty custom properties instead of inheriting old values', () => {
  const p = parseHtmlDocument('<p style="--a:;color:red">text</p>').document.querySelector('p')
  p.style.setProperty('color', 'green'); assert.match(p.style.cssText, /--a:;/)
  assert.equal(p.style.getPropertyValue('--a'), '')
})
test('substitution preserves token boundaries, strings and non-var numeric/hash tokens', () => {
  assert.equal(resolveVariables('var(--n)px', { '--n': '10' }), '10 px')
  assert.equal(resolveVariables('var(--a)var(--b)', { '--a': 'gr', '--b': 'een' }), 'gr een')
  assert.equal(resolveVariables('var(--f)(0,0,0)', { '--f': 'rgb' }), 'rgb (0,0,0)')
  assert.equal(resolveVariables('"var(--missing)"', {}), '"var(--missing)"')
  assert.equal(resolveVariables('1var(--missing)', {}), '1var(--missing)')
  assert.equal(resolveVariables('#var(--missing)', {}), '#var(--missing)')
  assert.equal(resolveVariables('calc(var(--n) + 2px)', { '--n': '10px' }), 'calc(10px + 2px)')
})
test('root updates recompute inherited aliases and cycle fallbacks on a real sandbox click', () => {
  const { createRuntime } = require('../miniprogram/file-reader/document/html-runtime/html-script-runtime'), rt = createRuntime(visualHtml)
  const render = () => renderHtmlDomTree(rt.document, { styles: parseHtmlDocument(visualHtml).styles })
  try {
    rt.run(); assert.deepEqual(rt.errors, [])
    for (const id of ['inherited', 'updated', 'cycle']) assert.match(find(render().nodes, id).attrs.style, /color:green/)
    assert.equal(rt.dispatchTap(rt.document.getElementById('change')._nid), true)
    for (const id of ['inherited', 'updated']) assert.match(find(render().nodes, id).attrs.style, /color:blue/)
    assert.match(find(render().nodes, 'cycle').attrs.style, /color:green/)
    assert.equal(rt.document.getElementById('result').textContent, '点击已生效'); assert.deepEqual(rt.errors, [])
  } finally { rt.destroy() }
})
test('linear chains and exponential expansions finish under isolated time and size budgets', () => {
  const { execFileSync } = require('node:child_process')
  const code = `const a=require('node:assert/strict'),v=require('./miniprogram/file-reader/document/css-variables');const raw={};for(let i=119;i>=0;i--)raw['--v'+i]=i?'var(--v'+(i-1)+')':'green';a.equal(v.computeCustomProperties(raw)['--v119'],'green');const bomb={'--v0':'x'};for(let i=1;i<40;i++)bomb['--v'+i]='var(--v'+(i-1)+') var(--v'+(i-1)+')';const result=v.computeCustomProperties(bomb);a.equal(result['--v39'],null);a.equal(v.resolveVariables('var(--v39,green)',result),'green');a.ok(Object.values(result).every(x=>x==null||x.length<=v.MAX_EXPANDED_CHARS));a.equal(v.resolveVariables('var(--a,green)',{'--a':'x'.repeat(v.MAX_EXPANDED_CHARS+1)}),'green')`
  execFileSync(process.execPath, ['-e', code], { cwd: path.join(__dirname, '..'), timeout: 5000 })
  assert.equal(MAX_EXPANDED_CHARS, 1048576)
})
