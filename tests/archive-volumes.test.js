'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { archiveVolumeDescriptor, collectArchiveVolumeSet, isArchiveVolumeName } = require('../miniprogram/file-reader/shared/archive-volumes')
const { fileKind } = require('../miniprogram/file-reader/shared/file-types')

function file (name, size = 10) { return { name, size, path: `/tmp/${name}` } }

test('识别 7z/ZIP 数字分卷并按顺序组合', () => {
  const files = [file('资料.7z.003'), file('资料.7z.001'), file('资料.7z.002')]
  const set = collectArchiveVolumeSet(files, files[1])
  assert.equal(set.format, '7z')
  assert.equal(set.mainName, '资料.7z.001')
  assert.deepEqual(set.files.map(item => item.volumeName), ['资料.7z.001', '资料.7z.002', '资料.7z.003'])
  assert.deepEqual(set.missingNames, [])
  assert.equal(set.totalSize, 30)
  assert.equal(fileKind(files[0]), 'archive')

  const zipFiles = [file('链接.zip.003'), file('链接.zip.001')]
  const zipSet = collectArchiveVolumeSet(zipFiles, zipFiles[1])
  assert.equal(zipSet.format, 'zip')
  assert.equal(zipSet.mainName, '链接.zip.001')
  assert.deepEqual(zipSet.missingNames, ['链接.zip.002'])
})

test('ZIP z01 与主 zip 缺卷时返回可读文件名', () => {
  const files = [file('资料.z01'), file('资料.z03'), file('资料.zip')]
  const set = collectArchiveVolumeSet(files, files[2])
  assert.equal(set.mainName, '资料.zip')
  assert.deepEqual(set.missingNames, ['资料.z02'])
  assert.equal(fileKind(files[0]), 'archive')

  const complete = [file('资料.zip'), file('资料.z02'), file('资料.z01')]
  const completeSet = collectArchiveVolumeSet(complete, complete[0])
  assert.deepEqual(completeSet.files.map(item => item.volumeName), ['资料.z01', '资料.z02', '资料.zip'])
  assert.deepEqual(completeSet.missingNames, [])
})

test('新旧 RAR 分卷均能确定主卷与缺失卷', () => {
  const modern = [file('图纸.part1.rar'), file('图纸.part3.rar')]
  assert.deepEqual(collectArchiveVolumeSet(modern, modern[0]).missingNames, ['图纸.part2.rar'])
  assert.equal(collectArchiveVolumeSet(modern, modern[0]).mainName, '图纸.part1.rar')

  const legacy = [file('图纸.rar'), file('图纸.r01')]
  assert.deepEqual(collectArchiveVolumeSet(legacy, legacy[0]).missingNames, ['图纸.r00'])
  assert.equal(collectArchiveVolumeSet(legacy, legacy[0]).mainName, '图纸.rar')
  assert.equal(isArchiveVolumeName('图纸.r01'), true)
})

test('普通单文件压缩包不会被误判成分卷集合', () => {
  assert.equal(collectArchiveVolumeSet([file('普通.zip')], file('普通.zip')), null)
  assert.equal(archiveVolumeDescriptor('普通.7z'), null)
  assert.equal(isArchiveVolumeName('普通.rar'), false)
})
