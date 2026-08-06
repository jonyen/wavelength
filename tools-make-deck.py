#!/usr/bin/env python3
"""Generate a deck's pages from the root index.html and admin.html.

A deck is a copy of the game at its own path with its own clues.json and its own
namespaced storage. The pages are generated rather than hand-maintained so they
cannot drift from the originals. Re-run after changing the root pages.

    python3 tools-make-deck.py juliekwak "Julie Kwak"
"""
import os
import re
import sys

deck, title = sys.argv[1], sys.argv[2]
os.makedirs(deck, exist_ok=True)

for page in ("index.html", "admin.html"):
    s = open(page).read()

    # Shared assets live one level up.
    s = re.sub(r'(href|src)="(style\.css|script\.js|audio\.js|admin\.js|stars\.js|favicon\.svg)',
               r'\1="../\2', s)

    # Tag the deck so the scripts namespace their storage.
    s = s.replace('<body class="warp">', f'<body class="warp" data-deck="{deck}">')
    s = s.replace('<body>', f'<body data-deck="{deck}">')

    # Keep in-deck navigation inside the deck; leave the shared legal pages at root.
    s = s.replace('href="/admin.html"', f'href="/{deck}/admin.html"')
    s = s.replace('href="/"', f'href="/{deck}/"')

    # No service worker: it would need its own copy at this path, and the deck
    # does not need offline support.
    s = re.sub(r"\n *<script>\n *if \('serviceWorker' in navigator\).*?</script>\n",
               "\n", s, flags=re.S)

    s = s.replace("<title>Wavelength Game</title>", f"<title>Wavelength — {title}</title>")
    s = s.replace("<title>Clue Editor - Wavelength Game</title>",
                  f"<title>Clue Editor — {title}</title>")

    open(os.path.join(deck, page), "w").write(s)

print(f"wrote {deck}/index.html and {deck}/admin.html")
