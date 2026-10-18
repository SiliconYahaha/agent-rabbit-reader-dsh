# 示例素材来源

## 当前 Ai：彩色兔子阅读器 Logo

- 用户提供并明确授权替换公开 Ai 示例，原始字节未修改。
- `rabbit-reader-color.ai`：28688 bytes；SHA-256 `f92023e227c381c36041a9370dd2fe110d5edd504f0d0cb0c6011d126c24fbc1`。
- 通过与用户导入相同的旧式 Ai 路径解析器生成彩色矢量预览，不使用预渲染图片替代打开结果。

## 回归素材：Firefox 经典 Logo

- 来源：[Mozilla OpenDesign 原稿](https://github.com/mozilla/OpenDesign/blob/6164d34847ae53f5b476dea19aec3864a382585a/Firefox/Firefox_Old/Firefox%20Browser/Firefox%20Logo.ai)。
- `firefox-classic.ai` 原始字节未修改，521325 bytes；SHA-256 `fcabfe5ae8454acce84bfcfae69182af6df9f857d3bb139e727baf7299de8ce6`。PDF 兼容 Ai，有四页。
- 不再作为公开示例；保留原稿用于四页 PDF 兼容 Ai 的真实解析与绘制回归。
- 仓库的 CC0 与 MPL 2.0 文件分别保留为 `mozilla-CCLICENSE.txt` 与 `mozilla-LICENSE.txt`。Mozilla 商标不因开源而转让；遵循[商标政策](https://www.mozilla.org/en-US/foundation/trademarks/policy/)，仅作原文件预览示例，不表示合作或背书。

## 当前 PSD：Mozilla Indonesia 吉祥物发布海报

- 来源：[Mozilla OpenDesign 海报源稿](https://github.com/mozilla/OpenDesign/blob/6164d34847ae53f5b476dea19aec3864a382585a/Community%20Activities/2016/Illustrations/Mozilla%20Indonesia%20Mascot/mozilla%20mascot%20launch%20poster.psd)。许可同上；画面保留原作品作者及活动标识。
- `mozilla-mascot-original.psd` 原始字节未修改，6521317 bytes，3508 × 4961，21 个图层记录（含分组结构）；SHA-256 `308fba445b6eb428461b069f02c5bf444def1a6cb8c8ee950d5640b2e60ce74f`。
- `mozilla-mascot-poster.psd` 为展示副本，6637589 bytes；SHA-256 `d89e5bf81601d0277bda7f9267c498020a73fa37fee28b502420915e8eee4074`。仅将过小的文件内缩略图换成从原合成画面生成的 640 × 905 JPEG；图层、蒙版、原合成数据逐字节保持不变。不是用一张图片重新制作的扁平 PSD。
- 运行 `python scripts/prepare-mozilla-poster.py`（Pillow + Node）重建预览副本、卡片与 Brotli 分包，再运行 `python scripts/generate-fun-examples.py` 更新目录。文件通过 `require.async` 按需加载约 1.4 MB 分包，解压后进入普通 PSD 读取链路；示例使用文件内的保存预览，不提供图层编辑。

以下旧 Ai / PSD 保留用于回退，不再作为当前展示示例。

## 历史 Ai：Kubeflow Pipelines 品牌标志

- 来源：[CNCF 官方 artwork 仓库](https://github.com/cncf/artwork/blob/fedb3dbbf74327337fb750eae0a4ec7c8b7398c0/projects/kubeflow-pipelines/Kubeflow-Pipelines-Logo-MASTER.ai)。
- 本地文件：`kubeflow-pipelines.ai`，原始字节未修改；Adobe Illustrator 保存的 PDF 兼容 Ai。
- 用途：展示品牌标志设计源稿的文件预览。标志权利属于原权利人；不表示本产品使用 Kubeflow，也不表示合作或背书。
- 授权说明随 `kubeflow-pipelines-LICENSE.md` 保存，遵循 Linux Foundation 商标使用指引。
- 画板预览与卡片缩略图从该 Ai 的第一页渲染。小程序先显示预渲染画板，用户可主动打开原文件内嵌 PDF；这不代表对任意 Ai 的原生矢量渲染能力。

## 历史 PSD：海底幻想插画（Underwater Fantasy）

- 作者：Luis Zuno（Ansimuz）。[作者发布页](https://opengameart.org/content/underwater-fantasy)。
- 下载包：https://opengameart.org/sites/default/files/underwater-fantasy-files.zip
- 包内原文件：`underwater-fantasy-files/PSD/underwater-fantasy.psd`；本地文件 `underwater-fantasy.psd` 原始字节未修改。
- 原作者的完整分层插画，512 × 192，3 个顶层条目，包含前景、远景等场景结构。它是插画设计源稿，不宣称为印刷海报或照片修图案例。
- [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)，完整原许可保存在 `underwater-fantasy-LICENSE.txt`；应用中“素材来源与署名”可查看作者、作品和许可链接。
- 阅读器实际解析 PSD 合成画面；缩略图来自原文件合成画面，未用替代图片冒充读取成功。不提供图层编辑。

## 校验

- `kubeflow-pipelines.ai`：231784 bytes；SHA-256 `f0b6ee72d6b511de420348a1beb8cfb2d151ee80022ab1f1ba4e77ac36315514`。
- `underwater-fantasy.psd`：281711 bytes；SHA-256 `3b740405ea825546c2fd11d16741ca09350d24dd8087d8035a6a44811b8041f4`。

## 历史素材（仅保留供回退，不再打包为 Ai / PSD 示例）


- `logo-variants.ai`：来自 [Adobe Illustrator Templates 的 GitHub profile picture 模板](https://github.com/richrdkng/adobe-illustrator-templates/blob/a9ea26da7583d5c12e2a2eceb5db8e4f8997d0d9/templates/gh-profile-picture.ai)，原文件为 Adobe Illustrator 保存的 PDF 兼容 Ai。该仓库声明 [CC0 1.0](https://github.com/richrdkng/adobe-illustrator-templates/blob/a9ea26da7583d5c12e2a2eceb5db8e4f8997d0d9/LICENSE)。SHA-256：`e0ef9ab3a5ebffce31f4b83fff2b88cad9bc138102f610c2f8c1d0f6063efb25`。示例卡片缩略图由该文件第一页生成。
- `rabbit-courier-art.png`：由 OpenAI 图像生成工具为本项目生成的原创插画，经缩小和调色压缩，以控制小程序分包大小。不是外部设计师的作品。
- `rabbit-courier-poster.psd`：把上述插画、短标题和品牌标签分为三个像素图层制作的真实 PSD 文件；可用 `scripts/build-example-poster.py` 重建（作者工作环境需安装 Pillow 和 psd-tools）。示例只预览文件保存的合成画面，不宣称支持编辑图层。SHA-256：`650015d384cdded2e42457cf4468b0667f7ea9a9bd0a8ee84396959e2081307e`。
- 旧骑车插画 `tests/fixtures/svg-animated/partridge-bike.svg` 保留为回归素材，不再作为展示示例。

## SVG 与交互时钟

- `qin-shi-huang-bicycle.svg`：用户提供并明确选定的“秦始皇骑自行车”示例，原字节保留；卡片缩略图由该 SVG 渲染。
- `off-work-radar.svg`：项目自制纯 SVG 示例，无 HTML、外部资源或脚本。通过 SMIL `wallclock` 定时读取本机时钟；18:00 切换收工画面和彩纸动画。静态模板中的日期在打开时替换为本机当日零点。只支持本次验证的完整 ISO 日期时间形式，不宣称覆盖全部 SMIL 事件交互。

## HTML：霓虹坦克大战

- 文件：`neon-tank.html`。来自用户测试目录中的 `高难度html/坦克大战.html`，依照用户本轮指示选入展示。原始字节不变，保留文件内已有标识；不推定作者身份或额外开源许可。
- 单文件 HTML，以内嵌 SVG、CSS 和 JavaScript 实现战车选择、地图、计分、移动与射击；没有外部网络依赖。卡片缩略图由该文件实际运行的战场渲染。
- 相比 10 MB 级赛车、剑雨案例，它体积更小，并有移动端布局和触屏按钮。选用依据是可展示且已验证的交互，不以文件大小或源码行数作为复杂度排名。
- 声音与全关卡通关未验证；不能据此推断任意复杂游戏均可运行。

## HTML：锦鲤唱片机

- 用户提供并明确指定的案例：https://www.bubbbly.com/app/koi-pond.html 。作者：Ann Nguyen / bubbbly.com；页面保留 “Built by Claude Fable 5 on TypingMind” 标识。
- `koi-pond.html` 为此前验证过的单文件离线副本：图片和雨声音轨转为内嵌 data URL，移除统计脚本，保留原作画面、交互和署名。未改写成项目自制作品；未推定额外的开源许可。
- 依照用户要求放在 HTML 第二个示例，原会议与坦克示例保留。通过 Brotli 压缩放入示例分包，点击时解压到本地 HTML，再进入正常阅读链路。缩略图来自阅读器实际渲染画面。
- 重建：`python3 scripts/generate-fun-examples.py`。运行时音频需用户点击，真机声音与性能仍以设备验证为准。
