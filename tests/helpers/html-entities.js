'use strict'

const sources = ['&copy;', '&euro;', '&NotEqualTilde;', '&#x110000;', '&#0;', '&#128;', '&#xD800;', '&#x1f430;', '&notit;', '&notin;', '&copy=1', '&copyA', '&copy0', '&amp;copy;', '&amP;', '&#65A', '&#x41G', '&#;', '&#x;', '&unknown;', 'A&Tab;B', 'A&NewLine;B', '&nbsp;A&nbsp;', '&lt;b&gt;x&lt;/b&gt;', 'A<b>B</b>', '&#x10ffff;', '&#9999999999999999999999999999999999;']
const contexts = ['text', 'attribute', 'input', 'textarea', 'title', 'innerHTML', 'textarea-innerHTML', 'script-innerHTML']

function contextCase (source, context) {
  const quoted = source.replace(/"/g, '&quot;')
  const base = { label: `${context}: ${source}`, field: 'text', selector: '#probe' }
  if (context === 'attribute') return { ...base, html: `<p id="probe" title="${quoted}">正文</p>`, field: 'attribute', attribute: 'title' }
  if (context === 'input') return { ...base, html: `<input id="probe" value="${quoted}">`, field: 'value' }
  if (context === 'textarea') return { ...base, html: `<textarea id="probe">${source}</textarea>`, field: 'value' }
  if (context === 'title') return { ...base, html: `<head><title>${source}</title></head><body>正文</body>`, field: 'title' }
  if (context.endsWith('innerHTML')) {
    const tag = context.split('-')[0] === 'textarea' ? 'textarea' : context.split('-')[0] === 'script' ? 'script' : 'div'
    return { ...base, html: '<body></body>', create: tag, innerHTML: source }
  }
  return { ...base, html: `<p id="probe">${source}</p>` }
}

const visualHtml = `<!doctype html><html><head><meta charset="utf-8"><title>字符引用 &amp; 正文</title><style>
body{margin:0;padding:16px;background:#fff;color:#171715;font:18px/1.6 sans-serif}h1{font-size:24px}section{padding:10px 0;border-bottom:1px solid #ddd}.result{font-size:22px;color:#324a13}input,textarea{box-sizing:border-box;width:100%;font:18px/1.5 sans-serif}button{padding:10px 16px;background:#dbf66d;border:1px solid #171715;margin-top:12px}
</style></head><body><h1>字符与表单回归</h1>
<section>货币、版权、组合符号<p id="symbols" class="result">&copy; &euro; &NotEqualTilde; &#x1F430;</p></section>
<section>无效引用仍保留后续正文<p id="invalid" class="result">前&#x110000;中&#0;后&#xD800;结束</p></section>
<section>只解码一次<p id="once" class="result">&amp;copy; &amP; &notit;</p></section>
<section>输入初值<input id="value" value="&copy; &#128; &#x110000;"><textarea id="area">&euro; &amp;copy;</textarea></section>
<button id="entity-update">更新正文和表单</button><p id="updated" class="result">待更新</p>
<script>document.getElementById('entity-update').addEventListener('click',function(){document.getElementById('updated').innerHTML='&copy; &euro; &#x110000; &amp;copy;';document.getElementById('area').innerHTML='&euro; <b>原样标签</b> &#x110000;'})</script>
</body></html>`

module.exports = { sources, contexts, contextCase, visualHtml }
