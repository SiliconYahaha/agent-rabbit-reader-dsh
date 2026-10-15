'use strict'

const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const sourcePath = path.join(root, 'node_modules', 'sval', 'dist', 'sval.umd.cjs')
const targetPath = path.join(root, 'miniprogram', 'file-reader', 'document', 'html-runtime', 'vendor', 'sval.js')

function replaceExactly (source, before, after, expectedCount) {
  const count = source.split(before).length - 1
  if (count !== expectedCount) {
    throw new Error(`Sval ${before.slice(0, 42)} patch point drifted: expected ${expectedCount}, got ${count}`)
  }
  return source.split(before).join(after)
}

let source = fs.readFileSync(sourcePath, 'utf8')

source = replaceExactly(
  source,
  'function Kt(e,t){return Ht("get",e,t)}function Qt(e,t){return Ht("set",e,t)}',
  'function Kt(e,t){return Ht("get",e,t)}function Qt(e,t){return Ht("set",e,t)}const __htmlReaderImportedFunctions=new WeakSet,__htmlReaderPrototypeShadows=new WeakMap,__htmlReaderDynamicConstructors=new WeakSet([Function,Object.getPrototypeOf(async function(){}).constructor,Object.getPrototypeOf(function*(){}).constructor]);function __htmlReaderCloneMethod(e){return typeof e==="function"?function(){return Reflect.apply(e,this,arguments)}:e}function __htmlReaderPrototypeShadow(e){if(e==null)return null;if(__htmlReaderPrototypeShadows.has(e))return __htmlReaderPrototypeShadows.get(e);const t=Object.create(null);__htmlReaderPrototypeShadows.set(e,t);for(let r=e;r;r=Object.getPrototypeOf(r))Reflect.ownKeys(r).forEach(i=>{if(i==="constructor"||i==="__proto__"||Object.prototype.hasOwnProperty.call(t,i))return;const s=Object.getOwnPropertyDescriptor(r,i);if(!s)return;if("value" in s)s.value=__htmlReaderCloneMethod(s.value);if(s.get)s.get=__htmlReaderCloneMethod(s.get);if(s.set)s.set=__htmlReaderCloneMethod(s.set);try{Object.defineProperty(t,i,s)}catch{}});return t}function __htmlReaderSafeRead(e,t){if(t==="constructor"){const r=e==null?void 0:e[t];return typeof r==="function"&&__htmlReaderDynamicConstructors.has(r)?void 0:r}if(t==="__proto__")return __htmlReaderPrototypeShadow(e==null?null:Object.getPrototypeOf(e));if(t==="prototype"&&typeof e==="function"&&__htmlReaderImportedFunctions.has(e))return __htmlReaderPrototypeShadow(e.prototype);return e[t]}function __htmlReaderSafeWriteProp(e,t){if(t==="__proto__"||t==="prototype"&&typeof e==="function"&&__htmlReaderImportedFunctions.has(e))throw new TypeError("HTML Reader blocked unsafe property access (mutation): "+String(t));return t}',
  1
)

source = replaceExactly(
  source,
  'function Tr(){return j(Ce({[De]:h}),Xt)}',
  'function Tr(){return Ce({[De]:h})}',
  1
)

source = replaceExactly(
  source,
  'find(t){if(this.context[t])return this.context[t];if(t in this.withContext)',
  'find(t){if(this.context[t])return this.context[t];if(t==="constructor"||t==="__proto__"||t==="prototype")return null;if(t in this.withContext)',
  1
)

source = replaceExactly(
  source,
  'u&&(a=a[B]),s){',
  'u&&(a=a[B]),s){n=__htmlReaderSafeWriteProp(a,n);',
  2
)

source = replaceExactly(
  source,
  'else return e.optional&&a==null?A:a[n]}',
  'else return e.optional&&a==null?A:__htmlReaderSafeRead(a,n)}',
  2
)

source = replaceExactly(
  source,
  '}else r=l[n];if(e.optional&&r==null)',
  '}else r=__htmlReaderSafeRead(l,n);if(e.optional&&r==null)',
  2
)

source = replaceExactly(
  source,
  'u.push(f);const g=c.value;g.type==="Identifier"?t[i](g.name,n[f])',
  'u.push(f);const g=c.value;g.type==="Identifier"?t[i](g.name,__htmlReaderSafeRead(n,f))',
  2
)

source = replaceExactly(
  source,
  'this.scope.var(n,t[a])}}parse(t,r)',
  'typeof t[a]==="function"&&__htmlReaderImportedFunctions.add(t[a]),this.scope.var(n,t[a])}}parse(t,r)',
  1
)

fs.writeFileSync(targetPath, source)
console.log(`Vendored patched Sval runtime: ${path.relative(root, targetPath)}`)
