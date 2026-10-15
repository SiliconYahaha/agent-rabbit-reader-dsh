# 文件能力模块抽离与 glass-easel 启用记录

本轮不改变任何格式能力，只做两件事：把阅读能力从产品界面里完整抽离成可复用模块，
以及按官方公告在页面级启用 glass-easel。未上传微信开发版。

## 1. 抽离结果

| 之前 | 之后 | 说明 |
| --- | --- | --- |
| `pages/index/index.js`（2460 行 Page） | `file-reader/engine/components/reader/reader.js`（Component）+ `pages/index/index.js`（~110 行宿主） | 文件读取、解析、解压、排版、交互全部进组件；宿主只留队列、分享、标题、滚动转发 |
| `pages/file-preview/file-preview.js` | `file-reader/engine/components/design-preview/` + 瘦身宿主页 | Ai/PSD 预览成组件；阅读器组件内部直接内嵌它，设计文件不再跳页 |
| `utils/*`（除 share、file-session） | `file-reader/engine/core/*` | 纯能力 |
| `pages/document-reader/*` | `file-reader/document/html-runtime/*` | 本来就不是页面，是 HTML 沙盒运行时 |
| `subpackages/sevenzip` | `file-reader/sevenzip`（分包 root 同步改） | WASM 内核路径由 `core/module-root.js` 派生 |
| `components/mp-html` | `file-reader/engine/components/mp-html` | 静态回退渲染 |

组件对外接口（属性 `file`/`siblings`，方法 `open`/`syncPageScroll`，事件 `ready`/`error`/`handoff`）
和两种接入方式（手动复制 / `sync:file-reader` 同步）见 [miniprogram/file-reader/README.md](../miniprogram/file-reader/README.md)。

设计决策：

- 组件用经典 `Component({ properties, data, observers, methods })` 写法而不是 glass-easel 的 Chaining 形式。
  Chaining 只在启用 glass-easel 的页面里可用；AGI Bar 那一侧的框架设置不由本仓库控制，
  经典写法两种框架都能编译，模块才真正可复用。
- `getApp()` 的队列不再被组件读取；分卷识别改为宿主通过 `siblings` 传入同批文件。
- 组件内所有节点查询改为 `this.createSelectorQuery()`；网页内锚点/`scrollTo` 先在组件内量出位置，
  再用绝对 `scrollTop` 调 `wx.pageScrollTo`（页面级 selector 查不到组件内部节点）。
- `scripts/check-production-config.js` 新增模块边界门禁：`file-reader/` 内禁止 `getApp`、
  `getCurrentPages`、页面路由/分享/标题 API 和模块目录之外的相对引用；并要求全部页面启用 glass-easel。

## 2. glass-easel

三个主包页面和 7z 分包占位页的 JSON 都加了：

```json
{ "componentFramework": "glass-easel", "glassEaselWebview": true }
```

按官方迁移指引逐项核对（只对本项目 WXML/JS）：

| 检查项 | 结果 |
| --- | --- |
| 属性值里的 `\"` 反斜杠转义 | 无（`grep '\\"' *.wxml` 为空） |
| 旧式 `wx-if` / `wx-for` | 无 |
| `<include>` 依赖循环变量 | 未使用 include，递归树用 `<template is>` + `data` 显式传参 |
| 全局 `wx.createSelectorQuery()` | 组件内全部改为 `this.createSelectorQuery()`；mp-html 自身已带 `.in(this)` |
| 数字开头的选择器 | `#dom-nid-N`、`#dom-canvas-N`、`#step-model-canvas`，均以字母开头 |

`docs/glass-easel-migration-baseline.md` 记录的「大型 React 单文件连续更新后 WXML 视图不同步」
问题**没有在本轮复测**（见第 4 节），启用配置是按项目所有者要求做的，上传前必须先跑完整模拟器。

## 3. 已完成的验证

| 门禁 | 结果 |
| --- | --- |
| `npm test` | 810 项全部通过（基线 809，新增设计文件相关 2 项、合并 1 项） |
| `npm run check:production` | 通过；主包 2,074,866 字节，7z 分包 671,455 字节，模块源码 44 个文件 |
| `npm run check`（生成样本/模板、vendor 校验、覆盖清单、测试、两个 smoke） | 通过 |
| `git diff --check` | 通过 |
| Chrome 对照：`verify:inline-poster`、`image-data`、`image-decode`、`inline-cache`、`reader-stability`、`visible-canvas`、`canvas-readback`、`canvas-source`、`canvas-reset`、`canvas-budget` | 全部通过（这些脚本已改为加载组件定义） |
| `verify:chrome-oracle` | 最后一步 `verify-xhtml.js` 的 `bad-name-surrogate` 用例失败；在未改动的 `main` 检出上用同一台机器的 Chrome 复现同样失败，属于本机 Chrome 版本对 XML 代理项名称的处理差异，与本轮无关 |

