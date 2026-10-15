# CSS 变量公开样本

固定来源：WPT `9bd47eefe9095a8464fdcce401747dcd737d1eec` 的 `css/css-variables/`。

- `variable-cycles.html`：从原始文件提取 11 组字面量声明及原有 valid/invalid 预期，分别送入 Chrome 的实际 CSSOM 和阅读器依赖计算器。不执行下载的 JS，不声称完整原始 testharness 通过。
- `css-vars-custom-property-inheritance.html`：原始文件的两个 100×50 元素应为绿色背景；Chrome 与阅读器节点重建后对照实际背景颜色。
- `variable-declaration-48.html`：循环引用无效后段落继承绿色正文，不能保留 crimson 或部分替换残片。

原始文件字节不改写，SHA-256 固定在 `tests/css-variables.test.js`。WPT BSD-3-Clause 通知随 `LICENSE.md` 保留；`variable-declaration-48.html` 自带 CC0 声明，保持原文。原件只用于测试，不进入小程序包。

注意 `variable-cycles.html` 已采用 CSSWG issue 11500 后的规则：未使用的 fallback 不参与实际循环。2022 年发布快照仍有旧式“所有 fallback 边”描述。本轮对照最新编辑草案、固定 WPT 和实际 Chrome，不依照旧描述制造假失败。

- [最新变量规范](https://drafts.csswg.org/css-variables/)
- [CSSWG 11500](https://github.com/w3c/csswg-drafts/issues/11500)
- [固定原始目录](https://github.com/web-platform-tests/wpt/tree/9bd47eefe9095a8464fdcce401747dcd737d1eec/css/css-variables)
