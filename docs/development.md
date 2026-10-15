# 开发约定

普通改动先本地验证；阶段完成后再提交和推送。GitHub 检查和微信上传均手动触发。

`npm run check` 运行生成、测试和烟测；`npm run check:production` 检查小程序边界。针对浏览器、微信和独立参考软件的脚本，需要安装对应环境后单独执行。

部分历史对照工具（`verify-rtf-hidden.js`、`verify-rtf-styles.js`、`verify-rtf-korean.js`）需通过 `BASELINE_REF` 指定本仓库可用的比较提交。它们不会自动访问其他代码库。

所有输出、临时文件与可配置缓存留在项目目录中。可设置 `TMPDIR` 指向项目内 `tmp/`，设置 `npm_config_cache` 指向项目内 `.npm-cache/`。这些目录不提交。
