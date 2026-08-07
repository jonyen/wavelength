// A deck is a self-contained copy of the game living at its own path, e.g.
// /juliekwak. Its name comes from data-deck on <body>, and it namespaces every
// stored value so decks do not share clues, scores, or round settings. Audio
// preferences stay global on purpose.
const DECK = document.body.dataset.deck || "";
const deckKey = (name) => (DECK ? name + ":" + DECK : name);

const needleContainer = document.getElementById("needleContainer");
const needle = document.getElementById("needle");
const targetArea = document.getElementById("targetArea");
const board = document.querySelector(".board");
const toggleButton = document.getElementById("toggleButton");
const nextRoundButton = document.getElementById("nextRoundButton");
const skipQuestionButton = document.getElementById("skipQuestionButton");
const newGameButton = document.getElementById("newGameButton");
const cluesElement = document.getElementById("clues");
const scoreElement = document.getElementById("score");
const totalScoreElement = document.getElementById("totalScore");
const turnIndicator = document.getElementById("turn-indicator");
const revealOverlay = document.getElementById("revealOverlay"); // New: Tap to Reveal Overlay
const psychicInfoBalloon = document.getElementById("psychic-info-balloon"); // New: Psychic Info Balloon

// Modal declarations - ensure modal is declared before its close button


const changeLogModal = document.getElementById("changeLogModal");
const changeLogCloseButton = changeLogModal.querySelector(".close-button");

let isDragging = false;
let targetAngle = 0;
let isTargetVisible = true;
let totalScore = 0;
let canMoveNeedle = false;
let isPostGuessPhase = false;
// The points awarded in the round just played, so the message survives a
// reload. Reconstructing it from the angles is not possible: the needle angle
// is not persisted.
// Position in the clue list. The list is played in order and wraps.
let nextClueCursor = 0;
let lastRoundScore = 0;
let lastRoundWasPractice = false;
// The flavour line for the round just played. Chosen once and persisted so a
// reload does not silently reword the result.
let lastRoundMessage = "";

// Keyed by the points scored. Zero gets its own set: landing nowhere near the
// target is the funniest outcome in the game and deserves better than silence.
const RESULT_MESSAGES = {
    5: [
        "Bull's-eye. Straight down the middle.",
        "Perfect read — you two share a brain.",
        "Dead center. Telepathy confirmed."
    ],
    3: [
        "Close. Just off the center.",
        "Good read, a hair to one side.",
        "Nearly had it."
    ],
    1: [
        "Caught the very edge of the target.",
        "Grazed it. Points are points.",
        "Scraped the outer band."
    ],
    0: [
        "Nowhere near. Somebody explain that clue.",
        "Completely off the mark. Not a single point.",
        "Missed entirely. Different wavelengths today.",
        "Nothing. Let us never speak of this round again."
    ]
};


// One reusable confirmation dialog, resolving true when the user confirms. An
// in-page modal rather than confirm(), which blocks the whole page while open.
function askConfirm({ title, body, confirmLabel, cancelLabel = "Cancel" }) {
    const modal = document.getElementById("confirmModal");
    if (!modal) return Promise.resolve(true);

    const okButton = document.getElementById("confirmOkButton");
    const cancelButton = document.getElementById("confirmCancelButton");
    document.getElementById("confirmTitle").textContent = title;
    document.getElementById("confirmBody").textContent = body;
    okButton.textContent = confirmLabel;
    cancelButton.textContent = cancelLabel;

    modal.style.display = "block";
    setTimeout(() => modal.classList.add("show"), 10);
    okButton.focus();

    return new Promise((resolve) => {
        const finish = (result) => {
            modal.classList.remove("show");
            setTimeout(() => { modal.style.display = "none"; }, 300);
            okButton.removeEventListener("click", onOk);
            cancelButton.removeEventListener("click", onCancel);
            modal.removeEventListener("click", onBackdrop);
            document.removeEventListener("keydown", onKey);
            resolve(result);
        };
        const onOk = () => finish(true);
        const onCancel = () => { sound("button"); finish(false); };
        const onBackdrop = (event) => { if (event.target === modal) finish(false); };
        const onKey = (event) => { if (event.key === "Escape") finish(false); };

        okButton.addEventListener("click", onOk);
        cancelButton.addEventListener("click", onCancel);
        modal.addEventListener("click", onBackdrop);
        document.addEventListener("keydown", onKey);
    });
}



// --- Redo the round -------------------------------------------------------
// Two accidents this covers: double-tapping the toggle, which hides and then
// immediately reveals the target; and a guesser catching sight of the screen.
// Either way the round is replayed with a fresh target and the same clue pair.
// Not a free re-spin for the psychic: it undoes the round rather than shopping
// for a better target, and it is deliberately out of the main button row.
function redoRound() {
    // Take back any points already awarded for this round.
    if (isPostGuessPhase && !lastRoundWasPractice && teams[currentTeamIndex]) {
        teams[currentTeamIndex].score -= lastRoundScore;
        if (teams[currentTeamIndex].score < 0) teams[currentTeamIndex].score = 0;
    }
    if (isPostGuessPhase && roundsPlayed > 0) roundsPlayed--;

    gameOver = false;
    hideGameOver();
    lastRoundScore = 0;
    lastRoundMessage = "";
    lastRoundWasPractice = false;
    isPostGuessPhase = false;
    isTargetVisible = true;
    scoreElement.textContent = "";

    // Same question, new target.
    initializeNewTargetArea();
    setPsychicView();
    updateScoreDisplay();
    renderRoundProgress();
    saveGameState();
}


// --- Audience screen ------------------------------------------------------
// A second window on the same machine mirrors the game for the room. Same
// browser only: with no server there is nothing to relay between devices.
const audienceChannel = "BroadcastChannel" in window
    ? new BroadcastChannel("wavelength" + (DECK ? ":" + DECK : ""))
    : null;

function tellAudience(message) {
    if (audienceChannel) audienceChannel.postMessage(message);
}