测试桩 `tests/helpers/reader-host.js` 用真实的组件定义和真实的宿主页面定义组装实例：宿主
`setData({ file })` 触发组件 observer、`triggerEvent` 记录事件、`createSelectorQuery` 只在 wx 桩提供时暴露、
宿主 `onUnload` 后组件 `detached`。阅读状态断言在 `reader.data`，队列断言在 `host.data`，不做数据合并。

## 4. 未完成、需要人工的验证

1. **微信开发者工具完整模拟器**（`npm run verify:simulator` 与 `verify:*:wechat`）仍未能自动化运行（2026-09-03）：
   当前登录的微信号不是 `wx3a426835ea59403a` 的开发者（`cli auto` 报 `登录用户不是该小程序的开发者 (code 10)`），
   而游客 appid 在开发者工具 36.6.0 里 `cli auto --auto-port` 不会开出自动化端口。需要用该小程序的开发者账号登录，
   或在 mp.weixin.qq.com 把当前微信号加为开发者，再执行 `npm run verify:simulator`。
   已做的替代验证：在 36.6.0 模拟器里手动打开游客副本，首页与「打开示例」的 HTML 沙盒页面在 glass-easel 下正常渲染、
   脚本正常执行（环境卡片显示沙盒 navigator）。脚本已改为通过 `page.selectComponent('#reader')` / `page.$('#reader')`
   访问组件、用 `#reader >>> .entry-row` 跨组件选择器；`>>>` 在 miniprogram-automator 里的行为仍需在真实工具里确认。
2. glass-easel 下的视图同步问题（baseline 文档里的阻断项）需要按同一确定性场景在新旧框架各跑一次。
3. iOS / Android 真机各一次。
4. 同步到 AGI Bar：`npm run sync:file-reader -- <AGI Bar 的 miniprogram 目录>`（不发布 npm；`SOURCE.json` 记录来源 commit 与目录 sha256，目标被本地改过时拒绝覆盖）。

## 5. 与 AGI Bar 阅读模块的能力合并（2026-09-02 第二轮）

AGI Bar 小程序 `pages/document-reader/` 是同一引擎的前身，格式只有 md/txt/html/svg/ai，但有几项模块原本没有的内容能力。
本轮把它们移植进模块，并把 Markdown 排版整体放进新分包 `file-reader/markdown`（主包已贴近 2 MiB 上限）：

| 来源（AGI Bar） | 模块位置 | 说明 |
| --- | --- | --- |
| `utils/mermaid-lite.js` | `markdown/runtime/mermaid-lite.js` | flowchart/graph、sequence、state、gantt 画成 SVG；其余图型占位；配色可覆盖 |
| `document-renderer.js` TeX 部分 | `markdown/runtime/tex-text.js` | `$…$`、`$$…$$`、`\(…\)`、`\[…\]`、matrix/cases 环境 → Unicode 文本，行为与 AGI Bar 一致 |
| 脚注、定义列表、diff 高亮、==高亮==、上下标、front-matter | `markdown/runtime/markdown-document.js` | 作为 marked 扩展实现；任务列表与 `<details>` 由 marked/HTML 沙盒原生支持 |
| 文档深链元信息 | reader `meta` 事件 | 组件只把 front-matter 键值交给宿主，横幅与跳转留在 AGI Bar |
| 导航栏颜色跟随正文 | reader `theme` 事件 | 组件报告正文背景色，宿主自行 `setNavigationBarColor` |

未并入（宿主功能）：服务端简历 PDF 导出、`wx.shareFileMessage`、`<doc-view>` 块组件、阅读/原文 tab。
TXT 仍按纯文本显示（AGI Bar 把 TXT 走 Markdown 管线），如需一致可在宿主侧把 `.txt` 材料的 `type` 改成 `text/markdown`。
glass-easel 专有语法（Chaining、`let:`/`class:`）不进模块：AGI Bar 仍运行旧框架，模块必须两边都能编译。

同步方式改为 `npm run sync:file-reader -- <AGI Bar miniprogram 目录>`（不发 npm）。

## 6. 模块即分包（2026-09-03 第三轮）

