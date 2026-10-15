'use strict'

// Execute the real engine template and skin event forwarding in WeChat's
// official component framework. EmptyBackendContext does not decode media.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ge = require('glass-easel')
const { TmplGroup } = require('glass-easel-template-compiler')
const { readerPage } = require('../tests/helpers/reader-host')

function verify () {
  const root = path.join(__dirname, '..')
  const source = fs.readFileSync(path.join(root, 'miniprogram/file-reader/engine/components/reader/reader.wxml'), 'utf8').match(/<skin-media[\s\S]*?\/>/)[0]
  const group = TmplGroup.newDev()
  let groups
  try {
    group.addTmpl('', source)
    // Evaluate trusted build-time WXML compiler output, never file contents.
    groups = new Function('return ' + group.getTmplGenObjectGroups())()
  } finally { group.free() }
  let skinSpec
  const previousComponent = global.Component
  const skinModule = require.resolve('../miniprogram/file-reader/skin/media/media')
  try {
    global.Component = spec => { skinSpec = spec }
    delete require.cache[skinModule]
    require(skinModule)
  } finally {
    if (previousComponent === undefined) delete global.Component
    else global.Component = previousComponent
  }
  const life = [], seen = [], contexts = []
  const skin = ge.registerElement({
    properties: skinSpec.properties,
    lifetimes: { attached () { life.push('attached') }, detached () { life.push('detached') } }
  }).general()
  const page = readerPage({
    getDeviceInfo: () => ({ platform: 'ios' }),
    createInnerAudioContext: () => {
      const audio = { plays: 0, seeks: [], play () { this.plays++ }, seek (value) { this.seeks.push(value) }, destroy () {} }
      contexts.push(audio)
      return audio
    }
  })
  const methods = {}
  for (const name of ['onVideoPlay', 'onVideoPause', 'onVideoLoadedMetadata', 'onVideoWaiting', 'onVideoEnded', 'onVideoError', 'toggleAudio', 'seekAudio']) {
    methods[name] = function (event) {
      seen.push({ name, session: event.currentTarget.dataset.mediaSession })
      page[name](event)
    }
  }
  const def = ge.registerElement({ using: { 'skin-media': skin }, template: { groupList: groups, content: groups[''] }, data: structuredClone(page.data), methods }).general()
  const elem = ge.Component.createWithContext('root', def, new ge.EmptyBackendContext())
  ge.Element.pretendAttached(elem)
  const originalSet = page.setData
  page.setData = function (update, callback) {
    originalSet.call(this, update)
    elem.setData(structuredClone(update))
    if (callback) callback()
  }
  function find (node) {
    if (node.tagName === 'skin-media') return node
    for (const child of node.childNodes || []) {
      const found = find(child)
      if (found) return found
    }
    return null
  }
  const current = () => find(elem.getShadowRoot())
  const fire = (instance, name, detail = {}) => skinSpec.methods[name].call(instance, { detail })
  try {
    page.openSelectedFile({ name: 'same.mp4', path: '/local/same.mp4' })
    const first = current()
    assert.ok(first)
    const oldSession = first.dataset.mediaSession
    fire(first, 'onVideoLoadedMetadata', { duration: 125 })
    assert.equal(page.data.mediaDurationLabel, '2:05')
    page.openSelectedFile({ name: 'same.mp4', path: '/local/same.mp4' })
    const second = current()
    assert.ok(second)
    assert.notEqual(first, second, 'same path must have a fresh instance')
    assert.notEqual(second.dataset.mediaSession, oldSession)
    assert.equal(first.dataset.mediaSession, oldSession, 'old identity is immutable')
    const before = structuredClone(page.data), patches = page.patches.length
    fire(first, 'onVideoError', { errCode: 10004 })
    assert.deepEqual(page.data, before)
    assert.equal(page.patches.length, patches)
    fire(second, 'onVideoPlay')
    assert.equal(page.data.mediaPlaying, true)
    fire(second, 'onVideoError', { errCode: 10004 })
    assert.match(page.data.error, /视频播放失败/)
    page.openSelectedFile({ name: 'same.mp3', path: '/local/same.mp3' })
    const oldAudio = current()
    page.openSelectedFile({ name: 'same.mp3', path: '/local/same.mp3' })
    const newAudio = current()
    fire(oldAudio, 'onToggle'); fire(oldAudio, 'onSeek', { value: 77 })
    assert.equal(contexts[1].plays, 0)
    assert.deepEqual(contexts[1].seeks, [])
    fire(newAudio, 'onToggle'); fire(newAudio, 'onSeek', { value: 42 })
    assert.equal(contexts[1].plays, 1)
    assert.deepEqual(contexts[1].seeks, [42])
    page.openSelectedFile({ name: 'current.html', inlineHtml: '<p>Current document</p>' })
    assert.equal(page._htmlRuntime.document.body.textContent.trim(), 'Current document')
    assert.equal(current(), null, 'HTML removes the media component')
    const html = structuredClone(page.data), htmlPatches = page.patches.length
    fire(second, 'onVideoError', { errCode: 10004 })
    fire(newAudio, 'onToggle'); fire(newAudio, 'onSeek', { value: 99 })
    assert.deepEqual(page.data, html)
    assert.equal(page._htmlRuntime.document.body.textContent.trim(), 'Current document')
    assert.equal(page.patches.length, htmlPatches)
    assert.equal(contexts[1].plays, 1)
    assert.deepEqual(contexts[1].seeks, [42])
    return {
      runtime: 'glass-easel@' + require('glass-easel/package.json').version,
      compiler: 'glass-easel-template-compiler@' + require('glass-easel-template-compiler/package.json').version,
      source: 'actual engine skin-media WXML, actual skin properties and forwarding methods',
      backend: 'official EmptyBackendContext; no native media decoder or WeChat simulator',
      sequence: ['video', 'same-path video', 'audio', 'same-path audio', 'HTML'],
      freshVideoInstance: first !== second, freshAudioInstance: oldAudio !== newAudio,
      oldSession, newSession: second.dataset.mediaSession,
      oldIdentityPreserved: first.dataset.mediaSession === oldSession,
      currentErrorReported: true, currentControlsWork: true, htmlUnaffected: true,
      life, seen
    }
  } finally { page.detached(); ge.Element.pretendDetached(elem) }
}

if (require.main === module) {
  const report = verify()
  const destination = path.resolve(process.argv[2] || 'outputs/media-lifecycle/framework-identity.json')
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.writeFileSync(destination, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
}
module.exports = { verify }
