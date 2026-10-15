# 原创文本与数据样本

由 `python3 scripts/generate-text-data-fixtures.py` 确定性生成，随机种子 `8259418020261013`。全部为项目自行构造，不含用户文件。

JSON 使用 Python 标准库 `json`、`Decimal` 和重复键序列核对，另以独立词法扫描保存原始 token；CSV 由 Python `csv` 写入并严格读回。七种字节编码及 ZIP 包由 Python 标准库生成。依据 [RFC 8259](https://www.rfc-editor.org/rfc/rfc8259) 和 [RFC 4180](https://www.rfc-editor.org/rfc/rfc4180)。

`node --test tests/text-data.test.js` 检查正文、原文切换、非法格式、资源上限、过期回调和压缩包条目。`node scripts/verify-text-data-browser.js` 对照原生 Chrome；`node scripts/verify-text-data-wechat.js` 使用已启动的本项目微信模拟器，核对实际 WXML 文本、按钮点击和横向滚动。后者不是物理真机或聊天菜单验证。

JSON 超大数字、重复键、负零和转义不得用 `JSON.parse/stringify` 的结果替换预期；CSV 公式只作文本。超过排版保护上限时明确显示完整原文，不能通过丢弃行/字段让检查通过。
