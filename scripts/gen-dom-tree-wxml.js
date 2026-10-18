'use strict'

const fs = require('node:fs')
const path = require('node:path')

const DEPTH = 20
const target = path.join(__dirname, '..', 'miniprogram/file-reader/engine/components/reader/dom-tree.wxml')

function templateAt (depth) {
  const next = depth + 1
  const children = depth < DEPTH ? `<template is="dn${next}" data="{{nodes:n.children,styles:styles}}"/>` : '<text selectable>[内容嵌套过深]</text>'
  const touchBindings = 'data-touch="{{n.touch}}" bindtouchstart="onDomTouchStart" bindtouchmove="onDomTouchMove" bindtouchend="onDomTouchEnd" bindtouchcancel="onDomTouchCancel"'
  const paired = (condition, tag, attributes, content = '', events = '') => {
    const item = bindings => content ? `<${tag} ${bindings}>${content}</${tag}>` : `<${tag} ${bindings}/>`
    return `<block wx:elif="{{${condition}}}">${item(`wx:if="{{n.touch}}" ${attributes} ${touchBindings} ${events}`)}${item(`wx:else ${attributes} ${events}`)}</block>`
  }
  const choice = (condition, groupTag, controlTag) => `<block wx:elif="{{${condition}}}"><${groupTag} style="display:inline-block;vertical-align:middle" wx:if="{{n.touch}}" data-nid="{{n.nid}}" data-kind="${controlTag}" ${touchBindings} bindchange="onDomChoiceChange" catchtap="stopDomTap"><${controlTag} value="{{n.attrs.value || 'on'}}" checked="{{n.attrs.checked}}" disabled="{{n.attrs.disabled !== undefined}}"/></${groupTag}><${groupTag} style="display:inline-block;vertical-align:middle" wx:else data-nid="{{n.nid}}" data-kind="${controlTag}" bindchange="onDomChoiceChange" catchtap="stopDomTap"><${controlTag} value="{{n.attrs.value || 'on'}}" checked="{{n.attrs.checked}}" disabled="{{n.attrs.disabled !== undefined}}"/></${groupTag}></block>`
  const canvas = `<block wx:elif="{{n.name === 'canvas'}}"><view class="dom-canvas-box" style="{{n.canvasBoxStyle}}"><view style="{{n.canvasSizerStyle}}"><canvas wx:if="{{n.touch}}" id="dom-canvas-{{n.nid}}" canvas-id="dom-canvas-{{n.nid}}" type="2d" class="dom-canvas {{n.attrs.class}}" style="{{n.canvasStyle}}" data-nid="{{n.nid}}" ${touchBindings} catchtap="onDomTap"/><canvas wx:else id="dom-canvas-{{n.nid}}" canvas-id="dom-canvas-{{n.nid}}" type="2d" class="dom-canvas {{n.attrs.class}}" style="{{n.canvasStyle}}" data-nid="{{n.nid}}" catchtap="onDomTap"/></view></view></block>`
  return `<template name="dn${depth}">
  <block wx:for="{{nodes}}" wx:for-item="n" wx:key="nid">
    <text wx:if="{{n.type === 'text' && n.tapNid !== undefined}}" data-nid="{{n.tapNid}}" catchtap="onDomTap"><block wx:if="{{n.textFragments}}"><text wx:for="{{n.textFragments}}" wx:for-item="fragment" wx:key="index">{{fragment.text}}</text></block><block wx:else>{{n.text}}</block></text>
    <text wx:elif="{{n.type === 'text'}}" selectable><block wx:if="{{n.textFragments}}"><text wx:for="{{n.textFragments}}" wx:for-item="fragment" wx:key="index">{{fragment.text}}</text></block><block wx:else>{{n.text}}</block></text>
    <text wx:elif="{{n.name === 'br'}}">{{'\\n'}}</text>
    <scroll-view wx:elif="{{n.tableScroll}}" class="dom-table-scroll" style="{{n.tableScrollStyle}}" scroll-x="{{true}}"><view wx:if="{{n.touch}}" id="dom-nid-{{n.nid}}" class="dom-node dom-table" style="{{styles[n.styleId]}}" data-nid="{{n.nid}}" ${touchBindings} catchtap="onDomTap">${children}</view><view wx:else id="dom-nid-{{n.nid}}" class="dom-node dom-table" style="{{styles[n.styleId]}}" data-nid="{{n.nid}}" catchtap="onDomTap">${children}</view></scroll-view>
    <svg-view wx:elif="{{n.svgCanvasSource}}" id="dom-nid-{{n.nid}}" style="{{styles[n.styleId]}}" source="{{n.svgCanvasSource}}" controls="{{false}}" data-nid="{{n.nid}}" data-media-token="{{n.mediaToken}}" bind:ready="onDomSvgReady" bind:error="onDomSvgError" catchtap="onDomTap"/>
    ${paired("n.name === 'img'", 'image', 'id="dom-nid-{{n.nid}}" style="{{styles[n.styleId]}}" src="{{n.attrs.src}}" mode="{{n.imageMode || \'widthFix\'}}" data-nid="{{n.nid}}" data-media-token="{{n.mediaToken}}" show-menu-by-longpress="{{!n.touch}}"', '', 'bindload="onDomMediaLoad" binderror="onDomMediaError" catchtap="onDomTap"')}
    ${paired("n.name === 'input'", 'input', 'style="{{styles[n.styleId]}}" type="{{n.inputType || \'text\'}}" password="{{n.attrs.type === \'password\'}}" value="{{n.attrs.value}}" placeholder="{{n.attrs.placeholder}}" disabled="{{n.attrs.disabled !== undefined}}" maxlength="{{n.attrs.maxlength !== undefined ? n.attrs.maxlength : -1}}" data-nid="{{n.nid}}"', '', 'bindinput="onDomInput" bindchange="onDomChange" catchtap="onDomTap"')}
    ${paired("n.name === 'textarea'", 'textarea', 'style="{{styles[n.styleId]}}" value="{{n.attrs.value}}" placeholder="{{n.attrs.placeholder}}" disabled="{{n.attrs.disabled !== undefined}}" maxlength="{{n.attrs.maxlength !== undefined ? n.attrs.maxlength : -1}}" data-nid="{{n.nid}}"', '', 'bindinput="onDomInput" bindchange="onDomChange" catchtap="stopDomTap"')}
    ${choice("n.name === 'checkbox'", 'checkbox-group', 'checkbox')}
    ${choice("n.name === 'radio'", 'radio-group', 'radio')}
    ${paired("n.name === 'slider'", 'slider', 'style="{{styles[n.styleId]}}" value="{{n.attrs.value}}" min="{{n.attrs.min !== undefined ? n.attrs.min : 0}}" max="{{n.attrs.max !== undefined ? n.attrs.max : 100}}" step="{{n.attrs.step !== undefined ? n.attrs.step : 1}}" disabled="{{n.attrs.disabled !== undefined}}" data-nid="{{n.nid}}"', '', 'bindchanging="onDomChanging" bindchange="onDomChange" catchtap="stopDomTap"')}
    ${paired("n.name === 'select'", 'picker', 'style="{{styles[n.styleId]}}" range="{{n.options}}" range-key="label" value="{{n.selectedIndex}}" disabled="{{n.attrs.disabled !== undefined}}" data-nid="{{n.nid}}"', '<view class="dom-picker-value">{{n.displayText}}</view>', 'bindchange="onDomSelect" catchtap="stopDomTap"')}
    ${paired("n.name === 'picker-date'", 'picker', 'style="{{styles[n.styleId]}}" mode="date" value="{{n.attrs.value}}" start="{{n.attrs.min}}" end="{{n.attrs.max}}" disabled="{{n.attrs.disabled !== undefined}}" data-nid="{{n.nid}}"', '<view class="dom-picker-value">{{n.attrs.value || n.attrs.placeholder || \'选择日期\'}}</view>', 'bindchange="onDomPickerChange" catchtap="stopDomTap"')}
    ${paired("n.name === 'picker-time'", 'picker', 'style="{{styles[n.styleId]}}" mode="time" value="{{n.attrs.value}}" start="{{n.attrs.min}}" end="{{n.attrs.max}}" disabled="{{n.attrs.disabled !== undefined}}" data-nid="{{n.nid}}"', '<view class="dom-picker-value">{{n.attrs.value || n.attrs.placeholder || \'选择时间\'}}</view>', 'bindchange="onDomPickerChange" catchtap="stopDomTap"')}
    <progress wx:elif="{{n.name === 'progress'}}" style="{{styles[n.styleId]}}" percent="{{n.percent}}" show-info data-nid="{{n.nid}}"/>
    ${canvas}
    <block wx:else><view wx:if="{{n.touch}}" id="dom-nid-{{n.nid}}" class="dom-node dom-{{n.name}}" style="{{styles[n.styleId]}}" data-nid="{{n.nid}}" ${touchBindings} catchtap="onDomTap">${children}</view><view wx:else id="dom-nid-{{n.nid}}" class="dom-node dom-{{n.name}}" style="{{styles[n.styleId]}}" data-nid="{{n.nid}}" catchtap="onDomTap">${children}</view></block>
  </block>
</template>`
}

function generate (targetPath = target) {
  const output = [
    '<!-- 由 npm run generate:dom-tree 生成；固定 20 层以适配 WXML 不支持递归模板。 -->',
    ...Array.from({ length: DEPTH + 1 }, (_, depth) => templateAt(depth)),
    ''
  ].join('\n')
  fs.writeFileSync(targetPath, output)
  console.log(`已生成 DOM 树模板：${DEPTH + 1} 层，${Buffer.byteLength(output)} bytes`)
  return output
}

if (require.main === module) generate()

module.exports = { DEPTH, generate, templateAt }
