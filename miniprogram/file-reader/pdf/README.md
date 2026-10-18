# 本地 PDF 页内预览

以 Mozilla PDF.js 6.4.299 为解析/画布渲染内核，固定版本来源为 npm `pdfjs-dist`；上游 https://github.com/mozilla/pdf.js ，Apache-2.0。`vendor/LICENSE-PDFJS` 保留许可证。流实现为 `web-streams-polyfill` 4.2.0，许可证位于 `../shared/pdf-runtime/vendor/LICENSE-STREAMS`。字体与 CMap 按需从本地 `pdf-assets` 分包读取，该分包保留上游各许可证。

重建：`npm ci --prefix tools/pdf-runtime` 后执行 `node scripts/vendor-pdf-runtime.js`。构建工具独立锁定，不影响产品运行依赖。

- 数据来自微信已选本地文件，默认在当前阅读页显示；没有服务端转换或用户文件上传。
- 禁用 PDF 脚本求值、XFA、表单/注释交互、WASM 和外部字体请求。文件名不会被当作字体路径使用；字体与 CMap 只能读取固定本地目录的合法名称。
- 当前页渲染完成后导出 PNG 展示，避免原生 Canvas 盖住文件目录；翻页替换自己的临时图，关闭时取消任务并释放临时图/画布。
- 文件上限 25 MiB；单画布/图像上限 8 MiPixels；显示像素比最多 2。加密或失败文件只显示手动微信查看器入口，不自动弹出。
- 未提供搜索、文本选择、可编辑表单、批注；复杂色彩过滤、部分图像编码及超大资源可能受限。桌面开发者工具通过不代表所有 Android/iOS 微信版本通过。

验证入口：`node --test tests/pdf-inline.test.js` 与 `node scripts/verify-inline-pdf-wechat.js <本地PDF> <证据子目录>`。后者需要已运行的微信开发者工具，覆盖页内画面、翻页、放大、目录收起、多文件切换和损坏文件恢复。

打包布局：PDF API、宿主适配和流依赖置于主包 `file-reader/shared/pdf-runtime`，解析 worker 位于本分包，字体位于 `pdf-assets`。保留编译膨胀余量，避免源码低于 2 MiB 而微信编译后超限。
