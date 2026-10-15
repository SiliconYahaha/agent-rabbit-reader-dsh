'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const Sval = require('../miniprogram/file-reader/document/html-runtime/vendor/sval')
const { parseImageScript } = require('../miniprogram/file-reader/document/image-script-budget')
const budget = 2 * 1024 * 1024
const payload = 'AAAA'.repeat(budget / 4 + 1)
const parse = source => parseImageScript(new Sval(), source, budget)

test('large embedded audio remains original data in the interpreter', () => {
  for (const mime of ['audio/mpeg', 'audio/x-wav', 'audio/wav', 'audio/ogg', 'audio/aac', 'audio/mp4', 'audio/webm']) {
    const value = `data:${mime};base64,${payload}`
    const source = `result.asset=${JSON.stringify(value)};result.kind=result.asset.slice(0,result.asset.indexOf(','))`
    const interpreter = new Sval(), win = {}
    const ast = parseImageScript(interpreter, source, budget)
    assert.equal(ast.body[0].expression.right.value, value)
    interpreter.import({ result: win }); interpreter.run(ast)
    assert.equal(win.asset, value)
    assert.equal(win.kind, `data:${mime};base64`)
  }
})

test('mixed image/audio maps and template literals preserve asset bytes', () => {
  const audio = `data:audio/mpeg;base64,${payload.slice(0, budget / 2)}`
  const image = `data:image/webp;base64,${payload.slice(0, budget / 2)}`
  const ast = parse('const assets={audio:`' + audio + '`,image:' + JSON.stringify(image) + '}')
  const props = ast.body[0].declarations[0].init.properties
  assert.equal(props[0].value.quasis[0].value.cooked, audio)
  assert.equal(props[1].value.value, image)
})

test('comments, regular expressions and unsupported MIME types do not bypass the code budget', () => {
  for (const source of [
    '//data:audio/mpeg;base64,' + payload,
    'const r=/data:audio\\/mpeg;base64,' + payload + '/',
    'const x="data:application/javascript;base64,' + payload + '"',
    'const x="data:audio/not-a-format;base64,' + payload + '"',
    'const x="prefix-data:audio/mpeg;base64,' + payload + '"'
  ]) assert.throws(() => parse(source), /safety limit/)
})

test('invalid base64 and executable template expressions are not exempt', () => {
  for (const data of [payload + '=', payload + '!', payload + 'A']) {
    assert.throws(() => parse('const x="data:audio/mpeg;base64,' + data + '"'), /safety limit/)
  }
  assert.throws(() => parse('const x=`data:audio/mpeg;base64,' + payload + '${"' + payload + '"}`'), /safety limit/)
})

test('audio exemption retains raw source and syntax complexity limits', () => {
  assert.throws(() => parse('const x="data:audio/mpeg;base64,' + 'AAAA'.repeat(5 * 1024 * 1024) + '"'), /raw source/)
  assert.throws(() => parse('const x="data:audio/mpeg;base64,' + payload + '";' + ';'.repeat(100001)), /syntax nodes/)
})
