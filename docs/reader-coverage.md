# 阅读器兼容性清单

数据源：`@mdn/browser-compat-data 8.0.11`；仅列出 BCD 中声明当前 Chrome 可用的顶层能力。

状态不是“完整浏览器兼容”承诺：`native` 表示安全转换后交给微信渲染层，`engine/shim/mapped` 表示阅读器有明确实现，`degraded/hidden/stripped/blocked` 表示有意降级或隔离，`gap` 表示尚未实现。

| 类别 | 条目数 | 状态汇总 |
|---|---:|---|
| HTML 元素 | 133 | blocked 7；degraded 2；hidden 2；mapped 6；native 116 |
| CSS 属性 | 605 | native 605 |
| CSS 选择器 | 138 | degraded 14；engine 30；gap 94 |
| CSS @ 规则 | 19 | engine 3；gap 13；stripped 3 |
| Web API 接口 | 1034 | degraded 4；gap 1009；shim 21 |

## HTML 元素

| 能力 | 状态 | 说明 |
|---|---|---|
| `a` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `abbr` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `acronym` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `address` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `area` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `article` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `aside` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `audio` | degraded | 离线占位；video 可显示安全 poster |
| `b` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `base` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `bdi` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `bdo` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `big` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `blockquote` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `body` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `br` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `button` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `canvas` | mapped | 映射为小程序节点或本地快照 |
| `caption` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `center` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `cite` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `code` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `col` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `colgroup` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `data` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `datalist` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `dd` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `del` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `details` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `dfn` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `dialog` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `dir` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `div` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `dl` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `dt` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `em` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `embed` | blocked | 危险或可嵌入执行上下文，不进入阅读树 |
| `fencedframe` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `fieldset` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `figcaption` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `figure` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `font` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `footer` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `form` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `frame` | blocked | 危险或可嵌入执行上下文，不进入阅读树 |
| `frameset` | blocked | 危险或可嵌入执行上下文，不进入阅读树 |
| `geolocation` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `h1` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `h2` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `h3` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `h4` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `h5` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `h6` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `head` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `header` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `hgroup` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `hr` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `html` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `i` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `iframe` | blocked | 危险或可嵌入执行上下文，不进入阅读树 |
| `img` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `input` | mapped | 映射为小程序节点或本地快照 |
| `ins` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `kbd` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `label` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `legend` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `li` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `link` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `main` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `map` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `mark` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `marquee` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `menu` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `meta` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `meter` | mapped | 映射为小程序节点或本地快照 |
| `nav` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `nobr` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `noembed` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `noframes` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `noscript` | hidden | 按浏览器默认隐藏 |
| `object` | blocked | 危险或可嵌入执行上下文，不进入阅读树 |
| `ol` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `optgroup` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `option` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `output` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `p` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `param` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `picture` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `plaintext` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `pre` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `progress` | mapped | 映射为小程序节点或本地快照 |
| `q` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `rb` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `rp` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `rt` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `rtc` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `ruby` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `s` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `samp` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `script` | blocked | 危险或可嵌入执行上下文，不进入阅读树 |
| `search` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `section` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `select` | mapped | 映射为小程序节点或本地快照 |
| `selectedcontent` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `slot` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `small` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `source` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `span` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `strike` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `strong` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `style` | blocked | 危险或可嵌入执行上下文，不进入阅读树 |
| `sub` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `summary` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `sup` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `table` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `tbody` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `td` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `template` | hidden | 按浏览器默认隐藏 |
| `textarea` | mapped | 映射为小程序节点或本地快照 |
| `tfoot` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `th` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `thead` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `time` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `title` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `tr` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `track` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `tt` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `u` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `ul` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `var` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `video` | degraded | 离线占位；video 可显示安全 poster |
| `wbr` | native | DOM 树保留并由 WXML/WXSS 展示 |
| `xmp` | native | DOM 树保留并由 WXML/WXSS 展示 |

## CSS 属性

| 能力 | 状态 | 说明 |
|---|---|---|
| `-webkit-app-region` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `-webkit-border-before` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `-webkit-border-horizontal-spacing` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `-webkit-border-vertical-spacing` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `-webkit-box-reflect` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `-webkit-column-break-after` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `-webkit-column-break-before` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `-webkit-column-break-inside` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `-webkit-locale` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `-webkit-logical-height` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `-webkit-logical-width` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `-webkit-mask-box-image` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `-webkit-mask-composite` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `-webkit-mask-position-x` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `-webkit-mask-position-y` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `-webkit-max-logical-height` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `-webkit-max-logical-width` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `-webkit-min-logical-height` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `-webkit-min-logical-width` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `-webkit-perspective-origin-x` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `-webkit-perspective-origin-y` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `-webkit-rtl-ordering` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `-webkit-tap-highlight-color` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `-webkit-text-combine` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `-webkit-text-decorations-in-effect` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `-webkit-text-fill-color` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `-webkit-text-security` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `-webkit-text-stroke` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `-webkit-text-stroke-color` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `-webkit-text-stroke-width` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `-webkit-transform-origin-x` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `-webkit-transform-origin-y` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `-webkit-transform-origin-z` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `-webkit-user-drag` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `accent-color` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `align-content` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `align-items` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `align-self` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `alignment-baseline` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `all` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `anchor-name` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `anchor-scope` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `animation` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `animation-composition` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `animation-delay` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `animation-direction` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `animation-duration` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `animation-fill-mode` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `animation-iteration-count` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `animation-name` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `animation-play-state` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `animation-range` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `animation-range-end` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `animation-range-start` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `animation-timeline` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `animation-timing-function` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `animation-trigger` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `appearance` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `aspect-ratio` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `backdrop-filter` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `backface-visibility` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `background` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `background-attachment` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `background-blend-mode` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `background-clip` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `background-color` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `background-image` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `background-origin` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `background-position` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `background-position-x` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `background-position-y` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `background-repeat` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `background-size` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `baseline-shift` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `baseline-source` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `block-size` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-block` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-block-color` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-block-end` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-block-end-color` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-block-end-style` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-block-end-width` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-block-start` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-block-start-color` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-block-start-style` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-block-start-width` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-block-style` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-block-width` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-bottom` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-bottom-color` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-bottom-left-radius` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-bottom-right-radius` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-bottom-style` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-bottom-width` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-collapse` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-color` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-end-end-radius` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-end-start-radius` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-image` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-image-outset` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-image-repeat` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-image-slice` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-image-source` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-image-width` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-inline` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-inline-color` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-inline-end` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-inline-end-color` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-inline-end-style` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-inline-end-width` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-inline-start` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-inline-start-color` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-inline-start-style` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-inline-start-width` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-inline-style` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-inline-width` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-left` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-left-color` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-left-style` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-left-width` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-radius` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-right` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-right-color` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-right-style` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-right-width` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-shape` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-spacing` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-start-end-radius` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-start-start-radius` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-style` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-top` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-top-color` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-top-left-radius` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-top-right-radius` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-top-style` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-top-width` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `border-width` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `bottom` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `box-align` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `box-decoration-break` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `box-direction` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `box-flex` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `box-ordinal-group` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `box-orient` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `box-pack` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `box-shadow` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `box-sizing` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `break-after` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `break-before` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `break-inside` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `buffered-rendering` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `caption-side` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `caret-animation` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `caret-color` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `caret-shape` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `clear` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `clip` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `clip-path` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `clip-rule` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `color` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `color-interpolation` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `color-interpolation-filters` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `color-rendering` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `color-scheme` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `column-count` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `column-fill` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `column-gap` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `column-height` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `column-rule` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `column-rule-break` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `column-rule-color` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `column-rule-inset` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `column-rule-inset-cap` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `column-rule-inset-cap-end` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `column-rule-inset-cap-start` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `column-rule-inset-end` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `column-rule-inset-junction` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `column-rule-inset-junction-end` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `column-rule-inset-junction-start` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `column-rule-inset-start` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `column-rule-style` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `column-rule-visibility-items` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `column-rule-width` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `column-span` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `column-width` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `column-wrap` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `columns` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `contain` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `contain-intrinsic-block-size` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `contain-intrinsic-height` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `contain-intrinsic-inline-size` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `contain-intrinsic-size` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `contain-intrinsic-width` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `container` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `container-name` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `container-type` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `content` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `content-visibility` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `corner-block-end-shape` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `corner-block-start-shape` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `corner-bottom-left-shape` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `corner-bottom-right-shape` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `corner-bottom-shape` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `corner-end-end-shape` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `corner-end-start-shape` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `corner-inline-end-shape` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `corner-inline-start-shape` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `corner-left-shape` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `corner-right-shape` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `corner-shape` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `corner-start-end-shape` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `corner-start-start-shape` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `corner-top-left-shape` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `corner-top-right-shape` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `corner-top-shape` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `counter-increment` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `counter-reset` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `counter-set` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `cursor` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `custom-property` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `cx` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `cy` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `d` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `direction` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `display` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `dominant-baseline` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `dynamic-range-limit` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `empty-cells` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `field-sizing` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `fill` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `fill-opacity` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `fill-rule` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `filter` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `flex` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `flex-basis` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `flex-direction` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `flex-flow` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `flex-grow` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `flex-line-count` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `flex-shrink` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `flex-wrap` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `float` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `flood-color` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `flood-opacity` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `font` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `font-family` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `font-feature-settings` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `font-kerning` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `font-language-override` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `font-optical-sizing` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `font-palette` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `font-size` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `font-size-adjust` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `font-smooth` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `font-stretch` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `font-style` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `font-synthesis` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `font-synthesis-small-caps` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `font-synthesis-style` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `font-synthesis-weight` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `font-variant` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `font-variant-alternates` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `font-variant-caps` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `font-variant-east-asian` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `font-variant-emoji` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `font-variant-ligatures` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `font-variant-numeric` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `font-variant-position` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `font-variation-settings` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `font-weight` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `forced-color-adjust` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `frame-sizing` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `gap` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `grid` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `grid-area` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `grid-auto-columns` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `grid-auto-flow` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `grid-auto-rows` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `grid-column` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `grid-column-end` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `grid-column-start` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `grid-row` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `grid-row-end` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `grid-row-start` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `grid-template` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `grid-template-areas` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `grid-template-columns` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `grid-template-rows` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `height` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `hyphenate-character` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `hyphenate-limit-chars` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `hyphens` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `image-orientation` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `image-rendering` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `initial-letter` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `inline-size` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `inset` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `inset-block` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `inset-block-end` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `inset-block-start` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `inset-inline` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `inset-inline-end` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `inset-inline-start` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `interactivity` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `interest-delay` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `interest-delay-end` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `interest-delay-start` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `interpolate-size` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `isolation` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `justify-content` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `justify-items` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `justify-self` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `left` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `letter-spacing` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `lighting-color` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `line-break` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `line-clamp` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `line-height` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `list-style` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `list-style-image` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `list-style-position` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `list-style-type` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `margin` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `margin-block` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `margin-block-end` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `margin-block-start` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `margin-bottom` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `margin-inline` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `margin-inline-end` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `margin-inline-start` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `margin-left` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `margin-right` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `margin-top` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `marker` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `marker-end` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `marker-mid` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `marker-start` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `mask` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `mask-border` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `mask-border-outset` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `mask-border-repeat` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `mask-border-slice` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `mask-border-source` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `mask-border-width` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `mask-clip` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `mask-composite` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `mask-image` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `mask-mode` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `mask-origin` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `mask-position` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `mask-repeat` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `mask-size` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `mask-type` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `math-depth` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `math-shift` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `math-style` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `max-block-size` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `max-height` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `max-inline-size` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `max-width` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `min-block-size` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `min-height` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `min-inline-size` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `min-width` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `mix-blend-mode` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `object-fit` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `object-position` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `object-view-box` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `offset` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `offset-anchor` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `offset-distance` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `offset-path` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `offset-position` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `offset-rotate` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `opacity` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `order` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `orphans` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `outline` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `outline-color` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `outline-offset` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `outline-style` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `outline-width` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `overflow` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `overflow-anchor` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `overflow-block` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `overflow-clip-margin` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `overflow-inline` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `overflow-wrap` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `overflow-x` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `overflow-y` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `overlay` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `overscroll-behavior` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `overscroll-behavior-block` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `overscroll-behavior-inline` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `overscroll-behavior-x` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `overscroll-behavior-y` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `padding` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `padding-block` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `padding-block-end` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `padding-block-start` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `padding-bottom` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `padding-inline` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `padding-inline-end` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `padding-inline-start` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `padding-left` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `padding-right` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `padding-top` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `page` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `page-break-after` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `page-break-before` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `page-break-inside` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `paint-order` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `path-length` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `perspective` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `perspective-origin` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `place-content` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `place-items` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `place-self` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `pointer-events` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `position` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `position-anchor` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `position-area` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `position-try` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `position-try-fallbacks` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `position-try-order` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `position-visibility` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `print-color-adjust` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `quotes` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `r` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `reading-flow` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `reading-order` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `resize` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `right` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `rotate` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `row-gap` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `row-rule` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `row-rule-break` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `row-rule-color` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `row-rule-inset` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `row-rule-inset-cap` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `row-rule-inset-cap-end` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `row-rule-inset-cap-start` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `row-rule-inset-end` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `row-rule-inset-junction` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `row-rule-inset-junction-end` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `row-rule-inset-junction-start` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `row-rule-inset-start` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `row-rule-style` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `row-rule-visibility-items` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `row-rule-width` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `ruby-align` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `ruby-overhang` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `ruby-position` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `rule` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `rule-break` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `rule-color` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `rule-inset` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `rule-inset-cap` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `rule-inset-end` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `rule-inset-junction` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `rule-inset-start` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `rule-overlap` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `rule-style` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `rule-visibility-items` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `rule-width` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `rx` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `ry` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `scale` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `scroll-behavior` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `scroll-initial-target` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `scroll-margin` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `scroll-margin-block` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `scroll-margin-block-end` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `scroll-margin-block-start` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `scroll-margin-bottom` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `scroll-margin-inline` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `scroll-margin-inline-end` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `scroll-margin-inline-start` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `scroll-margin-left` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `scroll-margin-right` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `scroll-margin-top` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `scroll-marker-group` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `scroll-padding` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `scroll-padding-block` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `scroll-padding-block-end` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `scroll-padding-block-start` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `scroll-padding-bottom` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `scroll-padding-inline` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `scroll-padding-inline-end` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `scroll-padding-inline-start` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `scroll-padding-left` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `scroll-padding-right` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `scroll-padding-top` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `scroll-snap-align` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `scroll-snap-stop` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `scroll-snap-type` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `scroll-target-group` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `scroll-timeline` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `scroll-timeline-axis` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `scroll-timeline-name` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `scrollbar-color` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `scrollbar-gutter` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `scrollbar-width` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `shape-image-threshold` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `shape-margin` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `shape-outside` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `shape-rendering` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `speak` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `stop-color` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `stop-opacity` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `stroke` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `stroke-dasharray` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `stroke-dashoffset` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `stroke-linecap` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `stroke-linejoin` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `stroke-miterlimit` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `stroke-opacity` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `stroke-width` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `tab-size` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `table-layout` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `text-align` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `text-align-last` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `text-anchor` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `text-autospace` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `text-box` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `text-box-edge` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `text-box-trim` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `text-combine-upright` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `text-decoration` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `text-decoration-color` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `text-decoration-line` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `text-decoration-skip-ink` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `text-decoration-style` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `text-decoration-thickness` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `text-emphasis` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `text-emphasis-color` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `text-emphasis-position` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `text-emphasis-style` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `text-fit` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `text-indent` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `text-justify` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `text-orientation` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `text-overflow` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `text-rendering` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `text-shadow` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `text-size-adjust` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `text-spacing-trim` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `text-transform` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `text-underline-offset` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `text-underline-position` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `text-wrap` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `text-wrap-mode` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `text-wrap-style` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `timeline-scope` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `timeline-trigger` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `timeline-trigger-activation-range` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `timeline-trigger-activation-range-end` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `timeline-trigger-activation-range-start` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `timeline-trigger-active-range` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `timeline-trigger-active-range-end` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `timeline-trigger-active-range-start` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `timeline-trigger-name` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `timeline-trigger-source` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `top` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `touch-action` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `transform` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `transform-box` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `transform-origin` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `transform-style` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `transition` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `transition-behavior` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `transition-delay` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `transition-duration` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `transition-property` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `transition-timing-function` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `translate` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `trigger-scope` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `unicode-bidi` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `user-modify` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `user-select` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `vector-effect` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `vertical-align` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `view-timeline` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `view-timeline-axis` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `view-timeline-inset` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `view-timeline-name` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `view-transition-class` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `view-transition-group` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `view-transition-name` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `view-transition-scope` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `visibility` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `white-space` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `white-space-collapse` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `widows` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `width` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `will-change` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `window-drag` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `word-break` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `word-spacing` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `writing-mode` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `x` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `y` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `z-index` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |
| `zoom` | native | 安全过滤、单位转换后交给 WXSS；实际表现受微信版本影响 |

