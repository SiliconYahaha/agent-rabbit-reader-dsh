'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const zlib = require('node:zlib')
const SevenZip = require('../miniprogram/file-reader/sevenzip/runtime/7zz')
const { zipSync } = require('../miniprogram/file-reader/document/vendor/fflate')

const runtimePath = path.join(__dirname, '../miniprogram/file-reader/archive/sevenzip-runtime.js')
const wasmBinary = zlib.brotliDecompressSync(fs.readFileSync(path.join(__dirname, '../miniprogram/file-reader/sevenzip/runtime/7zz.wasm.br')))
const selectionNames = [
  'report*.txt', 'note?.txt', '*.txt', '?', '[abc].txt', '@list.txt', '-pPASSWORD.txt',
  'semi;colon.txt', 'quote"name.txt', "single'quote.txt", '报告*.txt', '报告?.txt',
  'stars**.txt', 'question??.txt', 'both*?.txt', ' leading*.txt', 'trailing?.txt ',
  '資料/inside*.txt', '資料/inside?.txt', 'star*/inside.txt', 'question?/inside.txt',
  'docs/plain.txt', 'plain.txt'
]
const contents = Object.fromEntries([...selectionNames,
  'report-secret.txt', 'note1.txt', '报告1.txt', 'stars-extra.txt', 'question12.txt',
  'bothAB.txt', '資料/inside1.txt', 'star-other/inside.txt', 'question1/inside.txt',
  'other/plain.txt', 'unselected.txt'
].map((name, index) => [name, Buffer.from(`文件 ${index} 的真实内容：${name}`)]))

// Run the production wrapper and real WASM unchanged. Observe MEMFS immediately
// after extraction, before production cleanup can conceal unwanted files.
function observedRuntime () {
  const calls = []
  const module = { exports: {} }
  const realRequire = createRequire(runtimePath)
  // 7z 内核经 subpackage-loader 按需加载；这里换成能观察 MEMFS 写入的包装内核，其余模块用真实文件。
  async function wrappedSevenZip (options) {
    const engine = await SevenZip(options)
    const original = engine.callMain.bind(engine)
    engine.callMain = args => {
      const command = args[0]
      const outputRoot = args.find(arg => arg.startsWith('-o'))?.slice(2)
      try { return original(args) } finally {
        if (command === 'x' && outputRoot) {
          const files = []
          function visit (directory, prefix = '') {
            for (const name of engine.FS.readdir(directory).filter(name => name !== '.' && name !== '..')) {
              const target = `${directory}/${name}`
              if (engine.FS.isDir(engine.FS.stat(target).mode)) visit(target, `${prefix}${name}/`)
              else files.push({ name: `${prefix}${name}`, size: engine.FS.stat(target).size })
            }
          }
          visit(outputRoot)
          calls.push(files)
        }
      }
    }
    return engine
  }
  vm.runInNewContext(fs.readFileSync(runtimePath, 'utf8'), {
    module, Uint8Array, ArrayBuffer, setTimeout, clearTimeout, process,
    require (id) {
      if (id !== './kernel') return realRequire(id)
      const kernel = realRequire(id)
      return { ...kernel, subpackageLoader: { load: relativePath => Promise.resolve(relativePath.endsWith('/7zz.js') ? wrappedSevenZip : kernel.subpackageLoader.load(relativePath)) } }
    }
  }, { filename: runtimePath })
  return { runtime: module.exports, calls }
}

const observed = observedRuntime()

async function makeArchive (format, files = contents) {
  if (format.startsWith('zip')) return zipSync(files, { level: 0 })
  const engine = await SevenZip({ wasmBinary, print () {}, printErr () {} })
  engine.FS.mkdir('/input')
  for (const [name, bytes] of Object.entries(files)) {
    const parts = name.split('/')
    let directory = '/input'
    for (const part of parts.slice(0, -1)) {
      directory += `/${part}`
      try { engine.FS.mkdir(directory) } catch (_) {}
    }
    engine.FS.writeFile(`/input/${name}`, bytes)
  }
  engine.FS.chdir('/input')
  const args = ['a', '-t7z', '-m0=lzma2', '-ms=on', '/fixture.7z', '.']
  if (format === 'encrypted-7z') args.push('-pselection-fixture-141', '-mhe=on')
  assert.equal(engine.callMain(args), 0)
  return engine.FS.readFile('/fixture.7z')
}

