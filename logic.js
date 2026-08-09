// The game's pure logic: scoring, clue selection, deck parsing, and the copy
// that depends only on its arguments. Nothing here touches the DOM, storage, or
// a global, so it can be exercised by the tests in test/ without a browser.
//
// Loaded as a plain script in the browser (window.WavelengthLogic) and required
// by Node in the tests, so the site keeps its no-build-step property.
(function (root, factory) {
    "use strict";
    const api = factory();
    root.WavelengthLogic = api;
    if (typeof module === "object" && module !== null && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    // --- Clue lists --------------------------------------------------------

    // A clue list is an array of [left, right] pairs of non-blank strings.
    // Used by the game when reading storage and by the editor when importing,
    // which is why it lives here rather than being written out twice.
    function isValidClueList(value) {
        return Array.isArray(value) && value.every((pair) =>
            Array.isArray(pair) &&
            pair.length === 2 &&
            typeof pair[0] === "string" && pair[0].trim() !== "" &&
            typeof pair[1] === "string" && pair[1].trim() !== ""
        );
    }

    // Reads the editor's paste box: one pair per line separated by a pipe, tab,
    // or comma, with # for comments. A JSON array is accepted too. Bad lines
    // are reported by line number rather than silently dropped, so a typo in a
    // sixty-line paste is findable.
    function parseBulk(text) {
        const trimmed = text.trim();
        if (trimmed === "") return { pairs: [], errors: ["Nothing to read — the box is empty."] };

        if (trimmed.startsWith("[")) {
            try {
                const parsed = JSON.parse(trimmed);
                if (isValidClueList(parsed)) {
                    return { pairs: parsed.map((pair) => [pair[0].trim(), pair[1].trim()]), errors: [] };
                }
                return { pairs: [], errors: ["That JSON is not a list of [\"left\", \"right\"] string pairs."] };
            } catch (error) {
                return { pairs: [], errors: ["That looks like JSON but could not be parsed: " + error.message] };
            }
        }

        const result = [];
        const errors = [];

        text.split(/\r?\n/).forEach((line, lineIndex) => {
            const raw = line.trim();
            if (raw === "" || raw.startsWith("#")) return;

            let parts;
            if (raw.includes("|")) parts = raw.split("|");
            else if (raw.includes("\t")) parts = raw.split("\t");
            else if (raw.includes(",")) parts = raw.split(",");
            else {
                errors.push("Line " + (lineIndex + 1) + ": no separator found in “" + raw + "”.");
                return;
            }

            parts = parts.map((part) => part.trim()).filter((part) => part !== "");
            if (parts.length !== 2) {
                errors.push("Line " + (lineIndex + 1) + ": expected exactly two concepts, found " + parts.length + ".");
                return;
            }
            if (parts[0].toLowerCase() === parts[1].toLowerCase()) {
                errors.push("Line " + (lineIndex + 1) + ": both concepts are the same.");
                return;
            }
            result.push([parts[0], parts[1]]);
        });

        return { pairs: result, errors };
    }

    // --- Clue selection ----------------------------------------------------

    // Ascending, so the first entry is the lowest unplayed index and sequential
    // play works down the list.
    function unplayedIndices(count, played) {
        const pool = [];
        for (let i = 0; i < count; i++) {
            if (!played.has(i)) pool.push(i);
        }
        return pool;
    }

    // Picks the next clue and reports whether the list wrapped. Both orders draw
    // from the pairs not yet played, so nothing repeats until every pair has been
    // used and changing the order mid-game cannot bring back a played pair.
    // `random` is injected so the tests can make shuffled play deterministic.
    function pickClueIndex(count, played, shuffle, random) {
        if (count <= 0) return { index: -1, wrapped: false };

        let pool = unplayedIndices(count, played);
        let wrapped = false;
        if (pool.length === 0) {
            wrapped = true;
            pool = unplayedIndices(count, new Set());
        }

        const roll = typeof random === "function" ? random : Math.random;
        const index = shuffle ? pool[Math.floor(roll() * pool.length)] : pool[0];
        return { index: index, wrapped: wrapped };
    }

    // Saves written before the shuffle setting existed tracked a cursor rather
    // than a set: everything below it had been played. Reading those forward
    // keeps an in-progress game from repeating clues after an update.
    function readPlayedClues(state) {
        const played = new Set();
        if (!state || typeof state !== "object") return played;

        if (Array.isArray(state.playedClues)) {
            state.playedClues.forEach((index) => {
                if (Number.isInteger(index) && index >= 0) played.add(index);
            });
        } else if (typeof state.nextClueCursor === "number") {
            for (let i = 0; i < state.nextClueCursor; i++) played.add(i);
        }
        return played;
    }

    // Indices past the end of a shortened list would otherwise reserve slots the
    // list no longer has, shrinking the pool for the rest of the game.
    function prunePlayedClues(played, count) {
        played.forEach((index) => {
            if (index >= count) played.delete(index);
        });
        return played;
    }

    // --- Scoring -----------------------------------------------------------

    // Concentric bands either side of the target: the bull's-eye is 5, then 3,
    // then 1, and anything wider misses.
    function scoreForAngle(angle, targetAngle) {
        const diff = Math.abs(angle - targetAngle);
        if (diff <= 4.5) return 5;
        if (diff <= 13.5) return 3;
        if (diff <= 22.5) return 1;
        return 0;
    }

    // --- Copy --------------------------------------------------------------

    function points(count) {
        return `${count} point${count === 1 ? "" : "s"}`;
    }

    function listNames(names) {
        if (names.length === 1) return names[0];
        const rest = names.slice(0, -1);
        return `${rest.join(", ")} and ${names[names.length - 1]}`;
    }

    function possessive(name) {
        return name.endsWith("s") || name.endsWith("S") ? `${name}'` : `${name}'s`;
    }

    function winnerText(teams) {
        const best = Math.max(...teams.map((team) => team.score));
        const leaders = teams.filter((team) => team.score === best);

        if (best === 0) return "Nobody scored a single point";
        if (teams.length === 1) return `${teams[0].name} finished with ${points(best)}`;
        if (leaders.length === teams.length) return `Dead heat — everyone on ${points(best)}`;
        if (leaders.length > 1) {
            return `It's a tie — ${listNames(leaders.map((team) => team.name))} on ${points(best)}`;
        }
        return `${leaders[0].name} wins with ${points(best)}!`;
    }

    // --- Rounds ------------------------------------------------------------

    // The game clamps whatever it reads, so a value edited by hand in storage
    // or typed into the editor cannot put the game into an unplayable state.
    function clampRounds(value, min, max, fallback) {
        if (!Number.isFinite(value)) return fallback;
        return Math.min(max, Math.max(min, Math.round(value)));
    }

    // --- Deck files --------------------------------------------------------

    // Accepts either the file the editor writes or a bare name-to-list object,
    // so a hand-written file works. Unusable lists are skipped rather than
    // failing the whole import.
    function readDeckFile(text) {
        const parsed = JSON.parse(text);
        const source = parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed.decks && typeof parsed.decks === "object" ? parsed.decks : parsed)
            : null;
        if (!source) throw new Error("not a deck file");

        const decks = {};
        Object.entries(source).forEach(([name, list]) => {
            if (typeof name === "string" && name.trim() !== "" && isValidClueList(list)) {
                decks[name.trim()] = list.map((pair) => [pair[0], pair[1]]);
            }
        });
        return decks;
    }

    // An imported name that is already taken gets a suffix. Overwriting silently
    // would lose a deck someone spent real time typing, and there is no undo.
    function freeDeckName(taken, name) {
        if (!Object.prototype.hasOwnProperty.call(taken, name)) return name;
        for (let n = 2; ; n++) {
            const candidate = `${name} (${n})`;
            if (!Object.prototype.hasOwnProperty.call(taken, candidate)) return candidate;
        }
    }

    return {
        isValidClueList,
        parseBulk,
        unplayedIndices,
        pickClueIndex,
        readPlayedClues,
        prunePlayedClues,
        scoreForAngle,
        points,
        listNames,
        possessive,
        winnerText,
        clampRounds,
        readDeckFile,
        freeDeckName
    };
});
