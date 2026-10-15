'use strict'

const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')
const crypto = require('node:crypto')

const projectRoot = path.resolve(__dirname, '..')
const vendorRoot = path.join(projectRoot, 'miniprogram', 'file-reader', 'engine', 'core', 'vendor')
const sevenZipRuntimeRoot = path.join(projectRoot, 'miniprogram', 'file-reader', 'sevenzip', 'runtime')
const markdownVendorRoot = path.join(projectRoot, 'miniprogram', 'file-reader', 'markdown', 'runtime', 'vendor')

function writeIfChanged (target, content) {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const previous = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : ''
  if (previous !== content) fs.writeFileSync(target, content)
}

function writeBinaryIfChanged (target, content) {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const previous = fs.existsSync(target) ? fs.readFileSync(target) : Buffer.alloc(0)
  if (!previous.equals(content)) fs.writeFileSync(target, content)
}

function packageFile (packageName, relativePath) {
  const packageJson = require.resolve(`${packageName}/package.json`)
  return path.join(path.dirname(packageJson), relativePath)
}

function normalizedText (value) {
  return `${String(value).split(/\r?\n/).map(line => line.replace(/^ +(?=\t)/, '').trimEnd()).join('\n').trimEnd()}\n`
}

function vendorTextEncodingTables () {
  const tableRoot = path.dirname(packageFile('iconv-lite', 'encodings/tables/cp936.json'))
  const cp936 = JSON.parse(fs.readFileSync(path.join(tableRoot, 'cp936.json'), 'utf8'))
  const gbkAdded = JSON.parse(fs.readFileSync(path.join(tableRoot, 'gbk-added.json'), 'utf8'))
  const gb18030Ranges = JSON.parse(fs.readFileSync(path.join(tableRoot, 'gb18030-ranges.json'), 'utf8'))
  const shiftJis = JSON.parse(fs.readFileSync(path.join(tableRoot, 'shiftjis.json'), 'utf8'))
  const cp949 = JSON.parse(fs.readFileSync(path.join(tableRoot, 'cp949.json'), 'utf8'))
  const cp950 = JSON.parse(fs.readFileSync(path.join(tableRoot, 'cp950.json'), 'utf8'))
  const big5Added = JSON.parse(fs.readFileSync(path.join(tableRoot, 'big5-added.json'), 'utf8'))
  const cp437High = require('iconv-lite').decode(Buffer.from(Array.from({ length: 128 }, (_, index) => index + 128)), 'cp437')
  const highBytes = Buffer.from(Array.from({ length: 128 }, (_, index) => index + 128))
  const singleByteHigh = Object.fromEntries([874, 1250, 1251, 1252, 1253, 1254, 1255, 1256, 1257, 1258].map(codepage => {
    const decoded = require('iconv-lite').decode(highBytes, `windows-${codepage}`)
    if (Array.from(decoded).length !== 128) throw new Error(`Windows-${codepage} 单字节表长度无效`)
    return [codepage, decoded]
  }))
  const source = `'use strict'\n\n// Generated from iconv-lite tables by scripts/vendor-format-runtime.js.\nmodule.exports = ${JSON.stringify({ cp936, gbkAdded, gb18030Ranges })}\n`
  const legacyCjkSource = `'use strict'\n\n// Generated from iconv-lite tables by scripts/vendor-format-runtime.js.\nmodule.exports = ${JSON.stringify({ cp437High, singleByteHigh, shiftJis, cp949, cp950, big5Added })}\n`
  writeIfChanged(path.join(vendorRoot, 'gb18030-data.js'), source)
  writeIfChanged(path.join(vendorRoot, 'legacy-cjk-data.js'), legacyCjkSource)
  writeIfChanged(path.join(vendorRoot, 'LICENSE-ICONV-LITE'), normalizedText(fs.readFileSync(packageFile('iconv-lite', 'LICENSE'), 'utf8')))
}

function vendorUmd (packageName, relativePath, targetName, licenseName, targetRoot = vendorRoot) {
  fs.mkdirSync(targetRoot, { recursive: true })
  writeIfChanged(path.join(targetRoot, targetName), normalizedText(fs.readFileSync(packageFile(packageName, relativePath), 'utf8')))
  writeIfChanged(path.join(targetRoot, licenseName), normalizedText(fs.readFileSync(packageFile(packageName, 'LICENSE'), 'utf8')))
}

