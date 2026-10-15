'use strict'
// Microsoft RTF1.9.1 pp143-144. Unicode literals are authored contracts, not
// generated from the reader's control-word table. Page/column flatten to a line.
const controls = { emspace:'\u2003', enspace:'\u2002', qmspace:'\u2005', zwj:'\u200d', zwnj:'\u200c', zwbo:'\u200b', zwnbo:'\u2060', ltrmark:'\u200e', rtlmark:'\u200f', page:'\n', column:'\n' }
const rtf = text => '{\\rtf1\\ansi ' + text + '}'
const unicode = text => [...Buffer.from(text,'utf16le')].reduce((result,byte,i,bytes) => i%2 ? result+'\\u'+((bytes[i-1]+byte*256)<<16>>16)+'?' : result, '')
const cases = []
for (const [word,char] of Object.entries(controls)) {
  const token = '\\'+word+' '
  for (const [context,body,expected] of [
    ['plain','A'+token+'B','A'+char+'B'],
    ['nested','A{\\b '+token+'}B','A'+char+'B'],
    ['extra-space','A{'+token+' }B','A'+char+' B'],
    ['hidden','A{\\v '+token+'HIDDEN}B','AB'],
    ['visible-child','A{\\v HIDDEN{\\v0 X'+token+'Y}HIDDEN}B','AX'+char+'YB'],
    ['unknown-destination','A{\\*\\private '+token+'HIDDEN}B','AB'],
    ['instruction','A{\\field{\\*\\fldinst '+token+'HIDDEN}{\\fldrslt X'+token+'Y}}B','AX'+char+'YB'],
    ['fallback-one','A\\uc1\\u88'+token+'B','AXB'],
    ['fallback-two','A\\uc2\\u88?'+token+'B','AXB'],
    ['after-fallback','A\\uc1\\u88?'+token+'B','AX'+char+'B'],
    ['unselected-branch','A{\\upr{'+token+'HIDDEN}{\\*\\ud X'+token+'Y}}B','AX'+char+'YB'],
    ['case-sensitive','A\\'+word.toUpperCase()+' B','AB']
  ]) cases.push({id:word+'-'+context,word,context,source:rtf(body),expected})
}
cases.push({id:'emoji-joiner',word:'zwj',context:'visible-ligature',source:rtf(unicode('👩')+'\\zwj '+unicode('🚀')),expected:'👩‍🚀'})
cases.push({id:'arabic-nonjoiner',word:'zwnj',context:'visible-shaping',source:rtf(unicode('ب')+'\\zwnj '+unicode('ب')),expected:'ب‌ب'})
cases.push({id:'mixed-direction',word:'rtlmark',context:'bidi',source:rtf(unicode('אב')+'\\rtlmark : '+unicode('גד')),expected:'אב\u200f: גד'})
for (const word of ['softline','softpage','softcol']) cases.push({id:word+'-optional',word,context:'optional-layout',source:rtf('A\\'+word+' B'),expected:'AB'})
module.exports = { cases, controls }
