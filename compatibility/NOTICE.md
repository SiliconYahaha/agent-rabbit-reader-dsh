# 第三方兼容样本说明

`tests/file-inspector.test.js` 和 `scripts/verify-wechat-simulator.js` 内含 Apache Commons Compress 测试文件 `utf8-7zip-test.zip` 的 365 字节 Base64 表示，用于在 Node 与微信开发者工具中验证 7-Zip 生成的 CP437 与 EFS/UTF-8 混合文件名。

- 上游项目：Apache Commons Compress
- 上游文件：`src/test/resources/utf8-7zip-test.zip`
- 上游许可证：Apache License 2.0
- 上游仓库：<https://github.com/apache/commons-compress>
- 本仓库使用范围：只作 ZIP 文件名解码回归，不修改样本内容

Apache Commons Compress 及其测试样本的版权归其各自权利人所有。本说明不改变本项目其余代码的 ISC 许可。

`miniprogram/utils/vendor/legacy-cjk-data.js` 由锁定版本的 iconv-lite CP437、Shift_JIS、CP950 与 Big5-HKSCS 表生成。上游采用 MIT License，许可证原文随包保存在 `miniprogram/utils/vendor/LICENSE-ICONV-LITE`；生成文件只包含静态字符映射，不包含 Node 运行时代码。

## CommonMark 0.31.2 example corpus

The `commonMark` array in `runs/2026-09-06-markdown-footnotes.json` contains 62 selected examples from the [CommonMark specification](https://spec.commonmark.org/0.31.2/spec.json), Copyright (C) 2014-16 John MacFarlane. That array, including the added reader and baseline measurements, is distributed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Original Markdown/HTML, example numbers and sections are retained; measurement fields were added. See the [upstream notice](https://github.com/commonmark/commonmark-spec/blob/master/LICENSE). Product code retains its existing licenses.

The `commonMark` object in `runs/2026-09-06-markdown-code-indent.json` carries the same 62 examples and attribution, with additional previous/current measurements. That object is also distributed under CC BY-SA 4.0; the new synthetic indentation fixtures and product code retain the repository's existing licenses.
