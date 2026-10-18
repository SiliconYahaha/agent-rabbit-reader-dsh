# 阅读模块架构

阅读器由宿主页面、阅读内核与宿主皮肤组成。

- **宿主页面**负责文件选择、队列、最近阅读、返回和分享。
- **阅读内核**位于 `miniprogram/file-reader/`，负责识别、解析、解压、正文排版、图像、SVG 动画与 HTML 沙盒交互。
- **宿主皮肤**位于 `file-reader/skin/`，负责加载态、错误提示、卡片外观与文案，通过属性和事件接入内核。正文 CSS、SVG、Canvas 与文字排版仍由内核负责。

网页与文本使用 `document`，压缩包使用 `archive`，SVG 使用 `image`，Markdown、PDF、Office 及 7z 运行时按需加载。分包之间通过异步加载和内核注入协作，避免跨分包同步引用。

PDF 在当前阅读页逐页绘制；Office 提取正文、工作表和幻灯片内容。能力边界见 [格式说明](formats.md)。主包 PDF 适配与字体资源的布局见 [PDF 说明](../miniprogram/file-reader/pdf/README.md)。

组件属性、事件、目录布局与接入示例见 [模块 README](../miniprogram/file-reader/README.md)。实际分包清单以 `miniprogram/app.json` 为准；模块同步保留宿主皮肤和已有本地修改。

使用 `npm run check:production` 校验资源与分包边界，使用 `npm test` 验证读取、切换、失败恢复与资源生命周期。
