"""Resolve token-role ambiguity using exported TEXT, MTEXT and editor stacks."""
import base64, hashlib, json, sys
from pathlib import Path
import ezdxf
ezdxf.options.write_fixed_meta_data_for_testing = True
from ezdxf.tools.text import MTextEditor
from ezdxf.addons.drawing import RenderContext, Frontend, layout, svg
root = Path(sys.argv[1] if len(sys.argv) > 1 else 'outputs/dxf-mtext/roles')
root.mkdir(parents=True, exist_ok=True)
rows=[]
stack = str(MTextEditor('1.000').stack('+0.010', '-0.000'))
for version in ['R2000','R2007']:
    for kind,name,content in [('TEXT','literal-paragraph',r'A\PB'),('MTEXT','paragraph',r'A\PB'),('MTEXT','editor-tolerance',stack)]:
        doc=ezdxf.new(version)
        if kind=='TEXT':doc.modelspace().add_text(content,dxfattribs={'height':3})
        else:doc.modelspace().add_mtext(content,dxfattribs={'char_height':3,'width':120})
        file=root/(version+'-'+name+'.dxf');doc.saveas(file)
        original=file.read_bytes();parsed=ezdxf.readfile(file);entity=list(parsed.modelspace())[0]
        plain=entity.plain_text() if kind=='TEXT' else entity.plain_text(fast=False)
        backend=svg.SVGBackend();Frontend(RenderContext(parsed),backend).draw_layout(parsed.modelspace(),finalize=True)
        picture=backend.get_string(layout.Page(0,0));(root/(version+'-'+name+'.svg')).write_text(picture)
        rows.append({'name':version+'-'+name,'kind':kind,'content':content,'plain':plain,'sha256':hashlib.sha256(original).hexdigest(),'sourceBase64':base64.b64encode(original).decode('ascii'),'svg':picture})
(root/'report.json').write_text(json.dumps({'ezdxf':ezdxf.__version__,'rows':rows},ensure_ascii=False,indent=2)+'\n')
print(json.dumps([{k:r[k] for k in ['name','kind','content','plain']} for r in rows]))