// The audience screen can move the needle too — handy when the big screen is a
// touchscreen. Mirror it here, and keep currentNeedleAngle in step: the score is
// read off the needle's transform when the target is revealed, so a move made
// only on the other screen would otherwise be scored as if it never happened.
// BroadcastChannel does not echo to the sender, so this cannot loop.
if (audienceChannel) {
    audienceChannel.addEventListener("message", (event) => {
        const data = event.data;
        if (!data || data.type !== "needle" || data.from !== "audience") return;
        currentNeedleAngle = data.angle;
        needle.style.transform = `rotate(${data.angle}deg)`;
    });
}

// --- Rounds ---------------------------------------------------------------
// A round is one team's turn. The total is a player setting; the progress bar
// can be switched off entirely from the clue editor.
const TOTAL_ROUNDS_KEY = deckKey("wavelengthTotalRounds");
const SHOW_PROGRESS_KEY = deckKey("wavelengthShowProgress");
const MIN_TOTAL_ROUNDS = 1;
const MAX_TOTAL_ROUNDS = 99;
// A deck can set its own defaults on <body>; they apply until a player changes
// the setting, which is then stored per deck.
const DEFAULT_TOTAL_ROUNDS = parseInt(document.body.dataset.defaultRounds, 10) || 10;
const DEFAULT_TEAM_COUNT = parseInt(document.body.dataset.defaultTeams, 10) || 2;
// Some decks open with a practice round: it is played and scored on screen so
// everyone sees how it works, but the points are not banked.
const HAS_PRACTICE_ROUND = document.body.dataset.practiceRound === "true";

let roundsPlayed = 0;
let gameOver = false;

function readTotalRounds() {
    try {
        const raw = parseInt(localStorage.getItem(TOTAL_ROUNDS_KEY), 10);
        if (Number.isNaN(raw)) return DEFAULT_TOTAL_ROUNDS;
        return Math.min(MAX_TOTAL_ROUNDS, Math.max(MIN_TOTAL_ROUNDS, raw));
    } catch (error) {
        return DEFAULT_TOTAL_ROUNDS;
    }
}

// True while the round about to be played is the practice one.
function inPracticeRound() {
    return HAS_PRACTICE_ROUND && roundsPlayed === 0;
}

function isProgressShown() {
    try {
        // Absent means shown; only an explicit "false" hides it.
        return localStorage.getItem(SHOW_PROGRESS_KEY) !== "false";
    } catch (error) {
        return true;
    }
}

let totalRounds = readTotalRounds();

function renderRoundProgress() {
    const panel = document.getElementById("roundPanel");
    if (!panel) return;

    panel.style.display = isProgressShown() ? "flex" : "none";

    const label = document.getElementById("roundProgressLabel");
    const track = document.getElementById("roundProgressTrack");
    const fill = document.getElementById("roundProgressFill");

    const played = Math.min(roundsPlayed, totalRounds);
    const current = Math.min(played + 1, totalRounds);

    label.textContent = gameOver
        ? `All ${totalRounds} rounds played`
        : inPracticeRound()
            ? `Practice round — 1 of ${totalRounds}`
            : `Round ${current} of ${totalRounds}`;
    fill.style.width = (played / totalRounds) * 100 + "%";
    track.setAttribute("aria-valuemax", String(totalRounds));
    track.setAttribute("aria-valuenow", String(played));

}

function points(count) {
    return `${count} point${count === 1 ? "" : "s"}`;
}

function listNames(names) {
    if (names.length === 1) return names[0];
    const rest = names.slice(0, -1);
    return `${rest.join(", ")} and ${names[names.length - 1]}`;
}

function winnerText() {
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

// canvas-confetti's default canvas sits below the modal, so the celebration was
// hidden behind the winner panel. This one owns its canvas and stacks above it.
let foregroundConfetti = null;

function getForegroundConfetti() {
    if (foregroundConfetti) return foregroundConfetti;
    if (typeof confetti !== "function") return null;

    const canvas = document.createElement("canvas");
    canvas.id = "confettiCanvas";
    canvas.setAttribute("aria-hidden", "true");
    document.body.appendChild(canvas);
    foregroundConfetti = confetti.create(canvas, { resize: true, useWorker: true });
    return foregroundConfetti;
}

// A bigger, themed burst than the per-round one: two cannons from the lower
// corners so it reads across the whole screen in front of the panel.
function celebrateWin() {
    const fire = getForegroundConfetti();
    if (!fire) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const colors = ["#e07b39", "#eaa15c", "#a8cfc0", "#f3eee2", "#c4453f"];
    const shared = { particleCount: 90, ticks: 240, gravity: 0.9, scalar: 1.1, colors };

    fire({ ...shared, spread: 70, angle: 60, origin: { x: 0, y: 0.75 } });
    fire({ ...shared, spread: 70, angle: 120, origin: { x: 1, y: 0.75 } });
    setTimeout(() => {
        fire({ ...shared, particleCount: 70, spread: 110, origin: { x: 0.5, y: 0.5 } });
    }, 320);
}

function showGameOver() {
    const modal = document.getElementById("gameOverModal");
    if (!modal) return;

    document.getElementById("gameOverTitle").textContent = winnerText();

    const list = document.getElementById("gameOverScores");
    list.textContent = "";
    [...teams]
        .sort((a, b) => b.score - a.score)
        .forEach((team) => {
            const item = document.createElement("li");
            const name = document.createElement("span");
            name.textContent = team.name;
            const score = document.createElement("strong");
            score.textContent = String(team.score);
            item.append(name, score);
            list.appendChild(item);
        });

    modal.style.display = "block";
    setTimeout(() => modal.classList.add("show"), 10);
    document.getElementById("playAgainButton").focus();
    celebrateWin();
    tellAudience({ type: "celebrate", title: winnerText() });
}

function hideGameOver() {
    const modal = document.getElementById("gameOverModal");
    if (!modal) return;
    modal.classList.remove("show");
    setTimeout(() => { modal.style.display = "none"; }, 300);
}

function practiceScoreLine(score, teamName) {
    if (lastRoundWasPractice) {
        return score > 0
            ? `Practice round — ${score} would have scored`
            : "Practice round — no points either way";
    }
    return score > 0 ? `+${score} for ${teamName}` : `No points for ${teamName}`;
}

function pickResultMessage(score) {
    const pool = RESULT_MESSAGES[score] || RESULT_MESSAGES[0];
    return pool[Math.floor(Math.random() * pool.length)];
}

let clues;

// audio.js defines window.WavelengthAudio. Guard so the game still runs if the
// script is blocked or fails to load.
function sound(name, argument) {
    if (window.WavelengthAudio) window.WavelengthAudio.play(name, argument);
}

const dialHub = document.getElementById("dialHub");
let lastTickStep = null;

function pulseHub() {
    if (!dialHub) return;
    dialHub.classList.remove("pulse");
    // Force a reflow so the animation restarts when triggered twice in a row.
    void dialHub.offsetWidth;
    dialHub.classList.add("pulse");
}

const gameContainer = document.querySelector('.game-container');




// Clue pairs come from localStorage first (edited via admin.html), and fall back
// to the committed clues.json. Both are the same shape: an array of [left, right]
// string pairs.
const CUSTOM_CLUES_KEY = deckKey("wavelengthCustomClues");

function isValidClueList(value) {
    return Array.isArray(value) && value.every((pair) =>
        Array.isArray(pair) &&
        pair.length === 2 &&
        typeof pair[0] === "string" && pair[0].trim() !== "" &&
        typeof pair[1] === "string" && pair[1].trim() !== ""
    );
}

function readCustomClues() {
    let raw;
    try {
        raw = localStorage.getItem(CUSTOM_CLUES_KEY);
    } catch (error) {
        console.error("Could not read custom clues from localStorage:", error);
        return null;
    }
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        return isValidClueList(parsed) ? parsed : null;
    } catch (error) {
        console.error("Custom clues in localStorage are not valid JSON:", error);
        return null;
    }
}

