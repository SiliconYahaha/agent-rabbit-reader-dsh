"""Review independent nested-grid transforms from retained original bytes."""
from pathlib import Path
import sys, json, base64, hashlib, ezdxf
from ezdxf.disassemble import recursive_decompose

def expand_before_parent(entities):
    for entity in entities:
        if entity.dxftype() != 'INSERT':
            yield entity.copy()
            continue
        for instance in (entity.multi_insert() if entity.mcount > 1 else [entity]):
            for child in expand_before_parent(instance.block()):
                child.transform(instance.matrix44())
                yield child

def lines(entities):
    values = []
    for e in entities:
        assert e.dxftype() == 'LINE'
        values.append([[float(v) for v in e.dxf.start], [float(v) for v in e.dxf.end]])
    return values

source = Path(sys.argv[1] if len(sys.argv) > 1 else 'tests/fixtures/dxf-insert-grid/before.json')
out = Path(sys.argv[2] if len(sys.argv) > 2 else 'outputs/dxf-insert-grid/review-original-bytes')
out.mkdir(parents=True, exist_ok=True)
report = json.loads(source.read_text())
for row in report['rows']:
    raw = base64.b64decode(row['base64'])
    assert hashlib.sha256(raw).hexdigest() == row['sha256']
    file = out / (row['name'] + '.dxf'); file.write_bytes(raw)
    doc = ezdxf.readfile(file)
    original_again = lines(recursive_decompose(doc.modelspace()))
    assert original_again == row['nativeLines']
    row['expandedBeforeParentLines'] = lines(expand_before_parent(doc.modelspace()))
report['referenceReview'] = 'Same retained original bytes; original convenience result reproduced exactly. Expand nested grids before transforming leaf entities with parent matrix44. The convenience Insert.transform path leaves row/column spacing unscaled.'
(out / 'reference.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'originalsUnchanged': len(report['rows']), 'originalConvenienceReproduced': len(report['rows'])}))
