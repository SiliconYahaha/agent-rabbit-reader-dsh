'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { readerPage } = require('./helpers/reader-host')
const events = ['Canplay', 'TimeUpdate', 'Waiting', 'Seeking', 'Seeked', 'Play', 'Pause', 'Stop', 'Ended', 'Error']
const videoEvents = ['Play', 'Pause', 'LoadedMetadata', 'Waiting', 'Ended', 'Error']
const eventFor = page => ({ currentTarget: { dataset: { mediaSession: page.data.mediaSessions[0].id } }, detail: { duration: 125, errCode: 10004 } })

function setup ({ failFirstSrc = false, destroyEmits = false } = {}) {
  const contexts = [], reads = []
  const page = readerPage({
    getDeviceInfo: () => ({ platform: 'ios' }),
    getFileSystemManager: () => ({ readFile: options => reads.push(options) }),
    createInnerAudioContext: () => {
      const audio = { callbacks: {}, duration: 123, currentTime: 42, stop () {}, destroy () { if (destroyEmits) this.callbacks.Error({ errCode: 10003 }) }, plays: 0, seeks: [],
        play () { this.plays++ }, seek (value) { this.seeks.push(value) } }
      for (const event of events) audio['on' + event] = callback => { audio.callbacks[event] = callback }
      contexts.push(audio)
      Object.defineProperty(audio, 'src', { set (value) {
        this._src = value
        if (failFirstSrc && contexts.length === 1) this.callbacks.Error({ errCode: 10003 })
      }, get () { return this._src } })
      return audio
    }
  })
  return { page, contexts, reads }
}

for (const trigger of ['canplay', 'src-error']) {
  test('reentrant ' + trigger + ' file replacement leaves no orphaned audio timers after disposal', () => {
    const savedSet = global.setTimeout, savedClear = global.clearTimeout, pending = new Map()
    let id = 0
    global.setTimeout = (fn, delay) => { const handle = ++id; pending.set(handle, { fn, delay }); return handle }
    global.clearTimeout = handle => { pending.delete(handle) }
    const { page, contexts } = setup({ failFirstSrc: trigger === 'src-error' })
    try {
      let switched = false
      const finish = page.finishLoading
      page.finishLoading = function () {
        finish.call(this)
        if (!switched) {
          switched = true
          this.openSelectedFile({ name: 'new.mp3', path: '/local/new.mp3' })
          contexts[1].callbacks.Canplay()
        }
      }
      page.openSelectedFile({ name: 'old.mp3', path: '/local/old.mp3' })
      if (trigger === 'canplay') contexts[0].callbacks.Canplay()
      assert.equal(contexts.length, 2)
      assert.equal(page.data.mediaPath, '/local/new.mp3')
      assert.equal(page.data.error, '')
      for (const [handle, timer] of [...pending]) {
        if (timer.delay <= 120) { pending.delete(handle); timer.fn() }
      }
      assert.equal(page.data.mediaDuration, 123, 'new context must retain its deferred metadata update')
      page.detached()
      assert.equal(pending.size, 0, 'no pending timer may survive disposal of both native contexts')
    } finally {
      page.detached()
      global.setTimeout = savedSet; global.clearTimeout = savedClear
    }
  })
}

for (const target of ['html', 'audio', 'video', 'detach']) {
  test('old audio callbacks cannot mutate the reader after ' + target, () => {
    for (const event of events) {
      const { page, contexts } = setup()
      try {
        page.openSelectedFile({ name: 'old.mp3', path: '/local/shared.mp3', size: 20 })
        if (target === 'html') page.openSelectedFile({ name: 'current.html', inlineHtml: '<p>Current document</p>' })
        // Same path and name must not be used as identity for reopening a file.
        else if (target === 'audio') {
          page.openSelectedFile({ name: 'old.mp3', path: '/local/shared.mp3', size: 20 })
          contexts[1].callbacks.Play()
          contexts[1].callbacks.TimeUpdate()
        } else if (target === 'video') page.openSelectedFile({ name: 'clip.mp4', path: '/local/clip.mp4' })
        else page.detached()
        const before = structuredClone(page.data), patchCount = page.patches.length
        contexts[0].callbacks[event]({ errCode: 10003, errMsg: 'old source error' })
        assert.deepEqual(page.data, before, target + '/' + event)
        assert.equal(page.patches.length, patchCount, target + '/' + event + ': no stale setData')
      } finally { page.detached() }
    }
  })
}

for (const target of ['html', 'audio', 'video', 'detach']) {
  test('late media header success and failure cannot overwrite after ' + target, () => {
    for (const result of ['success', 'fail']) {
      const { page, reads } = setup()
      try {
        page.openSelectedFile({ name: 'old.mp3', path: '/local/old.mp3', size: 20 })
        if (target === 'html') page.openSelectedFile({ name: 'current.html', inlineHtml: '<p>Current document</p>' })
        else if (target === 'detach') page.detached()
        else page.openSelectedFile({ name: target === 'audio' ? 'old.mp3' : 'clip.mp4', path: '/local/old.mp3', size: 20 })
        const before = structuredClone(page.data), patchCount = page.patches.length
        reads[0][result]({ data: Buffer.from('invalid media header'), errMsg: 'old read failure' })
        assert.deepEqual(page.data, before, result)
        assert.equal(page.patches.length, patchCount, result + ': no stale setData')
      } finally { page.detached() }
    }
  })
}

