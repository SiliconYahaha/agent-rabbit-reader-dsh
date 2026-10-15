'use strict'

// Commands stay on the logic side. Load their image dependencies first, then
// replay synchronously in author order. No asynchronous callback may paint.
const LIMITS = { canvases: 32, operations: 20000, pixels: 16 * 1024 * 1024, totalPixels: 32 * 1024 * 1024, images: 128, timeoutMs: 15000 }
const CANCELLED = new Error('Canvas replay cancelled')
const METHODS = new Set('arc arcTo beginPath bezierCurveTo clearRect clip closePath ellipse fill fillRect fillText lineTo moveTo quadraticCurveTo rect resetTransform restore rotate save scale setLineDash setTransform stroke strokeRect strokeText transform translate'.split(' '))
const PROPERTIES = new Set('direction fillStyle filter font fontKerning fontStretch fontVariantCaps globalAlpha globalCompositeOperation imageSmoothingEnabled imageSmoothingQuality letterSpacing lineCap lineDashOffset lineJoin lineWidth miterLimit shadowBlur shadowColor shadowOffsetX shadowOffsetY strokeStyle textAlign textBaseline textRendering wordSpacing'.split(' '))

function dimensions (width, height, limit) {
  if (![width, height].every(n => Number.isInteger(n) && n >= 0 && n <= 16384) || width * height > limit) throw new Error('Canvas 尺寸超过安全上限或无效')
  return width * height
}

