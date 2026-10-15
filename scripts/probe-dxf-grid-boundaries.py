from pathlib import Path
import ezdxf, json, base64, hashlib
from ezdxf.disassemble import recursive_decompose
out=Path('outputs/dxf-insert-grid/next-boundaries');out.mkdir(parents=True,exist_ok=True)
rows=[]
for name,columns,rows_count,cs,rs,extrusion in [('columns20',20,1,12,9,(0,0,1)),('columns21',21,1,12,9,(0,0,1)),('rows21',1,21,12,9,(0,0,1)),('zero-spacing',3,2,0,0,(0,0,1)),('negative-ocs',3,2,12,9,(0,0,-1))]:
 d=ezdxf.new('R2007');b=d.blocks.new('UNIT',base_point=(2,3));b.add_line((2,3),(6,5));i=d.modelspace().add_blockref('UNIT',(11,7),dxfattribs={'xscale':2,'yscale':.5,'rotation':37,'extrusion':extrusion});i.grid(size=(rows_count,columns),spacing=(rs,cs));p=out/(name+'.dxf');d.saveas(p);raw=p.read_bytes();native=ezdxf.readfile(p);audit=native.audit();lines=[[[float(v) for v in e.dxf.start],[float(v) for v in e.dxf.end]] for e in recursive_decompose(native.modelspace())];rows.append({'name':name,'base64':base64.b64encode(raw).decode(),'sha256':hashlib.sha256(raw).hexdigest(),'nativeLines':lines,'auditErrors':len(audit.errors)})
(out/'reference.json').write_text(json.dumps({'ezdxf':ezdxf.__version__,'rows':rows},indent=2)+'\n')
