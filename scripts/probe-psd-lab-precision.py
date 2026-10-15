import base64,ctypes as C,hashlib,json,random,struct,sys
from pathlib import Path
import PIL,psd_tools
from PIL import Image,features
from psd_tools import PSDImage
from psd_tools.constants import Compression
out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=True)
lib=next((Path(PIL.__file__).parent/'.dylibs').glob('*lcms*'))
lcms=C.CDLL(str(lib))
for name,args,result in [('cmsCreateLab4Profile',[C.c_void_p],C.c_void_p),('cmsCreate_sRGBProfile',[],C.c_void_p),('cmsCreateTransform',[C.c_void_p,C.c_uint,C.c_void_p,C.c_uint,C.c_uint,C.c_uint],C.c_void_p),('cmsDoTransform',[C.c_void_p,C.c_void_p,C.c_void_p,C.c_uint],None),('cmsDeleteTransform',[C.c_void_p],None),('cmsCloseProfile',[C.c_void_p],None)]:
 f=getattr(lcms,name);f.argtypes=args;f.restype=result
lab=lcms.cmsCreateLab4Profile(None);rgb=lcms.cmsCreate_sRGBProfile()
transform=lcms.cmsCreateTransform(lab,(1<<22)|(10<<16)|(3<<3),rgb,(4<<16)|(3<<3)|1,1,256)
assert transform
rng=random.Random(20260909)
patterns=[('seeded-gamut',32,32,[[rng.randrange(65536) for c in range(3)] for i in range(1024)]),('dark-ramp',256,8,[[round((2+x/255*12)*65535/100),32896,32896] for y in range(8) for x in range(256)]),('chroma-ramp',256,8,[[30000,32000+x*5,40000] for y in range(8) for x in range(256)])]
results=[]
for pattern,w,h,values16 in patterns:
 for depth in [8,16]:
  values=values16 if depth==16 else [[round(v/257) for v in p] for p in values16]
  maximum=65535 if depth==16 else 255
  physical=[v for p in values for v in (p[0]*100/maximum,p[1]*255/maximum-128,p[2]*255/maximum-128)]
  src=(C.c_double*len(physical))(*physical);dst=(C.c_ubyte*(w*h*3))()
  lcms.cmsDoTransform(transform,src,dst,w*h);expected=bytes(dst)
  for version in [1,2]:
   for compression in [0,1,2,3]:
    p=PSDImage.new('LAB',(w,h),depth=depth);p._record.header.version=version
    planes=[b''.join(struct.pack('>H' if depth==16 else '>B',v[c]) for v in values) for c in range(3)]
    p._record.image_data.compression=Compression(compression);p._record.image_data.set_data(planes,p._record.header)
    name=f'{pattern}-d{depth}-v{version}-c{compression}.'+('psd' if version==1 else 'psb');p.save(out/name)
    reread=PSDImage.open(out/name);assert reread._record.image_data.get_data(reread._record.header)==planes
    sha=hashlib.sha256((out/name).read_bytes()).hexdigest()
    results.append(dict(name=name,pattern=pattern,width=w,height=h,depth=depth,version=version,compression=compression,sourceSha256=sha,sourcePlanesExact=True,rgbBase64=base64.b64encode(expected).decode()))
  Image.frombytes('RGB',(w,h),expected).save(out/f'{pattern}-d{depth}-native.png')
lcms.cmsDeleteTransform(transform);lcms.cmsCloseProfile(lab);lcms.cmsCloseProfile(rgb)
report=dict(seed=20260909,producer='psd-tools '+psd_tools.__version__,oracle='LittleCMS '+features.version('littlecms2')+' Lab4 D50 double to sRGB8 relative colorimetric NOOPTIMIZE',encoding='GIMP PSD loader CIE Lab u16; babl unsigned full-range L=0..100 ab=-128..127',results=results)
(out/'native.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(dict(files=len(results),producer=report['producer'],oracle=report['oracle'])))
