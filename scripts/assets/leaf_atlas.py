# Sestaví atlas listů z naskenovaných sad ambientCG (CC0): python3 scripts/assets/leaf_atlas.py <složka se staženými sadami>
# Výstup: assets/tex/leaves.webp (barva + průhlednost) a src/leafAtlas.json (kde je který list).
# Každý list se ořízne na čepel (bez řapíku), roztáhne na celé políčko a barevně znormalizuje:
# hra list barví sama podle ročního období, z fotky se bere kresba žilek, okraj a jemné odchylky odstínu.
import json, sys
import numpy as np
from PIL import Image
from scipy import ndimage

SRC = sys.argv[1]
SETS = {'ovate': '014', 'beech': '024', 'lobed': '016', 'delta': '004', 'palmate': '010'}
CELL, COLS, ROWS, PER = 256, 8, 3, 4
atlas = np.zeros((ROWS * CELL, COLS * CELL, 4), np.uint8)
atlas[(ROWS - 1) * CELL:, :CELL] = 255  # políčko (0,0) vlevo dole = bílé, pro jehlice a řapíky
cells, slot = {}, 1
for shape, num in SETS.items():
    col = np.asarray(Image.open(f'{SRC}/LeafSet{num}/LeafSet{num}_2K-JPG_Color.jpg').convert('RGB'), np.float32) / 255
    op = np.asarray(Image.open(f'{SRC}/LeafSet{num}/LeafSet{num}_2K-JPG_Opacity.jpg').convert('L'), np.float32) / 255
    lab, n = ndimage.label(op > 0.5)
    sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
    order = [i + 1 for i in np.argsort(-sizes)[:PER]]
    cells[shape] = []
    for k in order:
        ys, xs = np.where(lab == k)
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        m = (lab[y0:y1, x0:x1] == k).astype(np.float32) * op[y0:y1, x0:x1]
        c = col[y0:y1, x0:x1]
        # řapík: řádky u dolního i horního okraje, kde je list užší než 9 % své největší šířky
        w = (m > 0.5).sum(1); lim = 0.09 * w.max()
        rows = np.where(w > lim)[0]
        top, bot = rows.min(), rows.max() + 1
        m, c = m[top:bot], c[top:bot]
        # orientace podle tvaru: list je nejširší blíž k bázi (u dubu naopak blíž ke špičce);
        # báze má být dole, tedy těžiště plochy v dolní polovině (u dubu v horní)
        wr = (m > 0.5).sum(1).astype(np.float32)
        centroid = (wr * np.arange(len(wr))).sum() / wr.sum() / len(wr)
        base_low = centroid > 0.5
        if base_low == (shape == 'lobed'): m, c = m[::-1], c[::-1]
        cols_ = np.where((m > 0.5).sum(0) > 0)[0]
        m, c = m[:, cols_.min():cols_.max() + 1], c[:, cols_.min():cols_.max() + 1]
        # barva: jas srovnat na střední šedou, z odstínu nechat čtvrtinu
        lum = (c * [0.3, 0.59, 0.11]).sum(2)
        mean = lum[m > 0.5].mean()
        g = np.clip(lum / mean * 0.66, 0, 1)
        meanc = c[m > 0.5].mean(0)
        out = np.clip(g[..., None] + 0.25 * (c - lum[..., None] - (meanc - mean)), 0, 1)
        inner = CELL - 8
        im = Image.fromarray((np.dstack([out, m]) * 255).astype(np.uint8), 'RGBA').resize((inner, inner), Image.LANCZOS)
        cx, cy = slot % COLS, slot // COLS
        px, py = cx * CELL + 4, (ROWS - 1 - cy) * CELL + 4
        a = np.asarray(im)
        atlas[py:py + inner, px:px + inner] = a
        cells[shape].append([cx, cy]); slot += 1
# průhledné okolí dostane barvu čepele, aby zmenšené úrovně textury neměly tmavý lem
rgb = atlas[..., :3]; alpha = atlas[..., 3]
rgb[alpha < 8] = 168
Image.fromarray(atlas, 'RGBA').save('assets/tex/leaves.webp', quality=88, method=6)
json.dump({'cols': COLS, 'rows': ROWS, 'cells': cells}, open('src/leafAtlas.json', 'w'))
print(cells)
