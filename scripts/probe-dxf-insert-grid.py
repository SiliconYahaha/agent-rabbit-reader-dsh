from pathlib import Path
import ezdxf, json, base64, hashlib, sys
from ezdxf.disassemble import recursive_decompose

out = Path(sys.argv[1] if len(sys.argv) > 1 else 'outputs/dxf-insert-grid/native').resolve()
out.mkdir(parents=True, exist_ok=True)
ezdxf.options.write_fixed_meta_data_for_testing = True
configs = [
    ('unit-control', 1, 1, 0, 12, 9, False, 3, 2),
    ('single-control', 2, .5, 37, 12, 9, False, 1, 1),
    ('uniform', 2, 2, 0, 12, 9, False, 3, 2),
    ('nonuniform', 2, .5, 0, 12, 9, False, 3, 2),
    ('mirror', -2, 1.5, 0, 12, 9, False, 3, 2),
    ('rotated', 2, .5, 37, 12, 9, False, 3, 2),
    ('negative-spacing', 2, .5, -23, -12, -9, False, 3, 2),
    ('nested', 2, .5, 37, 12, 9, True, 3, 2),
]
def expand_before_parent(entities):
    # Independent library transforms, but expand nested grids in their own
    # coordinate system before applying the enclosing block transform.
    for entity in entities:
        if entity.dxftype() != 'INSERT':
            yield entity.copy()
            continue
        instances = entity.multi_insert() if entity.mcount > 1 else [entity]
        for instance in instances:
            matrix = instance.matrix44()
            for child in expand_before_parent(instance.block()):
                child.transform(matrix)
                yield child

rows = []
for version in ['R12', 'R2007']:
    for name, sx, sy, angle, cs, rs, nested, columns, count_rows in configs:
        d = ezdxf.new(version)
        block = d.blocks.new('UNIT', base_point=(2, 3))
        for start, end in [((2, 3), (6, 3)), ((6, 3), (6, 5)), ((6, 5), (3, 4))]:
            block.add_line(start, end)
        target = d.blocks.new('OUTER', base_point=(1, 2)) if nested else d.modelspace()
        insert = target.add_blockref('UNIT', (11, 7), dxfattribs={'xscale': sx, 'yscale': sy, 'rotation': angle})
        insert.grid(size=(count_rows, columns), spacing=(rs, cs))
        if nested:
            d.modelspace().add_blockref('OUTER', (5, -4), dxfattribs={'xscale': 1.25, 'yscale': 1.25, 'rotation': -25})
        ident = version + '-' + name
        file = out / (ident + '.dxf'); d.saveas(file); raw = file.read_bytes()
        reread = ezdxf.readfile(file); audit = reread.audit()
        entities = list(recursive_decompose(reread.modelspace()))
        assert len(entities) == columns * count_rows * 3
        assert all(e.dxftype() == 'LINE' for e in entities)
        lines = [[[float(v) for v in e.dxf.start], [float(v) for v in e.dxf.end]] for e in entities]
        local_first = [[[float(v) for v in e.dxf.start], [float(v) for v in e.dxf.end]] for e in expand_before_parent(reread.modelspace())]
        rows.append({'expandedBeforeParentLines': local_first, 'name': ident, 'version': version, 'config': {'scale': [sx, sy], 'rotation': angle, 'spacing': [cs, rs], 'columns': columns, 'rows': count_rows, 'nested': nested, 'blockBase': [2, 3]}, 'base64': base64.b64encode(raw).decode(), 'sha256': hashlib.sha256(raw).hexdigest(), 'nativeLines': lines, 'nativeEntities': len(entities), 'auditErrors': len(audit.errors)})
report = {'ezdxf': ezdxf.__version__, 'basis': 'Independent saved/re-read DXF originals; ezdxf recursive_decompose uses multi_insert and virtual entity WCS transforms. Fixed-metadata option enabled; DXF GUIDs may still vary across regeneration. Geometry is deterministic; retained original bytes and their hashes are authoritative.', 'primaryReference': 'https://ezdxf.readthedocs.io/en/stable/blocks/insert.html', 'rows': rows}
(out / 'reference.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'sources': len(rows), 'nativeLines': sum(r['nativeEntities'] for r in rows), 'auditErrors': sum(r['auditErrors'] for r in rows)}))
