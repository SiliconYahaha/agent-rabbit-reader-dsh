'use strict'

// 死代码候选扫描器（报告，不是门禁；退出码恒 0）。
//
//   node scripts/scan-dead-code.js [--out candidates.jsonl] [--min-confidence N]
//                                  [--types function,export,module,...] [--explain file:symbol]
//                                  [--list-rules] [--report-used]
//
// 输入只来自 `git ls-files` 与文件内容；输出按 (file, line, symbol) 排序、不含时间戳，两次运行字节全等。
// 每条候选：symbol / file / line / type / basis / rules / refKinds / sampleRefs / confidence(1-10)。
//
// 白名单规则对应 docs/dead-code-patterns.md（计划文件里的 A/B/C 三组模式编号），每条规则的注释
// 写明它保护的是哪一种「静态 import 图看不见的引用」。规则只降低信心或抑制候选，不删除任何东西。

const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const acorn = require('acorn')

const projectRoot = path.resolve(__dirname, '..')
const MINIPROGRAM_ROOT = 'miniprogram'
const SCANNER_VERSION = 1

// ---------------------------------------------------------------------------
// 文件枚举与分类

// 讨论候选本身的文件不能当作引用来源，否则"清单里提到了"会把死代码救活。
const SELF_REFERENCE_FILES = [/^candidates\.jsonl$/, /^verdicts\.md$/, /^docs\/dead-code-patterns\.md$/, /^scripts\/scan-dead-code\.js$/, /^tests\/scan-dead-code\.test\.js$/]

function gitFiles (root) {
  const output = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return output.split('\0').filter(Boolean)
    .filter(file => !file.startsWith('node_modules/') && !file.startsWith('outputs/') && !SELF_REFERENCE_FILES.some(pattern => pattern.test(file)))
    .filter(file => fs.existsSync(path.join(root, file)) && fs.statSync(path.join(root, file)).isFile())
    .sort()
}

