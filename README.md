# Wavelength

A pass-and-play web version of the Wavelength board game, self-hosted at
[wavelength.jonyen.com](https://wavelength.jonyen.com).

Everything runs client-side in the browser on a single device. There is no
networked multiplayer: gather around one screen and pass it as turns change.
Game state is kept in `localStorage` so a refresh does not lose the game, and a
service worker caches assets for offline play.

## Credits

Forked from [mikeck1/mikeck1.github.io](https://github.com/mikeck1/mikeck1.github.io),
the original web implementation by [mikeck1](https://github.com/mikeck1). This
copy strips the advertising and analytics (AdSense, Google Analytics, `ads.txt`)
and rewrites the About/Privacy/Terms pages to describe this deployment. The game
itself is unchanged.

The Wavelength board game is designed by Wolfgang Warsch, Alex Hague, and Justin
Vickers and published by CMYK. This is an unofficial digital adaptation, not
affiliated with or endorsed by the publisher.

## Decks

Two separate things share the name, deliberately:

**Saved decks** are named clue lists kept in the browser, managed from the clue
editor: save the list you are editing under a name, then load or delete it later.
Loading one makes it the list the game plays. They never leave the browser.

**Path decks** are copies of the game at their own URL with their own shipped
clue list, e.g. `/julie`. Each deck namespaces everything it stores — clues, scores, round
settings — behind its name, so decks never share state. Audio preferences stay
global. The name comes from `data-deck` on `<body>`.

The deck's `index.html` and `admin.html` are **generated** from the root pages,
so they cannot drift by hand. After editing `index.html` or `admin.html`,
regenerate every deck:

```sh
python3 tools-make-deck.py julie "Julie Kwak" "Julie's|50th|Birthday Edition!" --rounds=11 --teams=5 --practice
```

The third argument is an optional starburst sticker beside the title, its lines
separated by `|`. `--rounds` and `--teams` set that deck's defaults, used until
a player changes them. `--practice` makes the first round a warm-up: it is
played and scored on screen, but the points are not banked. All three ride on
`<body>` so the shared scripts need no knowledge of any particular deck.

Then bump the `?v=` on the asset URLs in the regenerated pages to match the root
pages. To add a deck, run the generator with a new name and drop a `clues.json`
into the new directory.

Deck pages skip the service worker: it would need its own copy at that path, and
a deck does not need offline support.

## Presenter and audience screens

`audience.html` is a read-only mirror for the room: the spectrum, the clue, the
needle as it moves, the round and the scores — but never the target until the
round is revealed. Open it from the game's side panel and drag that window to
the second display.

The needle can be dragged from either window — useful when the big screen is a
touchscreen — and `F` toggles full screen there, with `Esc` to leave. A deck's
sticker is shown on the audience screen rather than the presenter's.

The two windows sync over a `BroadcastChannel`, with `storage` events as a
fallback, so it needs no server and works offline. That also means it only works
between windows of the **same browser on the same machine** — two separate
devices would need a backend to relay state, which this deployment does not
have.

## Development

No build step. Serve the directory over HTTP (the service worker and `clues.json`
fetch will not work from `file://`):

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

### Files

| File | What it holds |
| --- | --- |
| `logic.js` | The pure rules: scoring, clue selection, deck parsing. Covered by tests. |
| `dialog.js` | The confirmation modal. Touches only its own markup. |
| `celebrate.js` | The two confetti effects. Depends only on canvas-confetti. |
| `script.js` | The game itself: the dial, persistence, teams, rounds, audience sync. |
| `admin.js` | The clue editor. |
| `audience.js` | The audience screen. |

Each is a plain script sharing globals, in the load order set by `index.html`.
`script.js` remains large because its parts share mutable game state rather than
communicating through interfaces; splitting it further wants ES modules, which
would change how every page loads its scripts.

### Tests

`logic.js` holds the game's pure rules — scoring, clue selection, deck parsing —
shared by the game and the clue editor and loaded as a plain script in both.
Node can require the same file, so the tests need no dependencies and no build:

```sh
node --test
```

Anything that can be written as a pure function belongs there, where it can be
tested. The rest of `script.js` is DOM work.

## Deployment

GitHub Pages serves the `main` branch from the repository root. The `CNAME` file
sets the custom domain. Pushing to `main` publishes.
