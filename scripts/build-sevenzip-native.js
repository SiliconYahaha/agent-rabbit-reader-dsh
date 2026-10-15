'use strict'

// Explicit maintainer rebuild only. Normal checks verify the checked-in hashes.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const zlib = require('node:zlib')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const sourceCommit = 'e5431fa6f5505e385c6f9367260717e9c47dc2ee'
const buildRoot = path.join(root, 'tools/sevenzip-native')
const destination = path.join(root, 'miniprogram/file-reader/sevenzip/runtime')
const hash = value => crypto.createHash('sha256').update(value).digest('hex')
const emccVersion = execFileSync('emcc', ['--version'], { encoding: 'utf8' }).split('\n')[0]
if (!/\b4\.0\.10\b/.test(emccVersion)) throw new Error('Activate Emscripten 4.0.10 first; do not modify shell startup files.')
let bundle
if (process.argv[2] === '--package-built') {
  // Used after a manual equivalent build; hashes and API tests still required.
  bundle = path.resolve(process.argv[3])
} else {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rabbit-sevenzip-'))
  const source = path.join(work, '7zip')
  execFileSync('git', ['clone', '--branch', '24.09', '--depth', '1', 'https://github.com/ip7z/7zip.git', source], { stdio: 'inherit' })
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim()
  if (commit !== sourceCommit) throw new Error('7-Zip source commit mismatch')
  for (const patch of ['7zz-emcc.patch', 'native-listing.patch']) execFileSync('git', ['apply', '--ignore-whitespace', path.join(buildRoot, patch)], { cwd: source, stdio: 'inherit' })
  bundle = path.join(source, 'CPP/7zip/Bundles/Alone2/_wasm')
  execFileSync('emmake', ['make', '-j4', '-f', 'makefile.emcc', 'O=_wasm'], {
    cwd: path.dirname(bundle), stdio: 'inherit', env: { ...process.env, ST_MODE: '1', EMSCRIPTEN: '1',
      LDFLAGS_EMCC: "-O2 -lnodefs.js -lworkerfs.js -s EXPORTED_RUNTIME_METHODS=['FS','NODEFS','WORKERFS','callMain','stackSave','stackRestore'] -s ALLOW_MEMORY_GROWTH=1 -s MODULARIZE=1 -s EXPORT_NAME=SevenZip --post-js post.js --pre-js pre.js" }
  })
}
const original = fs.readFileSync(path.join(bundle, '7zz.js'), 'utf8')
let glue = original.replace('var SevenZip = (() => {', "var WebAssembly = typeof WXWebAssembly === 'object' ? WXWebAssembly : globalThis.WebAssembly;\nvar SevenZip = (() => {")
  .replace(/new WebAssembly\.RuntimeError\(what\)/g, 'new Error(what)')
if (glue === original || !glue.includes('_rabbit_reader_listing_version')) throw new Error('Native listing/WX glue patch missing')
glue = glue.split(/\r?\n/).map(line => line.trimEnd()).join('\n').trimEnd() + '\n'
const wasm = fs.readFileSync(path.join(bundle, '7zz.wasm'))
const files = { '7zz.js': Buffer.from(glue), '7zz.wasm.br': zlib.brotliCompressSync(wasm, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }) }
for (const [name, bytes] of Object.entries(files)) fs.writeFileSync(path.join(destination, name), bytes)
fs.writeFileSync(path.join(buildRoot, 'manifest.json'), JSON.stringify({ sourceCommit, wasmWrapperCommit: '521d2cf93f5964f4e77b01049e19f1b29305c454', emscripten: '4.0.10', listingApi: 3,
  wasmSha256: hash(wasm), files: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, hash(bytes)])),
  patches: Object.fromEntries(['7zz-emcc.patch', 'native-listing.patch'].map(name => [name, hash(fs.readFileSync(path.join(buildRoot, name)))]))
}, null, 2) + '\n')
console.log('Packaged native structured listing kernel. Run npm run check and WeChat validation before release.')