function createCanvasPresenter (options) {
  const limits = { ...LIMITS, ...options.limits }
  const jobs = new Map(), completed = new Map(), caches = new Map()
  let nativeImages = new WeakMap()
  let disposed = false, imageCount = 0, imagePixels = 0
  const current = job => !disposed && !job.invalidated && jobs.get(job.nid) === job
  function awaitJob (value, job) {
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (error, result) => {
        if (settled) return
        settled = true; clearTimeout(timer); job.waiters.delete(cancel)
        error ? reject(error) : resolve(result)
      }
      const cancel = () => finish(CANCELLED)
      const timer = setTimeout(() => finish(new Error('Canvas 画面准备超时')), limits.timeoutMs)
      job.waiters.add(cancel)
      Promise.resolve(value).then(result => current(job) ? finish(null, result) : cancel(), error => finish(error))
      if (!current(job)) cancel()
    })
  }
  function cancelJob (job) { if (job) job.waiters.forEach(cancel => cancel()) }
  function dropSurface (canvas) {
    const cache = caches.get(canvas)
    if (!cache) return
    caches.delete(canvas)
    cache.forEach(entry => { imageCount--; imagePixels -= entry.pixels || 0; entry.release() })
  }
  function imageFor (canvas, source) {
    if (!/^data:image\/(?:png|jpe?g|gif|webp|avif|svg\+xml)[;,]/i.test(source || '')) return Promise.reject(new Error('Canvas 图片只允许文件内嵌资源'))
    if (/^data:image\/svg\+xml[;,]/i.test(source) && !options.resolveImageSource) return Promise.reject(new Error('Canvas SVG 图片必须先净化'))
    let cache = caches.get(canvas)
    if (!cache) caches.set(canvas, cache = new Map())
    if (cache.has(source)) return cache.get(source).ready
    if (imageCount >= limits.images) return Promise.reject(new Error('Canvas 图片数量超过安全上限'))
    imageCount++
    const entry = { pixels: 0, release () {} }
    cache.set(source, entry)
    entry.ready = new Promise((resolve, reject) => {
      let image, settled = false
      const finish = (error) => {
        if (settled) return
        settled = true; clearTimeout(timer)
        if (image) image.onload = image.onerror = null
        if (error) { if (image) { try { image.src = '' } catch (_) {} } reject(error) } else resolve(image)
      }
      const timer = setTimeout(() => finish(new Error('Canvas 图片解码超时')), limits.timeoutMs)
      entry.release = () => { finish(CANCELLED); if (image) { image.onload = image.onerror = null; try { image.src = '' } catch (_) {} } }
      Promise.resolve().then(() => options.resolveImageSource ? options.resolveImageSource(source) : source).then(resolved => {
        if (settled || disposed) return finish(CANCELLED)
        if (typeof canvas.createImage !== 'function') throw new Error('当前环境不支持 Canvas 图片解码')
        image = canvas.createImage()
        image.onload = () => {
          if (settled || disposed) return
          try {
            const pixels = dimensions(Number(image.naturalWidth || image.width), Number(image.naturalHeight || image.height), limits.pixels)
            if (!pixels || imagePixels + pixels > limits.totalPixels) throw new Error('Canvas 图片像素超过安全上限或为空')
            imagePixels += pixels; entry.pixels = pixels; finish()
          } catch (error) { finish(error) }
        }
        image.onerror = () => finish(new Error('Canvas 图片无法解码'))
        image.src = resolved
      }).catch(finish)
    })
    // Failed resources remain failed for this document, rather than retrying on
    // every animation frame and repeatedly consuming memory/network resources.
    return entry.ready
  }
  function paint (canvas, state, images) {
    const context = canvas.getContext('2d')
    if (!context) throw new Error('当前环境不支持 Canvas 2D')
    function resize (width, height) {
      dimensions(width, height, limits.pixels)
      // Wide -> tall (or the reverse) must not briefly allocate newWidth *
      // oldHeight before setting the other dimension. Every assignment resets
      // state, which is intentional for full replay and author reset commands.
      canvas.width = 0; canvas.height = height; canvas.width = width
    }
    // A full replay must reset the clip, saved stack, current path AND paint
    // state. clearRect + identity transform does not reset any of these.
    resize(state.width, state.height)
    if (state.webgl && state.webgl.data) {
      const { width, height, data } = state.webgl
      dimensions(width, height, limits.pixels)
      if (data.length !== width * height * 4) throw new Error('WebGL 像素数据长度不完整')
      const output = context.createImageData(width, height)
      for (let row = 0; row < height; row++) output.data.set(data.slice((height-row-1)*width*4,(height-row)*width*4),row*width*4)
      context.putImageData(output, 0, 0)
      return
    }
    const gradients = new Map()
    for (const operation of state.ops) {
      const { name, args } = operation
      if (name === 'resetCanvas') {
        resize(args[0], args[1])
      } else if (name === 'createGradient') {
        const [id, kind, ...values] = args
        if (kind !== 'radial' && kind !== 'linear') throw new Error('不支持的 Canvas 渐变')
        gradients.set(id, context[kind === 'radial' ? 'createRadialGradient' : 'createLinearGradient'](...values))
      } else if (name === 'gradientColorStop') {
        const gradient = gradients.get(args[0])
        if (!gradient) throw new Error('Canvas 渐变不存在')
        gradient.addColorStop(args[1], args[2])
      } else if (name.startsWith('set:')) {
        const property = name.slice(4), value = args[0]
        if (!PROPERTIES.has(property)) throw new Error('不支持的 Canvas 属性：' + property)
        if (value && value.__canvasGradient && !gradients.has(value.__canvasGradient)) throw new Error('Canvas 渐变不存在')
        context[property] = value && value.__canvasGradient ? gradients.get(value.__canvasGradient) : value
      } else if (name === 'drawImage') {
        context.drawImage(images.get(args[0].__canvasImage), ...args.slice(1))
      } else if (name === 'putImageData') {
        const [descriptor, ...values] = args
        const pixels = dimensions(descriptor.width, descriptor.height, limits.pixels)
        if (!descriptor.data || !descriptor.data.data || descriptor.data.data.length !== pixels * 4) throw new Error('Canvas 像素数据长度不完整')
        const image = context.createImageData(descriptor.width, descriptor.height)
        image.data.set(descriptor.data.data); context.putImageData(image, ...values)
      } else if (METHODS.has(name) && typeof context[name] === 'function') context[name](...args)
      else throw new Error('不支持的 Canvas 指令：' + name)
    }
  }
  async function run (job, state) {
    try {
      dimensions(state.width, state.height, limits.pixels)
      if (!Array.isArray(state.ops) || state.ops.length > limits.operations) throw new Error('Canvas 指令数量超过安全上限或无效')
      const canvas = await awaitJob(options.resolveCanvas(job.nid), job)
      if (!canvas) return { status: 'missing', nid: job.nid }
      job.canvas = canvas
      if (job.previousCanvas && job.previousCanvas !== canvas) dropSurface(job.previousCanvas)
      const previous = completed.get(job.nid)
      if (previous && previous.canvas === canvas && previous.rev === state.rev && previous.width === state.width && previous.height === state.height) return { status: 'unchanged', nid: job.nid }
      if (previous && previous.canvas !== canvas) dropSurface(previous.canvas)
      if (state.native) {
        const nativeFrame = options.resolveNativeFrame && options.resolveNativeFrame(job.nid)
        const source = nativeFrame?.canvas || (options.resolveNativeCanvas && options.resolveNativeCanvas(job.nid))
        if (!source) {
          // A script may replace its canvas while the WXML query is pending.
          // That old frame is obsolete; missing backing on a live node is an error.
          if (options.isCanvasAlive && !options.isCanvasAlive(job.nid)) return { status: 'cancelled', nid: job.nid }
          throw new Error('Canvas 原生画面不可用')
        }
        if (!current(job)) return { status: 'cancelled', nid: job.nid }
        if (canvas.width !== source.width || canvas.height !== source.height) { canvas.width = 0; canvas.height = source.height; canvas.width = source.width }
        const ctx = canvas.getContext('2d')
        if (source.width && source.height && nativeFrame?.readPixels) {
          let image = nativeImages.get(canvas)
          if (!image || image.width !== source.width || image.height !== source.height) { image = ctx.createImageData(source.width, source.height); nativeImages.set(canvas, image) }
          nativeFrame.readPixels(image.data)
          // WebGL uses a bottom-left origin; 2D ImageData starts at the top.
          const stride = source.width * 4, row = new Uint8ClampedArray(stride)
          for (let y = 0; y < Math.floor(source.height / 2); y++) {
            const top = y * stride, bottom = (source.height - y - 1) * stride
            row.set(image.data.subarray(top, top + stride)); image.data.copyWithin(top, bottom, bottom + stride); image.data.set(row, bottom)
          }
          ctx.putImageData(image, 0, 0)
        } else if (source.width && source.height) {
          ctx.save()
          try { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'copy'; ctx.drawImage(source, 0, 0) } finally { ctx.restore() }
        }
        completed.set(job.nid, { canvas, rev: state.rev, width: state.width, height: state.height })
        return { status: 'painted', nid: job.nid, rev: state.rev }
      }
      const images = new Map()
      if (!state.webgl) for (const operation of state.ops) {
        if (!operation || typeof operation.name !== 'string' || !Array.isArray(operation.args)) throw new Error('Canvas 指令格式无效')
        if (operation.name !== 'drawImage') continue
        const source = operation.args[0] && operation.args[0].__canvasImage
        if (!images.has(source)) images.set(source, await awaitJob(imageFor(canvas, source), job))
      }
      if (!current(job)) return { status: 'cancelled', nid: job.nid }
      paint(canvas, state, images)
      completed.set(job.nid, { canvas, rev: state.rev, width: state.width, height: state.height })
      return { status: 'painted', nid: job.nid, rev: state.rev }
    } catch (error) {
      if (error === CANCELLED || !current(job)) return { status: 'cancelled', nid: job.nid }
      if (options.onError) options.onError(error, job.nid)
      return { status: 'error', nid: job.nid, message: error.message }
    }
  }
  function present (items) {
    if (disposed) return Promise.resolve([])
    try {
      if (!Array.isArray(items) || items.length > limits.canvases) throw new Error('Canvas 数量超过安全上限')
      if (items.reduce((n, item) => n + dimensions(item.canvas.width, item.canvas.height, limits.pixels), 0) > limits.totalPixels) throw new Error('Canvas 总像素超过安全上限')
    } catch (error) {
      jobs.forEach(cancelJob); jobs.clear(); completed.clear()
      for (const canvas of caches.keys()) dropSurface(canvas)
      if (options.onError) options.onError(error)
      return Promise.resolve([{ status: 'error', message: error.message }])
    }
    const live = new Set(items.map(item => String(item.nid)))
    for (const [nid, job] of jobs) if (!live.has(nid)) { jobs.delete(nid); cancelJob(job); if (job.canvas) dropSurface(job.canvas); completed.delete(nid) }
    return Promise.all(items.map(item => {
      const nid = String(item.nid), old = jobs.get(nid), job = { nid, waiters: new Set(), previousCanvas: old && (old.canvas || old.previousCanvas) }
      jobs.set(nid, job); cancelJob(old)
      return run(job, item.canvas)
    }))
  }
  function dispose () {
    disposed = true; nativeImages = new WeakMap(); jobs.forEach(cancelJob); jobs.clear(); completed.clear()
    for (const canvas of caches.keys()) dropSurface(canvas)
  }
  function invalidateTargets () { jobs.forEach(job => { job.invalidated = true; cancelJob(job) }); completed.clear() }
  return { present, dispose, invalidateTargets }
}

module.exports = { createCanvasPresenter, LIMITS }
