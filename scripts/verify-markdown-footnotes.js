'use strict'
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto')
const { execFileSync } = require('node:child_process'), { pathToFileURL } = require('node:url')
const { cases, htmlCases } = require('../tests/helpers/markdown-footnotes')
const output = path.resolve(process.argv[2] || 'outputs/markdown-footnotes-views')
fs.mkdirSync(output, { recursive: true })
const baseline = process.argv.indexOf('--baseline-ref')
if (baseline >= 0) for (const relative of ['markdown/runtime/markdown-document', 'document/html-runtime/html-dom-shim']) {
  const filename = require.resolve('../miniprogram/file-reader/' + relative), Module = require('node:module'), m = new Module(filename, module)
  m.filename = filename; m.paths = module.paths
  m._compile(execFileSync('git', ['show', process.argv[baseline + 1] + ':miniprogram/file-reader/' + relative + '.js'], {encoding:'utf8'}), filename)
  require.cache[filename] = m
}
const { readerPage } = require('../tests/helpers/reader-host')
const { renderHtmlDomTree } = require('../miniprogram/file-reader/document/document-renderer')
const { parseHtmlDocument, serializeNode } = require('../miniprogram/file-reader/document/html-runtime/html-dom-shim')
const escape = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
const serialize = n => {
  if (n.type === 'text') return escape(n.text)
  // WXML uses view nodes for the grid table and cells. Native HTML table tags
  // would invent tbody/tr wrappers and change the grid before measurement.
  const tag = ['table','th','td'].includes(n.name) ? 'div' : n.name
  return `<${tag} data-reader-tag="${n.name}" ${Object.entries(n.attrs || {}).map(([k,v]) => `${k}="${escape(v)}"`).join(' ')}>${(n.children || []).map(serialize).join('')}</${tag}>`
}
async function browser (views) {
  const results = []
  for (const view of views) {
    const row = { name: view.name, kind: view.kind }
    for (const key of ['actual', 'reference', ...(view.fragment ? ['fragment'] : [])]) {
      const frame = document.createElement('iframe'); frame.style.cssText = 'width:390px;height:844px'; document.body.append(frame)
      await new Promise(resolve => { frame.onload = resolve; frame.srcdoc = '<body>' + view[key] + '</body>' })
      const d = frame.contentDocument
      if (view.kind === 'html') {
        row[key] = [...d.querySelectorAll('[id]')].filter(n => !n.id.startsWith('html-reader')).map(n => {
          const parents = []; for (let p = n.parentElement; p; p = p.parentElement) if (p.id && !p.id.startsWith('html-reader')) parents.push(p.id)
          return { id: n.id, parents, text: n.textContent }
        })
      } else {
        const notes = [...d.querySelectorAll('.md-footnote,.footnote-item')], refs = [...d.querySelectorAll('.md-footnote-ref a,.footnote-ref a')]
        const rawRefs = refs.map(a => ({ id: a.id, label: a.textContent, href: a.getAttribute('href'), target: notes.indexOf(d.getElementById(a.getAttribute('href').slice(1))) }))
        const backlinks = [...d.querySelectorAll('.md-footnote-backref,.footnote-backref')].map(a => ({ href: a.getAttribute('href'), exists: !!d.getElementById(a.getAttribute('href').slice(1)) }))
        refs.forEach((a,i) => { a.textContent = '[' + (rawRefs[i].target + 1) + ']' })
        d.querySelectorAll('.md-footnote-num,.md-footnote-backref,.footnote-backref').forEach(n => n.remove())
        const text = n => n.innerText.trim().replace(/\s+/g, ' ')
        const code = n => [...n.querySelectorAll('pre')].map(p => {
          const range = d.createRange(); range.selectNodeContents(p)
          return { text: p.textContent, selected: range.toString() }
        })
        // The reader lays tables out as a CSS grid. Compare visible cell rows
        // and order, rather than demanding the browser's tr wrapper structure.
        const tables = n => [...n.querySelectorAll('table,[data-reader-tag="table"]')].map(table => {
          const cells = [...table.querySelectorAll('th,td,[data-reader-tag="th"],[data-reader-tag="td"]')].map(cell => ({text:text(cell),x:cell.getBoundingClientRect().x,y:cell.getBoundingClientRect().y}))
          const ys = [...new Set(cells.map(c=>c.y))].sort((a,b)=>a-b)
          return ys.map(y=>cells.filter(c=>c.y===y).sort((a,b)=>a.x-b.x).map(c=>c.text))
        })
        const noteContent = notes.map(n => ({ text: text(n), paragraphs: [...n.querySelectorAll('p')].filter(p=>p.textContent.trim()).length, code: code(n), listItems: n.querySelectorAll('ul>li,ol>li').length, quotes: n.querySelectorAll('blockquote').length, tables: tables(n) }))
        d.querySelectorAll('.md-footnotes,.footnotes,.md-footnote-ref,.footnote-ref,.footnotes-sep').forEach(n => n.remove())
        row[key] = { body: text(d.body), code: code(d.body), notes: noteContent, targets: rawRefs.map(r => r.target) }
        row[key + 'Links'] = { refs: rawRefs, backlinks }
      }
      frame.remove()
    }
    results.push(row)
  }
  document.querySelector('output').setAttribute('data-result', encodeURIComponent(JSON.stringify(results)))
}
async function main () {
  let bytes; const scrolls = [], actions = [], views = []
  const page = readerPage({ getWindowInfo: () => ({windowWidth:390,windowHeight:844,pixelRatio:1}), getFileSystemManager: () => ({readFile:o=>o.success({data:bytes})}) })
  page.scrollToDomNid = nid => scrolls.push(nid)
  try {
    for (const [kind, samples] of [['markdown', cases], ['html', htmlCases]]) for (const sample of samples) {
      if (sample.sha256) assert.equal(crypto.createHash('sha256').update(sample.source).digest('hex'), sample.sha256, sample.name)
      bytes = Buffer.from(sample.source)
      page.openSelectedFile({name:sample.name + (kind === 'html' ? '.html' : '.md'),path:'/local/input',size:bytes.length})
      await new Promise(setImmediate)
      assert.equal(page.data.error, '', sample.name)
      const runtime = page._htmlRuntime, d = runtime.document, tree = renderHtmlDomTree(d, {styles:runtime.renderState().styles,viewportWidth:390})
      const row = {name:sample.name,kind,actual:tree.nodes.map(serialize).join(''),reference:sample.referenceHtml || sample.source}
      if (kind === 'html') { const f = parseHtmlDocument('<div></div>').document; f.body.innerHTML = sample.source; row.fragment = f.body.childNodes.map(serializeNode).join('') }
      for (const a of d.querySelectorAll('.md-footnote-ref a,.md-footnote-backref')) {
        const href = a.getAttribute('href'), target = d.getElementById(href.slice(1)), before = scrolls.length
        page.onDomTap({currentTarget:{dataset:{nid:a._nid}}})
        actions.push({name:sample.name,href,targetExists:!!target,scrolled:scrolls.length === before + 1,targetMatches:!!target && scrolls.at(-1) === target._nid})
      }
      views.push(row)
    }
  } finally { page.disposeHtmlRuntime() }
  const file = path.join(output, 'oracle.html')
  fs.writeFileSync(file, '<!doctype html><output></output><script>(' + browser + ')(' + JSON.stringify(views).replace(/</g,'\\u003c') + ').catch(e=>document.querySelector("output").textContent=e.stack)</script>')
  const chrome = process.env.HTML_READER_CHROME || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome')
  const dump = execFileSync(chrome, ['--headless=new','--no-sandbox','--disable-gpu','--dump-dom','--virtual-time-budget=15000',pathToFileURL(file).href], {encoding:'utf8',timeout:60000,maxBuffer:16*1024*1024,stdio:['ignore','pipe','ignore']})
  const match = dump.match(/data-result="([^"]+)"/); assert.ok(match, 'browser did not complete')
  const results = JSON.parse(decodeURIComponent(match[1])), failures = []
  for (const r of results) {
    if (JSON.stringify(r.actual) !== JSON.stringify(r.reference)) failures.push(r.name)
    if (r.fragment && JSON.stringify(r.fragment) !== JSON.stringify(r.reference)) failures.push(r.name + ':fragment')
    if (r.actualLinks && (r.actualLinks.refs.some(a=>a.target<0) || r.actualLinks.backlinks.length !== r.actualLinks.refs.length || r.actualLinks.backlinks.some(a=>!a.exists) || new Set(r.actualLinks.refs.map(a=>a.id)).size !== r.actualLinks.refs.length)) failures.push(r.name + ':links')
  }
  const actionFailures = actions.filter(a=>!a.targetExists || !a.scrolled || !a.targetMatches)
  const report = {testedAt:new Date().toISOString(),chrome:execFileSync(chrome,['--version'],{encoding:'utf8'}).trim(),markdownCases:cases.length,htmlCases:htmlCases.length,actions:actions.length,failures,actionFailures,results,actionResults:actions,views}
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify({markdownCases:cases.length,htmlCases:htmlCases.length,actions:actions.length,failures,actionFailures}))
  if (!process.argv.includes('--discover')) { assert.deepEqual(failures, []); assert.deepEqual(actionFailures, []) }
}
main().catch(error=>{console.error(error);process.exitCode=1})
