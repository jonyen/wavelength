# Work through the deck instead of resampling it

## Problem

A group that plays every week keeps meeting clue pairs it has already seen, and
the deck feels stale long before its 101 pairs are used up.

The cause is not the size of the list. `resetGame()` clears `playedClueIndices`
(script.js:570) and every New Game calls it, so each session draws afresh from
all 101 pairs. Two fifteen-round sessions overlap by about `15 x 15/101`, or
roughly two pairs — a repeat or two every single time they play.

Adding pairs does not fix this. Doubling the list to 200 only halves the repeat
rate; the repeats keep happening because each session resamples the whole deck.

## Goal

A group works *through* the deck across sessions rather than resampling it, so
101 pairs becomes about seven fresh sessions before anything comes round again.

## Design

### Storage and lifetime

The played set moves out of `wavelengthGameState` into its own deck-namespaced
key, `wavelengthPlayedClues`. It now has a different lifetime from a game: it
outlives New Game, so storing it inside the game's saved state is wrong.

`resetGame()` no longer clears it.

This changes sequential play as well as shuffled. With shuffle off, a new game
continues down the list from where the last one stopped rather than restarting
at the first pair. That is the same intent — working through the deck — and it
removes the "every game opens with Cold/Hot" complaint for the sequential order
too.

The existing wrap behaviour is unchanged: when the pool empties, `pickClueIndex`
reports `wrapped` and the set clears, starting a fresh pass. The deck therefore
recovers on its own and never reaches a state where no clue can be drawn.

### Resetting and seeing what is left

Two additions to the editor's Game Options, beside the shuffle toggle. Settings
live in the editor rather than on the game page, matching the decision taken for
shuffle.

- A line reporting progress: "63 of 101 pairs not yet played."
- A "Start the deck over" button that clears the set.

The progress line is rendered whenever the editor loads and after any change
that clears or prunes the set, so it never reports a stale count.

### Changes to the clue list

Played clues are tracked by index, so replacing the list wholesale leaves
indices pointing at different pairs. This was an accepted limitation while the
set lived for one game. It is not acceptable now that the set persists for
weeks.

The set clears when the list is **replaced**:

- "Replace All With This" in the bulk paste box
- "Restore default pairs"
- loading a saved deck

It is left alone when the list is **edited** — adding a pair, editing one in
place, deleting one — because the indices still refer to the same pairs. The
existing pruning continues to drop indices past the end of a shortened list.

### Migration

A game saved with `playedClues` inside `wavelengthGameState` adopts that value
into the new key the first time it is read, so a group that is part-way through
the deck does not restart. The field stops being written to the game state.

Order matters: the standalone key wins when both are present, since it is the
newer source.

### Tests

The pure parts move to `logic.js` and are covered in `test/logic.test.js`:

- reading the standalone played set, including junk and absent values
- adopting the legacy in-game field, and preferring the standalone key when both
  exist
- the progress count against a list of a given size
- pruning after the list is shortened

The asset tests already cover the `?v=` bumps this change requires.

## Out of scope

**Themed decks.** Splitting the list into curated sets works against variety: it
makes someone choose before playing, and each smaller deck wraps sooner. Four
themed decks of 50 give a session less variety than one deck of 200. Themed
decks would earn their place for audience fit or occasion, which is not the goal
here.

**No game-page indicator.** As with shuffle, the game page gets no display of
deck progress. It is a between-sessions concern, not something to read mid-round.

## Follow-on: more pairs

A separate piece of work, valuable but strictly second. It compounds with this
change rather than competing: 200 pairs worked through gives about fourteen
fresh sessions.

The pairs should be written fresh in the register the existing list uses —
"Bad Nickname / Great Nickname", "Minor Inconvenience / Total Disaster" — rather
than transcribed from the retail game's cards. The site is already an unofficial
adaptation of a published game; the mechanic is not the publisher's to own, but
their actual card list is their content.

## Verification

1. Playing a game, pressing New Game, and playing again draws no pair twice.
2. The count in the editor falls as rounds are played.
3. "Start the deck over" restores the count to the full list.
4. Replacing the list resets the count; adding a single pair does not.
5. A game saved with the old in-state field resumes without repeating clues.
6. Playing past the end of the deck wraps into a fresh pass rather than stalling.
