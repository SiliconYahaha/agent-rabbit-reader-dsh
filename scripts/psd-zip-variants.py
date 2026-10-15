"""Independent psd-tools recompression of explicit public originals.

Preserves original prefix and raw merged planes. Outputs are local derived
artifacts, not original Photoshop ZIP saves. No reader imports or downloads.
"""
import hashlib
import json
import struct
import sys
from pathlib import Path
from psd_tools import PSDImage
from psd_tools.constants import Compression
from psd_tools.psd.image_data import ImageData

destination = Path(sys.argv[1]).resolve()
if not destination.is_dir():
    raise ValueError("explicit existing output directory required")
profile = json.loads((Path(__file__).resolve().parent.parent / "compatibility/profiles/psd.json").read_text())
samples = {sample["name"]: sample for sample in profile["zipPublicSamples"]}
results = []
for argument in sys.argv[2:]:
    path = Path(argument).resolve()
    if path.stat().st_size > 20 * 1024 * 1024:
        raise ValueError("input exceeds 20 MiB")
    original = path.read_bytes()
    if hashlib.sha256(original).hexdigest() != samples[path.name]["sha256"]:
        raise ValueError("public original hash mismatch")
    height, width = struct.unpack(">II", original[14:22])
    if not height or not width or height * width > 2_000_000:
        raise ValueError("canvas exceeds two million pixels")
    psd = PSDImage.open(path, max_alloc_bytes=32 * 1024 * 1024)
    image = psd._record.image_data
    planes = image.get_data(psd._record.header)
    prefix = original[:len(original) - len(image.data) - 2]
    if original[len(prefix):] != struct.pack(">H", int(image.compression)) + image.data:
        raise ValueError("original tail mismatch")
    for compression, label in [(Compression.ZIP, "zip"), (Compression.ZIP_WITH_PREDICTION, "prediction")]:
        derived = ImageData(compression=compression)
        derived.set_data(planes, psd._record.header)
        content = prefix + struct.pack(">H", int(compression)) + derived.data
        output = destination / (path.stem + "-" + label + path.suffix)
        if output.exists():
            if output.read_bytes() != content:
                raise ValueError("refusing to overwrite differing artifact")
        else:
            with output.open("xb") as stream:
                stream.write(content)
        results.append({"original": path.name, "name": output.name, "path": str(output),
                        "sha256": hashlib.sha256(content).hexdigest(), "compression": int(compression),
                        "width": width, "height": height, "depth": psd.depth,
                        "provenance": "derived with psd-tools 1.18.0; not an original ZIP save"})
print(json.dumps(results))
