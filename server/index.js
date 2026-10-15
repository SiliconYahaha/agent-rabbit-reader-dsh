'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const http = require('node:http')
const path = require('node:path')

const Busboy = require('busboy')
const unzipper = require('unzipper')

const DEFAULT_PORT = 8787
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024
const MAX_EXPANDED_BYTES = 60 * 1024 * 1024
const MAX_ARCHIVE_FILES = 2000
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000
const DEFAULT_UPLOAD_LIMIT = 30
const DEFAULT_UPLOAD_WINDOW_MS = 60 * 60 * 1000
const STORE_ROOT = path.resolve(process.env.HTML_READER_STORE || path.join(__dirname, '.data'))
const PORT = Number(process.env.PORT || DEFAULT_PORT)
const TTL_MS = Number(process.env.HTML_READER_TTL_MS || DEFAULT_TTL_MS)
const UPLOAD_LIMIT = Number(process.env.HTML_READER_UPLOAD_LIMIT || DEFAULT_UPLOAD_LIMIT)
const UPLOAD_WINDOW_MS = Number(process.env.HTML_READER_UPLOAD_WINDOW_MS || DEFAULT_UPLOAD_WINDOW_MS)
const TRUST_PROXY = process.env.HTML_READER_TRUST_PROXY === '1'
const uploadBuckets = new Map()

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.htm': 'text/html; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
}

function json (response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  })
  response.end(JSON.stringify(payload))
}

function publicBaseUrl (request) {
  const configured = String(process.env.HTML_READER_PUBLIC_URL || '').replace(/\/$/, '')
  if (configured) return configured
  const forwarded = request.headers['x-forwarded-proto']
  return `${forwarded || 'http'}://${request.headers.host}`
}

function clientAddress (request) {
  if (TRUST_PROXY) {
    const forwarded = String(request.headers['x-forwarded-for'] || '').split(',')[0].trim()
    if (forwarded) return forwarded
  }
  return request.socket.remoteAddress || 'unknown'
}

function takeUploadSlot (request, now = Date.now()) {
  const key = clientAddress(request)
  const current = uploadBuckets.get(key)
  if (!current || current.resetAt <= now) {
    uploadBuckets.set(key, { count: 1, resetAt: now + UPLOAD_WINDOW_MS })
    return { allowed: true, retryAfter: 0 }
  }
  if (current.count >= UPLOAD_LIMIT) {
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) }
  }
  current.count += 1
  return { allowed: true, retryAfter: 0 }
}

function sweepUploadBuckets (now = Date.now()) {
  for (const [key, bucket] of uploadBuckets) {
    if (bucket.resetAt <= now) uploadBuckets.delete(key)
  }
}

