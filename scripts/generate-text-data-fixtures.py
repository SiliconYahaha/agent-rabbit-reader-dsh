"""Own read-only text/data originals and independent stdlib JSON/CSV oracles."""
import base64
import csv
import io
import json
from pathlib import Path
import random
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "tests/fixtures/text-data"
OUT.mkdir(parents=True, exist_ok=True)
SEED = 8259418020261013
rng = random.Random(SEED)


def compact(text):
    quoted = False
    escaped = False
    result = []
    for char in text:
        if quoted or char not in " \r\n\t":
            result.append(char)
        if escaped:
            escaped = False
        elif quoted and char == "\\":
            escaped = True
        elif char == '"':
            quoted = not quoted
    return "".join(result)


sources = [
    '{"n":9007199254740993,"same":1,"same":2,"minus":-0,"huge":1e9999}',
    '{"__proto__":{"polluted":true},"html":"<script>window.poison=1</script>","url":"https://example.invalid/a"}',
    '{"escaped":"\\u4e2d\\n\\t\\\\\\\"","literal":"&lt;b&gt;中 文😀"}',
    'false', 'null', '"孤立值"', '[]', '{}', '[-0,1.2300,3E+04,0.0000000000000000000001]'
]
for i in range(9):
    payload = {"编号": i, "items": [{"name": rng.choice(["平顶山", "&<script>", "换行\n单元格", "😀"]), "flags": [False, None, True]} for _ in range(i + 1)]}
    sources.append(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
json_rows = []
for i, source in enumerate(sources):
    # Arbitrary integers and duplicate keys are retained by the independent
    # oracle rather than a JS Number/ordinary object roundtrip.
    from decimal import Decimal
    json.loads(source, parse_float=Decimal, object_pairs_hook=list,
               parse_constant=lambda name: (_ for _ in ()).throw(ValueError(name)))
    json_rows.append({"id": f"json-{i}", "source": source, "compact": compact(source)})

csv_rows = []
for i in range(12):
    fields = [["编号", "内容", "原始值"], [str(i).zfill(5), rng.choice(["普通文本", "a,b", 'a"b', "单元格\n换行", "<script>window.poison=1</script>"]), rng.choice(["", "9007199254740993", "=WEBSERVICE(\"https://example.invalid\")", "😀"])]]
    writer = io.StringIO(newline="")
    csv.writer(writer, lineterminator="\r\n" if i % 2 else "\n").writerows(fields)
    source = writer.getvalue()
    expected = list(csv.reader(io.StringIO(source, newline=""), strict=True))
    assert expected == fields
    csv_rows.append({"id": f"csv-{i}", "source": source, "rows": expected})

encoded = []
for codec, text, mime in [
    ("utf-8-sig", '{"城市":"平顶山😀"}', "application/json; charset=gbk"),
    ("utf-16", '{"城市":"平顶山😀"}', "application/json"),
    ("utf-16-be", '编号,内容\r\n01,中文\r\n', "text/csv; charset=utf-16be"),
    ("gb18030", '编号,内容\r\n01,平顶山\r\n', "text/csv; charset=GB18030"),
    ("shift_jis", '番号,内容\r\n01,日本語\r\n', 'text/csv; charset="Shift_JIS"'),
    ("big5", '編號,內容\r\n01,繁體中文\r\n', "text/csv; charset=big5"),
    ("cp949", '번호,내용\r\n01,한국어\r\n', "text/csv; charset=cp949")
]:
    encoded.append({"id": codec, "base64": base64.b64encode(text.encode(codec)).decode(), "text": text, "mime": mime,
                    "compact": compact(text) if mime.startswith("application/json") else None,
                    "rows": list(csv.reader(io.StringIO(text, newline=""), strict=True)) if mime.startswith("text/csv") else None})

members = [("data.json", sources[0]), ("table.csv", csv_rows[3]["source"]),
           ("literal.xml", '<script>window.poison=1</script>\n中文 & 😀')]
archive = io.BytesIO()
with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as package:
    for name, source in members:
        info = zipfile.ZipInfo(name, date_time=(2026, 10, 13, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        package.writestr(info, source.encode("utf-8"))
archive_row = {"base64": base64.b64encode(archive.getvalue()).decode(), "members": [
    {"name": name, "source": source, "compact": compact(source) if name.endswith(".json") else None,
     "rows": list(csv.reader(io.StringIO(source, newline=""), strict=True)) if name.endswith(".csv") else None}
    for name, source in members]}

report = {"seed": SEED, "oracles": ["Python json with Decimal and object_pairs_hook", "Python csv strict reader", "Python zipfile original UTF-8 members"], "json": json_rows, "csv": csv_rows, "encoded": encoded, "archive": archive_row}
(OUT / "references.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"json": len(json_rows), "csv": len(csv_rows), "encodings": len(encoded), "seed": SEED}))
