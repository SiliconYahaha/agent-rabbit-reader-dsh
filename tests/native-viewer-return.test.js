'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const flow = require('../miniprogram/utils/native-viewer-return')
function host (count = 2) {
  const calls = [], app = { globalData: { fileQueue: Array.from({ length: count }, (_, i) => ({ name: `${i}.pdf` })), fileQueueIndex: 0 } }
  global.getApp = () => app;global.getCurrentPages = () => [{}, {}]
  global.wx = { navigateBack: o => calls.push(['back', o.delta]), reLaunch: () => calls.push(['home']) }
  const page = { ...flow, data: {}, setData (o) { Object.assign(this.data, o) }, filterQueue (q) { calls.push(['queue', q]) } }
  const phase = (phase, id = 1) => page.onNativeViewer({ detail: { phase, id } })
  return { page, calls, phase }
}
test('single native file returns directly to its entry, once', () => {
  const { page, calls, phase } = host(1)
  phase('opening');phase('opened');assert.deepEqual(calls, [])
  page.hideNativeViewer();page.resumeNativeViewer();page.resumeNativeViewer()
  assert.deepEqual(calls, [['back', 1]])
})
test('multiple native files return to the selected list without metadata or reopening', () => {
  const { page, calls, phase } = host()
  phase('opening');page.hideNativeViewer();phase('opened');page.resumeNativeViewer()
  assert.equal(page.data.nativeReturned, false);assert.equal(page.data.queueOpen, true)
  assert.deepEqual(calls, [['queue', '']])
  page.resumeNativeViewer();assert.equal(calls.length, 1)
})
test('success callback after returning is handled; error and stale callbacks never navigate', () => {
  const { page, calls, phase } = host(1)
  phase('opening');page.hideNativeViewer();page.resumeNativeViewer();assert.deepEqual(calls, [])
  phase('opened');assert.deepEqual(calls, [['back', 1]])
  calls.length = 0;phase('opening', 2);page.hideNativeViewer();phase('failed', 2);page.resumeNativeViewer();phase('opened', 1)
  assert.deepEqual(calls, [])
})
test('ordinary app foregrounding does not count as a native return', () => {
  const { page, calls, phase } = host()
  page.hideNativeViewer();page.resumeNativeViewer();assert.deepEqual(calls, [])
  phase('opening');phase('opened');page.resumeNativeViewer();assert.deepEqual(calls, [])
})

test('both reader pages collapse the returned directory without navigating or reopening the current file', async () => {
  for (const name of ['index', 'file-preview']) {
    const app = { globalData: { fileQueue: [{ name:'a.pdf' }, { name:'b.html' }], fileQueueIndex:0 } }
    global.getApp = () => app
    global.wx = { navigateBack () { throw new Error('unexpected back') }, reLaunch () { throw new Error('unexpected home') } }
    let page
    global.Page = definition => { page = { ...definition, data:{...definition.data, nativeReturned:true,queueOpen:true,file:app.globalData.fileQueue[0]},setData (patch) { Object.assign(this.data,patch) } } }
    const module = `../miniprogram/pages/${name}/${name}`
    delete require.cache[require.resolve(module)];require(module)
    const file=page.data.file
    page.toggleQueue()
    assert.equal(page.data.queueClosing,true)
    await new Promise(resolve=>setTimeout(resolve,200))
    assert.equal(page.data.queueOpen,false);assert.equal(page.data.file,file)
    page.toggleQueue();assert.equal(page.data.queueOpen,true)
    page.openQueueIndex = () => { throw new Error('reopened current file') }
    page.chooseQueueFile({currentTarget:{dataset:{index:0}}})
    await new Promise(resolve=>setTimeout(resolve,200))
    assert.equal(page.data.queueOpen,false);assert.equal(page.data.file,file)
  }
})
