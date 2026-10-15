'use strict'

const MAX_NOTES = 4096
const MAX_REFERENCES = 16384
const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const preStyle = 'margin:0;white-space:pre-wrap;word-break:break-word;font:inherit'

function numberLabel (number, format) {
  if (format === 'ar') return String(number)
  if (format === 'dbar') return String(number).replace(/[0-9]/g, n => String.fromCharCode(0xff10 + Number(n)))
  if ((format === 'alc' || format === 'auc') && number <= 26 * 64) {
    const label = String.fromCharCode(65 + (number - 1) % 26).repeat(Math.floor((number - 1) / 26) + 1)
    return format === 'alc' ? label.toLowerCase() : label
  }
  if ((format === 'rlc' || format === 'ruc') && number < 4000) {
    let label = '', n = number
    for (const [value, chars] of [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]) {
      while (n >= value) { label += chars; n -= value }
    }
    return format === 'rlc' ? label.toLowerCase() : label
  }
  if (format === 'chi' && number <= 60) return ['*', '†', '‡', '§'][(number - 1) % 4].repeat(Math.floor((number - 1) / 4) + 1)
  if (format === 'cnum' && number <= 20) return String.fromCharCode(0x2460 + number - 1)
  return null
}

function createNotes (body) {
  const notes = [], references = [], warnings = new Set()
  const defaults = { footnote: { start: 1, format: 'ar', restart: 'continuous' }, endnote: { start: 1, format: 'rlc', restart: 'continuous' } }
  let settings = { footnote: { ...defaults.footnote }, endnote: { ...defaults.endnote } }
  const next = { footnote: 1, endnote: 1 }

  function reference (stream) {
    if (references.length >= MAX_REFERENCES) throw new Error('RTF 注释引用数量超过安全上限')
    const ref = { note: stream.note || null, label: '' }
    references.push(ref)
    stream.parts.push(ref)
    stream.paragraphHasText = true
    stream.lastHiddenCharacter = ''
    if (stream.note) stream.note.automatic = true
  }

  function begin (hidden = false) {
    if (notes.length >= MAX_NOTES) throw new Error('RTF 注释数量超过安全上限')
    const last = body.parts[body.parts.length - 1]
    const pending = last && typeof last === 'object' && !last.note && !body.lastHiddenCharacter ? last : null
    const note = { id: notes.length + 1, kind: 'footnote', hidden, hiddenCustom: body.lastHiddenCharacter || '', automatic: Boolean(pending), settings: { footnote: { ...settings.footnote }, endnote: { ...settings.endnote } }, parts: [], paragraphHasText: false }
    const ref = pending || { note, label: '' }
    ref.note = note
    note.reference = ref
    note.referenceIndex = pending ? body.parts.length - 1 : body.parts.length
    if (!pending) body.parts.push(ref)
    notes.push(note)
    return { parts: note.parts, paragraphHasText: false, note }
  }

  function finish (note) {
    if (note.hidden) {
      if (note.automatic) next[note.kind]++
      note.label = ''; note.reference.label = ''; return
    }
    if (note.automatic) {
      const config = note.settings[note.kind], number = next[note.kind]++
      note.label = numberLabel(number, config.format)
      if (note.label == null) {
        note.label = `注${note.id}`
        warnings.add('部分原文注释编号样式暂未还原，相关引用以“注”加阅读顺序标识。')
      }
      if (config.restart === 'page') warnings.add('原文按页重排注释编号；当前连续阅读视图按顺序编号，未还原原始分页。')
    } else {
      // Custom references are anchored to the immediately preceding character
      // (RTF 1.9.1 pp.192–193). Link that original character without duplicating it.
      const index = note.referenceIndex, previous = body.parts[index - 1]
      if (note.hiddenCustom) {
        note.label = note.hiddenCustom
        note.reference.hidden = true
      } else if (typeof previous === 'string' && previous.length) {
        const end = previous.charCodeAt(previous.length - 1)
        const count = end >= 0xdc00 && end <= 0xdfff && previous.length > 1 && /[\ud800-\udbff]/.test(previous[previous.length - 2]) ? 2 : 1
        note.label = previous.slice(-count)
        body.parts[index - 1] = previous.slice(0, -count)
        // Unicode controls may emit the surrogate halves in adjacent runs.
        const before = body.parts[index - 2]
        if (previous.length === 1 && end >= 0xdc00 && end <= 0xdfff && typeof before === 'string' && /[\ud800-\udbff]$/.test(before)) {
          note.label = before.slice(-1) + note.label
          body.parts[index - 2] = before.slice(0, -1)
        }
      } else {
        note.label = `注${note.id}`
        warnings.add('部分注释没有可见的原文引用字符，已按阅读顺序补充引用。')
      }
    }
    note.reference.label = note.label
    for (const part of note.parts) if (typeof part === 'object') part.label = note.label
  }

  function control (word, value) {
    if (word === 'sect') {
      for (const kind of ['footnote', 'endnote']) if (settings[kind].restart === 'section') next[kind] = settings[kind].start
      return
    }
    if (word === 'sectd') { settings = { footnote: { ...defaults.footnote }, endnote: { ...defaults.endnote } }; return }
    const match = /^(s?)(a?)ftn(start|restart|rstcont|rstpg|n[a-z]+)$/.exec(word)
    if (!match) return
    const [, section, endnote, property] = match, kind = endnote ? 'endnote' : 'footnote'
    const targets = section ? [settings[kind]] : [defaults[kind], settings[kind]]
    if (property === 'start') {
      if (!Number.isSafeInteger(value) || value < 1 || value > 0x7fffffff) throw new Error('RTF 注释起始编号无效')
      for (const target of targets) target.start = value
      next[kind] = value
    } else if (property[0] === 'n') {
      for (const target of targets) target.format = property.slice(1)
    } else {
      for (const target of targets) target.restart = property === 'restart' ? 'section' : property === 'rstpg' ? 'page' : 'continuous'
    }
  }

  function result () {
    if (references.some(ref => !ref.note)) throw new Error('RTF 注释引用缺少对应的注释内容')
    return { body: body.parts, notes: notes.filter(note => !note.hidden), warnings: [...warnings] }
  }
  return { reference, begin, finish, control, result }
}

