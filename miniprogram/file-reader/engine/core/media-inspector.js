'use strict'

const { extensionOf } = require('./design-file')
const { toUint8 } = require('./text-decoder')

const MEDIA_PLATFORM_SUPPORT = Object.freeze({
  flac: 'android', m4a: 'both', ogg: 'android', ape: 'android', amr: 'android', wma: 'android',
  wav: 'both', mp3: 'both', aac: 'both', aiff: 'ios', aif: 'ios', caf: 'ios',
  mp4: 'both', mov: 'ios', m4v: 'ios', '3gp': 'both', avi: 'ios', m3u8: 'playlist', webm: 'android'
})

function ascii (bytes, start, length) {
  let value = ''
  for (let index = start; index < Math.min(bytes.length, start + length); index++) value += String.fromCharCode(bytes[index])
  return value
}

function uint16le (bytes, offset) { return bytes[offset] | (bytes[offset + 1] << 8) }
function uint32le (bytes, offset) { return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0 }
function uint32be (bytes, offset) { return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0 }

function scanAscii (bytes, values) {
  const source = ascii(bytes, 0, bytes.length)
  return values.filter(value => source.includes(value))
}

function inspectMp4 (bytes) {
  if (bytes.length < 12 || ascii(bytes, 4, 4) !== 'ftyp') return null
  const brand = ascii(bytes, 8, 4).replace(/[^\x20-\x7e]/g, '')
  const codecs = scanAscii(bytes, ['avc1', 'avc3', 'hvc1', 'hev1', 'av01', 'vp09', 'mp4a', 'ac-3', 'ec-3'])
  return { format: `ISO Base Media${brand ? ` (${brand})` : ''}`, codecs, confidence: 'container' }
}

function inspectWavOrAvi (bytes) {
  if (ascii(bytes, 0, 4) !== 'RIFF' || bytes.length < 12) return null
  const form = ascii(bytes, 8, 4)
  if (form === 'AVI ') return { format: 'AVI', codecs: scanAscii(bytes, ['H264', 'h264', 'avc1', 'HEVC', 'XVID', 'MJPG', 'mp4a']), confidence: 'container' }
  if (form !== 'WAVE') return null
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const id = ascii(bytes, offset, 4)
    const size = uint32le(bytes, offset + 4)
    if (id === 'fmt ' && offset + 8 + Math.min(size, 16) <= bytes.length) {
      const start = offset + 8
      const codec = uint16le(bytes, start)
      const channels = uint16le(bytes, start + 2)
      const sampleRate = uint32le(bytes, start + 4)
      const bits = size >= 16 ? uint16le(bytes, start + 14) : 0
      return { format: 'WAV', codecs: [codec === 1 ? 'PCM' : codec === 3 ? 'IEEE Float' : `WAVE 格式 ${codec}`], details: [`${channels} 声道`, `${sampleRate} Hz`, bits ? `${bits} bit` : ''].filter(Boolean), confidence: 'stream' }
    }
    offset += 8 + size + (size & 1)
  }
  return { format: 'WAV', codecs: [], confidence: 'container' }
}

function inspectFlac (bytes) {
  if (ascii(bytes, 0, 4) !== 'fLaC') return null
  if (bytes.length >= 42 && (bytes[4] & 0x7f) === 0 && uint32be(Uint8Array.of(0, bytes[5], bytes[6], bytes[7]), 0) >= 34) {
    const sampleRate = (bytes[18] << 12) | (bytes[19] << 4) | (bytes[20] >> 4)
    const channels = ((bytes[20] >> 1) & 0x07) + 1
    const bits = (((bytes[20] & 1) << 4) | (bytes[21] >> 4)) + 1
    return { format: 'FLAC', codecs: ['FLAC'], details: [`${channels} 声道`, `${sampleRate} Hz`, `${bits} bit`], confidence: 'stream' }
  }
  return { format: 'FLAC', codecs: ['FLAC'], confidence: 'container' }
}

function inspectOgg (bytes) {
  if (ascii(bytes, 0, 4) !== 'OggS') return null
  const codecs = []
  const source = ascii(bytes, 0, bytes.length)
  if (source.includes('OpusHead')) codecs.push('Opus')
  if (source.includes('vorbis')) codecs.push('Vorbis')
  if (source.includes('theora')) codecs.push('Theora')
  if (source.includes('fLaC')) codecs.push('FLAC')
  return { format: 'Ogg', codecs, confidence: codecs.length ? 'stream' : 'container' }
}

function inspectMpegAudio (bytes) {
  let offset = ascii(bytes, 0, 3) === 'ID3' && bytes.length >= 10
    ? 10 + ((bytes[6] & 0x7f) << 21) + ((bytes[7] & 0x7f) << 14) + ((bytes[8] & 0x7f) << 7) + (bytes[9] & 0x7f)
    : 0
  for (; offset + 4 <= bytes.length; offset++) {
    if (bytes[offset] !== 0xff || (bytes[offset + 1] & 0xe0) !== 0xe0) continue
    const layer = (bytes[offset + 1] >> 1) & 0x03
    if (!layer) continue
    return { format: 'MPEG Audio', codecs: [layer === 1 ? 'MP3 (Layer III)' : layer === 2 ? 'MP2 (Layer II)' : 'MP1 (Layer I)'], confidence: 'stream' }
  }
  return null
}

