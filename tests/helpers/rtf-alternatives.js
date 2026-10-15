'use strict'
const wrap = body => '{\\rtf1\\ansi\\uc1 '+body+'}'
const unicode = text => Array.from(text).map(char => {
  let result = ''
  for (let i=0;i<char.length;i++) { const code=char.charCodeAt(i); result+='\\u'+(code>32767?code-65536:code)+'?' }
  return result
}).join('')
const pair = (ansi, selected) => '{\\upr{'+ansi+'}{\\*\\ud{'+selected+'}}}'
const cases = []
const add = (name, body, expected) => cases.push({name,source:wrap(body),expected})
add('body-alternative', 'Before '+pair('old',unicode('中文'))+' After', 'Before 中文 After')
add('result-alternative', pair('\\fldrslt ANSI','\\fldrslt '+unicode('中文')), '中文')
add('no-duplicate-ascii', pair('OLD','Unicode'), 'Unicode')
add('inline-ud', '{\\upr{old}{\\*\\ud '+unicode('新')+'}}', '新')
add('nested-selected', pair('OLD','A'+pair('OLD2',unicode('你好'))+'Z'), 'A你好Z')
add('nested-discarded', pair('OLD'+pair('bad',unicode('错')),'Chosen'), 'Chosen')
add('empty-selected', 'A'+pair('do not retain this','')+'Z', 'AZ')
add('scoped-fallback', pair('old','\\uc0\\u20320')+'\\u22909?', '你好')
add('hidden-parent', 'A{\\*\\unknown '+pair('leak','secret')+'}Z', 'AZ')
add('hidden-selected', 'A'+pair('leak','{\\info secret}')+'Z', 'AZ')
add('hidden-nested-destination', pair('old','A{\\*\\unknown secret}Z'), 'AZ')
// MS RTF 1.9.1 p.15 and Writer visible output: ud is a known Unicode destination.
add('standalone-ud-visible', 'A{\\*\\ud{hidden}}Z', 'AhiddenZ')
add('escaped-braces', pair('old', 'A\\{B\\}\\\\C'), 'A{B}\\C')
add('discarded-invalid-codepage', pair("\\ansicpg1251\\'c0", 'Unicode'), 'Unicode')
add('discarded-font-table', '{\\fonttbl{\\f0\\fcharset0 Arial;}}\\deff0'+pair('{\\fonttbl{\\f0\\fcharset134 SimSun;}}','Caf\\\'e9')+' Caf\\\'e9', 'Café Café')
add('selected-font-table', pair('{\\fonttbl{\\f0\\fcharset0 Arial;}}','{\\fonttbl{\\f0\\fcharset134 SimSun;}}')+"\\f0 \\'d6\\'d0", '中')
add('hidden-font-table', '{\\fonttbl{\\f0\\fcharset0 Arial;}}\\deff0'+pair('old',"{\\*\\unknown{\\fonttbl{\\f0\\fcharset134 SimSun;}}}Caf\\'e9"), 'Café')
add('info-font-table', '{\\fonttbl{\\f0\\fcharset0 Arial;}}\\deff0'+pair('old',"{\\info{\\fonttbl{\\f0\\fcharset134 SimSun;}}}Caf\\'e9"), 'Café')
add('alternative-in-font-table', '{\\fonttbl{\\f0\\fcharset0 Arial;}'+pair('\\f0\\fcharset134 SimSun;','')+'}\\f0 Caf\\\'e9','Café')
add('discarded-binary', pair('x\\bin8 {\\}abc{}','Chosen'), 'Chosen')
add('selected-binary', pair('old','A{\\pict\\bin8 {\\}abc{}}Z'), 'AZ')
add('paragraphs', pair('old','A\\par B\\line C\\tab D'), 'A\nB\nC\tD')
add('whitespace-between-groups', '{\\upr\r\n {old}\r\n {\\*\\ud{'+unicode('新')+'}}\r\n }','新')
for(let n=0;n<60;n++){
  const text=['中文正文','繁體中文','日本語','Γειά','😀🐇','Café'][n%6]+' '+n
  const ansi=['???',"\\'3f",'placeholder',unicode('错误')][n%4]
  const chosen=n%3===0?'\\b '+unicode(text):n%3===1?'\\i '+unicode(text):unicode(text)
  add('unicode-variant-'+n, pair(ansi,chosen),text)
}
const malformed = [
  ['missing-second', '{\\upr{old}}'], ['missing-ud', '{\\upr{old}{Unicode}}'],
  ['missing-star', '{\\upr{old}{\\ud{Unicode}}}'], ['wrong-destination', '{\\upr{old}{\\*\\unknown{Unicode}}}'],
  ['third-group', '{\\upr{old}{\\*\\ud{Unicode}}{EXTRA}}'], ['between-text', '{\\upr{old}X{\\*\\ud{Unicode}}}'],
  ['between-escaped', '{\\upr{old}\\{{\\*\\ud{Unicode}}}'], ['between-symbol', '{\\upr{old}\\~{\\*\\ud{Unicode}}}'],
  ['between-bin', '{\\upr{old}\\bin1 X{\\*\\ud{Unicode}}}'],
  ['upr-parameter', '{\\upr1{old}{\\*\\ud{Unicode}}}'], ['ud-parameter', '{\\upr{old}{\\*\\ud1{Unicode}}}'],
  ['prefix-group', '{\\upr{old}{{\\*\\ud{Unicode}}}}'], ['prefix-hex', "{\\upr{old}{\\'20\\*\\ud{Unicode}}}"],
  ['duplicate-star', '{\\upr{old}{\\*\\*\\ud{Unicode}}}'], ['bad-bin-discarded', pair('\\bin999 x','Unicode')],
  ['truncated', '{\\upr{old}{\\*\\ud{Unicode}'], ['after-control', '{\\upr{old}{\\*\\ud{Unicode}}\\par X}']
].map(([name,body])=>({name,source:wrap(body)}))
module.exports={wrap,unicode,pair,cases,malformed}