function vendorJpegEncoder () {
  const upstream = fs.readFileSync(packageFile('jpeg-js', 'lib/encoder.js'), 'utf8')
  const source = upstream
    .replace("return Buffer.from(buf).toString('base64');", "return typeof wx !== 'undefined' && typeof wx.arrayBufferToBase64 === 'function' ? wx.arrayBufferToBase64(new Uint8Array(buf).buffer) : '';")
    .replace("if (typeof module === 'undefined') return new Uint8Array(byteout);\n      return Buffer.from(byteout);", 'return new Uint8Array(byteout);')
  if (source === upstream || /\bBuffer\.(?:from|alloc)\b/.test(source)) throw new Error('jpeg-js 微信运行层补丁没有完整生效')
  writeIfChanged(path.join(vendorRoot, 'jpeg-encoder.js'), normalizedText(source))
  writeIfChanged(path.join(vendorRoot, 'LICENSE-JPEG-JS'), normalizedText(fs.readFileSync(packageFile('jpeg-js', 'LICENSE'), 'utf8')))
}

function vendorUnrar () {
  // RAR 内核随 archive 族分包下载
  const targetRoot = path.join(projectRoot, 'miniprogram', 'file-reader', 'archive', 'vendor', 'unrar')
  const commonJsFiles = ['Extractor.js', 'ExtractorData.js', 'ExtractorData.helper.js', 'unrar.singleton.js']
  for (const filename of commonJsFiles) {
    let source = fs.readFileSync(packageFile('node-unrar-js', `dist/js/${filename}`), 'utf8')
    if (filename === 'Extractor.js') {
      source = source.replace('// hostOS: arcFileHeader.hostOS', 'hostOS: arcFileHeader.hostOS,')
        .replace('// // fileAttr: arcFileHeader.fileAttr,', 'fileAttr: arcFileHeader.fileAttr,')
      if (!source.includes('            hostOS: arcFileHeader.hostOS,') || !source.includes('            fileAttr: arcFileHeader.fileAttr,')) throw new Error('UnRAR 链接属性补丁没有生效')
    }
    writeIfChanged(path.join(targetRoot, filename), normalizedText(source))
  }
  const indexSource = fs.readFileSync(packageFile('node-unrar-js', 'dist/index.esm.js'), 'utf8')
    .replace(/\.\/js\//g, './')
    .replace('async function createExtractorFromData({ wasmBinary, data, password = \'\', }) {', 'async function createExtractorFromData({ wasmBinary, instantiateWasm, data, password = \'\', }) {')
    .replace('const unrar = await (0, unrar_singleton_1.getUnrar)(wasmBinary && { wasmBinary });', 'const unrar = await (0, unrar_singleton_1.getUnrar)({ ...(wasmBinary ? { wasmBinary } : {}), ...(instantiateWasm ? { instantiateWasm } : {}) });')
  writeIfChanged(path.join(targetRoot, 'index.js'), normalizedText(indexSource))
  const safeEmbindInvoker = `function craftInvokerFunction(humanName,argTypes,classType,cppInvokerFunc,cppTargetFunc){
var argCount=argTypes.length;
if(argCount<2)throwBindingError("argTypes array size mismatch! Must at least get return value and 'this' types!");
var isClassMethodFunc=argTypes[1]!==null&&classType!==null;
var needsDestructorStack=false;
for(var i=1;i<argTypes.length;++i){if(argTypes[i]!==null&&argTypes[i].destructorFunction===undefined){needsDestructorStack=true;break}}
var returns=argTypes[0].name!=="void";
return function(){
if(arguments.length!==argCount-2)throwBindingError("function "+humanName+" called with "+arguments.length+" arguments, expected "+(argCount-2)+" args!");
var destructors=needsDestructorStack?[]:null;
var wired=[];
if(isClassMethodFunc)wired.push(argTypes[1].toWireType(destructors,this));
for(var index=0;index<argCount-2;++index)wired.push(argTypes[index+2].toWireType(destructors,arguments[index]));
var rv=cppInvokerFunc.apply(null,[cppTargetFunc].concat(wired));
if(needsDestructorStack)runDestructors(destructors);
else for(var typeIndex=isClassMethodFunc?1:2;typeIndex<argTypes.length;++typeIndex){
var type=argTypes[typeIndex];
if(type.destructorFunction!==null)type.destructorFunction(wired[typeIndex-(isClassMethodFunc?1:2)]);
}
return returns?argTypes[0].fromWireType(rv):undefined;
}
}`
  const glueSource = fs.readFileSync(packageFile('node-unrar-js', 'esm/js/unrar.js'), 'utf8')
    .replace('var Module = (() => {', 'var WebAssembly = typeof WXWebAssembly === \'object\' ? WXWebAssembly : globalThis.WebAssembly;\nvar Module = (() => {')
    // 微信小程序禁止 new Function/eval；Emscripten 这里只用动态函数名改善报错，
    // 改成普通闭包不会改变调用或原型语义。
    .replace(/function createNamedFunction\(name,body\)\{[\s\S]*?\(body\)\}/, 'function createNamedFunction(name,body){return function(){return body.apply(this,arguments)}}')
    .replace(/function craftInvokerFunction\(humanName,argTypes,classType,cppInvokerFunc,cppTargetFunc\)\{[\s\S]*?(?=function __embind_register_class_function)/, safeEmbindInvoker)
    .replace('export default Module;', 'module.exports = Module;')
  writeIfChanged(path.join(targetRoot, 'unrar.js'), normalizedText(glueSource))
  const wasm = fs.readFileSync(packageFile('node-unrar-js', 'esm/js/unrar.wasm'))
  const compressedWasm = zlib.brotliCompressSync(wasm, {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 }
  })
  writeBinaryIfChanged(path.join(targetRoot, 'unrar.wasm.br'), compressedWasm)
  writeIfChanged(path.join(targetRoot, 'LICENSE-NODE-UNRAR-JS'), normalizedText(fs.readFileSync(packageFile('node-unrar-js', 'LICENSE.md'), 'utf8')))
  writeIfChanged(path.join(targetRoot, 'NOTICE-UNRAR'), 'RAR 解压内核由 node-unrar-js 2.0.2 提供，项目采用 MIT License。\n上游：https://github.com/YuJianrong/node-unrar.js\nWASM 源码：https://github.com/YuJianrong/node-unrar.js/tree/master/wasm\n')
}

function vendorSevenZip () {
  // Never silently replace our native member API with npm's lossy CLI build.
  const nativeRoot = path.join(projectRoot, 'tools/sevenzip-native')
  const manifest = JSON.parse(fs.readFileSync(path.join(nativeRoot, 'manifest.json'), 'utf8'))
  const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
  for (const name of ['7zz.js', '7zz.wasm.br']) {
    if (digest(fs.readFileSync(path.join(sevenZipRuntimeRoot, name))) !== manifest.files[name]) throw new Error(`7-Zip native artifact hash mismatch: ${name}; rebuild with scripts/build-sevenzip-native.js`)
  }
  for (const name of ['7zz-emcc.patch', 'native-listing.patch']) {
    if (digest(fs.readFileSync(path.join(nativeRoot, name))) !== manifest.patches[name]) throw new Error(`7-Zip native source patch changed without rebuild: ${name}`)
  }
  if (digest(zlib.brotliDecompressSync(fs.readFileSync(path.join(sevenZipRuntimeRoot, '7zz.wasm.br')))) !== manifest.wasmSha256) throw new Error('7-Zip decompressed WASM hash mismatch')
  writeIfChanged(path.join(sevenZipRuntimeRoot, 'LICENSE-7ZIP'), normalizedText(fs.readFileSync(packageFile('7z-wasm', 'License.txt'), 'utf8')))
  writeIfChanged(path.join(sevenZipRuntimeRoot, 'LICENSE-UNRAR'), normalizedText(fs.readFileSync(packageFile('7z-wasm', 'unRarLicense.txt'), 'utf8')))
  writeIfChanged(path.join(sevenZipRuntimeRoot, 'NOTICE-7ZIP'), '7z 解压内核基于 7-Zip 24.09，使用 7z-wasm 1.2.0 构建补丁及兔子阅读器原生成员目录回调补丁。\n可复现源代码、固定提交、构建脚本及文件校验：tools/sevenzip-native/README.md。\n上游：https://github.com/use-strict/7z-wasm\n7-Zip 源码：https://github.com/ip7z/7zip/tree/24.09\n内核采用 GNU LGPL 2.1 or later，并受随包 unRAR restriction 约束。\n')
}

vendorTextEncodingTables()
// marked 只被 Markdown 分包使用，放进分包目录，不占主包额度。
vendorUmd('marked', 'lib/marked.umd.js', 'marked.js', 'LICENSE-MARKED', markdownVendorRoot)
vendorUmd('fflate', 'umd/index.js', 'fflate.js', 'LICENSE-FFLATE', path.join(projectRoot, 'miniprogram', 'file-reader', 'document', 'vendor'))
vendorJpegEncoder()
vendorUnrar()
vendorSevenZip()

console.log('vendored GB18030/Shift_JIS/CP949/Big5 tables, marked, fflate, JPEG encoder, RAR, and 7z runtimes')
