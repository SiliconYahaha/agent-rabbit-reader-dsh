'use strict'

// Repository test runner only: start our own headless Chrome with a fresh
// profile; never attach to the user's browser or a WeChat debugging session.
// Await an explicit fixture result with wall time, not virtual-time-budget:
// native image decoding / WebCrypto can outlive Chrome's virtual timer budget.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { spawn } = require('node:child_process')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

async function chromeTestResult (url, { timeoutMs = 45000 } = {}) {
  const address = new URL(url)
  if (address.protocol !== 'http:' || address.hostname !== '127.0.0.1') throw Error('Only isolated loopback test fixtures are allowed')
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-chrome-test-'))
  const child = spawn(process.env.HTML_READER_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = '', childError, socket, nextId = 0
  const pending = new Map(), deadline = Date.now() + timeoutMs
  child.stderr.on('data', data => { stderr = (stderr + data).slice(-16000) })
  child.on('error', error => { childError = error })
  const alive = () => { if (childError) throw childError; if (child.exitCode != null) throw Error('Test Chrome exited: ' + stderr) }
  try {
    let endpoint
    while (!(endpoint = stderr.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/))) {
      alive(); if (Date.now() >= deadline) throw Error('Test Chrome startup timed out'); await pause(50)
    }
    socket = new WebSocket(endpoint[1])
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Test Chrome connection timed out')), Math.max(1, deadline - Date.now()))
      socket.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
      socket.addEventListener('error', () => { clearTimeout(timer); reject(Error('Test Chrome connection failed')) }, { once: true })
    })
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data), request = pending.get(message.id)
      if (!request) return
      pending.delete(message.id); clearTimeout(request.timer)
      if (message.error) request.reject(Error(message.error.message)); else request.resolve(message.result)
    })
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const id = ++nextId
      const timer = setTimeout(() => { pending.delete(id); reject(Error('Test Chrome command timed out: ' + method)) }, Math.max(1, deadline - Date.now()))
      pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, sessionId }))
    })
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
    await send('Page.enable', {}, sessionId)
    await send('Page.navigate', { url }, sessionId)
    let lastHtml = '', evaluationTimeout
    while (Date.now() < deadline) {
      alive()
      try {
        const response = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => { const o=document.querySelector('output');return {done:!!o&&(o.hasAttribute('data-result')||o.hasAttribute('data-error')),html:document.documentElement.outerHTML} })()` }, sessionId)
        const state = response.result && response.result.value
        if (state) { lastHtml = state.html; if (state.done) return lastHtml }
      } catch (error) {
        // A poll that reaches the overall deadline is still a result timeout.
        // Preserve the last observed fixture DOM, as on the between-poll path.
        if (error.message === 'Test Chrome command timed out: Runtime.evaluate' && Date.now() >= deadline) { evaluationTimeout = error; break }
        // The initial navigation can replace about:blank's execution context.
        if (!/context.*destroyed|Cannot find context/i.test(error.message)) throw error
      }
      await pause(100)
    }
    const error = Error('Test Chrome result timed out: ' + ((lastHtml.match(/data-progress="([^"]+)"/) || [])[1] || 'no progress'))
    if (evaluationTimeout) error.cause = evaluationTimeout
    error.dom = lastHtml; throw error
  } finally {
    for (const request of pending.values()) clearTimeout(request.timer)
    pending.clear()
    if (socket) socket.close()
    // Only the child created above. Keep its isolated scratch profile for
    // diagnosis; never kill unrelated Chrome processes or delete shared data.
    if (child.exitCode == null) child.kill('SIGTERM')
  }
}
module.exports = { chromeTestResult }
