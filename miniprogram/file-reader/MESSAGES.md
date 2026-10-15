# file-reader 用户可见文案清单

由 `npm run generate:skin-messages` 从引擎源码生成，不要手改。引擎里每一处用户可见文案都写成
`skinCopy.message('<code>', { 参数 }, '<默认文案>')`；宿主在 `skin/copy.js` 的 `MESSAGES` 里按 code 覆盖：
值可以是带 `{参数}` 占位的字符串，也可以是 `(params, fallback) => string`。
code = 文件.方法.类别.默认文案哈希，默认文案一改 code 就变，覆盖项需要跟着复核。

共 197 条。

| code | 默认文案 | 参数 | 位置 |
| --- | --- | --- | --- |
| `design.loadAi.error.c3cc62` | Ai 文件检测失败：{detail} | `detail` | `engine/components/design-preview/design-preview.js:307` |
| `design.loadAi.label.08be1e` | PDF 预览 | — | `engine/components/design-preview/design-preview.js:223` `engine/components/design-preview/design-preview.js:239` `engine/components/design-preview/design-preview.js:263` `engine/components/design-preview/design-preview.js:287` `engine/components/design-preview/design-preview.js:299` |
| `design.loadAi.label.175f8a` | 画布范围 | — | `engine/components/design-preview/design-preview.js:266` |
| `design.loadAi.label.23a052` | EPSI 位图 | — | `engine/components/design-preview/design-preview.js:300` |
| `design.loadAi.label.3ac624` | 屏幕预览 | — | `engine/components/design-preview/design-preview.js:288` |
| `design.loadAi.label.6edd72` | 预览来源 | — | `engine/components/design-preview/design-preview.js:289` |
| `design.loadAi.label.95b210` | 画布 | — | `engine/components/design-preview/design-preview.js:264` |
| `design.loadAi.label.9d2601` | 格式 | — | `engine/components/design-preview/design-preview.js:222` `engine/components/design-preview/design-preview.js:238` `engine/components/design-preview/design-preview.js:262` `engine/components/design-preview/design-preview.js:286` `engine/components/design-preview/design-preview.js:298` |
| `design.loadAi.label.c9530c` | 基础路径 | — | `engine/components/design-preview/design-preview.js:265` |
| `design.loadAi.message.26eb63` | 已在本机安全还原旧式 Ai 的基础矢量路径、颜色、描边和常见变换{value}。渐变、剪切蒙版、文字字体、链接图片和 Illustrator 专有效果仍可能缺失。 | `value` | `engine/components/design-preview/design-preview.js:268` |
| `design.loadAi.message.4cb97a` | 这个旧式 Ai 没有内嵌 PDF，且文件超过 {size} 本机矢量解析上限。请在 Illustrator 中重新保存并开启 PDF 兼容。 | `size` | `engine/components/design-preview/design-preview.js:241` |
| `design.loadAi.message.8825e5` | 这个 Ai 没有内嵌 PDF，也没有找到可安全还原的旧式基础矢量画面或文件内屏幕预览。矢量检查：{detail}；位图检查：{detail2}。请在 Illustrator 中重新保存并开启 PDF 兼容。 | `detail` `detail2` | `engine/components/design-preview/design-preview.js:302` |
| `design.loadAi.message.f0f1e9` | 基础矢量解释器没有找到可安全还原的路径，但文件内含用于屏幕显示的 EPSI 位图预览，已原样解码为可见画面。它可能是低分辨率预览，不代表完整可编辑内容。 | — | `engine/components/design-preview/design-preview.js:291` |
| `design.loadAi.message.f16e51` | 检测到 Illustrator 内嵌 PDF，可以使用微信文档查看器显示画板。正在直接打开…… | — | `engine/components/design-preview/design-preview.js:227` |
| `design.loadPsd.error.1cb58c` | PSD 解析失败：{detail} | `detail` | `engine/components/design-preview/design-preview.js:165` |
| `design.loadPsd.label.8ef488` | 颜色 | — | `engine/components/design-preview/design-preview.js:130` |
| `design.loadPsd.label.95b210` | 画布 | — | `engine/components/design-preview/design-preview.js:129` |
| `design.loadPsd.label.9d2601` | 格式 | — | `engine/components/design-preview/design-preview.js:128` |
| `design.loadPsd.label.de61aa` | 预览 | — | `engine/components/design-preview/design-preview.js:153` |
| `design.loadPsd.label.f3c5b9` | 通道 | — | `engine/components/design-preview/design-preview.js:131` |
| `design.loadPsd.message.af05ff` | 合成画面暂未能还原：{detail}。当前显示文件内嵌缩略图，不代表完整分辨率或透明度；图层、蒙版和文字仍保留在原文件中。 | `detail` | `engine/components/design-preview/design-preview.js:154` |
| `design.loadPsdComposite.label.0aada1` | 合成预览 | — | `engine/components/design-preview/design-preview.js:189` |
| `design.loadPsdComposite.label.1d59d4` | 色彩预览 | — | `engine/components/design-preview/design-preview.js:191` `engine/components/design-preview/design-preview.js:198` |
| `design.loadPsdComposite.label.3fdf0c` | 合成透明度 | — | `engine/components/design-preview/design-preview.js:201` |
| `design.loadPsdComposite.label.844bb0` | 透明索引 | — | `engine/components/design-preview/design-preview.js:200` |
| `design.loadPsdComposite.value.0fb8c8` | CMYK 近似颜色（未应用 ICC 配置） | — | `engine/components/design-preview/design-preview.js:198` |
| `design.loadPsdComposite.value.5383bf` | 已按文件色彩配置还原 | — | `engine/components/design-preview/design-preview.js:193` |
| `design.loadPsdComposite.value.cfff0c` | 暂不支持此色彩配置，当前颜色可能有偏差 | — | `engine/components/design-preview/design-preview.js:196` |
| `design.loadPsdComposite.value.e22f6f` | 色彩配置损坏，当前颜色可能有偏差 | — | `engine/components/design-preview/design-preview.js:195` |
| `design.onImageError.error.0bb046` | 设计文件预览显示失败：{detail} | `detail` | `engine/components/design-preview/design-preview.js:332` |
| `design.openAiPdf.error.4b747c` | Ai 预览准备失败：{detail} | `detail` | `engine/components/design-preview/design-preview.js:327` |
| `design.openAiPdf.error.7267f9` | Ai 内嵌 PDF 打开失败：{detail} | `detail` | `engine/components/design-preview/design-preview.js:324` |
| `inspector.inspect7z.label.109778` | 目录大小 | — | `engine/core/file-inspector.js:605` |
| `inspector.inspect7z.label.989d1a` | 版本 | — | `engine/core/file-inspector.js:603` |
| `inspector.inspect7z.label.d38d6d` | 目录偏移 | — | `engine/core/file-inspector.js:604` |
| `inspector.inspect7z.summary.895a41` | 已校验 7z 签名和起始头；7z 目录本身可能经过压缩或加密，因此不在小程序内展开文件内容。 | — | `engine/core/file-inspector.js:601` |
| `inspector.inspect7z.title.2e8c5d` | 7z 压缩包 | — | `engine/core/file-inspector.js:600` |
| `inspector.inspectBinary.label.0dd3e5` | MIME 类型 | — | `engine/core/file-inspector.js:2781` |
| `inspector.inspectBinary.label.2ad8b0` | 文件大小 | — | `engine/core/file-inspector.js:2782` |
| `inspector.inspectBinary.label.7bf0e3` | 文件头 | — | `engine/core/file-inspector.js:2783` |
| `inspector.inspectBinary.summary.44afdf` | 已在本机读取文件头并生成校验值，可用于确认文件完整性和真实类型。 | — | `engine/core/file-inspector.js:2779` |
| `inspector.inspectBinary.title.d130dc` | 二进制文件信息 | — | `engine/core/file-inspector.js:2778` |
| `inspector.inspectCdr.label.0ec001` | 声明大小 | — | `engine/core/file-inspector.js:2767` |
| `inspector.inspectCdr.label.21bc3f` | 文档类型 | — | `engine/core/file-inspector.js:2757` |
| `inspector.inspectCdr.label.38af4d` | 文档版本 | — | `engine/core/file-inspector.js:2758` |
| `inspector.inspectCdr.label.3e7af5` | 画布预览 | — | `engine/core/file-inspector.js:2768` |
| `inspector.inspectCdr.label.452c01` | RIFF 块 | — | `engine/core/file-inspector.js:2759` |
| `inspector.inspectCdr.label.4608b4` | 未还原对象 | — | `engine/core/file-inspector.js:2765` |
| `inspector.inspectCdr.label.762b56` | 矢量控制点 | — | `engine/core/file-inspector.js:2764` |
| `inspector.inspectCdr.label.8760b0` | 容器标识 | — | `engine/core/file-inspector.js:2756` |
| `inspector.inspectCdr.label.d8ade2` | 压缩数据列表 | — | `engine/core/file-inspector.js:2760` |
| `inspector.inspectCdr.label.e34569` | 基础矢量对象 | — | `engine/core/file-inspector.js:2763` |
| `inspector.inspectCdr.label.e57bd8` | 压缩内部记录 | — | `engine/core/file-inspector.js:2762` |
| `inspector.inspectCdrZip.label.916ba8` | 内部文件 | — | `engine/core/file-inspector.js:2725` |
| `inspector.inspectCdrZip.label.d179a3` | 容器 | — | `engine/core/file-inspector.js:2725` |
| `inspector.inspectCdrZip.summary.f66cd3` | 已解开现代 CorelDRAW ZIP 容器并列出 {value} 个内部文件；支持的预览图、PDF、XML 和其他条目可直接点开。 | `value` | `engine/core/file-inspector.js:2724` |
| `inspector.inspectCdrZip.title.c5edcf` | CorelDRAW 文档包 | — | `engine/core/file-inspector.js:2723` |
| `inspector.inspectDwg.label.258220` | 可行操作 | — | `engine/core/file-inspector.js:2197` |
| `inspector.inspectDwg.label.55558e` | 保存版本 | — | `engine/core/file-inspector.js:2195` |
| `inspector.inspectDwg.label.d03d69` | DWG 标识 | — | `engine/core/file-inspector.js:2194` |
| `inspector.inspectDwg.label.e6a73a` | 图纸内容 | — | `engine/core/file-inspector.js:2196` |
| `inspector.inspectDwg.summary.edeac1` | 当前版本不能解码 DWG 图纸几何。这里只显示真实保存版本；文件本身带有 JPEG/PNG 缩略图时才会显示该缩略图。需要查看图纸时，请先在 CAD 软件中另存为 DXF，再用兔子阅读器打开。 | — | `engine/core/file-inspector.js:2192` |
| `inspector.inspectDwg.title.a7ad90` | DWG 文件（图纸内容未支持） | — | `engine/core/file-inspector.js:2191` |
| `inspector.inspectDxf.label.102b09` | 实体类型 | — | `engine/core/file-inspector.js:1219` |
| `inspector.inspectDxf.label.1dea48` | 预览图元 | — | `engine/core/file-inspector.js:1224` |
| `inspector.inspectDxf.label.31f644` | 多行文字 | — | `engine/core/file-inspector.js:1225` |
| `inspector.inspectDxf.label.3a290e` | 块定义/展开引用 | — | `engine/core/file-inspector.js:1220` |
| `inspector.inspectDxf.label.6b4c4a` | AutoCAD 版本 | — | `engine/core/file-inspector.js:1217` |
| `inspector.inspectDxf.label.7cc4fa` | 填充边界/尺寸 | — | `engine/core/file-inspector.js:1221` |
| `inspector.inspectDxf.label.8fa019` | 样条/多段线弧 | — | `engine/core/file-inspector.js:1222` |
| `inspector.inspectDxf.label.93806a` | 三维点/边/面 | — | `engine/core/file-inspector.js:1227` |
| `inspector.inspectDxf.label.c5a275` | 插入单位代码 | — | `engine/core/file-inspector.js:1218` |
| `inspector.inspectDxf.label.d4cc9d` | HATCH 曲线边 | — | `engine/core/file-inspector.js:1223` |
| `inspector.inspectDxf.label.eac9a9` | 文字提示 | — | `engine/core/file-inspector.js:1226` |
| `inspector.inspectDxf.summary.1faf27` | 已读取图元结构，共识别 {detail} 个常见实体。{value} | `detail` `value` | `engine/core/file-inspector.js:1215` |
| `inspector.inspectDxf.title.d448ec` | DXF 工程图 | — | `engine/core/file-inspector.js:1214` |
| `inspector.inspectDxf.value.861ba0` | 部分格式指令未完整还原，请对照原图核查 | — | `engine/core/file-inspector.js:1226` |
| `inspector.inspectDxf.value.bb684d` | 基础格式预览；原始字体、精确字距和自动换行尚未完整还原 | — | `engine/core/file-inspector.js:1225` |
| `inspector.inspectFileBytes.label.49deaf` | 文件 | — | `engine/core/file-inspector.js:2807` |
| `inspector.inspectFileBytes.label.fad68f` | 实际读取 | — | `engine/core/file-inspector.js:2807` |
| `inspector.inspectRar4.title.2f9e0a` | RAR 4.x 压缩包 | — | `engine/core/file-inspector.js:580` |
| `inspector.inspectRar5.title.beab98` | RAR 5.x 压缩包 | — | `engine/core/file-inspector.js:580` |
| `inspector.inspectStep.label.052061` | 关系型装配 | — | `engine/core/file-inspector.js:1316` |
| `inspector.inspectStep.label.102b09` | 实体类型 | — | `engine/core/file-inspector.js:1316` |
| `inspector.inspectStep.label.1275f6` | 文件名 | — | `engine/core/file-inspector.js:1316` |
| `inspector.inspectStep.label.5efc13` | 线框点/边 | — | `engine/core/file-inspector.js:1316` |
| `inspector.inspectStep.label.7c7d89` | 可见面片 | — | `engine/core/file-inspector.js:1316` |
| `inspector.inspectStep.label.84a5b0` | 自由曲面 | — | `engine/core/file-inspector.js:1316` |
| `inspector.inspectStep.label.c5823f` | 装配实例 | — | `engine/core/file-inspector.js:1316` |
| `inspector.inspectStep.label.ed0eea` | 模式 | — | `engine/core/file-inspector.js:1316` |
| `inspector.inspectStep.summary.69f22a` | 已解析 STEP 头信息和 {count} 个实体记录。 | `count` | `engine/core/file-inspector.js:1312` |
| `inspector.inspectStep.title.2065b0` | STEP 三维交换文件 | — | `engine/core/file-inspector.js:1311` |
| `inspector.inspectZipCentral.label.072da0` | 中央目录 | — | `engine/core/file-inspector.js:394` |
| `inspector.inspectZipCentral.label.0de92f` | 原始大小 | — | `engine/core/file-inspector.js:392` |
| `inspector.inspectZipCentral.label.25cf77` | 目录项 | — | `engine/core/file-inspector.js:390` |
| `inspector.inspectZipCentral.label.ae2b1f` | 文件名显示 | — | `engine/core/file-inspector.js:391` |
| `inspector.inspectZipCentral.label.f9831d` | 压缩大小 | — | `engine/core/file-inspector.js:393` |
| `inspector.inspectZipCentral.summary.bfb257` | {value}已读取 {count} 个有效目录项并整理为目录树；支持的文件可直接点开{value2}{value3}。 | `value` `count` `value2` `value3` | `engine/core/file-inspector.js:384` |
| `inspector.inspectZipCentral.title.73e445` | ZIP 压缩包 | — | `engine/core/file-inspector.js:383` |
| `inspector.module.label.365a6f` | 日文 Shift_JIS | — | `engine/core/file-inspector.js:24` |
| `inspector.module.label.4afad8` | 自动 | — | `engine/core/file-inspector.js:20` |
| `inspector.module.label.848ff3` | 繁体 Big5 | — | `engine/core/file-inspector.js:26` |
| `inspector.module.label.9eb808` | 韩文 CP949 / EUC-KR | — | `engine/core/file-inspector.js:25` |
| `reader.applyArchiveNameEncoding.error.411e06` | ZIP 文件名编码切换失败：{detail} | `detail` | `engine/components/reader/reader.js:1280` |
| `reader.applyArchiveNameEncoding.error.820783` | RAR 路径编码切换失败：{detail} | `detail` | `engine/components/reader/reader.js:1264` |
| `reader.dispatchSelectedFile.error.5acbff` | HTML 文件超过 20 MB。建议先移除无关数据，或分成多个文件后打开。 | — | `engine/components/reader/reader.js:512` |
| `reader.file.media.a4c218` | 等待播放器读取媒体轨道… | — | `engine/components/reader/reader.js:334` |
| `reader.inspectArchiveVolumeSet.error.0a6b1d` | 压缩分卷读取失败：{detail}。请确认已经一次选中同组全部分卷。 | `detail` | `engine/components/reader/reader.js:1140` |
| `reader.inspectArchiveVolumeSet.error.873a7a` | 分卷合计超过 80 MB，当前本机解压内核不会整组载入。 | — | `engine/components/reader/reader.js:1101` |
| `reader.inspectArchiveVolumeSet.label.568323` | 缺少 | — | `engine/components/reader/reader.js:1093` |
| `reader.inspectArchiveVolumeSet.label.743aaf` | 已选择 | — | `engine/components/reader/reader.js:1092` |
| `reader.inspectArchiveVolumeSet.summary.e86c40` | 已识别同组分卷，但缺少：{value}。请一次选择这一组的全部分卷后重试。 | `value` | `engine/components/reader/reader.js:1090` |
| `reader.inspectArchiveVolumeSet.title.b91e70` | 分卷压缩包不完整 | — | `engine/components/reader/reader.js:1090` |
| `reader.inspectLocalFile.error.242ee2` | 文件检查失败：{detail} | `detail` | `engine/components/reader/reader.js:1075` |
| `reader.inspectLocalFile.error.99d68f` | 文件读取失败：{detail} | `detail` | `engine/components/reader/reader.js:1079` |
| `reader.inspectLocalFile.error.a54c95` | 微信没有返回可读取的本地文件路径，请重新选择。 | — | `engine/components/reader/reader.js:1030` |
| `reader.inspectLocalFile.label.49deaf` | 文件 | — | `engine/components/reader/reader.js:1057` |
| `reader.inspectLocalFile.label.e4e46c` | 类型 | — | `engine/components/reader/reader.js:1058` |
| `reader.inspectLocalFile.label.fd2070` | 大小 | — | `engine/components/reader/reader.js:1059` |
| `reader.inspectLocalFile.summary.01ef2b` | 文件已成功接收，但超过 80 MB。为避免微信内存不足，本次不展开内部目录或工程实体。原文件不会上传。 | — | `engine/components/reader/reader.js:1055` |
| `reader.inspectLocalFile.title.78acb5` | 大型文件信息 | — | `engine/components/reader/reader.js:1055` |
| `reader.inspectRarFile.error.77e71e` | RAR 文件超过 80 MB，当前本机解压内核不会整包载入。 | — | `engine/components/reader/reader.js:1288` |
| `reader.inspectRarFile.error.86606d` | RAR 文件读取失败：{detail} | `detail` | `engine/components/reader/reader.js:1324` |
| `reader.inspectRarFile.error.ef0da8` | RAR 读取失败：{detail} | `detail` | `engine/components/reader/reader.js:1319` |
| `reader.inspectSevenZipFile.error.140123` | {label} 文件读取失败：{detail} | `label` `detail` | `engine/components/reader/reader.js:1381` |
| `reader.inspectSevenZipFile.error.ccf1cd` | 7z 读取失败：{detail} | `detail` | `engine/components/reader/reader.js:1376` |
| `reader.inspectSevenZipFile.error.d0f1f0` | TAR 读取失败：{detail} | `detail` | `engine/components/reader/reader.js:1360` |
| `reader.inspectSevenZipFile.error.ed5b06` | {label} 文件超过 80 MB，当前本机解压内核不会整包载入。 | `label` | `engine/components/reader/reader.js:1334` |
| `reader.inspectZipFile.error.3e4215` | ZIP 目录读取失败：{detail} | `detail` | `engine/components/reader/reader.js:1236` |
| `reader.onDomHostAction.title.3e1fac` | 链接已复制 | — | `engine/components/reader/reader.js:2849` |
| `reader.onDomHostAction.title.b527a0` | 编辑内容 | — | `engine/components/reader/reader.js:2853` |
| `reader.onLinkTap.title.3e1fac` | 链接已复制 | — | `engine/components/reader/reader.js:2896` |
| `reader.onRenderError.error.64ca9e` | 部分内容排版失败：{detail} | `detail` | `engine/components/reader/reader.js:2888` |
| `reader.onStandaloneSvgError.error.186ad1` | SVG 图像解码失败：{detail}。文件已成功读取，但其中可能包含该设备不支持的滤镜或图形。 | `detail` | `engine/components/reader/reader.js:1985` |
| `reader.onStandaloneSvgError.error.351e1a` | SVG 预览准备失败：{detail} | `detail` | `engine/components/reader/reader.js:1979` |
| `reader.onVideoEnded.media.56cde1` | 视频播放完成。 | — | `engine/components/reader/reader.js:898` |
| `reader.onVideoError.error.3d11b9` | 视频播放失败：{detail} | `detail` | `engine/components/reader/reader.js:904` |
| `reader.onVideoLoadedMetadata.media.0aa8fd` | 微信已读取视频轨道，可以播放。 | — | `engine/components/reader/reader.js:887` |
| `reader.onVideoPlay.media.c3ab3b` | 视频正在播放。 | — | `engine/components/reader/reader.js:873` |
| `reader.onVideoWaiting.media.3498c2` | 视频正在读取或缓冲本地轨道… | — | `engine/components/reader/reader.js:893` |
| `reader.openDesignFile.error.425bb4` | 微信没有返回可读取的设计文件路径，请重新选择。 | — | `engine/components/reader/reader.js:431` |
| `reader.openImageFile.error.41dd2f` | 微信没有返回可读取的图片路径，请重新选择。 | — | `engine/components/reader/reader.js:699` |
| `reader.openImageFile.error.774cc4` | 图片预览失败：{detail} | `detail` | `engine/components/reader/reader.js:708` |
| `reader.openImageFile.status.cc915a` | {name} 已交给微信图片查看器打开。返回后可继续查看已选文件。 | `name` | `engine/components/reader/reader.js:703` |
| `reader.openInspectorEntry.error.54751a` | 包内文件打开失败：{detail} | `detail` | `engine/components/reader/reader.js:1824` |
| `reader.openInspectorEntry.error.9a5664` | 包内文件保存失败：{detail} | `detail` | `engine/components/reader/reader.js:1838` |
| `reader.openInspectorEntry.password.f3e93c` | 密码不正确或压缩包已损坏，请重新输入。 | — | `engine/components/reader/reader.js:1821` |
| `reader.openMediaFile.error.61bf51` | 微信没有返回可播放的本地文件路径，请重新选择。 | — | `engine/components/reader/reader.js:715` |
| `reader.openMediaFile.error.6c1e8c` | 音频播放失败：{detail} | `detail` | `engine/components/reader/reader.js:787` |
| `reader.openMediaFile.error.f536fa` | 当前微信版本没有提供音频播放能力，请更新微信后再试。 | — | `engine/components/reader/reader.js:754` |
| `reader.openMediaFile.media.1f8a88` | 微信已读取音频轨道，可以播放。 | — | `engine/components/reader/reader.js:771` |
| `reader.openMediaFile.media.3bb669` | 已定位到新的播放位置。 | — | `engine/components/reader/reader.js:780` |
| `reader.openMediaFile.media.81ff6d` | 正在定位音频播放位置… | — | `engine/components/reader/reader.js:779` |
| `reader.openMediaFile.media.be6da4` | 音频正在读取或缓冲本地轨道… | — | `engine/components/reader/reader.js:778` |
| `reader.openNativeDocument.error.039094` | 微信没有返回可读取的文档路径，请重新选择。 | — | `engine/components/reader/reader.js:671` |
| `reader.openNativeDocument.error.b24571` | 文档打开失败：{detail} | `detail` | `engine/components/reader/reader.js:691` |
| `reader.openNativeDocument.status.2cc103` | {name} 已交给微信文档查看器打开。返回后可继续查看已选文件。 | `name` | `engine/components/reader/reader.js:678` |
| `reader.openSelectedFile.error.88db26` | 微信没有提供可识别的文件类型。请确认文件扩展名完整后重试。 | — | `engine/components/reader/reader.js:495` |
| `reader.openSelectedFile.error.986623` | 当前收到的是网络链接，不是微信可直接读取的本地文件。请先把文件下载到聊天中再打开。 | — | `engine/components/reader/reader.js:491` |
| `reader.openSelectedFile.error.a9ad18` | 文件超过 200 MB，暂时无法在小程序内预览。 | — | `engine/components/reader/reader.js:502` |
| `reader.parsePreparedContent.error.9eff68` | 解析失败：{detail} | `detail` | `engine/components/reader/reader.js:2247` |
| `reader.parsePreparedContent.error.b6b875` | 交互内容解析失败，已切换到静态阅读模式：{detail} | `detail` | `engine/components/reader/reader.js:2237` |
| `reader.parsePreparedContent.error.f5fbb2` | XHTML 运行失败：{detail} | `detail` | `engine/components/reader/reader.js:2226` |
| `reader.presentArchivePasswordPrompt.label.8085eb` | 处理方式 | — | `engine/components/reader/reader.js:1454` |
| `reader.presentArchivePasswordPrompt.label.e19841` | 保护方式 | — | `engine/components/reader/reader.js:1453` |
| `reader.presentCanvasItems.error.5d04a1` | Canvas 画面未能完成： | — | `engine/components/reader/reader.js:2744` |
| `reader.readRtfFile.error.0fd2e7` | RTF 解析失败：{detail} | `detail` | `engine/components/reader/reader.js:1018` |
| `reader.readRtfFile.error.907040` | RTF 文件超过 5 MB，为避免页面卡顿暂时不直接排版。 | — | `engine/components/reader/reader.js:1001` |
| `reader.readRtfFile.error.b231c1` | RTF 读取失败：{detail} | `detail` | `engine/components/reader/reader.js:1022` |
| `reader.readRtfFile.error.d80986` | 微信没有返回可读取的 RTF 路径，请重新选择。 | — | `engine/components/reader/reader.js:1006` |
| `reader.readSafeFile.error.85e91e` | 网页文本解码失败：{detail} | `detail` | `engine/components/reader/reader.js:1863` |
| `reader.readSafeFile.error.8c25f9` | 微信没有返回可读取的文件路径，请重新选择文件。 | — | `engine/components/reader/reader.js:1845` |
| `reader.readSafeFile.error.99d68f` | 文件读取失败：{detail} | `detail` | `engine/components/reader/reader.js:1872` |
| `reader.readSvgFile.error.0283ee` | SVG 解析失败：{detail} | `detail` | `engine/components/reader/reader.js:1960` |
| `reader.readSvgFile.error.1ba6f8` | SVG 读取失败：{detail} | `detail` | `engine/components/reader/reader.js:1896` |
| `reader.readSvgFile.error.351e1a` | SVG 预览准备失败：{detail} | `detail` | `engine/components/reader/reader.js:1956` |
| `reader.readSvgFile.error.9483d4` | SVG 文件超过 20 MB，为避免本地解析卡顿暂时无法预览。 | — | `engine/components/reader/reader.js:1879` |
| `reader.readSvgFile.error.953ee6` | 微信没有返回可读取的 SVG 路径，请重新选择文件。 | — | `engine/components/reader/reader.js:1884` |
| `reader.readTextFile.error.4edfc3` | 微信没有返回可读取的文本路径，请重新选择。 | — | `engine/components/reader/reader.js:938` |
| `reader.readTextFile.error.adc1d3` | Markdown 排版组件加载失败：{detail} | `detail` | `engine/components/reader/reader.js:985` |
| `reader.readTextFile.error.ca1b85` | 文本解析失败：{detail} | `detail` | `engine/components/reader/reader.js:990` |
| `reader.readTextFile.error.cbac2f` | 文本读取失败：{detail} | `detail` | `engine/components/reader/reader.js:994` |
| `reader.readTextFile.error.d399e5` | 文本文件超过 5 MB，为避免页面卡顿暂时不直接排版。 | — | `engine/components/reader/reader.js:933` |
| `reader.readTextFile.label.2ef7ba` | 查看排版 | — | `engine/components/reader/reader.js:960` |
| `reader.readTextFile.label.46145c` | 查看原文 | — | `engine/components/reader/reader.js:959` |
| `reader.readTextFile.message.d82499` | 暂时无法排版，以下显示完整原文。 | — | `engine/components/reader/reader.js:963` |
| `reader.renderDomState.error.2c9009` | XHTML 排版失败：{detail} | `detail` | `engine/components/reader/reader.js:2263` |
| `reader.renderDomState.error.e222ad` | 交互排版失败，已切换到静态阅读模式：{detail} | `detail` | `engine/components/reader/reader.js:2266` |
| `reader.renderStepModelCanvas.model.0ee199` | 可拖动旋转 · {count} 点 / {count2} 边 / {count3} 面片 | `count` `count2` `count3` | `engine/components/reader/reader.js:1613` |
| `reader.resetReaderView.media.a4c218` | 等待播放器读取媒体轨道… | — | `engine/components/reader/reader.js:600` |
| `reader.startLoadingWatchdog.error.797798` | 这个文件处理时间异常，已停止等待。可以返回后重试；若仍失败，请把原文件发给开发者排查。 | — | `engine/components/reader/reader.js:647` |
| `reader.startLoadingWatchdog.loading.5a9a79` | 文件内容较多，正在分段排版，请稍候… | — | `engine/components/reader/reader.js:640` |
| `reader.toggleAudio.media.4a1380` | 已请求播放，正在等待微信播放器解码… | — | `engine/components/reader/reader.js:859` |
| `reader.unlockArchive.password.7be364` | 当前压缩包数据已失效，请重新选择文件。 | — | `engine/components/reader/reader.js:1483` |
| `reader.unlockArchive.password.9a104a` | 请输入压缩包密码。 | — | `engine/components/reader/reader.js:1478` |
| `reader.unlockArchive.password.f3e93c` | 密码不正确或压缩包已损坏，请重新输入。 | — | `engine/components/reader/reader.js:1522` |
| `reader.withFamilies.error.159ddf` | 阅读组件没加载好，请点重试。 | — | `engine/components/reader/reader.js:471` |