动机：AGI Bar 主包源码已约 2.93 MiB，无法按「复制到主包」方式接入 1.7 MB 的模块。于是把模块自身拆成主包与三个分包：

| 位置 | 包 | 内容 | 大小（源码） |
| --- | --- | --- | --- |
| `file-reader/index.js`、`file-reader/shared/` | 主包 | 入口纯函数、`file-types`/`file-names`/`archive-volumes`/`format-capabilities`/`module-root` | ≈ 30 KB |
| `file-reader/engine/` | 分包 `file-reader-engine` | `core/`（含 7z 引擎侧封装 `sevenzip-runtime.js`、`subpackage-loader.js`）与三个组件 | ≈ 1.6 MB |
| `file-reader/sevenzip/` | 分包 `file-reader-sevenzip` | 纯载荷：`7zz.js`、`7zz.wasm.br`、`native-listing.js` | ≈ 620 KB |
| `file-reader/markdown/` | 分包 `file-reader-markdown` | marked + 扩展；自带 `svg-data-uri.js`，不再回头 require 引擎 | ≈ 100 KB |

规则与门禁：

- 分包只能同步 require 主包文件，跨分包只能 `require.async`。原 `sevenzip/runtime/index.js` 会同步 require 五个 core 模块，
  所以整体移入引擎分包，内核改由 `engine/core/subpackage-loader.js` 按需加载；`check:production` 断言 7z 分包里不再有 `index.js`。
- `subpackage-loader` 在 Node 里退回同步 require，测试与脚本不需要再替换 `_internals.subpackage.load`；
  三个用 `vm` 包装 7z 内核的测试改为替换 `./subpackage-loader`。
- 主包页面引用分包组件必须声明 `componentPlaceholder`（`check:production` 断言），基础库 2.17.3+。
- 三个 root 互为兄弟；`describe().subPackages` 输出完整清单，`sync:file-reader` 照常复制整个目录。
- html-reader 自己的 `pages/index`、`pages/file-preview` 仍在主包，通过占位组件引用分包组件；
  主包从 2.0 MB 降到 467 KB。`npm run check:production && npm run check && git diff --check` 全部通过（829 测试）。

真实运行时验证（开发者工具 36.6.0，游客 appid 副本，glass-easel 页面，自动化端口不可用故用「进首页自动打开」脚本代替点击）：

| 场景 | 结果 |
| --- | --- |
| `pages/index`（主包）经 `componentPlaceholder` 加载引擎分包的 `<file-reader>`，打开示例 HTML | 渲染正常，沙盒脚本执行（环境卡片显示沙盒 navigator） |
| 打开 `.md`：引擎分包 `subpackage-loader` → `require.async('../../markdown/runtime/index.js')` | 公式、Mermaid（base64 SVG）、脚注全部渲染 |
| 打开 `.7z`：`sevenzip-runtime` → `require.async` 7zz.js/native-listing.js + `WXWebAssembly.instantiate('file-reader/sevenzip/runtime/7zz.wasm.br')` | 「已按需加载的本机 7-Zip 内核读取」，目录与成员列出 |

AGI Bar 侧接入（worktree 分支 `agent/file-reader-integration`，PR 见 agi-bar/event-master）：`pages/document-reader` 本就是分包，
经 `componentPlaceholder` 引用 `<file-reader>`；聊天转发入口走组件，站内简历/投递预览保留旧排版链；`supportedMaterials` 5 类 → 10 类。
同一套「启动时自动转发」脚本在 AGI Bar 的 exparser 环境（libVersion 3.15.2，非 glass-easel）里也验证了 .md / .7z / .html 三种，
深链横幅（front-matter 与 `<meta name>`）、导航栏配色、7z 内核加载均正常；真机仍待测。

## 7. 按文件类型族拆分包（2026-09-03 第四轮）

方向（用户拍板）：相似类型共用一个模块，不同类型族各自成分包，按需下载。第 1 阶段先落地 `image` 族与动态 SVG：

- `file-reader/image/`（分包 `file-reader-image`）：`svg/` 下是自研的 SVG 子集光栅化器——XML 解析、路径（含椭圆弧）、
  简单选择器样式表与 `@keyframes`、SMIL（animate/animateTransform/set）与 CSS 动画时间线、Canvas 2D 绘制
  （形状、线性/径向渐变、clipPath、变换与 transform-origin/transform-box、文本、use、data URI 图片）；
  `components/svg-view` 用 `<canvas type="2d">` 与 `requestAnimationFrame` 播放，页面隐藏暂停，点击暂停/继续。
  不引 canvg（1.3 MB 且依赖浏览器 DOM/Image/Canvas）。
