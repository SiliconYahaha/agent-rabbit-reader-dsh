from pathlib import Path
import json, hashlib, base64, sys
import ezdxf
import pyparsing

root=Path(sys.argv[1] if len(sys.argv)>1 else 'outputs/dxf-text/native').resolve()
root.mkdir(parents=True,exist_ok=True)
(root/'inputs').mkdir(exist_ok=True)
rows=[]
for version in ['R12','R2000','R2007']:
    for encoding,label in [('cp1252','Café Øresund'),('gbk','中文图纸'),('cp932','日本語設計'),('cp1251','Привет проект')]:
        doc=ezdxf.new(version)
        doc.encoding=encoding
        model=doc.modelspace()
        model.add_line((0,0),(80,0))
        model.add_text(label,dxfattribs={'insert':(0,20),'height':3})
        model.add_text(r'LABEL \U+4E2D\U+6587',dxfattribs={'insert':(0,10),'height':3})
        if version!='R12':
            model.add_mtext(label+r'\PSecond line',dxfattribs={'insert':(0,-10),'char_height':3,'width':80})
        name=f'{version}-{encoding}'
        file=root/'inputs'/f'{name}.dxf'
        doc.saveas(file)
        raw=file.read_bytes()
        loaded=ezdxf.readfile(file)
        texts=[]
        for e in loaded.modelspace():
            if e.dxftype() in ('TEXT','MTEXT'):
                raw_text=e.dxf.text if e.dxftype()=='TEXT' else e.text
                plain=e.plain_text()
                texts.append({'type':e.dxftype(),'raw':raw_text,'plain':plain,'unicode':ezdxf.decode_dxf_unicode(plain)})
        assert texts[0]['unicode']==label, (name, texts[0], label)
        rows.append({'name':name,'version':version,'requestedEncoding':encoding,'writtenEncoding':doc.output_encoding,'readEncoding':loaded.encoding,'label':label,'sourceBase64':base64.b64encode(raw).decode(),'sha256':hashlib.sha256(raw).hexdigest(),'texts':texts})
(root/'report.json').write_text(json.dumps({'schemaVersion':1,'ezdxf':ezdxf.__version__,'pyparsing':pyparsing.__version__,'rows':rows},ensure_ascii=True,indent=2)+'\n')
print(json.dumps([{k:r[k] for k in ['name','writtenEncoding','texts']} for r in rows],ensure_ascii=True,indent=2))
