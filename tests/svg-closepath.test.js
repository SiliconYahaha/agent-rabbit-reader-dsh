'use strict'
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const test = require('node:test')
const path = require('node:path')
const parser = require.resolve('../miniprogram/file-reader/image/svg/svg-path')
const helper = require.resolve('./helpers/svg-closepath')

// A test timeout alone cannot interrupt a synchronous infinite loop. Isolate
// the parser and let the parent kill a regression without hanging npm test.
test('SVG closepath: 48 malformed variants and public icons terminate with their valid prefix', () => {
  const result = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const {parsePath}=require(${JSON.stringify(parser)});
    const {cases}=require(${JSON.stringify(helper)});
    for(const item of cases) assert.deepEqual(parsePath(item.input),parsePath(item.expected),item.name);
    assert.deepEqual(parsePath('M2 3L8 9z m1 2l4 5'),[
      {type:'M',x:2,y:3},{type:'L',x:8,y:9},{type:'Z'},
      {type:'M',x:3,y:5},{type:'L',x:7,y:10}]);
    assert.deepEqual(parsePath('M2 3z L8 9'),[{type:'M',x:2,y:3},{type:'Z'},{type:'L',x:8,y:9}]);
    assert.deepEqual(parsePath('M2 3zz'),[{type:'M',x:2,y:3},{type:'Z'},{type:'Z'}]);
    assert.deepEqual(parsePath('M0 0L10 10Z1'),[{type:'M',x:0,y:0},{type:'L',x:10,y:10},{type:'Z'}]);
    assert.deepEqual(parsePath('M0 0z'+' 1'.repeat(100000)),[{type:'M',x:0,y:0},{type:'Z'}]);
    assert.equal(parsePath('M0 0'+ 'l1 0z'.repeat(10000)).length,20001);
    console.log(cases.length);
  `], { cwd: path.join(__dirname, '..'), timeout: 5000, maxBuffer: 1024 * 1024, encoding: 'utf8' })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stderr)
  assert.ok(Number(result.stdout.trim()) >= 52)
})