function inspectAdtsAac (bytes) {
  for (let offset = 0; offset + 7 <= Math.min(bytes.length, 4096); offset++) {
    if (bytes[offset] !== 0xff || (bytes[offset + 1] & 0xf6) !== 0xf0) continue
    const rates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350]
    const rate = rates[(bytes[offset + 2] >> 2) & 0x0f]
    const channels = ((bytes[offset + 2] & 1) << 2) | (bytes[offset + 3] >> 6)
    return { format: 'AAC (ADTS)', codecs: ['AAC'], details: [rate ? `${rate} Hz` : '', channels ? `${channels} 声道` : ''].filter(Boolean), confidence: 'stream' }
  }
  return null
}

function inspectHlsPlaylist (bytes) {
  const source = ascii(bytes, 0, Math.min(bytes.length, 256 * 1024)).replace(/^\uFEFF/, '')
  if (!source.includes('#EXTM3U')) return null
  const references = source.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#')).slice(0, 20)
  const encrypted = /#EXT-X-KEY:/i.test(source)
  return {
    format: 'HLS 播放列表', codecs: [], confidence: 'playlist', playable: false,
    details: [`${references.length} 个分片/子清单引用`, encrypted ? '包含加密密钥引用' : '未发现加密密钥引用', ...references],
    reason: '聊天中只选择了 .m3u8 清单，微信没有同时提供它引用的分片、子清单或密钥文件；当前可检查清单内容，但不能把单个本地清单伪装成可播放视频。'
  }
}

function mediaPlatformCompatibility (file = {}, kind = '', platform = '') {
  const extension = extensionOf(file.name)
  const support = MEDIA_PLATFORM_SUPPORT[extension] || 'unknown'
  const current = String(platform || '').toLowerCase()
  if (support === 'playlist') return { extension, support, canAttempt: false, message: '本地 M3U8 需要同时提供清单引用的所有分片和密钥；微信聊天单文件入口无法恢复这些同目录资源。' }
  if (support === 'both') return { extension, support, canAttempt: true, message: '微信兼容表标记该格式可在 iOS 与 Android 尝试播放；最终仍取决于文件内实际编码。' }
  if (support === 'ios' || support === 'android') {
    const supportedHere = current.includes(support)
    const platformLabel = support === 'ios' ? 'iOS' : 'Android'
    const currentLabel = current.includes('ios') ? 'iOS' : current.includes('android') ? 'Android' : '开发者工具'
    return {
      extension, support, canAttempt: supportedHere || (!current.includes('ios') && !current.includes('android')),
      message: supportedHere
        ? `微信兼容表标记该格式仅支持 ${platformLabel}；当前设备可以尝试播放。`
        : current.includes('ios') || current.includes('android')
          ? `微信兼容表标记该格式仅支持 ${platformLabel}，当前是 ${currentLabel}；文件不是空白，但当前设备播放器通常无法解码。`
          : `微信兼容表标记该格式仅支持 ${platformLabel}；开发者工具不能替代对应真机验收。`
    }
  }
  return { extension, support, canAttempt: true, message: kind ? '没有找到该扩展名的平台兼容结论，将交给当前微信播放器实际检测。' : '' }
}

function inspectMediaHeader (input, file = {}, kind = '') {
  const bytes = toUint8(input)
  let result = inspectHlsPlaylist(bytes) || inspectMp4(bytes) || inspectWavOrAvi(bytes) || inspectFlac(bytes) || inspectOgg(bytes) || inspectMpegAudio(bytes) || inspectAdtsAac(bytes)
  const signature = Array.from(bytes.slice(0, 16)).map(value => value.toString(16).padStart(2, '0')).join(' ').toUpperCase()
  if (!result && ascii(bytes, 0, 6) === '#!AMR\n') result = { format: 'AMR-NB', codecs: ['AMR-NB'], confidence: 'stream' }
  if (!result && ascii(bytes, 0, 9) === '#!AMR-WB\n') result = { format: 'AMR-WB', codecs: ['AMR-WB'], confidence: 'stream' }
  if (!result && ascii(bytes, 0, 4) === 'FORM' && ['AIFF', 'AIFC'].includes(ascii(bytes, 8, 4))) result = { format: ascii(bytes, 8, 4), codecs: [], confidence: 'container' }
  if (!result && ascii(bytes, 0, 4) === 'caff') result = { format: 'CAF', codecs: scanAscii(bytes, ['lpcm', 'aac ', 'alac', 'opus']), confidence: 'container' }
  if (!result && ascii(bytes, 0, 4) === 'MAC ') result = { format: 'Monkey’s Audio', codecs: ['APE'], confidence: 'stream' }
  if (!result && bytes.length >= 16 && signature === '30 26 B2 75 8E 66 CF 11 A6 D9 00 AA 00 62 CE 6C') result = { format: 'ASF/WMA', codecs: ['WMA'], confidence: 'container' }
  if (!result && bytes.length >= 4 && uint32be(bytes, 0) === 0x1a45dfa3) result = { format: 'WebM/Matroska', codecs: scanAscii(bytes, ['V_VP8', 'V_VP9', 'V_AV1', 'A_OPUS', 'A_VORBIS']), confidence: 'container' }
  const extension = extensionOf(file.name)
  if (!result) return { recognized: false, format: '未识别', codecs: [], details: [], extension, kind, signature }
  return { recognized: true, details: [], extension, kind, signature, ...result }
}

module.exports = { MEDIA_PLATFORM_SUPPORT, inspectMediaHeader, mediaPlatformCompatibility }