async function loadClues() {
    const custom = readCustomClues();
    if (custom && custom.length > 0) return custom;

    try {
        const response = await fetch("clues.json", { cache: "no-cache" });
        if (!response.ok) throw new Error("HTTP " + response.status);
        const parsed = await response.json();
        if (!isValidClueList(parsed)) throw new Error("clues.json is not a list of [left, right] string pairs");
        return parsed;
    } catch (error) {
        console.error("Error loading clues.json:", error);
        return [];
    }
}


// Helper to update debug status on screen
const debugStatusDiv = document.getElementById('gemini-debug-status');
function updateDebugStatus(message) {
    if (debugStatusDiv) {
        debugStatusDiv.textContent = new Date().toLocaleTimeString() + " - " + message + "\n" + debugStatusDiv.textContent;
        // Keep only the last few messages to prevent overflow
        const messages = debugStatusDiv.textContent.split('\n').filter(Boolean);
        if (messages.length > 10) {
            debugStatusDiv.textContent = messages.slice(0, 10).join('\n');
        }
    }
}
// Initial status
updateDebugStatus("Script loaded, DOM elements selected.");

let teams = [];



let currentTeamIndex = 0;
let currentClueIndex = -1; // Initialize with an invalid index

// Define team-specific colors
const teamColors = [
    { primary: '#4f8cff', secondary: '#7aa7ff' },   // Blue
    { primary: '#ff6b9c', secondary: '#ff9ab8' },   // Pink
    { primary: '#5cb85c', secondary: '#8cd68c' },   // Green
    { primary: '#f0ad4e', secondary: '#f4c27a' },   // Orange
    { primary: '#5bc0de', secondary: '#8cdff4' }    // Cyan
];

// Reference to the new current team indicator pill
const currentTeamIndicator = document.getElementById("current-team-indicator");
const currentTeamIndicatorIcon = currentTeamIndicator.querySelector(".team-indicator__icon");
const currentTeamIndicatorLabel = currentTeamIndicator.querySelector(".team-indicator__label");
const currentTeamIndicatorName = currentTeamIndicator.querySelector(".team-indicator__name");


// "Team 1" -> "Team 1's", "Reds" -> "Reds'".
function possessive(name) {
    return name.endsWith("s") || name.endsWith("S") ? `${name}'` : `${name}'s`;
}

function updateCurrentTeamIndicator(phase) { // phase: "psychic", "guesser", "postGuess"
    if (teams.length === 0) {
        currentTeamIndicator.style.display = 'none';
        return;
    }
    currentTeamIndicator.style.display = 'flex'; // Show the indicator

    const team = teams[currentTeamIndex];
    const teamColorClass = `team-color-${currentTeamIndex % teamColors.length}`;

    // Clear previous team color classes
    currentTeamIndicator.className = 'team-indicator';
    currentTeamIndicator.classList.add(teamColorClass);

    // Apply CSS variables for dynamic glow
    currentTeamIndicator.style.setProperty('--team-color-current-primary', teamColors[currentTeamIndex % teamColors.length].primary);

    // One plain phrase rather than a label-plus-name pair.
    if (phase === "psychic") {
        currentTeamIndicatorLabel.textContent = "";
        currentTeamIndicatorName.textContent = `${possessive(team.name)} turn`;
        turnIndicator.textContent = ""; // The pill already states the phase.
    } else if (phase === "guesser") {
        currentTeamIndicatorLabel.textContent = "";
        currentTeamIndicatorName.textContent = `${team.name} is guessing`;
        turnIndicator.textContent = "";
    } else if (phase === "postGuess") {
        currentTeamIndicatorLabel.textContent = "";
        currentTeamIndicatorName.textContent = `${possessive(team.name)} result`;
        turnIndicator.textContent = lastRoundMessage || "";
    }
}

// Inline SVG rather than emoji, so the icons inherit the text color and render
// the same on every platform. viewBox is 24x24 throughout.
const ICONS = {
    pencil: `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L18 10l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>`,
    star: `<svg class="icon icon--filled" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.6 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.9z"/></svg>`,
    trash: `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"/><path d="M10 4h4l.5 3h-5z"/><path d="M6.5 7 7.5 20h9L17.5 7"/></svg>`,
    plus: `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>`,
    group: `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M16 5.6a3.2 3.2 0 0 1 0 6.3"/><path d="M17.5 14.2A5.5 5.5 0 0 1 20.5 19"/></svg>`
};

