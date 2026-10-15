'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { parseXml } = require('../miniprogram/file-reader/image/svg/xml-parser')
const { parsePath, rectPath, pathBounds } = require('../miniprogram/file-reader/image/svg/svg-path')
const { parseColor, parseStyleSheet, parseTransformList, transformListToMatrix, transformPoint } = require('../miniprogram/file-reader/image/svg/svg-style')
const { classifyValue, createTimeline, looksAnimated, parseAnimationShorthand, parseEasing } = require('../miniprogram/file-reader/image/svg/svg-animation')
const { createSvgScene, parseSvgDocument } = require('../miniprogram/file-reader/image')

const PARTRIDGE = fs.readFileSync(path.join(__dirname, 'fixtures/svg-animated/partridge-bike.svg'), 'utf8')

// 记录式 Canvas 2D 上下文：只记调用，不画
function recordingContext () {
  const ops = []
  const state = { globalAlpha: 1, fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '10px sans-serif' }
  const handler = {
    get (target, key) {
      if (key === 'ops') return ops
      if (key in state) return state[key]
      return (...args) => {
        ops.push([key, ...args.map(arg => (typeof arg === 'object' && arg && arg.gradient ? 'gradient' : arg))])
        if (key === 'createLinearGradient' || key === 'createRadialGradient') return { gradient: true, addColorStop () { ops.push(['addColorStop']) } }
        if (key === 'measureText') return { width: String(args[0]).length * 7 }
        return undefined
      }
    },
    set (target, key, value) { state[key] = value; ops.push(['set', key, typeof value === 'object' ? 'gradient' : value]); return true }
  }
  return new Proxy({}, handler)
}

test('XML 解析：实体、CDATA、注释、自闭合、命名空间前缀与 <style> 原文', () => {
  const root = parseXml('<?xml version="1.0"?><!-- c --><svg xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10"><style>a > b { fill: red }</style><g id="a&amp;b"><rect width="5" height="5"/><use xlink:href="#x"/></g><text>你好 &#x4e16;&#30028;<tspan>!</tspan></text></svg>')
  assert.equal(root.name, 'svg')
  assert.equal(root.children[0].name, 'style')
  assert.equal(root.children[0].text, 'a > b { fill: red }')
  assert.equal(root.children[1].attrs.id, 'a&b')
  assert.equal(root.children[1].children[1].attrs.href, '#x')
  const text = root.children[2]
  assert.equal(text.children[0].text, '你好 世界')
  assert.equal(text.children[1].name, 'tspan')
})

test('路径解析：相对指令、S/T 反射、椭圆弧展开、圆角矩形与包围盒', () => {
  const segments = parsePath('M10 10 h20 v20 H10 Z m5 5 q5 -5 10 0 t10 0 a5 5 0 0 1 10 0')
  assert.deepEqual(segments.slice(0, 5).map(segment => segment.type), ['M', 'L', 'L', 'L', 'Z'])
  assert.equal(segments[5].type, 'M'); assert.equal(segments[5].x, 15); assert.equal(segments[5].y, 15)
  assert.equal(segments[6].type, 'C'); assert.equal(Math.round(segments[7].x), 35)
  assert.ok(segments.slice(8).every(segment => segment.type === 'C'), '圆弧应展开为三次贝塞尔')
  const last = segments[segments.length - 1]
  assert.equal(Math.round(last.x), 45); assert.equal(Math.round(last.y), 15)
  const rounded = rectPath(0, 0, 100, 50, 10, 10)
  assert.equal(rounded.filter(segment => segment.type === 'C').length, 4)
  assert.deepEqual(pathBounds(rectPath(5, 6, 10, 20, 0, 0)), { x: 5, y: 6, width: 10, height: 20 })
})

test('颜色、变换与样式表：hex/rgb/hsl/命名色，transform 矩阵，选择器特异性与 @keyframes', () => {
  assert.deepEqual(parseColor('#f00'), [255, 0, 0, 1])
  assert.deepEqual(parseColor('rgba(10, 20, 30, .5)'), [10, 20, 30, 0.5])
  assert.deepEqual(parseColor('hsl(120, 100%, 50%)'), [0, 255, 0, 1])
  assert.deepEqual(parseColor('currentColor', '#0000ff'), [0, 0, 255, 1])
  assert.equal(parseColor('none'), null)
  const matrix = transformListToMatrix(parseTransformList('translate(10 20) rotate(90) scale(2)'))
  const point = transformPoint(matrix, 1, 0)
  assert.equal(Math.round(point.x), 10); assert.equal(Math.round(point.y), 22)
  const css = transformListToMatrix(parseTransformList('translateX(5px) rotate(0.5turn)'))
  assert.equal(Math.round(css[0]), -1); assert.equal(css[4], 5)
  const sheet = parseStyleSheet('.a { fill: red } g .a { fill: blue } #x { fill: green } @keyframes k { from { opacity: 0 } 50% { opacity: .5 } to { opacity: 1 } } @media (prefers-reduced-motion: reduce) { .a { fill: black } }')
  assert.equal(sheet.rules.length, 3)
  assert.deepEqual(sheet.keyframes.k.map(frame => frame.offset), [0, 0.5, 1])
  const doc = parseSvgDocument('<svg viewBox="0 0 10 10"><style>.a{fill:red} g .a{fill:blue} #x{fill:green}</style><g><rect class="a" id="x"/><rect class="a"/></g><rect class="a"/></svg>')
  const rects = doc.elements.filter(record => record.node.name === 'rect')
  assert.deepEqual(rects.map(record => record.style.fill), ['green', 'blue', 'red'])
})

