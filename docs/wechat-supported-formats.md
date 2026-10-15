# 微信小程序文件格式能力矩阵

核对日期：2026-08-29

本页只使用微信开放文档的当前页面作为格式边界。结论中的“支持”必须分成三层：

1. **聊天入口可接收**：文件可以从微信聊天素材进入小程序，场景值为 `1173`。
2. **微信原生可打开**：微信提供现成的文档、图片或音视频查看能力。
3. **兔子阅读器可解析**：没有微信原生查看器时，由本项目在设备本地解析或提供可读降级。

“聊天入口可接收”不等于“微信原生可打开”。`supportedMaterials` 只决定小程序能否出现在“打开方式”中，不会自动获得对应格式的解析器。

## 官方文档

- [聊天素材支持小程序打开](https://developers.weixin.qq.com/miniprogram/dev/framework/material/support_material.html)：`supportedMaterials`、场景值 `1173`、当前允许声明的 MIME 类型。
- [wx.openDocument](https://developers.weixin.qq.com/miniprogram/dev/api/file/wx.openDocument.html)：微信原生文档查看器支持的文件类型。
- [wx.chooseMessageFile](https://developers.weixin.qq.com/miniprogram/dev/api/media/image/wx.chooseMessageFile.html)：从客户端会话主动选择文件；`type=file` 时可按扩展名过滤，默认不过滤。
- [wx.previewImage](https://developers.weixin.qq.com/miniprogram/dev/api/media/image/wx.previewImage.html)：微信原生图片预览页。
- [wx.previewMedia](https://developers.weixin.qq.com/miniprogram/dev/api/media/image/wx.previewMedia.html)：微信原生图片和视频预览页。
- [image 组件](https://developers.weixin.qq.com/miniprogram/dev/component/image.html)：明确列出 JPG、PNG、SVG、WEBP、GIF 等图片格式。
- [video 组件](https://developers.weixin.qq.com/miniprogram/dev/component/video.html)：列出 iOS、Android 的视频容器与编码支持差异。
- [InnerAudioContext](https://developers.weixin.qq.com/miniprogram/dev/api/media/audio/InnerAudioContext.html)：列出 iOS、Android 的音频格式支持差异。

## 一、聊天素材入口允许声明的格式

微信当前文档列出 26 个 MIME 类别：

| MIME 类型 | 后缀/类别 | 微信入口含义 |
| --- | --- | --- |
| `video/*` | 视频 | 视频类文件通配入口 |
| `audio/*` | 音频 | 音频类文件通配入口 |
| `image/*` | 图片 | 图片类文件通配入口 |
| `text/html` | HTML/webview | 网页素材 |
| `text/plain` | `.txt` | 纯文本 |
| `text/markdown` | `.md` | Markdown |
| `application/*` | 通用文件 | `application` 类 MIME 的通配入口 |
| `application/pdf` | `.pdf` | PDF |
| `application/msword` | `.doc` | Word 97–2003 |
| `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | `.docx` | Word Open XML |
| `application/vnd.ms-word.document.macroEnabled.12` | `.docm` | 含宏 Word |
| `application/vnd.ms-excel` | `.xls` | Excel 97–2003 |
| `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | `.xlsx` | Excel Open XML |
| `application/vnd.ms-excel.sheet.macroEnabled.12` | `.xlsm` | 含宏 Excel |
| `application/vnd.ms-powerpoint` | `.ppt` | PowerPoint 97–2003 |
| `application/vnd.openxmlformats-officedocument.presentationml.presentation` | `.pptx` | PowerPoint Open XML |
| `application/zip` | `.zip` | ZIP 压缩包 |
| `application/vnd.rar` | `.rar` | RAR 压缩包 |
| `application/x-7z-compressed` | `.7z` | 7-Zip 压缩包 |
| `application/x-photoshop` | `.psd` | Adobe Photoshop |
| `application/acad` | `.dwg` | AutoCAD DWG |
| `application/x-cdr` | `.cdr` | CorelDRAW |
| `application/dxf` | `.dxf` | CAD DXF |
| `application/step` | `.stp` | STEP 三维交换文件 |
| `application/rtf` | `.rtf` | Rich Text Format |
| `application/postscript` | `.ai` | Adobe Illustrator |

补充边界：

- `application/*` 是入口通配规则，不代表微信能原生预览所有 `application` 文件。
- `wx.chooseMessageFile` 的 `type=all` 可以从会话选择所有文件；`type=file` 可以选择图片、视频以外的文件，并可用任意非空扩展名数组过滤。这个 API 没有固定的“只允许这些后缀”白名单。
- 正式版和体验版的 `supportedMaterials` 配置彼此独立，声明内容还会进入微信审核。

## 二、微信原生打开能力

### 文档查看器

`wx.openDocument` 官方只保证 7 种 `fileType`：

| 原生类型 | 后缀 |
| --- | --- |
| `doc` | `.doc` |
| `docx` | `.docx` |
| `xls` | `.xls` |
| `xlsx` | `.xlsx` |
| `ppt` | `.ppt` |
| `pptx` | `.pptx` |
| `pdf` | `.pdf` |

`.docm`、`.xlsm` 虽然允许作为聊天素材进入小程序，但不在 `wx.openDocument.fileType` 的官方合法值中。把它们分别伪装成 `docx`、`xlsx` 只能视为兼容尝试，不能当作微信官方保证。

### 图片

- `wx.previewImage` 提供原生全屏图片预览，但接口页没有给出封闭的后缀清单。
- `image` 组件明确写有 JPG、PNG、SVG、WEBP、GIF “等格式”，因此不能把“等”解释成所有图片格式。
- SVG 在 WebView 与 Skyline 下还有百分比单位、`style` 元素等限制，复杂 SVG 仍需要净化和兼容处理。

### 视频

`video` 组件的当前格式矩阵：

| 格式 | iOS | Android |
| --- | --- | --- |
| MP4 | 支持 | 支持 |
| MOV | 支持 | 不支持 |
| M4V | 支持 | 不支持 |
| 3GP | 支持 | 支持 |
| AVI | 支持 | 不支持 |
| M3U8 | 支持 | 支持 |
| WEBM | 不支持 | 支持 |

编码矩阵：H.264、HEVC、MPEG-4 在 iOS/Android 均支持；VP9 仅 Android 支持。`wx.previewMedia` 接受图片或视频资源，但具体能否解码仍受上述客户端与系统能力约束。

### 音频

`InnerAudioContext` 的当前格式矩阵：

| 格式 | iOS | Android |
| --- | --- | --- |
| FLAC | 不支持 | 支持 |
| M4A | 支持 | 支持 |
| OGG | 不支持 | 支持 |
| APE | 不支持 | 支持 |
| AMR | 不支持 | 支持 |
| WMA | 不支持 | 支持 |
| WAV | 支持 | 支持 |
| MP3 | 支持 | 支持 |
| MP4 音频 | 不支持 | 支持 |
| AAC | 支持 | 支持 |
| AIFF | 支持 | 不支持 |
| CAF | 支持 | 不支持 |

## 三、兔子阅读器 1.4.38 覆盖

当前代码依据：`miniprogram/app.json`、`miniprogram/utils/file-types.js`、`miniprogram/pages/index/index.js`、`miniprogram/pages/file-preview/file-preview.js`。

51 个扩展名的逐项内容等级、用户可见结果、验收证据和限制见 [`format-capability-audit.md`](format-capability-audit.md)。这里的“覆盖”不等于 51 种格式都完整还原：其中 7 个为本机完整内容、14 个为微信原生内容、25 个为条件内容、4 个为部分真实内容，DWG 1 个明确为图纸内容未支持。

音视频不再以“路由到播放器”作为完成标准。`media-inspector.js` 为上表 19 个扩展名逐一登记平台能力，读取容器与可见轨道信息；页面只在当前平台具备对应能力时上屏播放器，并用真实的 `canplay`、`loadedmetadata`、`waiting`、`ended`、`error` 事件更新状态。聊天中只选择一个本地 M3U8 时，小程序会显示清单内的分片、子清单与密钥引用，同时明确缺少资源，避免展示没有画面的播放器。

| 格式组 | 当前状态 | 说明 |
| --- | --- | --- |
| HTML/HTM | 已支持 | 本地解析 HTML/CSS/JS，并隔离危险能力 |
| PDF、DOC、DOCX、XLS、XLSX、PPT、PPTX | 已支持 | 交给 `wx.openDocument` |
| DOCM、XLSM | 兼容预览 + 可读降级 | 先按 DOCX、XLSX 尝试；微信拒绝时读取 OOXML ZIP 目录 |
| PNG、JPG/JPEG、GIF、WEBP | 已支持 | 交给 `wx.previewImage` |
| SVG | 已支持 | 本地读取、净化并使用图片组件显示 |
| TXT、MD/Markdown | 已支持 | 聊天入口单独声明，本机安全阅读 |
| Ai | 条件画布预览 | 有 PDF 兼容数据时交给 PDF 查看器；旧式 PostScript Illustrator 文件会在本机安全还原基础矢量路径，路径无法还原时继续显示文件内 DSC/EPSI 低分辨率屏幕预览。现代专有编辑数据与复杂渐变、剪切蒙版、字体、链接图片、效果仍需 PDF 兼容数据 |
| PSD/PSB | 条件画布预览 | 资源上限内优先从 Raw、PackBits RLE、ZIP 或 ZIP Prediction 合成通道还原画面，失败才明确回退内嵌缩略图。1-bit 单通道位图（Raw/RLE/ZIP，暂不支持 Prediction）、8-bit 索引色（含透明索引）、8/16-bit 灰度/RGB/CMYK/Lab 与 32-bit RGB/灰度可生成 JPEG；透明区域以棋盘格显示，双色调、多通道和复杂独立图层效果仍未完整还原 |
| 音频 | 原生播放 | `InnerAudioContext` 播放、暂停、进度、时长；平台格式差异见上表 |
| 视频 | 原生播放 | 本地 `video` 组件与系统解码器；平台格式差异见上表 |
| ZIP | 本机目录与正文 | 普通包按范围读取并打开 Store/Deflate；无编码标记的旧包可手动选择 UTF-8、CP437、GBK、Shift_JIS、CP949/EUC-KR 或 Big5；AES/ZipCrypto 加密或 BZip2 等非常见方法在 80 MB 内按需切换 7-Zip 内核；一次选择数字分卷或 z01 + zip 时合并卷组，密码不保存 |
| RAR | 本机目录与正文 | 本机内核读取 RAR 4/5 目录并打开 Store/Normal 条目；头部或文件加密时输入密码后继续；一次选择 partN.rar 或旧式 rar + rNN 时把卷组交给 7-Zip 内核，密码不保存 |
| 7Z | 本机目录与正文 | 按需加载 7-Zip 内核，打开 Copy/LZMA/LZMA2 等条目；AES 目录或文件加密时输入密码后继续；一次选择 .7z.001/.002 后合并显示真实目录与正文，密码不保存 |
| TAR | 本机目录与正文 | 应用自行读取未压缩 USTAR/GNU/PAX 普通成员与包内链接；整包80MB、正文20MB，不表示微信原生支持；gzip/xz包装和真机组合待验证 |
| DXF | 本地解析预览 | 绘制常见二维图元、有理/非有理 SPLINE、LWPOLYLINE bulge 弧段、BLOCK/INSERT、HATCH 与 DIMENSION；三维 LINE、3DFACE、3D POLYLINE、polygon/polyface mesh 进入可旋转模型 |
| STEP/STP | 本地三维模型 | 读取文件名、模式和实体统计；点/顶点/EDGE_CURVE 生成可旋转线框，FACETED_BREP/POLY_LOOP、常见解析曲面及非有理/有理 B 样条自由曲面生成可见三角面；MAPPED_ITEM 与 ITEM_DEFINED_TRANSFORMATION 装配按实例坐标展开，并组合多层父装配关系。复杂裁切、孔洞、异单位上下文及超大装配仍有保护上限 |
| DWG | 未支持图纸内容 | 只识别 AutoCAD 保存版本；文件本身带有 JPEG/PNG 时显示该缩略图并明确标记“不是图纸预览”。当前不嵌入 GPLv3 或未授权商业内核，也不把文件上传云端转换；请先在 CAD 软件中另存为 DXF |
| CDR | 条件矢量画布/目录预览 | RIFF 文档会解开 `LIST cmpr` 的两段 zlib 数据和块长度表，从 `loda`、`trfd`、`fild`、`outl` 还原 CDR 6–12 的常见路径、填色、描边与对象变换；无 DISP 缩略图仍可显示真实基础矢量。DISP/JPEG/PNG 只作回退；现代 ZIP 文档包可查看目录、预览和打开支持的内部文件。艺术字未转曲、段落文字、位图对象、复杂图案和效果仍是缺口 |
| RTF | 本地正文解析 | 提取 Unicode、十六进制字符、段落和制表符，跳过对象等非正文组 |
| 其他 `application/*` | 安全可读降级 | 显示 MIME、大小、文件头和 FNV-1a 本机校验值，不再静默丢弃 |

入口已统一：主页使用 `type=all`；场景 `1173` 接受三类媒体通配、三个文本类型和 `application/*`，测试逐项覆盖官方 26 个 MIME 类别。

## 四、实现“所有格式”的可验证目标

第一阶段的“所有格式”应定义为：**完整覆盖微信 `supportedMaterials` 官方表中的 26 个 MIME 类别，并保留项目已经支持的 PSB、SVG、HTM、Markdown 等扩展格式。** 这不是宣称可以解析世界上所有文件格式。

每一种格式至少必须达到以下一个可验证等级：

1. **原生完整预览**：调用微信官方查看器或媒体组件，正文/画面可正常查看。
2. **本地解析预览**：项目自己读取结构并显示主要内容。
3. **安全可读降级**：专有格式无法完整还原时，至少显示格式、大小、关键元数据、内嵌缩略图或压缩包目录，并清楚说明限制；不能空白、崩溃或误报“已完整打开”。

1.4.0 已完成 P0–P2 的入口、原生能力、本地解析和明确降级。下一阶段可扩展 `application/*` 中未被官方逐项列出的 CSV、JSON、XML、YAML、EPUB、ODT/ODS/ODP；这些应使用独立版本和测试文件逐步纳入，不混同于本次官方 26 类覆盖。

每个批次都必须准备真实文件，分别验证：首页主动选择、聊天场景 `1173`、iOS、Android、开发者工具、超大/损坏文件和无扩展名 MIME 路由。
