import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createRuntime } = require('../miniprogram/file-reader/document/html-runtime/html-script-runtime')
const { renderHtmlDomTree, splitStyleDeclarations } = require('../miniprogram/file-reader/document/document-renderer')

const declarations = Object.fromEntries(splitStyleDeclarations('width:210mm;padding:12pt;margin:1rem', 20).map(item => [item.property, item.value]))
assert.deepEqual(declarations, { width: '793.7px', padding: '16px', margin: '20px' })

const touches = []
const runtime = createRuntime(`<html class="ready"><body data-theme="night"><button id="go">0</button><canvas id="c"></canvas><script>
  const button = document.getElementById('go')
  button.addEventListener('click', () => button.textContent = '1')
  button.addEventListener('touchmove', event => button.dataset.x = event.touches[0].clientX)
  const context = document.getElementById('c').getContext('2d')
  context.fillStyle = 'red'; context.fillRect(0,0,10,10)
</script></body></html>`, { viewportWidth: 390, onHostAction: action => touches.push(action) })
const state = runtime.run()
const button = runtime.document.getElementById('go')
runtime.dispatchTap(button._nid)
runtime.dispatchEvent(button._nid, 'touchmove', { touches: [{ clientX: 42 }] })
const rendered = renderHtmlDomTree({ document: runtime.document, styles: state.styles }, { viewportWidth: 390 })
const tree = JSON.stringify(rendered.nodes)

assert.equal(runtime.document.body.dataset.theme, 'night')
assert.equal(runtime.document.documentElement.className, 'ready')
assert.equal(button.textContent, '1')
assert.equal(button.dataset.x, '42')
assert.match(tree, /"touch":true/)
assert.match(tree, /"name":"canvas"/)
assert.match(tree, /"rev":2/)
assert.equal(rendered.contentWidth, 390)
runtime.destroy()

console.log('renderer smoke passed: units, body/html state, tap/touch bridge, canvas ops, contentWidth')
