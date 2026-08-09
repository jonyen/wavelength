# Retire /julie, then add a shuffle toggle to the clue editor

Two independent changes on one branch, landed as separate commits in this order.

---

# Part 1: Retire /julie

## Problem

The `julie/` deck was built for a one-off event that has happened. It should no
longer be reachable, but its clue list and settings are worth keeping in the
tree.

## Design

All three of the deck's pages get a redirect to the site root, so the files stay
but nothing is playable:

```html
<meta http-equiv="refresh" content="0; url=/">
<meta name="robots" content="noindex">
```

placed in the `<head>` of `julie/index.html`, `julie/admin.html`, and
`julie/audience.html`, each with a plain link to `/` in the body as a fallback
for anything that ignores meta-refresh.

Nothing on the main site links to `/julie`, and it is absent from the service
worker precache list (sw.js:2-21), so no other file needs touching. The worker
serves HTML network-first (sw.js:40-49), so the redirect takes effect on the
next online visit without a `CACHE_NAME` bump; only an offline visitor with the
deck already cached would still reach the old page.

`tools-make-deck.py` and the `body[data-deck="julie"]` rule in style.css:2583
stay. The deck is regenerable from the command in README.md:41, and that rule is
what a regenerated deck would need.

## Verification

`julie/`, `julie/admin.html`, and `julie/audience.html` all land on the homepage.

---

# Part 2: Shuffle toggle for the clue editor

## Problem

Clue pairs play in fixed list order. `setNextClue()` walks `nextClueCursor` down
`clues.json` and wraps, so every game opens with Cold/Hot, then Quiet/Loud, then
Cheap/Expensive. Groups that play more than once see the same opening every time.

## Goal

A checkbox in the clue editor's Game Options that draws clue pairs at random.
Shuffle is **on by default**, so existing installs start shuffling on their next
load and sequential order becomes the opt-in. The toggle takes effect on the
game already in progress, and in neither mode does a pair come up twice until
the whole deck has been played.

## Design

### Played-clue state

Today's no-repeat guarantee is implicit: a cursor walks the list, so everything
below it has been played. A toggle that flips mid-game breaks that, because
"below the cursor" stops meaning "already seen".

So `nextClueCursor` is replaced by `playedClueIndices`, a Set of clue indices.
`setNextClue()` builds the unplayed pool in ascending order and picks:

- `pool[0]` when sequential — the lowest unplayed index, identical to today
- a random element when shuffled

then marks that index played. An empty pool means the deck is exhausted, so the
set clears and a fresh pass begins.

Both modes read and write the same state, which is what makes the toggle safe to
flip in either direction: the pool never contains anything already played.

### Taking effect immediately

`isShuffleOn()` reads localStorage at call time rather than caching at load,
mirroring `isProgressShown()` (script.js:204), and is called inside
`setNextClue()`. The editor tab writes the key; the next clue the game draws
already reflects it. No BroadcastChannel message is needed.

### Storage

- Key: `wavelengthShuffleClues`, deck-namespaced via the existing `deckKey()`.
- Absent means on. Only an explicit `"false"` disables it, mirroring how
  `wavelengthShowProgress` treats absence and an explicit false.
- `saveGameState()` writes `playedClues` as an array.
- `loadGameState()` reads `playedClues`, falling back to deriving it from a
  legacy `nextClueCursor` (everything below the cursor was played) so games
  saved by the current version resume without replaying clues.
- Indices past the end of the clue list are pruned where script.js:1047 already
  guards `currentClueIndex`, so editing the deck mid-game cannot wedge the game.
- `resetGame()` clears the set.

### Editor

A third checkbox in the Game Options section of `admin.html`, using the existing
`admin-option` markup:

> **Shuffle the clue order** — Draw clue pairs at random instead of working down
> the list in order. Either way, a pair won't come up twice until every pair has
> been played.

`admin.js` gets a block mirroring the `showProgressToggle` handler
(admin.js:519): same try/catch, same `setStatus` feedback on change.

### Cache busting

Without this the service worker keeps serving the old JS:

- `script.js?v=76` -> `77` in `index.html`
- `admin.js?v=74` -> `75` in `admin.html`
- `CACHE_NAME` in `sw.js`, `v84` -> `v85`

## Out of scope

The game page gets no shuffle control or indicator. The two existing Game
Options are set in the editor and show up through behavior, and shuffle is
unobservable during play anyway — nothing distinguishes a clue drawn at random
from the same clue drawn in order. The side panel's Music button is a
during-play control; shuffle is a per-group setup decision.

## Accepted limitations

Played clues are tracked by index. Replacing the whole clue list mid-game leaves
stale indices, so some pairs may be skipped in the first pass after the swap.
Today's cursor has the same weakness, and tracking by clue text would bloat the
saved game state.

## Verification

No test framework and no build step. Verified by serving the site locally and
driving the real pages:

1. A fresh install shuffles, with no visit to the editor.
2. Unchecking the box gives sequential order: Cold/Hot, Quiet/Loud,
   Cheap/Expensive.
3. Shuffle produces a different order across two new games.
4. No repeats within a full pass, in either mode.
5. No repeats when the toggle is flipped mid-game, in either direction.
6. A game state saved by the current version resumes without replaying clues.
