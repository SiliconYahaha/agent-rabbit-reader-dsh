'use strict'
require('./vendor/compat')
const { TextDecoder, TextEncoder } = require('./text-encoding')
class PDFMap extends Map { getOrInsertComputed(key,fn){ if(!this.has(key))this.set(key,fn(key));return this.get(key) } getOrInsert(key,value){if(!this.has(key))this.set(key,value);return this.get(key)} }
let scratch
function scratchContext() { if(!scratch)scratch=wx.createOffscreenCanvas({type:'2d',width:1,height:1});return scratch.getContext('2d') }
const DOMMatrix = require('./matrix')
const Path2D = require('./canvas').PDFPath
const ImageData = function (data,width,height) { const result=scratchContext().createImageData(width,height);result.data.set(data);return result }
class AbortSignal {
  constructor () { this.aborted=false;this.listeners=new Set() }
  addEventListener (name,fn) { if(name==='abort')this.listeners.add(fn) }
  removeEventListener (name,fn) { this.listeners.delete(fn) }
  throwIfAborted () { if(this.aborted)throw this.reason }
}
class AbortController { constructor () { this.signal=new AbortSignal() } abort (reason=new Error('Aborted')) { if(this.signal.aborted)return;this.signal.aborted=true;this.signal.reason=reason;for(const fn of this.signal.listeners)fn();this.signal.listeners.clear() } }
function structuredClone (obj, seen = new Map()) {
  if (!(seen instanceof Map)) seen = new Map()
  if (!obj || typeof obj !== 'object') return obj
  if (seen.has(obj)) return seen.get(obj)
  const tag = Object.prototype.toString.call(obj)
  if (tag === '[object ArrayBuffer]') return obj.slice(0)
  if (tag === '[object DataView]') return new DataView(obj.buffer.slice(obj.byteOffset, obj.byteOffset + obj.byteLength))
  if (ArrayBuffer.isView(obj)) return new obj.constructor(obj)
  if (obj instanceof Map) {
    const out = new PDFMap(); seen.set(obj, out)
    for (const [key, value] of obj) out.set(structuredClone(key, seen), structuredClone(value, seen))
    return out
  }
  if (obj instanceof Set) {
    const out = new PDFSet(); seen.set(obj, out)
    for (const value of obj) out.add(structuredClone(value, seen))
    return out
  }
  const out = tag === '[object Error]' ? Object.assign(new Error(obj.message), { name: obj.name }) : Array.isArray(obj) ? [] : {}
  seen.set(obj, out)
  for (const key of Object.keys(obj)) Object.defineProperty(out, key, { value: structuredClone(obj[key], seen), writable: true, enumerable: true, configurable: true })
  return out
}
class PDFWeakMap extends WeakMap { getOrInsertComputed(key,fn){if(!this.has(key))this.set(key,fn(key));return this.get(key)} getOrInsert(key,value){if(!this.has(key))this.set(key,value);return this.get(key)} }
class PDFSet extends Set { intersection(other){return new PDFSet([...this].filter(x=>other.has(x)))} }
module.exports={Map:PDFMap,WeakMap:PDFWeakMap,Set:PDFSet,TextDecoder,TextEncoder,DOMMatrix,Path2D,ImageData,AbortSignal,AbortController,structuredClone,ReadableStream:require('./vendor/streams').ReadableStream}
