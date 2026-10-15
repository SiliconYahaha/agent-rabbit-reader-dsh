# html-reader 死代码清理 · 动态引用模式清单（A/B/C）

本清单是 `scripts/scan-dead-code.js` 白名单规则的依据：每条规则的 `patterns` 字段引用这里的编号。
盘点日期 2026-09-02，基于分支 `agent/file-reader-module-glass-easel`。三组：A 构建/入口/注册侧、B 运行时侧、C 测试/脚本/夹具/文档侧。
运行 `npm run scan:dead-code` 生成 `candidates.jsonl`；`node scripts/scan-dead-code.js --list-rules` 查看规则与覆盖。

## Context

用户要清理 html-reader 里的冗余代码。清理前必须先弄清哪些引用是 `require` 图看不见的，否则扫描器会把活代码报成死代码。本步骤只做盘点；用户确认后再写扫描脚本（JSONL 输出，每种模式一条带注释的白名单规则）。

---

## A. 构建 / 入口 / 注册侧（配置字符串把文件拉活）

| # | 模式 | 机制 | 例证 | 保护对象 |
|---|---|---|---|---|
| A1 | npm script 名 → 脚本文件路径 | `package.json` `scripts` 值是 `node scripts/x.js` 字符串；且脚本名≠文件名 | `package.json:6-53`；`verify:canvas-budget`→`verify-canvas-live-budget.js`、`verify:archive-native`→`verify-archive-native-listing.js`、`verify:image-data`→`verify-image-data-identity.js` 等 10 对 | 所有 `scripts/*` 入口 |
| A2 | npm script 链 | `check` 串 9 个脚本；`verify:chrome-oracle` 一行串 11 个；`test` 用 glob `tests/*.test.js` | `package.json:18,52,53` | `generate:coverage`、`vendor:*`、`smoke:*` 只经 `check` 可达 |
| A3 | 工作流 YAML → npm script 名 | `run: npm run X` | `.github/workflows/ci.yml:36-97`（13 个）、`wechat-upload.yml:48-90`（`npm ci --prefix tools/wechat-ci`、`release:wechat:ci`、`outputs/wechat-ci/*.json`） | CI 门禁脚本 |
| A4 | Shell/Node 再调 npm script | `scripts/verify-release.sh:4-10`；`scripts/wechat-release.js:88-96,155` 用 `spawn('npm',['run',…])` | 同上 | `verify:originals/reported/simulator` |
| A5 | Dockerfile/compose 直接引文件 | `Dockerfile:8,24` `COPY server`、`CMD node server/index.js`（绕过 `start:fidelity`）；`deploy/compose.yaml:3`、`Caddyfile:9` | | `server/index.js`、`busboy`、`unzipper` |
| A6 | `app.json` `pages[]` | 一个字符串 = 4 个文件（js/json/wxml/wxss），无 require | `miniprogram/app.json:2-6` | 三个页面 |
| A7 | `app.json` `subPackages[].root/pages` + `require.async` | 分包根路径字符串；JS 侧唯一入口是 `require.async('../../sevenzip/runtime/index.js')` | `app.json:7-15`；`file-reader/engine/components/reader/reader.js:76-77` | `sevenzip/runtime/{index,7zz,native-listing}.js`、`7zz.wasm.br` |
| A8 | `supportedMaterials[].path` | 聊天文件入口页路径字符串，9 条全指 `pages/index/index` | `app.json:23-77`；门禁 `scripts/check-production-config.js:9-19,95` | `pages/index` |
| A9 | `sitemapLocation`、`lazyCodeLoading` | `app.json:79,81` → `sitemap.json`；`requiredComponents` 让可达性完全依赖 `usingComponents` | | |
| A10 | `project.config.json` `miniprogramRoot` / `packOptions.ignore` | 忽略清单用字符串路径：`file-reader/package.json`、`file-reader/README.md` | `project.config.json:4,14-24` | （npm 回退后 package.json 将删除） |
| A11 | `usingComponents` 映射 | 页面/组件 JSON 里的路径字符串，含**自递归** `node.json:1` `"node":"./node"` | `pages/index/index.json:6`、`file-preview.json:6`、`reader.json:4-5`、`mp-html/index.json:1`、`mp-html/node/node.json:1` | 所有组件 JS |
| A12 | `componentFramework`/`glassEaselWebview` | 页面 JSON 开关，门禁 `check-production-config.js:171-175` | 4 个页面 JSON | |
| A13 | WXML/WXSS 里的资源路径 | `src="/assets/..."` 字符串 | `pages/home/home.wxml:3,8,19,20,32`、`utils/share.js:5` | `assets/brand-hero-sketch-transparent.png`、4 个 svg。**无引用**：`assets/brand-hero-sketch.jpg`、`assets/brand-logo.png`（历史分享图，现已停用） |
| A14 | WXML `bind*/catch*` 事件名 → 方法名字符串 | 30 个 handler 在 `reader.wxml` → `reader.js methods:`；home/index/file-preview/design-preview 各自 2-5 个 | `reader.wxml` 与 `reader.js:649-2443` 对照表；`home.wxml:7,19,20,26,27` | 所有事件方法 |
| A15 | **生成的** WXML 绑定另一文件的方法 | `dom-tree.wxml` 由 `scripts/gen-dom-tree-wxml.js:12,24-35` 的字符串字面量生成，14 个 `onDom*` handler 落在 `reader.js` | `dom-tree.wxml:21`；`tests/package-quality.test.js:50-57` 断言这些名字 | `onDomTap/stopDomTap/onDomInput/onDomChanging/onDomChange/onDomChoiceChange/onDomPickerChange/onDomSelect/onDomMediaError/onDomMediaLoad/onDomTouch*` |
| A16 | 自定义组件 `bind*` = `triggerEvent` 名 | `bindload/binderror/bindlinktap` 来自 mp-html 的 `triggerEvent('load'/'error'/'linktap')`；`catchadd="_add"` 来自 node.js `triggerEvent("add")` | `reader.wxml:126-128`；`mp-html/index.wxml:1`、`index.js:9` | `onRenderLoad/onRenderError/onLinkTap/_add`；reader 的 `emit('ready'/'error'/'handoff')` |
| A17 | `<import src>` + `<template is="dnN">` 递归 | 只有 `dn0` 从 reader.wxml 进入，`dn1..dn20` 仅由字符串 `is=` 可达；mp-html `node.wxml` 同理 `el`/`n1..n5` | `reader.wxml:1,111`；`dom-tree.wxml:18`；`gen-dom-tree-wxml.js:6` | 21 个模板 |
| A18 | `<wxs module>` 内联脚本 | `mp-html/node/node.wxml:1` `isInline` | | |
| A19 | WXML 消费、JS 里"看不见"的数据字段 | 条目对象字段在 JS 中只以对象构造出现：`actionable/active/directory/displayName/indentRpx`（0 次）、`tagStyle` 仅 `reader.js:239` 声明 + `reader.wxml:125` 消费；dom-tree 消费 `n.nid/tapNid/styleId/touch/imageMode/inputType/options/selectedIndex/displayText/percent/canvasStyle/canvasBoxStyle` | | 这些字段名 |
| A20 | `createSelectorQuery`/`selectComponent` 选择器字符串 | `'#reader'`（`pages/index/index.js:38`）、`'#step-model-canvas'`（`reader.js:1260`）、`.dom-node`（`:2117`）、`.dom-render-frame`（`:2133`）、模板串 `#dom-canvas-${nid}`/`#dom-nid-${nid}`（`:2313,:2423`）；`'#preview'` 只被 `scripts/verify-wechat-simulator.js:551` 用 | | 对应 id/class |
| A21 | `open-type="share"` 与微信菜单触发的生命周期 | `home.wxml:23` 触发 `onShareAppMessage`；index/file-preview 的两个分享回调**无任何 WXML 触发**，由微信菜单调用；门禁 `check-production-config.js:178-182` | | 6 个分享回调 |
| A22 | CLI argv 子命令 | `wechat-release.js:131-148` `process.argv[2]` `inspect/verify/upload`，`:127-129` `optionValue('--desc')`；`wechat-ci-upload.js:168-175`；`build-sevenzip-native.js:18-20` `--package-built` | | 导出仅供 `tests/wechat-release.test.js:7` |
| A23 | 计算路径 require / 深路径 require | `wechat-ci-upload.js:108` `require(path.join(projectRoot,'tools/wechat-ci/node_modules/miniprogram-ci'))`；`miniprogram-automator-compat.js:34` `require('miniprogram-automator/out/MiniProgram')`、`:4` `/package.json` | | `tools/wechat-ci` 依赖岛 |
| A24 | 第三方原型打补丁 + `Symbol.for` 幂等标记 | `miniprogram-automator-compat.js:6,33-38` `Symbol.for('html-reader.miniprogram-automator.check-version')`；调用方只写裸语句 `installAutomatorVersionCompatibility()`（9 处） | | 该模块及其副作用 |
| A25 | 环境变量驱动的分支 | `WECHAT_CI_*`（`wechat-upload.yml:78-82`）、`emcc --version` 探测（`build-sevenzip-native.js:15`）、`HTML_READER_CHROME`、`*_SCREENSHOT_DIR`、`PSD_REAL_SAMPLE_DIR`/`PSD_ZIP_SAMPLE_DIR`/`CDR_REAL_SAMPLE_DIR`（`verify-wechat-simulator.js:2202,2210,2807`）等 20 余个 | | 默认运行永不执行的块 |
| A26 | 生成脚本**写**受控文件（反向边） | `vendor-sval.js:7-8,76`；`vendor-format-runtime.js:9-10,144-149`（12 组目标）；`vendor-html-entities.js:23,27`；`generate-sample.js:7-8,34`（**目标也是输入**，`:12-13`）；`gen-dom-tree-wxml.js:7,46`；`gen-reader-coverage.mjs:8,79` | | 生成物；生成器本身无人 require |
| A27 | 清单哈希校验反向边 | `vendor-format-runtime.js:129-138` 读 `tools/sevenzip-native/manifest.json` 校验 `7zz.js/7zz.wasm.br/native-listing.js` 与两个 `.patch`；`build-sevenzip-native.js:27,42` 按文件名应用补丁并写清单 | | `build-sevenzip-native.js`、`tools/sevenzip-native/*` |
| A28 | 依赖的非 import 用法 | `sval/marked/node-unrar-js/7z-wasm` 只被 vendor 脚本从 `node_modules` 读文件（`vendor-format-runtime.js:25-27` `require.resolve(\`${pkg}/package.json\`)`）；`mp-html` 是 prod 依赖但只被 `tests/html-compat.test.js:62,88,136,158` 当差分基准；`licia/cmpVersion` **未声明**、靠 `miniprogram-automator` 传递（`miniprogram-automator-compat.js:3`）；`overrides` 里 `minimist/phin` 源码零出现 | `package.json:59-69` | 依赖清理需按此分类 |
| A29 | 函数体内的延迟 require | `core/inline-image-store.js:133`、`core/xhtml-document.js:14`、`html-script-runtime.js:748`、`html-dom-shim.js:707,874,1349`、`reader.js:1829`；脚本侧 `verify-wechat-simulator.js:121,1162,1743,1744,1792,1821-22,1860,2203-2227` 等 | | `canvas-png/css-computed-style/xhtml-document/html-script-runtime` 对顶部扫描不可见 |
| A30 | `new Function` 手写 CommonJS 加载器（Chrome 对照） | `scripts/verify-inline-poster.js:12-26` `bundle()`：regex 扫 `require('./…')` 建 `moduleSources` 字符串键表，浏览器里 `window.readerRequire('miniprogram/file-reader/…/reader.js')` | 消费者：`verify-canvas-{source,reset,readback,live-budget}.js`、`verify-visible-canvas.js`、`verify-image-decode.js` | `bundle` 导出、`chrome-test-result.js`、被 regex 拉入的 `.json` 数据模块 |
| A31 | 分包族的内核注入 | 微信里分包之间只能 `require.async`：`engine/core/families.js` 取到族入口后调用 `attach(kernel)`，把 `engine/core/kernel-exports.js` 的模块塞进族的 `kernel.js`；族内文件写 `const { a } = require('./kernel').key` 解构，内核模块的导出因此在仓库里没有字面量 require 指向它们 | `document/kernel.js`、`archive/kernel.js`、`archive/rar-links.js:3-5`、`document/html-runtime/html-script-runtime.js:106` | `kernel-exports` 的键、`*/index.js` 的 `attach`、`*/api.js` 的整个导出面、被解构的内核函数（`crc32`、`decodeText`、`buildArchiveTree`…） |

