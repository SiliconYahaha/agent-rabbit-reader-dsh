'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const iconv = require('iconv-lite')

const { decodeBig5, decodeCp949, decodeShiftJis, decodeText } = require('../miniprogram/file-reader/engine/core/text-decoder')
const { rtfToText } = require('../miniprogram/file-reader/engine/core/file-inspector')

test('HTML 按 meta charset 解码 GBK 正文', () => {
  const bytes = iconv.encode('<!doctype html><meta charset="gbk"><h1>你好，兔子</h1>', 'gbk')
  const decoded = decodeText(bytes, { kind: 'html' })
  assert.equal(decoded.encoding, 'gb18030')
  assert.match(decoded.text, /你好，兔子/)
  assert.equal(decoded.errors, 0)
})

test('文本按 BOM 和空字节特征识别 UTF-16', () => {
  const withBom = Buffer.concat([Buffer.from([0xff, 0xfe]), iconv.encode('第一行\n第二行', 'utf16-le')])
  assert.equal(decodeText(withBom, { kind: 'text' }).text, '第一行\n第二行')

  const withoutBom = iconv.encode('没有 BOM 的 UTF-16LE', 'utf16-le')
  const decoded = decodeText(withoutBom, { kind: 'text' })
  assert.equal(decoded.encoding, 'utf-16le')
  assert.equal(decoded.text, '没有 BOM 的 UTF-16LE')
})

test('无声明但不是合法 UTF-8 的中文文本回退 GB18030', () => {
  const decoded = decodeText(iconv.encode('旧编码中文文档', 'gb18030'), { kind: 'text' })
  assert.equal(decoded.encoding, 'gb18030')
  assert.equal(decoded.text, '旧编码中文文档')
})

test('RTF 按 ansicpg936 合并十六进制字节后提取中文', () => {
  const escaped = value => Array.from(iconv.encode(value, 'gbk')).map(byte => `\\'${byte.toString(16).padStart(2, '0')}`).join('')
  const source = Buffer.from(`{\\rtf1\\ansi\\ansicpg936 ${escaped('会议纪要')}\\par ${escaped('第二段')}}`, 'latin1')
  const text = rtfToText(source)
  assert.equal(text, '会议纪要\n第二段')
})

test('显式 Windows-1252 编码不会被误判为 GB18030', () => {
  const decoded = decodeText(Buffer.from([0x43, 0x61, 0x66, 0xe9]), { encoding: 'windows-1252' })
  assert.equal(decoded.text, 'Café')
  assert.equal(decoded.source, 'explicit')
})

test('Shift_JIS 与 Big5 本地映射和标准编码器结果一致', () => {
  const japanese = '日本語/設計資料.txt'
  const traditional = '繁體中文/設計圖.ai'
  assert.deepEqual(decodeShiftJis(iconv.encode(japanese, 'shift_jis')), { text: japanese, errors: 0 })
  assert.deepEqual(decodeBig5(iconv.encode(traditional, 'big5')), { text: traditional, errors: 0 })
  assert.equal(decodeText(iconv.encode(japanese, 'shift_jis'), { encoding: 'windows-31j' }).text, japanese)
  assert.equal(decodeText(iconv.encode(traditional, 'big5'), { encoding: 'cp950' }).text, traditional)
})

test('Shift_JIS 与 Big5 截断双字节返回替代符和错误计数', () => {
  assert.deepEqual(decodeShiftJis(Uint8Array.of(0x80)), { text: '\u0080', errors: 0 })
  assert.deepEqual(decodeShiftJis(Uint8Array.of(0x93)), { text: '�', errors: 1 })
  assert.deepEqual(decodeBig5(Uint8Array.of(0xc1)), { text: '�', errors: 1 })
})

test('CP949 同时覆盖 EUC-KR 常用韩文与 Windows UHC 扩展字符', () => {
  for (const value of ['한글/폴더/읽기.txt', '갂힣/확장.txt']) {
    const bytes = iconv.encode(value, 'cp949')
    assert.deepEqual(decodeCp949(bytes), { text: value, errors: 0 })
    assert.equal(decodeText(bytes, { encoding: 'euc-kr' }).text, value)
    assert.equal(decodeText(bytes, { encoding: 'windows-949' }).encoding, 'cp949')
  }
})

test('CP949 全部双字节槽位与标准表一致，截断或非法尾字节明确计错', () => {
  const trails = []
  for (let value = 0x41; value <= 0x5a; value++) trails.push(value)
  for (let value = 0x61; value <= 0x7a; value++) trails.push(value)
  for (let value = 0x81; value <= 0xfe; value++) trails.push(value)
  for (let lead = 0x81; lead <= 0xfe; lead++) {
    for (const trail of trails) {
      const bytes = Uint8Array.of(lead, trail)
      const expected = iconv.decode(Buffer.from(bytes), 'cp949')
      const actual = decodeCp949(bytes)
      assert.equal(actual.text, expected, `${lead.toString(16)}${trail.toString(16)}`)
      assert.equal(actual.errors, Array.from(expected).filter(value => value === '�').length, `${lead.toString(16)}${trail.toString(16)} errors`)
    }
  }
  assert.deepEqual(decodeCp949(Uint8Array.of(0x81)), { text: '�', errors: 1 })
  assert.deepEqual(decodeCp949(Uint8Array.of(0x81, 0x40)), { text: '�@', errors: 1 })
})
