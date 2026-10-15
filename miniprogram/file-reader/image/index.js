'use strict'

// image 族分包入口：位图交微信 <image>（reader 内核已处理），这里承接 SVG 的 Canvas 光栅化与动画。
// 分包自包含：不同步 require 引擎分包；内核通过 subpackage-loader 按需拿到本入口。

const { createTimeline, looksAnimated } = require('./svg/svg-animation')
const { parseSvgDocument } = require('./svg/svg-document')
const { createRenderer } = require('./svg/svg-rasterizer')

const isClipShape = name => ['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'use'].includes(name)

// 一次解析 + 时间线 + 渲染器，供 <svg-view> 组件与 Node 测试共用。
function createSvgScene (source, options = {}) {
  const doc = parseSvgDocument(source)
  const timeline = createTimeline(doc)
  const renderer = createRenderer(doc, options)
  return {
    requiresClipUnion: doc.elements.some(r => r.node.name === 'clipPath' && r.node.children.filter(n => isClipShape(n.name)).length > 1),
    doc,
    timeline,
    renderer,
    intrinsic: doc.intrinsic,
    viewBox: doc.viewBox,
    title: doc.title,
    animated: timeline.hasAnimation,
    // 画 t 秒时的一帧
    draw (ctx, width, height, time = 0) {
      renderer.render(ctx, width, height, timeline.hasAnimation ? timeline.sample(time) : null)
      return renderer.unsupported
    }
  }
}

module.exports = { createSvgScene, looksAnimated, parseSvgDocument }
