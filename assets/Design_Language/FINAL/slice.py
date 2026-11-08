"""Slice the FINAL Canva PNGs into individually animatable layers.

Each band is a flat background color. Every element is cut out with alpha =
its own pixels (exact RGB, including anti-aliased edges), so stacking all
layers on the band color reproduces the original pixel-for-pixel.
Pixels in overlapping rects are claimed by the first matching element
(optionally filtered by a color predicate).

usage: py -I slice.py <FINAL dir> <out dir>
Writes layers + layout.json and verifies the recomposition."""
import sys, os, json
from PIL import Image, ImageChops

SRC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)

def is_orange(c):   # "Save the Date!" lettering incl. anti-aliased edges
    r, g, b = c; return r > 200 and 120 < g < 222 and b < g - 30
def is_dark(c):     # olive script on green band
    r, g, b = c; return (r + g + b) / 3 < 150

PAGES = {
  'landing': ('1.png', [
    # band: name, y0, y1, bg, elements[(name, rect, kind, pred)]
    ('hero', 0, 768, None, [
      ('names', (100, 130, 710, 410), 'art', None),
      ('details', (220, 460, 700, 640), 'art', None),
      ('forgetmenot', (80, 460, 220, 700), 'art', None),
      ('cake', (740, 86, 'SPLIT', 720), 'art', None),
      ('delphinium', ('SPLIT', 86, 1280, 720), 'art', None),
    ]),
    ('std', 768, 1536, None, [
      ('photo-couple', (0, 768, 683, 1536), 'photo', None),
      ('foxglove-tall', (1100, 965, 1305, 1520), 'art', None),
      ('std-title', (725, 840, 1225, 1106), 'art', is_orange),
      ('foxglove-tall', (1100, 870, 1305, 1520), 'art', None),
      ('foxglove-short', (945, 1100, 1115, 1520), 'art', None),
      ('std-title', (725, 840, 1225, 1106), 'art', None),
    ]),
    ('join', 1536, 2304, None, [
      ('join-script', (270, 1822, 1140, 1960), 'art', None),
      ('join-text', (350, 1966, 1018, 2142), 'art', None),
      ('bleeding-heart', (8, 1630, 486, 1992), 'art', None),
    ]),
    ('proposal', 2304, 3072, None, [
      ('photo-proposal', (0, 2304, 1366, 3072), 'photo', None),
    ]),
    ('contact-banner', 3072, 3297, None, [
      ('contact-banner-text', (80, 3150, 866, 3210), 'art', None),
    ]),
    ('contact', 3297, 3840, None, [
      ('jolan-label', (66, 3342, 540, 3476), 'art', None),
      ('parker-label', (848, 3354, 1318, 3464), 'art', None),
      ('lily', (560, 3424, 786, 3800), 'art', None),
      ('jolan-info', (80, 3498, 520, 3710), 'art', None),
      ('parker-info', (872, 3498, 1300, 3710), 'art', None),
    ]),
  ]),
  'travel': ('2.png', [
    ('airports', 0, 768, None, [
      ('travel-title', (250, 76, 1110, 250), 'art', None),
      ('airports-title', (66, 254, 660, 365), 'art', None),
      ('airports-list', (66, 366, 840, 556), 'art', None),
      ('plane', (764, 388, 1170, 726), 'art', None),
    ]),
    ('stay', 768, 1536, None, [
      ('stay-title', (820, 822, 1306, 950), 'art', None),
      ('stay-text', (140, 950, 1306, 1090), 'art', None),
      ('lake', (26, 1096, 616, 1516), 'art', None),
      ('stay-list', (694, 1120, 1270, 1302), 'art', None),
    ]),
  ]),
}

def find_split(im, x0, x1, y0, y1, bg):
    """column with fewest non-bg pixels between x0..x1"""
    best = None
    for x in range(x0, x1):
        n = sum(1 for y in range(y0, y1) if diff(im.getpixel((x, y)), bg) > 18)
        if best is None or n < best[1]: best = (x, n)
    return best[0]

def diff(a, b): return max(abs(a[i] - b[i]) for i in range(3))

