# 兔子阅读器

在微信里收到文件后，直接查看文件中的实际内容。兔子阅读器是一款微信小程序，提供 HTML、Markdown、文本、文档、设计文件、图片、音视频与压缩包等本地阅读能力。不同格式的支持范围以实际实现和测试为准。

## 支持格式

共 74 个扩展名。项目把「识别出文件类型」和「用户真正看到内容」分开验收，因此按下面五档说明，不把能打开说成能看内容。

| 档位 | 用户实际看到什么 | 扩展名 |
| --- | --- | --- |
| 完整内容 | 本机解析出的正文、画面、表格、样式或可播放的媒体 | `html` `htm` `svg` `txt` `md` `markdown` `json` `jsonl` `ndjson` `csv` `tsv` `yaml` `yml` `xml` `log` `js` `mjs` `cjs` `ts` `css` `py` `sh` `sql` `ini` `toml` `conf` `rtf` |
| 微信原生内容 | 交给微信自带的文档或图片查看器显示 | `pdf` `doc` `docx` `docm` `xls` `xlsx` `xlsm` `ppt` `pptx` `png` `jpg` `jpeg` `gif` `webp` |
| 条件内容 | 满足文件内部条件时显示真实内容，缺条件时明确说明缺什么 | `zip` `rar` `7z` `tar` `ai` `psd` `psb` `xhtml` `xht` `mp3` `wav` `aac` `m4a` `flac` `ogg` `ape` `amr` `wma` `aiff` `aif` `caf` `mp4` `mov` `m4v` `3gp` `avi` `webm` `m3u8` |
| 部分真实内容 | 只还原有确定性证据的图元、曲面或对象，不冒充完整编辑器 | `dxf` `stp` `step` `cdr` |
| 内容未支持 | 只能检查文件身份，不能称为内容预览 | `dwg` |

按用途再看一遍更直观：

- **网页与矢量**：`html` `htm` `svg`。打开后是网页正文、图片、表格、样式和常见交互；SVG 会先净化再显示矢量画面。
- **文本、数据与源码**：`txt` `md` `markdown` `json` `jsonl` `ndjson` `csv` `tsv` `yaml` `yml` `xml` `log` `js` `mjs` `cjs` `ts` `css` `py` `sh` `sql` `ini` `toml` `conf`。JSON 有缩进视图且保留原始数值和重复键，CSV 是字符串表格，都能一键切回原文；本机只读，不执行代码和公式。
- **富文本**：`rtf`。按代码页提取正文、段落和脚注/尾注。
- **压缩包**：`zip` `rar` `7z` `tar`。显示真实目录树，可打开包内受支持条目的正文或文件；密码、分卷和大小超限时会说明原因。
- **设计与工程文件**：`ai` `psd` `psb` 为条件内容，`dxf` `stp` `step` `cdr` 为部分真实内容。只展示文件里真实存在、且有样本验证的内容：PSD 优先合成画面，Ai 取内嵌 PDF 或屏幕预览，DXF/STEP 是已支持图元的矢量画面或可旋转模型，CDR 取已支持矢量或内嵌预览。`dwg` 只能显示保存版本，不是图纸预览，请先另存为 DXF。
- **音视频**：音频 12 种、视频 7 种。FLAC/OGG/APE/AMR/WMA 仅 Android，AIFF/AIF/CAF 仅 iOS，MOV/M4V/AVI 仅 iOS，WEBM 仅 Android；播放器、进度和错误反馈都是真实控件。
- **文档与图片**：`pdf` `doc` `docx` `docm` `xls` `xlsx` `xlsm` `ppt` `pptx` 与 5 种图片格式由微信查看器显示，本机不上传原文件。

机器可读的逐项清单（内容等级、验收证据和限制）在 `miniprogram/file-reader/shared/format-capabilities.js`，完整审计见 [格式能力审计](docs/format-capability-audit.md)。

### 示例

- 小程序内：首页点「支持格式」打开示例库，逐个查看真实样本的显示效果。
- 仓库内：[格式用例](docs/format-use-cases/README.md) 收录首页、格式列表和全格式截图。

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

同步到远程仓库按[阶段同步流程](docs/stage-sync.md)执行：先本地检查与提交，推送必须显式确认，推送后核对远程提交。

## 技术资料

- [阅读模块架构](docs/file-reader-module.md)
- [阅读能力覆盖](docs/reader-coverage.md)
- [支持格式说明](docs/wechat-supported-formats.md)
- [格式能力审计](docs/format-capability-audit.md)
- [兼容性档案](compatibility/README.md)
- [阶段同步流程](docs/stage-sync.md)

## 许可与开源组件

本项目代码采用 [ISC 许可证](LICENSE)，第三方组件适用其各自随附的许可证。

项目使用第三方解析器、字体映射、图标和测试样本。各组件随附的 `LICENSE`、`NOTICE` 及来源说明保留在相应目录中，使用和分发时应一并保留。