function route (format, archive) {
  const zip = format.startsWith('zip')
  const options = { wasmBinary, archiveExtension: zip ? '.zip' : '.7z', archiveType: zip ? 'zip-engine' : '7z-engine' }
  if (format === 'encrypted-7z') options.password = 'selection-fixture-141'
  if (!format.endsWith('-volumes')) return {
    inspect: () => observed.runtime.inspect7zArchive(archive, options),
    extract: (entry, overrides) => observed.runtime.extract7zEntry(archive, entry, { ...options, ...overrides })
  }
  const split = Math.ceil(archive.length / 2)
  const extension = zip ? 'zip' : '7z'
  const volumes = [{ name: `archive.${extension}.001`, bytes: archive.subarray(0, split) }, { name: `archive.${extension}.002`, bytes: archive.subarray(split) }]
  Object.assign(options, { mainName: volumes[0].name, format: extension })
  return {
    inspect: () => observed.runtime.inspectArchiveVolumes(volumes, options),
    extract: (entry, overrides) => observed.runtime.extractArchiveVolumeEntry(volumes, entry, { ...options, ...overrides })
  }
}

for (const format of ['zip', '7z', 'encrypted-7z', 'zip-volumes', '7z-volumes']) {
  test(`${format} 字面选择特殊名称只生成选中成员，不解压其他匹配项`, async () => {
    const operations = route(format, await makeArchive(format))
    const listed = await operations.inspect()
    assert.deepEqual(Array.from(listed.entries.filter(item => !item.isDirectory), item => item.name).sort(), Object.keys(contents).sort())
    for (const name of selectionNames) {
      const entry = listed.entries.find(item => item.name === name)
      assert.ok(entry?.canOpen, name)
      const actual = await operations.extract(entry)
      assert.deepEqual(Buffer.from(actual), contents[name], name)
      assert.deepEqual(observed.calls.at(-1), [{ name, size: contents[name].length }], `${format}: ${name} 解压了未选中文件`)
    }
  })
}

test('未选中的同名匹配大文件不会绕过上限被额外解压', async () => {
  const files = { 'report*.txt': Buffer.from('small'), 'report-large.txt': Buffer.alloc(64 * 1024, 65) }
  const operations = route('zip', await makeArchive('zip', files))
  const listed = await operations.inspect()
  const entry = listed.entries.find(item => item.name === 'report*.txt')
  assert.deepEqual(Buffer.from(await operations.extract(entry, { maxSize: 16 })), files[entry.name])
  assert.deepEqual(observed.calls.at(-1), [{ name: entry.name, size: 5 }])
  await assert.rejects(operations.extract(listed.entries.find(item => item.name === 'report-large.txt'), { maxSize: 16 }), /超过/)
})

test('未选中成员 CRC 损坏不阻止正常星号文件，选中损坏成员仍拒绝', async () => {
  const payload = Buffer.from('unique-corruption-target')
  const archive = Buffer.from(await makeArchive('zip', { 'report*.txt': Buffer.from('selected'), 'report-broken.txt': payload }))
  const position = archive.indexOf(payload)
  assert.ok(position > 30)
  archive[position] ^= 0xff
  const operations = route('zip', archive)
  const listed = await operations.inspect()
  const selected = listed.entries.find(item => item.name === 'report*.txt')
  assert.equal(Buffer.from(await operations.extract(selected)).toString(), 'selected')
  assert.deepEqual(observed.calls.at(-1), [{ name: 'report*.txt', size: 8 }])
  await assert.rejects(operations.extract(listed.entries.find(item => item.name === 'report-broken.txt')), /CRC Failed/)
  assert.equal(Buffer.from(await operations.extract(selected)).toString(), 'selected')
})

test('安全路径和文件夹保护仍在字面选择前生效', async () => {
  const operations = route('zip', await makeArchive('zip', { 'safe.txt': Buffer.from('safe') }))
  for (const name of ['../*.txt', '/absolute.txt', 'a/../../b.txt', 'bad\0.txt']) {
    await assert.rejects(operations.extract({ name, uncompressedSize: 4 }), /路径不安全/)
  }
  await assert.rejects(operations.extract({ name: 'docs/', isDirectory: true }), /请选择/)
  const listed = await operations.inspect()
  assert.equal(Buffer.from(await operations.extract(listed.entries[0])).toString(), 'safe')
})
