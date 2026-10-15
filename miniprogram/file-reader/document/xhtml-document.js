'use strict'

// A bounded, non-validating XHTML reader. Never fetch a DTD or expand declared
// entities. XML syntax is selected by the input MIME/extension, not its doctype.
const XHTML = 'http://www.w3.org/1999/xhtml'
const XML = 'http://www.w3.org/XML/1998/namespace'
const XMLNS = 'http://www.w3.org/2000/xmlns/'
const START = 'A-Za-z_\\u00c0-\\u00d6\\u00d8-\\u00f6\\u00f8-\\u02ff\\u0370-\\u037d\\u037f-\\u1fff\\u200c-\\u200d\\u2070-\\u218f\\u2c00-\\u2fef\\u3001-\\ud7ff\\uf900-\\ufdcf\\ufdf0-\\ufffd\\u{10000}-\\u{effff}'
const PART = START + '0-9.\\-\\u00b7\\u0300-\\u036f\\u203f-\\u2040'
const NAME = new RegExp(`^[${START}][${PART}]*(?::[${START}][${PART}]*)?`, 'u')
const validChar = n => n===9 || n===10 || n===13 || n>=32 && n<=0xd7ff || n>=0xe000 && n<=0xfffd || n>=0x10000 && n<=0x10ffff

