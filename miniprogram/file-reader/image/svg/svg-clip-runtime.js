'use strict'
const { modulePath } = require('../../shared/module-root')
const { createClipUnion } = require('./svg-clip-union')
let pending

function loadClipUnion () {
  if (pending) return pending
  pending = new Promise((resolve, reject) => {
    let settled = false
    const finish = (error, kernel) => {
      if (settled) return
      settled = true; clearTimeout(timer)
      if (error) reject(error)
      else {
        const union = createClipUnion(kernel)
        resolve(entries => {
          try { return union(entries) } catch (error) {
            if (error.name === 'RuntimeError' || /abort|out of memory/i.test(error.message || '')) pending = null
            throw error
          }
        })
      }
    }
    const timer = setTimeout(() => finish(new Error('SVG 裁切内核启动超时')), 12000)
    try {
      if (typeof WXWebAssembly === 'undefined') throw new Error('当前环境没有 SVG 裁切内核')
      const init = require('./vendor/pathkit/pathkit')
      init({
        instantiateWasm (imports, receive) {
          Promise.resolve().then(() => WXWebAssembly.instantiate(modulePath('image/svg/vendor/pathkit/pathkit.wasm.br'), imports)).then(r => {
            if (settled) return
            const instance = r && (r.instance || r)
            if (!instance || !instance.exports) throw new Error('SVG 裁切内核缺少 exports')
            receive(instance, r.module)
          }).catch(error => finish(error))
          return {}
        }
      }).then(kernel => finish(null, kernel), error => finish(error))
    } catch (error) { finish(error) }
  }).catch(error => { pending = null; throw error })
  return pending
}
module.exports = { loadClipUnion }
