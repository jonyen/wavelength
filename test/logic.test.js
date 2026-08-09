// Run with: node --test
//
// Covers logic.js, which is the part of the game that can be got wrong quietly:
// scoring bands, clue selection and its no-repeat guarantee, the migration of
// older saves, and the editor's parsers. Everything here is pure, so no browser
// and no dependencies are involved.
const test = require("node:test");
const assert = require("node:assert");
const L = require("../logic.js");

// --- Scoring ---------------------------------------------------------------

test("scoreForAngle awards the bull's-eye on an exact hit", () => {
    assert.equal(L.scoreForAngle(0, 0), 5);
    assert.equal(L.scoreForAngle(-30, -30), 5);
});

test("scoreForAngle bands are symmetric either side of the target", () => {
    for (const [offset, expected] of [[0, 5], [4.5, 5], [4.6, 3], [13.5, 3], [13.6, 1], [22.5, 1], [22.6, 0], [90, 0]]) {
        assert.equal(L.scoreForAngle(10 + offset, 10), expected, `+${offset}`);
        assert.equal(L.scoreForAngle(10 - offset, 10), expected, `-${offset}`);
    }
});

test("scoreForAngle scores a target at the edge of the dial", () => {
    assert.equal(L.scoreForAngle(90, 90), 5);
    assert.equal(L.scoreForAngle(-90, -90), 5);
    assert.equal(L.scoreForAngle(60, 90), 0);
});

// --- Clue selection --------------------------------------------------------

test("sequential play works down the list in order", () => {
    const played = new Set();
    const drawn = [];
    for (let i = 0; i < 5; i++) {
        const { index } = L.pickClueIndex(5, played, false);
        played.add(index);
        drawn.push(index);
    }
    assert.deepEqual(drawn, [0, 1, 2, 3, 4]);
});

test("a full pass uses every clue exactly once, in either order", () => {
    for (const shuffle of [false, true]) {
        const played = new Set();
        const drawn = [];
        for (let i = 0; i < 40; i++) {
            const { index } = L.pickClueIndex(40, played, shuffle);
            played.add(index);
            drawn.push(index);
        }
        assert.equal(new Set(drawn).size, 40, `shuffle=${shuffle}`);
        assert.deepEqual([...drawn].sort((a, b) => a - b), [...Array(40).keys()]);
    }
});

test("changing the order mid-pass never brings back a played clue", () => {
    // The reason the played set exists at all: a cursor would lose its meaning
    // the moment the order changed.
    for (const startShuffled of [false, true]) {
        const played = new Set();
        const drawn = [];
        let shuffle = startShuffled;
        for (let i = 0; i < 30; i++) {
            const { index } = L.pickClueIndex(30, played, shuffle);
            played.add(index);
            drawn.push(index);
            shuffle = !shuffle;
        }
        assert.equal(new Set(drawn).size, 30, `startShuffled=${startShuffled}`);
    }
});

test("the list wraps into a fresh pass once every clue is played", () => {
    const played = new Set([0, 1, 2]);
    const { index, wrapped } = L.pickClueIndex(3, played, false);
    assert.equal(wrapped, true);
    assert.equal(index, 0, "a fresh pass starts from the top again");
});

test("wrapping is not reported while clues remain", () => {
    const { wrapped } = L.pickClueIndex(3, new Set([0]), false);
    assert.equal(wrapped, false);
});

test("shuffled play draws only from unplayed clues", () => {
    // A random that always picks the last entry of the pool.
    const last = () => 0.999999;
    const played = new Set([0, 1, 2]);
    const { index } = L.pickClueIndex(5, played, true, last);
    assert.equal(index, 4);
    assert.ok(!played.has(index));
});

test("shuffled play with a stubbed random picks the expected pool entry", () => {
    const played = new Set([1, 3]);          // pool is [0, 2, 4]
    assert.equal(L.pickClueIndex(5, played, true, () => 0).index, 0);
    assert.equal(L.pickClueIndex(5, played, true, () => 0.5).index, 2);
    assert.equal(L.pickClueIndex(5, played, true, () => 0.9).index, 4);
});

test("an empty clue list yields no clue rather than throwing", () => {
    assert.deepEqual(L.pickClueIndex(0, new Set(), true), { index: -1, wrapped: false });
    assert.deepEqual(L.pickClueIndex(0, new Set(), false), { index: -1, wrapped: false });
});