**A 组里"零引用"的原始观察（不是结论）**：`scripts/chrome-test-result.js`（被 6 个脚本 require，但无 npm/doc 引用）、`scripts/verify-release.sh`（零引用，唯一调用 docker build 的地方）、`start:fidelity` 与 3 个 `verify:7z-*:wechat` npm script 无外部调用、`deploy/README.md:26` 指向不存在的 `miniprogram/config/fidelity.js`。

## C. 测试 / 脚本 / 夹具 / 文档侧（名字与文本把文件拉活）

| # | 模式 | 机制 | 例证 | 保护对象 |
|---|---|---|---|---|
| C1 | 全局注册器捕获 + `require.resolve` + 清缓存 | 页面/组件文件不导出定义，测试临时装 `global.Page/Component/App` 再 require 字符串路径 | `tests/helpers/reader-host.js:10-13,30-38,131-137`；`home-page.test.js:12,19`；`material-path-route.test.js:15-16`；`chat-material.test.js:10-11`；`scripts/verify-interactive-poster-file-route.js:49-59` | `pages/*/*.js`、`app.js`、`reader.js`、`design-preview.js`、`_internals` 导出、实例上的全部方法 |
| C2 | 历史别名 re-export | `tests/helpers/reader-page.js:5-7` 7 行转发，10 个消费者 | | |
| C3 | 测试体内延迟 require 帮助模块 | `page-state.test.js:18,1080,1195` | 34 个 helper 全有消费者；`canvas-live-budget.js`、`image-public-harness.js` **只被脚本**用 | |
| C4 | **跨文件按名抓常量**（regex 读测试源码） | `scripts/verify-wechat-simulator.js:37-70` 读 `tests/rar-runtime.test.js`、`tests/7z-runtime.test.js` 文本匹配 `const NAME = Buffer.from('…', 'base64')`；`zipCompatibilityFixtureBase64(name)` 动态 RegExp；**测试→测试**：`tests/archive-identity.test.js:178-180`（regex 拼写不同） | 常量：`COMPRESSED_RAR`(rar-runtime:13)、`HEADER_ENCRYPTED_RAR`(:16)、`LZMA2_7Z`(7z-runtime:14)、`ENCRYPTED_7Z`(:15)、`AES_ZIP`(:16)、`BZIP2_ZIP`(:17) | 常量名、单引号 base64 字面量格式、两个测试文件名 |
| C5 | 测试把生产源码当文本断言 | `page-state.test.js:524,1718-1721`；`reader-stability.test.js:59`；`file-preview-page.test.js:424-426`；`home-page.test.js:69,87,88`；`chat-material.test.js:21`；`package-quality.test.js:20-27,44-45,66,74`；`production-config.test.js:38-43`；`format-capabilities.test.js:59-64`（`docs/format-capability-audit.md` 必须含 `` `ext` `` 与 `7 + 14 + 27 + 4 + 1 = 53`）；`wechat-ci.test.js:59-84`（README 必含三段文字）；`css-*.test.js` SHA 映射；`wechat-release.test.js:29-33` 子进程 | | 被读文件的路径与字面量 |
| C6 | `vm.runInNewContext` + 手写 `require(id)` 字符串分发 | `tests/archive-selection.test.js:32-42`（id：`../../shared/module-root`、`archive-members`、`file-inspector`、`rar-links`、`zip-engine-bridge`、`zip-links`、`./native-listing`、`./7zz`）；`archive-identity.test.js:149-158`；`archive-native-listing.test.js:156-168`（断言私有字段 `_rabbit_reader_listing_version`、回调 `rabbitOnListing`）；`computed-style.test.js:13-20`（断言 require id 必须 `.js` 结尾）；`bounded-zlib.test.js:77`、`zip-integrity.test.js:59`（按字符串取 `module.exports.inflateZlibBounded/inflateRawBounded`）；`package-quality.test.js:75-77` | | `sevenzip/runtime/*`、`core/bounded-zlib.js`、`css-computed-style.js`、`vendor/jpeg-encoder.js` 及其**内部相对 id** |
| C7 | 夹具目录由 JSON 清单按文件名索引 | `samples.json`（rtf-alternatives/rtf-tables/zip-integrity/zip-local-identity）、`wpt.json`、`wpt-images.json`、`base64.json`、`entities.json`；测试按名查：`page-state.test.js:701` `.find(c=>c.name==='libreoffice-nested.rtf')`、`:1138`、`:1236` | 17 个夹具目录清单见代理报告 | 二进制夹具；无测试消费者的目录：`canvas-live-budget`、`inline-cache-recovery`、`visible-canvas`、`canvas-readback/reset/source`（只被脚本用） |
| C8 | 夹具 README/LICENSE 被 SHA 钉住或被 prose 引用 | `css-variables.test.js:15`、`css-structure.test.js:34`、`css-escapes.test.js:62` 把 `LICENSE.md` 放进 SHA 表；夹具 README 点名脚本/测试/profile | | 许可证文件 |
| C9 | `compatibility/profiles/*.json` `evidence[]` 裸字符串引用脚本/测试/夹具 | 60 个脚本名、~50 个测试名；`tests/compatibility-profiles.test.js:14` 只校验形状、目录扫描发现 | `7z.json:42`、`html.json:15`、`cdr.json:13` | ~15 个无 npm script 的 `scripts/verify-*.js`；`verify-inline-cache-lifecycle-wechat.js` 全仓唯一引用在此 |
| C10 | profile JSON 作为运行数据按文件名取样本 | `verify-wechat-simulator.js:2203,2213,2808`；`verify-cdr-references.js:13`；`verify-psd-references.js:14`；`verify-rar-link-references.js:12`；**Python** `scripts/psd-zip-variants.py:18` | | |
| C11 | NOTICE/README 的许可义务点名文件 | `compatibility/NOTICE.md:3` 点名 `tests/file-inspector.test.js`、`scripts/verify-wechat-simulator.js:72-74` 内联 base64、`legacy-cjk-data.js`、`LICENSE-ICONV-LITE`（路径已过期指向 `utils/vendor`） | | |
| C12 | 生成文档被测试字节级钉住 | `production-config.test.js:37-43` 子进程跑 `gen-reader-coverage.mjs`（argv 字符串）并要求 `docs/reader-coverage.md` 不变、`COVERAGE.md` 不存在 | | |
| C14 | 非 JS 工具链靠 `execFileSync` 文件名字符串 | `verify-psd-references.js:21,23`（`psd-reference-oracle.py`、`psd-imageio-oracle.swift`）；`verify-psd-zip-references.js:14-16`（`psd-zip-variants.py`） | | 3 个 py/swift |
| C15 | `.gitattributes` 字节钉住 | 根 `.gitattributes`（5 条）+ 3 个夹具目录内 `.gitattributes`；只被 git 与 `git diff --check` 消费 | | |
| C16 | 开发版专用方法只被自动化按名调用 | `isDevelopmentBuild()` 门（`reader.js:67-72`）：`readMaterial`(:1696)、`readSvgMaterial`(:1706)、`startRarRuntimeProbeForDevelopment`(:1717)+`_rarRuntimeProbe`、`startSevenZipRuntimeProbeForDevelopment`(:1754)+`_sevenZipRuntimeProbe`、`getReaderDiagnostics`(:1782)；调用点 `verify-wechat-simulator.js:608,631,634,701,901,909,922,930`；两分支由 `page-state.test.js:273-311` 钉住 | | |
| C17 | `evaluate`/`callMethod` 里的方法名字符串 | `reLaunchWhenReady(…, 'loadPsd'/'loadAi')`（`verify-wechat-simulator.js:527,554-556,2041-2360`）；`callMethod('openSelectedFile')`（`verify-canvas-budget-wechat.js:47`）；`openSelectedFile` 在 ~30 处 evaluate 闭包里；私有字段 `_htmlRuntime/_nid/_staticHtmlFallback/_htmlAssets` 跨桥访问；脚本自建的 `getApp()._inlineLifecycleQa/_cacheRecoveryQa*` | | `design-preview.js:101,180`；reader 公共方法 |
| C18 | 其他零引用的受控文件（原始观察） | `design-qa.md`、`docs/assets/brand-mark-sketch.jpg`、`docs/design-system.html`（仅 README:145）、`outputs/README.md`（`.gitignore` 反向白名单）、`html-css-js-local-test.html`（generate-sample 唯一输入）、`.dockerignore` | | |

