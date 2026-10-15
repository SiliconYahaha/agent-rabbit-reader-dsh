# glass-easel 迁移基线

检查日期：2026-09-01

## 当前结论

**2026-09-02 更新**：按项目所有者要求，`pages/home`、`pages/index`、`pages/file-preview`
和 7z 分包占位页的 JSON 已成对加入 `componentFramework: "glass-easel"` 与
`glassEaselWebview: true`；阅读能力同时抽成 `file-reader/` 模块（见
[file-reader-module.md](file-reader-module.md)），组件内节点查询已全部改为
`this.createSelectorQuery()`。本轮只完成了迁移指引的静态核对和 Node/Chrome 门禁，
**没有**在开发者工具里复测下述视图不同步问题（工具未登录、自动化端口未开）。上传微信开发版之前，
必须先按第「重新评估门槛」跑一次完整模拟器；复测不过就把四个 JSON 里的两项配置一起去掉。

2026-09-01 的结论保留如下：首页单页启用后可以完成全量模拟器回归，但 HTML 阅读页仍存在
逻辑树、`page.data` 与实际 WXML 视图不同步的阻断问题，因此不能仅凭编译成功或
普通单测通过就迁移。

微信最新公告说明：从基础库 3.8.12 起，glass-easel 的 WebView 渲染已覆盖约 98%
的微信用户。这个数字证明新框架已经具备广泛的平台可达性，但不能替代本项目的页面
兼容验证；它不会自动消除下述已复现的视图不同步问题，所以当前生产结论不变。

一次确定性开发者工具复测中，大型 React 单文件连续更新后：

- 运行时 DOM 与 `page.data.domTree` 已指向同一组新节点；
- 实际 WXML 仍保留上一组按钮节点；
- 3 秒内视图没有追平逻辑树，真实点击存在回灌到过期节点的风险；
- 关闭 glass-easel 后，现有完整模拟器路径仍是生产基线。

这不是性能收益结论，也不是 iOS、Android 真机结论。后续必须先解决大数据分段
`setData` 与递归模板的视图收敛，再比较性能。

## 官方迁移要求

WebView 页面需要同时配置：

```json
{
  "componentFramework": "glass-easel",
  "glassEaselWebview": true
}
```

页面级启用会连带使用新编译器处理 `usingComponents` 和泛型组件默认依赖，不能只看
页面自己的 WXML。迁移时还要检查 XML 转义、旧式 `wx-if`/`wx-for`、`include` 的
局部变量边界、数字开头选择器，以及全局 `wx.createSelectorQuery()` 的使用。

官方资料：

- [小程序组件框架升级公告](https://mp.weixin.qq.com/s/CvST9Lg0INTCGlA0dMyk3Q)
- [glass-easel 迁移指引](https://developers.weixin.qq.com/miniprogram/dev/framework/custom-component/glass-easel/migration.html)
- [小程序框架指南](https://developers.weixin.qq.com/miniprogram/dev/framework/)
- [小程序框架参考](https://developers.weixin.qq.com/miniprogram/dev/reference/)

## 新框架收益与开发工具基线

- Chaining 形式的 `Component()` 构造器更适合复杂组件闭包和 TypeScript 类型推导；
  现有页面不会为追求新语法而先行重写，只有新组件或独立重构才评估采用。
- 新 WXML 编译器增加 `let:` 和 `class:` 等语法，并宣称生成码执行速度可提升约
  20%。这是官方通用场景数据，不作为兔子阅读器的性能结论；本项目必须用同一份大型
  HTML、同一套交互和同一设备做旧/新框架 A/B。
- 开发者工具应升级到能完整调试 glass-easel 的最新 nightly 版本；仅当全部待测页面
  都完成迁移后，才可勾选“WXML 完全使用 glass-easel 编译”，不能用它跳过页面灰度。
- TypeScript 项目迁移时将 `miniprogram-api-typings` 至少升级到公告建议的 5.2.3；
  当前项目主要使用 JavaScript，不为这项建议单独引入 TypeScript 构建链。

## 重新评估门槛

1. 只按页面逐步启用，两个配置项必须成对出现，禁止先全局开启。
2. 编译 `mp-html`、递归 DOM 模板和 7z 分包，不允许仅验证首页。
3. 大型 React HTML 在连续滚动和状态更新后，运行时 DOM、`page.data`、实际 WXML
   的语义控件必须在限定时间内保持同一节点身份。
4. 真实点击、Canvas、原生输入、长列表、多文件队列和失败后继续下一份必须通过。
5. 同一确定性场景分别在旧框架和 glass-easel 下重复测量，报告中区分编译时间、
   首屏时间、交互更新时间及开发者工具噪声。
6. 开发者工具通过后仍需 iOS、Android 真机各验证一次，才能改变生产配置。
7. 把覆盖率、官方通用性能数据和本项目实测分开记录；任何官方覆盖率提升都不能单独
   关闭本档案中的阻断项。

`scripts/verify-wechat-simulator.js` 在真实控件找不到时会同时输出运行时路径、
序列化节点和实际 WXML 按钮摘要；`scripts/verify-reader-stability.js` 会跨过动画帧并
用确定性章节坐标反复滚动，避免把未执行的 `requestAnimationFrame` 误记为稳定。