function updateScoreDisplay() {
    let scoreHTML = teams.map((team, index) =>
        `<div class="team-score-item ${index === currentTeamIndex ? 'current-team' : ''}" data-team-index="${index}">
            <span class="team-row-icon" aria-hidden="true">${ICONS.group}</span>
            <span class="team-name-display">${team.name}<span class="edit-icon">${ICONS.pencil}</span></span>
            <span class="team-score-value">${ICONS.star} ${team.score}</span>
            <button class="delete-team-button" data-team-index="${index}" ${teams.length === 1 ? 'disabled' : ''}
                title="Delete ${team.name}" aria-label="Delete ${team.name}">${ICONS.trash}</button>
        </div>`
    ).join('');
    scoreHTML += `<button id="addTeamButton">${ICONS.plus}<span>Add Team</span></button>`;
    totalScoreElement.innerHTML = scoreHTML;

    // Attach event listeners using delegation for dynamically created elements
    totalScoreElement.querySelectorAll('.team-name-display').forEach(nameSpan => {
        nameSpan.addEventListener('click', (event) => {
            // currentTarget, not target: clicking the pencil icon inside the span
            // would otherwise replace the icon rather than the name.
            const nameElement = event.currentTarget;
            const index = parseInt(nameElement.closest('.team-score-item').dataset.teamIndex);
            const currentName = teams[index].name;
            const input = document.createElement('input');
            input.type = 'text';
            input.value = currentName;
            input.className = 'team-name-input-inline';
            nameElement.replaceWith(input);
            input.focus();

            const handleNameChange = () => {
                const newName = input.value.trim();
                if (newName && newName !== currentName) {
                    teams[index].name = newName;
                    saveGameState();
                }
                updateScoreDisplay(); // Re-render to show updated name or revert if empty
            };

            input.addEventListener('blur', handleNameChange);
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    handleNameChange();
                }
            });
        });
    });

    totalScoreElement.querySelectorAll('.delete-team-button').forEach(deleteButton => {
        deleteButton.addEventListener('click', async (event) => {
            // currentTarget, not target: a click lands on the SVG inside the
            // button, whose dataset is empty, and parseInt(undefined) is NaN —
            // which splice treats as 0 and deletes the wrong team.
            const indexToDelete = parseInt(event.currentTarget.dataset.teamIndex);
            if (Number.isNaN(indexToDelete) || teams.length <= 1) return;

            const name = teams[indexToDelete].name;
            sound("button");
            const confirmed = await askConfirm({
                title: `Delete ${name}?`,
                body: `${name} and its score are removed from this game. This cannot be undone.`,
                confirmLabel: "Delete",
                cancelLabel: "Keep"
            });
            if (!confirmed) return;

            teams.splice(indexToDelete, 1);
            if (currentTeamIndex >= teams.length) {
                currentTeamIndex = 0; // The current team was deleted or was last.
            }
            saveGameState();
            updateScoreDisplay();
        });
    });

    const addTeamButton = document.getElementById('addTeamButton');
    if (addTeamButton) {
        addTeamButton.addEventListener('click', () => {
            console.log("IN add team")
            const newTeamNumber = teams.length + 1;
            teams.push({ name: `Team ${newTeamNumber}`, score: 0 });
            saveGameState();
            updateScoreDisplay();
        });
    }
}

function saveGameState() {
    const gameState = {
        teams: teams,
        currentTeamIndex: currentTeamIndex,
        currentClueIndex: currentClueIndex,
        targetAngle: targetAngle, // Save target angle
        isTargetVisible: isTargetVisible, // Save target visibility state
        isPostGuessPhase: isPostGuessPhase, // Save post-guess phase state
        lastRoundScore: lastRoundScore, // What the current team actually scored
        lastRoundMessage: lastRoundMessage,
        lastRoundWasPractice: lastRoundWasPractice,
        nextClueCursor: nextClueCursor,
        roundsPlayed: roundsPlayed,
        gameOver: gameOver
    };
    localStorage.setItem(deckKey('wavelengthGameState'), JSON.stringify(gameState));
    tellAudience({ type: "state" });
}

function loadGameState() {
    const savedState = localStorage.getItem(deckKey('wavelengthGameState'));
    if (savedState) {
        try {
            const loadedState = JSON.parse(savedState);
            currentClueIndex = loadedState.currentClueIndex;
            if (!clues || currentClueIndex >= clues.length) currentClueIndex = -1;
            targetAngle = typeof loadedState.targetAngle !== 'undefined' ? loadedState.targetAngle : 0; // Load target angle
            isTargetVisible = typeof loadedState.isTargetVisible !== 'undefined' ? loadedState.isTargetVisible : true;
            isPostGuessPhase = typeof loadedState.isPostGuessPhase !== 'undefined' ? loadedState.isPostGuessPhase : false;
            // Round bookkeeping. Restored here alongside the other globals so a
            // refresh resumes the game rather than restarting the count.
            lastRoundWasPractice = Boolean(loadedState.lastRoundWasPractice);
            nextClueCursor = loadedState.nextClueCursor || 0;
            roundsPlayed = loadedState.roundsPlayed || 0;
            gameOver = isProgressShown() &&
                (Boolean(loadedState.gameOver) || roundsPlayed >= totalRounds);
            return loadedState;
        } catch (e) {
            console.error("Error parsing saved game state:", e);
            return null;
        }
    }
    return null;
}

// New function to completely reset the game
function resetGame() {
    teams.forEach(team => team.score = 0); // Reset scores only, preserve team names and count
    currentTeamIndex = 0; // Reset current team to the first team
    currentClueIndex = -1;
    targetAngle = 0;
    isPostGuessPhase = false;
    lastRoundScore = 0;
    lastRoundMessage = "";
    lastRoundWasPractice = false;
    nextClueCursor = 0;
    roundsPlayed = 0;
    gameOver = false;
    hideGameOver();
    renderRoundProgress();
    isTargetVisible = true; // Psychic's view is visible, but hidden by overlay

    updateScoreDisplay();
    scoreElement.textContent = "";
    showRevealOverlay();
    saveGameState();
    updateCurrentTeamIndicator("psychic"); // Update team indicator after reset
}



newGameButton.addEventListener("click", () => {
    sound("newGame");
    resetGame(); // Call the new reset function
});

skipQuestionButton.addEventListener("click", () => {
    sound("button");
    scoreElement.textContent = "";
    currentClueIndex = -1; // Reset to get a new random clue next time
    setPsychicView();
    saveGameState(); // Added this line
    updateCurrentTeamIndicator("psychic"); // Update the "Now Playing" pill for psychic turn
});

