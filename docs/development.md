# 本地开发与验证

## 启动

使用 Node.js 24 与 npm，在仓库根目录执行：

```sh
npm ci
npm run check
npm run check:production
```

微信开发者工具导入仓库根目录，`project.config.json` 指定 `miniprogram/`。其他小程序账号需配置自己的 AppID，并相应调整生产校验；不要提交密钥、本地配置或用户私有文件。

## 修改与验证

- 页面负责选择文件、队列、导航与分享；阅读能力集中在 `miniprogram/file-reader/`。
- `skin/` 负责宿主外观与文案；正文 CSS、SVG、Canvas 和排版属于阅读内核。
- 小改动先运行相关 `node --test tests/<名称>.test.js`；共享内核、依赖或批量同步后执行 `npm run check`。
- `npm run check:production` 检查分包体积、文件引用及小程序边界；提交前执行 `git diff --check`。
- Node、浏览器、微信开发者工具和真机各自提供不同证据。没有执行的验证不要写成通过。

PDF 和 Office 使用已提交的运行资源；只有重建依赖时才按 [PDF 说明](../miniprogram/file-reader/pdf/README.md) 与 [Office 说明](../miniprogram/file-reader/office/README.md) 安装独立构建依赖。

## GitHub 交付

在任务分支集中完成一批相关修复和验证，再推送 PR；在 Actions 手动运行 `Repository checks` 检查任务分支，通过后合并。这个仓库只承担代码与文档交付，不触发微信开发版上传、体验版、提审或正式发布。

历史阶段同步脚本默认 dry-run，具体参数见 [阶段同步工具](stage-sync.md)。普通分支可使用 Git 和 GitHub PR 流程，不必强行套用只接受 main 的脚本命令。

## 本地输出

日志、截图和中间文件写入 `outputs/` 或 `tmp/`，默认不提交。可将 `TMPDIR` 指向项目内 `tmp/`，`npm_config_cache` 指向项目内 `.npm-cache/`。

历史对照脚本需要 `BASELINE_REF` 时，应指定当前仓库存在的提交，不访问其他代码库。

`server/`、`deploy/` 是可选实验服务，不属于默认小程序流程；本地阅读无需启动服务。