function categoryOf (file) {
  if (file.startsWith('miniprogram/')) {
    if (/\/vendor\//.test(file) || file.includes('/components/mp-html/') || /\/7zz\.js$/.test(file)) return 'vendor'
    if (/\.(wasm\.br|png|jpg|jpeg|gif|webp|svg)$/.test(file)) return 'asset'
    return 'runtime'
  }
  if (file.startsWith('tests/fixtures/')) return 'fixture'
  if (file.startsWith('tests/')) return 'test'
  if (file.startsWith('scripts/')) return 'script'
  if (file.startsWith('docs/')) return 'doc'
  if (file.startsWith('compatibility/')) return 'profile'
  if (file.startsWith('tools/') || file.startsWith('deploy/') || file.startsWith('server/') || file.startsWith('.github/')) return 'tooling'
  return 'root'
}

const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.json', '.wxml', '.wxss', '.md', '.yml', '.yaml', '.sh', '.txt', '.html', '.py', '.swift', '.patch', '.gitattributes', '.gitignore', '.dockerignore', '.svg', '.csv'])

function isTextFile (file) {
  const base = path.basename(file)
  if (TEXT_EXTENSIONS.has(path.extname(file))) return true
  return ['Dockerfile', 'Caddyfile', '.gitattributes', '.gitignore', '.dockerignore', 'LICENSE', 'NOTICE'].some(name => base === name || base.startsWith('LICENSE') || base.startsWith('NOTICE'))
}

// ---------------------------------------------------------------------------
// JS 解析：符号声明、引用、require 边

function parseJs (source, file) {
  const options = { ecmaVersion: 'latest', locations: true, allowHashBang: true, allowReturnOutsideFunction: true }
  try {
    return acorn.parse(source, { ...options, sourceType: file.endsWith('.mjs') ? 'module' : 'script' })
  } catch (_) {
    try { return acorn.parse(source, { ...options, sourceType: 'module' }) } catch (error) { return null }
  }
}

function walk (node, visit, parent = null, key = null) {
  if (!node || typeof node.type !== 'string') return
  if (visit(node, parent, key) === false) return
  for (const name of Object.keys(node)) {
    if (name === 'loc' || name === 'range' || name === 'parent') continue
    const value = node[name]
    if (Array.isArray(value)) value.forEach(child => { if (child && typeof child.type === 'string') walk(child, visit, node, name) })
    else if (value && typeof value.type === 'string') walk(value, visit, node, name)
  }
}

function propertyKeyName (property) {
  if (!property || !property.key) return null
  if (property.key.type === 'Identifier' && !property.computed) return property.key.name
  if (property.key.type === 'Literal') return String(property.key.value)
  return null
}

function analyzeJs (file, source) {
  const ast = parseJs(source, file)
  const result = { declarations: [], exports: [], methods: [], identifiers: new Map(), requires: [], asyncRequires: [], strings: [], parseError: !ast, memberNames: new Map(), dataTable: false }
  if (!ast) return result
  const addIdentifier = (name, line) => {
    const list = result.identifiers.get(name) || []
    list.push(line)
    result.identifiers.set(name, list)
  }
  const addMember = (name, line) => {
    const list = result.memberNames.get(name) || []
    list.push(line)
    result.memberNames.set(name, list)
  }
  // 顶层声明
  for (const statement of ast.body) {
    const line = statement.loc.start.line
    if (statement.type === 'FunctionDeclaration' && statement.id) result.declarations.push({ name: statement.id.name, kind: 'function', line })
    else if (statement.type === 'ClassDeclaration' && statement.id) result.declarations.push({ name: statement.id.name, kind: 'class', line })
    else if (statement.type === 'VariableDeclaration') {
      for (const declarator of statement.declarations) {
        if (declarator.id.type === 'Identifier') {
          const init = declarator.init
          const kind = init && (init.type === 'FunctionExpression' || init.type === 'ArrowFunctionExpression') ? 'function' : init && init.type === 'ClassExpression' ? 'class' : 'const'
          result.declarations.push({ name: declarator.id.name, kind, line: declarator.loc.start.line, isRequire: Boolean(init && init.type === 'CallExpression' && init.callee.type === 'Identifier' && init.callee.name === 'require') })
        } else if (declarator.id.type === 'ObjectPattern') {
          for (const property of declarator.id.properties) {
            if (property.type === 'Property' && property.value.type === 'Identifier') {
              result.declarations.push({ name: property.value.name, kind: 'const', line: property.loc.start.line, isRequire: Boolean(declarator.init && declarator.init.type === 'CallExpression' && declarator.init.callee.type === 'Identifier' && declarator.init.callee.name === 'require'), destructured: true })
            }
          }
        }
      }
    }
  }
  walk(ast, (node, parent, key) => {
    if (node.type === 'Identifier') {
      // 声明位置不算引用；属性名单独记到 memberNames。
      const isDeclarationId = parent && ((parent.type === 'FunctionDeclaration' || parent.type === 'ClassDeclaration' || parent.type === 'VariableDeclarator') && key === 'id')
      const isPropertyKey = parent && parent.type === 'Property' && key === 'key' && !parent.computed
      const isMemberProperty = parent && parent.type === 'MemberExpression' && key === 'property' && !parent.computed
      const isMethodKey = parent && (parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition') && key === 'key' && !parent.computed
      if (isMemberProperty || isPropertyKey || isMethodKey) addMember(node.name, node.loc.start.line)
      else if (!isDeclarationId) addIdentifier(node.name, node.loc.start.line)
      // 解构时 `{ a }` 的 value 与 key 同名，value 也会被上面当 identifier 记一次；简写属性两者是同一节点
      if (isPropertyKey && parent.shorthand) addIdentifier(node.name, node.loc.start.line)
    }
    if (node.type === 'Literal' && typeof node.value === 'string') result.strings.push({ value: node.value, line: node.loc.start.line })
    if (node.type === 'TemplateElement') result.strings.push({ value: node.value.cooked || '', line: node.loc.start.line })
    if (node.type === 'CallExpression') {
      const callee = node.callee
      const argument = node.arguments[0]
      const literal = argument && argument.type === 'Literal' && typeof argument.value === 'string' ? argument.value : null
      if (callee.type === 'Identifier' && callee.name === 'require' && literal) result.requires.push({ id: literal, line: node.loc.start.line })
      if (callee.type === 'MemberExpression' && callee.object.type === 'Identifier' && callee.object.name === 'require' && callee.property.name === 'async' && literal) result.asyncRequires.push({ id: literal, line: node.loc.start.line })
      if (callee.type === 'MemberExpression' && callee.object.type === 'Identifier' && callee.object.name === 'require' && callee.property.name === 'resolve' && literal) result.requires.push({ id: literal, line: node.loc.start.line })
      // Component({ methods: {...} }) / Page({...}) / App({...})
      if (callee.type === 'Identifier' && ['Component', 'Page', 'App'].includes(callee.name) && argument && argument.type === 'ObjectExpression') {
        const container = callee.name
        for (const property of argument.properties) {
          const name = propertyKeyName(property)
          if (!name) continue
          if (name === 'methods' && property.value.type === 'ObjectExpression') {
            for (const method of property.value.properties) {
              const methodName = propertyKeyName(method)
              if (methodName) result.methods.push({ name: methodName, line: method.loc.start.line, container: `${container}.methods` })
            }
          } else if (property.value.type === 'FunctionExpression' || property.value.type === 'ArrowFunctionExpression') {
            result.methods.push({ name, line: property.loc.start.line, container })
          }
        }
      }
    }
    if (node.type === 'AssignmentExpression' && node.left.type === 'MemberExpression') {
      const left = node.left
      const isModuleExports = left.object.type === 'Identifier' && left.object.name === 'module' && left.property.name === 'exports'
      if (isModuleExports && node.right.type === 'ObjectExpression') {
        // B11：纯字面量大表（颜色名、实体名）是数据不是符号，键按名查表。
        const properties = node.right.properties
        const isDataTable = properties.length >= 40 && properties.every(property => property.type === 'Property' && property.value.type === 'Literal')
        if (isDataTable) result.dataTable = true
        for (const property of isDataTable ? [] : properties) {
          const name = propertyKeyName(property)
          if (!name) continue
          result.exports.push({ name, line: property.loc.start.line })
          if (name === '_internals' && property.value.type === 'ObjectExpression') {
            for (const inner of property.value.properties) {
              const innerName = propertyKeyName(inner)
              if (innerName) result.exports.push({ name: innerName, line: inner.loc.start.line, viaInternals: true })
            }
          }
        }
      } else if (left.object.type === 'MemberExpression' && left.object.object.type === 'Identifier' && left.object.object.name === 'module' && left.object.property.name === 'exports' && left.property.type === 'Identifier') {
        result.exports.push({ name: left.property.name, line: node.loc.start.line })
      }
    }
    return true
  })
  return result
}

function resolveRequire (fromFile, id) {
  if (!id.startsWith('.') && !id.startsWith('/')) return null
  const base = id.startsWith('/') ? path.join(MINIPROGRAM_ROOT, id.slice(1)) : path.join(path.dirname(fromFile), id)
  const candidates = [base, `${base}.js`, `${base}.json`, `${base}.mjs`, path.join(base, 'index.js')]
  for (const candidate of candidates) {
    const normalized = candidate.split(path.sep).join('/')
    if (fs.existsSync(path.join(projectRoot, normalized)) && fs.statSync(path.join(projectRoot, normalized)).isFile()) return normalized
  }
  return null
}

// ---------------------------------------------------------------------------
// 文本索引（所有文本文件）：单词与路径片段

function indexText (source) {
  const words = new Map()
  const wordRegex = /[A-Za-z_$][A-Za-z0-9_$-]*/g
  // Both cursors move forward. Recounting the complete prefix for every word
  // makes large retained compatibility reports quadratic to scan.
  let line = 1, nextNewline = source.indexOf('\n')
  let match
  while ((match = wordRegex.exec(source))) {
    while (nextNewline >= 0 && nextNewline < match.index) {
      line++
      nextNewline = source.indexOf('\n', nextNewline + 1)
    }
    const list = words.get(match[0]) || []
    if (list.length < 8) list.push(line)
    words.set(match[0], list)
  }
  return words
}

function textMentions (source, needle) {
  const lines = []
  let index = source.indexOf(needle)
  while (index >= 0 && lines.length < 8) {
    lines.push(source.slice(0, index).split('\n').length)
    index = source.indexOf(needle, index + needle.length)
  }
  return lines
}

// ---------------------------------------------------------------------------
// 仓库模型

function buildModel (root) {
  const files = gitFiles(root)
  const model = { root, files, sources: new Map(), categories: new Map(), js: new Map(), words: new Map(), packageJson: null, appJson: null, workflows: [], generatedTargets: new Map(), requireGraph: new Map(), reverseRequires: new Map() }
  for (const file of files) {
    model.categories.set(file, categoryOf(file))
    if (!isTextFile(file)) continue
    let source
    try { source = fs.readFileSync(path.join(root, file), 'utf8') } catch (_) { continue }
    model.sources.set(file, source)
    if (/\.(js|mjs|cjs)$/.test(file) && model.categories.get(file) !== 'vendor') model.js.set(file, analyzeJs(file, source))
    model.words.set(file, indexText(source))
  }
  model.packageJson = JSON.parse(model.sources.get('package.json') || '{}')
  model.appJson = JSON.parse(model.sources.get('miniprogram/app.json') || '{}')
  model.workflows = files.filter(file => file.startsWith('.github/workflows/'))
  for (const [file, info] of model.js) {
    const targets = new Set()
    for (const item of info.requires.concat(info.asyncRequires)) {
      const target = resolveRequire(file, item.id)
      if (target) {
        targets.add(target)
        const reverse = model.reverseRequires.get(target) || new Set()
        reverse.add(file)
        model.reverseRequires.set(target, reverse)
      }
    }
    model.requireGraph.set(file, targets)
  }
  // A26：生成脚本写出的受控文件（目标文件不会被 require，但是活的）
  const generated = [
    ['scripts/gen-dom-tree-wxml.js', 'miniprogram/file-reader/engine/components/reader/dom-tree.wxml'],
    ['scripts/generate-sample.js', 'miniprogram/data/sample-html.js'],
    ['scripts/vendor-sval.js', 'miniprogram/file-reader/document/html-runtime/vendor/sval.js'],
    ['scripts/vendor-html-entities.js', 'miniprogram/file-reader/document/html-named-entities.js'],
    ['scripts/gen-reader-coverage.mjs', 'docs/reader-coverage.md'],
    ['scripts/vendor-format-runtime.js', 'miniprogram/file-reader/engine/core/vendor/'],
    ['scripts/vendor-format-runtime.js', 'miniprogram/file-reader/markdown/runtime/vendor/'],
    ['scripts/build-sevenzip-native.js', 'miniprogram/file-reader/sevenzip/runtime/7zz.js'],
    ['scripts/build-sevenzip-native.js', 'miniprogram/file-reader/sevenzip/runtime/7zz.wasm.br'],
    ['scripts/build-sevenzip-native.js', 'tools/sevenzip-native/manifest.json']
  ]
  for (const [generator, target] of generated) model.generatedTargets.set(target, generator)
  return model
}

// ---------------------------------------------------------------------------
// 引用收集

function fileReferences (model, file) {
  const refs = []
  const category = model.categories.get(file)
  const base = path.basename(file)
  const stem = base.replace(/\.[^.]+$/, '')
  const add = (kind, from, line, note) => refs.push({ kind, from, line, note })
  // require / require.async / require.resolve（A7、A29）
  for (const from of model.reverseRequires.get(file) || []) add('require', from, 0)
  // 页面四件套：js/json/wxml/wxss 同名互相成立（A6）
  const pageStem = file.replace(/\.(js|json|wxml|wxss)$/, '')
  if (/\.(js|json|wxml|wxss)$/.test(file) && (model.appJson.pages || []).some(page => `miniprogram/${page}` === pageStem)) add('app-json-page', 'miniprogram/app.json', 0)
  for (const sub of model.appJson.subPackages || model.appJson.subpackages || []) {
    for (const page of sub.pages || []) if (`miniprogram/${sub.root}/${page}` === pageStem) add('app-json-subpackage', 'miniprogram/app.json', 0)
    if (file.startsWith(`miniprogram/${sub.root}/`)) add('app-json-subpackage-root', 'miniprogram/app.json', 0, sub.root)
  }
  if (file === 'miniprogram/sitemap.json' && model.appJson.sitemapLocation === 'sitemap.json') add('app-json-sitemap', 'miniprogram/app.json', 0)
  // usingComponents（A11）与组件四件套
  for (const [other, source] of model.sources) {
    if (!other.endsWith('.json') || !other.startsWith('miniprogram/')) continue
    let json
    try { json = JSON.parse(source) } catch (_) { continue }
    for (const value of Object.values(json.usingComponents || {})) {
      const resolved = value.startsWith('/') ? path.join(MINIPROGRAM_ROOT, value.slice(1)) : path.join(path.dirname(other), value)
      if (resolved.split(path.sep).join('/') === pageStem) add('using-components', other, 0)
    }
  }
  // 文本中的路径提及：脚本名、文档、workflow、profile evidence、readFileSync（A1-A5、C5、C9、C13、C14）
  const relativeNames = new Set([file, file.replace(/^miniprogram\//, ''), base])
  if (file.startsWith('scripts/') || file.startsWith('tests/')) relativeNames.add(stem)
  for (const [other, source] of model.sources) {
    if (other === file) continue
    for (const needle of relativeNames) {
      if (needle.length < 6) continue
      const lines = textMentions(source, needle)
      if (!lines.length) continue
      const otherCategory = model.categories.get(other)
      const kind = other === 'package.json' ? 'package-json' : other.startsWith('.github/') ? 'workflow' : other === 'README.md' ? 'readme' : otherCategory === 'profile' ? 'profile-evidence' : otherCategory === 'doc' ? 'doc' : otherCategory === 'test' ? 'test-text' : otherCategory === 'script' ? 'script-text' : otherCategory === 'fixture' ? 'fixture-readme' : other === '.gitattributes' || other.endsWith('.gitattributes') ? 'gitattributes' : 'text'
      add(kind, other, lines[0], needle)
      break
    }
  }
  // WXML/WXSS 里的资源路径（A13）
  if (category === 'asset') {
    for (const [other, source] of model.sources) {
      if (/\.(wxml|wxss|js)$/.test(other) && source.includes(`/${file.replace(/^miniprogram\//, '')}`)) add('asset-path', other, textMentions(source, `/${file.replace(/^miniprogram\//, '')}`)[0] || 0)
    }
  }
  // 生成物（A26/A27）
  for (const [target, generator] of model.generatedTargets) {
    if (file === target || (target.endsWith('/') && file.startsWith(target))) add('generated-by', generator, 0)
  }
  return refs
}

function symbolReferences (model, file, candidate) {
  const refs = []
  const name = candidate.symbol
  const info = model.js.get(file)
  const add = (kind, from, line, note) => refs.push({ kind, from, line, note })
  if (info) {
    const local = (info.identifiers.get(name) || []).filter(line => line !== candidate.line)
    if (local.length) add('local-identifier', file, local[0], `${local.length} 处`)
    const member = (info.memberNames.get(name) || []).filter(line => line !== candidate.line)
    // 方法名在本文件里以 this.x() 形式出现也算本地引用
    if (member.length) add(candidate.type === 'method' ? 'local-identifier' : 'local-property', file, member[0], `${member.length} 处`)
  }
  // 其他 JS：以属性名或标识符出现（导出/方法按名调用）
  for (const [other, otherInfo] of model.js) {
    if (other === file) continue
    const idLines = otherInfo.identifiers.get(name) || []
    const memberLines = otherInfo.memberNames.get(name) || []
    if (!idLines.length && !memberLines.length) continue
    const category = model.categories.get(other)
    const importsFile = (model.requireGraph.get(other) || new Set()).has(file)
    const kind = importsFile ? 'import' : category === 'test' ? 'test' : category === 'script' ? 'script' : 'name-match'
    add(kind, other, idLines[0] || memberLines[0], importsFile ? 'require 图内' : '同名出现，未 require 本文件')
  }
  // 非 JS 文本：WXML 绑定、文档、profile、workflow
  for (const [other, words] of model.words) {
    if (other === file || model.js.has(other)) continue
    const lines = words.get(name)
    if (!lines) continue
    const category = model.categories.get(other)
    const kind = other.endsWith('.wxml') ? 'wxml' : category === 'doc' ? 'doc' : category === 'profile' ? 'profile' : other.startsWith('.github/') ? 'workflow' : other === 'package.json' ? 'package-json' : 'text'
    add(kind, other, lines[0])
  }
  return refs
}

// ---------------------------------------------------------------------------
// 白名单规则。每条规则：id、模式编号、说明、apply(candidate, ctx) -> { suppress?, cap?, note }。
// 「suppress」= 这不是候选（有真实的动态引用）；「cap」= 仍列出但信心不超过该值。

const RUNTIME_SANDBOX_FILES = ['miniprogram/file-reader/document/html-runtime/html-dom-shim.js', 'miniprogram/file-reader/document/html-runtime/html-script-runtime.js', 'miniprogram/file-reader/document/html-runtime/react-compat-runtime.js']
const LIFECYCLE_NAMES = new Set(['onLoad', 'onShow', 'onHide', 'onUnload', 'onReady', 'onPageScroll', 'onShareAppMessage', 'onShareTimeline', 'onReachBottom', 'onPullDownRefresh', 'onResize', 'onTabItemTap', 'onLaunch', 'onError', 'attached', 'detached', 'created', 'ready', 'moved', 'show', 'hide'])
const DEV_ONLY_METHODS = new Set(['readMaterial', 'readSvgMaterial', 'startRarRuntimeProbeForDevelopment', 'startSevenZipRuntimeProbeForDevelopment', 'getReaderDiagnostics'])
const HOST_API_METHODS = new Set(['open', 'syncPageScroll', 'onPageScroll', 'emit', 'loadMaterial', 'openAiPdf'])
const CANVAS_OP_NAMES = new Set('arc arcTo beginPath bezierCurveTo clearRect clip closePath ellipse fill fillRect fillText lineTo moveTo quadraticCurveTo rect resetTransform restore rotate save scale setLineDash setTransform stroke strokeRect strokeText transform translate'.split(' '))

// docs/dead-code-patterns.md 里的全部模式编号；--list-rules 会检查每个编号都有对应规则。
const ALL_PATTERNS = [].concat(
  Array.from({ length: 31 }, (_, i) => `A${i + 1}`),
  Array.from({ length: 23 }, (_, i) => `B${i + 1}`),
  Array.from({ length: 18 }, (_, i) => `C${i + 1}`)
)

// A31：内核注入。kernel-exports 里登记的模块，其导出会在族分包里以 const { a, b } = require('./kernel').key 的形式解构。
const KERNEL_INJECTED_FILES = new Set([
  'miniprogram/file-reader/engine/core/archive-members.js', 'miniprogram/file-reader/engine/core/file-inspector.js',
  'miniprogram/file-reader/engine/core/text-decoder.js', 'miniprogram/file-reader/engine/core/text-codec.js',
  'miniprogram/file-reader/engine/core/subpackage-loader.js', 'miniprogram/file-reader/engine/core/vendor/legacy-cjk-data.js',
  'miniprogram/file-reader/shared/module-root.js'
])
let kernelDestructuredCache = null
function kernelDestructuredNames () {
  if (kernelDestructuredCache) return kernelDestructuredCache
  const names = new Set()
  const walk = dir => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.js')) {
        const source = fs.readFileSync(full, 'utf8')
        for (const match of source.matchAll(/const\s*\{([^}]+)\}\s*=\s*require\('\.{1,2}\/kernel'\)\.\w+/g)) {
          for (const part of match[1].split(',')) {
            const name = part.split(':')[0].trim()
            if (name) names.add(name)
          }
        }
      }
    }
  }
  for (const family of ['document', 'archive', 'image']) walk(path.join(projectRoot, 'miniprogram/file-reader', family))
  kernelDestructuredCache = names
  return names
}

const RULES = [
  {
    id: 'R-A01-npm-script-file', patterns: ['A1', 'A2', 'A3', 'A4'],
    description: 'package.json scripts / 工作流 / verify-release.sh / wechat-release.js 用字符串路径调用 scripts/*，脚本名与文件名不一致（如 verify:canvas-budget → verify-canvas-live-budget.js）',
    apply: (c, ctx) => c.type === 'module' && c.file.startsWith('scripts/') && ctx.refs.some(r => r.kind === 'package-json' || r.kind === 'workflow') ? { suppress: true, note: '被 npm script 或工作流按路径调用' } : null
  },
  {
    id: 'R-A02-test-glob', patterns: ['A2'],
    description: 'package.json 的 test 脚本用 glob tests/*.test.js 运行所有测试文件，没有逐个引用',
    apply: (c) => c.type === 'module' && /^tests\/[^/]+\.test\.js$/.test(c.file) ? { suppress: true, note: '被 npm test 的 glob 运行' } : null
  },
  {
    id: 'R-A06-app-files', patterns: ['A6'],
    description: 'miniprogram/app.js、app.json、app.wxss 是微信按约定加载的 App 三件套',
    apply: (c) => c.type === 'module' && /^miniprogram\/app\.(js|json|wxss)$/.test(c.file) ? { suppress: true, note: '微信 App 三件套' } : null
  },
  {
    id: 'R-C09-profile-directory-scan', patterns: ['C9', 'C10'],
    description: 'compatibility/profiles/*.json 由 tests/compatibility-profiles.test.js readdirSync 扫目录发现并校验，脚本按名 require 作为样本清单',
    apply: (c) => c.type === 'module' && /^compatibility\/profiles\/[^/]+\.json$/.test(c.file) ? { suppress: true, note: '被测试目录扫描发现；脚本按名读取' } : null
  },
  {
    id: 'R-A05-docker-server', patterns: ['A5'],
    description: 'Dockerfile/compose/Caddyfile 直接引用 server/ 与端口；server 依赖 busboy/unzipper 只在此处使用',
    apply: (c, ctx) => (c.file.startsWith('server/') || c.file.startsWith('deploy/') || c.file === 'Dockerfile' || c.file === '.dockerignore') && c.type === 'module' ? { cap: 6, note: '实验性高保真服务，只被 Dockerfile/compose/verify-release.sh 引用，不进小程序包' } : null
  },
  {
    id: 'R-A06-page-quad', patterns: ['A6', 'A7', 'A8', 'A9'],
    description: 'app.json 的 pages / subPackages / supportedMaterials / sitemapLocation 用字符串登记页面与分包，一个字符串对应 js/json/wxml/wxss 四个文件',
    apply: (c, ctx) => c.type === 'module' && ctx.refs.some(r => r.kind.startsWith('app-json')) ? { suppress: true, note: 'app.json 登记的页面/分包/站点地图' } : null
  },
  {
    id: 'R-A10-pack-ignore', patterns: ['A10'],
    description: 'project.config.json packOptions.ignore 里的文件受控但不上传（file-reader/README.md、SOURCE.json）',
    apply: (c) => c.type === 'module' && /^miniprogram\/file-reader\/(README\.md|SOURCE\.json)$/.test(c.file) ? { suppress: true, note: '模块说明/同步记录，packOptions.ignore 排除出包' } : null
  },
  {
    id: 'R-A11-using-components', patterns: ['A11', 'A12'],
    description: '页面/组件 JSON 的 usingComponents 路径字符串把组件四件套拉活（含 mp-html node.json 自递归）',
    apply: (c, ctx) => c.type === 'module' && ctx.refs.some(r => r.kind === 'using-components') ? { suppress: true, note: 'usingComponents 引用' } : null
  },
  {
    id: 'R-A13-asset-path', patterns: ['A13', 'B23'],
    description: 'WXML/WXSS/JS 里以字符串路径引用的资源（/assets/…）',
    apply: (c, ctx) => c.type === 'module' && ctx.category === 'asset' && ctx.refs.some(r => r.kind === 'asset-path') ? { suppress: true, note: '被模板或脚本以路径字符串引用' } : null
  },
  {
    id: 'R-A14-wxml-binding', patterns: ['A14', 'A15', 'A16', 'A17', 'A19', 'A20', 'B14'],
    description: 'WXML bind*/catch* 事件名、template is、id/class 选择器、数据字段以字符串出现在 WXML（含生成的 dom-tree.wxml）',
    apply: (c, ctx) => (c.type === 'method' || c.type === 'function' || c.type === 'const') && ctx.refs.some(r => r.kind === 'wxml') ? { suppress: true, note: 'WXML 模板按名绑定/引用' } : null
  },
  {
    id: 'R-A21-lifecycle', patterns: ['A21', 'B16'],
    description: 'Page/Component/App 生命周期与微信菜单触发的回调（onShow、onShareAppMessage、attached…）没有任何调用点',
    apply: (c) => c.type === 'method' && LIFECYCLE_NAMES.has(c.symbol) ? { suppress: true, note: '框架生命周期/菜单回调' } : null
  },
  {
    id: 'R-A22-cli-argv', patterns: ['A22', 'A23', 'A24', 'A25'],
    description: 'CLI 子命令由 process.argv 选择；深路径/计算路径 require；原型补丁 Symbol.for；环境变量门控分支',
    apply: (c, ctx) => c.type === 'module' && /^scripts\/(wechat-release|wechat-ci-upload|build-sevenzip-native|miniprogram-automator-compat)\.js$/.test(c.file) ? { cap: 3, note: 'argv 子命令 / 计算路径 require / 原型补丁入口' } : null
  },
  {
    id: 'R-A26-generated', patterns: ['A26', 'A27', 'C12'],
    description: '生成脚本写出的受控文件（dom-tree.wxml、sample-html.js、vendor/*、html-named-entities.js、reader-coverage.md、7zz.*）和哈希清单；生成器本身无人 require',
    apply: (c, ctx) => c.type === 'module' && ctx.refs.some(r => r.kind === 'generated-by') ? { suppress: true, note: `由 ${ctx.refs.find(r => r.kind === 'generated-by').from} 生成` } : null
  },
  {
    id: 'R-A28-vendor-source-deps', patterns: ['A28'],
    description: 'sval/marked/node-unrar-js/7z-wasm 只被 vendor 脚本从 node_modules 读文件；mp-html 只是测试差分基准；licia 未声明靠传递',
    apply: (c, ctx) => c.type === 'dependency' && ctx.refs.some(r => r.from.startsWith('scripts/vendor-') || r.from === 'scripts/build-sevenzip-native.js') ? { suppress: true, note: 'vendor 脚本读取其文件生成受控产物' } : null
  },
  {
    id: 'R-A18-wxs-inline', patterns: ['A18'],
    description: '<wxs module="isInline"> 内联脚本只在同一 WXML 里按模块名使用；WXML 文件本身由页面/组件四件套规则保活',
    apply: () => null
  },
  {
    id: 'R-C05-source-text-assert', patterns: ['C5'],
    description: '测试把生产源码/模板当文本断言（readFileSync + 正则）：这类引用在 fileReferences 里记为 test-text，模块不会被当成无引用',
    apply: () => null
  },
  {
    id: 'R-C06-vm-require-stub', patterns: ['C6'],
    description: 'vm.runInNewContext 手写 require(id) 按字符串分发：id 是模块内部相对路径，符号靠 test 类引用保活；模块靠 test-text 引用保活',
    apply: () => null
  },
  {
    id: 'R-C11-notice-obligation', patterns: ['C11'],
    description: 'compatibility/NOTICE.md、core/vendor/LICENSE-* 等许可义务文件点名内联 base64 与生成文件；由 R-platform-convention 压到 2',
    apply: () => null
  },
  {
    id: 'R-A29-lazy-require', patterns: ['A29'],
    description: '函数体内的延迟 require（canvas-png、css-computed-style、xhtml-document、html-script-runtime）',
    apply: () => null // require 图已包含函数体内的 require，此规则只是说明；无需额外处理
  },
  {
    id: 'R-A31-kernel-injection', patterns: ['A31'],
    description: '分包族通过注入拿内核：engine/core/kernel-exports.js 的键由 families.js 传给族的 attach()，族内文件写 const { x } = require(\'./kernel\').<key> 解构；attach/api 是跨分包 require.async 后按名取用的入口面',
    apply: (c) => {
      if (c.type === 'export' && /^miniprogram\/file-reader\/(engine\/core\/kernel-exports\.js|(document|archive|image)\/(index|api)\.js)$/.test(c.file)) return { cap: 2, note: '内核注入/族入口面：跨分包动态取用，仓库内无字面量 require' }
      if (c.type === 'export' && KERNEL_INJECTED_FILES.has(c.file) && kernelDestructuredNames().has(c.symbol)) return { suppress: true, note: '族分包经 require(\'./kernel\') 解构使用' }
      return null
    }
  },
  {
    id: 'R-A30-browser-bundle', patterns: ['A30', 'C3'],
    description: 'verify-inline-poster.js bundle() 用 regex 扫 require 建字符串键表，浏览器里 readerRequire(id) 加载；chrome-test-result.js 与 helpers 只被脚本 require',
    apply: (c, ctx) => c.type === 'module' && /^(scripts\/chrome-test-result\.js|tests\/helpers\/)/.test(c.file) && ctx.refs.some(r => r.kind === 'require') ? { suppress: true, note: '被其他脚本/测试 require' } : null
  },
  {
    id: 'R-B01-sandbox-globals', patterns: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B13'],
    description: 'HTML 沙盒暴露给用户网页脚本的 DOM/BOM API：类成员、Proxy 属性包、全局白名单对象、AST 改写引入的标识符、React hook 分发器',
    apply: (c) => RUNTIME_SANDBOX_FILES.includes(c.file) && (c.type === 'function' || c.type === 'class' || c.type === 'const' || c.type === 'export') ? { cap: 3, note: '沙盒 API 面：用户网页脚本按名调用，仓库内没有调用点' } : null
  },
  {
    id: 'R-B09-canvas-dispatch', patterns: ['B9', 'B11', 'B12', 'B20'],
    description: 'Canvas 操作按名录制/回放、MIME/别名/错误码查表、register() 能力注册表、Emscripten 回调名',
    apply: (c) => (CANVAS_OP_NAMES.has(c.symbol) || /^(rabbitOn|FIELD_NAMES|FORMAT_CAPABILITIES|register|capabilityAudit)/.test(c.symbol)) ? { cap: 3, note: '名字驱动的分发表' } : null
  },
  {
    id: 'R-B10-mp-html', patterns: ['B10', 'B22'],
    description: 'vendored 第三方代码（mp-html、fflate、unrar、sval、jpeg-encoder、编码表、7zz）整体白名单；插件钩子按名调用',
    apply: (c, ctx) => ctx.category === 'vendor' ? { suppress: true, note: 'vendored 第三方代码，由 vendor 脚本生成' } : null
  },
  {
    id: 'R-B14-host-api', patterns: ['B14', 'B15', 'C16', 'C17'],
    description: '组件对外 API（open/syncPageScroll/emit 事件）、开发版专用探针只被 miniprogram-automator 按名调用、宿主 selectComponent 后调用',
    apply: (c) => c.type === 'method' && (DEV_ONLY_METHODS.has(c.symbol) || HOST_API_METHODS.has(c.symbol)) ? { cap: 2, note: DEV_ONLY_METHODS.has(c.symbol) ? '开发版自动化探针（isDevelopmentBuild 门）' : '组件对外 API，宿主/README 使用' } : null
  },
  {
    id: 'R-B15-module-surface', patterns: ['B15'],
    description: 'file-reader/index.js 与 core/module-root.js 的导出是给宿主（AGI Bar）用的公共入口（configure/describe/fileKind…），仓库内没有调用点属正常',
    apply: (c) => c.type === 'export' && /^miniprogram\/file-reader\/(index\.js|core\/module-root\.js)$/.test(c.file) ? { cap: 2, note: '模块公共入口，供宿主项目调用' } : null
  },
  {
    id: 'R-B17-over-export', patterns: ['B17', 'B18', 'B19'],
    description: '导出多余但模块内部在用的符号：不是死代码，只是导出面可收窄；只被 tests/scripts 用的导出是测试契约',
    apply: (c, ctx) => c.type === 'export' && ctx.refs.some(r => r.kind === 'local-identifier') ? { cap: 5, note: '本文件内部在用，仅导出多余' } : null
  },
  {
    id: 'R-B21-string-contracts', patterns: ['B21', 'A20'],
    description: 'USER_DATA_PATH 文件名、存储键、id/class 选择器等字符串契约',
    apply: (c) => /^(SMIL_SUPPORT_STORAGE_KEY|DIRECTORY|ownedName)$/.test(c.symbol) ? { cap: 3, note: '字符串契约常量' } : null
  },
  {
    id: 'R-C01-registrar', patterns: ['C1', 'C2'],
    description: '测试用 global.Page/Component/App 注册器 + require.resolve 字符串加载页面/组件定义；历史别名 re-export',
    apply: (c, ctx) => c.type === 'module' && /^miniprogram\/(pages\/|app\.js|file-reader\/components\/(reader|design-preview)\/)/.test(c.file) && ctx.refs.some(r => r.kind === 'test-text' || r.kind === 'script-text' || r.kind === 'require') ? { suppress: true, note: '测试/脚本用注册器按路径加载' } : null
  },
  {
    id: 'R-C04-source-scrape', patterns: ['C4', 'C5', 'C6'],
    description: '脚本/测试把另一个文件当文本读取并按名抓常量（COMPRESSED_RAR 等）、断言源码文本、vm 沙盒手写 require(id)',
    apply: (c, ctx) => (c.type === 'const' || c.type === 'export') && ctx.refs.some(r => r.kind === 'test' || r.kind === 'script') && /^(COMPRESSED_RAR|HEADER_ENCRYPTED_RAR|LZMA2_7Z|ENCRYPTED_7Z|AES_ZIP|BZIP2_ZIP|inflateZlibBounded|inflateRawBounded)$/.test(c.symbol) ? { suppress: true, note: '被脚本/测试按名抓取' } : null
  },
  {
    id: 'R-C07-fixtures', patterns: ['C7', 'C8', 'C15'],
    description: '夹具目录由 samples.json/wpt.json 等清单按文件名索引；README/LICENSE 被 SHA 钉住；.gitattributes 只被 git 用',
    apply: (c, ctx) => c.type === 'module' && ctx.category === 'fixture' ? (ctx.refs.some(r => r.kind === 'fixture-readme' || r.kind === 'test-text' || r.kind === 'script-text' || r.kind === 'gitattributes' || r.kind === 'profile-evidence') ? { suppress: true, note: '被清单/测试/脚本/gitattributes 按名引用' } : { cap: 6, note: '夹具目录内文件；同目录清单可能以文件名索引' }) : null
  },
  {
    id: 'R-C09-profile-evidence', patterns: ['C9', 'C10', 'C11'],
    description: 'compatibility/profiles/*.json evidence[] 裸字符串引用脚本/测试；profile 作为运行数据按名取样本；NOTICE 许可义务点名文件',
    apply: (c, ctx) => c.type === 'module' && ctx.refs.some(r => r.kind === 'profile-evidence') ? { cap: 6, note: '仅被 compatibility/profiles 的 evidence 字符串引用（不是可执行边）' } : null
  },
  {
    id: 'R-C13-doc-only', patterns: ['C13', 'C18'],
    description: '历史 release 文档是某些脚本的唯一引用；零引用的受控文件（design-qa.md、docs/assets 等）',
    apply: (c, ctx) => c.type === 'module' && ctx.refs.length && ctx.refs.every(r => r.kind === 'doc') ? { cap: 8, note: '只在文档里被提到' } : null
  },
  {
    id: 'R-C14-exec-file', patterns: ['C14'],
    description: 'py/swift 工具链靠 execFileSync 文件名字符串调用',
    apply: (c, ctx) => c.type === 'module' && /\.(py|swift)$/.test(c.file) && ctx.refs.some(r => r.kind === 'script-text') ? { suppress: true, note: '被脚本 execFileSync 按文件名调用' } : null
  },
  {
    id: 'R-C18-historical-docs', patterns: ['C13', 'C18'],
    description: 'docs/release-v*.md 是每个版本的发布记录，wechat-release.js 用模板串 `docs/release-v${version}-dev.md` 检查当前版本；README 约定每轮迭代保留记录',
    apply: (c) => c.type === 'module' && /^docs\/release-v[\d.]+(-dev|-review)?\.md$/.test(c.file) ? { cap: 4, note: '版本发布记录，按仓库约定保留；只有确认不再需要历史回溯才可删' } : null
  },
  {
    id: 'R-platform-convention', patterns: ['A9', 'C15'],
    description: '平台按约定读取的文件：.github/dependabot.yml、.gitignore、.gitattributes、.dockerignore、sitemap.json、README/LICENSE/NOTICE',
    apply: (c) => c.type === 'module' && (/(^|\/)(\.gitignore|\.gitattributes|\.dockerignore|dependabot\.yml|sitemap\.json|README\.md|LICENSE[^/]*|NOTICE[^/]*)$/.test(c.file) || /^\.github\/workflows\/[^/]+\.yml$/.test(c.file)) ? { cap: 2, note: '平台/许可约定文件，不靠代码引用存在' } : null
  },
  {
    id: 'G-tests-scripts-only', patterns: ['B18', 'C3'],
    description: '只被 tests/ 或 scripts/ 引用的符号：是测试契约而非产品代码的死代码，删除需要连带删测试',
    apply: (c, ctx) => c.type !== 'module' && ctx.refs.length && ctx.refs.every(r => r.kind === 'test' || r.kind === 'script' || r.kind === 'test-text' || r.kind === 'script-text') ? { cap: 5, note: '只被 tests/scripts 引用' } : null
  },
  {
    id: 'G-name-match-elsewhere', patterns: ['B19'],
    description: '同名符号在别的文件另有独立定义（parseAttributes/VOID_TAGS/mediaQueryMatches）：裸 grep 会误判为在用，这里只标注不抑制',
    apply: (c, ctx) => c.type !== 'module' && ctx.refs.some(r => r.kind === 'name-match') && !ctx.refs.some(r => r.kind === 'import' || r.kind === 'local-identifier') ? { cap: 7, note: '仅同名出现在未 require 本文件的文件里' } : null
  }
]

// ---------------------------------------------------------------------------
// 候选收集与打分

function collectCandidates (model) {
  const candidates = []
  for (const file of model.files) {
    const category = model.categories.get(file)
    if (category === 'vendor' && !file.endsWith('LICENSE')) {
      // vendored 代码只作为整体模块列出，让 R-B10 抑制
    }
    candidates.push({ symbol: path.basename(file), file, line: 1, type: 'module', kind: category })
    const info = model.js.get(file)
    if (!info) continue
    const declared = new Set()
    for (const declaration of info.declarations) {
      if (declaration.isRequire) continue
      declared.add(declaration.name)
      candidates.push({ symbol: declaration.name, file, line: declaration.line, type: declaration.kind, kind: 'declaration' })
    }
    for (const exported of info.exports) {
      candidates.push({ symbol: exported.name, file, line: exported.line, type: 'export', kind: exported.viaInternals ? '_internals' : 'module.exports' })
    }
    for (const method of info.methods) {
      candidates.push({ symbol: method.name, file, line: method.line, type: 'method', kind: method.container })
    }
  }
  const scripts = model.packageJson.scripts || {}
  for (const name of Object.keys(scripts)) candidates.push({ symbol: name, file: 'package.json', line: 0, type: 'npm-script', kind: 'scripts' })
  for (const section of ['dependencies', 'devDependencies']) {
    for (const name of Object.keys(model.packageJson[section] || {})) candidates.push({ symbol: name, file: 'package.json', line: 0, type: 'dependency', kind: section })
  }
  return candidates
}

function npmScriptReferences (model, name) {
  const refs = []
  for (const [file, source] of model.sources) {
    if (file === 'package.json') {
      // 其他 script 里的 `npm run name`
      for (const [scriptName, command] of Object.entries(model.packageJson.scripts || {})) {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        // `npm run x`；`test` 还可以写成 `npm test`（A2：check 链里就是这样调用的）。
        const pattern = name === 'test' ? /npm (?:run )?test(?![\w:-])/ : new RegExp(`npm run ${escaped}(?![\\w:-])`)
        if (scriptName !== name && pattern.test(command)) refs.push({ kind: 'package-json', from: `package.json#${scriptName}`, line: 0 })
      }
      continue
    }
    const spawnForm = `['run', '${name}']`
    if (source.includes(spawnForm)) {
      refs.push({ kind: 'script-text', from: file, line: textMentions(source, spawnForm)[0] || 0, note: 'spawn npm run' })
      continue
    }
    const needle = name === 'test' && !source.includes('npm run test') ? 'npm test' : `npm run ${name}`
    const lines = textMentions(source, needle).filter(line => {
      const text = source.split('\n')[line - 1] || ''
      const after = text.slice(text.indexOf(needle) + needle.length)
      return !/^[\w:-]/.test(after)
    })
    if (!lines.length) continue
    const category = model.categories.get(file)
    refs.push({ kind: file.startsWith('.github/') ? 'workflow' : category === 'doc' || file === 'README.md' ? 'doc' : category === 'script' || file.endsWith('.sh') ? 'script-text' : 'text', from: file, line: lines[0] })
  }
  return refs
}

function dependencyReferences (model, name) {
  const refs = []
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const requireRegex = new RegExp(`require\\((?:'|")${escaped}(?:/|'|")`)
  for (const [file, source] of model.sources) {
    if (file === 'package.json' || file === 'package-lock.json') continue
    const literalName = source.includes(`'${name}'`) || source.includes(`"${name}"`)
    if (requireRegex.test(source) || source.includes(`from '${name}`) || source.includes(`node_modules/${name}`) || source.includes(`'${name}/`) || (literalName && model.categories.get(file) === 'script')) {
      const category = model.categories.get(file)
      const scriptIsRun = category === 'script' && fileReferences(model, file).some(r => r.kind === 'package-json' || r.kind === 'workflow')
      refs.push({ kind: category === 'test' ? 'test' : category === 'script' ? (scriptIsRun ? 'build-script' : 'script') : 'import', from: file, line: textMentions(source, name)[0] || 0 })
    }
  }
  for (const workflow of model.workflows) if ((model.sources.get(workflow) || '').includes(name)) refs.push({ kind: 'workflow', from: workflow, line: 0 })
  if ((model.sources.get('Dockerfile') || '').includes(name)) refs.push({ kind: 'text', from: 'Dockerfile', line: 0 })
  return refs
}

function scoreCandidate (candidate, refs, rules) {
  // 基线：没有任何引用 = 10；每类引用把信心往下压。
  const kinds = new Set(refs.map(r => r.kind))
  const strong = ['require', 'import', 'using-components', 'asset-path', 'generated-by', 'app-json-page', 'app-json-subpackage', 'app-json-sitemap', 'package-json', 'workflow', 'wxml', 'local-identifier', 'build-script']
  if (candidate.type === 'module' && candidate.kind === 'doc' && kinds.has('readme')) strong.push('readme')
  if (candidate.type === 'module' && candidate.kind === 'runtime' && kinds.has('app-json-subpackage-root') && !refs.some(r => strong.includes(r.kind))) {
    // 分包目录里的文件：只被 root 覆盖不算引用
  }
  let confidence = 10
  if ([...kinds].some(kind => strong.includes(kind))) confidence = 1
  else if (kinds.has('test') || kinds.has('script') || kinds.has('test-text') || kinds.has('script-text')) confidence = 5
  else if (kinds.has('profile-evidence') || kinds.has('profile')) confidence = 6
  else if (kinds.has('doc') || kinds.has('fixture-readme')) confidence = 8
  else if (kinds.has('name-match') || kinds.has('text') || kinds.has('local-property')) confidence = 7
  let suppressed = false
  const applied = []
  for (const rule of rules) {
    if (rule.suppress) suppressed = true
    if (typeof rule.cap === 'number') confidence = Math.min(confidence, rule.cap)
    applied.push(rule.id)
  }
  return { confidence: Math.max(1, Math.min(10, confidence)), suppressed, applied }
}

function evaluate (model, candidate) {
  const category = model.categories.get(candidate.file) || 'root'
  let refs
  if (candidate.type === 'module') refs = fileReferences(model, candidate.file)
  else if (candidate.type === 'npm-script') refs = npmScriptReferences(model, candidate.symbol)
  else if (candidate.type === 'dependency') refs = dependencyReferences(model, candidate.symbol)
  else refs = symbolReferences(model, candidate.file, candidate)
  const ctx = { refs, category }
  const rules = []
  for (const rule of RULES) {
    const outcome = rule.apply(candidate, ctx)
    if (outcome) rules.push({ id: rule.id, ...outcome })
  }
  const score = scoreCandidate(candidate, refs, rules)
  const basis = refs.length
    ? `引用：${[...new Set(refs.map(r => r.kind))].join('、')}`
    : '全仓无任何文本引用（标识符、路径、文档、配置均未出现）'
  return {
    symbol: candidate.symbol,
    file: candidate.file,
    line: candidate.line,
    type: candidate.type,
    kind: candidate.kind,
    confidence: score.confidence,
    basis: rules.length ? `${basis}；规则：${rules.map(r => `${r.id}(${r.note})`).join('；')}` : basis,
    rules: rules.map(r => r.id),
    refKinds: [...new Set(refs.map(r => r.kind))].sort(),
    sampleRefs: refs.slice(0, 5).map(r => `${r.from}${r.line ? ':' + r.line : ''}${r.note ? ' ' + r.note : ''}`),
    suppressed: score.suppressed,
    used: refs.length > 0 && score.confidence <= 1
  }
}

function scan (options = {}) {
  const model = buildModel(options.root || projectRoot)
  const candidates = collectCandidates(model)
  const results = candidates.map(candidate => evaluate(model, candidate))
  const emitted = results.filter(result => !result.used && (options.reportSuppressed || !result.suppressed))
  // 按码元比较排序，不用 localeCompare，避免不同机器 locale 造成顺序差异。
  const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
  emitted.sort((a, b) => compare(a.file, b.file) || (a.line - b.line) || compare(a.symbol, b.symbol) || compare(a.type, b.type))
  return { model, results, emitted }
}

function formatLine (result) {
  const { suppressed, used, ...row } = result
  return JSON.stringify(row)
}

function main (argv = process.argv.slice(2)) {
  const option = (name, fallback) => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : fallback }
  if (argv.includes('--list-rules')) {
    for (const rule of RULES) console.log(`${rule.id}\t${rule.patterns.join(',')}\t${rule.description}`)
    const covered = new Set(RULES.flatMap(rule => rule.patterns))
    const missing = ALL_PATTERNS.filter(id => !covered.has(id))
    console.log(`patterns covered: ${ALL_PATTERNS.length - missing.length}/${ALL_PATTERNS.length}${missing.length ? ` missing: ${missing.join(',')}` : ''}`)
    return
  }
  const minConfidence = Number(option('--min-confidence', 1))
  const types = option('--types', '') ? new Set(option('--types', '').split(',')) : null
  const explain = option('--explain', '')
  const reportUsed = argv.includes('--report-used')
  const { results, emitted } = scan({ reportSuppressed: Boolean(explain) || reportUsed })
  if (explain) {
    const [file, symbol] = explain.split(':')
    const hits = results.filter(result => result.file === file && (!symbol || result.symbol === symbol))
    console.log(JSON.stringify(hits, null, 2))
    return
  }
  const rows = (reportUsed ? results.filter(r => r.used || r.suppressed) : emitted).filter(result => result.confidence >= minConfidence && (!types || types.has(result.type)))
  const out = option('--out', '')
  const text = rows.map(formatLine).join('\n') + (rows.length ? '\n' : '')
  if (out) fs.writeFileSync(path.resolve(projectRoot, out), text)
  else process.stdout.write(text)
  const summary = { scannerVersion: SCANNER_VERSION, files: results.filter(r => r.type === 'module').length, symbols: results.length, emitted: rows.length, out: out || null }
  process.stderr.write(JSON.stringify(summary) + '\n')
}

if (require.main === module) main()

module.exports = { ALL_PATTERNS, RULES, SCANNER_VERSION, analyzeJs, buildModel, categoryOf, evaluate, indexText, scan }