nextRoundButton.addEventListener("click", () => {
    if (gameOver) return;
    sound("newRound");
    currentTeamIndex = (currentTeamIndex + 1) % teams.length;
    updateScoreDisplay();
    scoreElement.textContent = "";
    currentClueIndex = -1; // A fresh clue is drawn once the psychic is ready.
    isTargetVisible = true;
    isPostGuessPhase = false;
    // Hand over behind the gate rather than straight into the psychic's view.
    showRevealOverlay(`${teams[currentTeamIndex].name}: tap when you are ready`);
    updateCurrentTeamIndicator("psychic");
    saveGameState();
});

// A double-tap would otherwise hide the target and reveal it again in one go,
// scoring the round before anyone has guessed.
let toggleLockedUntil = 0;

toggleButton.addEventListener("click", () => {
    const now = Date.now();
    if (now < toggleLockedUntil) return;
    toggleLockedUntil = now + 600;

    isTargetVisible = !isTargetVisible;
    if (isTargetVisible) {
        // This is the "Reveal Target" action
        const needleAngle = parseFloat(needle.style.transform.replace("rotate(", "").replace("deg)", "")) || 0;
        const score = calculateScore(needleAngle);
        lastRoundScore = score;
        lastRoundMessage = pickResultMessage(score);
        lastRoundWasPractice = inPracticeRound();
        if (!lastRoundWasPractice) teams[currentTeamIndex].score += score;
        showPointsAnimation(score); // Call the new points animation function
        scoreElement.textContent = practiceScoreLine(score, teams[currentTeamIndex].name);
        updateScoreDisplay();
        sound("reveal");
        sound("score", score);
        pulseHub();
        targetArea.classList.remove("revealing");
        void targetArea.offsetWidth;
        targetArea.classList.add("revealing");
        if (score === 5) { // Confetti for bull's eye
            triggerConfetti();
            sound("fanfare");
        } else if (score === 0) { // Shake animation for 0 points
            scoreElement.classList.add('shake-zero-points');
            setTimeout(() => {
                scoreElement.classList.remove('shake-zero-points');
            }, 500); // Animation duration is 0.5s
        }
        
        targetArea.style.display = "block";
        board.classList.add("dial-revealed");
        openHatch();
        toggleButton.style.display = "none";
        skipQuestionButton.style.display = "none";
        nextRoundButton.style.display = "inline-block";
        turnIndicator.textContent = "Nicely played! Next round awaits!"; // More fun message
        isPostGuessPhase = true; // Set flag for post-guess phase
        roundsPlayed++;
        // With the progress bar switched off the game is endless, so never
        // declare a winner.
        if (isProgressShown() && roundsPlayed >= totalRounds) {
            gameOver = true;
            nextRoundButton.style.display = "none";
        }
        renderRoundProgress();
        tellAudience({ type: "score", score, practice: lastRoundWasPractice });
        saveGameState(); // Save state after score update
        updateCurrentTeamIndicator("postGuess"); // Update the "Now Playing" pill for post-guess phase
        canMoveNeedle = false;
        if (gameOver) setTimeout(showGameOver, 900);

    } else {
        // This is the "Hide Target" action
        sound("hide");
        setGuesserView();
        saveGameState(); // Persist the isTargetVisible = false state
    }
});

// New: Function to show the "Tap to Reveal" overlay and hide game elements
function showRevealOverlay(message) {
    // The gate between rounds: the target stays hidden until the next clue
    // giver says they are holding the device. Without it, pressing Next Round
    // reveals the target to whoever is still looking at the screen.
    const prompt = revealOverlay.querySelector("p");
    if (prompt) {
        prompt.textContent = message || "Tap to show wavelength and start the game";
    }
    revealOverlay.style.display = 'flex'; // Ensure display is not 'none' for transition
    revealOverlay.classList.add('active');
    board.classList.add('highlight');
    // Hide game elements that should be covered/reset
    targetArea.style.display = "none";
        board.classList.remove("dial-revealed");
    document.getElementById("leftClue").textContent = ""; // Clear clues
    document.getElementById("rightClue").textContent = "";
    toggleButton.style.display = "none";
    skipQuestionButton.style.display = "none";
    nextRoundButton.style.display = "none";
    scoreElement.textContent = "";
    turnIndicator.textContent = "New Round Ready!";
    gameContainer.classList.remove('psychic-turn');
    hideNeedle();
    canMoveNeedle = false;
    psychicInfoBalloon.style.visibility = "hidden"; // Hide info balloon
    saveGameState(); // Save state with overlay active
}

// New: Event listener for the "Tap to Reveal" overlay
revealOverlay.addEventListener("click", () => {
    if (window.WavelengthAudio) window.WavelengthAudio.resumeIfEnabled();
    sound("newRound");
    revealOverlay.classList.remove('active'); // Start fade out
    board.classList.remove('highlight');
    setTimeout(() => {
        revealOverlay.style.display = 'none'; // Hide completely after transition
        setPsychicView(); // Transition to psychic view
    }, 500); // Match CSS transition duration
});




// Hide game container initially
// gameContainer.style.display = 'none'; // Removed - now managed by initializeGame()

