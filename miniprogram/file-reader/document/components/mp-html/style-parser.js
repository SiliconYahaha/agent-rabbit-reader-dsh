'use strict'

const blank = { ' ': true, '\n': true, '\t': true, '\r': true, '\f': true }

function Parser () {
  this.styles = []
  this.selectors = []
}

Parser.prototype.parse = function (content) {
  new Lexer(this).parse(content)
  return this.styles
}

Parser.prototype.onSelector = function (name) {
  if (name.includes('[') || name.includes('*') || name.includes('@')) return
  const selector = {}
  if (name.includes(':')) {
    const info = name.split(':')
    const pseudo = info.pop()
    if (pseudo === 'before' || pseudo === 'after') {
      selector.pseudo = pseudo
      name = info[0]
    } else return
  }

  function splitItem (value) {
    const items = []
    let index
    let start
    for (index = 1, start = 0; index < value.length; index++) {
      if (value[index] === '.' || value[index] === '#') {
        items.push(value.substring(start, index))
        start = index
      }
    }
    if (!items.length) return value
    items.push(value.substring(start, index))
    return items
  }

  if (name.includes(' ')) {
    selector.list = []
    const list = name.split(' ')
    for (let index = 0; index < list.length; index++) {
      if (!list[index].length) continue
      const parts = list[index].split('>')
      for (let partIndex = 0; partIndex < parts.length; partIndex++) {
        selector.list.push(splitItem(parts[partIndex]))
        if (partIndex < parts.length - 1) selector.list.push('>')
      }
    }
  } else selector.key = splitItem(name)
  this.selectors.push(selector)
}

Parser.prototype.onContent = function (content) {
  for (let index = 0; index < this.selectors.length; index++) this.selectors[index].style = content
  this.styles = this.styles.concat(this.selectors)
  this.selectors = []
}

function Lexer (handler) {
  this.selector = ''
  this.style = ''
  this.handler = handler
}

Lexer.prototype.parse = function (content) {
  this.i = 0
  this.content = content
  this.state = this.blank
  for (const length = content.length; this.i < length; this.i++) this.state(content[this.i])
}

Lexer.prototype.comment = function () {
  this.i = this.content.indexOf('*/', this.i) + 1
  if (!this.i) this.i = this.content.length
}

Lexer.prototype.blank = function (char) {
  if (!blank[char]) {
    if (char === '/' && this.content[this.i + 1] === '*') return this.comment()
    this.selector += char
    this.state = this.name
  }
}

Lexer.prototype.name = function (char) {
  if (char === '/' && this.content[this.i + 1] === '*') return this.comment()
  if (char === '{' || char === ',' || char === ';') {
    this.handler.onSelector(this.selector.trimEnd())
    this.selector = ''
    if (char !== '{') {
      while (blank[this.content[++this.i]]);
    }
    if (this.content[this.i] === '{') {
      this.floor = 1
      this.state = this.val
    } else this.selector += this.content[this.i]
  } else if (blank[char]) this.selector += ' '
  else this.selector += char
}

Lexer.prototype.val = function (char) {
  if (char === '/' && this.content[this.i + 1] === '*') return this.comment()
  if (char === '{') this.floor++
  else if (char === '}') {
    this.floor--
    if (!this.floor) {
      this.handler.onContent(this.style)
      this.style = ''
      this.state = this.blank
      return
    }
  }
  this.style += char
}

module.exports = Parser