## B. 运行时侧（`miniprogram/file-reader/`，用户网页脚本与微信框架按名调用）

| # | 模式 | 机制 | 例证 | 保护对象 |
|---|---|---|---|---|
| B1 | **沙盒全局白名单对象**交给解释器 | 对象字面量 spread 后 `interpreter.import(globals)`，用户 HTML 脚本按名解析；仓库内无任何调用点 | `core/html-runtime/html-script-runtime.js:462-519`（`createStandardGlobals`：Object/Reflect/eval/Array…/Intl）、`:728-760`（`window` 面：document/navigator/location/history/localStorage/…/fetch/XMLHttpRequest/WebSocket/MutationObserver/…/`__htmlReaderRenderReactRoot`）、`:782-790` 交接 | `MemoryStorage`(:174)、`ShimURLSearchParams`(:184)、`ShimURL`(:209)、`ShimBlob/ShimFile`(:245-263)、`ShimFileReader`(:265)、`ShimFormData`(:281)、`createAbortController`(:302)、`createIntlCompat` 与 7 个 `*Fallback` 类(:379-460)、`XMLHttpRequest`(:650)、`WebSocket`(:660)、`DOMParser`(:668)、`NoopObserver`(:681)、`navigator.*`(:686)、`crypto.*`(:692)、`history.*`(:703)、`createLocation`(`html-dom-shim.js:1629-1645`)、`utf8Encode/utf8Decode/btoaSafe/atobSafe/bytesToBase64`(:106-172) |
| B2 | 安全 Object/Reflect 由**名字数组**装配 | `passthrough.forEach(name => SandboxObject[name] = …Object[name]…)` | `html-script-runtime.js:340-347`；`createSafeReflect` `:362-377`；`safePrototypeView` `:318-338` 用 `Reflect.ownKeys` 重建原型链 | `createSafeObjectConstructor/createSafeReflect/assertSafeMetaProperty/BLOCKED_META_PROPERTIES/safePrototypeView` |
| B3 | 类成员只作为 DOM API 被用户脚本调用 | ES class 的 getter/setter/方法在仓库内无调用 | `html-dom-shim.js:210-341` `ShimNode`（~20 成员）、`:441-726` `ShimElement`（~55 访问器 + ~24 方法）、`:728-750` `ShimImageElement`、`:752-828` `ShimDocument`（含运行时挂的 `forms.namedItem` `:791-795`、`defineProperty` 的 `title/cookie` `:785-786`）、`:187-208` `ShimEvent/ShimCustomEvent`、`:343-365` `ShimText/ShimComment/ShimFragment`；`:144-152` `Image.prototype` 用 `defineProperty` 接到 `ShimImageElement.prototype` | 这些类的全部成员 |
| B4 | Proxy 属性包 | `get/set/deleteProperty/ownKeys` 陷阱把任意属性名转为属性/状态写入，名字从不出现为字面量 | `html-dom-shim.js:367-406` `createStyleProxy`、`:408-419` `createDatasetProxy`、`:421-439` `createClassList`、`:1029-1032` canvas 2D 状态 Proxy（`set:${name}` 记录） | `camelToKebab/kebabToCamel/parseStyleText/styleText/propertyKey` |
| B5 | `eval`/`Function`/字符串定时器/内联事件属性 | `Function` 为抛错桩，`eval` 回入解释器；`setTimeout('…')` 走同一评估器；`on*` 属性被拼成源码字符串执行 | `html-script-runtime.js:713-715, 580-607`（`exports['__htmlReaderEval<N>']` 按名写读）、`:616,629`、`:792-811`（`_inlineHandlers[...]=function(event){…}`）；`core/image-script-budget.js:8-42` 预解析预算（`:846` 调用） | `evaluateSandboxSource/installInlineEventHandlers/parseImageScript/_inlineHandlers` |
| B6 | AST 改写引入无声明的标识符 | `Literal` 节点里塞宿主函数；`createRoot(x).render(y)` 改写成 `__htmlReaderRenderReactRoot(...)` | `html-script-runtime.js:37-72`（`consumeExecutionStep` `:576-578` 无文本调用点）、`:81-104` | `instrumentExecutionGuards/transformReactRootCalls/consumeExecutionStep` |
| B7 | React hook 分发器装进 React 内部字段 | `React.__SECRET_INTERNALS…ReactCurrentDispatcher.current = dispatcherFor(...)`，用户 React 代码按名调用 | `core/html-runtime/react-compat-runtime.js:124-155`（16 个 hook）、`:158-164`；`:3` `EVENT_NAME_ALIASES` | 全部 hook、`dispatcherFor/withDispatcher/assignRef/appendReactValue` |
| B8 | vendored 解释器 `sval` | 176 KB UMD，`scripts/vendor-sval.js:11-18` 精确替换补丁；只用 `new Sval/.import/.parse/.run/.exports` | `html-script-runtime.js:3,586-601,786-789,801-810,846-849` | 整个 `core/html-runtime/vendor/` |
| B9 | **Canvas 操作按名录制→按名回放** | 录 `{name,args}`，回放 `context[name](...args)`；两端都不写方法名字面量 | `html-dom-shim.js:949`（方法名表）、`:1002-1028`；`core/canvas-presenter.js:7-8`（`METHODS`/`PROPERTIES` 字符串集）、`:105-131`（`resetCanvas/createGradient/gradientColorStop/set:/drawImage/putImageData` 特判，`:130` 通用）；WebGL：`html-dom-shim.js:1058-1072`（转发任意 `gl[name]`，`/^(?:check|get|is|read)/` 判脏）、`:1106-1107`（桩名单 `webgl:${name}`）；`core/canvas-png.js:20-30` 只被内联 require 到达 | `createCanvas2dContext/recordCanvasOp/appendCanvasOp/normalizeCanvasArgument/createCanvasGradient/markCanvasRevision/resetCanvasDimension/snapshotCanvasSource/canvasStateForElement/encodeCanvasPng` 及全部 2D/WebGL 名字 |
| B10 | mp-html 插件钩子按名调用 | `this.plugins[t][e]()`，钩子名 `onLoad/onDetached/onParse/onUpdate/onText` | `components/mp-html/index.js:8-9`；`parser.js:1`；`style-plugin.js:9` `Style.prototype.onParse`（无人按名调用） | `Style.prototype.onParse`、`match()`(:51)、`style-parser.js` |
| B11 | MIME/别名/错误码/控制字查表 | 对象字面量按运行时键索引 | `reader.js:48-58` `DOCUMENT_TYPE_BY_MIME`（`:502` 消费）、`:495` `typeAliases`、`:697-703` `known[code]`；`core/media-inspector.js:6,116`；`core/rtf-reader.js:10-12` `WORD_TEXT/SYMBOL_TEXT/CHARSETS`；`file-inspector.js:21` `DWG_VERSIONS`；`design-file.js:7` `PSD_COLOR_MODES`；`document-renderer.js:30/39/55` SVG 大小写表；`html-dom-shim.js:16` `IMPLICIT_CLOSE_ON_OPEN`；`css-computed-style.js:6` `INITIAL`；`rar-runtime.js:12` `LEGACY_ENCODING_LABELS` | 表内所有键 |
| B12 | `register([...])` 能力注册表 + 反射审计 | 17 次 `register()` 按扩展名字符串填表；`capabilityAudit()` 用 `Object.keys` 反射；测试再与 `docs/format-capability-audit.md` 对账 | `core/format-capabilities.js:7-14,16-108,114-126`；消费 `file-reader/index.js:10,35,38`、`tests/format-capabilities.test.js:8,12,42,60` | `FORMAT_CAPABILITIES/register/CAPABILITY_MODES/CONTENT_LEVELS/capabilityAudit`、`file-types.js` 各 `*_EXTENSIONS` |
| B13 | 其他 `obj[variable](...)` | `hostConsole[method]`(`html-script-runtime.js:723-725`)、`_canvasContexts[name]`(`html-dom-shim.js:697`)、`fs[method]`(`core/inline-cache-lifecycle.js:10,15` 限 `mkdir/readdir/unlink`)、`this[\`on${type}\`]`(`html-script-runtime.js:664-665`) | | |
| B14 | 组件方法四分类（`reader.js` `methods:`） | (i) 只被 WXML 绑定：`toggleAudio/seekAudio/onVideo*/selectArchiveNameEncoding/onArchivePasswordInput/unlockArchive/onStepModel*/setStepModelView/previous|nextInspectorEntryPage/returnToArchiveRoot/openInspectorEntry/onStandaloneSvg*/onDom*（生成模板，`onDomTap` ×189）/onReaderTouch*/onRenderLoad/onRenderError/onLinkTap`；(ii) 生命周期/observer：`open`(observers.file :164-167)、`restoreSmilSupport`(attached :171)、`dispose`(detached :172)；design-preview：`loadMaterial`(observers :22-24)、`onImageError`、`openAiPdf`；(iii) 仅内部 ~60 个；(iv) **仅外部**：`readMaterial`(:1696)、`readSvgMaterial`(:1706)、`startRarRuntimeProbeForDevelopment`(:1717)、`startSevenZipRuntimeProbeForDevelopment`(:1754)、`getReaderDiagnostics`(:1782)（`isDevelopmentBuild()` 门 `:67-73`）、`syncPageScroll`(:2387 ← `pages/index/index.js:34`)、`onPageScroll`(:2388 ← 仅 `scripts/verify-reader-stability.js`)、**`toggleArchiveNameEncoding`(:978 ← 仅 `tests/page-state.test.js`)** | | |
| B15 | `triggerEvent` 事件名无仓库内绑定者 | `emit('ready'/'error'/'handoff')`（`reader.js:267-269,478,485,499,524`），`pages/index/index.wxml:2` 未绑定；只在 README 文档化 | | 外部宿主 API |
| B16 | 页面/App 生命周期与 Page 级导出 | `onLoad/onShow/onUnload/onPageScroll/onShareAppMessage/onShareTimeline`、`App.onShow(scene 1173)`；`home.js:102` `MAX_BATCH_FILES`、`app.js:35` `isHtmlMaterial/isSupportedMaterial`（`isHtmlMaterial` 无其他消费者）；`sevenzip/pages/runtime/runtime.js` 整个是 `Page({})`，只为声明分包存在 | | |
| B17 | core 导出面："无人引用"集合 | **全仓零引用（含自身文件）只有 `runtimeImage`**（`html-dom-shim.js:74`，导出 `:1672`）。其余只在本文件内部用、导出多余：`canvas-presenter.LIMITS`、`bounded-zlib.MAX_EMPTY_TRAILING_STREAMS`、`css-variables.parseValue/MAX_TOTAL_CHARS`、`document-renderer.encodeSvgDataUri`、`file-inspector.extractEmbeddedPreview/fnv1a32`、`file-types` 9 个 `*_EXTENSIONS`、`format-capabilities.CAPABILITY_MODES/CONTENT_LEVELS`、`html-compat.getTagStatus`、`media-query.normalizeEnvironment`、`rar-runtime.RAR_WASM_FILE`、`sevenzip.SEVEN_ZIP_WASM_FILE`、`text-decoder.decodeSingleByte/declaredEncoding`、`view-payload.DEFAULT_DOM_CHUNK_BYTES/responsiveWidthDeclarations`、`zip-links.decodeLinkTarget`、`html-dom-shim.nthMatches/styleText`、`html-script-runtime.DEFAULT_MAX_*/RECONCILE_SKIPS/instrumentExecutionGuards/transformReactRootCalls`；**但 `ShimBlob/ShimFile/ShimFormData/ShimURL/ShimURLSearchParams` 是沙盒全局（B1），不能按此归类** | | 扫描器需区分"导出多余"与"符号死亡" |
| B18 | core 导出面："只被 tests/scripts 用"集合 | `archive-volumes.archiveVolumeDescriptor`、`bounded-zlib.inflateRawBounded/MAX_OUTPUT_BYTES/MAX_BLOCKS`、`css-computed-style.colorValue`、`css-identifiers.normalizeValueIdentifiers`、`css-variables.MAX_EXPANDED_CHARS`、`document-renderer.selectorSpecificity/splitStyleDeclarations/validRenderSelector`、`file-inspector.extractZipEntry/inspectZip`、`file-types.AUDIO_EXTENSIONS/VIDEO_EXTENSIONS`、`html-compat.analyzeHtml`、`media-inspector.MEDIA_PLATFORM_SUPPORT`、`read-html-file.READ_CHUNK_BYTES`、`html-script-runtime.btoaSafe`（同时是沙盒全局）、`sevenzip.isolateZipMember/parseListing/MAX_SOLID_DECODE_BYTES/extractArchiveVolumeEntry`、`native-listing.MAX_*` | | |
| B19 | `_internals` 别名导出 | `html-compat.js:611` 26 个内部函数；`document-renderer.js:3` 以 `cssCompat.<name>` 用其中 9 个；`prepareCss/flattenResponsiveCss/stripCssResourceUrls` 只被测试用；其余 16 个只在 html-compat 内部用。**同名陷阱**：`parseAttributes`、`VOID_TAGS` 在 `html-dom-shim.js:1122,:8` 另有独立定义，`mediaQueryMatches` 在 `media-query.js` 另有导出——裸 grep 会误判 | `reader.js:2454` `_internals` 只被 `tests/helpers/reader-host.js:126` 用 | 按名计数必须按文件+作用域，不能全仓 grep |
| B20 | Emscripten 模块选项回调按名 | `sevenzip/runtime/index.js:84-86` `rabbitOnListing/rabbitOnEntry/rabbitOnField` 由生成的 `7zz.js`（原生 C 侧）调用；`:96` `engine._rabbit_reader_listing_version()`；`native-listing.js:8` `FIELD_NAMES` 来自 7z 输出文本 | | `native-listing.js` 的 `boundary/entry/field/finish` |
| B21 | 文件名/存储键/选择器契约 | `USER_DATA_PATH` 文件名（`reader.js:1161,1541,1635,1665`；`design-preview.js:123-280`）；`core/inline-cache-lifecycle.js:5-7,19` `DIRECTORY` 与 `ownedName` 正则必须同步；`reader.js:41` `'html-reader:svg-smil-support'`；id/class 见 A20 | | |
| B22 | vendored 代码实际只用极小面 | `vendor/fflate` 只用 `zlibSync`（`core/canvas-png.js:2`）；`vendor/marked` 只用 `marked`；`vendor/unrar` 只用 `createExtractorFromData`（`rar-runtime.js:6`）；`jpeg-encoder` 默认导出 3 处；编码表 `text-decoder.js:3-4`、`rtf-reader.js:4`、`rar-links.js:4`、`file-inspector.js:8`；`css-color-names`、`html-named-entities` 按键索引 | 各自 LICENSE 与生成脚本 | 整个 `core/vendor/**`、`html-runtime/vendor/**`、`components/mp-html/**`、`7zz.js`、`*.wasm.br` 必须整体白名单 |
| B23 | 资源与数据 | `assets/brand-logo.png`、`assets/brand-hero-sketch.jpg` 已无运行时引用；`data/sample-html.js` 生成物（`home.js:3` 消费）；`sitemap.json` 由 `app.json` 字符串指向 | | |