// Function to reconstruct UI based on loaded game state
function reconstructGameUI(loadedState) {
    // These global variables are already set by loadGameState() before calling this.
    // currentClueIndex, targetAngle, isTargetVisible, isPostGuessPhase

    // Always display clues and target area based on loaded state
    displayClueForIndex(currentClueIndex);
    setTargetArea(); // Use the loaded targetAngle to render the target area

    if (loadedState.currentClueIndex === -1 && !loadedState.isPostGuessPhase) {
        // A round has been handed over but the next psychic has not tapped
        // ready yet, so keep the gate up and name who it is waiting for.
        const waitingFor = teams[currentTeamIndex];
        showRevealOverlay(waitingFor ? `${waitingFor.name}: tap when you are ready` : undefined);
        updateCurrentTeamIndicator("psychic");
        canMoveNeedle = false; // Psychic cannot move needle initially
    } else if (loadedState.isPostGuessPhase) {
        // Post-guess phase
        // Show current score, hide needle, show target area, show next round button
        revealOverlay.classList.remove('active');
        revealOverlay.style.display = 'none';
        targetArea.style.display = "block";
        board.classList.add("dial-revealed");
        openHatch();
        toggleButton.style.display = "none";
        skipQuestionButton.style.display = "none";
        nextRoundButton.style.display = "inline-block";
        gameContainer.classList.remove('psychic-turn');
        hideNeedle();
        canMoveNeedle = false;
        psychicInfoBalloon.style.visibility = "hidden"; // Hide info balloon
        // Restore the round's result before painting the indicator, which reads
        // both of these to choose its label and flavour line.
        lastRoundScore = loadedState.lastRoundScore || 0;
        lastRoundMessage = loadedState.lastRoundMessage || pickResultMessage(lastRoundScore);
        scoreElement.textContent = practiceScoreLine(lastRoundScore, teams[currentTeamIndex].name);
        updateCurrentTeamIndicator("postGuess");
    } else if (!loadedState.isTargetVisible) { // Guesser's turn
        // Hide target area, show needle, toggle button says "Reveal"
        revealOverlay.classList.remove('active');
        revealOverlay.style.display = 'none';
        targetArea.style.display = "none";
        board.classList.remove("dial-revealed");
        // Already hidden before the reload: show the hatch shut, do not sweep.
        setCoverNow(true);
        toggleButton.textContent = "Reveal Target";
        toggleButton.style.display = "inline-block";
        scoreElement.textContent = "";
        showNeedle();
        skipQuestionButton.style.display = "none";
        nextRoundButton.style.display = "none";
        gameContainer.classList.remove('psychic-turn');
        canMoveNeedle = true;
        psychicInfoBalloon.style.visibility = "hidden"; // Hide info balloon
        updateCurrentTeamIndicator("guesser");
    } else { // Psychic's turn (target is visible)
        // Show target area, hide needle, toggle button says "Hide"
        revealOverlay.classList.remove('active');
        revealOverlay.style.display = 'none';
        targetArea.style.display = "block";
        board.classList.add("dial-revealed");
        toggleButton.textContent = "Hide for Guessers";
        toggleButton.style.display = "inline-block";
        skipQuestionButton.style.display = "inline-block";
        nextRoundButton.style.display = "none";
        gameContainer.classList.add('psychic-turn');
        needle.style.transform = "rotate(0deg)"; // Reset needle to center for psychic
        hideNeedle();
        canMoveNeedle = false;
        psychicInfoBalloon.style.visibility = "visible"; // Show info balloon
        updateCurrentTeamIndicator("psychic");
    }
    // Ensure the toggleButton visibility is consistent with canMoveNeedle
    if (canMoveNeedle) {
        toggleButton.style.display = "inline-block";
    }
}

// Consolidated Game Initialization Logic
function initializeGame() {
    const loadedState = loadGameState();

    if (!loadedState) { // Completely fresh start, initialize with default teams
        teams = Array.from({ length: DEFAULT_TEAM_COUNT }, (unused, index) => ({
            name: `Team ${index + 1}`,
            score: 0
        }));
        currentTeamIndex = 0;
        
        // Update with default teams
        updateScoreDisplay();
        
        // Directly start a new game experience for fresh users
        resetGame(); // Call resetGame to ensure exact new game state
    } else { // Game state found
        teams = loadedState.teams;
        currentTeamIndex = loadedState.currentTeamIndex;
        // Global variables (targetAngle, isTargetVisible, isPostGuessPhase, currentClueIndex)
        // are set by loadGameState()
        updateScoreDisplay(); // Update with loaded teams
        reconstructGameUI(loadedState); // Reconstruct the UI based on the loaded state
    }
}

// Shown instead of the board when there are no clue pairs to draw from.
function showNoCluesNotice() {
    const notice = document.getElementById("noCluesNotice");
    const boardArea = document.getElementById("gameBoardAndCluesContainer");
    const controls = document.querySelector(".controls");

    if (notice) notice.style.display = "block";
    if (boardArea) boardArea.style.display = "none";
    if (controls) controls.style.display = "none";
    if (totalScoreElement) totalScoreElement.style.display = "none";
    if (scoreElement) scoreElement.style.display = "none";
    if (turnIndicator) turnIndicator.textContent = "";
    if (psychicInfoBalloon) psychicInfoBalloon.style.visibility = "hidden";
    if (currentTeamIndicator) currentTeamIndicator.style.display = "none";
}

