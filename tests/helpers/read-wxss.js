'use strict'

const fs = require('node:fs')
const path = require('node:path')

// Follow local imports so layout checks cover the styles actually used by a page.
module.exports = function readWxss (file) {
  return fs.readFileSync(file, 'utf8').replace(/@import\s+["']([^"']+)["'];/g,
    (_, relative) => readWxss(path.resolve(path.dirname(file), relative)))
}
