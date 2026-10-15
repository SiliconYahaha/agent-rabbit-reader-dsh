'use strict'

const Parser = require('./style-parser')

function Style () {
  this.styles = []
}

Style.prototype.onParse = function (node, vm) {
  if (node.name === 'style' && node.children.length && node.children[0].type === 'text') {
    this.styles = this.styles.concat(new Parser().parse(node.children[0].text))
    return
  }
  if (!node.name) return

  let matched = ['', '', '', '']
  for (let index = 0; index < this.styles.length; index++) {
    const item = this.styles[index]
    let result = match(node, item.key || item.list[item.list.length - 1])
    let selectorIndex
    if (!result) continue
    if (!item.key) {
      selectorIndex = item.list.length - 2
      for (let stackIndex = vm.stack.length; selectorIndex >= 0 && stackIndex--;) {
        if (item.list[selectorIndex] === '>') {
          if (selectorIndex < 1 || selectorIndex > item.list.length - 2) break
          if (match(vm.stack[stackIndex], item.list[selectorIndex - 1])) selectorIndex -= 2
          else selectorIndex++
        } else if (match(vm.stack[stackIndex], item.list[selectorIndex])) selectorIndex--
      }
      result = 4
    }
    if (!item.key && selectorIndex >= 0) continue
    if (item.pseudo && node.children) {
      let text = ''
      const style = item.style.replace(/content:([^;]+)/, (_, value) => {
        text = value.replace(/['"]/g, '')
          .replace(/attr\((.+?)\)/, (all, name) => node.attrs[name.trim()] || '')
          .replace(/\\(\w{4})/, (all, code) => String.fromCharCode(parseInt(code, 16)))
        return ''
      })
      const pseudo = { name: 'span', attrs: { style }, children: [{ type: 'text', text }] }
      if (item.pseudo === 'before') node.children.unshift(pseudo)
      else node.children.push(pseudo)
    } else matched[result - 1] += item.style + (item.style[item.style.length - 1] === ';' ? '' : ';')
  }
  matched = matched.join('')
  if (matched.length > 2) node.attrs.style = matched + (node.attrs.style || '')
}

function match (node, keys) {
  function matchItem (key) {
    if (key[0] === '#') return node.attrs.id && node.attrs.id.trim() === key.substr(1) ? 3 : 0
    if (key[0] === '.') {
      key = key.substr(1)
      const selectors = (node.attrs.class || '').split(' ')
      for (let index = 0; index < selectors.length; index++) {
        if (selectors[index].trim() === key) return 2
      }
    } else {
      if (node.name === key) return 1
      const selectors = (node.attrs.class || '').split(' ')
      if (selectors.includes(`hr-origin-${key}`)) return 1
    }
    return 0
  }
  if (keys instanceof Array) {
    let result = 0
    for (let index = 0; index < keys.length; index++) {
      const current = matchItem(keys[index])
      if (!current) return 0
      if (current > result) result = current
    }
    return result
  }
  return matchItem(keys)
}

module.exports = Style