document.addEventListener("DOMContentLoaded", async () => {
    // MODAL AND BUTTON INITIALIZATION MOVED HERE
    const modal = document.getElementById("howToPlayModal");
    const howToPlayButton = document.getElementById("howToPlayButton");
    const closeButton = modal.querySelector(".close-button");

    const changeLogModal = document.getElementById("changeLogModal");
    const changeLogCloseButton = changeLogModal.querySelector(".close-button");

    changeLogCloseButton.onclick = function () {
        changeLogModal.classList.remove("show");
        setTimeout(() => changeLogModal.style.display = "none", 300);
    };

    howToPlayButton.onclick = function () {
        modal.style.display = "block";
        setTimeout(() => modal.classList.add("show"), 10);
    };

    closeButton.onclick = function () {
        modal.classList.remove("show");
        setTimeout(() => modal.style.display = "none", 300);
    };

    window.onclick = function (event) {

        if (event.target == changeLogModal) {
            changeLogModal.classList.remove("show");
            setTimeout(() => changeLogModal.style.display = "none", 300);
        }
    }

    // Mouse events
    board.addEventListener("mousedown", handleStart);
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleEnd);

    // Touch events
    board.addEventListener("touchstart", handleStart);
    document.addEventListener("touchmove", handleMove, { passive: false });
    document.addEventListener("touchend", handleEnd);

    // Audio toggles. Both preferences persist in localStorage; sound effects
    // default on, music defaults off.
    const sfxToggle = document.getElementById("sfxToggle");
    const musicToggle = document.getElementById("musicToggle");

    if (sfxToggle && musicToggle && window.WavelengthAudio) {
        const paintToggles = () => {
            sfxToggle.setAttribute("aria-pressed", String(window.WavelengthAudio.isSfxEnabled()));
            musicToggle.setAttribute("aria-pressed", String(window.WavelengthAudio.isMusicEnabled()));
        };

        sfxToggle.addEventListener("click", () => {
            window.WavelengthAudio.setSfxEnabled(!window.WavelengthAudio.isSfxEnabled());
            paintToggles();
        });

        musicToggle.addEventListener("click", () => {
            window.WavelengthAudio.setMusicEnabled(!window.WavelengthAudio.isMusicEnabled());
            paintToggles();
        });

        paintToggles();
    }

    // Reset asks first, through the same shared dialog as team deletion.
    const resetButton = document.getElementById("resetButton");
    if (resetButton) {
        resetButton.addEventListener("click", async () => {
            sound("button");
            const confirmed = await askConfirm({
                title: "Reset the game?",
                body: "Every team's score goes back to zero and the current round is abandoned. Team names are kept. This cannot be undone.",
                confirmLabel: "Reset Game",
                cancelLabel: "Keep Playing"
            });
            if (!confirmed) return;
            sound("newGame");
            resetGame();
        });
    }

    // Final-scores dialog, and the initial progress paint. The round total is
    // set in the clue editor.
    const redoButton = document.getElementById("redoRoundButton");
    if (redoButton) {
        redoButton.addEventListener("click", async () => {
            sound("button");
            const confirmed = await askConfirm({
                title: "Redo this round?",
                body: "The same question is asked again with a new target, and any points from this round are taken back. Use it if the target was seen by accident.",
                confirmLabel: "Redo Round",
                cancelLabel: "Never Mind"
            });
            if (!confirmed) return;
            sound("newRound");
            redoRound();
        });
    }

    const playAgainButton = document.getElementById("playAgainButton");
    const gameOverCloseButton = document.getElementById("gameOverCloseButton");

    if (playAgainButton) {
        playAgainButton.addEventListener("click", () => {
            hideGameOver();
            sound("newGame");
            resetGame();
        });
    }

    if (gameOverCloseButton) {
        gameOverCloseButton.addEventListener("click", () => {
            sound("button");
            hideGameOver();
        });
    }

    renderRoundProgress();

    clues = await loadClues();
    updateDebugStatus("Loaded " + clues.length + " clue pairs.");

    // A saved index can point past the end of the list after the pairs are
    // edited. Treat it as "no clue chosen" so a fresh one gets drawn.
    if (currentClueIndex >= clues.length) currentClueIndex = -1;

    if (clues.length === 0) {
        showNoCluesNotice();
        return;
    }

    initializeGame(); // This was already here
    // Repaint: the first call ran before the saved state was read, so it showed
    // round 1 for a moment on a resumed game.
    renderRoundProgress();
});


function setPsychicView() {
    canMoveNeedle = false;
    isPostGuessPhase = false; // Ensure this is false for a new psychic round
    
    if (currentClueIndex === -1) { // Only generate new if not reconstructing from saved state
        initializeNewTargetArea();
        setNextClue();
    } else {
        // If reconstructing, ensure UI reflects current global targetAngle and currentClueIndex
        setTargetArea(); // Re-apply target area based on global targetAngle
        displayClueForIndex(currentClueIndex); // Re-display clues based on global currentClueIndex
    }
    
    saveGameState(); // Save state after setting the clue
    updateCurrentTeamIndicator("psychic"); // Update the "Now Playing" pill for psychic turn
    
    gameContainer.classList.add('psychic-turn');
    turnIndicator.textContent = ""; // The team pill already states the phase.
    psychicInfoBalloon.style.visibility = "visible"; // Show info balloon for psychic

    targetArea.style.display = "block";
        board.classList.add("dial-revealed");
    openHatch({ animate: false });
    toggleButton.textContent = "Hide for Guessers";
    toggleButton.style.display = "inline-block";
    skipQuestionButton.style.display = "inline-block";
    nextRoundButton.style.display = "none";
    
    needle.style.transform = "rotate(0deg)";
    hideNeedle();
}


// The hatch: a wedge of the hidden-state colour that sweeps across the dial.
// The target stays underneath while it closes and is only hidden once the
// sweep lands, so the animation reads as the screen sliding over rather than
// the target blinking out.
const SWEEP_MS = 620;
let sweepTimer = null;

function closeHatch() {
    clearTimeout(sweepTimer);
    board.classList.remove("cover-instant");
    board.classList.add("cover-closed");
    sweepTimer = setTimeout(() => {
        // Only hide it if the hatch is still shut; a redo or reveal may have
        // reopened it while the sweep was running.
        if (board.classList.contains("cover-closed")) {
            targetArea.style.display = "none";
            board.classList.remove("dial-revealed");
        }
    }, SWEEP_MS);
}

// Put the hatch somewhere without animating. The guard comes off in the same
// task, after a forced reflow flushes the new angle, rather than on
// requestAnimationFrame: rAF does not fire while the tab is in the background,
// which left "cover-instant" — and so "transition: none" — stuck on the board,
// and every later sweep snapped instead of fanning.
function setCoverNow(closed) {
    board.classList.add("cover-instant");
    board.classList.toggle("cover-closed", closed);
    void board.offsetWidth;
    board.classList.remove("cover-instant");
    void board.offsetWidth;
}

function openHatch({ animate = true } = {}) {
    clearTimeout(sweepTimer);
    if (!animate) {
        setCoverNow(false);
        return;
    }
    board.classList.remove("cover-instant");
    board.classList.remove("cover-closed");
}

function setGuesserView() {
    tellAudience({ type: "needle", angle: 0 });
    closeHatch();
    canMoveNeedle = true;
    isPostGuessPhase = false; // Ensure this is false for the guesser phase
    
    gameContainer.classList.remove('psychic-turn');
    turnIndicator.textContent = "GUESS THE WAVELENGTH!";
    psychicInfoBalloon.style.visibility = "hidden"; // Hide info balloon for guesser

    // The target is hidden by closeHatch() once the panel has slid across;
    // hiding it here as well made the hatch pointless.
    toggleButton.textContent = "Reveal Target";
    scoreElement.textContent = "";
    showNeedle();
    updateCurrentTeamIndicator("guesser"); // Update the "Now Playing" pill for guesser turn
    skipQuestionButton.style.display = "none";
    nextRoundButton.style.display = "none";
}


// Helper function to clamp angles for the gradient
function clampAngle(angle) {
    return Math.max(0, Math.min(180, angle));
}