---

## D. AGI Bar 侧盘点结果（只读，仓库 `projects/agi bar 小程序/apps/miniapp`）

AGI Bar 的阅读页 `pages/document-reader/` 是 html-reader 引擎的**前身**：同名 `html-dom-shim.js`(1938 行)/`html-script-runtime.js`(1058)/`dom-tree.wxml`(生成)/`utils/document-renderer.js`(3419)，同一套 sval 沙盒。它是 `Page()`，焊死在宿主品牌组件和 `getApp().globalData` 上；格式只有 `.md/.markdown/.txt/.html/.htm/.svg/.ai`（`document-renderer.js:6-10,193-212`），其余一律报错。另有独立的 `utils/event-documents.js`（带 Bearer 鉴权下载服务端 PDF/Office/图片后交微信原生查看器，`:56-112`）。**AGI Bar 全仓没有 `componentFramework`/`glassEaselWebview`，运行旧框架 exparser，`libVersion 3.15.2`。**

### D1. AGI Bar 有、模块没有

| 能力 | AGI Bar 位置 | 归属判断 |
|---|---|---|
| Mermaid 渲染（flowchart/sequence/state/gantt 画成 SVG，其余 9 种占位卡） | `utils/mermaid-lite.js`（748 行） | **应并入模块 core**（Markdown 内容能力） |
| TeX 公式转 Unicode（`$…$`、`$$…$$`、`\[…\]`、环境、上下标） | `document-renderer.js:290-600` | **应并入模块 core** |
| Markdown 扩展：脚注、定义列表、diff 高亮代码块、任务列表原生复选框、`<details>`、front-matter | `document-renderer.js:808,927,935,948`、`.wxml:36-77` | **应并入**（模块现在用 vendored `marked` 默认集） |
| `.txt` 也走 Markdown 管线 | `:199-201` | 行为差异，需用户定：模块当前 TXT 是纯文本 `<pre>` |
| 文档元信息 `agi_bar_version`+`wx_miniapp_path` 深链横幅（13 路由白名单） | `:11-26,99-122`；`document-reader.js:1101` | 宿主逻辑；模块只需**抛 `meta` 事件**（front-matter/`<meta>` 解析结果），横幅和跳转留在 AGI Bar |
| 导航栏标题/背景色跟随文档 body 背景 | `:309,665-678` | 宿主逻辑；模块抛 `theme` 事件（body 背景色），宿主自己 `setNavigationBarColor` |
| 服务端简历 PDF 导出、`wx.shareFileMessage` 转发源文件 | `:239-287,1070` | 纯宿主功能，不进模块 |
| `<doc-view>` 可复用块级渲染组件（简历紧凑版等） | `components/doc-view/` | 待定：是否把模块的 Markdown 渲染也导出成块组件 |
| `debugText` 查询参数注入 | `:96-103` | 模块已有 `readMaterial()`（开发版）；等价 |
| 阅读/原文 tab、复制原文 | `:196-202,1057,1062` | 小功能，可并入 reader 组件 |
| `COVERAGE.md`（MDN BCD 生成）、`HANDBOOK.md`、`smoke-document-compat.mjs` 135 探针 | `pages/document-reader/`、`scripts/` | html-reader 有同源的 `docs/reader-coverage.md`、`smoke-document-compat.mjs`；需对齐探针清单 |

