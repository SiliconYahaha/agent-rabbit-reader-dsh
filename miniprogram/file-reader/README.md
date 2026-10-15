# file-reader · 小程序万能文件阅读模块

这是「兔子阅读器」把文件能力从产品界面里完整抽离出来的结果。目录自包含，不读取宿主的
`getApp()`、不做页面跳转、不改导航标题、不弹分享菜单；宿主只负责选文件、排队列、做品牌。

支持的格式和各自的能力边界见 `shared/format-capabilities.js`（54 个扩展名），
简要：HTML/XHTML（本机沙盒运行脚本）、TXT/Markdown（含 front-matter、TeX 公式、脚注、定义列表、diff 高亮、Mermaid 流程/时序/状态/甘特图）/RTF、SVG（含 SMIL 与 CSS 动画的 Canvas 播放）、图片、音视频、PDF/Office
（交微信原生查看器）、ZIP/RAR/7z（分卷、密码、包内链接、文件名编码切换）、Ai/PSD/PSB、
DXF/STEP（可旋转模型）、CDR、DWG（仅版本识别）。

## 目录

模块占主包的只有 `index.js` 与 `shared/`（约 30 KB）；内核、各文件类型族、两个 WASM 内核都在分包里，
所以主包已经贴近 2 MiB 的宿主（AGI Bar）也能接入。所有分包 root 互为兄弟，微信不允许分包嵌套。相似类型共用一个族：
网页与 Markdown/TXT/RTF 共用 `document`，ZIP/RAR/7z/TAR 共用 `archive`，位图与 SVG 共用 `image`。

```
file-reader/
├── index.js                 主包·公共入口：fileKind / isSupportedMaterial / 能力表 / configure() / describe()
├── shared/                  主包·宿主路由前就要用的纯函数（不 require 任何分包文件）
│   ├── module-root.js       WASM 内核在包内的根路径（目录名不是 file-reader 时用 configure({ root }) 改）
│   ├── file-names.js        extensionOf / formatBytes
│   ├── file-types.js        26 个官方 MIME 类别与 54 个扩展名的统一路由
│   ├── archive-volumes.js   分卷识别
│   └── format-capabilities.js  能力表与审计
├── engine/                  分包 file-reader-engine（内核，打开任何文件都要）
│   ├── pages/runtime/       分包占位页（微信要求分包至少有一个页面）
│   ├── core/                嗅探与共用解码：file-inspector、text-decoder + GBK/CJK 表、design-file、rtf-reader、
│   │                        media-inspector、text-codec、families（族加载）、kernel-exports（注入给各族）、subpackage-loader
│   └── components/
│       ├── reader/          <file-reader> 组件：分发到各族，承接媒体、设计、CAD、原生文档等轻量路径
│       └── design-preview/  <design-preview> 组件：Ai/PSD 预览（reader 内部也会内嵌它）
├── document/                分包 file-reader-document：HTML/XHTML 沙盒运行时（sval + DOM）、CSS 层叠、DOM 渲染、
│   │                        视图载荷压缩、内嵌图片缓存；Markdown / TXT / RTF 排版后也走这条链
│   ├── index.js / api.js    attach(kernel) 后暴露给内核的函数面
│   ├── kernel.js            内核注入点（微信由 attach 注入；Node 直接同步取引擎）
│   ├── html-runtime/        html-script-runtime、html-dom-shim、react-compat-runtime、vendor/sval.js
│   └── components/mp-html/  静态 HTML 回退渲染（MIT，mp-html 2.5.2）
├── archive/                 分包 file-reader-archive：ZIP / RAR / 7z 目录、成员解压、分卷、包内链接
│   ├── index.js / api.js / kernel.js
│   ├── sevenzip-runtime.js  7z 引擎侧封装；内核载荷在 sevenzip 分包按需加载
│   └── vendor/unrar/        RAR 内核（unrar.wasm.br）
├── image/                   分包 file-reader-image：SVG 的 Canvas 光栅化与动画（SMIL + CSS @keyframes）
│   ├── svg/                 xml-parser / svg-path / svg-style / svg-document / svg-animation / svg-rasterizer
│   └── components/svg-view/ <svg-view source="…"> 用 <canvas type="2d"> 播放动态 SVG，点击暂停/继续
├── skin/                    主包·宿主自有皮肤（同步不覆盖）：status / media / inspector / design 四个组件 + copy.js 文案
├── sevenzip/                分包 file-reader-sevenzip：纯载荷，7zz.js + 7zz.wasm.br + 原生目录回调
│   ├── pages/runtime/       分包占位页
│   └── runtime/             不含任何会 require 引擎的代码
└── markdown/                分包 file-reader-markdown：marked + front-matter/TeX/脚注/定义列表/diff/Mermaid
    ├── pages/runtime/       分包占位页
    └── runtime/             markdown-document.js、tex-text.js、mermaid-lite.js、svg-data-uri.js、vendor/marked.js
```

