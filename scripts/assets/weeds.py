#!/usr/bin/env python3
"""Plevel do misek: z modelů Poly Haven (CC0, glTF 1k) vybere lehké varianty a uloží je kompaktně.

Použití:  python3 -I scripts/assets/weeds.py <složka se staženými modely> <kořen repozitáře>

Vstup: <složka>/<model>/<model>.gltf + .bin + textures/<model>_diff_1k.jpg (stažené z api.polyhaven.com).
Výstup:
  assets/tex/weeds.bin        – geometrie všech variant za sebou (Float32 pozice v cm, normály, UV; Uint16 indexy)
  assets/tex/weed_<model>.webp – barva listů 512 px s průhledností odvozenou z jasu (sken je na černém pozadí)
  src/weeds.json              – popis: druh, model, offsety do weeds.bin, počty, rozměry
"""
import json, struct, sys, os
from PIL import Image, ImageFilter

SRC, ROOT = sys.argv[1], sys.argv[2]
# druh ve hře → (model, uzly); velké varianty (desítky tisíc trojúhelníků) vynechány
PICK = {
    'dandelion': ('dandelion_01', ['dandelion_01_c_LOD0', 'dandelion_01_d_LOD0', 'dandelion_01_e_LOD0']),
    'grass': ('grass_medium_02', ['grass_medium_02_a', 'grass_medium_02_b', 'grass_medium_02_c', 'grass_medium_02_d']),
    'celandine': ('celandine_01', ['celandine_01_a_LOD0', 'celandine_01_b_LOD0', 'celandine_01_d_LOD0', 'celandine_01_e_LOD0']),
    'nettle': ('nettle_plant', ['nettle_plant_small_a_LOD0', 'nettle_plant_small_b_LOD0', 'nettle_plant_medium_b_LOD0']),
}
CT = {5126: ('f', 4), 5123: ('H', 2), 5125: ('I', 4), 5121: ('B', 1)}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}

def read_acc(g, binbuf, i):
    a = g['accessors'][i]; bv = g['bufferViews'][a['bufferView']]
    fmt, size = CT[a['componentType']]; n = NC[a['type']]
    stride = bv.get('byteStride', size * n)
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    out = []
    for k in range(a['count']):
        out.append(struct.unpack_from('<' + fmt * n, binbuf, off + k * stride))
    return out

blob = bytearray()
meta = {'kinds': {}, 'textures': {}}
for kind, (model, nodes) in PICK.items():
    g = json.load(open(os.path.join(SRC, model, model + '.gltf')))
    binbuf = open(os.path.join(SRC, model, g['buffers'][0]['uri']), 'rb').read()
    variants = []
    for name in nodes:
        node = next(n for n in g['nodes'] if n.get('name') == name)
        mesh = g['meshes'][node['mesh']]
        P, N, U, I = [], [], [], []
        for prim in mesh['primitives']:
            base = len(P)
            P += read_acc(g, binbuf, prim['attributes']['POSITION'])
            N += read_acc(g, binbuf, prim['attributes']['NORMAL'])
            U += read_acc(g, binbuf, prim['attributes']['TEXCOORD_0'])
            I += [base + x[0] for x in read_acc(g, binbuf, prim['indices'])]
        assert len(P) < 65536
        # metry → centimetry; střed půdorysu do počátku, spodek na nulu
        xs = [p[0] for p in P]; zs = [p[2] for p in P]; ys = [p[1] for p in P]
        cx, cz, y0 = (min(xs) + max(xs)) / 2, (min(zs) + max(zs)) / 2, min(ys)
        P = [((p[0] - cx) * 100, (p[1] - y0) * 100, (p[2] - cz) * 100) for p in P]
        while len(blob) % 4: blob.append(0)
        o = len(blob)
        for p in P: blob += struct.pack('<3f', *p)
        for v in N: blob += struct.pack('<3f', *v)
        for v in U: blob += struct.pack('<2f', *v)
        for x in I: blob += struct.pack('<H', x)
        w = max(max(p[0] for p in P) - min(p[0] for p in P), max(p[2] for p in P) - min(p[2] for p in P))
        h = max(p[1] for p in P)
        variants.append({'name': name, 'offset': o, 'verts': len(P), 'indices': len(I), 'width': round(w, 2), 'height': round(h, 2)})
        print(kind, name, 'vrcholů', len(P), 'trojúhelníků', len(I) // 3, 'šířka %.1f cm výška %.1f cm' % (w, h))
    meta['kinds'][kind] = {'model': model, 'variants': variants}
    # barva s průhledností: sken je na černém pozadí – co je skoro černé, je průhledné (okraj lehce rozostřený)
    im = Image.open(os.path.join(SRC, model, 'textures', model + '_diff_1k.jpg')).convert('RGB').resize((512, 512), Image.LANCZOS)
    lum = im.convert('L').point(lambda v: 0 if v < 14 else (255 if v > 34 else int((v - 14) * 255 / 20)))
    lum = lum.filter(ImageFilter.MaxFilter(3))
    rgba = im.copy(); rgba.putalpha(lum)
    out = os.path.join(ROOT, 'assets', 'tex', 'weed_' + model + '.webp')
    rgba.save(out, 'WEBP', quality=82, method=6)
    meta['textures'][model] = 'tex/weed_' + model + '.webp'
open(os.path.join(ROOT, 'assets', 'tex', 'weeds.bin'), 'wb').write(blob)
json.dump(meta, open(os.path.join(ROOT, 'src', 'weeds.json'), 'w'), ensure_ascii=False, indent=1)
print('weeds.bin', len(blob), 'B')
