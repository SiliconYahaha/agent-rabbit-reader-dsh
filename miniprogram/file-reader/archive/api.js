'use strict'

// archive 族对 reader 内核暴露的函数面。只在 attach() 之后被 require。
const { extractRarEntry, inspectRarArchive, readRarEntry } = require('./rar-runtime')
const { mergeZipEngineInspection } = require('./zip-engine-bridge')
const { resolveZipLink } = require('./zip-links')
const { inspectTarArchive, extractTarEntry, resolveTarLink } = require('./tar-runtime')
const sevenzip = require('./sevenzip-runtime')
const { zipFileSize } = require('./zip-file-size')

module.exports = { extractRarEntry, inspectRarArchive, mergeZipEngineInspection, readRarEntry, resolveZipLink, inspectTarArchive, extractTarEntry, resolveTarLink, sevenzip, zipFileSize }