分包之间只能 `require.async`：任何分包只能同步 require 本分包或主包（`shared/`）的文件，`npm run check:production`
逐个字面量 `require` 校验。各族拿内核能力的方式是注入：内核 `families.load('document')` 用 `require.async` 取到族入口后
调用它的 `attach(kernel)`，族里的 `kernel.js` 被填上 `text-decoder`、`file-inspector` 等；Node 里 `kernel.js` 直接同步取引擎，
测试与脚本照常 `require` 族内文件。reader 内核按文件种类按需加载族（`FAMILIES_BY_KIND`），首次打开某类文件会多一次分包下载。

## 功能与样式分离：skin/

模块只复用功能。加载态、错误卡、音视频抬头、文件检查卡（压缩包目录、密码、编码切换、翻页）、Ai/PSD 抬头这些
"长什么样、怎么称呼"的部分全在 `file-reader/skin/`：四个皮肤组件（`status` `media` `inspector` `design`）加一份
`copy.js` 文案。引擎组件通过固定属性/事件契约调用它们（见 `skin/README.md` 的契约表），内容本身（DOM 渲染、
Canvas、播放器控件、预览图）由引擎放进皮肤的插槽。

- `skin/` 属于宿主：`sync:file-reader` 不覆盖它（目标没有时复制这份默认皮肤当起点），目录指纹也不含它。
- html-reader 用这份默认皮肤（兔子阅读器风格）；AGI Bar 用自己的 `agi-*` 组件与统一的"文件阅读器"措辞另写一份。
- 皮肤在主包里，引擎分包引用主包组件不需要 componentPlaceholder；`check:production` 校验四个皮肤组件与 copy.js 存在。

压缩包目录行的 `displayName`、`depth` 和 `indentRpx` 由引擎提供，默认检查卡会显示层级缩进。
自定义 `skin/inspector` 可使用同一字段呈现目录层级；模块同步保留宿主皮肤，因此已有自定义皮肤需自行接入这一显示方式。

## 接入方式一：手动复制目录

1. 把整个 `file-reader/` 放到 `miniprogramRoot` 下（保持目录名，或者见下文改根路径）。
2. `app.json` 登记六个分包（`require('/file-reader/index').describe().subPackages` 就是这份清单）：

   ```json
   {
     "subPackages": [
       { "root": "file-reader/engine", "name": "file-reader-engine", "pages": ["pages/runtime/runtime"] },
       { "root": "file-reader/document", "name": "file-reader-document", "pages": ["pages/runtime/runtime"] },
       { "root": "file-reader/archive", "name": "file-reader-archive", "pages": ["pages/runtime/runtime"] },
       { "root": "file-reader/image", "name": "file-reader-image", "pages": ["pages/runtime/runtime"] },
       { "root": "file-reader/sevenzip", "name": "file-reader-sevenzip", "pages": ["pages/runtime/runtime"] },
       { "root": "file-reader/markdown", "name": "file-reader-markdown", "pages": ["pages/runtime/runtime"] }
     ],
     "lazyCodeLoading": "requiredComponents"
   }
   ```

3. 页面 JSON 引用组件。页面在主包、组件在分包，这是微信的「分包异步化」用法（基础库 2.17.3+），
   必须同时声明 `componentPlaceholder`，分包下载完成前先渲染占位节点：

   ```json
   {
     "componentFramework": "glass-easel",
     "glassEaselWebview": true,
     "usingComponents": {
       "file-reader": "/file-reader/engine/components/reader/reader"
     },
     "componentPlaceholder": {
       "file-reader": "view"
     }
   }
   ```

   页面本身放在引擎分包里也可以，那样就不需要占位。AGI Bar 这类主包已满的宿主用第一种。

