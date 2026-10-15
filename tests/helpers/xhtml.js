'use strict'
const wrap=(body,head='')=>`<html xmlns="http://www.w3.org/1999/xhtml"><head>${head}</head><body>${body}</body></html>`
const cases=[]
const add=(name,body,expected,head='')=>cases.push({name,source:wrap(body,head),expected})
add('cdata-prose','<p id="probe"><![CDATA[<b>正文</b>&amp;]]></p>','<b>正文</b>&amp;')
add('numeric-and-xml-entities','<p id="probe">&#x1f407;&#65;&amp;&lt;&gt;&quot;&apos;</p>','🐇A&<>"\'')
add('replacement-name','<\ufffd><p id="probe">替代字符是合法名称</p></\ufffd>','替代字符是合法名称')
add('supplementary-name','<\ud800\udc00><p id="probe">成对代理字符是合法名称</p></\ud800\udc00>','成对代理字符是合法名称')
add('self-closing-sibling','<div/><p id="probe">后续正文</p>','后续正文')
add('cdata-styles','<p id="probe">绿色正文</p>','绿色正文','<style><![CDATA[#probe{color:green}]]></style>')
add('style-entity-decoding','<p id="probe">正文</p>','正文','<style>#probe::before{content:"A&amp;B"}</style>')
add('script-cdata','<p id="probe">未执行</p><script><![CDATA[document.getElementById("probe").textContent="2 < 3 & 4"]]></script>','2 < 3 & 4')
add('script-entity-decoding','<p id="probe">未执行</p><script>document.getElementById("probe").textContent="A&amp;B"</script>','A&B')
add('script-close-literal','<p id="probe">未执行</p><script><![CDATA[document.getElementById("probe").textContent="</script>"]]></script>','</script>')
add('style-close-literal','<p id="probe">正文</p>','正文','<style><![CDATA[#probe::before{content:"</style>"}]]></style>')
add('case-sensitive-tags','<P id="upper">大写</P><p id="probe">小写</p>','小写','<style>p{color:green}P{color:red}</style>')
add('case-sensitive-attributes','<p ID="other" id="probe">正文</p>','正文')
add('comment-cdata','<!-- <![CDATA[不是正文]]> --><p id="probe">真正正文</p>','真正正文')
add('cdata-adjacent','<p id="probe"><![CDATA[A&]]><![CDATA[<B>]]>C</p>','A&<B>C')
add('crlf-cdata','<p id="probe"><![CDATA[A\r\nB\rC]]></p>','A\nB\nC')
add('attribute-references','<p id="probe" title="A&#9;B\nC">正文</p>','正文')
add('prefix','<h:p xmlns:h="http://www.w3.org/1999/xhtml" id="probe">前缀正文</h:p>','前缀正文')
add('svg-self-close','<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L10 10"/></svg><p id="probe">图后正文</p>','图后正文')
cases.push({name:'external-dtd-not-fetched',source:'<!DOCTYPE html SYSTEM "https://invalid.example/private.dtd">'+wrap('<p id="probe">本机正文</p>'),expected:'本机正文'})
cases.push({name:'xml-declaration',source:'<?xml version="1.0" encoding="UTF-8"?>'+wrap('<p id="probe">声明正文</p>'),expected:'声明正文'})
cases.push({name:'processing-instruction',source:'<?xml\tversion="1.0"?><?xml-stylesheet type="text/css" href="https://invalid.example/blocked.css"?>'+wrap('<p id="probe">指令不替换正文</p>'),expected:'指令不替换正文'})
for(let i=1;i<=8;i++)add('cdata-variant-'+i,'<p id="probe">'+('<![CDATA[<>&amp;]]>'.repeat(i))+'</p>','<>&amp;'.repeat(i))
const invalid=[
  ['truncated',wrap('<p>正文</p>').slice(0,-4)],['mismatch',wrap('<p>正文</div>')],['case-mismatch',wrap('<P>正文</p>')],
  ['attribute-unquoted',wrap('<p id=p>正文</p>')],['duplicate-attribute',wrap('<p id="a" id="b"/>')],['unbound-prefix',wrap('<x:p/>')],
  ['missing-semicolon',wrap('<p>&amp</p>')],['unknown-entity',wrap('<p>&missing;</p>')],['numeric-null',wrap('<p>&#0;</p>')],
  ['numeric-surrogate',wrap('<p>&#xD800;</p>')],['raw-null',wrap('<p>\0</p>')],['missing-cdata-end',wrap('<p><![CDATA[正文</p>')],
  ['bad-comment',wrap('<!--bad--comment--><p/>')],['two-roots',wrap('<p/>')+wrap('<p/>')],['text-outside',wrap('<p/>')+'正文'],
  ['bad-attribute-angle',wrap('<p title="<"/>')],['raw-cdata-end',wrap('<p>]]></p>')],['missing-attribute-space',wrap('<p a="1"b="2"/>')],
  ['duplicate-expanded-attribute',wrap('<p xmlns:a="urn:x" xmlns:b="urn:x" a:x="1" b:x="2"/>')],['invalid-xml-prefix',wrap('<p xmlns:xml="urn:x"/>')],
  ['bad-pi',wrap('<? ?>')],['bad-name',wrap('<×/>')],['bad-name-surrogate',wrap('<\ud800/>')]
].map(([name,source])=>({name,source}))
const policy=[['internal-entity','<!DOCTYPE html [<!ENTITY x "value">]>'+wrap('<p>&x;</p>')],['xxe','<!DOCTYPE html [<!ENTITY x SYSTEM "file:///private">]>'+wrap('<p>&x;</p>')],['unknown-namespace',wrap('<x xmlns="urn:unknown"/>')],['empty-namespace',wrap('<p xmlns="">不冒充HTML</p>')]].map(([name,source])=>({name,source}))
const visualHtml='<?xml version="1.0" encoding="UTF-8"?>'+wrap('<h1>XHTML 原件</h1><p id="probe"><![CDATA[<b>原文</b> &amp;]]></p><button id="change">更新正文</button><script><![CDATA[document.getElementById("change").onclick=function(){var p=document.getElementById("probe");p.textContent="更新成功 <保持原文>";p.style.color="blue"}]]></script>','<style><![CDATA[body{margin:0;padding:18px;background:white;color:#171717;font:18px sans-serif}#probe{color:green;padding:12px;border:1px solid green;line-height:1.6}button{font:inherit;padding:12px}]]></style>')
module.exports={wrap,cases,invalid,policy,visualHtml}
