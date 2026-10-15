# 7z 跨压缩方式损坏恢复验证


本轮 `npm run check` 851 项测试及 141 项兼容探针通过，renderer smoke 与生产包边界检查通过。测试和验证脚本的改动不进入微信运行包。

## 新增覆盖

五组文件头加密归档分别使用 LZMA1、Deflate、BZip2、PPMd、Copy。每组包含两份 600 KiB HTML 正文，关闭固实合并，使每份正文位于独立压缩块。测试同时核对原生目录返回的实际压缩方法和独立 packed size，避免构造器忽略参数导致假覆盖。

每组验证：正确密码列出两项；翻转首块数据区字节后拒绝首项且不返回部分内容；第二项正文逐字节一致；错误密码拒绝后可再次正确解锁并打开完整首项；成员大小精确上限允许，低一字节的上限拒绝；原输入保持不变。

内容和变异位置固定，7-Zip 加密盐、IV 与归档时间可能变化，归档密文字节不声明为确定性。验证器输出每次完整包与损坏包 SHA-256，用于留存具体复现输入。

## 独立对照

隔离的 py7zr 1.0.0 对五组完整首项和损坏包第二项均提取到相同 SHA-256：

- 完整首项：`e7ec2ca079f17a07c961cf57aec685af32fd4f07214b38fe3a14442f8b7b25b0`
- 独立第二项：`2a7de088c3dac2dd9af44f6880918660129a6535771ccb91e8ba46541cef880d`

首项损坏时，LZMA1、Deflate、BZip2、Copy 分别出现 LZMAError、zlib error、OSError、CrcError。PPMd 的一份损坏密文导致 py7zr/pyppmd 原生进程收到 SIGBUS（signal 10），另一份返回 ValueError。对照器现在每次解压启动独立子进程，记录信号并继续核对正常成员；超时和未知子进程故障仍让验证失败。原生崩溃不算“可读错误处理通过”，也没有作为阅读器缺陷。

另复测 libarchive 固定提交 `9313b877941434d9830aa4b3b700c2ae2ee68c7d` 的三份公开样本：

| 样本 | 正文大小 | 与 macOS bsdtar/libarchive 对照 |
| --- | ---: | --- |
| test_read_format_7zip_ppmd.7z | 102400 | 目录与正文逐字节一致 |
| test_read_format_7zip_delta4_lzma2.7z | 27627 | 目录与正文逐字节一致 |
| test_read_format_7zip_bcj2_copy_1.7z | 27328 | 目录与正文逐字节一致 |

下载 URL、固定源提交及内容哈希由公开样本验证器记录。未确认每个 fixture 的再分发许可，原样本仅用于本地验证，不提交或再分发。公开样本为未加密文件，加密及损坏组合由生成样本单独覆盖。[7-Zip 格式说明](https://7-zip.org/7z.html)说明了压缩方法与加密作为独立能力的格式背景。

## 微信验证边界

开发者工具 SDK 3.16.2、真实 WXWebAssembly、已上屏的模块化阅读器公开事件方法，五种方式合计 10 次密码输入、10 次解锁、15 次成员打开、15 张页面快照。全部观察到损坏提示、已验证密码保留、两项目录保留、第二项和完整首项正文打开。

这不是系统文件选择器、嵌套原生控件点击或 iOS/Android 物理真机证据。单个归档内混合多种 codec、同固实块多成员传播范围仍在下一轮队列。

## 复跑

```sh
node --test tests/7z-codec-corruption.test.js tests/7z-packed-corruption.test.js
PY7ZR_PYTHON=/path/to/isolated/python node scripts/verify-7z-packed-corruption.js /path/to/output PPMd:mem=1m
node scripts/verify-7z-packed-corruption-wechat.js ws://127.0.0.1:15237 /path/to/screenshots PPMd:mem=1m
node scripts/verify-7z-public-codecs.js /path/to/public-oracle
```

将最后的方法参数替换为 `LZMA:d=1m`、`Deflate`、`BZip2`、`Copy` 可复跑其余方法；不传方法保持原 LZMA2 双固实块用例。
