'use strict'
const Matrix = require('./matrix')
// PDF.js builds paths with drawing commands, not SVG path strings. Keep them in
// JS so phone canvases do not need createPath2D or native Path2D overloads.
class PDFPath {
  constructor(path) { this.commands = path instanceof PDFPath ? path.commands.map(c => [c[0], c[1].slice()]) : [] }
  moveTo(...v) { this.commands.push(['moveTo', v]) }
  lineTo(...v) { this.commands.push(['lineTo', v]) }
  bezierCurveTo(...v) { this.commands.push(['bezierCurveTo', v]) }
  quadraticCurveTo(...v) { this.commands.push(['quadraticCurveTo', v]) }
  closePath() { this.commands.push(['closePath', []]) }
  rect(x, y, w, h) { this.moveTo(x,y);this.lineTo(x+w,y);this.lineTo(x+w,y+h);this.lineTo(x,y+h);this.closePath() }
  addPath(path, transform = new Matrix()) {
    const m = new Matrix(transform)
    // Snapshot first: addPath can append a path to itself.
    for (const [name, args] of path.commands.slice()) {
      const values = []
      for (let i=0;i<args.length;i+=2) { const p=m.transformPoint({x:args[i],y:args[i+1]});values.push(p.x,p.y) }
      this.commands.push([name,values])
    }
  }
  replay(ctx) { ctx.beginPath();for(const [name,args] of this.commands)ctx[name](...args) }
}
function context(canvas) {
  const ctx=canvas.getContext('2d')
  if(!ctx)throw new Error('PDF Canvas 2D unavailable')
  // Browser contexts expose their owning canvas; native mini-program contexts
  // can omit it. PDF.js reads ctx.canvas before drawing the first operator.
  if(!ctx.canvas) {
    try { ctx.canvas=canvas } catch (_) {}
    if(!ctx.canvas) Object.defineProperty(ctx,'canvas',{value:canvas,configurable:true})
  }
  if(ctx._pdfTransformWrapped)return ctx
  const nativeGet=typeof ctx.getTransform==='function'?ctx.getTransform.bind(ctx):null
  let matrix=new Matrix(), stack=[]
  const wrap=(name,update)=>{const original=ctx[name]?.bind(ctx);if(!original)return;ctx[name]=(...args)=>{update(...args);return original(...args)}}
  wrap('save',()=>stack.push(new Matrix(matrix)))
  wrap('restore',()=>{if(stack.length)matrix=stack.pop()})
  wrap('transform',(...v)=>matrix.multiplySelf(new Matrix(v)))
  wrap('translate',(x,y)=>matrix.translateSelf(x,y))
  wrap('scale',(x,y)=>matrix.scaleSelf(x,y))
  wrap('rotate',a=>matrix.multiplySelf(new Matrix([Math.cos(a),Math.sin(a),-Math.sin(a),Math.cos(a),0,0])))
  const set=ctx.setTransform.bind(ctx)
  ctx.setTransform=(...args)=>{matrix=args.length===1?new Matrix(args[0]):args.length?new Matrix(args):new Matrix();return set(matrix.a,matrix.b,matrix.c,matrix.d,matrix.e,matrix.f)}
  ctx.resetTransform=()=>ctx.setTransform(1,0,0,1,0,0)
  ctx.getTransform=()=>new Matrix(nativeGet?nativeGet():matrix)
  for(const name of ['fill','stroke','clip']){
    const original=ctx[name].bind(ctx)
    ctx[name]=(path,...args)=>{if(path instanceof PDFPath){path.replay(ctx);return original(...args)}return path===undefined?original():original(path,...args)}
  }
  ctx._pdfResetTransform=()=>{matrix=new Matrix();stack=[]}
  ctx._pdfTransformWrapped=true
  return ctx
}
module.exports={PDFPath,context}