function safeArchivePath (value) {
  const source = String(value || '').replace(/\\/g, '/')
  if (source.split('/').includes('..')) return ''
  const normalized = path.posix.normalize(source).replace(/^\.\//, '')
  if (!normalized || normalized.startsWith('/') || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) return ''
  return normalized
}

function isHtmlName (name) {
  return /\.html?$/i.test(name)
}

async function writeHtmlDocument (directory, filename, buffer) {
  const safeName = path.basename(filename || 'index.html')
  const entryName = isHtmlName(safeName) ? safeName : 'index.html'
  await fsp.writeFile(path.join(directory, entryName), buffer)
  return entryName
}

async function deleteOwnedTree (target, root = STORE_ROOT) {
  const resolvedTarget = path.resolve(target)
  const resolvedRoot = path.resolve(root)
  if (!resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error('拒绝清理存储目录之外的路径')
  }
  let entries
  try {
    entries = await fsp.readdir(resolvedTarget, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  for (const entry of entries) {
    const child = path.join(resolvedTarget, entry.name)
    if (entry.isDirectory()) await deleteOwnedTree(child, resolvedRoot)
    else await fsp.unlink(child)
  }
  await fsp.rmdir(resolvedTarget)
}

async function writeZipDocument (directory, buffer) {
  const archive = await unzipper.Open.buffer(buffer)
  if (archive.files.length > MAX_ARCHIVE_FILES) throw new Error('网页包文件数量超过限制')

  let expandedBytes = 0
  let entryName = ''
  const htmlNames = []
  for (const file of archive.files) {
    const relative = safeArchivePath(file.path)
    if (!relative) throw new Error('网页包包含不安全路径')
    if (file.type === 'Directory') continue
    expandedBytes += Number(file.uncompressedSize || 0)
    if (expandedBytes > MAX_EXPANDED_BYTES) throw new Error('网页包解压后超过 60 MB')
    if (isHtmlName(relative)) htmlNames.push(relative)
  }
  entryName = htmlNames.find(name => /(^|\/)index\.html?$/i.test(name)) || htmlNames[0] || ''
  if (!entryName) throw new Error('网页包中没有 .html 或 .htm 文件')

  for (const file of archive.files) {
    if (file.type === 'Directory') continue
    const relative = safeArchivePath(file.path)
    const destination = path.join(directory, ...relative.split('/'))
    await fsp.mkdir(path.dirname(destination), { recursive: true })
    await fsp.writeFile(destination, await file.buffer())
  }
  return entryName
}

async function storeUpload (filename, buffer) {
  const id = crypto.randomBytes(24).toString('base64url')
  const directory = path.join(STORE_ROOT, id)
  await fsp.mkdir(directory, { recursive: true })
  try {
    const entryName = /\.zip$/i.test(filename)
      ? await writeZipDocument(directory, buffer)
      : await writeHtmlDocument(directory, filename, buffer)
    await fsp.writeFile(path.join(directory, '.meta.json'), JSON.stringify({
      createdAt: Date.now(),
      expiresAt: Date.now() + TTL_MS,
      entryName,
      originalName: path.basename(filename || 'index.html')
    }))
    return { id, entryName }
  } catch (error) {
    await deleteOwnedTree(directory)
    throw error
  }
}

function receiveUpload (request) {
  return new Promise((resolve, reject) => {
    let settled = false
    let filename = ''
    let total = 0
    const chunks = []
    let parser
    const fail = error => {
      if (settled) return
      settled = true
      reject(error)
    }
    try {
      parser = Busboy({
        headers: request.headers,
        limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 4 }
      })
    } catch (error) {
      fail(new Error('上传格式不正确'))
      return
    }
    parser.on('file', (field, stream, info) => {
      if (field !== 'file') {
        stream.resume()
        return
      }
      filename = info.filename ? Buffer.from(info.filename, 'latin1').toString('utf8') : 'index.html'
      stream.on('data', chunk => {
        total += chunk.length
        chunks.push(chunk)
      })
      stream.on('limit', () => fail(new Error('文件超过 20 MB')))
    })
    parser.on('error', fail)
    parser.on('finish', () => {
      if (settled) return
      if (!filename || !chunks.length) fail(new Error('没有收到文件'))
      else if (!/\.(?:html?|zip)$/i.test(filename)) fail(new Error('仅支持 .html、.htm 或 .zip'))
      else {
        settled = true
        resolve({ filename, buffer: Buffer.concat(chunks, total) })
      }
    })
    request.pipe(parser)
  })
}

async function getMeta (id) {
  try {
    const meta = JSON.parse(await fsp.readFile(path.join(STORE_ROOT, id, '.meta.json'), 'utf8'))
    if (!meta.expiresAt || meta.expiresAt <= Date.now()) return null
    return meta
  } catch (_) {
    return null
  }
}

async function serveDocument (request, response, id, requestedPath) {
  const meta = await getMeta(id)
  if (!meta) {
    json(response, 404, { error: '网页不存在或已经过期' })
    return
  }
  const relative = safeArchivePath(requestedPath || meta.entryName)
  if (!relative) {
    json(response, 400, { error: '路径不正确' })
    return
  }
  const root = path.join(STORE_ROOT, id)
  const filePath = path.resolve(root, ...relative.split('/'))
  if (!filePath.startsWith(`${root}${path.sep}`)) {
    json(response, 403, { error: '禁止访问' })
    return
  }
  let stat
  try {
    stat = await fsp.stat(filePath)
  } catch (_) {
    json(response, 404, { error: '资源不存在' })
    return
  }
  if (!stat.isFile()) {
    json(response, 404, { error: '资源不存在' })
    return
  }
  const extension = path.extname(filePath).toLowerCase()
  const headers = {
    'Content-Type': MIME_TYPES[extension] || 'application/octet-stream',
    'Cache-Control': 'private, max-age=300',
    'Access-Control-Allow-Origin': '*',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff'
  }
  if (extension === '.html' || extension === '.htm') {
    headers['Content-Security-Policy'] = "sandbox allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads;"
  }
  response.writeHead(200, headers)
  fs.createReadStream(filePath).pipe(response)
}

async function sweepExpired () {
  sweepUploadBuckets()
  await fsp.mkdir(STORE_ROOT, { recursive: true })
  const entries = await fsp.readdir(STORE_ROOT, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const meta = await getMeta(entry.name)
    if (!meta) await deleteOwnedTree(path.join(STORE_ROOT, entry.name))
  }
}

function createServer () {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, publicBaseUrl(request))
    try {
      if (request.method === 'GET' && url.pathname === '/health') {
        json(response, 200, { ok: true, ttlHours: TTL_MS / 3600000 })
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/documents') {
        const rate = takeUploadSlot(request)
        if (!rate.allowed) {
          response.setHeader('Retry-After', String(rate.retryAfter))
          json(response, 429, { error: '上传过于频繁，请稍后再试' })
          return
        }
        const upload = await receiveUpload(request)
        const stored = await storeUpload(upload.filename, upload.buffer)
        const viewUrl = `${publicBaseUrl(request)}/view/${stored.id}/${stored.entryName.split('/').map(encodeURIComponent).join('/')}`
        json(response, 201, { expiresAt: Date.now() + TTL_MS, viewUrl })
        return
      }
      const match = url.pathname.match(/^\/view\/([A-Za-z0-9_-]+)(?:\/(.*))?$/)
      if (request.method === 'GET' && match) {
        await serveDocument(request, response, match[1], decodeURIComponent(match[2] || ''))
        return
      }
      json(response, 404, { error: 'Not found' })
    } catch (error) {
      json(response, 400, { error: error.message || '请求失败' })
    }
  })
}

if (require.main === module) {
  sweepExpired().catch(console.error)
  const timer = setInterval(() => sweepExpired().catch(console.error), 60 * 60 * 1000)
  timer.unref()
  createServer().listen(PORT, '0.0.0.0', () => {
    console.log(`HTML Reader fidelity server listening on http://127.0.0.1:${PORT}`)
  })
}

module.exports = {
  MAX_EXPANDED_BYTES,
  MAX_UPLOAD_BYTES,
  STORE_ROOT,
  TTL_MS,
  UPLOAD_LIMIT,
  UPLOAD_WINDOW_MS,
  clientAddress,
  createServer,
  deleteOwnedTree,
  safeArchivePath,
  storeUpload,
  sweepExpired,
  sweepUploadBuckets,
  takeUploadSlot
}
