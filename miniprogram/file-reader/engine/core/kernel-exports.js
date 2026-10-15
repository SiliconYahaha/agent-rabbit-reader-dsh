'use strict'

// 引擎内核注入给各族分包（document / archive）的模块集合。分包不能同步 require 引擎文件，
// 它们通过各自的 kernel.js 拿这份对象；families.js 在 require.async 之后调用族的 attach(kernel)。
module.exports = {
  archiveMembers: require('./archive-members'),
  rarHeaders: require('./rar-headers'),
  fileInspector: require('./file-inspector'),
  legacyCjkData: require('./vendor/legacy-cjk-data'),
  moduleRoot: require('../../shared/module-root'),
  subpackageLoader: require('./subpackage-loader'),
  textCodec: require('./text-codec'),
  textDecoder: require('./text-decoder')
}
