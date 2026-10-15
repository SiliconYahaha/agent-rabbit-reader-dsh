"""STEP surface originals with geomdl and high-precision Bernstein references."""
from pathlib import Path
from decimal import Decimal,localcontext
import json,hashlib,sys,math
from geomdl import NURBS
from steputils import p21
out=Path(sys.argv[1] if len(sys.argv)>1 else 'outputs/step-rational-weights/native');out.mkdir(parents=True,exist_ok=True)
points=[[0,0,0],[0,5,0],[0,10,0],[5,0,0],[5,5,4],[5,10,0],[10,0,0],[10,5,0],[10,10,0]]
base=[1,1,1,1,4,1,1,1,1]
configs=[('scale-'+s,[Decimal(w)*Decimal(s) for w in base]) for s in ['1','1e-20','1e-12','1e-300','1e100','1e307']]
configs += [('mixed-endpoints',[Decimal('1e-300') if i!=4 else Decimal('1e300') for i in range(9)])]
def analytic(weights):
 result=[]
 with localcontext() as ctx:
  ctx.prec=80
  for i in range(13):
   u=Decimal(i)/12;bu=[(1-u)**2,2*u*(1-u),u*u]
   for j in range(13):
    v=Decimal(j)/12;bv=[(1-v)**2,2*v*(1-v),v*v];terms=[bu[a]*bv[b]*weights[a*3+b] for a in range(3) for b in range(3)];total=sum(terms)
    result.append([float(sum(terms[k]*points[k][axis] for k in range(9))/total) for axis in range(3)])
 return result
rows=[]
for name,weights in configs:
 source="ISO-10303-21;HEADER;FILE_DESCRIPTION(('authored rational patch'),'2;1');FILE_NAME('"+name+".step','',(''),(''),'','','');FILE_SCHEMA(('AP214'));ENDSEC;DATA;"
 source+=''.join('#%d=CARTESIAN_POINT(\'\',(%s));'%(i+1,','.join(str(v)+'.' for v in point)) for i,point in enumerate(points))
 weight_text='('+','.join('('+','.join(str(w).upper() for w in weights[i:i+3])+')' for i in range(0,9,3))+')'
 source+="#40=POLY_LOOP('',(#1,#3,#9,#7));#41=FACE_OUTER_BOUND('',#40,.T.);#50=(BOUNDED_SURFACE() B_SPLINE_SURFACE(2,2,((#1,#2,#3),(#4,#5,#6),(#7,#8,#9)),.UNSPECIFIED.,.F.,.F.,.F.) B_SPLINE_SURFACE_WITH_KNOTS((3,3),(3,3),(0.,1.),(0.,1.),.UNSPECIFIED.) GEOMETRIC_REPRESENTATION_ITEM() RATIONAL_B_SPLINE_SURFACE("+weight_text+") REPRESENTATION_ITEM('') SURFACE());#60=ADVANCED_FACE('',(#41),#50,.T.);ENDSEC;END-ISO-10303-21;"
 path=out/(name+'.step');path.write_text(source);parsed=p21.readfile(str(path));assert len(parsed.data[0].instances)==13
 expected=analytic(weights)
 # geomdl uses homogeneous doubles; retain failures/overflow instead of changing
 # the high-precision original-weight reference to fit the library.
 native=[];native_error=''
 try:
  surface=NURBS.Surface();surface.degree_u=2;surface.degree_v=2;surface.ctrlpts_size_u=3;surface.ctrlpts_size_v=3;surface.ctrlpts=points;surface.weights=[float(w) for w in weights];surface.knotvector_u=[0,0,0,1,1,1];surface.knotvector_v=[0,0,0,1,1,1]
  native=[surface.evaluate_single((i/12,j/12)) for i in range(13) for j in range(13)]
  if not all(math.isfinite(v) for p in native for v in p):native_error='nonfinite homogeneous-double output';native=[]
 except Exception as e:native_error=str(e)
 max_error=max((abs(a-b) for p,q in zip(native,expected) for a,b in zip(p,q)),default=None)
 rows.append({'name':name,'source':source,'sha256':hashlib.sha256(source.encode()).hexdigest(),'weights':[str(w) for w in weights],'analyticPoints':expected,'nativePoints':native,'nativeError':native_error,'nativeMaxAbsError':max_error,'nativeStepInstances':13})
(out/'reference.json').write_text(json.dumps({'geomdl':'5.3.1','steputils':'0.1','analytic':'80-digit Decimal quadratic Bernstein rational tensor product evaluated using original weights, 13x13 parameters. Not native CAD import/tessellation.','rows':rows},indent=2)+'\n')
print(json.dumps([{'name':r['name'],'nativeError':r['nativeError'],'nativeMaxAbsError':r['nativeMaxAbsError']} for r in rows]))
