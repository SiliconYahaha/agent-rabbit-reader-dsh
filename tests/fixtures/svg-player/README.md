# SVG 动画播放器最小回归样本

本目录三份 SVG 为本轮独立编写的最小图形，遵循仓库 ISC 许可，不包含用户原图内容。

- rotation-path.svg：旋转与路径关键帧组合，对应自行车类样本。
- nested-rotation.svg：带固定父变换的嵌套旋转。
- use-feathers.svg：defs/use 引用及旋转，对应孔雀羽毛类结构。

`npm run verify:svg-animation` 对照 Chrome 原生 SMIL 变换和阅读器三个时间点的非空像素；它不认证两种渲染器完整视觉一致。
`npm run verify:svg-animation:wechat` 测试真实 WX 文件读取、可见 Canvas 像素、暂停、换源和受控失败重试。先用微信 CLI auto 打开当前工程；若导航协议超时，从该工程首页手动点击“打开示例”后重跑。

三个用户原文件只保存在本地忽略目录，文件名、大小、SHA-256 和结果见 `compatibility/runs/2026-09-05-svg-user-animation.json`。两个脚本均支持第一个参数传入原文件目录，第二个参数指定结果目录；微信测试结果请写到工程之外，避免自动重新编译干扰测试。
