# DWG / CDR 专有格式内核审计

本项目的验收标准是“用户能看到可验证画面、目录或模型”，不把文件头识别写成几何预览完成。

## DWG

- [GNU LibreDWG](https://www.gnu.org/software/libredwg/) 提供 DWG 解码及初步 SVG 转换，官方许可证是 GPLv3 或更高版本。[libredwg-web](https://github.com/mlightcad/libredwg-web) 确实能把它编译成浏览器/Node.js 可用的 WebAssembly，但这没有消除底层 GPLv3 的源码、整合和分发义务。当前项目是 ISC 许可证，未经项目所有者明确决定许可证迁移并完成合规审查，不把该 WASM 装进微信包。
- [Autodesk RealDWG](https://forge.autodesk.com/developer/overview/realdwg-api) 是商业授权的 Windows C++/.NET SDK，官方当前开发环境要求 Windows 11、Visual Studio、16 GB 内存和约 10 GB 磁盘空间，不是可直接嵌入微信小程序的内核。
- [ODA Drawings SDK](https://www.opendesign.com/products/drawings) 能访问和显示 DWG，并提供 Web/移动路线，但属于需要试用或商业成员授权的专业 SDK。项目尚未取得可发布到微信小程序的授权，也没有可审计的现成包体方案。
- 云端 RealDWG/ODA 转换会把用户原文件发送到第三方或自建服务，与当前“文件只在设备本地处理、不上传”的产品承诺相冲突；在用户另行批准隐私、服务器、费用和安全方案前，不采用这条路线。
- 架构结论：本地优先和当前许可证保持不变，DWG 不进入“图纸内容已支持”清单。页面只显示保存版本及文件中实际存在的 JPEG/PNG 缩略图，并明确写出“这不是图纸预览”；没有缩略图时给出“先在 CAD 软件中另存为 DXF”的可执行建议。

## CDR

- [LibreOffice libcdr](https://github.com/LibreOffice/libcdr) 是 MPL 2.0 的 CorelDRAW 读取/转换库，但需要 Boost、ICU、LCMS2、librevenge 和 zlib 等 C++ 依赖；尚无适合当前小程序包体和运行环境的官方现成构建。项目没有复制或打包该 C++ 内核，而是依据公开 RIFF/`LIST cmpr` 结构独立实现受限、安全的本机解释器。
- 旧式 RIFF 文档会解析块目录和版本，校验 `CPng` 标识、声明长度和解压上限，再解开 `LIST cmpr` 的图形流与块长度流。CDR 6–12 常见的矩形、椭圆、直线/贝塞尔路径、多边形、固色/基础渐变、轮廓和 `trfd` 对象变换会生成 SVG；文件没有 `DISP` 也能出现真实基础矢量画布。`DISP` 索引色缩略图及 JPEG/PNG 只作为回退。
- Corel 官方 CoffeeShop `.cdr` 用于外部复验：移除其 96×96 `DISP` 后，解释器仍从 246 条压缩内部记录中还原 11 个可见矢量对象和 1,190 个控制点，主体、咖啡杯、蒸汽、边框、色块及转曲文字都可见；该外部样本不写入仓库。
- 这仍不是完整 CorelDRAW 内核：艺术字未转曲、段落文字、嵌入位图、复杂图案/渐变、透明、镜头和专有效果可能缺失，因此 CDR 保持“条件预览”，不会标记为全格式完成。
