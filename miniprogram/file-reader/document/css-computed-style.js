'use strict'

const { cascadeForElement, parseCssRules, parseCssColor, DOM_UA_CSS, ABSOLUTE_UNIT_FACTORS } = require('./document-renderer')
const { resolveLength } = require('./css-length')
const names = require('./css-color-names')
const INHERITED = new Set(['color','font-family','font-size','font-style','font-weight','line-height','letter-spacing','word-spacing','white-space','text-align','text-indent','text-transform','visibility','direction','cursor'])
const INITIAL = { color:'rgb(0, 0, 0)', 'background-color':'rgba(0, 0, 0, 0)', 'font-family':'"Times New Roman"', 'font-size':'16px', 'font-style':'normal', 'font-weight':'400', 'line-height':'normal', 'letter-spacing':'normal', 'word-spacing':'0px', 'white-space':'normal', 'text-align':'start', 'text-indent':'0px', 'text-transform':'none', visibility:'visible', direction:'ltr', cursor:'auto', display:'inline', position:'static', opacity:'1', 'box-sizing':'content-box', width:'auto', height:'auto', content:'normal', 'overflow-x':'visible', 'overflow-y':'visible' }
for (const side of ['top','right','bottom','left']) { INITIAL['margin-'+side]='0px'; INITIAL['padding-'+side]='0px'; INITIAL['border-'+side+'-width']='0px'; INITIAL['border-'+side+'-style']='none' }
const px = n => `${Math.round(n * 1000000) / 1000000}px`
function colorValue (value, current) {
  const text=String(value).trim().toLowerCase()
  if (text==='currentcolor') return current
  let color=parseCssColor(names[text] ? '#'+names[text] : text)
  if (!color) {
    const m=text.match(/^hsla?\(\s*([+-]?[\d.]+)(deg|turn|rad|grad)?[,\s]+([\d.]+)%[,\s]+([\d.]+)%(?:\s*[,/]\s*([\d.]+)(%)?)?\s*\)$/)
    if (m) {
      const h=((Number(m[1])*({turn:360,rad:180/Math.PI,grad:.9}[m[2]]||1)%360)+360)%360/60,s=Math.min(1,Number(m[3])/100),l=Math.min(1,Number(m[4])/100)
      const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs(h%2-1)),z=l-c/2
      const rgb=h<1?[c,x,0]:h<2?[x,c,0]:h<3?[0,c,x]:h<4?[0,x,c]:h<5?[x,0,c]:[c,0,x]
      color={r:(rgb[0]+z)*255,g:(rgb[1]+z)*255,b:(rgb[2]+z)*255,a:m[5]==null?1:Math.max(0,Math.min(1,Number(m[5])*(m[6] ? .01 : 1)))}
    }
  }
  if (!color) return null
  const rgb=[color.r,color.g,color.b].map(Math.round).join(', ')
  return color.a===1?`rgb(${rgb})`:`rgba(${rgb}, ${Math.round(color.a*1000)/1000})`
}
function length (value, font, root, percent, document) {
  const w=document._viewportWidth,h=document._viewportHeight
  return resolveLength(value,{em:font,rem:root,'%':percent==null?NaN:percent/100,vw:w/100,vh:h/100,dvw:w/100,dvh:h/100,svw:w/100,svh:h/100,lvw:w/100,lvh:h/100,vmin:Math.min(w,h)/100,vmax:Math.max(w,h)/100,...ABSOLUTE_UNIT_FACTORS})
}
function expanded (input) {
  const styles={...input}
  for (const group of ['margin','padding','border-width','border-style','border-color']) {
    if (!styles[group]) continue
    const v=styles[group].trim().split(/\s+/);if(v.length>4)continue
    const values=[v[0],v[1]||v[0],v[2]||v[0],v[3]||v[1]||v[0]]
    ;['top','right','bottom','left'].forEach((side,i)=>{const key=group.startsWith('border-')?`border-${side}-${group.slice(7)}`:`${group}-${side}`;if(styles[key]==null)styles[key]=values[i]})
  }
  if(styles.overflow){const v=styles.overflow.split(/\s+/);styles['overflow-x']??=v[0];styles['overflow-y']??=v[1]||v[0]}
  if(styles.font==='inherit') for(const key of ['font-size','font-family','font-style','font-weight','line-height'])styles[key]??='inherit'
  else if(styles.font) {
    const match=styles.font.match(/^((?:.*?\s)?)(\d*\.?\d+(?:px|em|rem|%|pt))(?:\s*\/\s*([^\s]+))?\s+(.+)$/)
    if(match){styles['font-size']??=match[2];styles['font-family']??=match[4];styles['line-height']??=match[3]||'normal';styles['font-style']??=/\bitalic\b/.test(match[1])?'italic':'normal';styles['font-weight']??=(match[1].match(/\b(?:bold|[1-9]00)\b/)||['normal'])[0]}
  }
  if(styles.background && colorValue(styles.background,'rgb(0, 0, 0)'))styles['background-color']??=styles.background
  return styles
}
function readOnlyError () { const e=new Error('Computed styles are read-only');e.name='NoModificationAllowedError';e.code=7;throw e }

