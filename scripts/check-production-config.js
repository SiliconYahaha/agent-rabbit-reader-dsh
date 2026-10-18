'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const expectedAppId = 'wx3a426835ea59403a'
const requiredMaterialTypes = [
  'video/*',
  'audio/*',
  'image/*',
  'text/html',
  'text/plain',
  'text/markdown',
  'application/postscript',
  'application/x-photoshop',
  'application/*'
]
const readableExtensions = new Set(['.js', '.json', '.wxml', '.wxss'])
const forbiddenRuntimePatterns = [
  { pattern: /\brequire\s*\(\s*['"][^'"]+\.json['"]\s*\)/, label: 'JSON require (WeChat requires JS modules)' },
  { pattern: /\bwx\.uploadFile\b/, label: 'wx.uploadFile' },
  { pattern: /<web-view\b/i, label: 'web-view' },
  { pattern: /\bPRODUCTION_URL\b/, label: 'PRODUCTION_URL' }
]
const maxPackageBytes = 2 * 1024 * 1024

function readJson (filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function listReadableFiles (root) {
  const files = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name)
    if (entry.isDirectory()) files.push(...listReadableFiles(absolute))
    else if (readableExtensions.has(path.extname(entry.name))) files.push(absolute)
  }
  return files
}

function listAllFiles (root) {
  const files = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name)
    if (entry.isDirectory()) files.push(...listAllFiles(absolute))
    else files.push(absolute)
  }
  return files
}

function totalBytes (files) {
  return files.reduce((sum, file) => sum + fs.statSync(file).size, 0)
}

function validatePages (root, pages, label) {
  for (const page of pages || []) {
    for (const extension of ['.js', '.json', '.wxml', '.wxss']) {
      assert.ok(fs.existsSync(path.join(root, `${page}${extension}`)), `${label}页面文件不存在：${page}${extension}`)
    }
  }
}

// 微信里分包之间只能 require.async：任何分包里的字面量 require 只能落在本分包或主包。
// 各族通过 kernel.js（attach 注入）拿引擎内核，Node 分支的路径用变量所以不会被这里抓到。
function assertNoCrossSubPackageRequire (miniprogramRoot, subPackageRoots) {
  const roots = Array.from(subPackageRoots)
  const rootOf = relative => roots.find(root => relative === root || relative.startsWith(`${root}/`)) || ''
  let inspected = 0
  for (const file of listAllFiles(miniprogramRoot)) {
    if (!file.endsWith('.js')) continue
    const relative = path.relative(miniprogramRoot, file).split(path.sep).join('/')
    const owner = rootOf(relative)
    if (!owner || relative.includes('/vendor/')) continue
    const source = fs.readFileSync(file, 'utf8')
    for (const match of source.matchAll(/(?<![\w.])require\(\s*'([^']+)'\s*\)/g)) {
      const spec = match[1]
      if (!spec.startsWith('.') && !spec.startsWith('/')) continue
      const target = spec.startsWith('/') ? spec.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(relative), spec))
      const targetOwner = rootOf(target)
      assert.ok(!targetOwner || targetOwner === owner, `分包 ${owner} 不能同步 require 其他分包的文件：${relative} -> ${spec}`)
      inspected++
    }
  }
  assert.ok(inspected > 50, `分包 require 检查数量异常：${inspected}`)
}

function validateSubPackages (miniprogramRoot, appConfig) {
  const subPackages = appConfig.subPackages || appConfig.subpackages || []
  const roots = new Set()
  const sizes = Object.create(null)
  for (const subPackage of subPackages) {
    assert.equal(typeof subPackage.root, 'string', '分包缺少 root')
    assert.ok(subPackage.root && !path.isAbsolute(subPackage.root) && !subPackage.root.includes('..'), `分包 root 非法：${subPackage.root}`)
    assert.ok(!roots.has(subPackage.root), `分包 root 重复：${subPackage.root}`)
    roots.add(subPackage.root)
    const root = path.join(miniprogramRoot, subPackage.root)
    assert.ok(fs.existsSync(root), `分包目录不存在：${subPackage.root}`)
    validatePages(root, subPackage.pages, `${subPackage.root} `)
    const bytes = totalBytes(listAllFiles(root))
    assert.ok(bytes < maxPackageBytes, `分包 ${subPackage.root} 超过 2 MiB：${bytes} 字节`)
    sizes[subPackage.root] = bytes
  }
  return { roots, sizes }
}

function validateSupportedMaterials (appConfig) {
  assert.ok(Array.isArray(appConfig.supportedMaterials), 'app.json 缺少 supportedMaterials')
  const types = appConfig.supportedMaterials.map(item => item.materialType)
  for (const type of requiredMaterialTypes) {
    assert.ok(types.includes(type), `supportedMaterials 缺少 ${type}`)
  }
  for (const item of appConfig.supportedMaterials) {
    assert.equal(typeof item.name, 'string', `${item.materialType} 缺少 name`)
    assert.ok(item.name.includes('${nickname}'), `${item.materialType} 的 name 必须包含 \${nickname}`)
    assert.ok(Array.from(item.name.replace('${nickname}', '')).length <= 6, `${item.materialType} 的 name 超过 6 个字`)
    assert.ok(Array.from(item.desc || '').length <= 22, `${item.materialType} 的 desc 超过 22 个字`)
    assert.equal(item.path, 'pages/index/index', `${item.materialType} 未直接进入阅读页`)
  }
  return types
}

