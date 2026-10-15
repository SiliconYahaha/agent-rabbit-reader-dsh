'use strict'
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib'), assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { readerPage } = require('../tests/helpers/reader-host')
const corpus = require('../tests/fixtures/dxf-mtext/samples.json')
async function main () {
  const out = path.resolve(process.argv[2] || 'outputs/dxf-mtext/verified')
  fs.mkdirSync(out, { recursive: true })
  let bytes
  const host = readerPage({ getFileSystemManager: () => ({ readFile: o => o.success({ data: bytes }) }) })
  const cases = []
  try {
    for (const sample of [...corpus.cases, ...corpus.roleCases]) {
      bytes = zlib.gunzipSync(Buffer.from(sample.sourceGzipBase64, 'base64'))
      host.openSelectedFile({ name: sample.name + '.dxf', path: '/fixture/input.dxf', size: bytes.length })
      await new Promise(setImmediate)
      assert.equal(host.data.error, '', sample.name)
      const svg = Buffer.from(host.data.inspectorPreviewSource.split(',')[1], 'base64').toString()
      fs.writeFileSync(path.join(out, sample.name + '.svg'), svg)
      let expected
      const policy = ['tolerance-stack', 'unknown-control', 'unterminated-color', 'unterminated-stack', 'trailing-backslash'].includes(sample.case)
      if (policy) expected = [sample.authored]
      else if (sample.case === 'fraction-slash' || sample.case === 'fraction-diagonal') expected = ['1', '1', '2', ' units']
      else if (sample.name.includes('editor-tolerance')) expected = ['1.000', '+0.010', '-0.000']
      else if (sample.case === 'nonbreaking-space') expected = ['A\u00a0B']
      else expected = (sample.kind === 'TEXT' ? sample.plain : sample.case === 'literal-cif' ? sample.nativePlain : sample.nativeDecodedHelper ?? sample.plain).split('\n').filter(Boolean)
      cases.push({ name: sample.name, case: sample.case, svg, expected, policy, warning: host.data.metadata && host.data.metadata.some(r => /未完整还原/.test(r.value)) })
    }
    for (const extra of [
      { name: 'tabs-bounds', source: 'A' + '\t'.repeat(32) + 'END', expected: ['A' + '\t'.repeat(32) + 'END'] },
      { name: 'paragraph-height-change', source: String.raw`small\P{\H10x;LARGE}`, expected: ['small', 'LARGE'] },
      { name: 'leading-trailing-space', source: '  padded  ', expected: ['  padded  '] }
    ]) {
      bytes = Buffer.from(['0','MTEXT','1',extra.source,'40','3','0','EOF',''].join('\n'))
      host.openSelectedFile({ name: extra.name + '.dxf', path: '/fixture/input.dxf', size: bytes.length })
      await new Promise(setImmediate)
      assert.equal(host.data.error, '')
      cases.push({ ...extra, svg: Buffer.from(host.data.inspectorPreviewSource.split(',')[1], 'base64').toString() })
    }
  } finally { host.detached() }
  const payload = JSON.stringify(cases).replace(/</g, '\\u003c')
  const page = `<!doctype html><meta charset="utf-8"><style>body{margin:0}.case{width:390px;height:300px}.case>svg{width:100%;height:100%;display:block}</style><div id="cases"></div><script>
const cases=${payload},rows=[];
for(const c of cases){const wrapper=document.createElement('div');wrapper.className='case';wrapper.innerHTML=c.svg;document.getElementById('cases').append(wrapper);const svg=wrapper.querySelector('svg'),v=svg.viewBox.baseVal;
const texts=[...svg.querySelectorAll('text')],labels=texts.map(t=>t.textContent),bounds=texts.map(t=>{const b=t.getBBox(),m=t.getCTM(),a=svg.getCTM().inverse().multiply(m);const pts=[[b.x,b.y],[b.x+b.width,b.y],[b.x,b.y+b.height],[b.x+b.width,b.y+b.height]].map(p=>new DOMPoint(...p).matrixTransform(a));return {fits:pts.every(p=>p.x>=v.x-.02&&p.x<=v.x+v.width+.02&&p.y>=v.y-.02&&p.y<=v.y+v.height+.02),width:b.width,height:b.height,y:t.getBoundingClientRect().y}});
const checks={content:JSON.stringify(labels)===JSON.stringify(c.expected),bounds:bounds.every(b=>b.fits&&b.width>=0&&b.height>0),safe:svg.querySelectorAll('script').length===0};
if(c.case==='nested-color-height'){const spans=[...svg.querySelectorAll('tspan')],large=spans.find(t=>t.textContent==='large'),red=spans.find(t=>t.textContent==='red '),last=spans.at(-1);checks.style=getComputedStyle(large).fill==='rgb(255, 0, 0)'&&parseFloat(getComputedStyle(large).fontSize)===2*parseFloat(getComputedStyle(red).fontSize)&&getComputedStyle(last).fill==='rgb(23, 23, 21)'}
if(c.case==='font-metadata'){const b=[...svg.querySelectorAll('tspan')].find(t=>t.textContent==='Bold');checks.bold=getComputedStyle(b).fontWeight==='700'}
if(c.name==='paragraph-height-change')checks.noParagraphOverlap=texts[0].getBoundingClientRect().bottom<texts[1].getBoundingClientRect().top;
if(c.case==='paragraphs')checks.emptyParagraph=bounds[1].y-bounds[0].y>texts[0].getBoundingClientRect().height*2.5;
const upper=svg.querySelector('[data-dxf-stack="numerator"]'),lower=svg.querySelector('[data-dxf-stack="denominator"]'),divider=svg.querySelector('[data-dxf-stack="divider"]');if(upper){const a=upper.getBoundingClientRect(),b=lower.getBoundingClientRect();checks.stack=a.bottom<b.top;checks.divider=c.name.includes('editor-tolerance')?!divider:!!divider;if(c.case==='fraction-diagonal')checks.diagonal=a.x<b.x}
rows.push({name:c.name,expected:c.expected,labels,bounds,checks});}
document.body.setAttribute('data-report',btoa(unescape(encodeURIComponent(JSON.stringify(rows)))));
</script>`
  const htmlPath = path.join(out, 'views.html'); fs.writeFileSync(htmlPath, page)
  const chrome = process.env.HTML_READER_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  const dom = execFileSync(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--dump-dom', 'file://' + htmlPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 20 * 1024 * 1024 })
  const encoded = /data-report="([^"]+)"/.exec(dom); assert.ok(encoded, 'browser report required')
  const rows = JSON.parse(Buffer.from(encoded[1], 'base64').toString()), failures = rows.filter(r => Object.values(r.checks).some(v => !v)).map(r => ({ name: r.name, checks: r.checks }))
  const report = { testedAt: new Date().toISOString(), scope: '46 original and3 boundary Node host files; Chrome renders actual returned SVG and checks independent text expectations, visible glyph bounds, style scope, paragraph gaps and stack positions/dividers. No full CAD font/width/wrapping or WeChat/device fidelity claim.', rows, failures }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ cases: rows.length, failures, report: path.join(out, 'report.json') }))
  assert.deepEqual(failures, [])
}
main().catch(error => { console.error(error); process.exitCode = 1 })
