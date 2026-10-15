"""Original Part21 lexical probes; steputils validates records, not CAD schema/geometry."""
import json, hashlib, importlib.metadata, sys
from pathlib import Path
from steputils import p21

out = Path(sys.argv[1] if len(sys.argv) > 1 else 'outputs/step-scope-native')
out.mkdir(parents=True, exist_ok=True)
header = "ISO-10303-21;HEADER;FILE_DESCRIPTION(('Original lexical scope probe'),'2;1');FILE_NAME('scope.step','',('author'),('local'),'probe','','');FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));ENDSEC;DATA;"
body = "#1=CARTESIAN_POINT('',(0.,0.,0.));#2=CARTESIAN_POINT('',(10.,0.,0.));#3=VERTEX_POINT('',#1);#4=VERTEX_POINT('',#2);#5=EDGE_CURVE('',#3,#4,#9,.T.);#7=DIRECTION('',(1.,0.,0.));#8=VECTOR('',#7,1.);#9=LINE('',#1,#8);"
end = 'ENDSEC;END-ISO-10303-21;'
base = header + body + end
cases = [('control', base)]
cases += [
    ('comment-phantom-point', header + body + "/* #99=CARTESIAN_POINT('',(999.,999.,999.)); */" + end),
    ('comment-overwrite-point', header + body + "/* #1=CARTESIAN_POINT('',(999.,999.,999.)); */" + end),
    ('comment-token', header + body.replace('#1=', '#1/* comment */=') + end),
    ('comment-coordinate', header + body.replace('(10.,0.,0.)', "(10.,/* why ) ; ' */0.,0.)") + end),
    ('comment-no-nesting', header + body + "/* ignored /* #99=CARTESIAN_POINT('',(999.,999.,999.)); */" + end),
    ('name-reference', header + body.replace("EDGE_CURVE('',", "EDGE_CURVE('#2',") + end),
    ('name-reference-line', header + body.replace("LINE('',", "LINE('#2',") + end),
    ('header-phantom', header.replace('Original lexical scope probe', "#99=CARTESIAN_POINT('''',(999.,999.,999.));") + body + end),
    ('header-phantom-complex', header.replace('Original lexical scope probe', "#99=(CARTESIAN_POINT('''',(999.,999.,999.))); ENDSEC; DATA;") + body + end),
    ('comment-real-marker', "/* ISO-10303-21; #99=CARTESIAN_POINT('',(999.,999.,999.)); */" + base),
    ('literal-comment-marker', header + body.replace("CARTESIAN_POINT('',", "CARTESIAN_POINT('/* literal */',", 1) + end),
    ('split-keyword', header + body.replace('CARTESIAN_POINT', 'CARTESIAN_\nPOINT', 1) + end),
    ('print-directive', header + body.replace('#1=', '#1\\N\\=') + end),
]
rows = []
for name, source in cases:
    row = {'name': name, 'source': source, 'sha256': hashlib.sha256(source.encode()).hexdigest()}
    try:
        document = p21.loads(source)
        records = {str(k): str(v) for data in document.data for k, v in data.instances.items()}
        row['native'] = {'records': records, 'instances': len(records)}
        assert set(records) == {'#1','#2','#3','#4','#5','#7','#8','#9'}
    except Exception as e:
        row['native'] = {'error': str(e)}
    rows.append(row)
report = {'schemaVersion': 1, 'oracle': 'steputils ' + importlib.metadata.version('steputils'), 'rows': rows,
    'limits': ['Original syntactically checked Part21 fragments with resolved curve references; no EXPRESS schema validator or CAD renderer executed.', 'Newline-within-keyword and print directives require normative checks where steputils rejects them.', 'Earlier seven-file screening used an unresolved curve reference; retained in prior ignored DXF outputs as screening only, not geometric oracle.']}
(out / 'originals.json').write_text(json.dumps(report, indent=2) + '\n')
print([(r['name'], r['native'].get('instances', r['native'].get('error'))) for r in rows])
