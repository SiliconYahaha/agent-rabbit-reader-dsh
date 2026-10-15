# file-reader/skin · 宿主皮肤

这个目录属于宿主小程序，`npm run sync:file-reader` **不会覆盖**它（目标没有时才复制这份默认皮肤当模板）。
模块只复用功能：识别、读取、解压、排版、动画都在 `engine/` 与各族分包；卡片长什么样、按钮什么颜色、
文件怎么称呼，全在这里。两个小程序各自维护一份。

| 文件 | 承担 | 引擎给的属性 | 皮肤发出的事件 |
| --- | --- | --- | --- |
| `copy.js` | 文案：加载阶段、文件检查抬头、音视频抬头、Ai/PSD 抬头；以及 `message(code, params, fallback)`——引擎里其余全部用户可见文案（错误、状态、诊断、元数据标签、抬头，见 `../MESSAGES.md`），在 `MESSAGES` 里按 code 覆盖 | 见各函数的 facts / defaults | — |
| `status/` | 加载中 / 错误 / 原生查看器提示 | loading label detail error retryable native | retry |
| `media/` | 音视频抬头与播放器外观 | mode kicker name type sizeLabel formatLabel codecLabel compatibility diagnostic details canPlay path playing current duration currentLabel durationLabel note unavailable | toggle seek video* |
| `inspector/` | 文件检查抬头、元数据卡、密码卡、文件名编码、内容清单与翻页 | kicker title summary note metadata needsPassword passwordStatus nameEncoding nameEncodingOptions linkFolder entries entryCount page pages hasPreviousPage hasNextPage；插槽 preview | passwordinput unlock encoding back open prev next |
| `design/` | Ai / PSD 抬头、状态、元数据、提示、打开内嵌 PDF | mark name size loading loadingText metadataTitle metadata message error canOpenPdf openPdfText；插槽 preview | openpdf |

属性名与事件名是引擎与皮肤之间的契约，改皮肤不要改它们；要加新能力先在 html-reader 里改引擎并更新此表。
皮肤组件在主包里，引擎分包引用主包组件不需要 componentPlaceholder。