4. 页面 WXML / JS：

   ```xml
   <file-reader id="reader" file="{{file}}" siblings="{{siblings}}"
     bind:ready="onReaderReady" bind:error="onReaderError" bind:handoff="onReaderHandoff"/>
   ```

   ```js
   Page({
     data: { file: null, siblings: [] },
     onLoad () {
       // file 每次赋一个新对象就会重新打开；siblings 是同一批选中的文件（识别分卷用，可不传）。
       this.setData({ siblings: tempFiles, file: { ...tempFiles[0] } })
     },
     // 组件收不到页面滚动；网页内 scrollTo/锚点定位依赖这个转发。
     onPageScroll (event) {
       const reader = this.selectComponent('#reader')
       if (reader) reader.syncPageScroll(event.scrollTop)
     }
   })
   ```

5. 如果要接「用 XX 打开」聊天文件入口，把 `app.json` 的 `supportedMaterials` 指到你的页面，
   并在 `App.onShow` 里把 `options.forwardMaterials` 用 `isSupportedMaterial()` 过滤后交给页面。
   兔子阅读器的 `app.js` / `pages/index/index.js` 就是一份最小实现。

## 接入方式二：从 html-reader 同步到另一个项目（AGI Bar）

模块不发布 npm，只在自己的两个小程序之间共用。html-reader 是唯一真源，在 html-reader 仓库里运行：

```bash
npm run sync:file-reader -- /path/to/agi-bar/apps/miniapp
```

脚本会把整个 `file-reader/` 复制到目标 `miniprogramRoot` 下，并写入 `file-reader/SOURCE.json`（来源 commit、分支、时间、目录内容的 sha256）。
再次同步时先比对目标目录当前内容与上次记录的 sha256：不一致说明对方本地改过模块，脚本拒绝覆盖，避免两边分叉；
确认要丢弃对方改动时加 `--force`。模块的任何修改都应回到 html-reader 提交后再同步。

如果目标项目把目录放在别的位置（不是 `miniprogramRoot/file-reader`），在 `app.js` 里先调用
`require('/file-reader/index').configure({ root: '实际目录' })`，两个 WASM 内核才能被找到；
`app.json` 里三个分包的 root 与 `usingComponents` 路径也要一起改。

## `<file-reader>` 组件

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `file` | Object | `{ name, path, size, type, inlineHtml }`。`path` 是微信本地路径；`inlineHtml` 直接给 HTML 文本。每次设置新对象都会重新打开。 |
| `siblings` | Array | 同批选中的文件，用于识别 `.7z.001`、`.z01+.zip`、`.part1.rar` 等分卷；可省略。 |

| 方法 | 说明 |
| --- | --- |
| `open(file, siblings?)` | 与设置属性等价，适合命令式调用。 |
| `syncPageScroll(scrollTop)` | 宿主在 `onPageScroll` 里转发。 |
| `getReaderDiagnostics()` / `readMaterial()` / `readSvgMaterial()` | 仅开发版可用，供自动化注入原文件与诊断。 |

| 事件 | detail | 说明 |
| --- | --- | --- |
| `ready` | `{ name }` | 一次读取/解压/排版完成。 |
| `error` | `{ name, message }` | 打开失败，组件内已显示错误卡片。 |
| `handoff` | `{ kind: 'document' \| 'image', name }` | 已交给微信原生文档/图片查看器。 |
| `meta` | `{ name, meta }` | Markdown front-matter 的键值对，或网页 `<meta name>`/`<title>` 的键值对（例如 AGI Bar 的 `agi_bar_version`、`wx_miniapp_path`）；组件不解释，宿主自行决定横幅/跳转。 |
| `theme` | `{ name, background, colorScheme }` | 正文包裹层的背景色（无背景时为空串）变化时触发；宿主可据此 `setNavigationBarColor`。组件自己不改导航栏。 |

组件 `styleIsolation` 为 `apply-shared`：宿主 `app.wxss` 会进入组件，组件样式不外泄。
Ai/PSD 在组件内部由 `<design-preview>` 展示，不需要宿主再准备页面；
也可以单独使用 `<design-preview file="{{file}}"/>`。

## 安全边界

- 全部处理在本机完成，模块内没有 `wx.request`、`wx.uploadFile`、`web-view`。
- HTML 脚本只在空白全局的解释器沙盒运行，网络请求固定断网语义。
- 压缩包密码只留在组件实例内存，换文件即清除。
- 7z/RAR 内核通过 `WXWebAssembly` 加载，路径由 `shared/module-root.js` 统一管理。

## 测试

模块的行为测试留在仓库 `tests/`：`tests/helpers/reader-host.js` 用真实的组件定义和真实的宿主页面定义组装实例，
按微信方式接线（属性 observer、`triggerEvent`、`createSelectorQuery`、`detached`）。运行 `npm test`。