## CSS 选择器

| 能力 | 状态 | 说明 |
|---|---|---|
| `-webkit-inner-spin-button` | gap | 当前选择器引擎未声明支持 |
| `-webkit-meter-bar` | gap | 当前选择器引擎未声明支持 |
| `-webkit-meter-even-less-good-value` | gap | 当前选择器引擎未声明支持 |
| `-webkit-meter-inner-element` | gap | 当前选择器引擎未声明支持 |
| `-webkit-meter-optimum-value` | gap | 当前选择器引擎未声明支持 |
| `-webkit-meter-suboptimum-value` | gap | 当前选择器引擎未声明支持 |
| `-webkit-progress-bar` | gap | 当前选择器引擎未声明支持 |
| `-webkit-progress-inner-element` | gap | 当前选择器引擎未声明支持 |
| `-webkit-progress-value` | gap | 当前选择器引擎未声明支持 |
| `-webkit-resizer` | gap | 当前选择器引擎未声明支持 |
| `-webkit-scrollbar` | gap | 当前选择器引擎未声明支持 |
| `-webkit-scrollbar-button` | gap | 当前选择器引擎未声明支持 |
| `-webkit-scrollbar-corner` | gap | 当前选择器引擎未声明支持 |
| `-webkit-scrollbar-thumb` | gap | 当前选择器引擎未声明支持 |
| `-webkit-scrollbar-track` | gap | 当前选择器引擎未声明支持 |
| `-webkit-scrollbar-track-piece` | gap | 当前选择器引擎未声明支持 |
| `-webkit-search-cancel-button` | gap | 当前选择器引擎未声明支持 |
| `-webkit-search-results-button` | gap | 当前选择器引擎未声明支持 |
| `-webkit-slider-runnable-track` | gap | 当前选择器引擎未声明支持 |
| `-webkit-slider-thumb` | gap | 当前选择器引擎未声明支持 |
| `active` | degraded | 无浏览器交互状态，整条规则不误匹配 |
| `active-view-transition` | degraded | 无浏览器交互状态，整条规则不误匹配 |
| `active-view-transition-type` | degraded | 无浏览器交互状态，整条规则不误匹配 |
| `after` | engine | 本地选择器引擎匹配 |
| `any-link` | gap | 当前选择器引擎未声明支持 |
| `attribute` | engine | 本地选择器引擎匹配 |
| `autofill` | gap | 当前选择器引擎未声明支持 |
| `backdrop` | gap | 当前选择器引擎未声明支持 |
| `before` | engine | 本地选择器引擎匹配 |
| `buffering` | gap | 当前选择器引擎未声明支持 |
| `checked` | engine | 本地选择器引擎匹配 |
| `checkmark` | gap | 当前选择器引擎未声明支持 |
| `child` | engine | 本地选择器引擎匹配 |
| `class` | engine | 本地选择器引擎匹配 |
| `column` | gap | 当前选择器引擎未声明支持 |
| `cue` | gap | 当前选择器引擎未声明支持 |
| `default` | gap | 当前选择器引擎未声明支持 |
| `defined` | gap | 当前选择器引擎未声明支持 |
| `descendant` | engine | 本地选择器引擎匹配 |
| `details-content` | gap | 当前选择器引擎未声明支持 |
| `dir` | gap | 当前选择器引擎未声明支持 |
| `disabled` | engine | 本地选择器引擎匹配 |
| `empty` | engine | 本地选择器引擎匹配 |
| `enabled` | engine | 本地选择器引擎匹配 |
| `file-selector-button` | gap | 当前选择器引擎未声明支持 |
| `first` | gap | 当前选择器引擎未声明支持 |
| `first-child` | engine | 本地选择器引擎匹配 |
| `first-letter` | gap | 当前选择器引擎未声明支持 |
| `first-line` | gap | 当前选择器引擎未声明支持 |
| `first-of-type` | engine | 本地选择器引擎匹配 |
| `focus` | degraded | 无浏览器交互状态，整条规则不误匹配 |
| `focus-visible` | degraded | 无浏览器交互状态，整条规则不误匹配 |
| `focus-within` | degraded | 无浏览器交互状态，整条规则不误匹配 |
| `fullscreen` | gap | 当前选择器引擎未声明支持 |
| `future` | gap | 当前选择器引擎未声明支持 |
| `grammar-error` | gap | 当前选择器引擎未声明支持 |
| `has` | gap | 当前选择器引擎未声明支持 |
| `highlight` | gap | 当前选择器引擎未声明支持 |
| `host` | gap | 当前选择器引擎未声明支持 |
| `host-context` | gap | 当前选择器引擎未声明支持 |
| `hostfunction` | gap | 当前选择器引擎未声明支持 |
| `hover` | degraded | 无浏览器交互状态，整条规则不误匹配 |
| `id` | engine | 本地选择器引擎匹配 |
| `in-range` | gap | 当前选择器引擎未声明支持 |
| `indeterminate` | gap | 当前选择器引擎未声明支持 |
| `interest-source` | gap | 当前选择器引擎未声明支持 |
| `interest-target` | degraded | 无浏览器交互状态，整条规则不误匹配 |
| `invalid` | gap | 当前选择器引擎未声明支持 |
| `is` | gap | 当前选择器引擎未声明支持 |
| `lang` | gap | 当前选择器引擎未声明支持 |
| `last-child` | engine | 本地选择器引擎匹配 |
| `last-of-type` | engine | 本地选择器引擎匹配 |
| `left` | gap | 当前选择器引擎未声明支持 |
| `link` | gap | 当前选择器引擎未声明支持 |
| `list` | gap | 当前选择器引擎未声明支持 |
| `marker` | gap | 当前选择器引擎未声明支持 |
| `modal` | gap | 当前选择器引擎未声明支持 |
| `muted` | gap | 当前选择器引擎未声明支持 |
| `namespace` | gap | 当前选择器引擎未声明支持 |
| `nesting` | gap | 当前选择器引擎未声明支持 |
| `next-sibling` | engine | 本地选择器引擎匹配 |
| `not` | engine | 本地选择器引擎匹配 |
| `nth-child` | engine | 本地选择器引擎匹配 |
| `nth-last-child` | engine | 本地选择器引擎匹配 |
| `nth-last-of-type` | engine | 本地选择器引擎匹配 |
| `nth-of-type` | engine | 本地选择器引擎匹配 |
| `only-child` | engine | 本地选择器引擎匹配 |
| `only-of-type` | engine | 本地选择器引擎匹配 |
| `open` | gap | 当前选择器引擎未声明支持 |
| `optional` | engine | 本地选择器引擎匹配 |
| `out-of-range` | gap | 当前选择器引擎未声明支持 |
| `part` | gap | 当前选择器引擎未声明支持 |
| `past` | gap | 当前选择器引擎未声明支持 |
| `paused` | gap | 当前选择器引擎未声明支持 |
| `picker` | gap | 当前选择器引擎未声明支持 |
| `picker-icon` | gap | 当前选择器引擎未声明支持 |
| `picture-in-picture` | gap | 当前选择器引擎未声明支持 |
| `placeholder` | gap | 当前选择器引擎未声明支持 |
| `placeholder-shown` | gap | 当前选择器引擎未声明支持 |
| `playing` | gap | 当前选择器引擎未声明支持 |
| `popover-open` | gap | 当前选择器引擎未声明支持 |
| `read-only` | engine | 本地选择器引擎匹配 |
| `read-write` | engine | 本地选择器引擎匹配 |
| `required` | engine | 本地选择器引擎匹配 |
| `right` | gap | 当前选择器引擎未声明支持 |
| `root` | engine | 本地选择器引擎匹配 |
| `scope` | gap | 当前选择器引擎未声明支持 |
| `scroll-button` | gap | 当前选择器引擎未声明支持 |
| `scroll-marker` | gap | 当前选择器引擎未声明支持 |
| `scroll-marker-group` | gap | 当前选择器引擎未声明支持 |
| `search-text` | gap | 当前选择器引擎未声明支持 |
| `seeking` | gap | 当前选择器引擎未声明支持 |
| `selection` | gap | 当前选择器引擎未声明支持 |
| `slotted` | gap | 当前选择器引擎未声明支持 |
| `spelling-error` | gap | 当前选择器引擎未声明支持 |
| `stalled` | gap | 当前选择器引擎未声明支持 |
| `state` | gap | 当前选择器引擎未声明支持 |
| `subsequent-sibling` | engine | 本地选择器引擎匹配 |
| `target` | degraded | 无浏览器交互状态，整条规则不误匹配 |
| `target-after` | degraded | 无浏览器交互状态，整条规则不误匹配 |
| `target-before` | degraded | 无浏览器交互状态，整条规则不误匹配 |
| `target-current` | degraded | 无浏览器交互状态，整条规则不误匹配 |
| `target-text` | degraded | 无浏览器交互状态，整条规则不误匹配 |
| `type` | engine | 本地选择器引擎匹配 |
| `universal` | gap | 当前选择器引擎未声明支持 |
| `user-invalid` | gap | 当前选择器引擎未声明支持 |
| `user-valid` | gap | 当前选择器引擎未声明支持 |
| `valid` | gap | 当前选择器引擎未声明支持 |
| `view-transition` | gap | 当前选择器引擎未声明支持 |
| `view-transition-group` | gap | 当前选择器引擎未声明支持 |
| `view-transition-group-children` | gap | 当前选择器引擎未声明支持 |
| `view-transition-image-pair` | gap | 当前选择器引擎未声明支持 |
| `view-transition-new` | gap | 当前选择器引擎未声明支持 |
| `view-transition-old` | gap | 当前选择器引擎未声明支持 |
| `visited` | degraded | 无浏览器交互状态，整条规则不误匹配 |
| `volume-locked` | gap | 当前选择器引擎未声明支持 |
| `where` | gap | 当前选择器引擎未声明支持 |
| `xr-overlay` | gap | 当前选择器引擎未声明支持 |