// file-reader 是可复制到其他小程序的独立模块：不能读取宿主全局状态、不能自行路由、
// 不能引用模块目录之外的代码；否则复用方会在运行时才发现缺东西。
const moduleForbiddenPatterns = [
  { pattern: /\bgetApp\s*\(/, label: 'getApp()' },
  { pattern: /\bgetCurrentPages\s*\(/, label: 'getCurrentPages()' },
  { pattern: /\bwx\.(?:navigateTo|redirectTo|reLaunch|switchTab|navigateBack|showShareMenu|setNavigationBarTitle)\b/, label: '页面路由或分享/标题 API' },
  { pattern: /\brequire(?:\.async)?\s*\(\s*['"](?:\.\.\/)+(?:utils|pages|data|assets)\//, label: '模块目录之外的相对引用' }
]

function assertModuleSelfContained (sources, moduleRoot = 'file-reader') {
  const prefix = `${moduleRoot}/`
  let inspected = 0
  for (const [relativePath, source] of Object.entries(sources)) {
    if (!relativePath.startsWith(prefix) || !relativePath.endsWith('.js')) continue
    // 第三方 vendored 代码（mp-html、fflate、unrar 等）不受模块边界约束。
    if (relativePath.includes('/vendor/') || relativePath.includes('/components/mp-html/')) continue
    // skin/ 是宿主自有的皮肤，允许用宿主组件与文案，不受模块自包含约束
    if (relativePath.startsWith(`${moduleRoot}/skin/`)) continue
    inspected++
    for (const { pattern, label } of moduleForbiddenPatterns) {
      assert.ok(!pattern.test(source), `file-reader 模块必须自包含，禁止 ${label}：${relativePath}`)
    }
  }
  assert.ok(inspected > 10, `file-reader 模块源码数量异常：${inspected}`)
  return inspected
}

function assertLocalOnlySources (sources) {
  for (const [relativePath, source] of Object.entries(sources)) {
    for (const { pattern, label } of forbiddenRuntimePatterns) {
      assert.ok(!pattern.test(source), `正式小程序包禁止包含 ${label}：${relativePath}`)
    }
  }
}

function validateProductionPackage (root = projectRoot) {
  const projectConfig = readJson(path.join(root, 'project.config.json'))
  const miniprogramRoot = path.join(root, projectConfig.miniprogramRoot || '')
  const appConfig = readJson(path.join(miniprogramRoot, 'app.json'))

  assert.equal(projectConfig.appid, expectedAppId, `AppID 不一致：${projectConfig.appid || '(空)'}`)
  assert.equal(projectConfig.miniprogramRoot, 'miniprogram/', 'miniprogramRoot 必须为 miniprogram/')
  assert.ok(fs.existsSync(miniprogramRoot), 'miniprogramRoot 不存在')

  const materialTypes = validateSupportedMaterials(appConfig)
  validatePages(miniprogramRoot, appConfig.pages, '主包 ')
  const { roots: subPackageRoots, sizes: subPackageBytes } = validateSubPackages(miniprogramRoot, appConfig)

  const sevenZipRoot = path.join(miniprogramRoot, 'file-reader/sevenzip/runtime')
  for (const fileName of ['7zz.js', 'native-listing.js', '7zz.wasm.br', 'LICENSE-7ZIP', 'LICENSE-UNRAR', 'NOTICE-7ZIP']) {
    assert.ok(fs.existsSync(path.join(sevenZipRoot, fileName)), `7z 运行时缺少 ${fileName}`)
  }
  const markdownRoot = path.join(miniprogramRoot, 'file-reader/markdown/runtime')
  for (const fileName of ['index.js', 'markdown-document.js', 'tex-text.js', 'mermaid-lite.js', 'vendor/marked.js', 'vendor/LICENSE-MARKED']) {
    assert.ok(fs.existsSync(path.join(markdownRoot, fileName)), `Markdown 分包缺少 ${fileName}`)
  }
  for (const root of ['file-reader/engine', 'file-reader/document', 'file-reader/archive', 'file-reader/image', 'file-reader/sevenzip', 'file-reader/markdown']) {
    assert.ok(subPackageRoots.has(root), `app.json 未登记模块分包 ${root}`)
  }
  assertNoCrossSubPackageRequire(miniprogramRoot, subPackageRoots)

  const mainPackageFiles = listAllFiles(miniprogramRoot).filter(file => {
    const relative = path.relative(miniprogramRoot, file)
    return !Array.from(subPackageRoots).some(root => relative === root || relative.startsWith(`${root}${path.sep}`))
  })
  const mainPackageBytes = totalBytes(mainPackageFiles)
  assert.ok(mainPackageBytes < maxPackageBytes, `主包超过 2 MiB：${mainPackageBytes} 字节`)
  assert.ok(!fs.existsSync(path.join(miniprogramRoot, 'file-reader/document/html-runtime/COVERAGE.md')), '兼容清单是开发文档，应生成到 docs/reader-coverage.md，不能占用运行包')

  const files = listReadableFiles(miniprogramRoot)
  const sources = Object.fromEntries(files.map(file => [path.relative(miniprogramRoot, file).split(path.sep).join('/'), fs.readFileSync(file, 'utf8')]))
  assertLocalOnlySources(sources)
  const moduleFiles = assertModuleSelfContained(sources)
  for (const component of ['file-reader/engine/components/reader/reader', 'file-reader/engine/components/design-preview/design-preview', 'file-reader/image/components/svg-view/svg-view']) {
    for (const extension of ['.js', '.json', '.wxml', '.wxss']) {
      assert.ok(fs.existsSync(path.join(miniprogramRoot, `${component}${extension}`)), `模块组件文件不存在：${component}${extension}`)
    }
    assert.equal(readJson(path.join(miniprogramRoot, `${component}.json`)).component, true, `${component}.json 必须声明 component: true`)
  }
  // 皮肤契约：引擎组件只引用 /file-reader/skin 下的四个皮肤组件与 copy.js，宿主替换整目录即可换肤
  for (const skin of ['status', 'media', 'inspector', 'design']) {
    for (const extension of ['.js', '.json', '.wxml', '.wxss']) assert.ok(fs.existsSync(path.join(miniprogramRoot, `file-reader/skin/${skin}/${skin}${extension}`)), `皮肤组件缺少 file-reader/skin/${skin}/${skin}${extension}`)
  }
  assert.ok(fs.existsSync(path.join(miniprogramRoot, 'file-reader/skin/copy.js')), '皮肤缺少 copy.js')
  const readerConfig = readJson(path.join(miniprogramRoot, 'file-reader/engine/components/reader/reader.json'))
  for (const [name, target] of [['skin-status', '/file-reader/skin/status/status'], ['skin-media', '/file-reader/skin/media/media'], ['skin-inspector', '/file-reader/skin/inspector/inspector']]) {
    assert.equal(readerConfig.usingComponents[name], target, `reader.json 未引用皮肤组件 ${name}`)
  }
  assert.equal(readJson(path.join(miniprogramRoot, 'file-reader/engine/components/design-preview/design-preview.json')).usingComponents['skin-design'], '/file-reader/skin/design/design', 'design-preview.json 未引用皮肤组件 skin-design')
  const indexConfig = readJson(path.join(miniprogramRoot, 'pages/index/index.json'))
  assert.equal(indexConfig.usingComponents && indexConfig.usingComponents['file-reader'], '/file-reader/engine/components/reader/reader', '阅读页必须通过 usingComponents 引用 file-reader 组件')
  const previewConfig = readJson(path.join(miniprogramRoot, 'pages/file-preview/file-preview.json'))
  assert.equal(previewConfig.usingComponents && previewConfig.usingComponents['design-preview'], '/file-reader/engine/components/design-preview/design-preview', '预览页必须引用 design-preview 组件')
  // 主包页面引用分包组件属于分包异步化，必须声明 componentPlaceholder，否则基础库直接报错。
  assert.equal(indexConfig.componentPlaceholder && indexConfig.componentPlaceholder['file-reader'], 'view', '阅读页缺少 file-reader 的 componentPlaceholder')
  assert.equal(previewConfig.componentPlaceholder && previewConfig.componentPlaceholder['design-preview'], 'view', '预览页缺少 design-preview 的 componentPlaceholder')
  for (const page of appConfig.pages) {
    const config = readJson(path.join(miniprogramRoot, `${page}.json`))
    assert.equal(config.componentFramework, 'glass-easel', `${page}.json 未启用 glass-easel`)
    assert.equal(config.glassEaselWebview, true, `${page}.json 缺少 glassEaselWebview`)
  }

  for (const page of ['pages/home/home.js', 'pages/index/index.js', 'pages/file-preview/file-preview.js']) {
    assert.match(sources[page] || '', /onShareAppMessage\s*\(/, `${page} 缺少好友分享回调`)
    assert.match(sources[page] || '', /onShareTimeline\s*\(/, `${page} 缺少朋友圈分享回调`)
  }

  return {
    appid: projectConfig.appid,
    miniprogramRoot: projectConfig.miniprogramRoot,
    pages: appConfig.pages.length,
    supportedMaterials: materialTypes,
    inspectedFiles: files.length,
    mainPackageBytes,
    subPackageBytes,
    moduleFiles,
    componentFramework: 'glass-easel',
    localOnly: true,
    shareEntry: true
  }
}

if (require.main === module) {
  console.log(JSON.stringify(validateProductionPackage(), null, 2))
}

module.exports = {
  assertLocalOnlySources,
  assertModuleSelfContained,
  expectedAppId,
  requiredMaterialTypes,
  validateSubPackages,
  validateProductionPackage,
  validateSupportedMaterials
}