test('CSS 动画简写、缓动函数与关键帧插值；SMIL animate/animateTransform 采样', () => {
  const entry = parseAnimationShorthand('drift 34s linear -12s infinite alternate both')
  assert.equal(entry.name, 'drift'); assert.equal(entry.duration, 34); assert.equal(entry.delay, -12)
  assert.equal(entry.iterations, Infinity); assert.equal(entry.direction, 'alternate'); assert.equal(entry.fill, 'both')
  assert.equal(parseEasing('linear')(0.25), 0.25)
  assert.ok(Math.abs(parseEasing('ease-in-out')(0.5) - 0.5) < 1e-3)
  assert.equal(parseEasing('steps(4, start)')(0.1), 0.25)
  assert.equal(classifyValue('12px').kind, 'number')
  assert.equal(classifyValue('translateX(3px) rotate(4deg)').kind, 'transform')

  const doc = parseSvgDocument(`<svg viewBox="0 0 100 100">
    <style>.spin { animation: spin 2s linear infinite; transform-origin: 50px 50px } @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
    .fade { animation: fade 1s ease 0s 1 forwards } @keyframes fade { to { opacity: 0.2; fill: #0000ff } }</style>
    <rect class="spin" id="spin" x="40" y="40" width="20" height="20"/>
    <circle class="fade" id="fade" cx="50" cy="50" r="10" fill="#ff0000"/>
    <rect id="smil" x="0" y="0" width="10" height="10">
      <animate attributeName="x" values="0;50;100" keyTimes="0;0.5;1" dur="4s" repeatCount="indefinite"/>
      <animateTransform attributeName="transform" type="rotate" from="0 5 5" to="90 5 5" dur="1s" fill="freeze" additive="sum"/>
      <set attributeName="fill" to="green" begin="2s"/>
    </rect>
  </svg>`)
  const timeline = createTimeline(doc)
  assert.equal(timeline.hasAnimation, true)
  assert.equal(timeline.cssCount, 2)
  assert.equal(timeline.smilCount, 3)
  const spin = doc.byId.spin; const fade = doc.byId.fade; const smil = doc.byId.smil
  const at = time => timeline.sample(time)
  assert.deepEqual(at(0.5).get(spin).transformReplace, [{ name: 'rotate', args: [90] }])
  assert.equal(at(0.5).get(fade).style.opacity !== undefined, true)
  assert.equal(at(5).get(fade).style.opacity, '0.2', 'fill-mode forwards 停在终态')
  assert.equal(at(5).get(fade).style.fill, 'rgba(0,0,255,1)')
  assert.equal(at(1).get(smil).attrs.x, '25')
  assert.equal(at(3).get(smil).attrs.x, '75')
  assert.deepEqual(at(0.5).get(smil).transformAppend, [{ name: 'rotate', args: [45, 5, 5] }])
  assert.deepEqual(at(7).get(smil).transformAppend, [{ name: 'rotate', args: [90, 5, 5] }], 'freeze 保持终值')
  assert.equal(at(1).get(smil).attrs.fill, undefined)
  assert.equal(at(2.5).get(smil).attrs.fill, 'rgba(0,128,0,1)')
})

