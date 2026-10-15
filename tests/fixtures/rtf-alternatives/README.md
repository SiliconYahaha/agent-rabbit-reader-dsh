# RTF Unicode 备选与多语言原件

三个 `.rtf` 文件均原样取自 [joniles/rtfparserkit](https://github.com/joniles/rtfparserkit/tree/26c80c8700eef4c127a7a12ec4af35f190993b21/src/test/resources/com/rtfparserkit/parser/standard/data)，固定提交 `26c80c8700eef4c127a7a12ec4af35f190993b21`；未修改字节、换行或尾部 NUL。SHA-256 见 `samples.json`。

上游仓库使用 Apache-2.0；`LICENSE.txt` 原样来自该提交的 `licence.txt`，SHA-256 `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`。没有把其 Java 实现移植或复制到运行时代码。

- `testUpr.rtf`：真实 Word/Mac 风格字体表的 ANSI/Unicode 备选；正文应为 TEST / End User License Agreement / TEST。它是字体表回归，不能用它冒充已验证所有正文备选形式。
- `testUnicode.rtf`：多语言正文、字体切换、CP1250 捷克语及尾部 NUL。旧阅读器因 CP1250 拒绝整份文件。
- `testNegativeUnicode.rtf`：负数 `\uN` 表示的私用区字符及尾部 NUL。旧阅读器因根分组后的 NUL 拒绝整份文件。测试保留码点，不宣称已完成 Symbol/Wingdings 字形映射。

`samples.json` 的正文预期来自独立 macOS Cocoa 和 LibreOffice 的 UTF-8 文本导出，去除 UTF-8 BOM/首尾空白后逐字一致；不由阅读器输出生成。三份正文还与原控制字核对。

## 可复现对照

```sh
node --test tests/rtf-alternatives.test.js
# macOS；需要 textutil 和已配置的 soffice。只生成独立临时测试产物，不启动微信。
node scripts/verify-rtf-alternatives.js /path/to/task-scratch
```

脚本创建新的证据子目录、隔离 LibreOffice profile，记录输入哈希、软件版本、输出及明确的 oracle 差异；不会下载文件或删除目录。可用 `RTF_LIBREOFFICE=/absolute/path/to/soffice` 指定已安装程序。

正文备选的规则来自 [Microsoft RTF 1.9.1，第15–16页](https://officeprotocoldoc.z19.web.core.windows.net/files/Archive_References/%5BMSFT-RTF%5D.pdf)：Unicode 感知读者选择 `\ud` 表示，不拼接 ANSI 副本。生成文件预期直接定义于 `tests/helpers/rtf-alternatives.js`，不是从产品解析器取值。上游 [UprHandler.java](https://github.com/joniles/rtfparserkit/blob/26c80c8700eef4c127a7a12ec4af35f190993b21/src/main/java/com/rtfparserkit/parser/standard/UprHandler.java) 也转发 Unicode 分支；仅核对源码，本机未运行 Java 测试。

**独立工具并非对每种结构都一致**：本机 Cocoa 对最小正文备选保留旧文本；LibreOfficeDev 26.8.0.0.alpha0 对嵌套和内联两种最小形式均拼接新旧文本。记录它们与规范预期的差异，不把二者说成通过的标准答案。三份公开完整文档则与两工具正文一致。

CP1250 运行时映射由锁定的 iconv-lite 0.7.3 生成，沿用已有 `miniprogram/utils/vendor/LICENSE-ICONV-LITE`；单测用独立 Node/ICU 解码器逐字节核对 123 个已定义高字节，5 个未定义值明确拒绝，不悄悄输出替代符。其他未捆绑代码页仍不支持。