## CSS @ 规则

| 能力 | 状态 | 说明 |
|---|---|---|
| `charset` | stripped | 离线与安全边界下移除 |
| `container` | gap | 当前未解释 |
| `counter-style` | gap | 当前未解释 |
| `font-face` | stripped | 离线与安全边界下移除 |
| `font-feature-values` | gap | 当前未解释 |
| `font-palette-values` | gap | 当前未解释 |
| `function` | gap | 当前未解释 |
| `import` | stripped | 离线与安全边界下移除 |
| `keyframes` | engine | 静态展开或固化最终帧 |
| `layer` | gap | 当前未解释 |
| `media` | engine | 静态展开或固化最终帧 |
| `namespace` | gap | 当前未解释 |
| `page` | gap | 当前未解释 |
| `position-try` | gap | 当前未解释 |
| `property` | gap | 当前未解释 |
| `scope` | gap | 当前未解释 |
| `starting-style` | gap | 当前未解释 |
| `supports` | engine | 静态展开或固化最终帧 |
| `view-transition` | gap | 当前未解释 |

## Web API 接口

| 能力 | 状态 | 说明 |
|---|---|---|
| `ANGLE_instanced_arrays` | gap | 未注入脚本沙盒 |
| `AbortController` | gap | 未注入脚本沙盒 |
| `AbortPaymentEvent` | gap | 未注入脚本沙盒 |
| `AbortSignal` | gap | 未注入脚本沙盒 |
| `AbsoluteOrientationSensor` | gap | 未注入脚本沙盒 |
| `AbstractRange` | gap | 未注入脚本沙盒 |
| `Accelerometer` | gap | 未注入脚本沙盒 |
| `AmbientLightSensor` | gap | 未注入脚本沙盒 |
| `AnalyserNode` | gap | 未注入脚本沙盒 |
| `Animation` | gap | 未注入脚本沙盒 |
| `AnimationEffect` | gap | 未注入脚本沙盒 |
| `AnimationEvent` | gap | 未注入脚本沙盒 |
| `AnimationPlaybackEvent` | gap | 未注入脚本沙盒 |
| `AnimationTimeline` | gap | 未注入脚本沙盒 |
| `AnimationTrigger` | gap | 未注入脚本沙盒 |
| `Attr` | gap | 未注入脚本沙盒 |
| `AudioBuffer` | gap | 未注入脚本沙盒 |
| `AudioBufferSourceNode` | gap | 未注入脚本沙盒 |
| `AudioContext` | gap | 未注入脚本沙盒 |
| `AudioData` | gap | 未注入脚本沙盒 |
| `AudioDecoder` | gap | 未注入脚本沙盒 |
| `AudioDestinationNode` | gap | 未注入脚本沙盒 |
| `AudioEncoder` | gap | 未注入脚本沙盒 |
| `AudioListener` | gap | 未注入脚本沙盒 |
| `AudioNode` | gap | 未注入脚本沙盒 |
| `AudioParam` | gap | 未注入脚本沙盒 |
| `AudioParamMap` | gap | 未注入脚本沙盒 |
| `AudioPlaybackStats` | gap | 未注入脚本沙盒 |
| `AudioProcessingEvent` | gap | 未注入脚本沙盒 |
| `AudioScheduledSourceNode` | gap | 未注入脚本沙盒 |
| `AudioSinkInfo` | gap | 未注入脚本沙盒 |
| `AudioTrack` | gap | 未注入脚本沙盒 |
| `AudioTrackList` | gap | 未注入脚本沙盒 |
| `AudioWorklet` | gap | 未注入脚本沙盒 |
| `AudioWorkletGlobalScope` | gap | 未注入脚本沙盒 |
| `AudioWorkletNode` | gap | 未注入脚本沙盒 |
| `AudioWorkletProcessor` | gap | 未注入脚本沙盒 |
| `AuthenticatorAssertionResponse` | gap | 未注入脚本沙盒 |
| `AuthenticatorAttestationResponse` | gap | 未注入脚本沙盒 |
| `AuthenticatorResponse` | gap | 未注入脚本沙盒 |
| `BackgroundFetchEvent` | gap | 未注入脚本沙盒 |
| `BackgroundFetchManager` | gap | 未注入脚本沙盒 |
| `BackgroundFetchRecord` | gap | 未注入脚本沙盒 |
| `BackgroundFetchRegistration` | gap | 未注入脚本沙盒 |
| `BackgroundFetchUpdateUIEvent` | gap | 未注入脚本沙盒 |
| `BarProp` | gap | 未注入脚本沙盒 |
| `BarcodeDetector` | gap | 未注入脚本沙盒 |
| `BaseAudioContext` | gap | 未注入脚本沙盒 |
| `BatteryManager` | gap | 未注入脚本沙盒 |
| `BeforeInstallPromptEvent` | gap | 未注入脚本沙盒 |
| `BeforeUnloadEvent` | gap | 未注入脚本沙盒 |
| `BiquadFilterNode` | gap | 未注入脚本沙盒 |
| `Blob` | shim | 隔离运行时提供受控实现 |
| `BlobEvent` | gap | 未注入脚本沙盒 |
| `Bluetooth` | gap | 未注入脚本沙盒 |
| `BluetoothCharacteristicProperties` | gap | 未注入脚本沙盒 |
| `BluetoothDevice` | gap | 未注入脚本沙盒 |
| `BluetoothRemoteGATTCharacteristic` | gap | 未注入脚本沙盒 |
| `BluetoothRemoteGATTDescriptor` | gap | 未注入脚本沙盒 |
| `BluetoothRemoteGATTServer` | gap | 未注入脚本沙盒 |
| `BluetoothRemoteGATTService` | gap | 未注入脚本沙盒 |
| `BluetoothUUID` | gap | 未注入脚本沙盒 |
| `BroadcastChannel` | gap | 未注入脚本沙盒 |
| `BrowserCaptureMediaStreamTrack` | gap | 未注入脚本沙盒 |
| `ByteLengthQueuingStrategy` | gap | 未注入脚本沙盒 |
| `CDATASection` | gap | 未注入脚本沙盒 |
| `CSPViolationReportBody` | gap | 未注入脚本沙盒 |
| `CSS` | gap | 未注入脚本沙盒 |
| `CSSAnimation` | gap | 未注入脚本沙盒 |
| `CSSConditionRule` | gap | 未注入脚本沙盒 |
| `CSSContainerRule` | gap | 未注入脚本沙盒 |
| `CSSCounterStyleRule` | gap | 未注入脚本沙盒 |
| `CSSFontFaceRule` | gap | 未注入脚本沙盒 |
| `CSSFontFeatureValuesMap` | gap | 未注入脚本沙盒 |
| `CSSFontFeatureValuesRule` | gap | 未注入脚本沙盒 |
| `CSSFontPaletteValuesRule` | gap | 未注入脚本沙盒 |
| `CSSFunctionDeclarations` | gap | 未注入脚本沙盒 |
| `CSSFunctionDescriptors` | gap | 未注入脚本沙盒 |
| `CSSFunctionRule` | gap | 未注入脚本沙盒 |
| `CSSGroupingRule` | gap | 未注入脚本沙盒 |
| `CSSImageValue` | gap | 未注入脚本沙盒 |
| `CSSImportRule` | gap | 未注入脚本沙盒 |
| `CSSKeyframeRule` | gap | 未注入脚本沙盒 |
| `CSSKeyframesRule` | gap | 未注入脚本沙盒 |
| `CSSKeywordValue` | gap | 未注入脚本沙盒 |
| `CSSLayerBlockRule` | gap | 未注入脚本沙盒 |
| `CSSLayerStatementRule` | gap | 未注入脚本沙盒 |
| `CSSMarginRule` | gap | 未注入脚本沙盒 |
| `CSSMathClamp` | gap | 未注入脚本沙盒 |
| `CSSMathInvert` | gap | 未注入脚本沙盒 |
| `CSSMathMax` | gap | 未注入脚本沙盒 |
| `CSSMathMin` | gap | 未注入脚本沙盒 |
| `CSSMathNegate` | gap | 未注入脚本沙盒 |
| `CSSMathProduct` | gap | 未注入脚本沙盒 |
| `CSSMathSum` | gap | 未注入脚本沙盒 |
| `CSSMathValue` | gap | 未注入脚本沙盒 |
| `CSSMatrixComponent` | gap | 未注入脚本沙盒 |
| `CSSMediaRule` | gap | 未注入脚本沙盒 |
| `CSSNamespaceRule` | gap | 未注入脚本沙盒 |
| `CSSNestedDeclarations` | gap | 未注入脚本沙盒 |
| `CSSNumericArray` | gap | 未注入脚本沙盒 |
| `CSSNumericValue` | gap | 未注入脚本沙盒 |
| `CSSPageRule` | gap | 未注入脚本沙盒 |
| `CSSPerspective` | gap | 未注入脚本沙盒 |
| `CSSPositionTryDescriptors` | gap | 未注入脚本沙盒 |
| `CSSPositionTryRule` | gap | 未注入脚本沙盒 |
| `CSSPositionValue` | gap | 未注入脚本沙盒 |
| `CSSPropertyRule` | gap | 未注入脚本沙盒 |
| `CSSPseudoElement` | gap | 未注入脚本沙盒 |
| `CSSRotate` | gap | 未注入脚本沙盒 |
| `CSSRule` | gap | 未注入脚本沙盒 |
| `CSSRuleList` | gap | 未注入脚本沙盒 |
| `CSSScale` | gap | 未注入脚本沙盒 |
| `CSSScopeRule` | gap | 未注入脚本沙盒 |
| `CSSSkew` | gap | 未注入脚本沙盒 |
| `CSSSkewX` | gap | 未注入脚本沙盒 |
| `CSSSkewY` | gap | 未注入脚本沙盒 |
| `CSSStartingStyleRule` | gap | 未注入脚本沙盒 |
| `CSSStyleDeclaration` | gap | 未注入脚本沙盒 |
| `CSSStyleRule` | gap | 未注入脚本沙盒 |
| `CSSStyleSheet` | gap | 未注入脚本沙盒 |
| `CSSStyleValue` | gap | 未注入脚本沙盒 |
| `CSSSupportsRule` | gap | 未注入脚本沙盒 |
| `CSSTransformComponent` | gap | 未注入脚本沙盒 |
| `CSSTransformValue` | gap | 未注入脚本沙盒 |
| `CSSTransition` | gap | 未注入脚本沙盒 |
| `CSSTranslate` | gap | 未注入脚本沙盒 |
| `CSSUnitValue` | gap | 未注入脚本沙盒 |
| `CSSUnparsedValue` | gap | 未注入脚本沙盒 |
| `CSSVariableReferenceValue` | gap | 未注入脚本沙盒 |
| `CSSViewTransitionRule` | gap | 未注入脚本沙盒 |
| `Cache` | gap | 未注入脚本沙盒 |
| `CacheStorage` | gap | 未注入脚本沙盒 |
| `CanMakePaymentEvent` | gap | 未注入脚本沙盒 |
| `CanvasCaptureMediaStreamTrack` | gap | 未注入脚本沙盒 |
| `CanvasFilter` | gap | 未注入脚本沙盒 |
| `CanvasGradient` | gap | 未注入脚本沙盒 |
| `CanvasPattern` | gap | 未注入脚本沙盒 |
| `CanvasRenderingContext2D` | shim | 隔离运行时提供受控实现 |
| `CaptureController` | gap | 未注入脚本沙盒 |
| `CaretPosition` | gap | 未注入脚本沙盒 |
| `ChannelMergerNode` | gap | 未注入脚本沙盒 |
| `ChannelSplitterNode` | gap | 未注入脚本沙盒 |
| `ChapterInformation` | gap | 未注入脚本沙盒 |
| `CharacterBoundsUpdateEvent` | gap | 未注入脚本沙盒 |
| `CharacterData` | gap | 未注入脚本沙盒 |
| `Client` | gap | 未注入脚本沙盒 |
| `Clients` | gap | 未注入脚本沙盒 |
| `Clipboard` | gap | 未注入脚本沙盒 |
| `ClipboardChangeEvent` | gap | 未注入脚本沙盒 |
| `ClipboardEvent` | gap | 未注入脚本沙盒 |
| `ClipboardItem` | gap | 未注入脚本沙盒 |
| `CloseEvent` | gap | 未注入脚本沙盒 |
| `CloseWatcher` | gap | 未注入脚本沙盒 |
| `CommandEvent` | gap | 未注入脚本沙盒 |
| `Comment` | gap | 未注入脚本沙盒 |
| `CompositionEvent` | gap | 未注入脚本沙盒 |
| `CompressionStream` | gap | 未注入脚本沙盒 |
| `ConstantSourceNode` | gap | 未注入脚本沙盒 |
| `ContentVisibilityAutoStateChangeEvent` | gap | 未注入脚本沙盒 |
| `ConvolverNode` | gap | 未注入脚本沙盒 |
| `CookieChangeEvent` | gap | 未注入脚本沙盒 |
| `CookieStore` | gap | 未注入脚本沙盒 |
| `CookieStoreManager` | gap | 未注入脚本沙盒 |
| `CountQueuingStrategy` | gap | 未注入脚本沙盒 |
| `CrashReportContext` | gap | 未注入脚本沙盒 |
| `CreateMonitor` | gap | 未注入脚本沙盒 |
| `Credential` | gap | 未注入脚本沙盒 |
| `CredentialsContainer` | gap | 未注入脚本沙盒 |
| `CropTarget` | gap | 未注入脚本沙盒 |
| `Crypto` | shim | 隔离运行时提供受控实现 |
| `CryptoKey` | gap | 未注入脚本沙盒 |
| `CustomElementRegistry` | gap | 未注入脚本沙盒 |
| `CustomEvent` | shim | 隔离运行时提供受控实现 |
| `CustomStateSet` | gap | 未注入脚本沙盒 |
| `DOMError` | gap | 未注入脚本沙盒 |
| `DOMException` | gap | 未注入脚本沙盒 |
| `DOMImplementation` | gap | 未注入脚本沙盒 |
| `DOMMatrix` | gap | 未注入脚本沙盒 |
| `DOMMatrixReadOnly` | gap | 未注入脚本沙盒 |
| `DOMParser` | gap | 未注入脚本沙盒 |
| `DOMPoint` | gap | 未注入脚本沙盒 |
| `DOMPointReadOnly` | gap | 未注入脚本沙盒 |
| `DOMQuad` | gap | 未注入脚本沙盒 |
| `DOMRect` | gap | 未注入脚本沙盒 |
| `DOMRectList` | gap | 未注入脚本沙盒 |
| `DOMRectReadOnly` | gap | 未注入脚本沙盒 |
| `DOMStringList` | gap | 未注入脚本沙盒 |
| `DOMStringMap` | gap | 未注入脚本沙盒 |
| `DOMTokenList` | gap | 未注入脚本沙盒 |
| `DataTransfer` | gap | 未注入脚本沙盒 |
| `DataTransferItem` | gap | 未注入脚本沙盒 |
| `DataTransferItemList` | gap | 未注入脚本沙盒 |
| `DecompressionStream` | gap | 未注入脚本沙盒 |
| `DedicatedWorkerGlobalScope` | gap | 未注入脚本沙盒 |
| `DelayNode` | gap | 未注入脚本沙盒 |
| `DelegatedInkTrailPresenter` | gap | 未注入脚本沙盒 |
| `DeprecationReportBody` | gap | 未注入脚本沙盒 |
| `DeviceMotionEvent` | gap | 未注入脚本沙盒 |
| `DeviceMotionEventAcceleration` | gap | 未注入脚本沙盒 |
| `DeviceMotionEventRotationRate` | gap | 未注入脚本沙盒 |
| `DeviceOrientationEvent` | gap | 未注入脚本沙盒 |
| `DevicePosture` | gap | 未注入脚本沙盒 |
| `DigitalCredential` | gap | 未注入脚本沙盒 |
| `DirectoryEntrySync` | gap | 未注入脚本沙盒 |
| `DirectoryReaderSync` | gap | 未注入脚本沙盒 |
| `Document` | shim | 隔离运行时提供受控实现 |
| `DocumentFragment` | gap | 未注入脚本沙盒 |
| `DocumentPictureInPicture` | gap | 未注入脚本沙盒 |
| `DocumentPictureInPictureEvent` | gap | 未注入脚本沙盒 |
| `DocumentTimeline` | gap | 未注入脚本沙盒 |
| `DocumentType` | gap | 未注入脚本沙盒 |
| `DragEvent` | gap | 未注入脚本沙盒 |
| `DynamicsCompressorNode` | gap | 未注入脚本沙盒 |
| `EXT_blend_minmax` | gap | 未注入脚本沙盒 |
| `EXT_color_buffer_float` | gap | 未注入脚本沙盒 |
| `EXT_color_buffer_half_float` | gap | 未注入脚本沙盒 |
| `EXT_disjoint_timer_query` | gap | 未注入脚本沙盒 |
| `EXT_disjoint_timer_query_webgl2` | gap | 未注入脚本沙盒 |
| `EXT_float_blend` | gap | 未注入脚本沙盒 |
| `EXT_frag_depth` | gap | 未注入脚本沙盒 |
| `EXT_sRGB` | gap | 未注入脚本沙盒 |
| `EXT_shader_texture_lod` | gap | 未注入脚本沙盒 |
| `EXT_texture_compression_bptc` | gap | 未注入脚本沙盒 |
| `EXT_texture_compression_rgtc` | gap | 未注入脚本沙盒 |
| `EXT_texture_filter_anisotropic` | gap | 未注入脚本沙盒 |
| `EXT_texture_norm16` | gap | 未注入脚本沙盒 |
| `EditContext` | gap | 未注入脚本沙盒 |
| `Element` | shim | 隔离运行时提供受控实现 |
| `ElementInternals` | gap | 未注入脚本沙盒 |
| `EncodedAudioChunk` | gap | 未注入脚本沙盒 |
| `EncodedVideoChunk` | gap | 未注入脚本沙盒 |
| `EntrySync` | gap | 未注入脚本沙盒 |
| `ErrorEvent` | gap | 未注入脚本沙盒 |
| `Event` | shim | 隔离运行时提供受控实现 |
| `EventCounts` | gap | 未注入脚本沙盒 |
| `EventSource` | gap | 未注入脚本沙盒 |
| `EventTarget` | gap | 未注入脚本沙盒 |
| `ExtendableCookieChangeEvent` | gap | 未注入脚本沙盒 |
| `ExtendableEvent` | gap | 未注入脚本沙盒 |
| `ExtendableMessageEvent` | gap | 未注入脚本沙盒 |
| `External` | gap | 未注入脚本沙盒 |
| `EyeDropper` | gap | 未注入脚本沙盒 |
| `FeaturePolicy` | gap | 未注入脚本沙盒 |
| `FederatedCredential` | gap | 未注入脚本沙盒 |
| `Fence` | gap | 未注入脚本沙盒 |
| `FencedFrameConfig` | gap | 未注入脚本沙盒 |
| `FetchEvent` | gap | 未注入脚本沙盒 |
| `FetchLaterResult` | gap | 未注入脚本沙盒 |
| `File` | gap | 未注入脚本沙盒 |
| `FileEntrySync` | gap | 未注入脚本沙盒 |
| `FileList` | gap | 未注入脚本沙盒 |
| `FileReader` | shim | 隔离运行时提供受控实现 |
| `FileReaderSync` | gap | 未注入脚本沙盒 |
| `FileSystem` | gap | 未注入脚本沙盒 |
| `FileSystemDirectoryEntry` | gap | 未注入脚本沙盒 |
| `FileSystemDirectoryHandle` | gap | 未注入脚本沙盒 |
| `FileSystemDirectoryReader` | gap | 未注入脚本沙盒 |
| `FileSystemEntry` | gap | 未注入脚本沙盒 |
| `FileSystemFileEntry` | gap | 未注入脚本沙盒 |
| `FileSystemFileHandle` | gap | 未注入脚本沙盒 |
| `FileSystemHandle` | gap | 未注入脚本沙盒 |
| `FileSystemObserver` | gap | 未注入脚本沙盒 |
| `FileSystemSync` | gap | 未注入脚本沙盒 |
| `FileSystemSyncAccessHandle` | gap | 未注入脚本沙盒 |
| `FileSystemWritableFileStream` | gap | 未注入脚本沙盒 |
| `FocusEvent` | gap | 未注入脚本沙盒 |
| `FontData` | gap | 未注入脚本沙盒 |
| `FontFace` | gap | 未注入脚本沙盒 |
| `FontFaceSet` | gap | 未注入脚本沙盒 |
| `FontFaceSetLoadEvent` | gap | 未注入脚本沙盒 |
| `FormData` | shim | 隔离运行时提供受控实现 |
| `FormDataEvent` | gap | 未注入脚本沙盒 |
| `FragmentDirective` | gap | 未注入脚本沙盒 |
| `GPU` | gap | 未注入脚本沙盒 |
| `GPUAdapter` | gap | 未注入脚本沙盒 |
| `GPUAdapterInfo` | gap | 未注入脚本沙盒 |
| `GPUBindGroup` | gap | 未注入脚本沙盒 |
| `GPUBindGroupLayout` | gap | 未注入脚本沙盒 |
| `GPUBuffer` | gap | 未注入脚本沙盒 |
| `GPUCanvasContext` | gap | 未注入脚本沙盒 |
| `GPUCommandBuffer` | gap | 未注入脚本沙盒 |
| `GPUCommandEncoder` | gap | 未注入脚本沙盒 |
| `GPUCompilationInfo` | gap | 未注入脚本沙盒 |
| `GPUCompilationMessage` | gap | 未注入脚本沙盒 |
| `GPUComputePassEncoder` | gap | 未注入脚本沙盒 |
| `GPUComputePipeline` | gap | 未注入脚本沙盒 |
| `GPUDevice` | gap | 未注入脚本沙盒 |
| `GPUDeviceLostInfo` | gap | 未注入脚本沙盒 |
| `GPUError` | gap | 未注入脚本沙盒 |
| `GPUExternalTexture` | gap | 未注入脚本沙盒 |
| `GPUInternalError` | gap | 未注入脚本沙盒 |
| `GPUOutOfMemoryError` | gap | 未注入脚本沙盒 |
| `GPUPipelineError` | gap | 未注入脚本沙盒 |
| `GPUPipelineLayout` | gap | 未注入脚本沙盒 |
| `GPUQuerySet` | gap | 未注入脚本沙盒 |
| `GPUQueue` | gap | 未注入脚本沙盒 |
| `GPURenderBundle` | gap | 未注入脚本沙盒 |
| `GPURenderBundleEncoder` | gap | 未注入脚本沙盒 |
| `GPURenderPassEncoder` | gap | 未注入脚本沙盒 |
| `GPURenderPipeline` | gap | 未注入脚本沙盒 |
| `GPUSampler` | gap | 未注入脚本沙盒 |
| `GPUShaderModule` | gap | 未注入脚本沙盒 |
| `GPUSupportedFeatures` | gap | 未注入脚本沙盒 |
| `GPUSupportedLimits` | gap | 未注入脚本沙盒 |
| `GPUTexture` | gap | 未注入脚本沙盒 |
| `GPUTextureView` | gap | 未注入脚本沙盒 |
| `GPUUncapturedErrorEvent` | gap | 未注入脚本沙盒 |
| `GPUValidationError` | gap | 未注入脚本沙盒 |
| `GainNode` | gap | 未注入脚本沙盒 |
| `Gamepad` | gap | 未注入脚本沙盒 |
| `GamepadButton` | gap | 未注入脚本沙盒 |
| `GamepadEvent` | gap | 未注入脚本沙盒 |
| `GamepadHapticActuator` | gap | 未注入脚本沙盒 |
| `Geolocation` | gap | 未注入脚本沙盒 |
| `GeolocationCoordinates` | gap | 未注入脚本沙盒 |
| `GeolocationPosition` | gap | 未注入脚本沙盒 |
| `GeolocationPositionError` | gap | 未注入脚本沙盒 |
| `GravitySensor` | gap | 未注入脚本沙盒 |
| `Gyroscope` | gap | 未注入脚本沙盒 |
| `HID` | gap | 未注入脚本沙盒 |
| `HIDConnectionEvent` | gap | 未注入脚本沙盒 |
| `HIDDevice` | gap | 未注入脚本沙盒 |
| `HIDInputReportEvent` | gap | 未注入脚本沙盒 |
| `HTMLAllCollection` | gap | 未注入脚本沙盒 |
| `HTMLAnchorElement` | gap | 未注入脚本沙盒 |
| `HTMLAreaElement` | gap | 未注入脚本沙盒 |
| `HTMLAudioElement` | gap | 未注入脚本沙盒 |
| `HTMLBRElement` | gap | 未注入脚本沙盒 |
| `HTMLBaseElement` | gap | 未注入脚本沙盒 |
| `HTMLBodyElement` | gap | 未注入脚本沙盒 |
| `HTMLButtonElement` | gap | 未注入脚本沙盒 |
| `HTMLCanvasElement` | shim | 隔离运行时提供受控实现 |
| `HTMLCollection` | gap | 未注入脚本沙盒 |
| `HTMLDListElement` | gap | 未注入脚本沙盒 |
| `HTMLDataElement` | gap | 未注入脚本沙盒 |
| `HTMLDataListElement` | gap | 未注入脚本沙盒 |
| `HTMLDetailsElement` | gap | 未注入脚本沙盒 |
| `HTMLDialogElement` | gap | 未注入脚本沙盒 |
| `HTMLDirectoryElement` | gap | 未注入脚本沙盒 |
| `HTMLDivElement` | gap | 未注入脚本沙盒 |
| `HTMLDocument` | gap | 未注入脚本沙盒 |
| `HTMLElement` | gap | 未注入脚本沙盒 |
| `HTMLEmbedElement` | gap | 未注入脚本沙盒 |
| `HTMLFencedFrameElement` | gap | 未注入脚本沙盒 |
| `HTMLFieldSetElement` | gap | 未注入脚本沙盒 |
| `HTMLFontElement` | gap | 未注入脚本沙盒 |
| `HTMLFormControlsCollection` | gap | 未注入脚本沙盒 |
| `HTMLFormElement` | gap | 未注入脚本沙盒 |
| `HTMLFrameElement` | gap | 未注入脚本沙盒 |
| `HTMLFrameSetElement` | gap | 未注入脚本沙盒 |
| `HTMLGeolocationElement` | gap | 未注入脚本沙盒 |
| `HTMLHRElement` | gap | 未注入脚本沙盒 |
| `HTMLHeadElement` | gap | 未注入脚本沙盒 |
| `HTMLHeadingElement` | gap | 未注入脚本沙盒 |
| `HTMLHtmlElement` | gap | 未注入脚本沙盒 |
| `HTMLIFrameElement` | gap | 未注入脚本沙盒 |
| `HTMLImageElement` | gap | 未注入脚本沙盒 |
| `HTMLInputElement` | gap | 未注入脚本沙盒 |
| `HTMLLIElement` | gap | 未注入脚本沙盒 |
| `HTMLLabelElement` | gap | 未注入脚本沙盒 |
| `HTMLLegendElement` | gap | 未注入脚本沙盒 |
| `HTMLLinkElement` | gap | 未注入脚本沙盒 |
| `HTMLMapElement` | gap | 未注入脚本沙盒 |
| `HTMLMarqueeElement` | gap | 未注入脚本沙盒 |
| `HTMLMediaElement` | gap | 未注入脚本沙盒 |
| `HTMLMenuElement` | gap | 未注入脚本沙盒 |
| `HTMLMetaElement` | gap | 未注入脚本沙盒 |
| `HTMLMeterElement` | gap | 未注入脚本沙盒 |
| `HTMLModElement` | gap | 未注入脚本沙盒 |
| `HTMLOListElement` | gap | 未注入脚本沙盒 |
| `HTMLObjectElement` | gap | 未注入脚本沙盒 |
| `HTMLOptGroupElement` | gap | 未注入脚本沙盒 |
| `HTMLOptionElement` | gap | 未注入脚本沙盒 |
| `HTMLOptionsCollection` | gap | 未注入脚本沙盒 |
| `HTMLOutputElement` | gap | 未注入脚本沙盒 |
| `HTMLParagraphElement` | gap | 未注入脚本沙盒 |
| `HTMLParamElement` | gap | 未注入脚本沙盒 |
| `HTMLPictureElement` | gap | 未注入脚本沙盒 |
| `HTMLPreElement` | gap | 未注入脚本沙盒 |
| `HTMLProgressElement` | gap | 未注入脚本沙盒 |
| `HTMLQuoteElement` | gap | 未注入脚本沙盒 |
| `HTMLScriptElement` | gap | 未注入脚本沙盒 |
| `HTMLSelectElement` | gap | 未注入脚本沙盒 |
| `HTMLSelectedContentElement` | gap | 未注入脚本沙盒 |
| `HTMLSlotElement` | gap | 未注入脚本沙盒 |
| `HTMLSourceElement` | gap | 未注入脚本沙盒 |
| `HTMLSpanElement` | gap | 未注入脚本沙盒 |
| `HTMLStyleElement` | gap | 未注入脚本沙盒 |
| `HTMLTableCaptionElement` | gap | 未注入脚本沙盒 |
| `HTMLTableCellElement` | gap | 未注入脚本沙盒 |
| `HTMLTableColElement` | gap | 未注入脚本沙盒 |
| `HTMLTableElement` | gap | 未注入脚本沙盒 |
| `HTMLTableRowElement` | gap | 未注入脚本沙盒 |
| `HTMLTableSectionElement` | gap | 未注入脚本沙盒 |
| `HTMLTemplateElement` | gap | 未注入脚本沙盒 |
| `HTMLTextAreaElement` | gap | 未注入脚本沙盒 |
| `HTMLTimeElement` | gap | 未注入脚本沙盒 |
| `HTMLTitleElement` | gap | 未注入脚本沙盒 |
| `HTMLTrackElement` | gap | 未注入脚本沙盒 |
| `HTMLUListElement` | gap | 未注入脚本沙盒 |
| `HTMLUnknownElement` | gap | 未注入脚本沙盒 |
| `HTMLVideoElement` | gap | 未注入脚本沙盒 |
| `HashChangeEvent` | gap | 未注入脚本沙盒 |
| `Headers` | gap | 未注入脚本沙盒 |
| `Highlight` | gap | 未注入脚本沙盒 |
| `HighlightRegistry` | gap | 未注入脚本沙盒 |
| `History` | shim | 隔离运行时提供受控实现 |
| `IDBCursor` | gap | 未注入脚本沙盒 |
| `IDBCursorWithValue` | gap | 未注入脚本沙盒 |
| `IDBDatabase` | gap | 未注入脚本沙盒 |
| `IDBFactory` | gap | 未注入脚本沙盒 |
| `IDBIndex` | gap | 未注入脚本沙盒 |
| `IDBKeyRange` | gap | 未注入脚本沙盒 |
| `IDBObjectStore` | gap | 未注入脚本沙盒 |
| `IDBOpenDBRequest` | gap | 未注入脚本沙盒 |
| `IDBRecord` | gap | 未注入脚本沙盒 |
| `IDBRequest` | gap | 未注入脚本沙盒 |
| `IDBTransaction` | gap | 未注入脚本沙盒 |
| `IDBVersionChangeEvent` | gap | 未注入脚本沙盒 |
| `IIRFilterNode` | gap | 未注入脚本沙盒 |
| `IdentityCredential` | gap | 未注入脚本沙盒 |
| `IdentityCredentialError` | gap | 未注入脚本沙盒 |
| `IdentityProvider` | gap | 未注入脚本沙盒 |
| `IdleDeadline` | gap | 未注入脚本沙盒 |
| `IdleDetector` | gap | 未注入脚本沙盒 |
| `ImageBitmap` | gap | 未注入脚本沙盒 |
| `ImageBitmapRenderingContext` | gap | 未注入脚本沙盒 |
| `ImageCapture` | gap | 未注入脚本沙盒 |
| `ImageData` | gap | 未注入脚本沙盒 |
| `ImageDecoder` | gap | 未注入脚本沙盒 |
| `ImageTrack` | gap | 未注入脚本沙盒 |
| `ImageTrackList` | gap | 未注入脚本沙盒 |
| `Ink` | gap | 未注入脚本沙盒 |
| `InputDeviceCapabilities` | gap | 未注入脚本沙盒 |
| `InputDeviceInfo` | gap | 未注入脚本沙盒 |
| `InputEvent` | gap | 未注入脚本沙盒 |
| `InstallEvent` | gap | 未注入脚本沙盒 |
| `InterestEvent` | gap | 未注入脚本沙盒 |
| `IntersectionObserver` | shim | 隔离运行时提供受控实现 |
| `IntersectionObserverEntry` | gap | 未注入脚本沙盒 |
| `InterventionReportBody` | gap | 未注入脚本沙盒 |
| `KHR_parallel_shader_compile` | gap | 未注入脚本沙盒 |
| `Keyboard` | gap | 未注入脚本沙盒 |
| `KeyboardEvent` | gap | 未注入脚本沙盒 |
| `KeyboardLayoutMap` | gap | 未注入脚本沙盒 |
| `KeyframeEffect` | gap | 未注入脚本沙盒 |
| `LanguageDetector` | gap | 未注入脚本沙盒 |
| `LanguageModel` | gap | 未注入脚本沙盒 |
| `LargestContentfulPaint` | gap | 未注入脚本沙盒 |
| `LaunchParams` | gap | 未注入脚本沙盒 |
| `LaunchQueue` | gap | 未注入脚本沙盒 |
| `LayoutShift` | gap | 未注入脚本沙盒 |
| `LayoutShiftAttribution` | gap | 未注入脚本沙盒 |
| `LinearAccelerationSensor` | gap | 未注入脚本沙盒 |
| `Location` | shim | 隔离运行时提供受控实现 |
| `Lock` | gap | 未注入脚本沙盒 |
| `LockManager` | gap | 未注入脚本沙盒 |
| `MIDIAccess` | gap | 未注入脚本沙盒 |
| `MIDIConnectionEvent` | gap | 未注入脚本沙盒 |
| `MIDIInput` | gap | 未注入脚本沙盒 |
| `MIDIInputMap` | gap | 未注入脚本沙盒 |
| `MIDIMessageEvent` | gap | 未注入脚本沙盒 |
| `MIDIOutput` | gap | 未注入脚本沙盒 |
| `MIDIOutputMap` | gap | 未注入脚本沙盒 |
| `MIDIPort` | gap | 未注入脚本沙盒 |
| `ML` | gap | 未注入脚本沙盒 |
| `MLContext` | gap | 未注入脚本沙盒 |
| `MLGraph` | gap | 未注入脚本沙盒 |
| `MLGraphBuilder` | gap | 未注入脚本沙盒 |
| `MLOperand` | gap | 未注入脚本沙盒 |
| `MLTensor` | gap | 未注入脚本沙盒 |
| `Magnetometer` | gap | 未注入脚本沙盒 |
| `MathMLElement` | gap | 未注入脚本沙盒 |
| `MediaCapabilities` | gap | 未注入脚本沙盒 |
| `MediaDeviceInfo` | gap | 未注入脚本沙盒 |
| `MediaDevices` | gap | 未注入脚本沙盒 |
| `MediaElementAudioSourceNode` | gap | 未注入脚本沙盒 |
| `MediaEncryptedEvent` | gap | 未注入脚本沙盒 |
| `MediaError` | gap | 未注入脚本沙盒 |
| `MediaKeyMessageEvent` | gap | 未注入脚本沙盒 |
| `MediaKeySession` | gap | 未注入脚本沙盒 |
| `MediaKeyStatusMap` | gap | 未注入脚本沙盒 |
| `MediaKeySystemAccess` | gap | 未注入脚本沙盒 |
| `MediaKeys` | gap | 未注入脚本沙盒 |
| `MediaList` | gap | 未注入脚本沙盒 |
| `MediaMetadata` | gap | 未注入脚本沙盒 |
| `MediaQueryList` | degraded | 提供稳定只读、离线或 noop 语义 |
| `MediaQueryListEvent` | gap | 未注入脚本沙盒 |
| `MediaRecorder` | gap | 未注入脚本沙盒 |
| `MediaSession` | gap | 未注入脚本沙盒 |
| `MediaSource` | gap | 未注入脚本沙盒 |
| `MediaSourceHandle` | gap | 未注入脚本沙盒 |
| `MediaStream` | gap | 未注入脚本沙盒 |
| `MediaStreamAudioDestinationNode` | gap | 未注入脚本沙盒 |
| `MediaStreamAudioSourceNode` | gap | 未注入脚本沙盒 |
| `MediaStreamEvent` | gap | 未注入脚本沙盒 |
| `MediaStreamTrack` | gap | 未注入脚本沙盒 |
| `MediaStreamTrackEvent` | gap | 未注入脚本沙盒 |
| `MediaStreamTrackGenerator` | gap | 未注入脚本沙盒 |
| `MediaStreamTrackProcessor` | gap | 未注入脚本沙盒 |
| `MessageChannel` | gap | 未注入脚本沙盒 |
| `MessageEvent` | gap | 未注入脚本沙盒 |
| `MessagePort` | gap | 未注入脚本沙盒 |
| `Metadata` | gap | 未注入脚本沙盒 |
| `MimeType` | gap | 未注入脚本沙盒 |
| `MimeTypeArray` | gap | 未注入脚本沙盒 |
| `MouseEvent` | gap | 未注入脚本沙盒 |
| `MutationObserver` | gap | 未注入脚本沙盒 |
| `MutationRecord` | gap | 未注入脚本沙盒 |
| `NamedNodeMap` | gap | 未注入脚本沙盒 |
| `NavigateEvent` | gap | 未注入脚本沙盒 |
| `Navigation` | gap | 未注入脚本沙盒 |
| `NavigationActivation` | gap | 未注入脚本沙盒 |
| `NavigationCurrentEntryChangeEvent` | gap | 未注入脚本沙盒 |
| `NavigationDestination` | gap | 未注入脚本沙盒 |
| `NavigationHistoryEntry` | gap | 未注入脚本沙盒 |
| `NavigationPrecommitController` | gap | 未注入脚本沙盒 |
| `NavigationPreloadManager` | gap | 未注入脚本沙盒 |
| `NavigationTransition` | gap | 未注入脚本沙盒 |
| `Navigator` | degraded | 提供稳定只读、离线或 noop 语义 |
| `NavigatorLogin` | gap | 未注入脚本沙盒 |
| `NavigatorManagedData` | gap | 未注入脚本沙盒 |
| `NavigatorUAData` | gap | 未注入脚本沙盒 |
| `NetworkInformation` | gap | 未注入脚本沙盒 |
| `Node` | shim | 隔离运行时提供受控实现 |
| `NodeIterator` | gap | 未注入脚本沙盒 |
| `NodeList` | gap | 未注入脚本沙盒 |
| `NotRestoredReasonDetails` | gap | 未注入脚本沙盒 |
| `NotRestoredReasons` | gap | 未注入脚本沙盒 |
| `Notification` | gap | 未注入脚本沙盒 |
| `NotificationEvent` | gap | 未注入脚本沙盒 |
| `OES_draw_buffers_indexed` | gap | 未注入脚本沙盒 |
| `OES_element_index_uint` | gap | 未注入脚本沙盒 |
| `OES_fbo_render_mipmap` | gap | 未注入脚本沙盒 |
| `OES_standard_derivatives` | gap | 未注入脚本沙盒 |
| `OES_texture_float` | gap | 未注入脚本沙盒 |
| `OES_texture_float_linear` | gap | 未注入脚本沙盒 |
| `OES_texture_half_float` | gap | 未注入脚本沙盒 |
| `OES_texture_half_float_linear` | gap | 未注入脚本沙盒 |
| `OES_vertex_array_object` | gap | 未注入脚本沙盒 |
| `OTPCredential` | gap | 未注入脚本沙盒 |
| `OVR_multiview2` | gap | 未注入脚本沙盒 |
| `Observable` | gap | 未注入脚本沙盒 |
| `OfflineAudioCompletionEvent` | gap | 未注入脚本沙盒 |
| `OfflineAudioContext` | gap | 未注入脚本沙盒 |
| `OffscreenCanvas` | gap | 未注入脚本沙盒 |
| `OffscreenCanvasRenderingContext2D` | gap | 未注入脚本沙盒 |
| `OrientationSensor` | gap | 未注入脚本沙盒 |
| `Origin` | gap | 未注入脚本沙盒 |
| `OscillatorNode` | gap | 未注入脚本沙盒 |
| `OverconstrainedError` | gap | 未注入脚本沙盒 |
| `PageRevealEvent` | gap | 未注入脚本沙盒 |
| `PageSwapEvent` | gap | 未注入脚本沙盒 |
| `PageTransitionEvent` | gap | 未注入脚本沙盒 |
| `PaintRenderingContext2D` | gap | 未注入脚本沙盒 |
| `PaintSize` | gap | 未注入脚本沙盒 |
| `PaintWorkletGlobalScope` | gap | 未注入脚本沙盒 |
| `PannerNode` | gap | 未注入脚本沙盒 |
| `PasswordCredential` | gap | 未注入脚本沙盒 |
| `Path2D` | gap | 未注入脚本沙盒 |
| `PaymentAddress` | gap | 未注入脚本沙盒 |
| `PaymentManager` | gap | 未注入脚本沙盒 |
| `PaymentMethodChangeEvent` | gap | 未注入脚本沙盒 |
| `PaymentRequest` | gap | 未注入脚本沙盒 |
| `PaymentRequestEvent` | gap | 未注入脚本沙盒 |
| `PaymentRequestUpdateEvent` | gap | 未注入脚本沙盒 |
| `PaymentResponse` | gap | 未注入脚本沙盒 |
| `Performance` | degraded | 提供稳定只读、离线或 noop 语义 |
| `PerformanceElementTiming` | gap | 未注入脚本沙盒 |
| `PerformanceEntry` | gap | 未注入脚本沙盒 |
| `PerformanceEventTiming` | gap | 未注入脚本沙盒 |
| `PerformanceLongAnimationFrameTiming` | gap | 未注入脚本沙盒 |
| `PerformanceLongTaskTiming` | gap | 未注入脚本沙盒 |
| `PerformanceMark` | gap | 未注入脚本沙盒 |
| `PerformanceMeasure` | gap | 未注入脚本沙盒 |
| `PerformanceNavigation` | gap | 未注入脚本沙盒 |
| `PerformanceNavigationTiming` | gap | 未注入脚本沙盒 |
| `PerformanceObserver` | gap | 未注入脚本沙盒 |
| `PerformanceObserverEntryList` | gap | 未注入脚本沙盒 |
| `PerformancePaintTiming` | gap | 未注入脚本沙盒 |
| `PerformanceResourceTiming` | gap | 未注入脚本沙盒 |
| `PerformanceScriptTiming` | gap | 未注入脚本沙盒 |
| `PerformanceServerTiming` | gap | 未注入脚本沙盒 |
| `PerformanceTiming` | gap | 未注入脚本沙盒 |
| `PerformanceTimingConfidence` | gap | 未注入脚本沙盒 |
| `PeriodicSyncEvent` | gap | 未注入脚本沙盒 |
| `PeriodicSyncManager` | gap | 未注入脚本沙盒 |
| `PeriodicWave` | gap | 未注入脚本沙盒 |
| `PermissionStatus` | gap | 未注入脚本沙盒 |
| `Permissions` | gap | 未注入脚本沙盒 |
| `PermissionsPolicy` | gap | 未注入脚本沙盒 |
| `PictureInPictureEvent` | gap | 未注入脚本沙盒 |
| `PictureInPictureWindow` | gap | 未注入脚本沙盒 |
| `Plugin` | gap | 未注入脚本沙盒 |
| `PluginArray` | gap | 未注入脚本沙盒 |
| `PointerEvent` | gap | 未注入脚本沙盒 |
| `PopStateEvent` | gap | 未注入脚本沙盒 |
| `PreferenceManager` | gap | 未注入脚本沙盒 |
| `PreferenceObject` | gap | 未注入脚本沙盒 |
| `Presentation` | gap | 未注入脚本沙盒 |
| `PresentationAvailability` | gap | 未注入脚本沙盒 |
| `PresentationConnection` | gap | 未注入脚本沙盒 |
| `PresentationConnectionAvailableEvent` | gap | 未注入脚本沙盒 |
| `PresentationConnectionCloseEvent` | gap | 未注入脚本沙盒 |
| `PresentationConnectionList` | gap | 未注入脚本沙盒 |
| `PresentationReceiver` | gap | 未注入脚本沙盒 |
| `PresentationRequest` | gap | 未注入脚本沙盒 |
| `PressureObserver` | gap | 未注入脚本沙盒 |
| `PressureRecord` | gap | 未注入脚本沙盒 |
| `ProcessingInstruction` | gap | 未注入脚本沙盒 |
| `Profiler` | gap | 未注入脚本沙盒 |
| `ProgressEvent` | gap | 未注入脚本沙盒 |
| `PromiseRejectionEvent` | gap | 未注入脚本沙盒 |
| `ProtectedAudience` | gap | 未注入脚本沙盒 |
| `PublicKeyCredential` | gap | 未注入脚本沙盒 |
| `PushEvent` | gap | 未注入脚本沙盒 |
| `PushManager` | gap | 未注入脚本沙盒 |
| `PushMessageData` | gap | 未注入脚本沙盒 |
| `PushSubscription` | gap | 未注入脚本沙盒 |
| `PushSubscriptionChangeEvent` | gap | 未注入脚本沙盒 |
| `PushSubscriptionOptions` | gap | 未注入脚本沙盒 |
| `QuotaExceededError` | gap | 未注入脚本沙盒 |
| `RTCCertificate` | gap | 未注入脚本沙盒 |
| `RTCDTMFSender` | gap | 未注入脚本沙盒 |
| `RTCDTMFToneChangeEvent` | gap | 未注入脚本沙盒 |
| `RTCDataChannel` | gap | 未注入脚本沙盒 |
| `RTCDataChannelEvent` | gap | 未注入脚本沙盒 |
| `RTCDtlsTransport` | gap | 未注入脚本沙盒 |
| `RTCEncodedAudioFrame` | gap | 未注入脚本沙盒 |
| `RTCEncodedVideoFrame` | gap | 未注入脚本沙盒 |
| `RTCError` | gap | 未注入脚本沙盒 |
| `RTCErrorEvent` | gap | 未注入脚本沙盒 |
| `RTCIceCandidate` | gap | 未注入脚本沙盒 |
| `RTCIceTransport` | gap | 未注入脚本沙盒 |
| `RTCPeerConnection` | gap | 未注入脚本沙盒 |
| `RTCPeerConnectionIceErrorEvent` | gap | 未注入脚本沙盒 |
| `RTCPeerConnectionIceEvent` | gap | 未注入脚本沙盒 |
| `RTCRtpReceiver` | gap | 未注入脚本沙盒 |
| `RTCRtpScriptTransform` | gap | 未注入脚本沙盒 |
| `RTCRtpScriptTransformer` | gap | 未注入脚本沙盒 |
| `RTCRtpSender` | gap | 未注入脚本沙盒 |
| `RTCRtpTransceiver` | gap | 未注入脚本沙盒 |
| `RTCSctpTransport` | gap | 未注入脚本沙盒 |
| `RTCSessionDescription` | gap | 未注入脚本沙盒 |
| `RTCStatsReport` | gap | 未注入脚本沙盒 |
| `RTCTrackEvent` | gap | 未注入脚本沙盒 |
| `RTCTransformEvent` | gap | 未注入脚本沙盒 |
| `RadioNodeList` | gap | 未注入脚本沙盒 |
| `Range` | gap | 未注入脚本沙盒 |
| `ReadableByteStreamController` | gap | 未注入脚本沙盒 |
| `ReadableStream` | gap | 未注入脚本沙盒 |
| `ReadableStreamBYOBReader` | gap | 未注入脚本沙盒 |
| `ReadableStreamBYOBRequest` | gap | 未注入脚本沙盒 |
| `ReadableStreamDefaultController` | gap | 未注入脚本沙盒 |
| `ReadableStreamDefaultReader` | gap | 未注入脚本沙盒 |
| `RelativeOrientationSensor` | gap | 未注入脚本沙盒 |
| `RemotePlayback` | gap | 未注入脚本沙盒 |
| `Report` | gap | 未注入脚本沙盒 |
| `ReportBody` | gap | 未注入脚本沙盒 |
| `ReportingObserver` | gap | 未注入脚本沙盒 |
| `Request` | gap | 未注入脚本沙盒 |
| `ResizeObserver` | gap | 未注入脚本沙盒 |
| `ResizeObserverEntry` | gap | 未注入脚本沙盒 |
| `ResizeObserverSize` | gap | 未注入脚本沙盒 |
| `Response` | gap | 未注入脚本沙盒 |
| `RestrictionTarget` | gap | 未注入脚本沙盒 |
| `SVGAElement` | gap | 未注入脚本沙盒 |
| `SVGAngle` | gap | 未注入脚本沙盒 |
| `SVGAnimateElement` | gap | 未注入脚本沙盒 |
| `SVGAnimateMotionElement` | gap | 未注入脚本沙盒 |
| `SVGAnimateTransformElement` | gap | 未注入脚本沙盒 |
| `SVGAnimatedAngle` | gap | 未注入脚本沙盒 |
| `SVGAnimatedBoolean` | gap | 未注入脚本沙盒 |
| `SVGAnimatedEnumeration` | gap | 未注入脚本沙盒 |
| `SVGAnimatedInteger` | gap | 未注入脚本沙盒 |
| `SVGAnimatedLength` | gap | 未注入脚本沙盒 |
| `SVGAnimatedLengthList` | gap | 未注入脚本沙盒 |
| `SVGAnimatedNumber` | gap | 未注入脚本沙盒 |
| `SVGAnimatedNumberList` | gap | 未注入脚本沙盒 |
| `SVGAnimatedPreserveAspectRatio` | gap | 未注入脚本沙盒 |
| `SVGAnimatedRect` | gap | 未注入脚本沙盒 |
| `SVGAnimatedString` | gap | 未注入脚本沙盒 |
| `SVGAnimatedTransformList` | gap | 未注入脚本沙盒 |
| `SVGAnimationElement` | gap | 未注入脚本沙盒 |
| `SVGCircleElement` | gap | 未注入脚本沙盒 |
| `SVGClipPathElement` | gap | 未注入脚本沙盒 |
| `SVGComponentTransferFunctionElement` | gap | 未注入脚本沙盒 |
| `SVGDefsElement` | gap | 未注入脚本沙盒 |
| `SVGDescElement` | gap | 未注入脚本沙盒 |
| `SVGElement` | gap | 未注入脚本沙盒 |
| `SVGEllipseElement` | gap | 未注入脚本沙盒 |
| `SVGFEBlendElement` | gap | 未注入脚本沙盒 |
| `SVGFEColorMatrixElement` | gap | 未注入脚本沙盒 |
| `SVGFEComponentTransferElement` | gap | 未注入脚本沙盒 |
| `SVGFECompositeElement` | gap | 未注入脚本沙盒 |
| `SVGFEConvolveMatrixElement` | gap | 未注入脚本沙盒 |
| `SVGFEDiffuseLightingElement` | gap | 未注入脚本沙盒 |
| `SVGFEDisplacementMapElement` | gap | 未注入脚本沙盒 |
| `SVGFEDistantLightElement` | gap | 未注入脚本沙盒 |
| `SVGFEDropShadowElement` | gap | 未注入脚本沙盒 |
| `SVGFEFloodElement` | gap | 未注入脚本沙盒 |
| `SVGFEFuncAElement` | gap | 未注入脚本沙盒 |
| `SVGFEFuncBElement` | gap | 未注入脚本沙盒 |
| `SVGFEFuncGElement` | gap | 未注入脚本沙盒 |
| `SVGFEFuncRElement` | gap | 未注入脚本沙盒 |
| `SVGFEGaussianBlurElement` | gap | 未注入脚本沙盒 |
| `SVGFEImageElement` | gap | 未注入脚本沙盒 |
| `SVGFEMergeElement` | gap | 未注入脚本沙盒 |
| `SVGFEMergeNodeElement` | gap | 未注入脚本沙盒 |
| `SVGFEMorphologyElement` | gap | 未注入脚本沙盒 |
| `SVGFEOffsetElement` | gap | 未注入脚本沙盒 |
| `SVGFEPointLightElement` | gap | 未注入脚本沙盒 |
| `SVGFESpecularLightingElement` | gap | 未注入脚本沙盒 |
| `SVGFESpotLightElement` | gap | 未注入脚本沙盒 |
| `SVGFETileElement` | gap | 未注入脚本沙盒 |
| `SVGFETurbulenceElement` | gap | 未注入脚本沙盒 |
| `SVGFilterElement` | gap | 未注入脚本沙盒 |
| `SVGForeignObjectElement` | gap | 未注入脚本沙盒 |
| `SVGGElement` | gap | 未注入脚本沙盒 |
| `SVGGeometryElement` | gap | 未注入脚本沙盒 |
| `SVGGradientElement` | gap | 未注入脚本沙盒 |
| `SVGGraphicsElement` | gap | 未注入脚本沙盒 |
| `SVGImageElement` | gap | 未注入脚本沙盒 |
| `SVGLength` | gap | 未注入脚本沙盒 |
| `SVGLengthList` | gap | 未注入脚本沙盒 |
| `SVGLineElement` | gap | 未注入脚本沙盒 |
| `SVGLinearGradientElement` | gap | 未注入脚本沙盒 |
| `SVGMPathElement` | gap | 未注入脚本沙盒 |
| `SVGMarkerElement` | gap | 未注入脚本沙盒 |
| `SVGMaskElement` | gap | 未注入脚本沙盒 |
| `SVGMetadataElement` | gap | 未注入脚本沙盒 |
| `SVGNumber` | gap | 未注入脚本沙盒 |
| `SVGNumberList` | gap | 未注入脚本沙盒 |
| `SVGPathElement` | gap | 未注入脚本沙盒 |
| `SVGPatternElement` | gap | 未注入脚本沙盒 |
| `SVGPoint` | gap | 未注入脚本沙盒 |
| `SVGPointList` | gap | 未注入脚本沙盒 |
| `SVGPolygonElement` | gap | 未注入脚本沙盒 |
| `SVGPolylineElement` | gap | 未注入脚本沙盒 |
| `SVGPreserveAspectRatio` | gap | 未注入脚本沙盒 |
| `SVGRadialGradientElement` | gap | 未注入脚本沙盒 |
| `SVGRect` | gap | 未注入脚本沙盒 |
| `SVGRectElement` | gap | 未注入脚本沙盒 |
| `SVGSVGElement` | gap | 未注入脚本沙盒 |
| `SVGScriptElement` | gap | 未注入脚本沙盒 |
| `SVGSetElement` | gap | 未注入脚本沙盒 |
| `SVGStopElement` | gap | 未注入脚本沙盒 |
| `SVGStringList` | gap | 未注入脚本沙盒 |
| `SVGStyleElement` | gap | 未注入脚本沙盒 |
| `SVGSwitchElement` | gap | 未注入脚本沙盒 |
| `SVGSymbolElement` | gap | 未注入脚本沙盒 |
| `SVGTSpanElement` | gap | 未注入脚本沙盒 |
| `SVGTextContentElement` | gap | 未注入脚本沙盒 |
| `SVGTextElement` | gap | 未注入脚本沙盒 |
| `SVGTextPathElement` | gap | 未注入脚本沙盒 |
| `SVGTextPositioningElement` | gap | 未注入脚本沙盒 |
| `SVGTitleElement` | gap | 未注入脚本沙盒 |
| `SVGTransform` | gap | 未注入脚本沙盒 |
| `SVGTransformList` | gap | 未注入脚本沙盒 |
| `SVGUnitTypes` | gap | 未注入脚本沙盒 |
| `SVGUseElement` | gap | 未注入脚本沙盒 |
| `SVGViewElement` | gap | 未注入脚本沙盒 |
| `Sanitizer` | gap | 未注入脚本沙盒 |
| `Scheduler` | gap | 未注入脚本沙盒 |
| `Scheduling` | gap | 未注入脚本沙盒 |
| `Screen` | degraded | 提供稳定只读、离线或 noop 语义 |
| `ScreenDetailed` | gap | 未注入脚本沙盒 |
| `ScreenDetails` | gap | 未注入脚本沙盒 |
| `ScreenOrientation` | gap | 未注入脚本沙盒 |
| `ScriptProcessorNode` | gap | 未注入脚本沙盒 |
| `ScrollTimeline` | gap | 未注入脚本沙盒 |
| `SecurityPolicyViolationEvent` | gap | 未注入脚本沙盒 |
| `Selection` | gap | 未注入脚本沙盒 |
| `Sensor` | gap | 未注入脚本沙盒 |
| `SensorErrorEvent` | gap | 未注入脚本沙盒 |
| `Serial` | gap | 未注入脚本沙盒 |
| `SerialPort` | gap | 未注入脚本沙盒 |
| `ServiceWorker` | gap | 未注入脚本沙盒 |
| `ServiceWorkerContainer` | gap | 未注入脚本沙盒 |
| `ServiceWorkerGlobalScope` | gap | 未注入脚本沙盒 |
| `ServiceWorkerRegistration` | gap | 未注入脚本沙盒 |
| `ShadowRoot` | gap | 未注入脚本沙盒 |
| `SharedStorage` | gap | 未注入脚本沙盒 |
| `SharedStorageAppendMethod` | gap | 未注入脚本沙盒 |
| `SharedStorageClearMethod` | gap | 未注入脚本沙盒 |
| `SharedStorageDeleteMethod` | gap | 未注入脚本沙盒 |
| `SharedStorageModifierMethod` | gap | 未注入脚本沙盒 |
| `SharedStorageSetMethod` | gap | 未注入脚本沙盒 |
| `SharedStorageWorklet` | gap | 未注入脚本沙盒 |
| `SharedStorageWorkletGlobalScope` | gap | 未注入脚本沙盒 |
| `SharedWorker` | gap | 未注入脚本沙盒 |
| `SharedWorkerGlobalScope` | gap | 未注入脚本沙盒 |
| `SnapEvent` | gap | 未注入脚本沙盒 |
| `SourceBuffer` | gap | 未注入脚本沙盒 |
| `SourceBufferList` | gap | 未注入脚本沙盒 |
| `SpeechGrammar` | gap | 未注入脚本沙盒 |
| `SpeechGrammarList` | gap | 未注入脚本沙盒 |
| `SpeechRecognition` | gap | 未注入脚本沙盒 |
| `SpeechRecognitionAlternative` | gap | 未注入脚本沙盒 |
| `SpeechRecognitionErrorEvent` | gap | 未注入脚本沙盒 |
| `SpeechRecognitionEvent` | gap | 未注入脚本沙盒 |
| `SpeechRecognitionPhrase` | gap | 未注入脚本沙盒 |
| `SpeechRecognitionResult` | gap | 未注入脚本沙盒 |
| `SpeechRecognitionResultList` | gap | 未注入脚本沙盒 |
| `SpeechSynthesis` | gap | 未注入脚本沙盒 |
| `SpeechSynthesisErrorEvent` | gap | 未注入脚本沙盒 |
| `SpeechSynthesisEvent` | gap | 未注入脚本沙盒 |
| `SpeechSynthesisUtterance` | gap | 未注入脚本沙盒 |
| `SpeechSynthesisVoice` | gap | 未注入脚本沙盒 |
| `StaticRange` | gap | 未注入脚本沙盒 |
| `StereoPannerNode` | gap | 未注入脚本沙盒 |
| `Storage` | shim | 隔离运行时提供受控实现 |
| `StorageAccessHandle` | gap | 未注入脚本沙盒 |
| `StorageBucket` | gap | 未注入脚本沙盒 |
| `StorageBucketManager` | gap | 未注入脚本沙盒 |
| `StorageEvent` | gap | 未注入脚本沙盒 |
| `StorageManager` | gap | 未注入脚本沙盒 |
| `StyleMedia` | gap | 未注入脚本沙盒 |
| `StylePropertyMap` | gap | 未注入脚本沙盒 |
| `StylePropertyMapReadOnly` | gap | 未注入脚本沙盒 |
| `StyleSheet` | gap | 未注入脚本沙盒 |
| `StyleSheetList` | gap | 未注入脚本沙盒 |
| `SubmitEvent` | gap | 未注入脚本沙盒 |
| `Subscriber` | gap | 未注入脚本沙盒 |
| `SubtleCrypto` | gap | 未注入脚本沙盒 |
| `Summarizer` | gap | 未注入脚本沙盒 |
| `SyncEvent` | gap | 未注入脚本沙盒 |
| `SyncManager` | gap | 未注入脚本沙盒 |
| `TaskAttributionTiming` | gap | 未注入脚本沙盒 |
| `TaskController` | gap | 未注入脚本沙盒 |
| `TaskPriorityChangeEvent` | gap | 未注入脚本沙盒 |
| `TaskSignal` | gap | 未注入脚本沙盒 |
| `Text` | gap | 未注入脚本沙盒 |
| `TextDecoder` | shim | 隔离运行时提供受控实现 |
| `TextDecoderStream` | gap | 未注入脚本沙盒 |
| `TextEncoder` | shim | 隔离运行时提供受控实现 |
| `TextEncoderStream` | gap | 未注入脚本沙盒 |
| `TextEvent` | gap | 未注入脚本沙盒 |
| `TextFormat` | gap | 未注入脚本沙盒 |
| `TextFormatUpdateEvent` | gap | 未注入脚本沙盒 |
| `TextMetrics` | gap | 未注入脚本沙盒 |
| `TextTrack` | gap | 未注入脚本沙盒 |
| `TextTrackCue` | gap | 未注入脚本沙盒 |
| `TextTrackCueList` | gap | 未注入脚本沙盒 |
| `TextTrackList` | gap | 未注入脚本沙盒 |
| `TextUpdateEvent` | gap | 未注入脚本沙盒 |
| `TimeRanges` | gap | 未注入脚本沙盒 |
| `ToggleEvent` | gap | 未注入脚本沙盒 |
| `Touch` | gap | 未注入脚本沙盒 |
| `TouchEvent` | gap | 未注入脚本沙盒 |
| `TouchList` | gap | 未注入脚本沙盒 |
| `TrackEvent` | gap | 未注入脚本沙盒 |
| `TransformStream` | gap | 未注入脚本沙盒 |
| `TransformStreamDefaultController` | gap | 未注入脚本沙盒 |
| `TransitionEvent` | gap | 未注入脚本沙盒 |
| `Translator` | gap | 未注入脚本沙盒 |
| `TreeWalker` | gap | 未注入脚本沙盒 |
| `TrustedHTML` | gap | 未注入脚本沙盒 |
| `TrustedScript` | gap | 未注入脚本沙盒 |
| `TrustedScriptURL` | gap | 未注入脚本沙盒 |
| `TrustedTypePolicy` | gap | 未注入脚本沙盒 |
| `TrustedTypePolicyFactory` | gap | 未注入脚本沙盒 |
| `UIEvent` | gap | 未注入脚本沙盒 |
| `URL` | shim | 隔离运行时提供受控实现 |
| `URLPattern` | gap | 未注入脚本沙盒 |
| `URLSearchParams` | gap | 未注入脚本沙盒 |
| `USB` | gap | 未注入脚本沙盒 |
| `USBAlternateInterface` | gap | 未注入脚本沙盒 |
| `USBConfiguration` | gap | 未注入脚本沙盒 |
| `USBConnectionEvent` | gap | 未注入脚本沙盒 |
| `USBDevice` | gap | 未注入脚本沙盒 |
| `USBEndpoint` | gap | 未注入脚本沙盒 |
| `USBInTransferResult` | gap | 未注入脚本沙盒 |
| `USBInterface` | gap | 未注入脚本沙盒 |
| `USBIsochronousInTransferPacket` | gap | 未注入脚本沙盒 |
| `USBIsochronousInTransferResult` | gap | 未注入脚本沙盒 |
| `USBIsochronousOutTransferPacket` | gap | 未注入脚本沙盒 |
| `USBIsochronousOutTransferResult` | gap | 未注入脚本沙盒 |
| `USBOutTransferResult` | gap | 未注入脚本沙盒 |
| `UserActivation` | gap | 未注入脚本沙盒 |
| `VTTCue` | gap | 未注入脚本沙盒 |
| `ValidityState` | gap | 未注入脚本沙盒 |
| `VideoColorSpace` | gap | 未注入脚本沙盒 |
| `VideoDecoder` | gap | 未注入脚本沙盒 |
| `VideoEncoder` | gap | 未注入脚本沙盒 |
| `VideoFrame` | gap | 未注入脚本沙盒 |
| `VideoPlaybackQuality` | gap | 未注入脚本沙盒 |
| `VideoTrack` | gap | 未注入脚本沙盒 |
| `VideoTrackList` | gap | 未注入脚本沙盒 |
| `ViewTimeline` | gap | 未注入脚本沙盒 |
| `ViewTransition` | gap | 未注入脚本沙盒 |
| `ViewTransitionTypeSet` | gap | 未注入脚本沙盒 |
| `Viewport` | gap | 未注入脚本沙盒 |
| `VirtualKeyboard` | gap | 未注入脚本沙盒 |
| `VisibilityStateEntry` | gap | 未注入脚本沙盒 |
| `VisualViewport` | gap | 未注入脚本沙盒 |
| `WEBGL_color_buffer_float` | gap | 未注入脚本沙盒 |
| `WEBGL_compressed_texture_astc` | gap | 未注入脚本沙盒 |
| `WEBGL_compressed_texture_etc` | gap | 未注入脚本沙盒 |
| `WEBGL_compressed_texture_etc1` | gap | 未注入脚本沙盒 |
| `WEBGL_compressed_texture_pvrtc` | gap | 未注入脚本沙盒 |
| `WEBGL_compressed_texture_s3tc` | gap | 未注入脚本沙盒 |
| `WEBGL_compressed_texture_s3tc_srgb` | gap | 未注入脚本沙盒 |
| `WEBGL_debug_renderer_info` | gap | 未注入脚本沙盒 |
| `WEBGL_debug_shaders` | gap | 未注入脚本沙盒 |
| `WEBGL_depth_texture` | gap | 未注入脚本沙盒 |
| `WEBGL_draw_buffers` | gap | 未注入脚本沙盒 |
| `WEBGL_lose_context` | gap | 未注入脚本沙盒 |
| `WEBGL_multi_draw` | gap | 未注入脚本沙盒 |
| `WGSLLanguageFeatures` | gap | 未注入脚本沙盒 |
| `WakeLock` | gap | 未注入脚本沙盒 |
| `WakeLockSentinel` | gap | 未注入脚本沙盒 |
| `WaveShaperNode` | gap | 未注入脚本沙盒 |
| `WebGL2RenderingContext` | gap | 未注入脚本沙盒 |
| `WebGLActiveInfo` | gap | 未注入脚本沙盒 |
| `WebGLBuffer` | gap | 未注入脚本沙盒 |
| `WebGLContextEvent` | gap | 未注入脚本沙盒 |
| `WebGLFramebuffer` | gap | 未注入脚本沙盒 |
| `WebGLObject` | gap | 未注入脚本沙盒 |
| `WebGLProgram` | gap | 未注入脚本沙盒 |
| `WebGLQuery` | gap | 未注入脚本沙盒 |
| `WebGLRenderbuffer` | gap | 未注入脚本沙盒 |
| `WebGLRenderingContext` | gap | 未注入脚本沙盒 |
| `WebGLSampler` | gap | 未注入脚本沙盒 |
| `WebGLShader` | gap | 未注入脚本沙盒 |
| `WebGLShaderPrecisionFormat` | gap | 未注入脚本沙盒 |
| `WebGLSync` | gap | 未注入脚本沙盒 |
| `WebGLTexture` | gap | 未注入脚本沙盒 |
| `WebGLTimerQueryEXT` | gap | 未注入脚本沙盒 |
| `WebGLTransformFeedback` | gap | 未注入脚本沙盒 |
| `WebGLUniformLocation` | gap | 未注入脚本沙盒 |
| `WebGLVertexArrayObject` | gap | 未注入脚本沙盒 |
| `WebGLVertexArrayObjectOES` | gap | 未注入脚本沙盒 |
| `WebSocket` | shim | 隔离运行时提供受控实现 |
| `WebSocketError` | gap | 未注入脚本沙盒 |
| `WebSocketStream` | gap | 未注入脚本沙盒 |
| `WebTransport` | gap | 未注入脚本沙盒 |
| `WebTransportBidirectionalStream` | gap | 未注入脚本沙盒 |
| `WebTransportDatagramDuplexStream` | gap | 未注入脚本沙盒 |
| `WebTransportError` | gap | 未注入脚本沙盒 |
| `WheelEvent` | gap | 未注入脚本沙盒 |
| `Window` | shim | 隔离运行时提供受控实现 |
| `WindowClient` | gap | 未注入脚本沙盒 |
| `WindowControlsOverlay` | gap | 未注入脚本沙盒 |
| `WindowControlsOverlayGeometryChangeEvent` | gap | 未注入脚本沙盒 |
| `Worker` | gap | 未注入脚本沙盒 |
| `WorkerGlobalScope` | gap | 未注入脚本沙盒 |
| `WorkerLocation` | gap | 未注入脚本沙盒 |
| `WorkerNavigator` | gap | 未注入脚本沙盒 |
| `Worklet` | gap | 未注入脚本沙盒 |
| `WorkletGlobalScope` | gap | 未注入脚本沙盒 |
| `WritableStream` | gap | 未注入脚本沙盒 |
| `WritableStreamDefaultController` | gap | 未注入脚本沙盒 |
| `WritableStreamDefaultWriter` | gap | 未注入脚本沙盒 |
| `XMLDocument` | gap | 未注入脚本沙盒 |
| `XMLHttpRequest` | shim | 隔离运行时提供受控实现 |
| `XMLHttpRequestEventTarget` | gap | 未注入脚本沙盒 |
| `XMLHttpRequestUpload` | gap | 未注入脚本沙盒 |
| `XMLSerializer` | gap | 未注入脚本沙盒 |
| `XPathEvaluator` | gap | 未注入脚本沙盒 |
| `XPathExpression` | gap | 未注入脚本沙盒 |
| `XPathResult` | gap | 未注入脚本沙盒 |
| `XRAnchor` | gap | 未注入脚本沙盒 |
| `XRAnchorSet` | gap | 未注入脚本沙盒 |
| `XRBoundedReferenceSpace` | gap | 未注入脚本沙盒 |
| `XRCPUDepthInformation` | gap | 未注入脚本沙盒 |
| `XRCamera` | gap | 未注入脚本沙盒 |
| `XRCompositionLayer` | gap | 未注入脚本沙盒 |
| `XRCubeLayer` | gap | 未注入脚本沙盒 |
| `XRCylinderLayer` | gap | 未注入脚本沙盒 |
| `XRDepthInformation` | gap | 未注入脚本沙盒 |
| `XREquirectLayer` | gap | 未注入脚本沙盒 |
| `XRFrame` | gap | 未注入脚本沙盒 |
| `XRHand` | gap | 未注入脚本沙盒 |
| `XRHitTestResult` | gap | 未注入脚本沙盒 |
| `XRHitTestSource` | gap | 未注入脚本沙盒 |
| `XRInputSource` | gap | 未注入脚本沙盒 |
| `XRInputSourceArray` | gap | 未注入脚本沙盒 |
| `XRInputSourceEvent` | gap | 未注入脚本沙盒 |
| `XRInputSourcesChangeEvent` | gap | 未注入脚本沙盒 |
| `XRJointPose` | gap | 未注入脚本沙盒 |
| `XRJointSpace` | gap | 未注入脚本沙盒 |
| `XRLayer` | gap | 未注入脚本沙盒 |
| `XRLayerEvent` | gap | 未注入脚本沙盒 |
| `XRLightEstimate` | gap | 未注入脚本沙盒 |
| `XRLightProbe` | gap | 未注入脚本沙盒 |
| `XRPlane` | gap | 未注入脚本沙盒 |
| `XRPlaneSet` | gap | 未注入脚本沙盒 |
| `XRPose` | gap | 未注入脚本沙盒 |
| `XRProjectionLayer` | gap | 未注入脚本沙盒 |
| `XRQuadLayer` | gap | 未注入脚本沙盒 |
| `XRRay` | gap | 未注入脚本沙盒 |
| `XRReferenceSpace` | gap | 未注入脚本沙盒 |
| `XRReferenceSpaceEvent` | gap | 未注入脚本沙盒 |
| `XRRenderState` | gap | 未注入脚本沙盒 |
| `XRRigidTransform` | gap | 未注入脚本沙盒 |
| `XRSession` | gap | 未注入脚本沙盒 |
| `XRSessionEvent` | gap | 未注入脚本沙盒 |
| `XRSpace` | gap | 未注入脚本沙盒 |
| `XRSubImage` | gap | 未注入脚本沙盒 |
| `XRSystem` | gap | 未注入脚本沙盒 |
| `XRTransientInputHitTestResult` | gap | 未注入脚本沙盒 |
| `XRTransientInputHitTestSource` | gap | 未注入脚本沙盒 |
| `XRView` | gap | 未注入脚本沙盒 |
| `XRViewerPose` | gap | 未注入脚本沙盒 |
| `XRViewport` | gap | 未注入脚本沙盒 |
| `XRVisibilityMaskChangeEvent` | gap | 未注入脚本沙盒 |
| `XRWebGLBinding` | gap | 未注入脚本沙盒 |
| `XRWebGLDepthInformation` | gap | 未注入脚本沙盒 |
| `XRWebGLLayer` | gap | 未注入脚本沙盒 |
| `XRWebGLSubImage` | gap | 未注入脚本沙盒 |
| `XSLTProcessor` | gap | 未注入脚本沙盒 |
| `atob` | gap | 未注入脚本沙盒 |
| `btoa` | gap | 未注入脚本沙盒 |
| `caches` | gap | 未注入脚本沙盒 |
| `clearInterval` | gap | 未注入脚本沙盒 |
| `clearTimeout` | gap | 未注入脚本沙盒 |
| `console` | gap | 未注入脚本沙盒 |
| `createImageBitmap` | gap | 未注入脚本沙盒 |
| `crossOriginIsolated` | gap | 未注入脚本沙盒 |
| `crypto` | gap | 未注入脚本沙盒 |
| `fetch` | gap | 未注入脚本沙盒 |
| `indexedDB` | gap | 未注入脚本沙盒 |
| `isSecureContext` | gap | 未注入脚本沙盒 |
| `origin` | gap | 未注入脚本沙盒 |
| `performance` | gap | 未注入脚本沙盒 |
| `queueMicrotask` | gap | 未注入脚本沙盒 |
| `reportError` | gap | 未注入脚本沙盒 |
| `scheduler` | gap | 未注入脚本沙盒 |
| `setInterval` | gap | 未注入脚本沙盒 |
| `setTimeout` | gap | 未注入脚本沙盒 |
| `structuredClone` | gap | 未注入脚本沙盒 |
| `trustedTypes` | gap | 未注入脚本沙盒 |
