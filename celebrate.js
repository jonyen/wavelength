// The two confetti effects: a burst for a bull's-eye, and the sustained
// celebration behind the winner panel.
//
// Depends only on the canvas-confetti library, never on game state, so it lives
// apart from script.js.
(function () {
    "use strict";

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

    window.WavelengthCelebrate = { celebrateWin, triggerConfetti };
})();