test('an immediate current audio src failure is reported, then a valid document can be opened', () => {
  const { page } = setup({ failFirstSrc: true })
  try {
    page.openSelectedFile({ name: 'broken.mp3', path: '/local/broken.mp3' })
    assert.match(page.data.error, /音频播放失败/)
    assert.equal(page.data.mediaCanPlay, false)
    assert.equal(page.data.isLoading, false)
    page.openSelectedFile({ name: 'current.html', inlineHtml: '<p>Current document</p>' })
    assert.equal(page.data.error, '')
    assert.equal(page.data.mediaMode, '')
    assert.equal(page.data.hasContent, true)
  } finally { page.detached() }
})

for (const target of ['html', 'video', 'audio', 'detach']) {
  test('old video instance cannot deliver events after ' + target, () => {
    for (const name of videoEvents) {
      const { page } = setup()
      try {
        page.openSelectedFile({ name: 'clip.mp4', path: '/local/shared.mp4', size: 20 })
        const oldEvent = eventFor(page)
        if (target === 'html') page.openSelectedFile({ name: 'current.html', inlineHtml: '<p>Current document</p>' })
        else if (target === 'video') {
          page.openSelectedFile({ name: 'clip.mp4', path: '/local/shared.mp4', size: 20 })
          assert.notEqual(eventFor(page).currentTarget.dataset.mediaSession, oldEvent.currentTarget.dataset.mediaSession)
          page.onVideoPlay(eventFor(page))
          page.onVideoLoadedMetadata(eventFor(page))
        } else if (target === 'audio') page.openSelectedFile({ name: 'current.mp3', path: '/local/current.mp3', size: 20 })
        else page.detached()
        const before = structuredClone(page.data), patchCount = page.patches.length
        page['onVideo' + name](oldEvent)
        assert.deepEqual(page.data, before, target + '/' + name)
        assert.equal(page.patches.length, patchCount, target + '/' + name)
      } finally { page.detached() }
    }
  })
}

test('current video events preserve metadata, playback and real error feedback', () => {
  const { page } = setup()
  try {
    page.openSelectedFile({ name: 'clip.mp4', path: '/local/clip.mp4', size: 20 })
    const event = eventFor(page)
    page.onVideoLoadedMetadata(event)
    assert.equal(page.data.mediaDurationLabel, '2:05')
    page.onVideoPlay(event)
    assert.equal(page.data.mediaPlaying, true)
    page.onVideoWaiting(event)
    assert.match(page.data.mediaDiagnostic, /缓冲/)
    page.onVideoPause(event)
    assert.equal(page.data.mediaPlaying, false)
    page.onVideoEnded(event)
    assert.match(page.data.mediaDiagnostic, /播放结束/)
    page.onVideoError(event)
    assert.match(page.data.error, /视频播放失败/)
    assert.equal(page.data.mediaCanPlay, false)
  } finally { page.detached() }
})

test('delayed audio controls from old skin cannot play or seek a newly opened audio file', () => {
  const { page, contexts } = setup()
  try {
    page.openSelectedFile({ name: 'old.mp3', path: '/local/shared.mp3', size: 20 })
    const oldEvent = eventFor(page)
    oldEvent.detail = { value: 77 }
    page.openSelectedFile({ name: 'old.mp3', path: '/local/shared.mp3', size: 20 })
    page.toggleAudio(oldEvent); page.seekAudio(oldEvent)
    assert.equal(contexts[1].plays, 0); assert.deepEqual(contexts[1].seeks, [])
    const current = eventFor(page); current.detail = { value: 42 }
    page.toggleAudio(current); page.seekAudio(current)
    assert.equal(contexts[1].plays, 1); assert.deepEqual(contexts[1].seeks, [42])
  } finally { page.detached() }
})

test('current audio callbacks still update playback progress and report actual errors', () => {
  const { page, contexts } = setup()
  try {
    page.openSelectedFile({ name: 'current.mp3', path: '/local/current.mp3', size: 20 })
    const current = contexts[0]
    current.callbacks.Canplay()
    current.callbacks.Play()
    current.callbacks.TimeUpdate()
    assert.equal(page.data.mediaPlaying, true)
    assert.equal(page.data.mediaCurrent, 42)
    assert.equal(page.data.mediaDuration, 123)
    current.callbacks.Waiting()
    assert.match(page.data.mediaDiagnostic, /缓冲/)
    current.callbacks.Error({ errCode: 10003 })
    assert.match(page.data.error, /音频播放失败/)
    assert.equal(page.data.mediaCanPlay, false)
  } finally { page.detached() }
})

test('a native error emitted synchronously during destroy cannot affect replacement or detach', () => {
  const { page } = setup({ destroyEmits: true })
  try {
    page.openSelectedFile({ name: 'old.mp3', path: '/local/old.mp3' })
    page.openSelectedFile({ name: 'current.mp3', path: '/local/current.mp3' })
    assert.equal(page.data.error, '')
    const before = structuredClone(page.data), patches = page.patches.length
    page.detached()
    assert.deepEqual(page.data, before)
    assert.equal(page.patches.length, patches)
  } finally { page.detached() }
})