function partsText (parts) { return parts.map(part => typeof part === 'string' ? part : part.hidden ? '' : part.label).join('') }
function notePrefix (note) {
  const text = partsText(note.parts).trimStart()
  const first = note.parts.find(part => typeof part === 'object' || part.trim())
  const hasMarker = typeof first === 'object' || !note.automatic && text.startsWith(note.label)
  return hasMarker ? '' : `${note.label} `
}
function documentText (document) {
  const sections = [partsText(document.body).trim()]
  sections.push(...document.warnings)
  for (const kind of ['footnote', 'endnote']) {
    const notes = document.notes.filter(note => note.kind === kind)
    if (notes.length) sections.push((kind === 'footnote' ? '脚注' : '尾注') + '\n' + notes.map(note => notePrefix(note) + partsText(note.parts).trim()).join('\n\n'))
  }
  return sections.filter(Boolean).join('\n\n')
}
function documentHtml (document) {
  if (!documentText(document)) return ''
  const body = document.body.map(part => typeof part === 'string' ? escape(part) : part.note.hidden ? '' : part.hidden ? `<span id="rtf-ref-${part.note.id}"></span>` : `<a id="rtf-ref-${part.note.id}" href="#rtf-note-${part.note.id}"><sup>${escape(part.label)}</sup></a>`).join('').trim()
  let html = `<article style="box-sizing:border-box;padding:20px;line-height:1.75;background:#fff"><pre style="${preStyle}">${body}</pre>`
  for (const warning of document.warnings) html += `<p role="note">${escape(warning)}</p>`
  for (const kind of ['footnote', 'endnote']) {
    const notes = document.notes.filter(note => note.kind === kind)
    if (!notes.length) continue
    html += `<section aria-label="${kind === 'footnote' ? '脚注' : '尾注'}" style="margin-top:24px;border-top:1px solid #ddd;padding-top:12px"><h2 style="font-size:16px;margin:0 0 8px">${kind === 'footnote' ? '脚注' : '尾注'}</h2>`
    for (const note of notes) html += `<div id="rtf-note-${note.id}" style="margin-bottom:12px"><pre style="${preStyle}">${escape(notePrefix(note) + partsText(note.parts).trim())}</pre><a href="#rtf-ref-${note.id}" aria-label="返回正文引用">↩</a></div>`
    html += '</section>'
  }
  return html + '</article>'
}

module.exports = { createNotes, documentText, documentHtml }
