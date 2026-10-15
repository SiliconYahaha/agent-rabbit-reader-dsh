'use strict'

// 万能文件阅读模块的公共入口。宿主小程序只需要：
//   1. 把 file-reader/ 整个目录放进 miniprogramRoot；
//   2. 在 app.json 登记分包 file-reader/engine（内核）、document、archive、image、sevenzip、markdown
//      （见 describe().subPackages）；主包只落下本文件与 shared/ 里几十 KB 的纯函数；
//   3. 页面 usingComponents 引用 /file-reader/engine/components/reader/reader 并配 componentPlaceholder
//      （跨分包组件，基础库 2.17.3+），传入 file 属性。
// 本文件只导出宿主在路由和入口判断时会用到的纯函数，不依赖页面或 getApp，也不 require 引擎分包。
const { getModuleRoot, modulePath, setModuleRoot } = require('./shared/module-root')
const fileTypes = require('./shared/file-types')
const { FORMAT_CAPABILITIES, capabilityAudit } = require('./shared/format-capabilities')
const { collectArchiveVolumeSet, isArchiveVolumeName } = require('./shared/archive-volumes')
const { extensionOf, formatBytes } = require('./shared/file-names')

const VERSION = '1.0.0'

// 模块目录不叫 file-reader 时，宿主在 app.js 里先调用 configure({ root })，
// 两个 WASM 内核（包内绝对路径）才能被找到。
function configure (options = {}) {
  if (options.root) setModuleRoot(options.root)
  return describe()
}

function describe () {
  return {
    version: VERSION,
    root: getModuleRoot(),
    readerComponent: modulePath('engine/components/reader/reader'),
    designPreviewComponent: modulePath('engine/components/design-preview/design-preview'),
    // 主包页面引用分包组件时 usingComponents 需要配 componentPlaceholder。
    componentPlaceholder: 'view',
    engineSubPackage: { root: modulePath('engine'), name: 'file-reader-engine', pages: ['pages/runtime/runtime'] },
    documentSubPackage: { root: modulePath('document'), name: 'file-reader-document', pages: ['pages/runtime/runtime'] },
    archiveSubPackage: { root: modulePath('archive'), name: 'file-reader-archive', pages: ['pages/runtime/runtime'] },
    imageSubPackage: { root: modulePath('image'), name: 'file-reader-image', pages: ['pages/runtime/runtime'] },
    sevenZipSubPackage: { root: modulePath('sevenzip'), name: 'file-reader-sevenzip', pages: ['pages/runtime/runtime'] },
    markdownSubPackage: { root: modulePath('markdown'), name: 'file-reader-markdown', pages: ['pages/runtime/runtime'] },
    // 宿主 app.json 的 subPackages 需要登记这三项；三个 root 互为兄弟，不能嵌套。
    subPackages: [
      { root: modulePath('engine'), name: 'file-reader-engine', pages: ['pages/runtime/runtime'] },
      { root: modulePath('document'), name: 'file-reader-document', pages: ['pages/runtime/runtime'] },
      { root: modulePath('archive'), name: 'file-reader-archive', pages: ['pages/runtime/runtime'] },
      { root: modulePath('image'), name: 'file-reader-image', pages: ['pages/runtime/runtime'] },
      { root: modulePath('sevenzip'), name: 'file-reader-sevenzip', pages: ['pages/runtime/runtime'] },
      { root: modulePath('markdown'), name: 'file-reader-markdown', pages: ['pages/runtime/runtime'] }
    ]
  }
}

module.exports = {
  VERSION,
  FORMAT_CAPABILITIES,
  SUPPORTED_EXTENSIONS: fileTypes.SUPPORTED_EXTENSIONS,
  SUPPORTED_MIME_TYPES: fileTypes.SUPPORTED_MIME_TYPES,
  capabilityAudit,
  collectArchiveVolumeSet,
  configure,
  describe,
  extensionOf,
  fileKind: fileTypes.fileKind,
  formatBytes,
  htmlContentType: fileTypes.htmlContentType,
  isArchiveVolumeName,
  isSupportedMaterial: fileTypes.isSupportedMaterial,
  modulePath,
  setModuleRoot
}
