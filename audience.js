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
    const progressTrack = document.getElementById("roundProgressTrack");
    const progressFill = document.getElementById("roundProgressFill");
    const turnEl = document.getElementById("audienceTurn");
    const messageEl = document.getElementById("audienceMessage");
    const scoresEl = document.getElementById("audienceScores");
    const waitingEl = document.getElementById("audienceWaiting");

    let clues = [];
    let latestState = null;
    // null until the first render: a page restore shows the hatch already shut
    // rather than sweeping it, but a round change sweeps.
    let wasRevealed = null;
    let sweepTimer = null;
    let sweeping = false;
    const SWEEP_MS = 620;

    // Put the hatch somewhere without animating. The no-transition guard is
    // dropped in the same task, after a forced reflow flushes the new value —
    // not on requestAnimationFrame, which never fires while this tab sits in
    // the background. That left "cover-instant" stuck on the board, and with
    // it "transition: none", so every later sweep snapped instead of fanning.
    function setCoverNow(closed) {
        board.classList.add("cover-instant");
        board.classList.toggle("cover-closed", closed);
        void board.offsetWidth;
        board.classList.remove("cover-instant");
        void board.offsetWidth;
    }
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

        // The target is the one thing the room must not see early. The hatch
        // sweeps away on reveal; the rest of the time the target is not merely
        // covered but absent, so a CSS failure cannot leak it.
        const revealed = Boolean(state.isPostGuessPhase);
        if (revealed) {
            paintTarget(state.targetAngle || 0);
            // A reveal cancels any sweep still running, or its timer would
            // yank the target back out from under us.
            clearTimeout(sweepTimer);
            sweeping = false;
            if (targetArea.style.display !== "block" || board.classList.contains("cover-closed")) {
                targetArea.style.display = "block";
                board.classList.add("dial-revealed");
                // Start shut without animating, then sweep open.
                setCoverNow(true);
                board.classList.remove("cover-closed");
            }
        } else if (sweeping) {
            // A sweep is already under way; let it land.
        } else if (wasRevealed !== null && !board.classList.contains("cover-closed")) {
            // The cover is open and this is not a page restore, so fan it shut
            // over the target and pull the target once the sweep lands, the
            // way closeHatch() does on the presenter.
            board.classList.add("cover-closed");
            sweeping = true;
            clearTimeout(sweepTimer);
            sweepTimer = setTimeout(() => {
                sweeping = false;
                if (board.classList.contains("cover-closed")) {
                    targetArea.style.display = "none";
                    board.classList.remove("dial-revealed");
                }
            }, SWEEP_MS);
        } else {
            clearTimeout(sweepTimer);
            targetArea.style.display = "none";
            board.classList.remove("dial-revealed");
            setCoverNow(true);
        }
        wasRevealed = revealed;

        // The needle is only meaningful once the guessers have it.
        const guessing = state.isTargetVisible === false;
        needle.style.display = guessing || revealed ? "block" : "none";
        needle.style.transform = `rotate(${needleAngle}deg)`;
        describeNeedle(needleAngle);

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

            if (progressTrack && progressFill) {
                progressTrack.style.display = "block";
                progressFill.style.width = `${(Math.min(played, total) / total) * 100}%`;
                progressTrack.setAttribute("aria-valuemax", String(total));
                progressTrack.setAttribute("aria-valuenow", String(Math.min(played, total)));
            }
        } else {
            roundEl.style.display = "none";
            if (progressTrack) progressTrack.style.display = "none";
        }

        turnEl.textContent = revealed
            ? `${team.name}'s result`
            : guessing
                ? `${team.name} is guessing`
                : `${team.name} is giving the clue`;

        messageEl.textContent = revealed ? (state.lastRoundMessage || "") : "";

        if (state.gameOver) showFinalCard(state.teams);
        else hideFinalCard();

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
            const data = event.data || {};
            if (data.type === "needle") {
                if (data.from === "audience") return;   // Our own move, already drawn.
                needleAngle = data.angle;
                needle.style.transform = `rotate(${needleAngle}deg)`;
                return;
            }
            if (data.type === "score") {
                render();
                playScoreEffects(data.score, data.practice);
                return;
            }
            if (data.type === "celebrate") {
                render();
                const state = readState();
                if (state && state.teams) showFinalCard(state.teams, data.title);
                celebrate();
                return;
            }
            render();
        });
    }

    window.addEventListener("storage", (event) => {
        if (!event.key || event.key.startsWith("wavelength")) render();
    });





    // --- Final score card -------------------------------------------------
    const gameOverPanel = document.getElementById("audienceGameOver");
    const winnerEl = document.getElementById("audienceWinner");
    const finalScoresEl = document.getElementById("audienceFinalScores");

    function points(count) {
        return `${count} point${count === 1 ? "" : "s"}`;
    }

    function listNames(names) {
        if (names.length === 1) return names[0];
        return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    }

    // Mirrors the presenter's wording. Recomputed here rather than relying on
    // the broadcast, so a reload while the card is up still shows the result.
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

    function showFinalCard(teams, title) {
        if (!gameOverPanel) return;
        winnerEl.textContent = title || winnerText(teams);

        finalScoresEl.textContent = "";
        [...teams].sort((a, b) => b.score - a.score).forEach((team) => {
            const row = document.createElement("li");
            const name = document.createElement("span");
            name.textContent = team.name;
            const score = document.createElement("strong");
            score.textContent = String(team.score);
            row.append(name, score);
            finalScoresEl.appendChild(row);
        });

        gameOverPanel.style.display = "block";
        setTimeout(() => gameOverPanel.classList.add("show"), 10);
    }

    function hideFinalCard() {
        if (!gameOverPanel) return;
        gameOverPanel.classList.remove("show");
        setTimeout(() => { gameOverPanel.style.display = "none"; }, 300);
    }

    // --- Scoring animations -----------------------------------------------
    // Mirrors what the presenter plays: the points shower, a bull's-eye burst,
    // and the win celebration. The room is the audience for these, so they
    // matter more here than on the laptop.
    const container = document.querySelector(".audience-container");
    let confettiFire = null;

    function fireConfetti(options) {
        if (typeof confetti !== "function") return;
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        if (!confettiFire) {
            const canvas = document.createElement("canvas");
            canvas.id = "confettiCanvas";
            canvas.setAttribute("aria-hidden", "true");
            document.body.appendChild(canvas);
            confettiFire = confetti.create(canvas, { resize: true, useWorker: true });
        }
        confettiFire(options);
    }

    function showPoints(score) {
        if (!score || !container) return;
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

        const boardRect = board.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();

        for (let i = 0; i < score * 3; i++) {
            const popup = document.createElement("div");
            popup.textContent = `+${score}`;
            popup.className = "score-popup";
            popup.style.left = `${boardRect.left - containerRect.left + Math.random() * (boardRect.width * 0.8) + boardRect.width * 0.1}px`;
            popup.style.top = `${boardRect.top - containerRect.top + Math.random() * (boardRect.height * 0.7)}px`;
            popup.style.animationDelay = `${Math.random() * 0.8}s`;
            container.appendChild(popup);
            popup.addEventListener("animationend", () => popup.remove());
        }
    }

    const WIN_COLORS = ["#e07b39", "#eaa15c", "#a8cfc0", "#f3eee2", "#c4453f"];

    function celebrate() {
        const shared = { particleCount: 110, ticks: 260, gravity: 0.9, scalar: 1.2, colors: WIN_COLORS };
        fireConfetti({ ...shared, spread: 70, angle: 60, origin: { x: 0, y: 0.8 } });
        fireConfetti({ ...shared, spread: 70, angle: 120, origin: { x: 1, y: 0.8 } });
        setTimeout(() => fireConfetti({ ...shared, particleCount: 90, spread: 120, origin: { x: 0.5, y: 0.45 } }), 320);
    }

    function playScoreEffects(score, practice) {
        showPoints(score);
        if (score === 5) {
            fireConfetti({
                particleCount: 150, spread: 90, origin: { y: 0.6 },
                ticks: 200, gravity: 0.8, scalar: 1.2, colors: WIN_COLORS
            });
        }
        if (practice) return;
    }

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

    // The needle's position is otherwise only a rotation, which says nothing to
    // a screen reader. Describe it against the round's own two concepts, the
    // same way the game page does.
    function describeNeedle(angle) {
        const container = document.getElementById("needleContainer");
        if (!container) return;
        container.setAttribute("aria-valuenow", String(Math.round(angle)));

        const left = (document.getElementById("leftClue").textContent || "").trim();
        const right = (document.getElementById("rightClue").textContent || "").trim();
        const percent = Math.round(((angle + 90) / 180) * 100);

        let text;
        if (!left || !right) text = `${percent}% along the spectrum`;
        else if (percent === 50) text = `Centre, halfway between ${left} and ${right}`;
        else text = `${percent}% of the way from ${left} to ${right}`;
        container.setAttribute("aria-valuetext", text);
    }

    function sendNeedle(angle) {
        needleAngle = angle;
        needle.style.transform = `rotate(${angle}deg)`;
        describeNeedle(angle);
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
