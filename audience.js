// Read-only screen for the room. It never drives the game: it mirrors whatever
// the presenter window is doing, over a BroadcastChannel on the same browser,
// falling back to storage events. It deliberately does not show the target
// until the round is revealed.
(function () {
    "use strict";

    const DECK = document.body.dataset.deck || "";
    const deckKey = (name) => (DECK ? name + ":" + DECK : name);
    const STATE_KEY = deckKey("wavelengthGameState");
    const CUSTOM_CLUES_KEY = deckKey("wavelengthCustomClues");
    const SHOW_PROGRESS_KEY = deckKey("wavelengthShowProgress");
    const TOTAL_ROUNDS_KEY = deckKey("wavelengthTotalRounds");
    const DEFAULT_TOTAL_ROUNDS = parseInt(document.body.dataset.defaultRounds, 10) || 10;
    const HAS_PRACTICE_ROUND = document.body.dataset.practiceRound === "true";

    const targetArea = document.getElementById("targetArea");
    const needle = document.getElementById("needle");
    const leftClue = document.getElementById("leftClue");
    const rightClue = document.getElementById("rightClue");
    const board = document.querySelector(".board");
    const roundEl = document.getElementById("audienceRound");
    const turnEl = document.getElementById("audienceTurn");
    const messageEl = document.getElementById("audienceMessage");
    const scoresEl = document.getElementById("audienceScores");
    const waitingEl = document.getElementById("audienceWaiting");

    let clues = [];
    // Restored so a reload mid-round keeps the needle where the guessers left it.
    let needleAngle = (() => {
        try {
            const saved = parseFloat(localStorage.getItem(deckKey("wavelengthNeedleAngle")));
            return Number.isNaN(saved) ? 0 : saved;
        } catch (error) {
            return 0;
        }
    })();

    function isValidClueList(value) {
        return Array.isArray(value) && value.every((pair) =>
            Array.isArray(pair) && pair.length === 2 &&
            typeof pair[0] === "string" && pair[0].trim() !== "" &&
            typeof pair[1] === "string" && pair[1].trim() !== ""
        );
    }

    async function loadClues() {
        try {
            const raw = localStorage.getItem(CUSTOM_CLUES_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (isValidClueList(parsed) && parsed.length) return parsed;
            }
        } catch (error) {
            /* Fall through to the shipped list. */
        }
        try {
            const response = await fetch("clues.json", { cache: "no-cache" });
            const parsed = await response.json();
            return isValidClueList(parsed) ? parsed : [];
        } catch (error) {
            return [];
        }
    }

    function readState() {
        try {
            const raw = localStorage.getItem(STATE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (error) {
            return null;
        }
    }

    function totalRounds() {
        try {
            const raw = parseInt(localStorage.getItem(TOTAL_ROUNDS_KEY), 10);
            if (!Number.isNaN(raw)) return Math.min(99, Math.max(1, raw));
        } catch (error) {
            /* Fall through. */
        }
        return DEFAULT_TOTAL_ROUNDS;
    }

    function progressShown() {
        try {
            return localStorage.getItem(SHOW_PROGRESS_KEY) !== "false";
        } catch (error) {
            return true;
        }
    }

    const clamp = (angle) => Math.max(0, Math.min(180, angle));

    function paintTarget(angle) {
        const face = "#f3eee2";
        const band1 = "#f1cba4";
        const band3 = "#eaa15c";
        const band5 = "#e07b39";
        const a = [22.5, 13.5, 4.5, -4.5, -13.5, -22.5].map((offset) => clamp(angle - offset + 90));
        targetArea.style.background = `conic-gradient(from -90deg at 50% 100%,
            ${face} 0deg ${a[0]}deg, ${band1} ${a[0]}deg ${a[1]}deg,
            ${band3} ${a[1]}deg ${a[2]}deg, ${band5} ${a[2]}deg ${a[3]}deg,
            ${band3} ${a[3]}deg ${a[4]}deg, ${band1} ${a[4]}deg ${a[5]}deg,
            ${face} ${a[5]}deg 180deg)`;
    }

    function render() {
        const state = readState();

        if (!state || !state.teams) {
            waitingEl.style.display = "block";
            return;
        }
        waitingEl.style.display = "none";

        // The clue pair, if a round is under way.
        const index = typeof state.currentClueIndex === "number" ? state.currentClueIndex : -1;
        if (clues.length && index >= 0 && index < clues.length) {
            leftClue.textContent = clues[index][0];
            rightClue.textContent = clues[index][1];
        } else {
            leftClue.textContent = "";
            rightClue.textContent = "";
        }

        // The target is the one thing the room must not see early.
        const revealed = Boolean(state.isPostGuessPhase);
        if (revealed) {
            paintTarget(state.targetAngle || 0);
            targetArea.style.display = "block";
            board.classList.add("dial-revealed");
        } else {
            targetArea.style.display = "none";
            board.classList.remove("dial-revealed");
        }

        // The needle is only meaningful once the guessers have it.
        const guessing = state.isTargetVisible === false;
        needle.style.display = guessing || revealed ? "block" : "none";
        needle.style.transform = `rotate(${needleAngle}deg)`;

        const team = state.teams[state.currentTeamIndex] || state.teams[0];
        const played = state.roundsPlayed || 0;
        const practice = HAS_PRACTICE_ROUND && played === 0;

        if (progressShown()) {
            const total = totalRounds();
            roundEl.style.display = "block";
            roundEl.textContent = state.gameOver
                ? `All ${total} rounds played`
                : practice
                    ? `Practice round — 1 of ${total}`
                    : `Round ${Math.min(played + 1, total)} of ${total}`;
        } else {
            roundEl.style.display = "none";
        }

        turnEl.textContent = revealed
            ? `${team.name}'s result`
            : guessing
                ? `${team.name} is guessing`
                : `${team.name} is giving the clue`;

        messageEl.textContent = revealed ? (state.lastRoundMessage || "") : "";

        scoresEl.textContent = "";
        state.teams.forEach((entry, i) => {
            const row = document.createElement("li");
            row.className = "audience-score" + (i === state.currentTeamIndex ? " is-current" : "");
            const name = document.createElement("span");
            name.textContent = entry.name;
            const score = document.createElement("strong");
            score.textContent = String(entry.score);
            row.append(name, score);
            scoresEl.appendChild(row);
        });
    }

    // Live updates. BroadcastChannel carries the needle as it moves; the storage
    // event covers anything that writes state, and browsers without the channel.
    if ("BroadcastChannel" in window) {
        const channel = new BroadcastChannel("wavelength" + (DECK ? ":" + DECK : ""));
        channel.addEventListener("message", (event) => {
            if (event.data && event.data.type === "needle") {
                needleAngle = event.data.angle;
                needle.style.transform = `rotate(${needleAngle}deg)`;
                return;
            }
            render();
        });
    }

    window.addEventListener("storage", (event) => {
        if (!event.key || event.key.startsWith("wavelength")) render();
    });

    loadClues().then((list) => {
        clues = list;
        render();
    });
})();
