'use strict'

const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')

// Fresh module cache models loss of the old JS runtime, not a graceful dispose.
// Persistent file bytes are deliberately shared between these independent boots.
function bootStore () {
  const modules = new Map()
  const load = file => {
    if (modules.has(file)) return modules.get(file).exports
    const module = { exports: {} }; modules.set(file, module)
    vm.runInThisContext('(function(require,module,exports){' + fs.readFileSync(file, 'utf8') + '\n})', { filename: file })(
      name => name.startsWith('.') ? load(path.resolve(path.dirname(file), name + '.js')) : require(name), module, module.exports)
    return module.exports
  }
  return load(path.resolve(__dirname, '../../miniprogram/file-reader/document/inline-image-store.js')).createInlineImageStore
}

function cacheFilesystem (limit = Infinity) {
  const files = new Map(), directories = new Set(['/local']), writes = [], removals = [], scans = []
  let rejectUnlink = false, rejectScan = false, rejectMkdir = false
  const io = {
    mkdir (o) { if (rejectMkdir) return o.fail({ errMsg: 'mkdir denied' }); directories.add(o.dirPath); o.success({}) },
    readdir (o) {
      scans.push(o.dirPath)
      if (rejectScan || !directories.has(o.dirPath)) return o.fail({ errMsg: 'readdir failed' })
      const names = new Set()
      for (const entry of [...files.keys(), ...directories]) {
        if (entry.startsWith(o.dirPath + '/')) names.add(entry.slice(o.dirPath.length + 1).split('/')[0])
      }
      o.success({ files: Array.from(names) })
    },
    writeFile (o) {
      writes.push(o)
      if (!directories.has(path.posix.dirname(o.filePath))) return o.fail({ errMsg: 'parent directory missing' })
      const data = Buffer.from(o.data, o.encoding)
      const used = [...files.values()].reduce((n, b) => n + b.length, 0)
      if (used - (files.get(o.filePath)?.length || 0) + data.length > limit) return o.fail({ errMsg: 'disk full' })
      files.set(o.filePath, data); o.success({})
    },
    unlink (o) {
      removals.push(o.filePath)
      if (rejectUnlink || directories.has(o.filePath)) return o.fail?.({ errMsg: 'unlink failed' })
      files.delete(o.filePath); o.success?.({})
    }
  }
  return { io, files, directories, writes, removals, scans,
    failUnlink: value => { rejectUnlink = value }, failScan: value => { rejectScan = value }, failMkdir: value => { rejectMkdir = value } }
}

module.exports = { bootStore, cacheFilesystem }
