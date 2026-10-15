"""Independent CP949 fixture bytes from Python's standard codec, not reader tables."""
import json
import random
from pathlib import Path

seed = 94920261013
rng = random.Random(seed)
sources = [
    {"id": "extended-hangul", "prefix": 0, "text": "뷁 똠 쀍 안녕하세요"},
    {"id": "split-run", "prefix": 8191, "text": "뷁안똠쀍"},
    {"id": "seeded-hangul-hanja-ascii", "prefix": 0,
     "text": "".join(rng.choice("가힣뷁똠쀍韓國文書123 ") for _ in range(150))},
]
for source in sources:
    source["characters"] = [list(char.encode("cp949")) for char in source["text"]]
destination = Path(__file__).resolve().parents[1] / "tests/fixtures/rtf-korean/characters.json"
destination.parent.mkdir(parents=True, exist_ok=True)
destination.write_text(json.dumps({"seed": seed, "sources": sources}, ensure_ascii=False, indent=2) + "\n")
