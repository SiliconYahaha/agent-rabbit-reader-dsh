"""Own PSD/PSB samples; Pillow and psd-tools independently read original files.

Run in an isolated Python environment with psd-tools==1.18.0. No user files.
"""
import base64
import hashlib
import io
import json
from pathlib import Path
import random
import struct
import sys
import zlib

from PIL import Image, __version__ as pillow_version
from psd_tools import PSDImage, __version__ as psd_version

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "outputs/psd-thumbnails/originals"
OUT.mkdir(parents=True, exist_ok=True)
SEED = 103320261013
rng = random.Random(SEED)
rows = []


def block(resource_id, payload, name=b""):
    pascal = bytes([len(name)]) + name
    pascal += b"\0" * (len(pascal) % 2)
    return b"8BIM" + struct.pack(">H", resource_id) + pascal + struct.pack(">I", len(payload)) + payload + b"\0" * (len(payload) % 2)


def thumb(resource_id, width, height, shift=0, jpeg=False):
    stride = (width * 3 + 3) // 4 * 4
    colors = [(30 + (x * 9 + shift) % 150, 40 + (y * 11 + shift) % 140, 160 - (x * 5 + y * 3) % 130)
              for y in range(height) for x in range(width)]
    rgb = bytes(c for pixel in colors for c in pixel)
    if jpeg:
        encoded = io.BytesIO()
        Image.frombytes("RGB", (width, height), rgb).save(encoded, "JPEG", quality=90)
        data = encoded.getvalue()
    else:
        data = bytearray()
        for y in range(height):
            for pixel in colors[y * width:(y + 1) * width]:
                data.extend(pixel[::-1] if resource_id == 1033 else pixel)
            data.extend(rng.randbytes(stride - width * 3))
        data = bytes(data)
    header = struct.pack(">6I2H", int(jpeg), width, height, stride, stride * height, len(data), 24, 1)
    expected = Image.open(io.BytesIO(data)).convert("RGBA") if jpeg else Image.frombytes("RGB", (width, height), data, "raw", "BGR" if resource_id == 1033 else "RGB", stride).convert("RGBA")
    return block(resource_id, header + data, b"odd" if width % 2 else b"even"), expected


def sample(name, resources, image, resource_id, version):
    # Complete, valid ZIP composite deliberately above the existing 2M-pixel
    # local ceiling. Its saved colors come from the same thumbnail, resized.
    canvas = image.convert("RGB").resize((1536, 1536), Image.Resampling.NEAREST)
    planar = b"".join(band.tobytes() for band in canvas.split())
    header = b"8BPS" + struct.pack(">H6sHIIHHI", version, b"\0" * 6, 3, 1536, 1536, 8, 3, 0)
    document = header + struct.pack(">I", len(resources)) + resources + b"\0" * (8 if version == 2 else 4) + b"\0\2" + zlib.compress(planar)
    extension = ".psb" if version == 2 else ".psd"
    file_name = name + extension
    (OUT / file_name).write_bytes(document)
    parsed = PSDImage.open(io.BytesIO(document))
    independent = parsed.thumbnail().convert("RGBA")
    assert independent.size == image.size and independent.tobytes() == image.tobytes(), name
    # The full composite is usable by the independent decoder, not a broken
    # file whose metadata was fabricated to force the fallback path.
    saved = parsed.topil().convert("RGB")
    assert saved.size == canvas.size and saved.tobytes() == canvas.tobytes(), name
    thumbnail_resource = parsed.image_resources.get_data(resource_id)
    rows.append({"name": file_name, "version": version, "resourceId": resource_id,
                 "width": image.width, "height": image.height,
                 "resourcesBase64": base64.b64encode(resources).decode(),
                 "rgbaBase64": base64.b64encode(independent.tobytes()).decode(),
                 "sourceJpegBase64": base64.b64encode(thumbnail_resource.data).decode() if thumbnail_resource.fmt == 1 else None,
                 "sha256": hashlib.sha256(document).hexdigest(),
                 "oracle": "psd-tools thumbnail + full composite; Pillow raw/JPEG decode"})


for i, width in enumerate([1, 2, 3, 5, 7, 17]):
    for resource_id in [1033, 1036]:
        resource, image = thumb(resource_id, width, 3 + i % 3)
        resources = block(1008, b"\3own", b"caption") + resource + block(1008, b"\2ok")
        sample(f"raw-{resource_id}-w{width}", resources, image, resource_id, 1 + i % 2)

legacy, old_image = thumb(1033, 5, 4, shift=70)
modern, new_image = thumb(1036, 7, 5)
sample("modern-after-legacy", legacy + modern, new_image, 1036, 1)
sample("modern-before-legacy", modern + legacy, new_image, 1036, 2)
for resource_id in [1033, 1036]:
    resource, image = thumb(resource_id, 17, 6, jpeg=True)
    sample(f"jpeg-{resource_id}", resource, image, resource_id, 1)

legacy_jpeg, _ = thumb(1033, 17, 6, shift=70, jpeg=True)
modern_jpeg, modern_jpeg_image = thumb(1036, 17, 6, jpeg=True)
sample("modern-jpeg-after-legacy-jpeg", legacy_jpeg + modern_jpeg, modern_jpeg_image, 1036, 1)
sample("modern-jpeg-before-legacy-jpeg", modern_jpeg + legacy_jpeg, modern_jpeg_image, 1036, 2)
sample("modern-raw-after-legacy-jpeg", legacy_jpeg + modern, new_image, 1036, 2)
sample("modern-jpeg-after-legacy-raw", legacy + modern_jpeg, modern_jpeg_image, 1036, 1)

report = {"seed": SEED, "producer": "own struct/zlib writer", "psdTools": psd_version,
          "pillow": pillow_version, "samples": rows}
(OUT / "references.json").write_text(json.dumps(report, indent=2) + "\n")
fixture = ROOT / "tests/fixtures/psd-thumbnails/references.json"
fixture.parent.mkdir(parents=True, exist_ok=True)
fixture.write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps({"originals": len(rows), "independentPixelsExact": len(rows), "out": str(OUT)}))
