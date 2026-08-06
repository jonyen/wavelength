// Clue editor. Reads and writes the same localStorage key the game reads, so
// changes take effect on the next round without a rebuild. This device only.
// Matches the deck namespacing in script.js, so /juliekwak/admin.html edits the
// Julie deck rather than the default one.
const DECK = document.body.dataset.deck || "";
const deckKey = (name) => (DECK ? name + ":" + DECK : name);

const CUSTOM_CLUES_KEY = deckKey("wavelengthCustomClues");

const pairList = document.getElementById("pairList");
const emptyMessage = document.getElementById("emptyMessage");
const pairCountHeading = document.getElementById("pairCountHeading");
const addPairForm = document.getElementById("addPairForm");
const newLeftInput = document.getElementById("newLeft");
const newRightInput = document.getElementById("newRight");
const clearAllButton = document.getElementById("clearAllButton");
const adminStatus = document.getElementById("adminStatus");

let pairs = [];
let clearAllArmed = false;
// True while the editor is showing the shipped clues.json rather than a list
// saved in this browser. The first edit saves and flips this to false.
let usingDefaults = false;

function isValidClueList(value) {
    return Array.isArray(value) && value.every((pair) =>
        Array.isArray(pair) &&
        pair.length === 2 &&
        typeof pair[0] === "string" && pair[0].trim() !== "" &&
        typeof pair[1] === "string" && pair[1].trim() !== ""
    );
}

function setStatus(message, kind) {
    adminStatus.textContent = message;
    adminStatus.className = "admin-status" + (kind ? " admin-status--" + kind : "");
    if (message) {
        clearTimeout(setStatus.timer);
        setStatus.timer = setTimeout(() => {
            adminStatus.textContent = "";
            adminStatus.className = "admin-status";
        }, 4000);
    }
}

function load() {
    let raw;
    try {
        raw = localStorage.getItem(CUSTOM_CLUES_KEY);
    } catch (error) {
        setStatus("This browser is blocking local storage, so pairs cannot be saved.", "error");
        return [];
    }
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        if (!isValidClueList(parsed)) {
            setStatus("Saved pairs were in an unexpected format and were ignored.", "error");
            return null;
        }
        return parsed;
    } catch (error) {
        setStatus("Saved pairs could not be read and were ignored.", "error");
        return null;
    }
}

// The list the game falls back to when this browser has none of its own.
async function loadShippedDefaults() {
    try {
        const response = await fetch("clues.json", { cache: "no-cache" });
        if (!response.ok) throw new Error("HTTP " + response.status);
        const parsed = await response.json();
        return isValidClueList(parsed) ? parsed : [];
    } catch (error) {
        console.error("Could not read the default clue list:", error);
        return [];
    }
}

function save() {
    try {
        localStorage.setItem(CUSTOM_CLUES_KEY, JSON.stringify(pairs));
        usingDefaults = false;
        updateSourceNote();
        return true;
    } catch (error) {
        setStatus("Could not save. This browser may be out of storage or in private mode.", "error");
        return false;
    }
}

function isDuplicate(left, right, ignoreIndex) {
    const a = left.trim().toLowerCase();
    const b = right.trim().toLowerCase();
    return pairs.some((pair, index) =>
        index !== ignoreIndex &&
        pair[0].trim().toLowerCase() === a &&
        pair[1].trim().toLowerCase() === b
    );
}

let restoreArmed = false;

function disarmRestore() {
    const restoreButton = document.getElementById("restoreDefaultsButton");
    if (!restoreArmed || !restoreButton) return;
    restoreArmed = false;
    restoreButton.textContent = "Restore default pairs";
}

function disarmClearAll() {
    if (!clearAllArmed) return;
    clearAllArmed = false;
    clearAllButton.textContent = "Delete All Pairs";
    clearAllButton.classList.remove("admin-danger--armed");
}

function makeButton(label, className, title, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.className = className;
    button.title = title;
    button.setAttribute("aria-label", title);
    button.addEventListener("click", onClick);
    return button;
}

function makeSideInput(index, side) {
    const input = document.createElement("input");
    input.type = "text";
    input.value = pairs[index][side];
    input.maxLength = 60;
    input.className = "admin-pair-input";
    input.setAttribute("aria-label", (side === 0 ? "Left" : "Right") + " concept for pair " + (index + 1));

    input.addEventListener("change", () => {
        const value = input.value.trim();
        if (value === "") {
            input.value = pairs[index][side];
            setStatus("A concept cannot be empty. Delete the pair instead.", "error");
            return;
        }
        pairs[index][side] = value;
        input.value = value;
        if (save()) setStatus("Saved.", "ok");
    });

    return input;
}

