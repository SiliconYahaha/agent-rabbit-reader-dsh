"""Create ordinary TAR/ZIP files with independent pathname/body readback.

No extraction to host paths: file/directory name collisions stay in memory.
"""
import hashlib
import io
import json
import sys
import tarfile
import zipfile
from pathlib import Path

out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)
common = ['A/last.txt', 'a/first.txt', 'A/Sub/first.txt', 'A/sub/last.txt', 'docs.txt', 'docs.txt/child.txt']
literal = [r'literal\dir/page.txt', 'literal/dir/page.txt', r'literal\dir/deep\name/second.txt', '资料\\原稿/深\\层/note.txt']
results = []
for kind in ('ustar', 'gnu', 'pax', 'zip-store', 'zip-deflate'):
    names = common + (literal if not kind.startswith('zip') else ['normal/deep/page.txt'])
    members = [dict(name=name, text=f'ORIGINAL MEMBER {i}: {name}') for i, name in enumerate(names)]
    directories = sorted({'/'.join(m['name'].split('/')[:i]) for m in members for i in range(1, len(m['name'].split('/')))})
    for explicit in (False, True):
        for reverse in (False, True):
            rows = [dict(name=name + '/', directory=True) for name in directories] if explicit else []
            rows += [dict(**m, directory=False) for m in members]
            if reverse:
                rows.reverse()
            name = f'{kind}-dirs{int(explicit)}-reverse{int(reverse)}.' + ('zip' if kind.startswith('zip') else 'tar')
            target = out / name
            if kind.startswith('zip'):
                with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_STORED if kind == 'zip-store' else zipfile.ZIP_DEFLATED) as archive:
                    for row in rows:
                        info = zipfile.ZipInfo(row['name'], (2026, 1, 1, 0, 0, 0))
                        info.compress_type = archive.compression
                        archive.writestr(info, row.get('text', '').encode())
                with zipfile.ZipFile(target) as archive:
                    observed = [dict(name=e.filename, directory=e.is_dir(), **({} if e.is_dir() else {'text':archive.read(e).decode()})) for e in archive.infolist()]
            else:
                with tarfile.open(target, 'w', format={'ustar':tarfile.USTAR_FORMAT, 'gnu':tarfile.GNU_FORMAT, 'pax':tarfile.PAX_FORMAT}[kind]) as archive:
                    for row in rows:
                        info = tarfile.TarInfo(row['name'])
                        data = row.get('text', '').encode()
                        info.type = tarfile.DIRTYPE if row['directory'] else tarfile.REGTYPE
                        info.size = len(data)
                        archive.addfile(info, io.BytesIO(data))
                with tarfile.open(target) as archive:
                    observed = [dict(name=e.name.rstrip('/')+'/' if e.isdir() else e.name, directory=e.isdir(), **({} if e.isdir() else {'text':archive.extractfile(e).read().decode()})) for e in archive.getmembers()]
            assert observed == rows
            results.append(dict(name=name, kind=kind, explicit=explicit, reverse=reverse,
                sha256=hashlib.sha256(target.read_bytes()).hexdigest(), members=members, directories=directories,
                independentNamesAndBodiesExact=True))
(out / 'references.json').write_text(json.dumps(dict(producer='Python stdlib tarfile/zipfile', results=results), ensure_ascii=False, indent=2)+'\n')
print(json.dumps({'files':len(results), 'members':sum(len(r['members']) for r in results)}))
