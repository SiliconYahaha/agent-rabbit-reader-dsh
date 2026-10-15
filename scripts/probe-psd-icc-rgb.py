"""Independent LittleCMS RGB profiles, PSD composites, and color-managed oracle.
Run with Pillow/psd-tools installed: python scripts/probe-psd-icc-rgb.py OUTPUT.
"""
import base64, ctypes as C, hashlib, json, math, struct, sys
from pathlib import Path
import PIL, psd_tools
from PIL import features
from psd_tools import PSDImage
from psd_tools.constants import Compression, Resource, Tag
from psd_tools.psd.image_resources import ImageResource
from psd_tools.psd.layer_and_mask import GlobalLayerMaskInfo, LayerInfo
from psd_tools.psd.tagged_blocks import TaggedBlocks

out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=True)
lcms=C.CDLL(str(next((Path(PIL.__file__).parent/'.dylibs').glob('*lcms*'))))
class xyY(C.Structure): _fields_=[('x',C.c_double),('y',C.c_double),('Y',C.c_double)]
class Primaries(C.Structure): _fields_=[('r',xyY),('g',xyY),('b',xyY)]
for name,args,result in [
 ('cmsCreate_sRGBProfile',[],C.c_void_p),('cmsBuildGamma',[C.c_void_p,C.c_double],C.c_void_p),
 ('cmsBuildParametricToneCurve',[C.c_void_p,C.c_int,C.POINTER(C.c_double)],C.c_void_p),
 ('cmsCreateRGBProfile',[C.POINTER(xyY),C.POINTER(Primaries),C.POINTER(C.c_void_p)],C.c_void_p),
 ('cmsSetProfileVersion',[C.c_void_p,C.c_double],None),('cmsSaveProfileToMem',[C.c_void_p,C.c_void_p,C.POINTER(C.c_uint)],C.c_int),
 ('cmsOpenProfileFromMem',[C.c_void_p,C.c_uint],C.c_void_p),('cmsCreateTransform',[C.c_void_p,C.c_uint,C.c_void_p,C.c_uint,C.c_uint,C.c_uint],C.c_void_p),
 ('cmsDoTransform',[C.c_void_p,C.c_void_p,C.c_void_p,C.c_uint],None),('cmsDeleteTransform',[C.c_void_p],None),
 ('cmsCloseProfile',[C.c_void_p],None),('cmsFreeToneCurve',[C.c_void_p],None)]:
 f=getattr(lcms,name);f.argtypes=args;f.restype=result

def save_profile(profile):
 n=C.c_uint();assert lcms.cmsSaveProfileToMem(profile,None,C.byref(n));buffer=C.create_string_buffer(n.value)
 assert lcms.cmsSaveProfileToMem(profile,buffer,C.byref(n));return buffer.raw

def profile_for(name):
 if name.startswith('srgb'): profile=lcms.cmsCreate_sRGBProfile()
 else:
  gamma=1 if name=='linear-v4' else 2.2
  green=(.21,.71) if name.startswith('wide') else (.265,.69) if name.startswith('p3') else (.30,.60)
  red=(.68,.32) if name.startswith('p3') else (.64,.33)
  prim=Primaries(xyY(*red,1),xyY(*green,1),xyY(.15,.06,1));white=xyY(.3127,.329,1)
  parameters={'param1-v4':(2,[2,1.2,-.2]),'param2-v4':(3,[2,.9,-.1,.36]),'param4-v4':(5,[2,.9,0,.081,.1,.19,.19])}
  if name in parameters:
   kind,values=parameters[name];array=(C.c_double*len(values))(*values)
   curves=(C.c_void_p*3)(*[lcms.cmsBuildParametricToneCurve(None,kind,array) for _ in range(3)])
  else: curves=(C.c_void_p*3)(*[lcms.cmsBuildGamma(None,gamma) for _ in range(3)])
  profile=lcms.cmsCreateRGBProfile(C.byref(white),C.byref(prim),curves)
  for c in curves: lcms.cmsFreeToneCurve(c)
 lcms.cmsSetProfileVersion(profile,2.1 if name.endswith('v2') else 4.3)
 data=save_profile(profile);lcms.cmsCloseProfile(profile);return data

