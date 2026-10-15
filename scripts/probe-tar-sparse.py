#!/usr/bin/env python3
"""Authored GNU PAX sparse files, exact Python/bsdtar body comparisons."""
import base64, hashlib, io, json, pathlib, subprocess, tarfile, datetime
out = pathlib.Path('outputs/tar-sparse/originals')
out.mkdir(parents=True, exist_ok=True)
def sha(b): return hashlib.sha256(b).hexdigest()
def record(key, value):
    tail = (key + '=' + str(value) + '\n').encode()
    n = len(tail) + 2
    while len(str(n)) + 1 + len(tail) != n: n = len(str(n)) + 1 + len(tail)
    return str(n).encode() + b' ' + tail
def member(name, data, kind=tarfile.REGTYPE):
    info = tarfile.TarInfo(name); info.type = kind; info.size = len(data); info.mtime = 0; info.mode = 0o644
    return info.tobuf(format=tarfile.USTAR_FORMAT) + data + bytes((-len(data)) % 512)
shapes = [
    ('leading', 4096, [(513, b'HEAD\n'), (2051, b'TAIL\n')]),
    ('trailing', 2048, [(0, b'HEAD\n'), (513, b'TAIL\n')]),
    ('interior', 2048, [(0, b'HEAD\n'), (2043, b'TAIL\n')]),
    ('all-hole', 4096, []),
    ('many-blocks', 4096, [(17 + i * 32, ('V%02d' % i).encode()) for i in range(65)])
]
rows = []
for version in ['0.0', '0.1', '1.0']:
    for shape, size, pieces in shapes:
        extents = pieces + [(size, b'')]
        expected = bytearray(size)
        for offset, data in pieces: expected[offset:offset+len(data)] = data
        packed = b''.join(data for _, data in extents)
        pairs = [(offset, len(data)) for offset, data in extents]
        if version == '0.0':
            fields = [('GNU.sparse.size', size), ('GNU.sparse.numblocks', len(pairs))]
            for offset, length in pairs: fields += [('GNU.sparse.offset', offset), ('GNU.sparse.numbytes', length)]
            name = 'body.bin'; payload = packed
        elif version == '0.1':
            fields = [('GNU.sparse.size', size), ('GNU.sparse.numblocks', len(pairs)), ('GNU.sparse.name', 'body.bin'), ('GNU.sparse.map', ','.join(str(n) for pair in pairs for n in pair))]
            name = 'GNUSparseFile.0/body.bin'; payload = packed
        else:
            fields = [('GNU.sparse.major', 1), ('GNU.sparse.minor', 0), ('GNU.sparse.name', 'body.bin'), ('GNU.sparse.realsize', size)]
            mapping = ('\n'.join([str(len(pairs))] + [str(n) for pair in pairs for n in pair]) + '\n').encode()
            payload = mapping + bytes((-len(mapping)) % 512) + packed
            name = 'GNUSparseFile.0/body.bin'
        pax = b''.join(record(k, v) for k, v in fields)
        archive = member('PaxHeaders/body.bin', pax, tarfile.XHDTYPE) + member(name, payload) + member('after.txt', b'AFTER\n') + bytes(1024)
        archive += bytes((-len(archive)) % 10240)
        ident = 'pax-' + version.replace('.', '') + '-' + shape
        file = out / (ident + '.tar'); file.write_bytes(archive)
        row = dict(name=ident, version=version, shape=shape, extents=pairs, realSize=size, sha256=sha(archive), base64=base64.b64encode(archive).decode(), expectedBodyBase64=base64.b64encode(expected).decode(), expectedSha256=sha(expected))
        try:
            with tarfile.open(file) as tf:
                body = tf.extractfile('body.bin').read(); after = tf.extractfile('after.txt').read()
                row['python'] = dict(exact=body==expected, size=len(body), sha256=sha(body), afterExact=after==b'AFTER\n')
        except Exception as e: row['python'] = dict(error=str(e))
        proc = subprocess.run(['/usr/bin/tar', '-xOf', str(file), 'body.bin'], capture_output=True, timeout=10)
        row['bsdtar'] = dict(status=proc.returncode, exact=proc.stdout==expected, size=len(proc.stdout), sha256=sha(proc.stdout), stderr=proc.stderr.decode(errors='replace'))
        rows.append(row)
        print(ident, row['python'].get('exact'), row['bsdtar']['status'], row['bsdtar']['exact'])
report = dict(at=datetime.datetime.now(datetime.timezone.utc).isoformat(), generation='GNU PAX sparse versions0.0/0.1/1.0 x five hole/extent patterns, including multi-block map and a following ordinary member; deterministic authored input.', reference='https://www.gnu.org/software/tar/manual/html_chapter/Tar-Internals.html', pythonVersion=__import__('sys').version, bsdtarVersion=subprocess.check_output(['/usr/bin/tar','--version']).decode().strip(), rows=rows)
(out.parent/'source-reference.json').write_text(json.dumps(report,indent=2)+'\n')
