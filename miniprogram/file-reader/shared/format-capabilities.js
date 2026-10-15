'use strict'

const { SUPPORTED_EXTENSIONS } = require('./file-types')

const CAPABILITY_MODES = new Set(['content-preview', 'native-preview', 'conditional-preview', 'structure-preview', 'identity-only'])
const CONTENT_LEVELS = new Set(['full-content', 'wechat-native', 'conditional-content', 'partial-content', 'unsupported-content'])
const FORMAT_CAPABILITIES = Object.create(null)

function register (extensions, capability) {
  for (const extension of extensions) {
    if (FORMAT_CAPABILITIES[extension]) throw new Error(`格式能力重复登记：${extension}`)
    FORMAT_CAPABILITIES[extension] = Object.freeze({ extension, ...capability })
  }
}

register(['html', 'htm'], {
  mode: 'content-preview', level: 'full-content', contentReady: true,
  visibleResult: '网页正文、图片、表格、样式和常见交互', evidence: '解析器单测、复杂 HTML 原文件回归与微信模拟器页面链',
  outcome: '本机解析正文、图片、表格、样式，并在安全沙箱中执行常见页面交互。',
  limitations: '浏览器专有 API、跨域网络资源和超大页面可能降级。'
})
register(['xhtml', 'xht'], {
  mode: 'conditional-preview', level: 'conditional-content', contentReady: false,
  visibleResult: 'XML 语法正确的 XHTML 正文、CDATA 样式及已验证的本机交互', evidence: 'XML/MIME 入口、公开 WPT 原件与损坏/资源边界回归；微信实际验证待完成',
  outcome: '按 XHTML MIME 或扩展名解析 XML 字符数据与标签，显示真实正文和样式。',
  limitations: '不加载外部 DTD/实体，不支持内部 DTD、未知命名空间和完整 XML DOM API；要求 XHTML 根及 body，解析错误明确停止。'
})
register(['txt'], {
  mode: 'content-preview', level: 'full-content', contentReady: true,
  visibleResult: '解码后的完整纯文本正文', evidence: 'UTF-8、UTF-16、GBK/GB18030 解码单测',
  outcome: '识别 UTF-8、UTF-16、GBK/GB18030 后显示完整纯文本。', limitations: '超过 5 MB 暂不直接排版。'
})
register(['json', 'csv'], {
  mode: 'content-preview', level: 'full-content', contentReady: true,
  visibleResult: 'JSON 保留原始数值与重复键的缩进视图；CSV 字符串单元格表格及原文切换', evidence: 'JSON/CSV 规范和独立 Python 对照、直接文件与压缩包成员入口验证',
  outcome: '在本机读取 JSON、CSV，保留数值、键名和单元格字符串；可切换查看原文。', limitations: '仅阅读，不编辑文件或执行公式；超出排版保护上限或格式无效时明确显示完整原文；文本文件上限 5 MB。'
})
register(['jsonl', 'ndjson', 'yaml', 'yml', 'xml', 'tsv', 'log', 'js', 'mjs', 'cjs', 'ts', 'css', 'py', 'sh', 'sql', 'ini', 'toml', 'conf'], {
  mode: 'content-preview', level: 'full-content', contentReady: true,
  visibleResult: '只读原始源码、配置或日志文本', evidence: '后缀/MIME 入口与原文、标记隔离和读取边界验证',
  outcome: '显示文件中实际保存的源码、配置、日志或数据文本。', limitations: '不运行代码、解析 XML 外部实体或展开配置变量；不声称 React 组件预览；文本文件上限 5 MB。'
})
register(['md', 'markdown'], {
  mode: 'content-preview', level: 'full-content', contentReady: true,
  visibleResult: '排版后的 Markdown 正文', evidence: '标题、列表、表格、链接、代码块、任务项、front-matter、TeX 公式、脚注、定义列表、diff 高亮与 Mermaid 渲染单测',
  outcome: '将标题、列表、表格、链接、代码块和任务项渲染成阅读页面；front-matter 以 meta 事件交给宿主，TeX 公式转成可读 Unicode，脚注、定义列表、diff 高亮、==高亮==、上下标进入正文，mermaid 代码块的流程/时序/状态/甘特图画成 SVG。', limitations: '危险 HTML 会被净化；饼图、类图、ER 图等其他 Mermaid 图型只显示源码占位；公式不做二维排版。'
})
register(['rtf'], {
  mode: 'content-preview', level: 'full-content', contentReady: true,
  visibleResult: '从 RTF 提取的正文与段落', evidence: '代码页、Unicode、控制词和段落提取单测',
  outcome: '按 RTF 代码页提取正文、段落和常见 Unicode 字符。', limitations: '暂不还原复杂排版、浮动对象和嵌入文件。'
})
register(['svg'], {
  mode: 'content-preview', level: 'full-content', contentReady: true,
  visibleResult: '净化后的矢量画面', evidence: 'SVG 净化、尺寸和安全图片输出单测',
  outcome: '净化后显示矢量图形。', limitations: '外部资源与危险脚本会被移除，超大 SVG 会拒绝。'
})
register(['pdf', 'doc', 'docx', 'docm', 'xls', 'xlsx', 'xlsm', 'ppt', 'pptx'], {
  mode: 'native-preview', level: 'wechat-native', contentReady: true,
  visibleResult: '微信原生文档查看器中的正文或页面', evidence: '文件路由与 wx.openDocument 参数自动化；实际解码由微信客户端提供',
  outcome: '交给微信原生文档查看器显示正文或页面。', limitations: '最终兼容范围由当前微信客户端决定；宏不会执行。'
})
register(['png', 'jpg', 'jpeg', 'gif', 'webp'], {
  mode: 'native-preview', level: 'wechat-native', contentReady: true,
  visibleResult: '微信图片预览中的原图', evidence: '文件路由与 wx.previewImage 参数自动化；实际解码由微信客户端提供',
  outcome: '使用微信图片预览显示原图。', limitations: '最终解码能力由当前微信客户端决定。'
})
register(['ai'], {
  mode: 'conditional-preview', level: 'conditional-content', contentReady: false,
  visibleResult: '内嵌 PDF、旧式基础矢量或 DSC/EPSI 屏幕预览', evidence: 'PDF 兼容数据、PostScript 安全子集与 1/2/4/8-bit EPSI 确定性样本',
  outcome: '优先打开 Ai 内嵌 PDF；旧式 PostScript Illustrator 文件会在本机还原基础矢量路径，路径无法安全还原时继续解码 DSC/EPSI 屏幕预览位图。', limitations: 'EPSI 只是文件内低分辨率屏幕预览；没有 PDF 的现代专有编辑数据，以及旧式文件中的渐变、剪切蒙版、字体、链接图片和专有效果尚不能完整还原。'
})
register(['psd', 'psb'], {
  mode: 'conditional-preview', level: 'conditional-content', contentReady: false,
  visibleResult: '内嵌缩略图或从合成通道还原的画面', evidence: 'Raw、RLE、ZIP、ZIP Prediction 与索引色/灰度/RGB/CMYK/Lab 样本',
  outcome: '显示内嵌缩略图；没有缩略图时可从 Raw、PackBits RLE、ZIP 或 ZIP Prediction 合成通道还原画面。8-bit 索引色（含透明索引）、8/16-bit 灰度/RGB/CMYK/Lab 与 32-bit RGB/灰度可生成本机 JPEG。', limitations: 'CMYK 当前使用无配置文件近似预览，Lab 按 D50 转 sRGB；索引色透明区域以棋盘格显示。双色调、多通道、超大画布和复杂独立图层效果尚未完整还原。32-bit CMYK/Lab 缺少可靠格式证据时会拒绝伪造颜色。'
})
register(['flac', 'm4a', 'ogg', 'ape', 'amr', 'wma', 'wav', 'mp3', 'aac', 'aiff', 'aif', 'caf'], {
  mode: 'conditional-preview', level: 'conditional-content', contentReady: false,
  visibleResult: '对应平台支持时的真实音频播放器和播放进度', evidence: '逐扩展名平台矩阵、容器探测、播放器状态与错误回归',
  outcome: '读取容器、编码、采样率和声道线索，并在当前平台支持时提供真实播放、暂停、进度和错误反馈。', limitations: 'FLAC/OGG/APE/AMR/WMA 仅 Android；AIFF/AIF/CAF 仅 iOS；其余仍受文件实际编码与微信版本限制。'
})
register(['mp4', 'mov', 'm4v', '3gp', 'avi', 'm3u8', 'webm'], {
  mode: 'conditional-preview', level: 'conditional-content', contentReady: false,
  visibleResult: '对应平台支持时的真实视频画面和播放状态', evidence: '逐扩展名平台矩阵、容器/轨道探测与播放器事件回归',
  outcome: '读取容器和轨道编码线索，在当前平台支持时显示原视频，并报告元数据、缓冲、结束或解码错误。', limitations: 'MOV/M4V/AVI 仅 iOS，WEBM 仅 Android；聊天中单独选择的本地 M3U8 只能列出分片/密钥引用，不能恢复未同时提供的资源。'
})
register(['zip'], {
  mode: 'conditional-preview', level: 'conditional-content', contentReady: false,
  visibleResult: '文件名正确的压缩包目录树，以及可解压条目或包内链接的真实正文或文件', evidence: 'Store、Deflate、Unix符号链接、AES、ZipCrypto、BZip2、分卷、CP437、GB18030、Shift_JIS、CP949、Big5 与 Unicode Path CRC 样本',
  outcome: '按中央目录打开 Store/Deflate；Unix 符号链接在包内解析到真实文件或目录，也支持相对路径和中间目录链接。加密或非常见方法在 80 MB 内切换本机 7-Zip 内核，核对成员序号、大小、CRC和类型；BZip2链接及解锁后的AES目标可打开真实正文。无编码标记时自动尝试UTF-8，否则使用CP437；也可选择UTF-8、CP437、GBK、Shift_JIS、CP949/EUC-KR或Big5，兼容内核继续按同一真实成员打开。支持数字分卷及z01 + zip。', limitations: '卷组合计80 MB、单文件20 MB、最多10卷。链接限16层及4096 B，拒绝越界、循环、缺失、隐藏项和重名；兼容内核只读取隔离内存副本，不创建宿主链接、不修改原文件。不支持的方法只禁用对应成员；ZIP64旧编码与分卷链接组合仍待验证，EUC-JP尚无选择。'
})
register(['rar'], {
  mode: 'conditional-preview', level: 'conditional-content', contentReady: false,
  visibleResult: '文件名正确的压缩包目录树，以及可解压条目或包内链接的真实正文', evidence: 'RAR 4/5、Normal、头部加密、密码、跨卷正文、分卷链接、路径中间链接与 RAR4 旧式路径编码样本',
  outcome: '由本机 RAR 内核显示 RAR 4/5 目录树，打开 Store/Normal 文件及加密内容；普通符号链接、RAR5 硬链接和文件复制记录可定位包内真实目标，文件夹链接可显示子目录或作为中间路径继续打开真实子文件。RAR4 未标记 UTF-8 的旧式路径会自动保留可逆字节，也可明确选择 UTF-8、CP437、GB18030、Shift_JIS、CP949 或 Big5，文件名与链接目标使用同一编码并仍按原生成员身份解压。一次选中的 partN.rar 或 rar + rNN 卷组交给 7-Zip 内核展开，并在安全解析链接后按成员身份打开跨卷真实目标。', limitations: '卷组合计限制 80 MB、单文件 20 MB、最多 10 卷；链接限 16 层及 4096 B 目标，拒绝越界、循环和同名歧义。RAR5 重定向目标仍严格要求 UTF-8；加密分卷中的链接组合及 iOS/Android 真机内存边界仍待验证。'
})
register(['7z'], {
  mode: 'conditional-preview', level: 'conditional-content', contentReady: false,
  visibleResult: '压缩包目录树及可解压条目的真实正文或文件', evidence: 'Copy、LZMA、LZMA2、AES、密码与数字分卷样本',
  outcome: '按需加载本机 7-Zip 内核，显示目录树，打开 Copy、LZMA、LZMA2 等常见条目并解锁加密内容；一次选中的 .7z.001/.002 会合并显示真实目录和正文。', limitations: '卷组合计限制 80 MB、单文件限制 20 MB、一次最多选择 10 卷；缺卷、旧版微信和真机内存边界可能阻止解压。'
})
register(['tar'], {
  mode: 'conditional-preview', level: 'conditional-content', contentReady: false,
  visibleResult: 'TAR 目录及普通成员、包内链接指向的真实正文', evidence: 'USTAR、GNU/PAX 扩展路径、UTF-8、符号链接及硬链接样本',
  outcome: '在本机读取未压缩 TAR，按成员序号打开正文；符号链接按所在目录解析，硬链接引用先前成员。', limitations: '整包80 MB、单文件20 MB，链接16层及4096字节。设备和FIFO条目不能作为普通文件阅读；拒绝越界、循环及符号链接目标歧义。gzip/xz包装、TAR分卷及真机组合尚待验证。'
})
register(['dxf'], {
  mode: 'structure-preview', level: 'partial-content', contentReady: false,
  visibleResult: '已支持二维图元的矢量画面或三维图元的可旋转模型', evidence: '二维图元、块/阵列、HATCH、DIMENSION、样条及 3D mesh/face 样本',
  outcome: '显示常见二维图元、SPLINE、BLOCK/INSERT、HATCH 与 DIMENSION；并把三维 LINE、3DFACE、3D POLYLINE、polygon mesh 与 polyface mesh 还原为可旋转点边面模型。', limitations: '非平面样条、复杂周期样条、三维圆弧/实体、动态块、代理对象、块的三维变换、图层颜色与完整线型尚未还原。'
})
register(['stp', 'step'], {
  mode: 'structure-preview', level: 'partial-content', contentReady: false,
  visibleResult: '已支持边、面、解析曲面、自由曲面和装配实例的可旋转模型', evidence: '线框、FACETED_BREP、圆柱/球/环面/B 样条曲面与多层装配样本',
  outcome: '显示 STEP 文件头与实体统计，把点和 EDGE_CURVE 转成可旋转线框，把 FACETED_BREP、常见解析曲面及非有理/有理 B 样条自由曲面三角化，并按 MAPPED_ITEM 或 ITEM_DEFINED_TRANSFORMATION 坐标链展开常见装配实例。', limitations: '复杂裁切、孔洞、局部主轴角裁切、布尔裁切、单位不同的装配上下文、超过 16 层或 200 个实例的超大装配仍受本机保护上限限制；无法可靠成面时只显示文件中的真实边界。'
})
register(['dwg'], {
  mode: 'conditional-preview', level: 'unsupported-content', contentReady: false,
  visibleResult: '只有保存版本；偶有文件自带缩略图，但不是图纸', evidence: 'AC10xx 文件头样本和无缩略图微信模拟器页面断言',
  outcome: '仅显示 DWG 保存版本；文件本身实际带有 JPEG/PNG 时显示该缩略图，并明确标记这不是图纸预览。', limitations: '当前版本不支持 DWG 几何内容。LibreDWG/WASM 为 GPLv3，RealDWG 与 ODA Drawings 为商业授权；本项目也不把用户文件上传到云端转换。请先在 CAD 软件中另存为 DXF。'
})
register(['cdr'], {
  mode: 'conditional-preview', level: 'partial-content', contentReady: false,
  visibleResult: '旧式文件的已支持矢量画布，或文档包目录与真实内嵌预览', evidence: 'Corel 官方 CoffeeShop LIST cmpr 样本、无 DISP 矢量样本与现代 ZIP 包样本',
  outcome: '旧式 RIFF 文档会解开 LIST cmpr 的双 zlib 数据流，从 loda / trfd / fild / outl 还原基础路径、填色、描边和对象变换；DISP/JPEG/PNG 只作回退。现代 ZIP 文档包显示目录、内嵌预览，并可打开支持的内部文件。', limitations: '当前压缩矢量解释器重点覆盖 CDR 6–12 常见矩形、椭圆、直线/贝塞尔路径和多边形；艺术字未转曲、段落文字、位图对象、复杂渐变/图案、透明、镜头和专有效果仍可能缺失。'
})

function capabilityAudit () {
  const declared = new Set(SUPPORTED_EXTENSIONS)
  const registered = Object.keys(FORMAT_CAPABILITIES)
  return {
    missing: SUPPORTED_EXTENSIONS.filter(extension => !FORMAT_CAPABILITIES[extension]),
    extra: registered.filter(extension => !declared.has(extension)),
    invalidModes: registered.filter(extension => !CAPABILITY_MODES.has(FORMAT_CAPABILITIES[extension].mode)),
    invalidLevels: registered.filter(extension => !CONTENT_LEVELS.has(FORMAT_CAPABILITIES[extension].level)),
    unsupportedContent: registered.filter(extension => FORMAT_CAPABILITIES[extension].level === 'unsupported-content'),
    partialContent: registered.filter(extension => FORMAT_CAPABILITIES[extension].level === 'partial-content'),
    conditionalContent: registered.filter(extension => FORMAT_CAPABILITIES[extension].level === 'conditional-content')
  }
}

module.exports = { CAPABILITY_MODES, CONTENT_LEVELS, FORMAT_CAPABILITIES, capabilityAudit }
