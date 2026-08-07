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
    let latestState = null;
    const channel = "BroadcastChannel" in window
        ? new BroadcastChannel("wavelength" + (DECK ? ":" + DECK : ""))
        : null;
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
        latestState = state;

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
    if (channel) {
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



    // --- Moving the needle from this screen -------------------------------
    // Useful when the big screen is a touchscreen, or the guessers are standing
    // at it rather than at the laptop. Only while the guessers have the dial:
    // before the target is hidden, and after it is revealed, the needle is not
    // theirs to move.
    const needleContainer = document.getElementById("needleContainer");
    let dragging = false;

    function guessingOpen() {
        return Boolean(latestState) &&
            latestState.isTargetVisible === false &&
            !latestState.isPostGuessPhase;
    }

    function angleFrom(event) {
        const rect = needleContainer.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.bottom;
        const point = event.touches ? event.touches[0] : event;
        const angle = (Math.atan2(point.clientX - centerX, centerY - point.clientY) * 180) / Math.PI;
        return Math.max(-90, Math.min(90, angle));
    }

    function sendNeedle(angle) {
        needleAngle = angle;
        needle.style.transform = `rotate(${angle}deg)`;
        if (channel) channel.postMessage({ type: "needle", angle, from: "audience" });
    }

    function onDragStart(event) {
        if (!guessingOpen()) return;
        dragging = true;
        sendNeedle(angleFrom(event));
        event.preventDefault();
    }

    function onDragMove(event) {
        if (!dragging || !guessingOpen()) return;
        sendNeedle(angleFrom(event));
        event.preventDefault();
    }

    function onDragEnd() {
        if (!dragging) return;
        dragging = false;
        try {
            localStorage.setItem(deckKey("wavelengthNeedleAngle"), String(needleAngle));
        } catch (error) {
            /* Not worth surfacing. */
        }
    }

    board.addEventListener("mousedown", onDragStart);
    board.addEventListener("touchstart", onDragStart, { passive: false });
    document.addEventListener("mousemove", onDragMove);
    document.addEventListener("touchmove", onDragMove, { passive: false });
    document.addEventListener("mouseup", onDragEnd);
    document.addEventListener("touchend", onDragEnd);

    // --- Full screen ------------------------------------------------------
    // Esc is handled by the browser itself; nothing to wire for leaving.
    const fullscreenButton = document.getElementById("fullscreenButton");

    function isFullscreen() {
        return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
    }

    function toggleFullscreen() {
        const root = document.documentElement;
        if (isFullscreen()) {
            const exit = document.exitFullscreen || document.webkitExitFullscreen;
            if (exit) exit.call(document);
            return;
        }
        const request = root.requestFullscreen || root.webkitRequestFullscreen;
        if (request) request.call(root).catch(() => { /* Denied; nothing to do. */ });
    }

    function paintFullscreenButton() {
        if (!fullscreenButton) return;
        const on = isFullscreen();
        fullscreenButton.setAttribute("aria-pressed", String(on));
        fullscreenButton.querySelector(".fullscreen-label").textContent =
            on ? "Exit full screen" : "Full screen";
        fullscreenButton.title = on ? "Leave full screen (Esc)" : "Full screen (F)";
    }

    if (fullscreenButton) {
        fullscreenButton.addEventListener("click", toggleFullscreen);
    }

    document.addEventListener("keydown", (event) => {
        // Ignore the shortcut while typing, and when a modifier is held.
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        const tag = (event.target.tagName || "").toLowerCase();
        if (tag === "input" || tag === "textarea" || event.target.isContentEditable) return;
        if (event.key === "f" || event.key === "F") {
            event.preventDefault();
            toggleFullscreen();
        }
    });

    document.addEventListener("fullscreenchange", paintFullscreenButton);
    document.addEventListener("webkitfullscreenchange", paintFullscreenButton);
    paintFullscreenButton();

    loadClues().then((list) => {
        clues = list;
        render();
    });
})();
