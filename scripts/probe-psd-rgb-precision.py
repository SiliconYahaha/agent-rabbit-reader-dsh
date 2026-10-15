"""Independent psd-tools PSD/PSB RGB producer; deterministic exact stored planes.

References use rational integer samples (8/16 bit) and decoded IEEE floats
(32 bit) before final sRGB quantization. psd-tools independently round-trips
all compressed planes; its NumPy decode is recorded separately, not treated as
an exact high-precision oracle. No production reader is imported.
"""
import base64, hashlib, json, math, random, struct, sys
from fractions import Fraction
from pathlib import Path
import numpy as np
import psd_tools
from psd_tools import PSDImage
from psd_tools.constants import Compression, Tag
from psd_tools.psd.layer_and_mask import GlobalLayerMaskInfo, LayerInfo
from psd_tools.psd.tagged_blocks import TaggedBlocks
from psd_tools.api import numpy_io
_parse = numpy_io._parse_array
numpy_io._parse_array = lambda *a, **kw: _parse(*a, **kw).copy()
out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=True)
width,height=65,17
results=[]
for depth in (8,16,32):
  scale=255 if depth==8 else 65535
  rng=random.Random(9182026)
  for mode in ('opaque','alpha','half-step'):
    channels=[[],[],[],[]]
    for i in range(width*height):
      alpha = 1 if mode=='opaque' else [1,.75,.5,.25,.03125,0][i%6]
      if depth!=32:
        a=round(alpha*scale)
        if mode=='half-step': a=64 if depth==8 else 65280
        rgb=[round((rng.randrange(257)/256)*a)+scale-a for c in range(3)]
        if mode=='half-step': rgb=[scale-a + (32 if depth==8 else ((i*3+c)%255*2+1)*128) for c in range(3)]
        samples=rgb+[a]
      else:
        colors=[rng.randrange(257)/256 for c in range(3)]
        if mode=='half-step': colors=[(i%256+.5)/255]*3
        samples=[color*alpha+1-alpha for color in colors]+[alpha]
      for c,v in enumerate(samples): channels[c].append(v)
    code='B' if depth==8 else 'H' if depth==16 else 'f'
    planes=[struct.pack('>'+code*len(c),*c) for c in channels[:3 if mode=='opaque' else 4]]
    # Decode actual saved floats so source quantization is part of the reference.
    stored=[struct.unpack('>'+code*len(channels[0]),p) for p in planes]
    expected=[]
    for i in range(width*height):
      a=stored[3][i] if len(stored)>3 else (1 if depth==32 else scale)
      rgb=[]
      for c in range(3):
        if depth==32:
          color=(stored[c][i]+a-1)/a if a>0 else 0
          color=max(0,min(1,color))
          color=12.92*color if color<=.0031308 else 1.055*color**(1/2.4)-.055
          rgb.append(math.floor(color*255+.5))
        else:
          color=max(Fraction(0),min(Fraction(1),Fraction(stored[c][i]+a-scale,a))) if a>0 else Fraction(0)
          rgb.append(math.floor(color*255+Fraction(1,2)))
      expected.extend(rgb+[math.floor((a if depth==32 else Fraction(a,scale))*255+Fraction(1,2))])
    for version in (1,2):
      for compression in range(4):
        image=PSDImage.new('RGB' if mode=='opaque' else 'RGBA',(width,height),depth=depth)
        image._record.header.version=version
        if mode!='opaque':
          info=image._record.layer_and_mask_information
          info.layer_info=LayerInfo();info.global_layer_mask_info=GlobalLayerMaskInfo();info.tagged_blocks=TaggedBlocks()
          info.tagged_blocks.set_data({8:Tag.SAVING_MERGED_TRANSPARENCY,16:Tag.SAVING_MERGED_TRANSPARENCY16,32:Tag.SAVING_MERGED_TRANSPARENCY32}[depth])
        image._record.image_data.compression=Compression(compression);image._record.image_data.set_data(planes,image._record.header)
        name=f'rgb-d{depth}-{mode}-v{version}-c{compression}.'+('psd' if version==1 else 'psb')
        image.save(out/name);reopened=PSDImage.open(out/name)
        assert reopened._record.image_data.get_data(reopened._record.header)==planes
        color=np.clip(reopened.numpy('color'),0,1);alpha=np.clip(reopened.numpy('shape'),0,1)
        if depth==32: color=np.where(color<=.0031308,color*12.92,1.055*color**(1/2.4)-.055)
        numpy_rgba=np.floor(np.concatenate([color,alpha],axis=2)*255+.5).astype(np.uint8).tobytes()
        # Transparent source RGB is unobservable; psd-tools retains white there.
        visible_delta=max(abs(v-expected[i]) for i,v in enumerate(numpy_rgba) if expected[i//4*4+3]>0)
        results.append(dict(name=name,depth=depth,mode=mode,version=version,compression=compression,width=width,height=height,sha256=hashlib.sha256((out/name).read_bytes()).hexdigest(),rgbaBase64=base64.b64encode(bytes(expected)).decode(),numpyVisibleMaxDelta=visible_delta,sourcePlanesExact=True))
(out/'references.json').write_text(json.dumps(dict(producer='psd-tools '+psd_tools.__version__,seed=9182026,results=results),indent=2)+'\n')
print(json.dumps(dict(files=len(results),maxNumpyDelta=max(r['numpyVisibleMaxDelta'] for r in results))))
