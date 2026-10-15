"""psd-tools decoding plus Decimal unprofiled CMYK conversion, no reader imports.

The conversion follows CSS Color 5 section 6.1 (an uncalibrated approximation,
not an ICC renderer). Native PSD stores inverted color and black plates.
Pillow's separate 8-bit conversion is reported without replacing this oracle.
"""
import base64
from decimal import Decimal, ROUND_HALF_UP
import json
from pathlib import Path
import struct
import sys
import PIL
import psd_tools
from psd_tools import PSDImage
from psd_tools.api.utils import has_transparency, get_transparency_index

results = []
for name in json.load(open(sys.argv[1])):
    path = Path(name)
    if path.stat().st_size > 20 * 1024 * 1024:
        raise ValueError('input exceeds oracle bound')
    psd = PSDImage.open(path, max_alloc_bytes=32 * 1024 * 1024)
    if psd.width * psd.height > 2_000_000 or psd.depth not in (8, 16) or int(psd.color_mode) != 4:
        raise ValueError('oracle requires bounded 8/16-bit CMYK')
    planes = psd._record.image_data.get_data(psd._record.header)
    maximum = Decimal(255 if psd.depth == 8 else 65535)
    samples = [list(p) if psd.depth == 8 else [x[0] for x in struct.iter_unpack('>H', p)] for p in planes]
    alpha_index = get_transparency_index(psd) if has_transparency(psd) else None
    if alpha_index == -1:
        alpha_index = len(samples) - 1
    rgba = bytearray()
    for i in range(psd.width * psd.height):
        black = 1 - Decimal(samples[3][i]) / maximum
        for c in range(3):
            ink = 1 - Decimal(samples[c][i]) / maximum
            rgb = 1 - min(Decimal(1), ink * (1 - black) + black)
            rgba.append(int((rgb * 255).quantize(Decimal(1), rounding=ROUND_HALF_UP)))
        alpha = Decimal(1) if alpha_index is None else Decimal(samples[alpha_index][i]) / maximum
        rgba.append(int((alpha * 255).quantize(Decimal(1), rounding=ROUND_HALF_UP)))
    pillow = psd.topil(apply_icc=False).convert('RGBA').tobytes()
    # Pillow cannot retain CMYK alpha via topil; compare opaque RGB channels only.
    deltas = [abs(rgba[i] - pillow[i]) for i in range(len(rgba)) if i % 4 != 3]
    results.append({'name':path.name, 'width':psd.width, 'height':psd.height, 'depth':psd.depth,
                    'alphaIndex':alpha_index, 'rgbaBase64':base64.b64encode(rgba).decode(),
                    'pillowRGBDifference':sum(deltas), 'pillowMaximumRGBDifference':max(deltas)})
print(json.dumps({'oracle':'psd-tools '+psd_tools.__version__+'; Decimal CSS uncalibrated conversion; Pillow '+PIL.__version__, 'results':results}))
