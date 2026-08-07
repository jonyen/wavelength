#!/usr/bin/env python3
"""Generate a deck's pages from the root index.html and admin.html.

A deck is a copy of the game at its own path with its own clues.json and its own
namespaced storage. The pages are generated rather than hand-maintained so they
cannot drift from the originals. Re-run after changing the root pages.

    python3 tools-make-deck.py julie "Julie Kwak"
    python3 tools-make-deck.py julie "Julie Kwak" "Julie's|50th|Birthday Edition!"
    python3 tools-make-deck.py julie "Julie Kwak" "..." --rounds=11 --teams=5 --practice

The optional third argument is a starburst sticker pinned beside the title, its
lines separated by "|". --rounds and --teams set the deck's defaults, used until
a player changes them. --practice makes the first round a scored-but-not-banked
warm-up.
"""
import os
import re
import sys

# Accepts both "--rounds=11" and bare switches like "--practice".
flags = {}
for arg in sys.argv[1:]:
    if not arg.startswith("--"):
        continue
    name, _, value = arg.partition("=")
    flags[name] = value if value else True
positional = [a for a in sys.argv[1:] if not a.startswith("--")]

deck, title = positional[0], positional[1]
badge_lines = positional[2].split("|") if len(positional) > 2 else []
default_rounds = flags.get("--rounds")
default_teams = flags.get("--teams")
practice_round = bool(flags.get("--practice"))

STARBURST = ("100.0,4.0 112.4,22.0 129.7,8.7 135.9,29.6 156.4,22.3 155.9,44.1 177.7,43.6 "
             "170.4,64.1 191.3,70.3 178.0,87.6 196.0,100.0 178.0,112.4 191.3,129.7 170.4,135.9 "
             "177.7,156.4 155.9,155.9 156.4,177.7 135.9,170.4 129.7,191.3 112.4,178.0 100.0,196.0 "
             "87.6,178.0 70.3,191.3 64.1,170.4 43.6,177.7 44.1,155.9 22.3,156.4 29.6,135.9 "
             "8.7,129.7 22.0,112.4 4.0,100.0 22.0,87.6 8.7,70.3 29.6,64.1 22.3,43.6 44.1,44.1 "
             "43.6,22.3 64.1,29.6 70.3,8.7 87.6,22.0")


def badge_markup(lines):
    """A starburst sticker. Sized in the viewBox so it scales with the SVG."""
    if not lines:
        return ""
    step = 36
    start = 100 - (len(lines) - 1) * step / 2
    # Only condense a line that would overflow the starburst. Forcing every line
    # to one width made short lines look larger than long ones, since the glyphs
    # stretched to fill it.
    def span(i, line):
        big = i == 1 and len(lines) > 2
        cls = "sticker-line sticker-line--big" if big else "sticker-line"
        # Rough advance width per character for uppercase Roboto Bold at the
        # sizes set in style.css.
        estimate = len(line) * (21 if big else 11.5)
        limit = 112 if big else 134
        fit = (f' textLength="{limit}" lengthAdjust="spacingAndGlyphs"'
               if estimate > limit else "")
        return (f'\n                <text x="100" y="{start + i * step:.0f}" class="{cls}"'
                f'{fit}>{line}</text>')

    spans = "".join(span(i, line) for i, line in enumerate(lines))
    return (
        '\n        <div class="birthday-sticker" aria-hidden="true">'
        '\n            <svg viewBox="0 0 200 200">'
        f'\n                <polygon points="{STARBURST}" />{spans}'
        '\n            </svg>'
        '\n        </div>'
    )
os.makedirs(deck, exist_ok=True)

for page in ("index.html", "admin.html", "audience.html"):
    s = open(page).read()

    # Shared assets live one level up.
    s = re.sub(r'(href|src)="(style\.css|script\.js|audio\.js|admin\.js|stars\.js|audience\.js|favicon\.svg)',
               r'\1="../\2', s)

    # Tag the deck so the scripts namespace their storage.
    # Deck defaults ride on <body> so script.js can read them without knowing
    # any deck by name.
    attrs = f'data-deck="{deck}"'
    if default_rounds:
        attrs += f' data-default-rounds="{default_rounds}"'
    if default_teams:
        attrs += f' data-default-teams="{default_teams}"'
    if practice_round:
        attrs += ' data-practice-round="true"'
    # Match any <body>, with or without classes, so a page like audience.html
    # ("warp audience") is not silently skipped.
    s = re.sub(r'<body([^>]*)>', lambda m: f'<body{m.group(1)} {attrs}>', s, count=1)

    # Keep in-deck navigation inside the deck; leave the shared legal pages at root.
    s = s.replace('href="/admin.html"', f'href="/{deck}/admin.html"')
    s = s.replace('href="/"', f'href="/{deck}/"')

    # No service worker: it would need its own copy at this path, and the deck
    # does not need offline support.
    s = re.sub(r"\n *<script>\n *if \('serviceWorker' in navigator\).*?</script>\n",
               "\n", s, flags=re.S)

    # The sticker goes on the game page only, right after the title.
    if page == "index.html" and badge_lines:
        s = s.replace("        </h1>", "        </h1>" + badge_markup(badge_lines), 1)

    s = s.replace("<title>Wavelength Game</title>", f"<title>Wavelength — {title}</title>")
    s = s.replace("<title>Clue Editor - Wavelength Game</title>",
                  f"<title>Clue Editor — {title}</title>")
    s = s.replace("<title>Wavelength — Audience</title>",
                  f"<title>Audience — {title}</title>")

    open(os.path.join(deck, page), "w").write(s)

print(f"wrote {deck}/index.html, {deck}/admin.html and {deck}/audience.html")