function parseXhtmlDocument (input, options = {}) {
  const { ShimDocument } = require('./html-runtime/html-dom-shim')
  const source=String(input||'').replace(/^\ufeff/,'').replace(/\r\n?/g,'\n')
  let offset=0, nodes=0, root=null, doctype=false
  const fail=message=>{const error=new SyntaxError(`XHTML ${message}（位置 ${offset}）`);error.code='XHTML_PARSE_ERROR';throw error}
  if(source.length>20*1024*1024)fail('内容超过本机解析上限')
  for(const c of source)if(!validChar(c.codePointAt(0)))fail('包含无效 XML 字符')
  const entities={lt:'<',gt:'>',amp:'&',quot:'"',apos:"'"}
  const decode=(value,attribute=false)=>{
    const text=attribute?value.replace(/[\t\n\r]/g,' '):value
    let cursor=0,result=''
    while(cursor<text.length){const start=text.indexOf('&',cursor);if(start<0){result+=text.slice(cursor);break}result+=text.slice(cursor,start);const end=text.indexOf(';',start+1);if(end<0)fail('实体引用缺少分号');const name=text.slice(start+1,end);let replacement
      if(Object.prototype.hasOwnProperty.call(entities,name))replacement=entities[name]
      else if(/^#(?:[0-9]+|x[0-9a-fA-F]+)$/.test(name)){const n=name[1]==='x'?parseInt(name.slice(2),16):Number(name.slice(1));if(!validChar(n))fail('无效数字字符引用');replacement=String.fromCodePoint(n)}
      else fail('未声明或不支持的实体引用；不读取外部实体')
      result+=replacement;cursor=end+1
    }return result
  }
  const doc=new ShimDocument({...options,contentType:'application/xhtml+xml'})
  doc.childNodes=[]
  const stack=[],base=Object.assign(Object.create(null),{xml:XML,xmlns:XMLNS})
  const append=node=>{if(++nodes>100000)fail('节点数量超过本机解析上限');const parent=stack.length?stack[stack.length-1].node:doc;parent.appendChild(node)}
  const name=()=>{const m=source.slice(offset).match(NAME);if(!m)fail('无效标签或属性名称');offset+=m[0].length;return m[0]}
  const space=()=>{const start=offset;while(/[\t\n\r ]/.test(source[offset]||''))offset++;return offset>start}
  while(offset<source.length){
    if(source.startsWith('<!--',offset)){const end=source.indexOf('-->',offset+4);if(end<0||source.slice(offset+4,end).includes('--')||source[end-1]==='-')fail('注释未正确结束');append(doc.createComment(source.slice(offset+4,end)));offset=end+3;continue}
    if(source.startsWith('<?',offset)){const end=source.indexOf('?>',offset+2);if(end<0)fail('处理指令未结束');const pi=source.slice(offset+2,end),target=pi.match(NAME)?.[0];if(!target||pi.length>target.length&&!/^[\t\n ]/.test(pi.slice(target.length)))fail('处理指令名称无效');if(target.toLowerCase()==='xml'&&(target!=='xml'||offset!==0||!/^xml[\t\n ]+version\s*=\s*(["'])1\.0\1(?:\s+encoding\s*=\s*(["'])[A-Za-z][A-Za-z0-9._-]*\2)?(?:\s+standalone\s*=\s*(["'])(?:yes|no)\3)?\s*$/.test(pi)))fail('不支持的 XML 声明');offset=end+2;continue}
    if(source.startsWith('<!DOCTYPE',offset)){
      if(root||doctype)fail('DOCTYPE 位置错误');doctype=true;let quote='',end=offset+9
      for(;end<source.length;end++){const c=source[end];if(quote){if(c===quote)quote=''}else if(c==='"'||c==="'")quote=c;else if(c==='[')fail('暂不支持内部 DTD 或实体声明');else if(c==='>')break}
      if(end===source.length)fail('DOCTYPE 未结束')
      if(!/^<!DOCTYPE\s+html(?:\s+(?:PUBLIC\s+(?:"[^"]*"|'[^']*')\s+(?:"[^"]*"|'[^']*')|SYSTEM\s+(?:"[^"]*"|'[^']*')))?\s*>$/.test(source.slice(offset,end+1)))fail('不支持的 DOCTYPE')
      offset=end+1;continue
    }
    if(source.startsWith('<![CDATA[',offset)){if(!stack.length)fail('CDATA 必须位于元素内部');const end=source.indexOf(']]>',offset+9);if(end<0)fail('CDATA 未结束');append(doc.createTextNode(source.slice(offset+9,end)));offset=end+3;continue}
    if(source.startsWith('</',offset)){offset+=2;const close=name();space();if(source[offset++]!=='>'||!stack.length||stack[stack.length-1].name!==close)fail('结束标签不匹配');stack.pop();continue}
    if(source[offset]==='<'){
      offset++;const tag=name(),attrs=[];const used=new Set();let separated=space()
      while(offset<source.length&&source[offset]!=='>'&&!source.startsWith('/>',offset)){
        if(!separated)fail('属性之间缺少空格');const key=name();if(used.has(key))fail('属性重复');used.add(key);space();if(source[offset++]!=='=')fail('属性缺少等号');space();const quote=source[offset++];if(quote!=='"'&&quote!=="'")fail('属性必须加引号');const end=source.indexOf(quote,offset);if(end<0)fail('属性未结束');const raw=source.slice(offset,end);if(raw.includes('<'))fail('属性包含未转义尖括号');attrs.push([key,decode(raw,true)]);offset=end+1;separated=space()
      }
      const selfClosing=source.startsWith('/>',offset);if(!selfClosing&&source[offset]!=='>')fail('标签未结束');offset+=selfClosing?2:1
      const ns=Object.create(stack.length?stack[stack.length-1].ns:base)
      for(const [key,value]of attrs)if(key==='xmlns'||key.startsWith('xmlns:')){const prefix=key==='xmlns'?'':key.slice(6);if(prefix==='xmlns'||prefix==='xml'&&value!==XML||value===XMLNS||value===XML&&prefix!=='xml'||prefix&& !value)fail('命名空间声明无效');ns[prefix]=value}
      const parts=tag.split(':'),local=parts[parts.length-1],uri=ns[parts.length===2?parts[0]:'']||''
      if(parts.length===2&&!uri)fail('标签前缀未声明')
      if(![XHTML,'http://www.w3.org/2000/svg','http://www.w3.org/1998/Math/MathML'].includes(uri))fail('暂不支持此 XML 命名空间')
      if(!stack.length){if(root)fail('存在多个根元素');if(local!=='html'||uri!==XHTML)fail('根元素必须是 XHTML html')}
      const node=doc.createElement(local);node.namespaceURI=uri;node.prefix=parts.length===2?parts[0]:null;node.tagName=tag;node.nodeName=tag
      const expanded=new Set()
      for(const [key,value]of attrs){const split=key.split(':');if(split.length===2&&!ns[split[0]])fail('属性前缀未声明');const identity=split.length===2?ns[split[0]]+'|'+split[1]:'|'+key;if(expanded.has(identity))fail('命名空间属性重复');expanded.add(identity);node.setAttribute(key,value)}
      append(node);if(!root)root=node
      if(!selfClosing){if(stack.length>=256)fail('嵌套深度超过本机解析上限');stack.push({name:tag,node,ns})}continue
    }
    const next=source.indexOf('<',offset),end=next<0?source.length:next,raw=source.slice(offset,end)
    if(raw.includes(']]>'))fail('正文包含未转义 CDATA 结束标记')
    if(!stack.length){if(!/^[\t\n\r ]*$/.test(raw))fail('根元素外存在正文')}else if(raw)append(doc.createTextNode(decode(raw)))
    offset=end
  }
  if(!root||stack.length)fail('文档未完整结束')
  doc.documentElement=root
  doc.head=root.children.find(n=>n.localName==='head'&&n.namespaceURI===XHTML)||doc.createElement('head')
  doc.body=root.children.find(n=>n.localName==='body'&&n.namespaceURI===XHTML)
  if(!doc.body)fail('当前 XHTML 预览需要 body 正文')
  const scripts=[]
  for(const node of doc.querySelectorAll('script')){const type=(node.getAttribute('type')||'').split(';')[0].trim().toLowerCase();if(node.namespaceURI===XHTML&&!node.hasAttribute('src')&&(!type||/^(?:text|application)\/(?:java|ecma)script$/.test(type)))scripts.push(node.textContent);node.remove()}
  const title=doc.head.querySelector('title')?.textContent.replace(/[\t\n\r ]+/g,' ').trim()||''
  doc._title=title;doc.readyState='interactive';doc._dirty=false;doc._onDirty=options.onDirty||null
  return {document:doc,scripts,title,get styles(){return doc.querySelectorAll('style').filter(n=>n.namespaceURI===XHTML&&!n.disabled&&(!n.getAttribute('type')||n.getAttribute('type').toLowerCase()==='text/css')).map(n=>n.getAttribute('media')?`@media ${n.getAttribute('media')}{${n.textContent}}`:n.textContent)}}
}
module.exports={parseXhtmlDocument}
