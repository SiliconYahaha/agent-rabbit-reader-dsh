'use strict'
// Expand the standard path operation into existing commands so older native
// Canvas hosts and the recorded presenter render the same rounded corners.
function roundRect (ctx, x, y, width, height, radii = 0) {
  const values = [x, y, width, height].map(Number)
  if (!values.every(Number.isFinite)) return
  ;[x, y, width, height] = values
  const list = Array.isArray(radii) ? radii : [radii]
  if (!list.length || list.length > 4) throw new RangeError('roundRect requires one to four radii')
  let rs = list.map(r => typeof r === 'object' && r !== null ? [Number(r.x ?? 0), Number(r.y ?? 0)] : [Number(r), Number(r)])
  if (rs.some(r => r.some(v => v < 0))) throw new RangeError('Negative roundRect radius')
  if (rs.some(r => r.some(v => !Number.isFinite(v)))) return
  if (rs.length === 1) rs = [rs[0],rs[0],rs[0],rs[0]]
  else if (rs.length === 2) rs = [rs[0],rs[1],rs[0],rs[1]]
  else if (rs.length === 3) rs = [rs[0],rs[1],rs[2],rs[1]]
  const reverse = (width < 0) !== (height < 0)
  if (width < 0) { x += width; width = -width; rs = [rs[1],rs[0],rs[3],rs[2]] }
  if (height < 0) { y += height; height = -height; rs = [rs[3],rs[2],rs[1],rs[0]] }
  const scale = Math.min(1,width/(rs[0][0]+rs[1][0]||1),width/(rs[3][0]+rs[2][0]||1),height/(rs[0][1]+rs[3][1]||1),height/(rs[1][1]+rs[2][1]||1))
  const [tl,tr,br,bl] = rs.map(r=>r.map(v=>v*scale))
  const arc = (cx,cy,r,a,b) => {
    if (!r[0] || !r[1]) ctx.lineTo(cx+r[0]*Math.cos(b),cy+r[1]*Math.sin(b))
    else ctx.ellipse(cx,cy,r[0],r[1],0,a,b,reverse)
  }
  ctx.moveTo(x+tl[0],y)
  if (!reverse) {
    ctx.lineTo(x+width-tr[0],y);arc(x+width-tr[0],y+tr[1],tr,-Math.PI/2,0)
    ctx.lineTo(x+width,y+height-br[1]);arc(x+width-br[0],y+height-br[1],br,0,Math.PI/2)
    ctx.lineTo(x+bl[0],y+height);arc(x+bl[0],y+height-bl[1],bl,Math.PI/2,Math.PI)
    ctx.lineTo(x,y+tl[1]);arc(x+tl[0],y+tl[1],tl,Math.PI,Math.PI*1.5)
  } else {
    arc(x+tl[0],y+tl[1],tl,-Math.PI/2,-Math.PI)
    ctx.lineTo(x,y+height-bl[1]);arc(x+bl[0],y+height-bl[1],bl,Math.PI,Math.PI/2)
    ctx.lineTo(x+width-br[0],y+height);arc(x+width-br[0],y+height-br[1],br,Math.PI/2,0)
    ctx.lineTo(x+width,y+tr[1]);arc(x+width-tr[0],y+tr[1],tr,0,-Math.PI/2)
  }
  ctx.closePath();ctx.moveTo(x,y)
}
module.exports = { roundRect }
