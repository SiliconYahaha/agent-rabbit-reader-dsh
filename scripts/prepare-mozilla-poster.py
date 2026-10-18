"""Improve only the saved preview of the real layered PSD. Artwork stays intact.
Requires Pillow. No compositing, crop, relabeling or layer rasterization.
"""
from pathlib import Path
from PIL import Image
import io, struct, hashlib, subprocess
root=Path(__file__).resolve().parents[1]
art=root/'scripts/assets/example-art'
source=(art/'mozilla-mascot-original.psd').read_bytes()
u32=lambda b,o:struct.unpack_from('>I',b,o)[0]
offset=30+u32(source,26)
size=u32(source,offset)
resources=source[offset+4:offset+4+size]
im=Image.open(io.BytesIO(source)).convert('RGB'); im.thumbnail((640,960))
b=io.BytesIO();im.save(b,format='JPEG',quality=90)
jpeg=b.getvalue();width,height=im.size;row=(width*3+3)//4*4
preview=struct.pack('>IIIIIIHH',1,width,height,row,row*height,len(jpeg),24,1)+jpeg
out=[];cursor=0
while cursor<len(resources):
 start=cursor
 assert resources[cursor:cursor+4]==b'8BIM'
 rid=struct.unpack_from('>H',resources,cursor+4)[0];cursor+=6
 n=resources[cursor];cursor+=(n+2)//2*2
 length=u32(resources,cursor);cursor+=4;cursor+=length+(length%2)
 if rid not in (1033,1036):out.append(resources[start:cursor])
block=b'8BIM'+struct.pack('>H',1036)+b'\0\0'+struct.pack('>I',len(preview))+preview+b'\0'*(len(preview)%2)
newresources=b''.join(out)+block
result=source[:offset]+struct.pack('>I',len(newresources))+newresources+source[offset+4+size:]
(art/'mozilla-mascot-poster.psd').write_bytes(result)
# Everything after the resource section (all layers, masks, composite) is exact.
assert result[offset+4+len(newresources):]==source[offset+4+size:]
layer_offset=offset+4+size
layer_count=abs(struct.unpack_from('>h',source,layer_offset+8)[0])
print('canvas',Image.open(io.BytesIO(source)).size,'layer records',layer_count,'preview',im.size,'bytes',len(result),'sha256',hashlib.sha256(result).hexdigest())
im.thumbnail((240,340));im.save(root/'miniprogram/examples/assets/change.jpg',quality=85)

# Keep the real PSD out of the initial gallery download (one 1.4 MB subpackage).
subprocess.run(['node', '-e', "const fs=require('node:fs'),z=require('node:zlib');fs.writeFileSync(process.argv[2],z.brotliCompressSync(fs.readFileSync(process.argv[1]),{params:{[z.constants.BROTLI_PARAM_QUALITY]:8}}))", str(art/'mozilla-mascot-poster.psd'),str(root/'miniprogram/example-poster/mascot.psd.br')], check=True)
