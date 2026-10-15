"""Authored saved/re-read originals with independent ezdxf LINE coordinates."""
from pathlib import Path
import json,base64,hashlib,ezdxf,sys
from ezdxf.disassemble import recursive_decompose
out=Path(sys.argv[1] if len(sys.argv)>1 else 'outputs/dxf-grid-traversal/native');out.mkdir(parents=True,exist_ok=True)
rows=[]
configs=[('columns21',21,1,1,12,9),('rows21',1,21,1,12,9),('grid21x21',21,21,1,12,9),('limit1200',1200,1,1,12,9),('over1201',1201,1,1,12,9),('zero-both',21,21,1,0,0),('zero-columns',21,3,1,0,9),('zero-rows',3,21,1,12,0),('depth7',1,1,7,12,9),('depth64',1,1,64,12,9),('depth65',1,1,65,12,9)]
for name,columns,count_rows,depth,cs,rs in configs:
 d=ezdxf.new('R2007');b=d.blocks.new('UNIT',base_point=(2,3));b.add_line((2,3),(6,5));previous='UNIT'
 for n in range(1,depth):
  name_b='LEVEL'+str(n);target=d.blocks.new(name_b);target.add_blockref(previous,(1,2));previous=name_b
 ins=d.modelspace().add_blockref(previous,(11,7),dxfattribs={'xscale':2,'yscale':.5,'rotation':37});ins.grid(size=(count_rows,columns),spacing=(rs,cs))
 p=out/(name+'.dxf');d.saveas(p);raw=p.read_bytes();native=ezdxf.readfile(p);audit=native.audit();lines=[[[float(v) for v in e.dxf.start],[float(v) for v in e.dxf.end]] for e in recursive_decompose(native.modelspace())]
 rows.append({'name':name,'base64':base64.b64encode(raw).decode(),'sha256':hashlib.sha256(raw).hexdigest(),'nativeLines':lines,'auditErrors':len(audit.errors),'config':{'columns':columns,'rows':count_rows,'depth':depth,'spacing':[cs,rs]}})
(out/'reference.json').write_text(json.dumps({'ezdxf':ezdxf.__version__,'basis':'Authored originals. Native multi_insert deduplicates coincident cells. Nested chains contain no nested grid: recursive_decompose spacing caveat does not apply.','rows':rows},indent=2)+'\n')
print(json.dumps({'sources':len(rows),'nativeLines':sum(len(r['nativeLines']) for r in rows)}))
