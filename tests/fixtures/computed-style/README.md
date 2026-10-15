# CSSOM 脚本读取样式公开样本

固定 WPT 提交：`9bd47eefe9095a8464fdcce401747dcd737d1eec`。三个 HTML 文件原始字节与 BSD-3-Clause 许可证均保留；SHA-256 由 `tests/computed-style.test.js` 校验。

- `computed-style-001.html`：提取原 CSS、嵌套 div 和原断言中的三项预期（height、font-size、百分比 width），在 Chrome 与沙箱执行相同读取。该文件原有只读测试组不计入这三项。
- `computed-style-set-property.html`：提取四条原始写入表达式，检查 `NoModificationAllowedError`；另核对原 parentRule 为 null，共五项。
- `getComputedStyle-detached-subtree.html`：核对原普通 detached div 的 length 为 0、color 为空，计一项。iframe、Shadow DOM、flat tree 场景仍未实现，不计通过。

这九项是明确范围的提取对照，不是完整原始 WPT testharness 执行。下载的脚本不在 Node 宿主直接执行；提取的表达式只在隔离的页面脚本解释器与临时 Chrome 测试页执行。网络访问不属于测试输入。

- [固定上游目录](https://github.com/web-platform-tests/wpt/tree/9bd47eefe9095a8464fdcce401747dcd737d1eec/css/cssom)
- [CSSOM getComputedStyle](https://drafts.csswg.org/cssom/#dom-window-getcomputedstyle)

命名色数据另来自现有锁定依赖 TinyColor 1.6.0，仅提取名称到十六进制颜色映射，去除非 CSS 的 burntsienna；许可证保存在 `miniprogram/utils/LICENSE-css-color-names`。未增加 npm 依赖，也没有打包 TinyColor 运行时代码。
