from pathlib import Path
import ezdxf, json, base64, hashlib, sys
from ezdxf import recover
root=Path(sys.argv[1] if len(sys.argv)>1 else 'outputs/dxf-text/combinations-reference').resolve()
root.mkdir(parents=True,exist_ok=True)
(root/'combinations').mkdir(exist_ok=True)
rows=[]
samples=[
 ('text-newline','TEXT',r'A\U+000A0\U+000ALINE\U+000A10\U+000A999'),
 ('text-markup','TEXT',r'\U+003Cscript\U+003E & tail'),
 ('text-nul','TEXT',r'AB\U+0000CD'),
 ('text-pair','TEXT',r'\U+D83D\U+DE80'),
 ('text-unpaired','TEXT',r'\U+D83D'),
 ('text-double-slash','TEXT',r'literal \\U+0041'),
 ('mtext-double-slash','MTEXT',r'literal \\U+0041'),
 ('mtext-triple-slash','MTEXT',r'literal \\\U+0041'),
 ('mtext-escaped-braces','MTEXT',r'\{ABC\}'),
 ('mtext-format-unicode','MTEXT',r'{\C1;\U+4E2D\U+6587}\Ptail'),
 ('mtext-chunk-cif','MTEXT','x'*246+r'\U+4E2D tail'),
 ('mtext-chunk-unicode','MTEXT','x'*246+'中文 tail'),
]
for name,kind,text in samples:
    d=ezdxf.new('R2007');m=d.modelspace()
    if kind=='TEXT':m.add_text(text,dxfattribs={'height':3,'insert':(0,0)})
    else:m.add_mtext(text,dxfattribs={'char_height':3,'insert':(0,0),'width':80})
    file=root/'combinations'/f'{name}.dxf';d.saveas(file);raw=file.read_bytes()
    r={'name':name,'kind':kind,'authored':text,'sourceBase64':base64.b64encode(raw).decode(),'sha256':hashlib.sha256(raw).hexdigest()}
    try:
        parsed=ezdxf.readfile(file);e=list(parsed.modelspace())[0]
        r['regular']=e.plain_text();r['regularSlow']=e.plain_text(fast=False) if kind=='MTEXT' else e.plain_text()
        r['explicitHelper']=ezdxf.decode_dxf_unicode(r['regular'])
        parsed,audit=recover.readfile(file);e=list(parsed.modelspace())[0]
        r['recover']=e.plain_text();r['recoverSlow']=e.plain_text(fast=False) if kind=='MTEXT' else e.plain_text()
        r['recoveredEntities']=len(parsed.modelspace());r['auditErrors']=len(audit.errors)
    except Exception as err:r['error']=str(err)
    rows.append(r)
(root/'combinations.json').write_text(json.dumps({'ezdxf':ezdxf.__version__,'rows':rows},ensure_ascii=True,indent=2)+'\n')
print(json.dumps([{k:v for k,v in r.items() if k not in ['sourceBase64','sha256']} for r in rows],ensure_ascii=True,indent=2))
