'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const { AUDIO_EXTENSIONS, VIDEO_EXTENSIONS } = require('../miniprogram/file-reader/shared/file-types')
const { MEDIA_PLATFORM_SUPPORT, inspectMediaHeader, mediaPlatformCompatibility } = require('../miniprogram/file-reader/engine/core/media-inspector')

test('MP4 文件头会显示真实容器和可见轨道编码线索', () => {
  const bytes = Buffer.alloc(96)
  bytes.writeUInt32BE(24, 0)
  bytes.write('ftyp', 4)
  bytes.write('mp42', 8)
  bytes.write('avc1', 32)
  bytes.write('mp4a', 48)
  const inspection = inspectMediaHeader(bytes, { name: '片段.mp4' }, 'video')
  assert.equal(inspection.recognized, true)
  assert.match(inspection.format, /ISO Base Media.*mp42/)
  assert.deepEqual(inspection.codecs, ['avc1', 'mp4a'])
})

test('WAV 会读取声道、采样率和位深而不是只看后缀', () => {
  const bytes = Buffer.alloc(44)
  bytes.write('RIFF', 0)
  bytes.writeUInt32LE(36, 4)
  bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(2, 22)
  bytes.writeUInt32LE(44100, 24)
  bytes.writeUInt16LE(16, 34)
  const inspection = inspectMediaHeader(bytes, { name: '录音.wav' }, 'audio')
  assert.equal(inspection.format, 'WAV')
  assert.deepEqual(inspection.codecs, ['PCM'])
  assert.deepEqual(inspection.details, ['2 声道', '44100 Hz', '16 bit'])
})

test('伪装成音频的未知文件会明确标为未识别', () => {
  const inspection = inspectMediaHeader(Buffer.from('not an audio file'), { name: '伪装.mp3' }, 'audio')
  assert.equal(inspection.recognized, false)
  assert.equal(inspection.format, '未识别')
})

test('19 个音视频扩展名都有明确的平台播放结论', () => {
  const expected = [...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS].sort()
  assert.deepEqual(Object.keys(MEDIA_PLATFORM_SUPPORT).sort(), expected)
  for (const extension of expected) {
    const compatibility = mediaPlatformCompatibility({ name: `样本.${extension}` }, AUDIO_EXTENSIONS.has(extension) ? 'audio' : 'video', 'devtools')
    assert.notEqual(compatibility.support, 'unknown', `${extension} 不应退回未知平台能力`)
    assert.ok(compatibility.message, `${extension} 缺少用户可见的平台说明`)
  }
})

test('平台专有格式不会在不支持的真机上伪装成可播放', () => {
  assert.equal(mediaPlatformCompatibility({ name: '录音.flac' }, 'audio', 'ios').canAttempt, false)
  assert.equal(mediaPlatformCompatibility({ name: '录音.flac' }, 'audio', 'android').canAttempt, true)
  assert.equal(mediaPlatformCompatibility({ name: '视频.mov' }, 'video', 'android').canAttempt, false)
  assert.equal(mediaPlatformCompatibility({ name: '视频.mov' }, 'video', 'ios').canAttempt, true)
  assert.equal(mediaPlatformCompatibility({ name: '视频.mp4' }, 'video', 'android').canAttempt, true)
})

test('AAC 会从 ADTS 文件头读取采样率和声道', () => {
  const inspection = inspectMediaHeader(Buffer.from([0xff, 0xf1, 0x50, 0x80, 0x00, 0x1f, 0xfc]), { name: '录音.aac' }, 'audio')
  assert.equal(inspection.format, 'AAC (ADTS)')
  assert.deepEqual(inspection.codecs, ['AAC'])
  assert.deepEqual(inspection.details, ['44100 Hz', '2 声道'])
})

test('单独选择 M3U8 时列出真实分片且不显示空播放器', () => {
  const source = Buffer.from('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:5,\nsegment-01.ts\n#EXTINF:5,\nsegment-02.ts\n')
  const inspection = inspectMediaHeader(source, { name: '直播.m3u8' }, 'video')
  assert.equal(inspection.format, 'HLS 播放列表')
  assert.equal(inspection.playable, false)
  assert.deepEqual(inspection.details, ['2 个分片/子清单引用', '包含加密密钥引用', 'segment-01.ts', 'segment-02.ts'])
  assert.match(inspection.reason, /不能把单个本地清单伪装成可播放视频/)
  assert.equal(mediaPlatformCompatibility({ name: '直播.m3u8' }, 'video', 'ios').canAttempt, false)
})
