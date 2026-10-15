'use strict'
const prior = require('../../compatibility/runs/2026-09-05-next-rtf-control-case.json')
const cases = prior.results.filter(c=>prior.targets.includes(c.name)).map(c=>({name:c.name,source:c.source,expected:c.writerVisible}))
const add=(name,body,expected)=>cases.push({name,source:'{\\rtf1\\ansi '+body+'}',expected})
for(const [label,marker] of [['upper','BIN'],['title','Bin'],['mixed','bIn']]) {
  add('binary-'+label+'-text',`A\\${marker}3 XYZ Z`,'AXYZ Z')
  add('binary-'+label+'-braces',`A\\${marker}9 {X}Z`,'AXZ')
  add('binary-'+label+'-fallback',`A\\uc1\\u66\\${marker}3 XYZ Z`,'ABXYZ Z')
}
add('lower-bin','A\\bin3 XYZ Z','A Z')
add('lower-bin-fallback','A\\uc1\\u66\\bin3 XYZ Z','AB Z')
for(const [index,word] of ['FONTtbl','Fonttbl','Info','STYLESHEET','NESTTABLEPROPS','Nesttableprops'].entries()) {
  add('star-'+index+'-'+word,`A{\\*\\${word} VISIBLE\\nestrow}Z`,'AZ')
}
add('star-nestrow-case','A{\\*\\nesttableprops\\NESTROW}Z','AZ')
add('unknown-upr','A{\\UPR{one}{\\*\\ud two}}Z','AonetwoZ')
add('exact-upr','A{\\upr{one}{\\*\\ud two}}Z','AtwoZ')
add('unknown-uc','A\\Uc0\\u66?Z','ABZ')
add('exact-uc','A\\uc0\\u66?Z','AB?Z')
add('upper-style-hidden','{\\stylesheet{\\s1\\V Upper;}}\\s1 VISIBLE','VISIBLE')
add('lower-style-hidden','{\\stylesheet{\\s1\\v Hidden;}}A{\\s1 HIDDEN}Z','AHIDDENZ')
add('upper-style-id','{\\stylesheet{\\S1\\v Hidden;}}\\s1 VISIBLE','VISIBLE')
add('upper-hidden-reset','A\\v HIDDEN\\PLAIN ALSO HIDDEN\\v0 Z','AZ')
add('lower-hidden-reset','A\\v HIDDEN\\plain VISIBLE Z','AVISIBLE Z')
add('apple-mixed-case','A\\CocoaLigature0 B\\AppleTypeServicesU1 C','ABC')
add('unknown-extension','A\\CustomCommand42 B','AB')
add('standalone-ud','A{\\*\\ud B}Z','ABZ')
add('ud-discarded-parent','A{\\*\\unknown{\\*\\ud SECRET}}Z','AZ')
add('ud-hidden-parent','A{\\v{\\*\\ud SECRET}}Z','AZ')
add('ud-unselected-branch','A{\\upr{{\\*\\ud OLD}}{\\*\\ud NEW}}Z','ANEWZ')
for (const c of cases) if (['upper-style-id','lower-style-hidden'].includes(c.name)) c.knownGap='Existing paragraph/default-style binding differs from Writer visible output; separate from control-case handling.'
module.exports={cases,malformed:[{name:'lower-bin-truncated',source:'{\\rtf1 A\\bin9999 X}'},{name:'upper-ud-alternative',source:'{\\rtf1 A{\\upr{one}{\\*\\UD two}}Z}'},{name:'bad-hex-after-upper-word',source:"{\\rtf1 A\\FONTtbl \\'gg Z}"}]}