function updateSourceNote() {
    const note = document.getElementById("clueSourceNote");
    const restoreButton = document.getElementById("restoreDefaultsButton");
    if (!note) return;

    note.textContent = usingDefaults
        ? "Showing the default pairs that ship with the game. Editing any of them saves a copy to this browser."
        : "Saved in this browser. These override the defaults and persist until you clear this site's data.";
    note.className = "admin-source-note" + (usingDefaults ? " admin-source-note--default" : "");
    if (restoreButton) restoreButton.style.display = usingDefaults ? "none" : "inline-flex";
}

function render() {
    pairList.textContent = "";

    pairCountHeading.textContent = pairs.length === 1
        ? "Clue Pairs (1)"
        : "Clue Pairs (" + pairs.length + ")";
    emptyMessage.style.display = pairs.length === 0 ? "block" : "none";
    clearAllButton.disabled = pairs.length === 0;

    pairs.forEach((pair, index) => {
        const item = document.createElement("li");
        item.className = "admin-pair";

        const fields = document.createElement("div");
        fields.className = "admin-pair-fields";
        fields.appendChild(makeSideInput(index, 0));

        const arrow = document.createElement("span");
        arrow.className = "admin-arrow";
        arrow.textContent = "↔";
        arrow.setAttribute("aria-hidden", "true");
        fields.appendChild(arrow);

        fields.appendChild(makeSideInput(index, 1));
        item.appendChild(fields);

        const controls = document.createElement("div");
        controls.className = "admin-pair-controls";

        const upButton = makeButton("↑", "admin-icon-button", "Move pair " + (index + 1) + " up", () => {
            if (index === 0) return;
            [pairs[index - 1], pairs[index]] = [pairs[index], pairs[index - 1]];
            if (save()) render();
        });
        upButton.disabled = index === 0;
        controls.appendChild(upButton);

        const downButton = makeButton("↓", "admin-icon-button", "Move pair " + (index + 1) + " down", () => {
            if (index === pairs.length - 1) return;
            [pairs[index + 1], pairs[index]] = [pairs[index], pairs[index + 1]];
            if (save()) render();
        });
        downButton.disabled = index === pairs.length - 1;
        controls.appendChild(downButton);

        controls.appendChild(makeButton("✕", "admin-icon-button admin-icon-button--danger", "Delete pair " + (index + 1), () => {
            const removed = pairs.splice(index, 1)[0];
            if (save()) {
                render();
                setStatus("Deleted “" + removed[0] + " ↔ " + removed[1] + "”.", "ok");
            }
        }));

        item.appendChild(controls);
        pairList.appendChild(item);
    });
}

addPairForm.addEventListener("submit", (event) => {
    event.preventDefault();
    disarmClearAll();

    const left = newLeftInput.value.trim();
    const right = newRightInput.value.trim();

    if (left === "" || right === "") {
        setStatus("Both concepts are required.", "error");
        return;
    }
    if (left.toLowerCase() === right.toLowerCase()) {
        setStatus("The two concepts need to be different.", "error");
        return;
    }
    if (isDuplicate(left, right, -1)) {
        setStatus("That pair is already in the list.", "error");
        return;
    }

    pairs.push([left, right]);
    if (!save()) return;

    render();
    setStatus("Added “" + left + " ↔ " + right + "”.", "ok");
    newLeftInput.value = "";
    newRightInput.value = "";
    newLeftInput.focus();
});

// Two-step delete rather than a confirm() dialog, which blocks the page.
clearAllButton.addEventListener("click", () => {
    if (!clearAllArmed) {
        clearAllArmed = true;
        clearAllButton.textContent = "Really delete all " + pairs.length + "? Click again";
        clearAllButton.classList.add("admin-danger--armed");
        setTimeout(disarmClearAll, 5000);
        return;
    }
    const count = pairs.length;
    pairs = [];
    disarmClearAll();
    if (save()) {
        render();
        setStatus("Deleted all " + count + " pairs.", "ok");
    }
});

// --- Bulk paste ---------------------------------------------------------

const bulkText = document.getElementById("bulkText");
const bulkReplaceButton = document.getElementById("bulkReplaceButton");
const bulkAppendButton = document.getElementById("bulkAppendButton");
const bulkLoadButton = document.getElementById("bulkLoadButton");

// Returns {pairs, errors}. Accepts a JSON array of pairs, or one pair per line
// separated by "|", a tab, or a comma.
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

function reportBulkErrors(errors) {
    const shown = errors.slice(0, 3).join(" ");
    const more = errors.length > 3 ? " (+" + (errors.length - 3) + " more)" : "";
    setStatus(shown + more, "error");
}

