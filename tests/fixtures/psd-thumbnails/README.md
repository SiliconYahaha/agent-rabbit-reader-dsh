# PSD/PSB 内嵌缩略图组合

这些是项目自行构造的样本，没有用户私有数据或第三方图片。
`scripts/generate-psd-thumbnail-fixtures.py` 使用种子 `103320261013`、struct/zlib 写出完整 PSD/PSB，Pillow 生成/解码像素与 JPEG，psd-tools 1.18.0 分别读取缩略图与完整合成画面。完整文件放在忽略的 `outputs/psd-thumbnails/originals/`；这里保留小型资源及独立预期，供低成本回归。

组合包括 Photoshop 4 资源 1033 的原始 BGR、Photoshop 5 资源 1036 的原始 RGB、非零行填充、1/2/3/5/7/17 像素宽度、PSD/PSB、命名资源、JPEG/Raw 组合及新旧资源顺序。

原始像素必须逐字节符合预期。JPEG 资源原样保留，不做未证实的旧版 JPEG 红蓝交换。Chrome/libjpeg 与微信原生 JPEG 的解码差异单独记录；微信直接打开 psd-tools 提取的原 JPEG 作为原生对照，不把差异改成产品输出预期。

原始缩略图仍以现有 JPEG 预览路径展示，有损输出不代表完整画布、透明度或图层；完整合成能读取时优先读取合成画面。损坏/超限头部不分配 RGBA，后续文件仍可打开。

依据：[Adobe PSD/PSB 格式规范](https://www.adobe.com/devnet-apps/photoshop/fileformatashtml/)，[psd-tools 缩略图实现](https://github.com/psd-tools/psd-tools/blob/main/src/psd_tools/api/pil_io.py)。
