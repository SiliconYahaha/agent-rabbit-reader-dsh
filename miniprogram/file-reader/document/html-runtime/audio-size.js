'use strict'
// Bound PCM before native decoding. Compressed byte length alone cannot bound
// decoded memory. Accept inspectable PCM WAV / MPEG Layer III streams only.
function decodedAudioBytes (bytes, outputRate = 48000) {
  const b = new Uint8Array(bytes), text = (at, n) => String.fromCharCode(...b.slice(at, at+n))
  const rate = Number(outputRate)
  if (!Number.isFinite(rate) || rate < 8000 || rate > 192000) throw new Error('Invalid audio output rate')
  let seconds = 0, channels = 0
  if (text(0,4) === 'RIFF' && text(8,4) === 'WAVE') {
    const d = new DataView(b.buffer,b.byteOffset,b.byteLength)
    let format, dataBytes = 0
    for(let p=12;p+8<=b.length;){const size=d.getUint32(p+4,true),end=p+8+size;if(end>b.length)throw Error('Truncated WAV');const name=text(p,4)
      if(name==='fmt '&&size>=16)format={codec:d.getUint16(p+8,true),channels:d.getUint16(p+10,true),rate:d.getUint32(p+12,true),align:d.getUint16(p+20,true),bits:d.getUint16(p+22,true)}
      if(name==='data')dataBytes+=size
      p=end+(size%2)
    }
    if(!format||![1,3].includes(format.codec)||![8,16,24,32].includes(format.bits)||!format.align||format.align!==format.channels*format.bits/8||format.rate<8000||format.rate>192000)throw Error('Unsupported WAV format')
    channels=format.channels;seconds=dataBytes/format.align/format.rate
  } else {
    let p=0,frames=0
    if(text(0,3)==='ID3'){
      if(b.length<10||[6,7,8,9].some(i=>b[i]&128))throw Error('Invalid MP3 metadata')
      p=10+(b[6]<<21)+(b[7]<<14)+(b[8]<<7)+b[9]+((b[5]&16)?10:0)
    }
    while(p+4<=b.length){
      if(text(p,3)==='TAG'&&p+128===b.length)break
      const h=(b[p]*16777216+(b[p+1]<<16)+(b[p+2]<<8)+b[p+3])>>>0
      if((h>>>21)!==2047)throw Error('Invalid MP3 frame')
      const version=(h>>>19)&3,layer=(h>>>17)&3,bi=(h>>>12)&15,ri=(h>>>10)&3
      if(version===1||layer!==1||!bi||bi===15||ri===3)throw Error('Unsupported MP3 frame')
      const bitrate=(version===3?[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320]:[0,8,16,24,32,40,48,56,64,80,96,112,128,144,160])[bi]*1000
      const sampleRate=[44100,48000,32000][ri]/(version===3?1:version===2?2:4)
      const length=Math.floor((version===3?144:72)*bitrate/sampleRate)+((h>>>9)&1)
      if(length<4||p+length>b.length)throw Error('Truncated MP3')
      seconds+=(version===3?1152:576)/sampleRate;channels=Math.max(channels,((h>>>6)&3)===3?1:2);p+=length
      if(++frames>100000)throw Error('MP3 frame limit exceeded')
    }
    if(!frames)throw Error('Unsupported audio format')
  }
  if(!channels||channels>8||!Number.isFinite(seconds)||seconds<=0)throw Error('Invalid audio duration')
  return Math.ceil((seconds+1)*rate)*channels*4
}
module.exports={decodedAudioBytes}
