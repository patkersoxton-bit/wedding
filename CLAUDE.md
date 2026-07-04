# Parker & Jolan — Wedding Website

## What this is

A custom wedding website for Parker & Jolan, live at **parkerandjolan.com**. It is a
hand-built HTML/CSS/JS site (no framework, no build step) that handles the design,
storytelling, and content, while offloading RSVP and registry functionality to
**Zola** via embedded widgets/snippets rather than reimplementing them.

The goal is a site that looks and feels custom-designed (specific theme, palette,
and animations pulled from inspiration references) without having to build guest
management, RSVP forms, or registry aggregation from scratch.

## Tech stack

- **Frontend**: plain HTML, CSS, JavaScript. No framework, no bundler, no npm
  build step. Keep it simple enough to FTP/upload straight to static hosting.
- **Animations/interactions**: hand-written CSS transitions/keyframes and vanilla
  JS (e.g. scroll reveals, hover states). Avoid pulling in animation libraries
  unless a specific effect genuinely needs one.
- **Third-party integration**: Zola, embedded via their widget/embed snippets
  (not raw iframes) for RSVP and registry. Treat Zola as the source of truth for
  guest RSVP state and registry links — don't duplicate that data locally unless
  a specific need arises (see Open Questions).
- **Hosting**: Hostinger, static file hosting only (not Hostinger's drag-and-drop
  website builder). Deployment is uploading built HTML/CSS/JS/assets directly —
  no server-side rendering, no backend process to keep running.
- **Domain**: parkerandjolan.com, pointed at Hostinger.

## Project structure

```
/
├── index.html          # main landing page
├── css/
│   └── style.css       # global styles, theme variables, animations
├── js/
│   └── main.js         # interactions, scroll effects, Zola embed init if needed
├── assets/
│   ├── images/
│   │   └── inspiration/  # reference screenshots/mockups driving the design
│   └── fonts/           # any self-hosted font files
└── CLAUDE.md
```

Additional HTML pages (e.g. `story.html`, `travel.html`, `registry.html`) should
live at the root alongside `index.html` and share `css/style.css` and
`js/main.js` unless a page needs page-specific logic.

## Design process

1. Inspiration references get dropped into `assets/images/inspiration/` along
   with notes on which elements (palette, type, layout, motion) to pull from
   each.
2. Theme gets distilled into CSS custom properties in `css/style.css` (colors,
   fonts, spacing scale) so the look stays consistent across pages.
3. Content (copy, photos, event details, schedule) gets filled in once
   structure/theme are settled — placeholders until then.

### Theme: bright floral (boho garden)

Direction pulled from the Pinterest board in `assets/images/inspiration/Theme/`
— dahlias/wildflowers, hanging floral installations, mixed-color bridesmaid
palettes — warm and floral rather than muted/minimalist.

Canonical color palette comes from
`assets/images/inspiration/Theme/Pinterest_files/THEME.png` (supersedes the
earlier `colors.jpg` "Summer 2025" palette — that file is kept only for
historical reference, don't pull colors from it anymore), implemented as CSS
custom properties in `css/style.css`:

| Name | Hex | Role |
|---|---|---|
| Copper | `#ef5356` | primary accent — headings, script names, primary buttons |
| Golden Hour | `#f2af3f` | secondary accent — buttons, highlights |
| Apricot | `#fda170` | soft accent — backgrounds, card borders |
| Blush | `#f2c1c1` | soft accent — backgrounds, subtle fills |
| Misty Blue | `#c0cfe0` | secondary accent — links, cool contrast |
| Moss | `#9f985c` | deep green accent — dividers, icons, floral leaves |
| Moss Light | `#c5c463` | lighter green accent |

This palette is warmer/softer than the old neon "Summer 2025" set — background,
shadow, and text tones were adjusted (color-corrected) to sit comfortably next
to it rather than clash.

Floral accents on the site (section-heading flourishes, the corner bloom
behind the Our Story photo) are original hand-drawn inline SVGs built from
this palette — not traced from or copies of the Pinterest photos.

Fonts: a hand-lettered script for the couple's names/big display text (echoing
the Pinterest board's hand-drawn signage), a serif for section headings, and a
clean rounded sans for body copy. Loaded via Google Fonts `<link>` tag (no
bundler needed).

**Image sourcing rule**: Pinterest board images (`Theme/Pinterest_files/`) are
inspiration references ONLY — never embed them directly on the site, they
exist purely to inform palette/vibe. The actual proposal photos in
`assets/images/photos/` (copied from `inspiration/PHOTOS/`) are real site
assets and are fair game to use directly in the hero, story, and gallery
sections.

## Open questions / not yet decided

- **Database**: whether this project needs its own database (e.g. for a
  guestbook, custom guest data Zola doesn't cover) is undecided. Don't add a
  backend/database dependency speculatively — revisit only when a concrete
  feature requires it, and note that Hostinger static hosting has no
  server-side runtime, so any future DB need would require a separate
  backend/service, not something bolted onto the static files.
- **Exact Zola embed snippets**: pending — Zola account/page needs to exist
  first before embed codes can be pulled in.

## Working conventions

- Keep the site static and dependency-free unless a real requirement forces
  otherwise (e.g. don't add a bundler or framework "just in case").
- Don't build custom RSVP/registry functionality — that's explicitly Zola's
  job here.
- When adding new sections/pages, match the existing theme variables in
  `css/style.css` rather than introducing new ad hoc colors/fonts.