function applyBulk(mode) {
    disarmClearAll();
    const { pairs: parsed, errors } = parseBulk(bulkText.value);

    if (parsed.length === 0) {
        reportBulkErrors(errors.length ? errors : ["No usable pairs found."]);
        return;
    }

    let added = 0;
    let skipped = 0;

    if (mode === "replace") {
        const deduped = [];
        parsed.forEach((pair) => {
            const clash = deduped.some((existing) =>
                existing[0].toLowerCase() === pair[0].toLowerCase() &&
                existing[1].toLowerCase() === pair[1].toLowerCase()
            );
            if (clash) skipped++;
            else deduped.push(pair);
        });
        pairs = deduped;
        added = deduped.length;
    } else {
        parsed.forEach((pair) => {
            if (isDuplicate(pair[0], pair[1], -1)) skipped++;
            else {
                pairs.push(pair);
                added++;
            }
        });
    }

    if (!save()) return;
    render();

    let message = mode === "replace"
        ? "Replaced the list with " + added + " pairs."
        : "Added " + added + " pairs.";
    if (skipped > 0) message += " Skipped " + skipped + " duplicate" + (skipped === 1 ? "" : "s") + ".";
    if (errors.length > 0) message += " " + errors.length + " line" + (errors.length === 1 ? "" : "s") + " could not be read.";
    setStatus(message, errors.length > 0 ? "error" : "ok");
}

bulkReplaceButton.addEventListener("click", () => applyBulk("replace"));
bulkAppendButton.addEventListener("click", () => applyBulk("append"));
bulkLoadButton.addEventListener("click", () => {
    bulkText.value = pairs.map((pair) => pair[0] + " | " + pair[1]).join("\n");
    setStatus(pairs.length === 0 ? "The list is empty." : "Loaded " + pairs.length + " pairs into the box.", "ok");
});


// --- Saved decks ----------------------------------------------------------
// A deck is a named copy of the clue list held in this browser. Distinct from
// the path decks (/julie), which ship as files. Loading a deck makes it the
// list the game plays.
const DECKS_KEY = deckKey("wavelengthDecks");