function setTargetArea() {
    const angle1 = clampAngle(targetAngle - 22.5 + 90);
    const angle2 = clampAngle(targetAngle - 13.5 + 90);
    const angle3 = clampAngle(targetAngle - 4.5 + 90);
    const angle4 = clampAngle(targetAngle + 4.5 + 90);
    const angle5 = clampAngle(targetAngle + 13.5 + 90);
    const angle6 = clampAngle(targetAngle + 22.5 + 90);

    // Cream dial face with warm scoring bands, matching the app's look.
    const face = "#f3eee2";
    const band1 = "#f1cba4";
    const band3 = "#eaa15c";
    const band5 = "#e07b39";

    const gradient = `conic-gradient(
                from -90deg at 50% 100%,
                ${face} 0deg ${angle1}deg,
                ${band1} ${angle1}deg ${angle2}deg,
                ${band3} ${angle2}deg ${angle3}deg,
                ${band5} ${angle3}deg ${angle4}deg,
                ${band3} ${angle4}deg ${angle5}deg,
                ${band1} ${angle5}deg ${angle6}deg,
                ${face} ${angle6}deg 180deg
            )`;
    targetArea.style.background = gradient;
}

function initializeNewTargetArea() {
    // The printed rules say to spin again when the target's center wedge is not
    // fully visible, so keep the whole 5-point band on the dial. Drawing from
    // the reduced range is the same distribution as re-spinning until it fits.
    // Without this, about 5% of rounds had part of the bull's-eye unreachable.
    const limit = 90 - 4.5;
    targetAngle = Math.random() * (limit * 2) - limit;
    setTargetArea();
}

// Clue pairs are played in list order rather than drawn at random, so a game
// works through the list predictably and nothing repeats until it wraps.
function setNextClue() {
    if (!clues || clues.length === 0) return;
    // Modulo keeps the cursor valid if the list was shortened between rounds.
    currentClueIndex = nextClueCursor % clues.length;
    nextClueCursor = (currentClueIndex + 1) % clues.length;
    displayClueForIndex(currentClueIndex);
}

function displayClueForIndex(index) {
    if (!clues || clues.length === 0 || index < 0 || index >= clues.length) return;
    const [left, right] = clues[index];
    document.getElementById("leftClue").textContent = left;
    document.getElementById("rightClue").textContent = right;
}

function calculateScore(angle) {
    const diff = Math.abs(angle - targetAngle);
    if (diff <= 4.5) return 5;
    if (diff <= 13.5) return 3;
    if (diff <= 22.5) return 1;
    return 0;
}

function handleStart(e) {
    if (canMoveNeedle) sound("grab");
    if (!canMoveNeedle) return;
    isDragging = true;
    e.preventDefault(); // Prevent default touch behavior
}

function triggerConfetti() {
    confetti({
        particleCount: 150,
        spread: 90,
        origin: { y: 0.6 },
        colors: ['#ff0000', '#00ff00', '#0000ff'], // Custom colors
        ticks: 200, // How long the animation lasts
        shapes: ['square'], // Use only square confetti
        gravity: 0.8, // Slightly increase gravity
        scalar: 1.2 // Make the confetti a bit larger
    });
}

function showPointsAnimation(score) {
    if (score === 0) return; // No animation for 0 points

    const boardRect = board.getBoundingClientRect(); // Get the semi-circle's position relative to viewport
    const gameContainerRect = gameContainer.getBoundingClientRect(); // Get gameContainer's position relative to viewport

    const numberOfPopups = score * 3; // More popups for higher scores, e.g., 5 points = 15 popups

    for (let i = 0; i < numberOfPopups; i++) {
        const scorePopup = document.createElement('div');
        scorePopup.textContent = `+${score}`;
        scorePopup.classList.add('score-popup');

        // Randomize initial position within the board's area, emanating roughly from its top half
        // Positions are relative to gameContainer's top-left corner
        const randomLeft = Math.random() * (boardRect.width * 0.8) + (boardRect.width * 0.1); // 10%-90% of board width
        const randomTop = Math.random() * (boardRect.height * 0.7); // Top 70% of the board height

        scorePopup.style.left = `${boardRect.left - gameContainerRect.left + randomLeft}px`;
        scorePopup.style.top = `${boardRect.top - gameContainerRect.top + randomTop}px`;

        // Apply random delay for a staggered effect
        scorePopup.style.animationDelay = `${Math.random() * 0.8}s`; // 0 to 0.8 seconds delay

        gameContainer.appendChild(scorePopup);

        scorePopup.addEventListener('animationend', () => {
            scorePopup.remove();
        });
    }
}

let currentNeedleAngle = 0; // New global variable to store the needle's current angle

// ... (rest of the file) ...

function handleMove(e) {
    if (!isDragging || !canMoveNeedle) return;
    e.preventDefault(); // Prevent default touch behavior
    const rect = needleContainer.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.bottom;

    let clientX, clientY;
    if (e.type === "touchmove") {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
    } else {
        clientX = e.clientX;
        clientY = e.clientY;
    }

    const angle =
        (Math.atan2(clientX - centerX, centerY - clientY) * 180) / Math.PI;
    const clampedAngle = Math.max(-90, Math.min(90, angle));
    // Tick once per whole degree crossed rather than per pointer event, so the
    // rate follows the dial rather than the browser's event frequency.
    const nextTickStep = Math.round(clampedAngle);
    if (nextTickStep !== lastTickStep) {
        lastTickStep = nextTickStep;
        sound("tick");
    }

    currentNeedleAngle = clampedAngle; // Update global angle variable
    tellAudience({ type: "needle", angle: clampedAngle });
    requestAnimationFrame(updateNeedlePosition); // Request animation frame for smooth update
}

function updateNeedlePosition() {
    needle.style.transform = `rotate(${currentNeedleAngle}deg)`;
}

function handleEnd() {
    isDragging = false;
    // Persist where the needle came to rest, so an audience window that reloads
    // mid-round does not snap back to centre. Written on release rather than on
    // every move, which would hammer storage.
    try {
        localStorage.setItem(deckKey("wavelengthNeedleAngle"), String(currentNeedleAngle));
    } catch (error) {
        /* Not worth surfacing. */
    }
}

function hideNeedle() {
    needle.style.display = "none";
}

function showNeedle() {
    needle.style.display = "block";
}
