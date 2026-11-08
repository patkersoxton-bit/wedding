"""Generate index.html and travel.html from layout.json (written by slice.py).

Layer positions come straight from the Canva export; this file only adds the
animation choice per layer, screen-reader text, and click targets for links.
Re-run after re-slicing:  py -I build_pages.py   (from this folder)"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
CANVAS_W = 1366
L = json.load(open(os.path.join(HERE, 'layout.json')))

# layer name -> (animation, delay seconds, sway)
ANIM = {
    'names': ('write', 0.15, False), 'details': ('rise', 0.9, False),
    'forgetmenot': ('grow', 1.1, True), 'cake': ('settle', 0.35, False),
    'delphinium': ('grow', 0.6, True),
    'photo-couple': ('wipe', 0, False), 'std-title': ('write', 0.35, False),
    'foxglove-tall': ('grow', 0.7, True), 'foxglove-short': ('grow', 0.95, True),
    'join-script': ('write', 0.5, False), 'join-text': ('rise', 1.1, False),
    'bleeding-heart': ('swing', 0, True),
    'photo-proposal': ('wipe-up', 0, False),
    'contact-banner-text': ('rise', 0.1, False),
    'jolan-label': ('wipe', 0.1, False), 'parker-label': ('wipe', 0.35, False),
    'lily': ('grow', 0.25, True), 'jolan-info': ('rise', 0.55, False),
    'parker-info': ('rise', 0.75, False),
    'travel-title': ('write', 0.1, False), 'airports-title': ('write', 0.7, False),
    'airports-list': ('rise', 1.2, False), 'plane': ('fly', 0.9, False),
    'stay-title': ('write', 0.1, False), 'stay-text': ('rise', 0.7, False),
    'lake': ('wipe-up', 0.4, False), 'stay-list': ('rise', 1.0, False),
}

ALT = {
    'photo-couple': 'Parker and Jolan embracing, foreheads together, by the lake',
    'photo-proposal': 'Parker proposing to Jolan on the shore of Lake McDonald at sunset',
}

# Screen-reader / search text for each band (the visible text is artwork)
SR = {
    'hero': '<h1>Jolan and Parker</h1><p>Saturday May 27th, 2028. Chimney Pond Farm, Glenville, NC</p>',
    'std': '<h2>Save the Date!</h2>',
    'join': '<h2>We hope you can join us!</h2><p>In addition to the wedding ceremony and reception on Saturday, a welcome event will be hosted Friday evening, and farewell coffee and pastries will be available Sunday morning.</p>',
    'contact-banner': '<h2>For any questions, please contact us at:</h2>',
    'contact': '<p>Jolan Motyka. Phone (919) 491-8996. Email jolan.motyka@richmond.edu</p><p>Parker Sexton. Phone (919) 704-6108. Email parkersexton@gmail.com</p>',
    'airports': '<h1>Travel information</h1><h2>Closest airports</h2><p>There are multiple options for flying in:</p><ul><li>Asheville (AVL) - 1 hour 20 minutes from venue</li><li>Charlotte (CLT) - 3 hours from venue</li><li>Atlanta (ATL) - 3 hours from venue</li></ul>',
    'stay': '<h2>Where to stay</h2><p>The venue is located in Glenville, NC. Other nearby towns include Cashiers, Highlands, and Sapphire. There are many hotels and short term rentals, like AirBNBs in the area.</p><p>We suggest looking for accommodation early.</p><ul><li>Room block information</li><li>AirBNB Wishlist</li></ul>',
}

# Click targets over text in the artwork: band -> [(href, label, x0, y0, x1, y1) in page px]
LINKS = {
    'contact': [
        ('tel:+19194918996', 'Call Jolan', 86, 3504, 244, 3584),
        ('mailto:jolan.motyka@richmond.edu', 'Email Jolan', 86, 3620, 430, 3706),
        ('tel:+19197046108', 'Call Parker', 878, 3504, 1034, 3584),
        ('mailto:parkersexton@gmail.com', 'Email Parker', 878, 3620, 1180, 3706),
    ],
}

def pct(v, total=None):
    # Everything scales with the band's width (container query units), so at
    # the native 1366px width every layer lands on whole pixels — no
    # half-pixel resampling, pixel-identical to the export.
    return f'calc({v} * 100cqw / {CANVAS_W})'

def band_html(page, band):
    h = band['height']
    out = [f'  <section class="cv-band cv-band--{band["name"]}" style="--h: {h}; --bg: {band["bg"]};">']
    if band['name'] in SR:
        out.append(f'    <div class="visually-hidden">{SR[band["name"]]}</div>')
    for i, ly in enumerate(band['layers']):
        anim, delay, sway = ANIM.get(ly['name'], ('rise', 0, False))
        style = f'left: {pct(ly["x"], CANVAS_W)}; top: {pct(ly["y"], h)}; width: {pct(ly["w"], CANVAS_W)}; --d: {delay};'
        alt = ALT.get(ly['name'], '')
        lazy = '' if band['top'] == 0 else ' loading="lazy"'
        extra = ' data-sway' if sway else ''
        out.append(f'    <img class="cv-layer" src="assets/images/canva/final/{ly["file"]}" width="{ly["w"]}" height="{ly["h"]}" alt="{alt}"{lazy} decoding="async" data-anim="{anim}"{extra} style="{style}">')
    for href, label, x0, y0, x1, y1 in LINKS.get(band['name'], []):
        top = y0 - band['top']
        out.append(f'    <a class="cv-link" href="{href}" aria-label="{label}" style="left: {pct(x0, CANVAS_W)}; top: {pct(top, h)}; width: {pct(x1 - x0, CANVAS_W)}; height: {pct(y1 - y0, h)};"></a>')
    out.append('  </section>')
    return '\n'.join(out)

NAV = [('index.html', 'Home'), ('floral.html', 'Floral'), ('venue.html', 'Venue'),
       ('travel.html', 'Travel'), ('rsvp.html', 'RSVP')]

def page_html(page, filename, title, desc):
    nav = '\n'.join(
        f'      <li><a href="{href}"{" aria-current=\"page\"" if href == filename else ""}>{label}</a></li>'
        for href, label in NAV)
    bands = '\n\n'.join(band_html(page, b) for b in L[page]['bands'])
    return f'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{title}</title>
  <meta name="description" content="{desc}">
  <!-- GENERATED by assets/Design_Language/FINAL/build_pages.py from the
       Canva export FINAL/{"1" if page == "landing" else "2"}.png — edit the generator, not this file. -->
  <link rel="icon" type="image/png" href="assets/images/design/favicon.png">
  <link rel="stylesheet" href="css/canva.css">
  <script src="js/site-config.js"></script>
  <script src="js/canva.js"></script>
  <script src="js/gate.js"></script>
</head>
<body>

  <nav class="cv-menu" aria-label="Main">
    <button class="cv-menu__btn" type="button" aria-expanded="false" aria-controls="cv-menu-list"><span class="cv-menu__bars" aria-hidden="true"></span>Menu</button>
    <ul class="cv-menu__list" id="cv-menu-list">
{nav}
    </ul>
  </nav>

  <main>
{bands}
  </main>

</body>
</html>
'''

open(os.path.join(ROOT, 'index.html'), 'w', encoding='utf-8', newline='\n').write(page_html(
    'landing', 'index.html', 'Jolan &amp; Parker | May 27, 2028',
    'Save the date — Jolan &amp; Parker are getting married Saturday, May 27, 2028 at Chimney Pond Farm in Glenville, NC.'))
open(os.path.join(ROOT, 'travel.html'), 'w', encoding='utf-8', newline='\n').write(page_html(
    'travel', 'travel.html', 'Travel | Jolan &amp; Parker',
    "Travel information for Jolan &amp; Parker's wedding — closest airports and where to stay near Glenville, NC."))
print('wrote index.html, travel.html')
