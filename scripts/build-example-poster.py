"""Rebuild the layered PSD demo from the original rabbit-courier illustration.

This authoring-only command needs Pillow and psd-tools; the mini-program build
uses the checked-in PSD and does not install either package.
"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from psd_tools import PSDImage
from psd_tools.constants import Compression

root = Path(__file__).resolve().parent / 'assets' / 'example-art'
art = Image.open(root / 'rabbit-courier-art.png').convert('RGBA')
font_path = '/System/Library/Fonts/Supplemental/Arial Unicode.ttf'

headline = Image.new('RGBA', art.size, (0, 0, 0, 0))
draw = ImageDraw.Draw(headline)
font = ImageFont.truetype(font_path, 40)
draw.text((28, 20), '文件，', font=font, fill='#221f1c')
draw.text((28, 62), '随时打开。', font=font, fill='#221f1c')

brand = Image.new('RGBA', art.size, (0, 0, 0, 0))
draw = ImageDraw.Draw(brand)
draw.rounded_rectangle((235, 24, 337, 52), radius=14, fill='#d9f44e')
draw.text((245, 29), '兔子阅读器', font=ImageFont.truetype(font_path, 12), fill='#221f1c')

psd = PSDImage.new(mode='RGB', size=art.size, depth=8)
psd.create_pixel_layer(art, name='Poster illustration', compression=Compression.ZIP)
psd.create_pixel_layer(headline, name='Headline', compression=Compression.ZIP)
psd.create_pixel_layer(brand, name='Brand badge', compression=Compression.ZIP)
psd.save(root / 'rabbit-courier-poster.psd')
