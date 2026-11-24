#!/usr/bin/env python3
"""Pozadí, desky stolu a dřevo pro sbírku: z textur a HDRI Poly Haven (CC0) vyrobí lehké soubory do assets/tex.

Použití:  python3 -I scripts/assets/scenery.py <složka textur> <složka HDRI> <kořen repozitáře>

Vstup:
  <složka textur>/<id>.jpg (Diffuse 1k), <id>_n.jpg (nor_gl 1k), <id>_r.jpg (Rough 1k) – z api.polyhaven.com/files/<id>
  <složka HDRI>/<id>.jpg – „Tonemapped JPG“ panoramata (dl.polyhaven.org/file/ph-assets/HDRIs/extra/Tonemapped JPG/)
Výstup (assets/tex):
  bg_<id>.jpg 2048×1024 (equirect), bg_<id>_t.jpg náhled 160×80
  table_<id>_d.jpg 1024, _n.jpg a _r.jpg 512, _t.jpg náhled 96×96
  fence.jpg, bench.jpg – plot a lavice ve sbírce (CSS pozadí)
"""
import os, sys
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
TEX, HDRI, ROOT = sys.argv[1], sys.argv[2], sys.argv[3]
OUT = os.path.join(ROOT, 'assets', 'tex')

BACKGROUNDS = {  # hra → panorama
    'garden': 'chinese_garden',
    'nursery': 'cloudy_netted_nursery',
    'glasshouse': 'roof_garden',
    'patio': 'qwantani_patio',
}
TABLES = {  # hra → textura
    'teak': 'teak_veneer',
    'mahogany': 'dark_wood',
    'walnut': 'wood_table_001',
    'bamboo': 'bamboo_veneer',
    'oldwood': 'wood_table_worn',
    'tatami': 'tatami_mat',
    'granite': 'granite_tile',
}

def save(im, name, size, q=80):
    im.convert('RGB').resize(size, Image.LANCZOS).save(os.path.join(OUT, name), quality=q, optimize=True, progressive=True)

for key, src in BACKGROUNDS.items():
    im = Image.open(os.path.join(HDRI, src + '.jpg'))
    save(im, f'bg_{key}.jpg', (2048, 1024), 80)
    # náhled: výřez kolem obzoru (prostřední třetina výšky)
    w, h = im.size
    save(im.crop((0, h // 3, w, h * 2 // 3)), f'bg_{key}_t.jpg', (240, 60), 78)
    print('pozadí', key)

for key, src in TABLES.items():
    d = Image.open(os.path.join(TEX, src + '.jpg'))
    save(d, f'table_{key}_d.jpg', (1024, 1024), 82)
    save(Image.open(os.path.join(TEX, src + '_n.jpg')), f'table_{key}_n.jpg', (512, 512), 85)
    save(Image.open(os.path.join(TEX, src + '_r.jpg')), f'table_{key}_r.jpg', (512, 512), 80)
    save(d.crop((0, 0, d.size[0] // 2, d.size[1] // 2)), f'table_{key}_t.jpg', (96, 96), 80)
    print('stůl', key)

save(Image.open(os.path.join(TEX, 'hinoki_planks.jpg')), 'fence.jpg', (1024, 1024), 80)
save(Image.open(os.path.join(TEX, 'dark_wood.jpg')), 'bench.jpg', (1024, 1024), 80)
print('plot a lavice')