- reader 内核只用文本判据（`ANIMATED_SVG_PATTERN`）决定是否请 `<svg-view>`（跨分包占位组件）；静态 data URI 同时准备，
  组件加载/绘制失败即退回微信原生 `<image>`。静态 SVG 路径不变。
- 未支持并会标记到 `unsupported` 的特性：mask、filter、pattern、marker、外链图片。

第 2 阶段（同日）：把两个重型族从内核拆出去。

| 分包 | 内容 | 源码 |
| --- | --- | --- |
| `engine`（内核） | reader 壳、file-inspector、text-decoder + CJK 表、design-file、rtf-reader、media-inspector、text-codec、families、kernel-exports | ≈ 0.9 MB（含 197 KB DOM 模板） |
| `document` | html-runtime（sval/DOM/React 兼容）、document-renderer、html-compat、view-payload、inline-image-store、css-*、mp-html 组件 | ≈ 0.6 MB |
| `archive` | sevenzip-runtime、rar-runtime、zip-links、zip-engine-bridge、rar-links、unrar wasm | ≈ 0.25 MB |

机制：族分包不能同步 require 引擎，改为注入——内核 `families.load(name)` 经 `require.async` 取族入口并调用 `attach(kernel)`，
族里的 `kernel.js` 被填上内核模块；Node 里 `kernel.js` 同步取 `engine/core/kernel-exports`，测试与脚本不变。
reader 的同步路径（inlineHtml、开发探针）保持同步：族已加载时 `withFamilies()` 直接执行，未加载时先显示加载态再执行；
`tests/helpers/reader-host.js` 用 `families.warmSync()` 预装。`check:production` 新增逐 `require` 的跨分包校验。
design / cad / media 体量小且内核嗅探依赖 design-file，暂留内核。

## 8. 功能与样式分离：宿主皮肤（2026-09-03 第五轮）

用户要求：模块只复用功能，每个小程序保持自己的风格（AGI Bar 用自己的 `agi-*` 组件与统一的"xx 文件阅读器"措辞）。

- 引擎组件（reader、design-preview）不再自带卡片外观与文案：加载/错误/原生提示、音视频抬头与播放器、文件检查卡
  （元数据、密码、文件名编码、内容清单、翻页）、Ai/PSD 抬头都改由 `file-reader/skin/` 下四个皮肤组件渲染；
  内容（DOM 树、Canvas 模型、预览图）由引擎放进皮肤插槽。文案经 `skin/copy.js`（loading / inspector / media / design）决定，
  引擎只给事实与默认值。
- `skin/` 是宿主自有目录：`sync:file-reader` 不覆盖、指纹不含；首次同步复制默认皮肤当模板。
- 契约（属性名 / 事件名）写在 `skin/README.md`；`check:production` 校验皮肤组件齐全且被引擎引用；皮肤不受模块自包含约束。
- reader.wxss 从 616 行减到约 150 行（只剩内容区样式），design-preview.wxss 只剩预览图。

第六轮（2026-09-04）：引擎里剩余的用户可见文案（错误、状态、诊断、元数据标签、文件检查抬头，共 197 处 / 189 条）
全部改成 `skinCopy.message('<code>', { 参数 }, '<默认文案>')`。code = 文件.方法.类别.默认文案哈希，
清单由 `npm run generate:skin-messages` 生成到 `file-reader/MESSAGES.md`，`tests/skin-messages.test.js` 断言清单与源码一致、
哈希与文案一致、引擎里不再有裸的中文错误/状态字面量。默认皮肤原样返回默认文案；AGI Bar 在自己的 `skin/copy.js` 里按 code 覆盖。
深层内核（7z/RAR 引擎、解析器）抛出的 Error 文本仍是技术诊断，经上层 message 的 `detail` 参数带出，宿主可整句重写。


RTF 注释由 `engine/core/rtf-reader.js` 与 `rtf-notes.js` 解析，`file-inspector` 保留 `rtfToText(input)`，并提供供阅读组件使用的 `rtfToHtml(input)`。前者返回正文与分开的脚注、尾注；后者生成经过转义的正文和双向引用锚点，通过现有宿主 anchor 行为滚动。宿主不再自行拼装 RTF 正文 HTML。原始分页和未覆盖的编号样式有可见说明，不能据此声称完整富文本排版。
