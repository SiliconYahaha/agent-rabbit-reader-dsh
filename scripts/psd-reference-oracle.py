"""Independent PSD composite oracle: psd-tools==1.18.0; no reader imports.

Explicit local inputs only. Does not fetch or execute document content. Returns
straight RGBA pixels (32-bit linear RGB is mapped to sRGB; alpha stays linear).
"""
import base64
import json
import struct
import sys
from pathlib import Path

import numpy as np
from psd_tools import PSDImage
from psd_tools.api import numpy_io

# psd-tools 1.18.0 returns a read-only frombuffer view for 32-bit data, then
# writes into it while removing the white matte. Copy the buffer only; retain
# its independent parsing, channel selection and color-matte implementation.
_parse_array = numpy_io._parse_array
numpy_io._parse_array = lambda *args, **kwargs: _parse_array(*args, **kwargs).copy()


results = []
for arg in sys.argv[1:]:
    path = Path(arg)
    if path.stat().st_size > 20 * 1024 * 1024:
        raise ValueError("oracle input exceeds 20 MiB")
    with path.open("rb") as stream:
        header = stream.read(26)
    if len(header) != 26 or header[:4] != b"8BPS":
        raise ValueError("invalid PSD header")
    height, width = struct.unpack(">II", header[14:22])
    if not height or not width or height * width > 2_000_000:
        raise ValueError("oracle canvas exceeds two million pixels")
    psd = PSDImage.open(path, max_alloc_bytes=32 * 1024 * 1024)
    if int(psd.color_mode) != 3:
        raise ValueError("this oracle comparison is restricted to RGB")
    color = np.clip(psd.numpy("color"), 0, 1)
    alpha = np.clip(psd.numpy("shape"), 0, 1)
    if psd.depth == 32:
        color = np.where(color <= 0.0031308, color * 12.92, 1.055 * color ** (1 / 2.4) - 0.055)
    rgba = np.floor(np.concatenate([color, alpha], axis=2) * 255 + 0.5).astype(np.uint8)
    results.append({"name": path.name, "width": psd.width, "height": psd.height,
                    "nonOpaquePixels": int(np.sum(rgba[:, :, 3] < 255)),
                    "rgbaBase64": base64.b64encode(rgba.tobytes()).decode("ascii")})
print(json.dumps(results))
