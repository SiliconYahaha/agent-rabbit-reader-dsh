'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const {parseHtmlDocument}=require('../miniprogram/file-reader/document/html-runtime/html-dom-shim')
const {createRuntime}=require('../miniprogram/file-reader/document/html-runtime/html-script-runtime')
const {fileKind,htmlContentType,isSupportedMaterial}=require('../miniprogram/file-reader/shared/file-types')
const {renderHtmlDomTree}=require('../miniprogram/file-reader/document/document-renderer')
const {cases,invalid,policy,wrap,visualHtml}=require('./helpers/xhtml')
const find=(nodes,id)=>{for(const n of nodes){if(n.attrs?.id===id)return n;const child=find(n.children||[],id);if(child)return child}}
test('XHTML routes by explicit MIME or extension; HTML MIME and doctypes do not switch grammar',()=>{
  for(const f of [{name:'page.xhtml'},{name:'page.XHT '},{name:'unknown',type:'APPLICATION/XHTML+XML; charset=UTF-8'}]){assert.equal(fileKind(f),'html');assert.equal(htmlContentType(f),'application/xhtml+xml');assert.ok(isSupportedMaterial({...f,path:'/local/source'}))}
  assert.equal(htmlContentType({name:'page.xhtml',type:'text/html'}),'text/html');assert.equal(htmlContentType({name:'page.html'}),'text/html')
  const source=wrap('<p id="probe"><![CDATA[<b>正文</b>&amp;]]></p>')
  assert.notEqual(parseHtmlDocument(source).document.getElementById('probe').textContent,'<b>正文</b>&amp;')
})
test('XHTML raw source yields exact prose and executable sandbox results',()=>{
  for(const c of cases){const rt=createRuntime(c.source,{contentType:'application/xhtml+xml'});try{rt.run();assert.deepEqual(rt.errors,[],c.name);assert.equal(rt.document.getElementById('probe').textContent,c.expected,c.name);assert.equal(rt.document.contentType,'application/xhtml+xml')}finally{rt.destroy()}}
})
test('malformed XML stops completely; policy restrictions and external entities are explicit',()=>{
  for(const c of [...invalid,...policy])assert.throws(()=>parseHtmlDocument(c.source,{contentType:'application/xhtml+xml'}),{code:'XHTML_PARSE_ERROR'},c.name)
})
test('public original CDATA style works without test adapter or source rewriting',()=>{
  const source=fs.readFileSync(path.join(__dirname,'fixtures/css-cascade-order/sort-by-order-001.xht'),'utf8')
  const r=renderHtmlDomTree(source,{contentType:'application/xhtml+xml'}),child=find(r.nodes,'child')
  assert.match(child.attrs.style,/background-color:green/);assert.match(child.attrs.style,/width:100px/);assert.match(child.attrs.style,/height:100px/)
})
test('XML preserves attribute whitespace references, case and qualified element names',()=>{
  const p=parseHtmlDocument(wrap('<P ID="upper">大写</P><p id="probe" title="A&#9;B\nC">正文</p>'),{contentType:'application/xhtml+xml'}).document
  assert.equal(p.querySelector('P').getAttribute('ID'),'upper');assert.equal(p.querySelector('P').getAttribute('id'),null);assert.equal(p.querySelector('p').textContent,'正文');assert.equal(p.getElementById('probe').getAttribute('title'),'A\tB C')
  const output=renderHtmlDomTree(wrap('<p ID="other" id="probe">正文</p>'),{contentType:'application/xhtml+xml'})
  assert.equal(find(output.nodes,'probe').attrs.ID,undefined)
})
test('XHTML script click changes real text and style; generated text is not markup',()=>{
  const rt=createRuntime(visualHtml,{contentType:'application/xhtml+xml'})
  try{rt.run();assert.equal(rt.document.getElementById('probe').textContent,'<b>原文</b> &amp;');assert.equal(rt.dispatchTap(rt.document.getElementById('change')._nid),true);assert.equal(rt.document.getElementById('probe').textContent,'更新成功 <保持原文>');assert.match(find(renderHtmlDomTree(rt.document,{styles:rt.renderState().styles}).nodes,'probe').attrs.style,/color:blue/);assert.equal(rt.document.querySelectorAll('b').length,0);assert.deepEqual(rt.errors,[])}finally{rt.destroy()}
})
test('XML depth and node budgets stop in an isolated process and large CDATA stays exact',()=>{
  require('node:child_process').execFileSync(process.execPath,['-e',`const a=require('node:assert/strict'),p=require('./miniprogram/file-reader/document/xhtml-document').parseXhtmlDocument,w=b=>'<html xmlns="http://www.w3.org/1999/xhtml"><head/><body>'+b+'</body></html>';a.throws(()=>p(w('<div>'.repeat(260)+'x'+'</div>'.repeat(260))),/深度/);a.throws(()=>p(w('<br/>'.repeat(100001))),/节点/);const text='<>&amp;'.repeat(100000);a.equal(p(w('<p id="p"><![CDATA['+text+']]></p>')).document.getElementById('p').textContent,text);`],{cwd:path.join(__dirname,'..'),timeout:5000})
})
test('script DOMParser XHTML uses XML syntax and reports parsererror for malformed content',()=>{
  const source=JSON.stringify(wrap('<p id="probe"><![CDATA[<b>正文</b>]]></p>')).replace(/</g,'\\u003c')
  const rt=createRuntime('<p id="p"></p><script>var d=new DOMParser().parseFromString('+source+',"application/xhtml+xml");document.getElementById("p").textContent=d.getElementById("probe").textContent+"|"+new DOMParser().parseFromString("<broken>","application/xhtml+xml").documentElement.localName;</script>')
  try{rt.run();assert.equal(rt.document.getElementById('p').textContent,'<b>正文</b>|parsererror');assert.deepEqual(rt.errors,[])}finally{rt.destroy()}
})
test('XML byte decoding honors declarations and BOMs and never guesses past corrupt data',()=>{
  const {decodeText}=require('../miniprogram/file-reader/engine/core/text-decoder'),iconv=require('iconv-lite')
  for(const encoding of ['utf-8','utf-16le','utf-16be','GB18030','Shift_JIS','Big5','windows-1252','ISO-8859-1']){
    const text=encoding==='windows-1252'||encoding==='ISO-8859-1'?'Café':'文字'
    const source='<?xml version="1.0" encoding="'+encoding+'"?>'+wrap('<p id="probe">'+text+'</p>')
    const bytes=iconv.encode(source,encoding,{addBOM:encoding.startsWith('utf-16')})
    assert.equal(decodeText(bytes,{kind:'xhtml'}).text,source,encoding)
  }
  const bad=Buffer.concat([Buffer.from(wrap('<p>PLACEHOLDER</p>').split('PLACEHOLDER')[0]),Buffer.from([0xff]),Buffer.from('</p></body></html>')])
  assert.throws(()=>decodeText(bad,{kind:'xhtml'}),/编码/)
  assert.throws(()=>decodeText(Buffer.from('<?xml version="1.0" encoding="unknown"?>'+wrap('<p/>')),{kind:'xhtml'}),/不支持/)
  assert.throws(()=>decodeText(Buffer.concat([Buffer.from([239,187,191]),Buffer.from('<?xml version="1.0" encoding="GBK"?>'+wrap('<p/>'))]),{kind:'xhtml'}),/冲突/)
  assert.equal(decodeText(Buffer.from('<?xml version="1.0" encoding="GBK"?><p>文字</p>'),{kind:'html'}).encoding,'utf-8')
})
