"""Affine knot domains evaluated independently after Decimal normalization."""
from pathlib import Path
from decimal import Decimal,localcontext
from itertools import groupby
import json,hashlib,sys
from geomdl import NURBS
from steputils import p21
out=Path(sys.argv[1] if len(sys.argv)>1 else 'outputs/step-knot-domains/native');out.mkdir(parents=True,exist_ok=True)
D=Decimal
quad=[D(0)]*3+[D(1)]*3
linear=[D(0)]*2+[D(1)]*2
repeat=[D(0)]*3+[D('.5')]*2+[D(1)]*3
nonclamped=list(map(D,['-2','-1','0','.25','1','2','3']))
configs=[('control',3,3,2,2,quad,quad),('translated',3,3,2,2,[D('1e15')+x for x in quad],quad),('subnormal',3,3,2,2,[x*D('1e-320') for x in quad],quad),('opposite-extremes',3,3,2,2,[D('-1e308') if not x else D('1e308') for x in quad],quad),('negative-domain',3,3,2,2,[-3+2*x for x in quad],quad),('nonclamped',4,3,2,2,nonclamped,quad),('repeated-unequal',5,2,2,1,repeat,linear),('repeated-translated',5,2,2,1,[D('1e15')+x for x in repeat],linear)]
rows=[]
def normalized(knots):
 with localcontext() as ctx:
  ctx.prec=80;return [float((x-knots[0])/(knots[-1]-knots[0])) for x in knots]
def parts(knots):
 groups=[(k,len(list(g))) for k,g in groupby(knots)];return '('+','.join(str(n) for k,n in groups)+')','('+','.join(str(k).upper() for k,n in groups)+')'
for name,nu,nv,du,dv,ku,kv in configs:
 poles=[[float(u*10/(nu-1)),float(v*10/(nv-1)),float(4 if 0<u<nu-1 else 0)] for u in range(nu) for v in range(nv)]
 weights=[float(4 if i==len(poles)//2 else 1) for i in range(len(poles))]
 surface=NURBS.Surface(normalize_kv=False);surface.degree_u=du;surface.degree_v=dv;surface.ctrlpts_size_u=nu;surface.ctrlpts_size_v=nv;surface.ctrlpts=poles;surface.weights=weights;surface.knotvector_u=normalized(ku);surface.knotvector_v=normalized(kv)
 us=min(24,max(8,nu*4));vs=min(24,max(8,nv*4));a,b=surface.knotvector_u[du],surface.knotvector_u[nu];c,d=surface.knotvector_v[dv],surface.knotvector_v[nv]
 expected=[surface.evaluate_single((b if i==us else a+(b-a)*i/us,d if j==vs else c+(d-c)*j/vs)) for i in range(us+1) for j in range(vs+1)]
 source="ISO-10303-21;HEADER;FILE_DESCRIPTION(('authored knot domains'),'2;1');FILE_NAME('"+name+".step','',(''),(''),'','','');FILE_SCHEMA(('AP214'));ENDSEC;DATA;"
 source+=''.join('#%d=CARTESIAN_POINT(\'\',(%s));'%(i+1,','.join(str(x) for x in p)) for i,p in enumerate(poles))
 refs='('+','.join('('+','.join('#'+str(i*nv+j+1) for j in range(nv))+')' for i in range(nu))+')';w='('+','.join('('+','.join(str(weights[i*nv+j]) for j in range(nv))+')' for i in range(nu))+')';um,uk=parts(ku);vm,vk=parts(kv)
 source+=f"#500=(BOUNDED_SURFACE() B_SPLINE_SURFACE({du},{dv},{refs},.UNSPECIFIED.,.F.,.F.,.F.) B_SPLINE_SURFACE_WITH_KNOTS({um},{vm},{uk},{vk},.UNSPECIFIED.) GEOMETRIC_REPRESENTATION_ITEM() RATIONAL_B_SPLINE_SURFACE({w}) REPRESENTATION_ITEM('') SURFACE());#600=ADVANCED_FACE('',(),#500,.T.);ENDSEC;END-ISO-10303-21;"
 p=out/(name+'.step');p.write_text(source);parsed=p21.readfile(str(p));assert len(parsed.data[0].instances)==nu*nv+2
 rows.append({'name':name,'source':source,'sha256':hashlib.sha256(source.encode()).hexdigest(),'controlPoints':poles,'weights':weights,'uKnots':[str(k) for k in ku],'vKnots':[str(k) for k in kv],'uDegree':du,'vDegree':dv,'rows':nu,'columns':nv,'uSegments':us,'vSegments':vs,'nativePoints':expected,'nativeStepInstances':nu*nv+2})
(out/'reference.json').write_text(json.dumps({'geomdl':'5.3.1','steputils':'0.1','reference':'Original decimal knots normalized affinely using80digit Decimal before geomdl evaluation; shared affine knot transformation preserves surface. This avoids independent-library float overflow/cancellation, does not use reader geometry. STEP lexical parse only; not CAD schema/native tessellation.','rows':rows},indent=2)+'\n')
print(json.dumps({'sources':len(rows),'nativePoints':sum(len(r['nativePoints']) for r in rows)}))
