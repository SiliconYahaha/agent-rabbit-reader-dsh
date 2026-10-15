'use strict'
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib'), crypto = require('node:crypto')
const root = path.resolve(__dirname, '..')
const source = path.dirname(require.resolve('pathkit-wasm/package.json'))
const dest = path.join(root, 'miniprogram/file-reader/image/svg/vendor/pathkit')
fs.mkdirSync(dest, { recursive: true })
let js = fs.readFileSync(path.join(source, 'bin/pathkit.js'), 'utf8')
// PathKit already builds without dynamic execution. Cap heap growth and select
// packaged WXWebAssembly; never fetch an executable over the network.
const upstreamJs = js
if (!js.includes('if(2147483648<b)return!1') || !js.includes('ma.grow(Math.min(2147483648,d)')) throw new Error('PathKit memory growth hook changed')
js = js.replace('if(2147483648<b)return!1', 'if(67108864<b)return!1').replace('ma.grow(Math.min(2147483648,d)', 'ma.grow(Math.min(67108864,d)')
const shim = 'var WebAssembly = typeof WXWebAssembly !== "undefined" ? WXWebAssembly : globalThis.WebAssembly;\n'
fs.writeFileSync(path.join(dest, 'pathkit.js'), shim + js)
const wasm = fs.readFileSync(path.join(source, 'bin/pathkit.wasm'))
fs.writeFileSync(path.join(dest, 'pathkit.wasm.br'), zlib.brotliCompressSync(wasm))
fs.copyFileSync(path.join(source, 'LICENSE'), path.join(dest, 'LICENSE'))
fs.writeFileSync(path.join(dest, 'source.json'), JSON.stringify({ package: 'pathkit-wasm', version: '1.0.0', license: 'BSD-3-Clause', source: 'https://github.com/google/skia/tree/main/modules/pathkit', wasmSha256: crypto.createHash('sha256').update(wasm).digest('hex'), upstreamJsSha256: crypto.createHash('sha256').update(upstreamJs).digest('hex'), maximumWasmHeapBytes: 67108864, modification: 'Cap Emscripten heap growth at 64 MiB; prepend WXWebAssembly selection; Brotli-compress upstream WASM.' }, null, 2) + '\n')
