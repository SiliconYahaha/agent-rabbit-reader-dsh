# HTML字符引用：失败基线与修复证据


独立Chrome通过data:text/html读取五个p元素的textContent；阅读器使用parseHtmlDocument处理相同输入，结果如下。

| 输入 | Chrome | 阅读器基线 |
|---|---|---|
| `&#x110000;` | U+FFFD | Invalid code point 1114112异常 |
| `&#0;` | U+FFFD | U+0000 |
| `&#128;` | 欧元符号 | U+0080 |
| `&#xD800;` | U+FFFD | 孤立代理项 |
| `&copy; &euro; &NotEqualTilde;` | © € ≂̸ | 原始实体源码 |

同一超范围引用放入title属性、textarea正文和页面title都会中断整次解析。新增8项回归覆盖上述失败，运行`node --test tests/html-character-references.test.js`已确认0通过、8失败；失败原因与表中相符，依赖加载正常，不是环境错误。

依据：[WHATWG数字字符引用结束状态](https://html.spec.whatwg.org/multipage/parsing.html#numeric-character-reference-end-state)，2026-08-30版本。零、超范围与代理项使用替代字符，C1按表映射；命名实体须按完整集合及上下文解码，不应只补几个已知符号。

## 已定位并修复

原解码器只有少数命名符号，并直接把任何数字传入 String.fromCodePoint，导致越界异常、无效码点和 C1 错误。现在动态/静态链共享完整名称表和有界数值解码；原始文本、属性和 RCDATA 分别处理。19 项专项通过，3 份公开语料及生成变体见 [固定来源](../tests/fixtures/html-entities/README.md)。

扩展测试又发现两处连带问题：实体生成的制表符可夹在 javascript 协议名内，旧 URL 过滤漏拦；单行输入框保留了解码后的换行。均增加实际输出回归后修复，不修改公共样本预期。

## 独立参照工具的差异

当前本机 Chrome 在 DOMParser 解析无 body/doctype 的简单片段时，错误地把属性 `&notit;` 转为 `¬it;`、把 `&#x;` 转为替代字符；相同原件经 iframe document.write 完整解析后保留字面量，与规范及 html5lib 一致。因此主对照改为完整页面解析，不改输入内容。

仍记录一个独立偏差：div.innerHTML 为 `&#x;` 时，Chrome 输出替代字符，而 Range.createContextualFragment、完整页面解析和规范均保留 `&#x;`。7073 个场景中 7072 个实际值一致，此项保留精确已知偏差及 Range 对照；其它任何错误或差异继续使门禁失败。不是把 Chrome 自身不一致复制到产品，更不声称 7073 项无差异。