profiles={name:profile_for(name) for name in ['srgb-v4','srgb-v2','gamma-v2','linear-v4','wide-v4','p3-v4','param1-v4','param2-v4','param4-v4']}
for name,data in profiles.items(): (out/(name+'.icc')).write_bytes(data)
# Include colors inside/outside destination gamut, grays and colored midtones.
width,height=16,16
colors=[(x/15,y/15,((x*7+y*3)%16)/15) for y in range(height) for x in range(width)]
target=lcms.cmsCreate_sRGBProfile();results=[]
for name,profile in profiles.items():
 profile_buffer=C.create_string_buffer(profile);source=lcms.cmsOpenProfileFromMem(profile_buffer,len(profile));assert source
 # Double device samples avoid reducing source16 to8 before the transform.
 transform=lcms.cmsCreateTransform(source,(1<<22)|(4<<16)|(3<<3),target,(4<<16)|(3<<3)|1,1,256)
 assert transform
 for depth in [8,16]:
  maximum=255 if depth==8 else 65535;code='B' if depth==8 else 'H'
  for transparent in [False,True]:
   alpha=[round(([1,.75,.5,.25][i%4] if transparent else 1)*maximum) for i in range(width*height)]
   stored=[[round(color[c]*alpha[i]+maximum-alpha[i]) for i,color in enumerate(colors)] for c in range(3)]
   values=[(stored[c][i]+alpha[i]-maximum)/alpha[i] for i in range(width*height) for c in range(3)]
   src=(C.c_double*len(values))(*values);dest=(C.c_ubyte*len(values))();lcms.cmsDoTransform(transform,src,dest,width*height)
   expected=bytes(v for i in range(width*height) for v in (*dest[i*3:i*3+3],math.floor(alpha[i]*255/maximum+.5)))
   planes=[struct.pack('>'+code*len(ch),*ch) for ch in stored+([alpha] if transparent else [])]
   for version,compression in [(1,0),(1,1),(2,2),(2,3)]:
    image=PSDImage.new('RGBA' if transparent else 'RGB',(width,height),depth=depth);image._record.header.version=version
    image.image_resources[Resource.ICC_PROFILE]=ImageResource(key=Resource.ICC_PROFILE,data=profile)
    if transparent:
     info=image._record.layer_and_mask_information;info.layer_info=LayerInfo();info.global_layer_mask_info=GlobalLayerMaskInfo();info.tagged_blocks=TaggedBlocks()
     info.tagged_blocks.set_data(Tag.SAVING_MERGED_TRANSPARENCY if depth==8 else Tag.SAVING_MERGED_TRANSPARENCY16)
    image._record.image_data.compression=Compression(compression);image._record.image_data.set_data(planes,image._record.header)
    file=f'{name}-d{depth}-a{int(transparent)}-v{version}-c{compression}.'+('psd' if version==1 else 'psb');image.save(out/file)
    reopened=PSDImage.open(out/file);assert reopened.image_resources.get_data(Resource.ICC_PROFILE)==profile
    assert reopened._record.image_data.get_data(reopened._record.header)==planes
    results.append(dict(name=file,profile=name,depth=depth,transparent=transparent,version=version,compression=compression,width=width,height=height,sha256=hashlib.sha256((out/file).read_bytes()).hexdigest(),rgbaBase64=base64.b64encode(expected).decode()))
 lcms.cmsDeleteTransform(transform);lcms.cmsCloseProfile(source)
lcms.cmsCloseProfile(target)
(out/'references.json').write_text(json.dumps(dict(producer='psd-tools '+psd_tools.__version__,oracle='LittleCMS '+features.version('littlecms2')+' double RGB to sRGB8 relative colorimetric NOOPTIMIZE',results=results),indent=2)+'\n')
print(json.dumps(dict(files=len(results),profiles=list(profiles))))
