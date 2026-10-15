'use strict'
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), { spawnSync } = require('node:child_process')
const before = require('../tests/fixtures/cdr-record-integrity/before.json'), expanded = require('../tests/fixtures/cdr-record-integrity/expanded-before.json')
const out = path.resolve(process.argv[2] || 'outputs/cdr-record-integrity/native')
fs.mkdirSync(out, { recursive: true })
const rows = []
for (const row of [...before.rows, ...expanded.cases]) {
  const file = path.join(out, row.name + '.cdr'), bytes = Buffer.from(row.base64, 'base64')
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== row.sha256) throw Error(row.name + ' source hash')
  if (fs.existsSync(file) && !fs.readFileSync(file).equals(bytes)) throw Error('refuse overwrite ' + file)
  fs.writeFileSync(file, bytes)
  const result = { name: row.name, sourceSha256: row.sha256, category: row.category, beforePreview: row.preview }
  for (const [kind, command] of [['raw', process.env.CDR_RAW_ORACLE_BIN || 'cdr2raw'], ['xhtml', process.env.CDR_ORACLE_BIN || 'cdr2xhtml']]) {
    const p = spawnSync(command, [file], { encoding: 'utf8', timeout: 15000, maxBuffer: 4 * 1024 * 1024 })
    result[kind] = { status: p.status, signal: p.signal, stdout: p.stdout, stderr: p.stderr, error: p.error?.message }
    fs.writeFileSync(path.join(out, row.name + '.' + kind), p.stdout || '')
  }
  rows.push(result); console.log(row.name, result.raw.status, result.xhtml.status, (result.raw.stdout?.match(/drawPath/g) || []).length)
}
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ at: new Date().toISOString(), implementation: 'libcdr0.1.9 native cdr2raw/cdr2xhtml from Homebrew bottle', originalBytes: true, rows }, null, 2) + '\n')
