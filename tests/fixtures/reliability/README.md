# 多样性回归样本

公开样本清单固定 MDN 提交与 SHA-256，下载文件保存在 git 忽略的 `test-materials/public-html/`。许可见 `MDN-LICENSE.txt`。清单不含用户文件。

```sh
python3 scripts/prepare-public-html-tests.py
node scripts/generate-ai-html-tests.js
READER_PLAYWRIGHT=/absolute/path/to/playwright node scripts/audit-public-html.js
READER_PLAYWRIGHT=/absolute/path/to/playwright node scripts/audit-ai-html.js
```

可用 `CHROME_PATH` 指定 Chrome 可执行文件。AI 文件由本项目脚本生成在 `test-materials/ai-html/`，包含来源、用途与指纹，不是上线示例。详细范围和未完成项见 `docs/reader-reliability-2026-10-14.md`。
