'use strict'

// document 族对 reader 内核暴露的函数面。只在 attach() 之后被 require。
const { createCanvasPresenter } = require('./canvas-presenter')
const { transformHtml } = require('./html-compat')
const { renderHtmlDomTree, sanitizeStandaloneSvg } = require('./document-renderer')
const { buildDomPatchPlan, buildProgressiveDomPlan, compactDomTreeForView, compactStyle, DEFAULT_DOM_CHUNK_BYTES } = require('./view-payload')
const { createRuntime } = require('./html-runtime/html-script-runtime')
const { createInlineImageStore, hasLargeInlineImage } = require('./inline-image-store')
const { readHtmlFileBytes } = require('./read-html-file')
const { parseXhtmlDocument } = require('./xhtml-document')
const { decodeTextData, renderTextData } = require('./text-data')

module.exports = {
  DEFAULT_DOM_CHUNK_BYTES,
  buildDomPatchPlan,
  buildProgressiveDomPlan,
  compactDomTreeForView,
  compactStyle,
  createCanvasPresenter,
  createInlineImageStore,
  createRuntime,
  decodeTextData,
  hasLargeInlineImage,
  parseXhtmlDocument,
  readHtmlFileBytes,
  renderHtmlDomTree,
  renderTextData,
  sanitizeStandaloneSvg,
  transformHtml
}
