'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const recent = require('../miniprogram/utils/recent-session')
function host () {
  const files = new Map([['/chat/a', Buffer.from('hello')], ['/chat/b',Buffer.from('world')]]), storage = new Map(), removed = []
  const fs = {
    mkdir:o=>o.success({}), stat:o=>files.has(o.path)?o.success({stats:{size:files.get(o.path).length}}):o.fail({}),
    copyFile:o=>{files.set(o.destPath,files.get(o.srcPath));o.success({})},
    writeFile:o=>{files.set(o.filePath,Buffer.from(o.data));o.success({})},
    access:o=>files.has(o.path)?o.success({}):o.fail({}),
    unlink:o=>{removed.push(o.filePath);files.delete(o.filePath)}
  }
  return { files, fs, removed, env:{USER_DATA_PATH:'/user'}, getFileSystemManager:()=>fs, getStorageSync:k=>storage.get(k), setStorageSync:(k,v)=>storage.set(k,structuredClone(v)),removeStorageSync:k=>storage.delete(k) }
}
function app () { return {globalData:{fileQueue:[{name:'a.html',path:'/chat/a'},{name:'b.md',path:'/chat/b'}],fileQueueIndex:1,fileQueueScroll:{1:333}}} }
test('缓存复制文件，重启可恢复顺序、当前项和滚动位置', async()=>{
 const wx=host(),a=app();assert.equal(await recent.save(a,a.globalData.fileQueue,wx),true)
 const b={globalData:{}};assert.equal(await recent.restore(b,wx),true)
 assert.deepEqual(b.globalData.fileQueue.map(f=>f.name),['a.html','b.md']);assert.equal(b.globalData.fileQueueIndex,1);assert.equal(b.globalData.fileQueueScroll[1],333)
 assert.ok(b.globalData.fileQueue[0].path.startsWith('/user/rabbit-recent-v1/'))
})
test('20 分钟固定到期，清理不碰聊天原件',async()=>{
 const wx=host(),a=app(),now=Date.now();await recent.save(a,a.globalData.fileQueue,wx,now)
 assert.ok(recent.read(wx,now+recent.TTL-1));assert.equal(recent.read(wx,now+recent.TTL),null)
 assert.equal(wx.files.get('/chat/a').toString(),'hello');assert.equal(wx.files.size,2)
})
test('读取进度不会延长缓存期限，未关联会话不能污染缓存',async()=>{
 const wx=host(),a=app();await recent.save(a,a.globalData.fileQueue,wx);const end=recent.read(wx).expiresAt
 a.globalData.fileQueueIndex=0;a.globalData.fileQueueScroll[0]=88;recent.checkpoint(a,wx)
 assert.equal(recent.read(wx).index,0);assert.equal(recent.read(wx).expiresAt,end)
 recent.checkpoint(app(),wx);assert.equal(recent.read(wx).index,0)
})
test('丢失缓存文件时不给出可恢复的假会话',async()=>{
 const wx=host(),a=app();await recent.save(a,a.globalData.fileQueue,wx);wx.files.delete(recent.read(wx).files[0].path)
 assert.equal(await recent.restore({globalData:{}},wx),false);assert.equal(recent.read(wx),null)
})
test('磁盘满失败、超过上限失败均不删除原件',async()=>{
 for(const mode of ['quota','large']){const wx=host(),a=app();if(mode==='quota')wx.fs.copyFile=o=>o.fail({});else wx.fs.stat=o=>o.success({stats:{size:recent.MAX_BYTES+1}})
 assert.equal(await recent.save(a,a.globalData.fileQueue,wx),false);assert.equal(recent.read(wx),null);assert.ok(wx.files.has('/chat/a'))}
})
test('缓存复制尚未完成时清除，迟到回调不复活缓存',async()=>{
 const wx=host(),a=app();let pending
 wx.fs.copyFile=o=>{pending=o}
 const saving=recent.save(a,a.globalData.fileQueue,wx);await new Promise(r=>setImmediate(r));recent.clear(wx);pending.success({});await saving
 assert.equal(recent.read(wx),null)
})
test('粘贴 HTML 写入本机文件，不把大段正文放进键值存储',async()=>{
 const wx=host(),a=app();a.globalData.fileQueue=[{name:'粘贴',inlineHtml:'<p>中文</p>'}]
 assert.equal(await recent.save(a,a.globalData.fileQueue,wx),true);const f=recent.read(wx).files[0];assert.equal(f.inlineHtml,undefined);assert.equal(f.type,'text/html');assert.equal(wx.files.get(f.path).toString(),'<p>中文</p>')
})

test('清理过期孤立副本，仅扫描自有目录且保留未到期文件',()=>{
 const wx=host(),now=Date.now(),old='/user/rabbit-recent-v1/'+(now-recent.TTL)+'-1-0.html',fresh='/user/rabbit-recent-v1/'+now+'-1-0.html'
 wx.files.set(old,Buffer.from('a'));wx.files.set(fresh,Buffer.from('b'))
 wx.fs.readdir=o=>o.success({files:[old.split('/').pop(),fresh.split('/').pop(),'../../chat/a','unknown-file']})
 recent.prune(wx,now);assert.deepEqual(wx.removed,[old]);assert.ok(wx.files.has(fresh));assert.ok(wx.files.has('/chat/a'))
})
test('恢复期间清除缓存，迟到的 access 不能替换当前会话',async()=>{
 const wx=host(),a=app();await recent.save(a,a.globalData.fileQueue,wx);let pending
 wx.fs.access=o=>{pending=o};const b=app(),before=b.globalData.fileQueue
 const restoring=recent.restore(b,wx);recent.clear(wx);pending.success({})
 // A second access may be issued, but it must not restore a stale session.
 await new Promise(r=>setImmediate(r));pending.success({});assert.equal(await restoring,false);assert.equal(b.globalData.fileQueue,before)
})
