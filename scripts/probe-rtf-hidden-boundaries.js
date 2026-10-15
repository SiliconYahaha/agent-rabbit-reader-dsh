'use strict'
// Exploratory only: native differences must be classified before product edits.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const { execFileSync } = require('node:child_process'), { pathToFileURL } = require('node:url')
const { rtfToText } = require('../miniprogram/file-reader/engine/core/rtf-reader')
const out = path.resolve(process.argv[2] || 'outputs/rtf-hidden-tables/before')
const converted = path.join(out, 'converted'), profile = path.join(out, 'profile')
fs.mkdirSync(converted, { recursive: true }); fs.mkdirSync(profile, { recursive: true })
const bodies = {
  plain: 'LEFT', unicode: '\\u20320?\\u22909?',
  field: '{\\field{\\*\\fldinst HYPERLINK "https://example.com"}{\\fldrslt LINK}}',
  hiddenIsland: '{\\v HIDE{\\v0 VISIBLE}HIDE}',
  fallbackControl: '\\uc1\\u20320\\v TAIL',
  fallbackGroup: '\\uc2\\u20320?{\\v HIDE}TAIL'
}
const rows = []
if (!process.argv.includes('--expanded')) {
for (const [body, value] of Object.entries(bodies)) for (const boundary of ['visible', 'hidden', 'hiddenThenReset', 'groupHidden']) for (const container of ['paragraph', 'table', 'nested']) {
  const terminator = container === 'paragraph' ? '\\par ' : container === 'table' ? '\\cell ' : '\\nestcell '
  const edge = { visible: terminator, hidden: '\\v ' + terminator + '\\v0 ', hiddenThenReset: '\\v HIDDEN' + terminator + '\\plain ', groupHidden: '{\\v ' + terminator + '}' }[boundary]
  let content = value + edge + 'RIGHT'
  if (container === 'table') content = '\\trowd\\cellx2000\\cellx4000\\intbl ' + content + '\\cell\\row\\pard '
  if (container === 'nested') content = '\\trowd\\cellx6000\\intbl\\itap1 OUTER\\par\\itap2 ' + content + '\\nestcell{\\*\\nesttableprops\\trowd\\itap2\\cellx2000\\cellx4000\\nestrow}\\pard\\intbl\\itap1 END\\cell\\row\\pard '
  const source = '{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\fcharset0 Arial;}}\\uc1 BEFORE\\par ' + content + '\\par AFTER}'
  const name = `${body}-${boundary}-${container}`, file = path.join(out, name + '.rtf')
  fs.writeFileSync(file, source)
  let reader, error
  try { reader = rtfToText(Buffer.from(source)) } catch (e) { error = e.message }
  rows.push({ name, body, boundary, container, source, file, sha256: crypto.createHash('sha256').update(source).digest('hex'), reader, error })
}
}
if (process.argv.includes('--expanded')) {
  for (const c of require('../tests/helpers/rtf-hidden-boundaries').cases) {
    const file = path.join(out, c.name + '.rtf'); fs.writeFileSync(file, c.source)
    rows.push({ ...c, file, sha256: crypto.createHash('sha256').update(c.source).digest('hex'), reader: rtfToText(Buffer.from(c.source)) })
  }
}
fs.writeFileSync(path.join(out, 'sources.json'), JSON.stringify(rows, null, 2) + '\n')
const flags = ['-env:UserInstallation=' + pathToFileURL(profile).href, '--headless']
const native = process.env.RTF_LIBREOFFICE || 'soffice'
const run = (exe, args) => execFileSync(exe, args, { encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024 })
const version = run(native, [...flags, '--version']).trim()
fs.writeFileSync(path.join(out, 'writer.log'), run(native, [...flags, '--convert-to', 'html', '--outdir', converted, ...rows.map(r => r.file)]))
async function browser (views) {
  const results = []
  for (const v of views) {
    const frame = document.createElement('iframe'); frame.sandbox = 'allow-same-origin'; document.body.append(frame)
    await new Promise(resolve => { frame.onload = resolve; frame.srcdoc = v.html })
    const d = frame.contentDocument
    results.push({ name: v.name, visible: d.body.innerText, cells: [...d.querySelectorAll('td')].map(n => n.innerText), paragraphs: [...d.querySelectorAll('p')].map(n => n.innerText) })
    frame.remove()
  }
  document.querySelector('output').setAttribute('data-results', encodeURIComponent(JSON.stringify(results)))
}
const views = rows.map(r => ({ name: r.name, html: fs.readFileSync(path.join(converted, r.name + '.html'), 'utf8') }))
const page = path.join(out, 'views.html')
fs.writeFileSync(page, '<!doctype html><meta charset="utf-8"><output></output><script>(' + browser + ')(' + JSON.stringify(views).replace(/</g, '\\u003c') + ').catch(e=>document.querySelector("output").textContent=e.stack)</script>')
const chrome = process.env.HTML_READER_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const dom = run(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--virtual-time-budget=10000', '--dump-dom', pathToFileURL(page).href])
const match = /data-results="([^"]+)"/.exec(dom)
if (!match) throw new Error('Native views did not complete')
const nativeRows = JSON.parse(decodeURIComponent(match[1]))
for (const row of rows) {
  row.writer = nativeRows.find(r => r.name === row.name)
  row.sameCharacters = row.reader != null && row.reader.replace(/\s/g, '') === row.writer.visible.replace(/\s/g, '')
}
const report = { at: new Date().toISOString(), version, sources: rows.length, characterDifferences: rows.filter(r => !r.sameCharacters).map(r => r.name), rows, scope: 'Exploratory native RTF import -> unmodified HTML -> Chrome visible text. Full raw strings/cells retained. Whitespace-free comparison only screens character loss; not table-layout or whitespace certification. Unicode fallback control cases may expose native-reference limitations.' }
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ sources: rows.length, differences: report.characterDifferences, report: path.join(out, 'report.json') }))
