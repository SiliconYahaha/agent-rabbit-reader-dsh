"""Authored DXF MTEXT combinations; fixed inputs, no private files or randomness."""
import base64, hashlib, json, sys
from pathlib import Path
import ezdxf
ezdxf.options.write_fixed_meta_data_for_testing = True

root = Path(sys.argv[1] if len(sys.argv) > 1 else 'outputs/dxf-mtext/originals')
root.mkdir(parents=True, exist_ok=True)
cases = [
    ('escaped-braces', r'Before \{size\} after'),
    ('literal-backslash', r'Path C:\\temp\\file'),
    ('literal-paragraph-code', r'Before \\P after'),
    ('nested-color-height', r'Before {\C1;red {\H2x;large} red} after'),
    ('font-metadata', r'A{\fArial|b1|i0;Bold}B'),
    ('decoration-toggles', r'A\Lunder\l \Oover\o \Kstrike\kZ'),
    ('nonbreaking-space', r'A\~B'),
    ('paragraphs', r'first\P\Pthird'),
    ('fraction-slash', r'1\S1/2; units'),
    ('fraction-diagonal', r'1\S1#2; units'),
    ('tolerance-stack', r'1.000\S+0.010^-0.000;'),
    ('percent-symbols', r'90%%d 10%%p2 %%c5'),
    ('nested-eight', '{' * 8 + r'\C2;text' + '}' * 8),
    ('literal-cif', r'literal \\U+0041'),
    ('unicode-content', r'{\C1;\U+4E2D\U+6587}\Ptail'),
    ('split-escape', 'x' * 246 + r'\U+4E2D tail'),
    ('unknown-control', r'A\Zunknown;B'),
    ('unterminated-color', r'A\C1 visible text'),
    ('unterminated-stack', r'A\S1/2'),
    ('trailing-backslash', 'A\\'),
]
rows = []
for version in ['R2000', 'R2007']:
    for name, text in cases:
        doc = ezdxf.new(version)
        doc.modelspace().add_mtext(text, dxfattribs={'insert': (0, 0), 'char_height': 3, 'width': 120})
        file = root / (version + '-' + name + '.dxf')
        doc.saveas(file)
        data = file.read_bytes()
        loaded = ezdxf.readfile(file)
        entity = list(loaded.modelspace())[0]
        plain = entity.plain_text(fast=False)
        rows.append({'name': version + '-' + name, 'version': version, 'case': name,
                     'authored': text, 'sourceBase64': base64.b64encode(data).decode('ascii'),
                     'sha256': hashlib.sha256(data).hexdigest(), 'raw': entity.text,
                     'nativePlain': plain, 'nativeFast': entity.plain_text(fast=True),
                     'nativeDecodedHelper': ezdxf.decode_dxf_unicode(plain),
                     'auditErrors': len(loaded.audit().errors)})
report = {'schemaVersion': 1, 'ezdxf': ezdxf.__version__, 'generation': 'Fixed 20 cases across R2000 and R2007; original ezdxf exports with no external resources.', 'rows': rows}
(root / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'cases': len(rows), 'report': str(root / 'report.json'), 'auditErrors': sum(r['auditErrors'] for r in rows)}))
