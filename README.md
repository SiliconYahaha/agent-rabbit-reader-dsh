# 兔子阅读器

在微信里收到文件后，直接查看文件中的实际内容。兔子阅读器是一款微信小程序，提供 HTML、Markdown、文本、文档、设计文件、图片、音视频与压缩包等本地阅读能力。不同格式的支持范围以实际实现和测试为准。

## 本地开发

需要 Node.js 24、npm 和微信开发者工具。

```sh
npm ci
npm run check
npm run check:production
```

使用微信开发者工具导入仓库根目录，源码目录为 `miniprogram/`。`project.config.json` 中的 AppID 对应兔子阅读器；使用自己的小程序账号时需另行配置 AppID 和相关生产检查。密钥和本地开发者工具配置不进入仓库。

## 目录

- `miniprogram/`：小程序页面、阅读内核和本地资源。
- `scripts/`：生成、校验、兼容性验证与手动发布工具。
- `tests/`：回归测试及测试样本。
- `compatibility/`：格式能力档案、参考资料和回归数据。
- `docs/`：架构、格式支持与开发文档。
- `server/`、`deploy/`：独立实验服务；默认小程序不连接此服务。
- `outputs/`：本机生成成果，不提交生成文件。

## 验证与发布

`npm test` 运行 Node 回归测试；`npm run check` 包含资源生成和渲染烟测；`npm run check:production` 检查小程序生产边界。浏览器、微信模拟器和真机验证是不同层次，Node 测试通过不代表真机验收通过。

GitHub 检查和微信开发版上传均由手动触发。普通提交不自动上传微信，也不自动提审或发布。上传前必须确认目标 AppID、版本、凭据与说明。

## 技术资料

- [阅读模块架构](docs/file-reader-module.md)
- [阅读能力覆盖](docs/reader-coverage.md)
- [支持格式说明](docs/wechat-supported-formats.md)
- [兼容性档案](compatibility/README.md)

## 许可与开源组件

本项目代码采用 [ISC 许可证](LICENSE)，第三方组件适用其各自随附的许可证。

项目使用第三方解析器、字体映射、图标和测试样本。各组件随附的 `LICENSE`、`NOTICE` 及来源说明保留在相应目录中，使用和分发时应一并保留。