function readDecks() {
    try {
        const raw = localStorage.getItem(DECKS_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        // Drop anything that is not a usable clue list rather than trusting it.
        return Object.fromEntries(
            Object.entries(parsed).filter(([, list]) => isValidClueList(list))
        );
    } catch (error) {
        console.error("Saved decks could not be read:", error);
        return {};
    }
}

function writeDecks(decks) {
    try {
        localStorage.setItem(DECKS_KEY, JSON.stringify(decks));
        return true;
    } catch (error) {
        setStatus("Could not save the deck. This browser may be out of storage.", "error");
        return false;
    }
}

let deckDeleteArmed = null;

function renderDecks() {
    const list = document.getElementById("deckList");
    const empty = document.getElementById("deckEmpty");
    if (!list) return;

    const decks = readDecks();
    const names = Object.keys(decks).sort((a, b) => a.localeCompare(b));

    list.textContent = "";
    empty.style.display = names.length === 0 ? "block" : "none";

    names.forEach((name) => {
        const item = document.createElement("li");
        item.className = "admin-deck";

        const label = document.createElement("span");
        label.className = "admin-deck-name";
        label.textContent = name;

        const count = document.createElement("span");
        count.className = "admin-deck-count";
        count.textContent = decks[name].length + (decks[name].length === 1 ? " pair" : " pairs");

        const loadButton = document.createElement("button");
        loadButton.type = "button";
        loadButton.textContent = "Load";
        loadButton.className = "admin-deck-button";
        loadButton.addEventListener("click", () => {
            pairs = decks[name].map((pair) => [pair[0], pair[1]]);
            if (!save()) return;
            render();
            setStatus(`Loaded “${name}”. The game will use it.`, "ok");
        });

        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "admin-deck-button admin-deck-button--danger";
        deleteButton.textContent = "Delete";
        deleteButton.addEventListener("click", () => {
            if (deckDeleteArmed !== name) {
                deckDeleteArmed = name;
                deleteButton.textContent = "Really delete?";
                setTimeout(() => {
                    if (deckDeleteArmed === name) {
                        deckDeleteArmed = null;
                        renderDecks();
                    }
                }, 5000);
                return;
            }
            deckDeleteArmed = null;
            const current = readDecks();
            delete current[name];
            if (!writeDecks(current)) return;
            renderDecks();
            setStatus(`Deleted the deck “${name}”.`, "ok");
        });

        item.append(label, count, loadButton, deleteButton);
        list.appendChild(item);
    });
}

const saveDeckForm = document.getElementById("saveDeckForm");
const deckNameInput = document.getElementById("deckNameInput");

if (saveDeckForm) {
    saveDeckForm.addEventListener("submit", (event) => {
        event.preventDefault();
        const name = deckNameInput.value.trim();

        if (name === "") {
            setStatus("Give the deck a name.", "error");
            return;
        }
        if (pairs.length === 0) {
            setStatus("There are no pairs to save.", "error");
            return;
        }

        const decks = readDecks();
        const replacing = Object.prototype.hasOwnProperty.call(decks, name);
        decks[name] = pairs.map((pair) => [pair[0], pair[1]]);
        if (!writeDecks(decks)) return;

        renderDecks();
        deckNameInput.value = "";
        setStatus(
            replacing
                ? `Replaced “${name}” with the current ${pairs.length} pairs.`
                : `Saved “${name}” with ${pairs.length} pairs.`,
            "ok"
        );
    });
}

// --- Game options ---------------------------------------------------------
// Read by the game on load; see isProgressShown() in script.js.
const SHOW_PROGRESS_KEY = deckKey("wavelengthShowProgress");
const showProgressToggle = document.getElementById("showProgressToggle");

if (showProgressToggle) {
    let stored = null;
    try {
        stored = localStorage.getItem(SHOW_PROGRESS_KEY);
    } catch (error) {
        /* Fall through to the default. */
    }
    // Absent means shown; only an explicit "false" hides it.
    showProgressToggle.checked = stored !== "false";

    showProgressToggle.addEventListener("change", () => {
        try {
            localStorage.setItem(SHOW_PROGRESS_KEY, showProgressToggle.checked ? "true" : "false");
            setStatus(showProgressToggle.checked
                ? "Progress bar will show in the game."
                : "Progress bar hidden. The game runs without a round limit.", "ok");
        } catch (error) {
            setStatus("Could not save that setting.", "error");
        }
    });
}

// Rounds per game. The game clamps whatever it reads, so an out-of-range value
// here cannot break it.
const TOTAL_ROUNDS_KEY = deckKey("wavelengthTotalRounds");
const MIN_TOTAL_ROUNDS = 1;
const MAX_TOTAL_ROUNDS = 99;
// Must match script.js: a deck can set its own default on <body>. Hardcoding 10
// here meant the editor showed 10 for a deck defaulting to 11, and writing that
// value back overrode the deck's default.
const DEFAULT_TOTAL_ROUNDS = parseInt(document.body.dataset.defaultRounds, 10) || 10;
const totalRoundsInput = document.getElementById("totalRoundsInput");

if (totalRoundsInput) {
    let storedRounds = DEFAULT_TOTAL_ROUNDS;
    try {
        const raw = parseInt(localStorage.getItem(TOTAL_ROUNDS_KEY), 10);
        if (!Number.isNaN(raw)) storedRounds = raw;
    } catch (error) {
        /* Fall through to the default. */
    }
    totalRoundsInput.value = String(clampRounds(storedRounds));

    totalRoundsInput.addEventListener("change", () => {
        const value = clampRounds(parseInt(totalRoundsInput.value, 10));
        totalRoundsInput.value = String(value);
        try {
            localStorage.setItem(TOTAL_ROUNDS_KEY, String(value));
            setStatus(`Games now run for ${value} round${value === 1 ? "" : "s"}.`, "ok");
        } catch (error) {
            setStatus("Could not save that setting.", "error");
        }
    });
}

function clampRounds(value) {
    if (Number.isNaN(value)) return DEFAULT_TOTAL_ROUNDS;
    return Math.min(MAX_TOTAL_ROUNDS, Math.max(MIN_TOTAL_ROUNDS, value));
}

(async function start() {
    const stored = load();
    if (stored) {
        pairs = stored;
        usingDefaults = false;
    } else {
        pairs = await loadShippedDefaults();
        usingDefaults = true;
    }
    updateSourceNote();
    render();
    renderDecks();

    const restoreButton = document.getElementById("restoreDefaultsButton");
    if (restoreButton) {
        restoreButton.addEventListener("click", async () => {
            if (!restoreArmed) {
                restoreArmed = true;
                restoreButton.textContent = "Discard my list and restore defaults?";
                setTimeout(disarmRestore, 5000);
                return;
            }
            disarmRestore();
            try {
                localStorage.removeItem(CUSTOM_CLUES_KEY);
            } catch (error) {
                setStatus("Could not clear the saved list.", "error");
                return;
            }
            pairs = await loadShippedDefaults();
            usingDefaults = true;
            updateSourceNote();
            render();
            setStatus(`Restored the ${pairs.length} default pairs.`, "ok");
        });
    }
})();
