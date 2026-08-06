// Clue editor. Reads and writes the same localStorage key the game reads, so
// changes take effect on the next round without a rebuild. This device only.
const CUSTOM_CLUES_KEY = "wavelengthCustomClues";

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
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (!isValidClueList(parsed)) {
            setStatus("Saved pairs were in an unexpected format and were ignored.", "error");
            return [];
        }
        return parsed;
    } catch (error) {
        setStatus("Saved pairs could not be read and were ignored.", "error");
        return [];
    }
}

function save() {
    try {
        localStorage.setItem(CUSTOM_CLUES_KEY, JSON.stringify(pairs));
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

pairs = load();
render();