### D2. 模块有、AGI Bar 没有（合并后 AGI Bar 直接获得）

53 种扩展名（PDF/Office/图片原生查看、ZIP/RAR/7z 含分卷/密码/编码切换、PSD/PSB、真实 Ai 矢量、DXF/STEP/DWG/CDR、音视频、RTF、XHTML）、UTF-16/GBK/GB18030 文本解码（AGI Bar 硬编码 `utf8`，`document-reader.js:346`）、React 兼容层、mp-html 静态回退、`siblings` 分卷、WASM 分包、组件化接口、glass-easel 兼容。

### D3. 对"整合 glass-easel 支持的一切"的界定

- 模块**必须同时在两种框架下编译**（AGI Bar 是 exparser），所以只能用两边都支持的写法：经典 `Component({})`、经典 WXML。`let:`/`class:` 新语法、Chaining `Component()`、动态 slot、trait behaviors 等 glass-easel 专有特性**不能进模块**，除非 AGI Bar 也开启 glass-easel。
- html-reader 侧已完成：页面级启用、迁移清单静态核对、组件内选择器改 `this.createSelectorQuery()`。
- 因此"整合 glass-easel"的可交付物是：模块通过迁移清单 + 两种框架都能跑；不是改写成新语法。如果用户希望 AGI Bar 也启用 glass-easel，那是 AGI Bar 侧的页面 JSON 改动，需要在那边单独验证（另一会话正在处理该仓库）。

---
