'use strict'
const { deflateSync } = require('node:zlib')
function png () {
  const crc = bytes => { let c=0xffffffff;for(const b of bytes){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0)}return (c^0xffffffff)>>>0 }
  const chunk = (type, bytes) => { const t=Buffer.from(type),n=Buffer.alloc(4),c=Buffer.alloc(4);n.writeUInt32BE(bytes.length);c.writeUInt32BE(crc(Buffer.concat([t,bytes])));return Buffer.concat([n,t,bytes,c]) }
  const width=192,height=128,rows=Buffer.alloc((width*3+1)*height);let seed=42
  for(let y=0;y<height;y++)for(let x=0;x<width*3;x++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;rows[y*(width*3+1)+1+x]=seed>>>24}
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2
  return 'data:image/png;base64,'+Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]).toString('base64')
}
function inlinePoster () {
  const source=png()
  return `<!doctype html><meta charset="utf-8"><style>
  *{box-sizing:border-box}body{margin:0;background:#18140f}.app-shell{display:flex;flex-direction:column;align-items:center;gap:8px;padding:12px;min-height:100svh}
  .board-stage{position:relative;width:min(100%,calc(100vw - 24px),calc((100svh - 72px) * 1.5),1536px);aspect-ratio:3 / 2;overflow:hidden;container-type:size}.board-image{position:absolute;inset:0;width:100%;height:100%}.controls{position:absolute;inset:40% 8.5% 10%;display:flex}.controls button{flex:1}.readout{position:absolute;top:5%;left:10%;color:white;background:black}.slider{position:absolute;top:30%;left:8.5%;width:75%;height:8%;background:yellow}
  .export-modal{position:fixed;inset:0;display:grid;background:#222}.export-modal[hidden]{display:none} .export-modal img{width:100%}
  @media (orientation:landscape) and (max-width:1100px){.app-shell{flex-direction:row}.board-stage{width:min(calc(100vw - 208px),calc((100svh - 24px) * 1.5))}.tools{width:190px}}
  @media (orientation:portrait){.app-shell{padding-top:13px}}
  </style><main class="app-shell"><section data-dashboard-app data-level="1" class="board-stage"><img class="board-image" data-board-image src="${source}"><strong class="readout" data-current-readout>档位 1</strong><div class="slider" data-slider></div><div class="controls">${[5,4,3,2,1].map(n=>`<button class="scene-hotspot" data-level="${n}">${n}</button>`).join('')}</div></section><aside class="tools"><button data-export>导出</button><span data-share-status></span></aside></main><div class="export-modal" data-export-modal hidden><button data-export-close>关闭</button><img data-export-preview></div>
  <script>const images=${JSON.stringify(Array(28).fill(source))};let level=1;const app=document.querySelector('[data-dashboard-app]'),modal=document.querySelector('[data-export-modal]');function change(n){level=Number(n);app.dataset.level=String(n);document.querySelector('[data-current-readout]').textContent='档位 '+n}document.querySelectorAll('.scene-hotspot').forEach(b=>b.onclick=()=>change(b.dataset.level));document.querySelector('[data-slider]').addEventListener('pointerdown',e=>{const r=app.getBoundingClientRect();change(5-Math.round(Math.max(0,Math.min(1,((e.clientX-r.left)/r.width-.085)/.75))*4))});async function renderExportCanvas(n){const canvas=document.createElement('canvas');canvas.width=1536;canvas.height=1024;const ctx=canvas.getContext('2d');const image=await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=reject;image.src=images[0]});ctx.drawImage(image,0,0,1536,1024);ctx.fillStyle='red';ctx.fillRect(0,0,n*40,40);return canvas}window.InteractivePosterDashboard={renderExportCanvas};document.querySelector('[data-export]').onclick=async()=>{try{const canvas=await renderExportCanvas(level);document.querySelector('[data-export-preview]').src=canvas.toDataURL('image/png');app.dataset.exportReady='true';modal.hidden=false}catch(e){app.dataset.exportReady='false'}};document.querySelector('[data-export-close]').onclick=()=>{modal.hidden=true};</script>`
}
module.exports={inlinePoster,png}
