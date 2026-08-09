# Shuffle toggle for the clue editor

## Problem

Clue pairs play in fixed list order. `setNextClue()` walks `nextClueCursor` down
`clues.json` and wraps, so every game opens with Cold/Hot, then Quiet/Loud, then
Cheap/Expensive. Groups that play more than once see the same opening every time.

## Goal

A checkbox in the clue editor's Game Options that draws clue pairs at random.
It takes effect on the game already in progress, and in neither mode does a pair
come up twice until the whole deck has been played.

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
- Absent falls back to the deck's default (see Per-deck default below). Only an
  explicit `"false"` disables it, matching how `wavelengthShowProgress` treats
  an explicit false.
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

## Per-deck default

`script.js` is shared by both decks, so a bare "absent means on" would silently
shuffle the `julie/` deck too, with no checkbox anywhere to disable it. The deck
already declares its own defaults on `<body>` (`data-default-rounds="11"`), so
shuffle follows that idiom:

```js
const DEFAULT_SHUFFLE = document.body.dataset.defaultShuffle !== "false";

function isShuffleOn() {
    try {
        const stored = localStorage.getItem(SHUFFLE_CLUES_KEY);
        return stored === null ? DEFAULT_SHUFFLE : stored !== "false";
    } catch (error) {
        return DEFAULT_SHUFFLE;
    }
}
```

`julie/index.html` gets `data-default-shuffle="false"` on its `<body>`, keeping
that deck on sequential order. The main deck declares nothing and so defaults to
shuffle. `admin.js` reads the same attribute to set the checkbox's initial state.

## Out of scope

`julie/admin.html` does not get the checkbox. That deck stays sequential via the
attribute above, and its namespaced key is never written.

## Accepted limitations

Played clues are tracked by index. Replacing the whole clue list mid-game leaves
stale indices, so some pairs may be skipped in the first pass after the swap.
Today's cursor has the same weakness, and tracking by clue text would bloat the
saved game state.

## Verification

No test framework and no build step. Verified by serving the site locally and
driving the real pages:

1. Sequential mode still opens Cold/Hot, Quiet/Loud, Cheap/Expensive.
2. Shuffle mode produces a different order across two new games.
3. No repeats within a full pass, in either mode.
4. No repeats when the toggle is flipped mid-game, in either direction.
5. A game state saved by the current version resumes without replaying clues.
6. The `julie/` deck still plays in sequential order.