layout = {}
for page, (fn, bands) in PAGES.items():
    im = Image.open(os.path.join(SRC, fn)).convert('RGB')
    W, H = im.size
    px = im.load()
    layout[page] = {'width': W, 'height': H, 'bands': []}
    recon = Image.new('RGB', (W, H))
    for bname, y0, y1, _, els in bands:
        # band background: most common color along the band's edges
        from collections import Counter
        edge = Counter(px[x, y] for y in (y0 + 2, y1 - 3) for x in range(0, W, 3))
        bg = edge.most_common(1)[0][0]
        claimed = set()
        band = {'name': bname, 'top': y0, 'height': y1 - y0, 'bg': '#%02x%02x%02x' % bg, 'layers': []}
        Image.Image.paste(recon, bg, (0, y0, W, y1))
        # resolve SPLIT
        split = None
        for (n, r, k, p) in els:
            if 'SPLIT' in r and split is None:
                split = find_split(im, 1060, 1150, 300, 700, bg)
                print('split column', split)
        for (n, r, kind, pred) in els:
            r = tuple(split if v == 'SPLIT' else v for v in r)
            x0, ry0, x1, ry1 = r
            if kind == 'photo':
                crop = im.crop(r)
                crop.save(os.path.join(OUT, f'{page}-{n}.webp'), quality=92, method=6)
                recon.paste(crop, (x0, ry0))
                band['layers'].append({'name': n, 'file': f'{page}-{n}.webp', 'x': x0, 'y': ry0 - y0, 'w': x1 - x0, 'h': ry1 - ry0, 'kind': 'photo'})
                for yy in range(ry0, ry1):
                    for xx in range(x0, x1): claimed.add((xx, yy))
                continue
            layer = Image.new('RGBA', (x1 - x0, ry1 - ry0), (0, 0, 0, 0))
            lp = layer.load(); count = 0
            for yy in range(ry0, ry1):
                for xx in range(x0, x1):
                    if (xx, yy) in claimed: continue
                    c = px[xx, yy]
                    if c == bg: continue
                    if pred and not pred(c): continue
                    lp[xx - x0, yy - ry0] = c + (255,)
                    claimed.add((xx, yy)); count += 1
            if not count: print('EMPTY', n); continue
            prev = next((L for L in band['layers'] if L['name'] == n), None)
            if prev:  # second pass for same element: merge into earlier layer
                old = Image.open(os.path.join(OUT, prev['file'])).convert('RGBA')
                full = Image.new('RGBA', (x1 - x0, ry1 - ry0), (0, 0, 0, 0))
                full.paste(old, (prev['x'] - x0, prev['y'] + y0 - ry0))
                full.alpha_composite(layer)
                layer = full; band['layers'].remove(prev)
            bb = layer.getbbox()
            layer = layer.crop(bb)
            # merge "-rest" layers back into their base element name in layout
            out_name = n
            layer.save(os.path.join(OUT, f'{page}-{out_name}.webp'), lossless=True, method=6)
            recon.paste(layer, (x0 + bb[0], ry0 + bb[1]), layer)
            band['layers'].append({'name': out_name, 'file': f'{page}-{out_name}.webp', 'x': x0 + bb[0], 'y': ry0 + bb[1] - y0, 'w': layer.width, 'h': layer.height, 'kind': 'art'})
        # anything non-bg left unclaimed?
        left = [(xx, yy) for yy in range(y0, y1) for xx in range(W) if (xx, yy) not in claimed and px[xx, yy] != bg and diff(px[xx, yy], bg) > 6]
        if left:
            xs = [a for a, _ in left]; ys = [b for _, b in left]
            print(f'{page}/{bname}: {len(left)} unclaimed px, bbox', (min(xs), min(ys), max(xs), max(ys)))
        layout[page]['bands'].append(band)
    d = ImageChops.difference(recon, im)
    print(page, 'max diff vs original:', max(e[1] for e in d.getextrema()), 'bbox of diffs', d.point(lambda v: 255 if v > 6 else 0).getbbox())
    recon.save(os.path.join(OUT, f'_recon-{page}.png'))

json.dump(layout, open(os.path.join(OUT, 'layout.json'), 'w'), indent=1)
