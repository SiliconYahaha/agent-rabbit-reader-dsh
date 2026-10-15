'use strict'

// 用真实的组件定义和真实的宿主页面定义组装测试实例，按微信的方式把两者接起来：
//   - 宿主 setData({ file, siblings }) 会写入组件属性并触发组件 observers；
//   - 组件 triggerEvent 记录到 reader.events；
//   - 组件 createSelectorQuery 转到测试提供的 wx.createSelectorQuery（没有提供时返回 null）；
//   - 宿主 onUnload 之后组件执行 detached。
// 这里不做任何合并数据的魔法：阅读器状态在 reader.data，队列/分享状态在 host.data。

const path = require('node:path')
// 分包族在 Node 里同步装好，reader 的同步路径（inlineHtml、探针）不需要 await
require('../../miniprogram/file-reader/engine/core/families').warmSync(['document', 'archive', 'image'])

const READER_MODULE = '../../miniprogram/file-reader/engine/components/reader/reader'
const DESIGN_PREVIEW_MODULE = '../../miniprogram/file-reader/engine/components/design-preview/design-preview'
const INDEX_PAGE_MODULE = '../../miniprogram/pages/index/index'
const FILE_PREVIEW_PAGE_MODULE = '../../miniprogram/pages/file-preview/file-preview'

function assignPath (data, key, value) {
  const parts = String(key).replace(/\[(\d+)\]/g, '.$1').split('.')
  let destination = data
  for (const part of parts.slice(0, -1)) {
    if (destination[part] == null || typeof destination[part] !== 'object') destination[part] = /^\d+$/.test(part) ? [] : {}
    destination = destination[part]
  }
  destination[parts[parts.length - 1]] = value
}

function applyUpdates (data, updates) {
  for (const [key, value] of Object.entries(updates || {})) assignPath(data, key, value)
}

function loadDefinition (modulePath, registrar) {
  let definition
  const previous = global[registrar]
  global[registrar] = value => { definition = value }
  const target = require.resolve(modulePath)
  delete require.cache[target]
  const exported = require(target)
  if (previous === undefined) delete global[registrar]
  else global[registrar] = previous
  if (!definition) throw new Error(`${modulePath} 没有调用 ${registrar}()`)
  return { definition, exported }
}

function instantiateComponent (definition, extra = {}) {
  const observers = definition.observers || {}
  const lifetimes = definition.lifetimes || {}
  const instance = {
    ...(definition.methods || {}),
    data: structuredClone(definition.data || {}),
    events: [],
    patches: [],
    setData (updates, callback) {
      this.patches.push(updates)
      applyUpdates(this.data, updates)
      if (typeof callback === 'function') callback()
    },
    setProperty (name, value) {
      this.data[name] = value
      if (typeof observers[name] === 'function') observers[name].call(this, value)
    },
    triggerEvent (name, detail) {
      this.events.push({ name, detail })
    },
    selectComponent () { return null },
    attached () { if (typeof lifetimes.attached === 'function') lifetimes.attached.call(this) },
    detached () { if (typeof lifetimes.detached === 'function') lifetimes.detached.call(this) },
    ...extra
  }
  // 真实组件上 createSelectorQuery 总是存在；测试里只有 wx 桩提供了查询能力时才暴露，
  // 这样旧测试对“没有选择器就跳过测量/上屏”的假设依然成立。
  if (global.wx && typeof global.wx.createSelectorQuery === 'function') {
    instance.createSelectorQuery = () => global.wx.createSelectorQuery()
  }
  for (const [name, spec] of Object.entries(definition.properties || {})) {
    if (!(name in instance.data)) instance.data[name] = spec && spec.value !== undefined ? structuredClone(spec.value) : null
  }
  return instance
}

function instantiatePage (definition, components, extra = {}) {
  const boundProperties = components.bindings || {}
  const page = {
    ...definition,
    data: structuredClone(definition.data || {}),
    patches: [],
    setData (updates, callback) {
      this.patches.push(updates)
      applyUpdates(this.data, updates)
      // 模板把页面数据绑定到组件属性；siblings 先于 file 写入，和 WXML 属性顺序一致。
      for (const name of ['siblings', 'file']) {
        if (updates && Object.prototype.hasOwnProperty.call(updates, name)) {
          for (const target of Object.values(boundProperties)) target.setProperty(name, updates[name])
        }
      }
      if (typeof callback === 'function') callback()
    },
    selectComponent (selector) {
      return components.byId[String(selector).replace(/^#/, '')] || null
    },
    ...extra
  }
  const originalUnload = definition.onUnload
  page.onUnload = function () {
    if (typeof originalUnload === 'function') originalUnload.call(this)
    for (const component of Object.values(components.byId)) component.detached()
  }
  return page
}

function ensureGlobals (wxOverrides, app) {
  global.getApp = () => app
  global.wx = { setNavigationBarTitle () {}, pageScrollTo () {}, ...wxOverrides }
}

// 阅读器组件 + 阅读页宿主。
function loadReaderHost (wxOverrides = {}, app = { globalData: {} }) {
  const calls = { titles: [], scrolls: [] }
  ensureGlobals({
    setNavigationBarTitle: options => calls.titles.push(options.title),
    pageScrollTo: options => calls.scrolls.push(options),
    ...wxOverrides
  }, app)
  const { definition: readerDefinition, exported } = loadDefinition(READER_MODULE, 'Component')
  // 微信里分包靠 require.async；Node 里 engine/core/subpackage-loader 自动退回同步 require，
  // 让 7z/Markdown 分包路径也被真实执行，这里不再需要替换 load。
  const reader = instantiateComponent(readerDefinition)
  const { definition: pageDefinition } = loadDefinition(INDEX_PAGE_MODULE, 'Page')
  const host = instantiatePage(pageDefinition, { byId: { reader }, bindings: { reader } })
  reader.host = host
  return { host, reader, calls, internals: exported._internals }
}

// 兼容旧测试的入口：返回阅读器组件实例，宿主页面挂在 reader.host 上。
function readerPage (overrides = {}) {
  const { reader } = loadReaderHost(overrides)
  return reader
}

// 设计预览组件 + 设计文件页宿主。
function loadDesignPreviewHost (wxOverrides = {}, app = { globalData: {} }) {
  ensureGlobals(wxOverrides, app)
  const { definition: previewDefinition } = loadDefinition(DESIGN_PREVIEW_MODULE, 'Component')
  const preview = instantiateComponent(previewDefinition)
  const { definition: pageDefinition } = loadDefinition(FILE_PREVIEW_PAGE_MODULE, 'Page')
  const host = instantiatePage(pageDefinition, { byId: { preview }, bindings: { preview } })
  preview.host = host
  return { host, preview }
}

// 只实例化设计预览组件，open(material) 等价于宿主传入 file 属性。
function designPreview (wxOverrides = {}) {
  ensureGlobals(wxOverrides, { globalData: {} })
  const { definition } = loadDefinition(DESIGN_PREVIEW_MODULE, 'Component')
  const preview = instantiateComponent(definition)
  preview.open = material => preview.setProperty('file', material)
  return preview
}

const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setTimeout(resolve, 5)) }

module.exports = { applyUpdates, designPreview, flush, loadDesignPreviewHost, loadReaderHost, readerPage }
