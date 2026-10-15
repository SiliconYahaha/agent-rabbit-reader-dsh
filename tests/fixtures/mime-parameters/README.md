# MIME 与正文传输原件

本目录全为自有合成数据，不包含用户文件。

`headers.json` 由 `python3 scripts/generate-mime-parameter-fixtures.py` 生成：10 个确定性 MIME、引号/转义/嵌入分号与 UTF-8、GB18030、Shift_JIS、CP949、Big5 的组合，Python标准编码器给出原字节，csv strict 给出完整单元格。RFC9110 quoted-pair 要求去掉转义反斜线；Python policy.default 与旧 compat32 的结果均保留。

`families.json` 由 `node scripts/generate-mime-family-fixtures.js` 生成：固定 ZIP 日期、7z 禁用时间字段、RAR4 Store、自有 STEP 线框、CDR 压缩矢量、两像素 PSD。无随机输入；ZIP/RAR/7z 同一正文由 macOS BSD tar 独立解出。PSD 固定 RGBA 作为合成像素标准，MIME 变体预览字节相同；不把 JPEG 损耗像素当作原 RGBA。

运行微信专项需要已启动的项目模拟器；失败不能用 Node 或 Chrome 结果替代。大正文、4096 格 CSV 和按钮更换原文按 verifier 的固定生成规则复现。