test('光栅化：形状、渐变、clipPath、文本与 use 都落到 Canvas 调用；未支持的特性有记录', () => {
  const scene = createSvgScene(`<svg viewBox="0 0 200 100" width="400" height="200">
    <defs>
      <linearGradient id="g"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>
      <clipPath id="c"><circle cx="50" cy="50" r="40"/></clipPath>
      <g id="sym"><rect width="10" height="10" fill="red"/></g>
    </defs>
    <rect x="10" y="10" width="80" height="80" fill="url(#g)" stroke="#123456" stroke-width="2" stroke-dasharray="4 2" clip-path="url(#c)"/>
    <text x="100" y="50" font-size="12" text-anchor="middle">Hi <tspan fill="blue">there</tspan></text>
    <use href="#sym" x="150" y="20" transform="rotate(45 155 25)"/>
    <ellipse cx="150" cy="70" rx="20" ry="10" mask="url(#m)" opacity="0.5"/>
  </svg>`)
  assert.equal(scene.animated, false)
  assert.deepEqual(scene.intrinsic, { width: 400, height: 200 })
  const ctx = recordingContext()
  const unsupported = scene.draw(ctx, 200, 100, 0)
  const names = ctx.ops.map(op => op[0])
  assert.ok(names.includes('createLinearGradient'))
  assert.ok(names.includes('clip'))
  assert.ok(names.includes('setLineDash'))
  assert.ok(names.includes('fillText'))
  assert.ok(names.includes('bezierCurveTo'))
  assert.equal(ctx.ops.filter(op => op[0] === 'fillText').length, 2)
  assert.ok(ctx.ops.some(op => op[0] === 'set' && op[1] === 'strokeStyle' && op[2] === 'rgba(18,52,86,1)'))
  assert.ok(ctx.ops.some(op => op[0] === 'set' && op[1] === 'globalAlpha' && op[2] === 0.5))
  assert.deepEqual(Array.from(unsupported), ['mask'])
})

test('鹧鸪骑车：识别为动态 SVG，两个时刻的画面不同，静态 SVG 的两帧相同', () => {
  assert.equal(looksAnimated(PARTRIDGE), true)
  assert.equal(looksAnimated('<svg><rect/></svg>'), false)
  const scene = createSvgScene(PARTRIDGE)
  assert.equal(scene.animated, true)
  assert.equal(scene.title, '鹧鸪骑自行车')
  assert.ok(scene.timeline.cssCount >= 7 && scene.timeline.smilCount >= 10, `${scene.timeline.cssCount}/${scene.timeline.smilCount}`)
  const first = recordingContext(); scene.draw(first, 390, 244, 0)
  const second = recordingContext(); scene.draw(second, 390, 244, 0.275)
  assert.ok(first.ops.length > 200, `绘制指令过少：${first.ops.length}`)
  assert.notDeepEqual(first.ops, second.ops)
  assert.equal(scene.renderer.unsupported.size, 0, Array.from(scene.renderer.unsupported).join(','))
  const still = createSvgScene('<svg viewBox="0 0 10 10"><rect width="5" height="5"/></svg>')
  const a = recordingContext(); still.draw(a, 100, 100, 0)
  const b = recordingContext(); still.draw(b, 100, 100, 3)
  assert.deepEqual(a.ops, b.ops)
})

test('渐变填充先建路径再切换渐变坐标系；渐变描边不动画布变换（v1.4.93 鸟身透明、车架变细的回归）', () => {
  const scene = createSvgScene(`<svg viewBox="0 0 100 100">
    <defs>
      <radialGradient id="r" cx="0.35" cy="0.3" r="0.85"><stop offset="0" stop-color="#a9744c"/><stop offset="1" stop-color="#7a4e30"/></radialGradient>
      <linearGradient id="l" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f0a24b"/><stop offset="1" stop-color="#b25a22"/></linearGradient>
    </defs>
    <ellipse cx="50" cy="50" rx="42" ry="30" fill="url(#r)"/>
    <path d="M10 90 L90 20" stroke="url(#l)" stroke-width="9" fill="none"/>
  </svg>`)
  const ctx = recordingContext(); scene.draw(ctx, 100, 100, 0)
  const names = ctx.ops.map(op => op[0])
  const firstBezier = names.indexOf('bezierCurveTo')
  const gradientTransform = names.findIndex((name, index) => name === 'transform' && index > names.indexOf('createRadialGradient'))
  assert.ok(firstBezier >= 0 && gradientTransform > firstBezier, '椭圆路径必须在切换到渐变坐标系之前构造完成')
  const fillAt = names.indexOf('fill')
  assert.ok(fillAt > gradientTransform && names[fillAt + 1] === 'restore', '填充后立刻恢复画布变换')
  const strokeAt = names.indexOf('stroke')
  const linearAt = names.indexOf('createLinearGradient')
  assert.ok(linearAt > fillAt && strokeAt > linearAt)
  assert.ok(!names.slice(linearAt, strokeAt).includes('transform'), '描边渐变映射到用户坐标，不应改变画布变换（否则线宽被包围盒缩放拉扁）')
  const linear = ctx.ops[linearAt]
  assert.deepEqual(linear.slice(1), [10, 20, 90, 90], '描边渐变端点应映射到路径包围盒的用户坐标')
})