test("unplayedIndices returns the pool in ascending order", () => {
    assert.deepEqual(L.unplayedIndices(6, new Set([1, 4])), [0, 2, 3, 5]);
    assert.deepEqual(L.unplayedIndices(3, new Set([0, 1, 2])), []);
});

// --- Saved state -----------------------------------------------------------

test("readPlayedClues reads the current format", () => {
    assert.deepEqual([...L.readPlayedClues({ playedClues: [3, 7, 7] })].sort(), [3, 7]);
});

test("readPlayedClues migrates a save that still holds a cursor", () => {
    // A cursor at 4 meant clues 0-3 had been played and 4 was next.
    const played = L.readPlayedClues({ nextClueCursor: 4 });
    assert.deepEqual([...played].sort(), [0, 1, 2, 3]);
    assert.ok(!played.has(4));
});

test("readPlayedClues prefers the current format over a leftover cursor", () => {
    assert.deepEqual([...L.readPlayedClues({ playedClues: [9], nextClueCursor: 40 })], [9]);
});

test("readPlayedClues ignores junk rather than throwing", () => {
    assert.equal(L.readPlayedClues({}).size, 0);
    assert.equal(L.readPlayedClues(null).size, 0);
    assert.equal(L.readPlayedClues({ playedClues: "nope" }).size, 0);
    assert.equal(L.readPlayedClues({ playedClues: [1, -2, 2.5, "x", null] }).size, 1);
});

test("prunePlayedClues drops indices a shortened list no longer has", () => {
    const played = L.prunePlayedClues(new Set([0, 3, 99]), 5);
    assert.deepEqual([...played].sort((a, b) => a - b), [0, 3]);
});

test("a pruned save still draws the clues that remain", () => {
    // The failure this guards: stale indices reserving slots so the pool empties
    // early and the game wraps after only a couple of rounds.
    const played = L.prunePlayedClues(new Set([7, 8, 9]), 3);
    const { index, wrapped } = L.pickClueIndex(3, played, false);
    assert.equal(wrapped, false);
    assert.equal(index, 0);
});

// --- Clue list validation --------------------------------------------------

test("isValidClueList accepts a proper list", () => {
    assert.equal(L.isValidClueList([["Cold", "Hot"], ["Quiet", "Loud"]]), true);
    assert.equal(L.isValidClueList([]), true, "an empty list is structurally valid");
});

test("isValidClueList rejects malformed lists", () => {
    for (const bad of [null, "nope", {}, [["only-one"]], [["a", "b", "c"]], [["a", ""]], [["  ", "b"]], [[1, 2]]]) {
        assert.equal(L.isValidClueList(bad), false, JSON.stringify(bad));
    }
});

// --- Bulk paste ------------------------------------------------------------

test("parseBulk reads each supported separator", () => {
    assert.deepEqual(L.parseBulk("Cold | Hot").pairs, [["Cold", "Hot"]]);
    assert.deepEqual(L.parseBulk("Cold\tHot").pairs, [["Cold", "Hot"]]);
    assert.deepEqual(L.parseBulk("Cold, Hot").pairs, [["Cold", "Hot"]]);
});

test("parseBulk skips blank lines and comments", () => {
    const { pairs, errors } = L.parseBulk("# a note\n\nCold | Hot\n\n# another\nQuiet | Loud\n");
    assert.deepEqual(pairs, [["Cold", "Hot"], ["Quiet", "Loud"]]);
    assert.deepEqual(errors, []);
});

test("parseBulk reports bad lines by number and keeps the good ones", () => {
    const { pairs, errors } = L.parseBulk("Cold | Hot\nno separator here\nQuiet | Loud");
    assert.deepEqual(pairs, [["Cold", "Hot"], ["Quiet", "Loud"]]);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /^Line 2:/);
});

test("parseBulk rejects a line whose two concepts are the same", () => {
    const { pairs, errors } = L.parseBulk("Hot | hot");
    assert.deepEqual(pairs, []);
    assert.match(errors[0], /both concepts are the same/);
});

test("parseBulk rejects a line with the wrong number of concepts", () => {
    const { errors } = L.parseBulk("a | b | c");
    assert.match(errors[0], /expected exactly two concepts, found 3/);
});

test("parseBulk accepts a JSON array", () => {
    const { pairs, errors } = L.parseBulk('[["Cold","Hot"],["Quiet","Loud"]]');
    assert.deepEqual(pairs, [["Cold", "Hot"], ["Quiet", "Loud"]]);
    assert.deepEqual(errors, []);
});