function createComputedStyleReader (document, getStyles, options={}) {
  let lastSource=null,lastRevision=-1,rules=[],cache=new WeakMap()
  const ua=DOM_UA_CSS.replace(/body\{[^}]*\}/,'body{display:block;margin:8px}')
  function refresh () {
    if(document._styleRevision===lastRevision)return
    const source=getStyles().join('\n')
    if(source!==lastSource){rules=parseCssRules(ua,{ua:true,prepared:true,preserveUnits:true}).concat(parseCssRules(source,{preserveUnits:true,viewportWidth:document._viewportWidth,viewportHeight:document._viewportHeight,colorScheme:options.colorScheme,reducedMotion:options.reducedMotion,orderStart:1000}));lastSource=source;lastRevision=-1}
    if(document._styleRevision!==lastRevision){cache=new WeakMap();lastRevision=document._styleRevision}
  }
  function compute (element,pseudo='',depth=0) {
    if(depth>256)throw new Error('Computed style ancestor depth exceeds safety limit')
    const saved=cache.get(element);if(saved && saved[pseudo])return saved[pseudo]
    const ancestor=pseudo?element:element.parentNode
    const parent=ancestor && ancestor.nodeType===1?compute(ancestor,'',depth+1):null
    const cascade=cascadeForElement(element,rules,parent?.variables||{},16,{preserveUnits:true,pseudo,expandDeclaration:d=>Object.entries(expanded({[d.property]:d.value})).map(([property,value])=>({...d,property,value}))})
    const raw=expanded(cascade.styles),styles={...INITIAL}
    if(parent)for(const key of INHERITED)styles[key]=parent.styles[key]
    for(const key of Object.keys(raw)) {
      let value=raw[key]
      if(value==='inherit'||value==='unset'&&INHERITED.has(key))value=parent?.styles[key]||INITIAL[key]||''
      else if(value==='initial'||value==='unset')value=INITIAL[key]||''
      styles[key]=value
    }
    const inheritedFont=parseFloat(parent?.styles['font-size'])||16
    const root=element===document.documentElement?16:parseFloat(cache.get(document.documentElement)?.['']?.styles['font-size'])||16
    let font=length(styles['font-size'],inheritedFont,root,inheritedFont,document)
    if(font==null)font=({small:13,medium:16,large:18,'x-large':24,'xx-large':32,smaller:inheritedFont/1.2,larger:inheritedFont*1.2})[styles['font-size']]||inheritedFont
    styles['font-size']=px(font)
    const unitlessLine=raw['line-height']==null?parent?.unitlessLine:/^[\d.]+$/.test(raw['line-height'])?Number(raw['line-height']):null
    if(unitlessLine!=null)styles['line-height']=px(unitlessLine*font)
    else { const line=length(styles['line-height'],font,root,font,document);if(line!=null)styles['line-height']=px(line) }
    if(styles['font-weight']==='normal')styles['font-weight']='400'
    if(styles['font-weight']==='bold')styles['font-weight']='700'
    const current=parent?.styles.color||INITIAL.color
    styles.color=colorValue(styles.color,current)||current
    for(const key of Object.keys(styles))if(key.endsWith('color')&&key!=='color')styles[key]=colorValue(styles[key],styles.color)||INITIAL[key]||styles[key]
    const parentWidth=parent?.contentWidth??document._viewportWidth,parentHeight=parent?.contentHeight??(element===document.documentElement?document._viewportHeight:undefined)
    for(const key of Object.keys(styles)) {
      if(!/^(?:margin-|padding-|border-.*-width$|text-indent$|letter-spacing$|word-spacing$)/.test(key))continue
      const n=length(styles[key],font,root,parentWidth,document);if(n!=null)styles[key]=px(n)
    }
    const width=length(styles.width,font,root,parentWidth,document),height=length(styles.height,font,root,parentHeight,document)
    const horizontal=prefix=>['left','right'].reduce((sum,side)=>sum+(parseFloat(styles[prefix==='border'?`border-${side}-width`:`${prefix}-${side}`])||0),0)
    const padding=horizontal('padding'),border=horizontal('border'),margin=horizontal('margin')
    let contentWidth=width==null?Math.max(0,parentWidth-margin-padding-border):Math.max(0,width-(styles['box-sizing']==='border-box'?padding+border:0))
    if(width!=null)styles.width=px(width)
    else if(styles.width==='auto'&&/^(block|flex|grid|flow-root|list-item)$/.test(styles.display)&&styles.position!=='absolute'&&styles.position!=='fixed')styles.width=px(styles['box-sizing']==='border-box'?contentWidth+padding+border:contentWidth)
    if(height!=null)styles.height=px(height)
    const result={styles,variables:cascade.variables,contentWidth,contentHeight:height,unitlessLine,values:{...styles,...Object.fromEntries(Object.entries(cascade.variables).filter(([,v])=>v!=null))}}
    const entry=cache.get(element)||{};entry[pseudo]=result;cache.set(element,entry);return result
  }
  return (element,pseudo) => {
    if(!element||element.nodeType!==1)throw new TypeError('getComputedStyle requires an Element')
    const pseudoText=pseudo==null?'':String(pseudo),validPseudo=!pseudoText||!pseudoText.startsWith(':')||/^::?(before|after)$/.test(pseudoText)
    const normalized=/^::?(before|after)$/.exec(pseudoText)?.[1]||''
    const values=()=>{refresh();if(!validPseudo||!document.contains(element))return {};return compute(element,normalized).values}
    const keys=()=>Object.keys(values()).sort()
    const api={getPropertyValue:name=>values()[String(name)]||'',getPropertyPriority:()=>'',item:index=>keys()[Number(index)]||'',setProperty:readOnlyError,removeProperty:readOnlyError}
    return new Proxy(api,{
      get(target,name){if(name==='cssText')return '';if(name==='parentRule')return null;if(name==='length')return keys().length;if(name===Symbol.iterator)return function*(){yield* keys()};if(name in target)return target[name];if(typeof name!=='string')return undefined;if(/^\d+$/.test(name))return keys()[Number(name)];const key=name.startsWith('--')?name:name==='cssFloat'?'float':name.replace(/[A-Z]/g,c=>'-'+c.toLowerCase());const map=values();return key in map?map[key]:key in INITIAL?'':undefined},
      set:readOnlyError,deleteProperty:readOnlyError,defineProperty:readOnlyError,
      ownKeys:()=>keys().map((_,i)=>String(i)),getOwnPropertyDescriptor:(_target,name)=>/^\d+$/.test(String(name))&&Number(name)<keys().length?{enumerable:true,configurable:true,value:keys()[Number(name)]}:undefined
    })
  }
}
module.exports={createComputedStyleReader,colorValue}
