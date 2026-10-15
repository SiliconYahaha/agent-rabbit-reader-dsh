# CSS 结构公开原件

固定来源：WPT `9bd47eefe9095a8464fdcce401747dcd737d1eec`，目录 `css/CSS2/syntax/`。

- `blocks-and-strings-001.xht`：嵌套块和无效字符串声明之后，Filler Text 必须为绿色。
- `comments-001.xht`：真实注释不破坏声明，Filler Text 必须为绿色。
- `escaped-ident-spaces-001.xht`：原浏览器显示绿色；曾发现阅读器属性名/值转义缺口，v1.4.52 候选补修后 Node 与 Chrome 对照均为绿色，已纳入强制回归。微信实际视图仍待验证。

原始字节未改写，SHA-256 固定在测试中。Chrome 以 `application/xhtml+xml` 加载原件，再比较实际文字和计算颜色；不把 HTML 重写稿充作 XHTML 原件。原始 WPT BSD-3-Clause 通知见 `LICENSE.md`。测试文件不进入小程序主包。
