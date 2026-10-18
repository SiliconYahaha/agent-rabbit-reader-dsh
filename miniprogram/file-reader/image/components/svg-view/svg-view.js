'use strict'

// <svg-view>：用 Canvas 2D 播放动态 SVG（SMIL + CSS 动画）。微信的 <image> 只会解码首帧，
// 这里自己做时间线与光栅化。属性 source 是 SVG 文本；宽度跟随容器，高度按源文件固有宽高比例。
// 事件：ready { animated, width, height, unsupported[] }、error { message }。

const { createSvgScene } = require('../../index')
const { loadClipUnion } = require('../../svg/svg-clip-runtime')

const MIN_FRAME_INTERVAL = 1000 / 60
const MAX_CANVAS_PIXELS = 16 * 1024 * 1024
const MAX_CANVAS_DIMENSION = 16384

Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    source: { type: String, value: '' },
    controls: { type: Boolean, value: true },
    // 动画播放；设为 false 停在当前帧
    playing: { type: Boolean, value: true }
  },
  data: {
    height: 0,
    ready: false,
    paused: false,
    animated: false,
    hasWallclock: false,
    previewingTime: false,
    clockMinute: 1080,
    clockLabel: ''
  },
  observers: {
    source (value) { if (this._viewReady) this.load(value) },
    playing (value) { if (this._scene) { this._playing = value; this.setData({ paused: !value }); if (value) this.schedule(); else this.cancel() } }
  },
  lifetimes: {
    attached () {
      this._attached = true
      this._pageVisible = true
      this._playing = this.data.playing !== false
      this._images = new Map()
      // Async subpackage placeholders may attach after the page's ready event.
      // nextTick also covers that path; bounded Canvas retries handle layout lag.
      wx.nextTick(() => this.activateView())
    },
    // Properties can arrive before Canvas nodes exist. Query only after the
    // initial view is ready, otherwise the parent permanently falls back to an image.
    ready () { this.activateView() },
    detached () { this._attached = false; this._viewReady = false; this.dispose() }
  },
  pageLifetimes: {
    show () { this._pageVisible = true; if (this._scene && this._playing) this.schedule() },
    hide () { this._pageVisible = false; this.cancel() }
  },
  methods: {
    activateView () {
      if (!this._attached || this._viewReady) return
      this._viewReady = true
      if (this.data.source) this.load(this.data.source)
    },

    load (source) {
      this.dispose(false)
      this._playing = this.data.playing !== false
      this.setData({ ready: false, paused: !this._playing, animated: false })
      if (!source || !this._viewReady) return
      let scene
      const options = {
        resolveImage: href => this.resolveImage(href),
        createPath2D: value => {
          if (!this._canvas || typeof this._canvas.createPath2D !== 'function') throw new Error('Native SVG paths unavailable')
          return this._canvas.createPath2D(value)
        }
      }
      try {
        scene = createSvgScene(source, options)
      } catch (error) {
        this.triggerEvent('error', { message: error.message || String(error) })
        return
      }
      this._scene = scene
      this._startedAt = 0
      this._previewMinute = null
      const revision = this._loadRevision
      if (scene.requiresClipUnion) {
        loadClipUnion().then(union => {
          if (!this._viewReady || revision !== this._loadRevision) return
          options.clipUnion = union
          this.mountCanvas(revision)
        }, error => {
          if (this._viewReady && revision === this._loadRevision) this.triggerEvent('error', { message: error.message || String(error) })
        })
      } else this.mountCanvas(revision)
    },

    mountCanvas (revision, attempt = 0) {
      if (!this._viewReady || revision !== this._loadRevision) return
      const query = typeof this.createSelectorQuery === 'function' ? this.createSelectorQuery() : null
      if (!query) { this.triggerEvent('error', { message: '当前环境没有 Canvas 查询能力' }); return }
      query.select('.svg-view-shell').boundingClientRect()
      query.select('#svg-view-canvas').fields({ node: true, size: true })
      query.exec(results => {
        if (!this._viewReady || revision !== this._loadRevision) return
        const shell = results && results[0]
        const canvasInfo = results && results[1]
        const scene = this._scene
        if (!scene || !canvasInfo || !canvasInfo.node) {
          if (scene && attempt < 2) {
            this._mountRetry = setTimeout(() => {
              this._mountRetry = null
              this.mountCanvas(revision, attempt + 1)
            }, 32)
          } else if (scene) this.triggerEvent('error', { message: '无法创建 Canvas 节点' })
          return
        }
        const width = Math.max(1, (shell && shell.width) || canvasInfo.width || scene.intrinsic.width)
        const height = Math.max(1, width * scene.intrinsic.height / scene.intrinsic.width)
        const canvas = canvasInfo.node
        const dpr = this.devicePixelRatio()
        const pixelWidth = Math.round(width * dpr), pixelHeight = Math.round(height * dpr)
        if (![width, height, dpr, pixelWidth, pixelHeight].every(value => Number.isFinite(value) && value > 0) || pixelWidth > MAX_CANVAS_DIMENSION || pixelHeight > MAX_CANVAS_DIMENSION || pixelWidth > MAX_CANVAS_PIXELS / pixelHeight) {
          this.triggerEvent('error', { message: 'SVG 画布尺寸超出当前播放上限' })
          return
        }
        canvas.width = pixelWidth
        canvas.height = pixelHeight
        const ctx = canvas.getContext('2d')
        if (!ctx) { this.triggerEvent('error', { message: 'Canvas 2D 上下文不可用' }); return }
        ctx.setTransform && ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.scale(dpr, dpr)
        this._canvas = canvas
        this._ctx = ctx
        this._width = width
        this._height = height
        const now = new Date()
        // On phones, updating the displayed Canvas dimensions can clear its
        // backing surface. Draw only after that layout update has completed.
        this.setData({ height, ready: true, animated: scene.animated, hasWallclock: scene.timeline.hasWallclock, previewingTime: false, clockMinute: now.getHours() * 60 + now.getMinutes() }, () => {
          if (!this._viewReady || revision !== this._loadRevision) return
          if (!this.drawFrame(0)) return
          this.triggerEvent('ready', { animated: scene.animated, width, height, unsupported: Array.from(scene.renderer.unsupported) })
          if (scene.animated && this._playing) this.schedule()
        })
      })
    },

    devicePixelRatio () {
      try {
        if (typeof wx !== 'undefined' && typeof wx.getWindowInfo === 'function') return wx.getWindowInfo().pixelRatio || 1
        if (typeof wx !== 'undefined' && typeof wx.getSystemInfoSync === 'function') return wx.getSystemInfoSync().pixelRatio || 1
      } catch (_) {}
      return 1
    },

    drawFrame (time) {
      const scene = this._scene
      const ctx = this._ctx
      if (!scene || !ctx) return false
      try {
        let clockNow = Date.now()
        if (this._previewMinute != null) {
          const preview = new Date(clockNow)
          preview.setHours(Math.floor(this._previewMinute / 60), this._previewMinute % 60, 0, 0)
          clockNow = preview.getTime()
        }
        scene.draw(ctx, this._width, this._height, time, clockNow)
        return true
      } catch (error) {
        this.cancel()
        this.triggerEvent('error', { message: `SVG 绘制失败：${error.message || error}` })
        return false
      }
    },

    schedule () {
      const canvas = this._canvas
      if (this._pageVisible === false || !canvas || !this._scene || this._frameHandle != null) return
      const raf = typeof canvas.requestAnimationFrame === 'function' ? callback => canvas.requestAnimationFrame(callback) : callback => setTimeout(() => callback(Date.now()), MIN_FRAME_INTERVAL)
      const generation = this._frameGeneration
      const loop = timestamp => {
        if (generation !== this._frameGeneration) return
        this._frameHandle = null
        if (!this._scene || !this._playing) return
        const now = typeof timestamp === 'number' ? timestamp : Date.now()
        if (!this._startedAt) this._startedAt = now - (this._pausedAt || 0)
        const elapsed = (now - this._startedAt) / 1000
        this._pausedAt = now - this._startedAt
        if (!this.drawFrame(elapsed) || generation !== this._frameGeneration) return
        this._frameHandle = raf(loop)
      }
      this._frameHandle = raf(loop)
    },

    cancel () {
      this._frameGeneration = (this._frameGeneration || 0) + 1
      const canvas = this._canvas
      if (this._frameHandle != null) {
        if (canvas && typeof canvas.cancelAnimationFrame === 'function') canvas.cancelAnimationFrame(this._frameHandle)
        else clearTimeout(this._frameHandle)
        this._frameHandle = null
      }
      // 下次继续播放时从暂停处接着走
      this._startedAt = 0
    },

    onTap () {
      if (!this._scene || !this._scene.animated) return
      this._playing = !this._playing
      this.setData({ paused: !this._playing })
      if (this._playing) this.schedule(); else this.cancel()
    },

    onTimePreview (event) {
      if (!this._scene || !this._scene.timeline.hasWallclock) return
      const value = Number(event && event.detail && event.detail.value)
      if (!Number.isFinite(value)) return
      this._previewMinute = Math.max(0, Math.min(1439, Math.floor(value)))
      const hour = Math.floor(this._previewMinute / 60), minute = this._previewMinute % 60
      this.setData({ previewingTime: true, clockMinute: this._previewMinute, clockLabel: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` })
      this.drawFrame((this._pausedAt || 0) / 1000)
    },

    onTimeNow () {
      this._previewMinute = null
      const now = new Date()
      this.setData({ previewingTime: false, clockMinute: now.getHours() * 60 + now.getMinutes() })
      this.drawFrame((this._pausedAt || 0) / 1000)
    },

    resolveImage (href) {
      if (!this._canvas || typeof this._canvas.createImage !== 'function') return null
      if (this._images.has(href)) return this._images.get(href).ready ? this._images.get(href).image : null
      const image = this._canvas.createImage()
      const entry = { image, ready: false }
      this._images.set(href, entry)
      image.onload = () => { entry.ready = true; if (!this._scene || !this._scene.animated) this.drawFrame(0) }
      image.onerror = () => { this._images.set(href, { image: null, ready: false }) }
      image.src = href
      return null
    },

    dispose (resetData = true) {
      this._loadRevision = (this._loadRevision || 0) + 1
      if (this._mountRetry != null) { clearTimeout(this._mountRetry); this._mountRetry = null }
      this.cancel()
      this._scene = null
      this._ctx = null
      this._canvas = null
      this._pausedAt = 0
      this._previewMinute = null
      if (this._images) this._images.clear()
      if (resetData && this.data.ready) this.setData({ ready: false, height: 0, paused: false })
    }
  }
})
