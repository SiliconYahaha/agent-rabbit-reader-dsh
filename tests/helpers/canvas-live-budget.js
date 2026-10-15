'use strict'

// Same source runs independently in Chrome and inside the reader interpreter.
function scene (ctx, variant) {
  const canvas = ctx.canvas, width = 1024 + variant * 64, height = 1024
  canvas.width = width; canvas.height = height
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = 'red'; ctx.fillRect(0, 0, 30, 30)
    switch (variant % 4) {
      case 0: canvas.width = 1; canvas.width = width; break
      case 1: canvas.height = 0; canvas.height = height; break
      case 2: canvas.width = 0; canvas.height = 1; canvas.height = height; canvas.width = width; break
      case 3: canvas.removeAttribute('width'); canvas.width = width; break
    }
  }
  canvas.width = 64; canvas.height = 48
  // Every resize must reset both pixels and state, without losing this context.
  const clear = Array.from(ctx.getImageData(0, 0, 1, 1).data)
  const defaults = { fillStyle: ctx.fillStyle, globalAlpha: ctx.globalAlpha }
  ctx.fillStyle = '#198b32'; ctx.fillRect(0, 0, 64, 48)
  ctx.fillStyle = '#ffb32d'; ctx.fillRect(variant + 2, 5, 17, 26)
  ctx.clearRect(50, 0, 14, 12)
  return { clear, defaults, width: canvas.width, height: canvas.height, variant, cycles: 40 }
}
function htmlFor (variant = 0) {
  return `<style>canvas{width:256px;height:192px}button{display:block}</style><canvas id="c" width="64" height="48"></canvas><button id="again">再运行40次</button><p id="result"></p><script>const scene=${scene};let variant=${variant};const canvas=document.getElementById('c'),ctx=canvas.getContext('2d');function run(){window.ready=false;try{window.result=scene(ctx,variant);window.exported=canvas.toDataURL();document.getElementById('result').textContent='完成 '+variant+' / 40 次';window.failure=''}catch(e){window.failure=e.message;document.getElementById('result').textContent=e.message}window.ready=true}document.getElementById('again').onclick=()=>{variant++;run()};run()</script>`
}
function harness () {
  window.readTests = []
  window.async_test = () => ({ done () {} })
  window._assertSame = (a, b, message) => { if (a !== b) throw Error(message || 'assertSame') }
  window._assertPixel = (c, x, y, ...expected) => {
    const actual = c.getContext('2d').getImageData(x, y, 1, 1).data
    if (!expected.every((n, i) => n === actual[i])) throw Error('pixel mismatch')
  }
  window._addTest = fn => { try { const c = document.getElementById('c'); fn(c, c.getContext('2d')); window.readTests.push({ pass: true }) } catch (error) { window.readTests.push({ pass: false, message: error.message }) } }
}
module.exports = { scene, htmlFor, harness }
