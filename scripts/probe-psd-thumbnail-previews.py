"""Independent libjpeg decode of actual component output, never reader pixels."""
import base64
import hashlib
import json
from pathlib import Path
import sys
from PIL import Image, __version__

root = Path(sys.argv[1])
references = json.loads((root.parent / "originals/references.json").read_text())
rows = []
for sample in references["samples"]:
    path = root / (sample["name"] + ".jpg")
    data = path.read_bytes()
    image = Image.open(path).convert("RGBA")
    assert image.size == (sample["width"], sample["height"])
    rgba = image.tobytes()
    source = base64.b64decode(sample["rgbaBase64"])
    rows.append({"name": sample["name"], "sha256": hashlib.sha256(data).hexdigest(),
                 "width": image.width, "height": image.height,
                 "rgbaBase64": base64.b64encode(rgba).decode(),
                 "maxSourceChannelDelta": max(abs(a-b) for a, b in zip(rgba, source))})
(root / "pillow.json").write_text(json.dumps({"pillow": __version__, "rows": rows}, indent=2) + "\n")
print(json.dumps({"images": len(rows), "maxLossyPreviewDelta": max(r["maxSourceChannelDelta"] for r in rows)}))
