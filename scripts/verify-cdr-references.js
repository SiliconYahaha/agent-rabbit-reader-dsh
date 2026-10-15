'use strict'

// Explicit, fixed-hash local files only; no network. Native libcdr and Node zlib
// are independent references. Rendered differences remain visible, not waived.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const zlib = require('node:zlib')
const { execFileSync } = require('node:child_process')
const { inspectFileBytes } = require('../miniprogram/file-reader/engine/core/file-inspector')
const { inflateZlibBounded } = require('../miniprogram/file-reader/engine/core/bounded-zlib')
const profile = require('../compatibility/profiles/cdr.json')
const [outdir, ...files] = process.argv.slice(2).map(file => path.resolve(file))
assert.ok(outdir && fs.statSync(outdir).isDirectory() && files.length >= 2)
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const put = (name, data) => {
  const target = path.join(outdir, name)
  if (fs.existsSync(target)) assert.equal(digest(fs.readFileSync(target)), digest(data), `refusing overwrite: ${name}`)
  else fs.writeFileSync(target, data, { flag: 'wx' })
  return target
}
const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
const rows = []; const results = []
for (const file of files) {
  assert.ok(fs.statSync(file).size <= 10 * 1024 * 1024)
  const bytes = fs.readFileSync(file)
  const sample = profile.publicSamples.find(sample => sample.name === path.basename(file))
  assert.ok(sample, 'unregistered original')
  assert.equal(digest(bytes), sample.sha256)
  const streams = []; const damagedStreams = []
  for (let cursor = 12; cursor + 8 <= bytes.length;) {
    const length = bytes.readUInt32LE(cursor + 4), start = cursor + 8, end = start + length
    assert.ok(end <= bytes.length)
    if (bytes.toString('ascii', cursor, cursor + 4) === 'LIST' && bytes.toString('ascii', start, start + 4) === 'cmpr') {
      const firstEnd = start + 28 + bytes.readUInt32LE(start + 4) - 8
      const secondEnd = firstEnd + bytes.readUInt32LE(start + 12)
      assert.equal(secondEnd, end)
      for (const [from, to, expected] of [[start + 28, firstEnd, bytes.readUInt32LE(start + 8)], [firstEnd + 8, secondEnd, bytes.readUInt32LE(start + 16)]]) {
        const packed = bytes.subarray(from, to)
        const reference = zlib.inflateSync(packed, { maxOutputLength: 32 * 1024 * 1024 })
        assert.equal(reference.length, expected)
        assert.deepEqual(Buffer.from(inflateZlibBounded(packed, expected)), reference)
        streams.push({ decodedBytes: expected, sha256: digest(reference) })
        const bad = Buffer.from(bytes); bad[to - 1] ^= 1
        assert.throws(() => zlib.inflateSync(bad.subarray(from, to)), /data check/)
        const rejected = inspectFileBytes(bad, { name: sample.name })
        assert.equal(rejected.previewSvg, '', 'corrupt public sample still returned vectors')
        assert.ok(rejected.preview, 'independent real thumbnail should remain available')
        assert.match(rejected.summary, /校验失败.*仅显示独立内嵌缩略图.*不代表完整正文/)
        damagedStreams.push({ adlerOffset: to - 1, vectorsRejected: true, independentThumbnailOnly: true })
      }
    }
    cursor = end + (length & 1)
  }
  assert.ok(streams.length >= 2)
  let nativeFile = file, derivative = false
  if (bytes.toString('ascii', 8, 12) === 'CARA') {
    const staticBytes = Buffer.from(bytes); staticBytes.write('CDRA', 8)
    nativeFile = put(path.basename(file, '.cdr') + '-static-CDRA.cdr', staticBytes)
    derivative = true
  }
  const xhtml = execFileSync(process.env.CDR_ORACLE_BIN || 'cdr2xhtml', [nativeFile], { encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 })
  const nativeSvg = xhtml.match(/<svg:svg\b[\s\S]*?<\/svg:svg>/)?.[0].replace(/svg:/g, '').replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')
  assert.ok(nativeSvg && /<path\b/.test(nativeSvg), 'native converter returned no drawing')
  assert.doesNotMatch(nativeSvg, /<script|<foreignObject|(?:href|src)=["'](?:https?:|javascript:)/i)
  const actual = inspectFileBytes(bytes, { name: sample.name })
  assert.ok(actual.previewSvg)
  put(sample.name + '-libcdr.svg', nativeSvg)
  put(sample.name + '-reader.svg', actual.previewSvg)
  results.push({ name: sample.name, sha256: sample.sha256, streams, damagedStreams, nativeHeaderDerivative: derivative,
    nativePaths: (nativeSvg.match(/<path\b/g) || []).length, readerPaths: (actual.previewSvg.match(/<path\b/g) || []).length,
    metadata: actual.metadata, visualStatus: 'requires inspection; path-count agreement alone is not visual fidelity' })
  rows.push(`<h2>${escape(sample.name)}${derivative ? ' — libcdr 使用仅改容器标识的派生文件' : ''}</h2><section><article><h3>独立 libcdr 0.1.9</h3><div class="canvas reference">${nativeSvg}</div></article><article><h3>阅读器当前结果</h3><div class="canvas reader">${actual.previewSvg}</div></article></section>`)
}
const html = `<!doctype html><meta charset="utf-8"><title>CDR 独立对照</title><style>body{font:16px system-ui;background:#eee;margin:24px}section{display:grid;grid-template-columns:1fr 1fr;gap:20px}article{background:white;padding:20px}.canvas{height:360px}.canvas svg{width:100%;height:100%}h2{margin-top:28px}</style><h1>CDR 对照：差异必须保留，不以识别成功代替正文完整</h1>${rows.join('')}<script>for(const svg of document.querySelectorAll('.reference svg')){const b=svg.getBBox();if(b.width&&b.height){const p=Math.max(b.width,b.height)*.03;svg.setAttribute('viewBox',[b.x-p,b.y-p,b.width+2*p,b.height+2*p].join(' '))}}</script>`
put('comparison.html', html)
console.log(JSON.stringify({ nativeVersion: execFileSync(process.env.CDR_ORACLE_BIN || 'cdr2xhtml', ['--version'], { encoding: 'utf8' }).trim(), results }, null, 2))
