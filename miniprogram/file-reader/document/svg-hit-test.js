'use strict'

const multiply = (a, b) => [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]]
const identity = () => [1,0,0,1,0,0]
function transform (text) {
  let matrix = identity()
  for (const m of String(text || '').matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)) {
    const n = m[2].trim().split(/[\s,]+/).map(Number); let next = identity()
    if (!n.every(Number.isFinite)) continue
    if (m[1] === 'matrix' && n.length === 6) next = n
    if (m[1] === 'translate') next = [1,0,0,1,n[0],n[1] || 0]
    if (m[1] === 'scale') next = [n[0],0,0,n[1] ?? n[0],0,0]
    if (m[1] === 'rotate') {
      const c = Math.cos(n[0]*Math.PI/180), s = Math.sin(n[0]*Math.PI/180), x=n[1]||0,y=n[2]||0
      next = [c,s,-s,c,x-c*x+s*y,y-s*x-c*y]
    }
    if (m[1] === 'skewX') next[2] = Math.tan(n[0]*Math.PI/180)
    if (m[1] === 'skewY') next[1] = Math.tan(n[0]*Math.PI/180)
    matrix = multiply(matrix, next)
  }
  return matrix
}
function pointIn (m, x, y) {
  const d=m[0]*m[3]-m[1]*m[2]
  if (!d || !Number.isFinite(d)) return null
  return [(m[3]*(x-m[4])-m[2]*(y-m[5]))/d,(-m[1]*(x-m[4])+m[0]*(y-m[5]))/d]
}
function viewport (node, width, height, x=0, y=0) {
  const v=(node.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number)
  if (v.length !== 4 || !v.every(Number.isFinite)) return [1,0,0,1,x,y]
  if (!(v[2]>0 && v[3]>0 && width>0 && height>0)) return [0,0,0,0,0,0]
  const p=node.getAttribute('preserveAspectRatio') || 'xMidYMid meet'
  let sx=width/v[2],sy=height/v[3],dx=x,dy=y
  if (!/^none(?:\s|$)/.test(p)) {
    sx=sy=/slice/.test(p)?Math.max(sx,sy):Math.min(sx,sy)
    if (/xMid/.test(p)) dx+=(width-v[2]*sx)/2
    if (/xMax/.test(p)) dx+=width-v[2]*sx
    if (/YMid/.test(p)) dy+=(height-v[3]*sy)/2
    if (/YMax/.test(p)) dy+=height-v[3]*sy
  }
  return [sx,0,0,sy,dx-v[0]*sx,dy-v[1]*sy]
}
function svgHitTest (root, x, y, rect, getStyle) {
  if (!rect || !(rect.width>0 && rect.height>0)) return root
  const px=x-rect.left,py=y-rect.top
  if (px<0 || py<0 || px>rect.width || py>rect.height) return root
  let visited=0
  function hit (node, parent, depth) {
    if (node.nodeType !== 1 || ++visited>10000 || depth>128 || /^(defs|symbol|clipPath|mask|pattern|linearGradient|radialGradient)$/.test(node.localName)) return null
    const style=getStyle ? getStyle(node) : node.style
    if (style.display==='none' || node.getAttribute('display')==='none') return null
    let matrix=multiply(parent,transform(node.getAttribute('transform')))
    const num=(name,fallback=0)=>{ const v=Number(node.getAttribute(name)); return node.hasAttribute(name) && Number.isFinite(v)?v:fallback }
    if (node.localName==='svg') {
      if (node===root) matrix=multiply(matrix,viewport(node,rect.width,rect.height))
      else matrix=multiply(matrix,viewport(node,num('width',rect.width),num('height',rect.height),num('x'),num('y')))
    }
    for (let i=node.childNodes.length-1;i>=0;i--) { const child=hit(node.childNodes[i],matrix,depth+1);if(child)return child }
    if (style.visibility==='hidden' || style.getPropertyValue?.('pointer-events')==='none' || node.getAttribute('pointer-events')==='none') return null
    const point=pointIn(matrix,px,py);if(!point)return null
    const [a,b]=point
    if (/^(rect|image|use)$/.test(node.localName)) {
      const left=num('x'),top=num('y'),width=num('width'),height=num('height')
      if (width>0 && height>0 && a>=left && b>=top && a<=left+width && b<=top+height) return node
    }
    if (node.localName==='circle' || node.localName==='ellipse') {
      const rx=num(node.localName==='circle'?'r':'rx'),ry=num(node.localName==='circle'?'r':'ry')
      if (rx>0 && ry>0 && ((a-num('cx'))/rx)**2+((b-num('cy'))/ry)**2<=1) return node
    }
    return null
  }
  return hit(root,identity(),0) || root
}
module.exports = { svgHitTest, transform, multiply, pointIn, viewport }
