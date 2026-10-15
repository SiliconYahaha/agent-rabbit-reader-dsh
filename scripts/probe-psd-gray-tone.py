"""Independent psd-tools producer and saved-composite reference for gray tone.

Usage: python scripts/probe-psd-gray-tone.py OUTPUT
Requires psd-tools 1.18 and Pillow. No reader implementation is imported.
"""
import base64
import hashlib
import json
import math
import struct
import sys
from pathlib import Path

import psd_tools
from psd_tools import PSDImage
from psd_tools.constants import Compression, Tag
from psd_tools.psd.layer_and_mask import GlobalLayerMaskInfo, LayerInfo
from psd_tools.psd.tagged_blocks import TaggedBlocks

out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)
width, height = 65, 17
results = []
for depth in (16, 32):
    def encoded(value):
        if depth == 16:
            return struct.pack('>H', math.floor(value * 65535 + 0.5))
        return struct.pack('>f', value)

    def decoded(value):
        return struct.unpack('>H' if depth == 16 else '>f', value)[0] / (65535 if depth == 16 else 1)

    gray = [encoded(x / (width - 1)) for y in range(height) for x in range(width)]
    alpha = [encoded(y / (height - 1)) for y in range(height) for x in range(width)]
    for transparent in (False, True):
        planes = [b''.join(gray)] + ([b''.join(alpha)] if transparent else [])
        expected = bytes(c for i, value in enumerate(gray) for c in (
            *([math.floor(decoded(value) * 255 + 0.5)] * 3),
            math.floor(decoded(alpha[i]) * 255 + 0.5) if transparent else 255))
        for version in (1, 2):
            for compression in (0, 1, 2, 3):
                image = PSDImage.new('LA' if transparent else 'L', (width, height), depth=depth)
                image._record.header.version = version
                if transparent:
                    info = image._record.layer_and_mask_information
                    info.layer_info = LayerInfo()
                    info.global_layer_mask_info = GlobalLayerMaskInfo()
                    info.tagged_blocks = TaggedBlocks()
                    info.tagged_blocks.set_data(Tag.SAVING_MERGED_TRANSPARENCY16 if depth == 16 else Tag.SAVING_MERGED_TRANSPARENCY32)
                image._record.image_data.compression = Compression(compression)
                image._record.image_data.set_data(planes, image._record.header)
                name = f'gray-d{depth}-a{int(transparent)}-v{version}-c{compression}.' + ('psd' if version == 1 else 'psb')
                image.save(out / name)
                reopened = PSDImage.open(out / name)
                assert reopened._record.image_data.get_data(reopened._record.header) == planes
                reference = reopened.topil(apply_icc=False).convert('RGBA').tobytes()
                difference = max(abs(a - b) for a, b in zip(reference, expected))
                # Pillow quantizes floats/16-bit values differently at half steps.
                assert difference <= 1, (name, difference)
                results.append(dict(name=name, depth=depth, transparent=transparent, version=version,
                    compression=compression, width=width, height=height,
                    sha256=hashlib.sha256((out / name).read_bytes()).hexdigest(),
                    sourcePlanesExact=True, pillowMaxChannelDelta=difference,
                    rgbaBase64=base64.b64encode(expected).decode(),
                    pillowRgbaBase64=base64.b64encode(reference).decode()))
report = dict(producer='psd-tools ' + psd_tools.__version__,
    scope='Unprofiled saved grayscale ramps, opaque and Mt16/Mt32 merged alpha; no layer recomposition or ICC.',
    rule='Gray tone is encoded Y-prime, not linear RGB; sample conversion rounds to nearest byte.',
    results=results)
(out / 'references.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(dict(files=len(results), producer=report['producer'])))
