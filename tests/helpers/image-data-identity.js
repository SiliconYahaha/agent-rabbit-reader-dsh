'use strict'
const { png } = require('./inline-poster')
const image = png()
const variants = ['plain', 'escaped-slashes', 'line-continuation', 'folded-data', 'template', 'object-key']
function htmlFor (variant) {
  const folded = image.slice(0,22) + image.slice(22).replace(/(.{80})/g, '$1\n')
  const value = variant === 'folded-data' ? folded : image
  let literal = JSON.stringify(value)
  if (variant === 'escaped-slashes') literal = literal.replace(/\//g, '\\/')
  if (variant === 'line-continuation') literal = literal.replace(/(.{90})/g, '$1\\\n')
  if (variant === 'template') literal = '`' + value + '`'
  const expression = variant === 'object-key' ? `Object.keys({[${literal}]:1})[0]` : literal
  return `<!doctype html><meta charset="utf-8"><style>body{margin:0}pre{white-space:pre-wrap;overflow-wrap:anywhere}img{width:100px}</style><p id="result"></p><pre id="literal">${image}</pre><img id="picture" src="${image}"><input id="field" value="${image}"><button id="check">校验</button><script>const original=${expression};const picture=document.getElementById('picture');function check(){const bytes=atob(original.split(',')[1]);document.getElementById('result').textContent=JSON.stringify({prefix:original.startsWith('data:image/'),length:original.length,bytes:bytes.length,png:bytes.slice(1,4),src:picture.getAttribute('src')===original,text:document.getElementById('literal').textContent===${JSON.stringify(image)},field:document.getElementById('field').value===${JSON.stringify(image)}})}picture.src=original;document.getElementById('check').onclick=check;check()</script>`
}
module.exports = { image, variants, htmlFor }