test("parseBulk explains malformed JSON instead of dropping it silently", () => {
    assert.match(L.parseBulk('[["Cold","Hot"]').errors[0], /could not be parsed/);
    assert.match(L.parseBulk('[1, 2, 3]').errors[0], /not a list of/);
});

test("parseBulk reports an empty box", () => {
    assert.match(L.parseBulk("   \n  ").errors[0], /empty/);
});

// --- Deck files ------------------------------------------------------------

test("readDeckFile round-trips the format the editor writes", () => {
    const file = JSON.stringify({ version: 1, decks: { Night: [["Cold", "Hot"]] } });
    assert.deepEqual(L.readDeckFile(file), { Night: [["Cold", "Hot"]] });
});

test("readDeckFile accepts a bare name-to-list object", () => {
    assert.deepEqual(L.readDeckFile('{"Solo":[["A","B"]]}'), { Solo: [["A", "B"]] });
});

test("readDeckFile skips unusable lists rather than failing the import", () => {
    const file = JSON.stringify({ Good: [["A", "B"]], Bad: "nope", "": [["A", "B"]], Worse: [["only"]] });
    assert.deepEqual(Object.keys(L.readDeckFile(file)), ["Good"]);
});

test("readDeckFile rejects something that is not a deck file", () => {
    assert.throws(() => L.readDeckFile("<html>"));
    assert.throws(() => L.readDeckFile("[1,2,3]"), /not a deck file/);
});

test("freeDeckName leaves an unused name alone", () => {
    assert.equal(L.freeDeckName({ Other: 1 }, "Night"), "Night");
});

test("freeDeckName suffixes rather than overwriting an existing deck", () => {
    assert.equal(L.freeDeckName({ Night: 1 }, "Night"), "Night (2)");
    assert.equal(L.freeDeckName({ Night: 1, "Night (2)": 1 }, "Night"), "Night (3)");
});

// --- Rounds ----------------------------------------------------------------

test("clampRounds holds a value inside the playable range", () => {
    assert.equal(L.clampRounds(10, 1, 99, 10), 10);
    assert.equal(L.clampRounds(0, 1, 99, 10), 1);
    assert.equal(L.clampRounds(500, 1, 99, 10), 99);
});

test("clampRounds falls back when the value is not a number", () => {
    assert.equal(L.clampRounds(NaN, 1, 99, 10), 10);
    assert.equal(L.clampRounds(Infinity, 1, 99, 11), 11);
});

// --- Result copy -----------------------------------------------------------

test("points pluralises", () => {
    assert.equal(L.points(1), "1 point");
    assert.equal(L.points(0), "0 points");
    assert.equal(L.points(5), "5 points");
});

test("listNames reads as a sentence", () => {
    assert.equal(L.listNames(["Blue"]), "Blue");
    assert.equal(L.listNames(["Blue", "Red"]), "Blue and Red");
    assert.equal(L.listNames(["Blue", "Red", "Green"]), "Blue, Red and Green");
});

test("possessive handles names ending in s", () => {
    assert.equal(L.possessive("Blue"), "Blue's");
    assert.equal(L.possessive("Chris"), "Chris'");
    assert.equal(L.possessive("JAMES"), "JAMES'");
});

test("winnerText names an outright winner", () => {
    assert.equal(
        L.winnerText([{ name: "Blue", score: 12 }, { name: "Red", score: 7 }]),
        "Blue wins with 12 points!"
    );
});

test("winnerText calls a tie between some teams", () => {
    assert.equal(
        L.winnerText([{ name: "Blue", score: 9 }, { name: "Red", score: 9 }, { name: "Green", score: 2 }]),
        "It's a tie — Blue and Red on 9 points"
    );
});

test("winnerText calls a dead heat when everyone is level", () => {
    assert.equal(
        L.winnerText([{ name: "Blue", score: 4 }, { name: "Red", score: 4 }]),
        "Dead heat — everyone on 4 points"
    );
});

test("winnerText handles a single team", () => {
    assert.equal(L.winnerText([{ name: "Blue", score: 6 }]), "Blue finished with 6 points");
});

test("winnerText handles nobody scoring", () => {
    assert.equal(L.winnerText([{ name: "Blue", score: 0 }, { name: "Red", score: 0 }]), "Nobody scored a single point");
});
