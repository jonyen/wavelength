// Slow warp-speed starfield drawn on a canvas behind the game. Each star has a
// depth; every frame the depth shrinks so the star drifts outward from the
// center and grows, which reads as forward motion. No assets, no dependencies.
(function () {
    "use strict";

    const SPEED = 0.0009;         // Depth units per frame. A barely-there drift.
    const DEPTH = 1.6;            // How far back stars spawn.
    const STAR_AREA = 11000;      // One star per this many CSS pixels.
    const MAX_STARS = 320;
    const TRAIL_ALPHA = 0.85;     // Near-opaque: at this speed trails would just smear.

    const canvas = document.createElement("canvas");
    canvas.id = "starfield";
    canvas.setAttribute("aria-hidden", "true");
    document.body.insertBefore(canvas, document.body.firstChild);

    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    let stars = [];
    let width = 0;
    let height = 0;
    let centerX = 0;
    let centerY = 0;
    let frame = null;

    function makeStar(spreadDepth) {
        return {
            // A square spread wider than the viewport, so stars keep arriving
            // from beyond the edges rather than only from the middle.
            x: (Math.random() * 2 - 1) * 1.3,
            y: (Math.random() * 2 - 1) * 1.3,
            z: spreadDepth ? Math.random() * DEPTH + 0.15 : DEPTH,
            hue: Math.random() < 0.12 ? "rgba(168, 207, 192," : "rgba(255, 255, 255,"
        };
    }

    function resize() {
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        width = window.innerWidth;
        height = window.innerHeight;
        centerX = width / 2;
        centerY = height / 2;

        canvas.width = Math.floor(width * ratio);
        canvas.height = Math.floor(height * ratio);
        canvas.style.width = width + "px";
        canvas.style.height = height + "px";
        context.setTransform(ratio, 0, 0, ratio, 0, 0);

        const target = Math.min(MAX_STARS, Math.round((width * height) / STAR_AREA));
        stars = Array.from({ length: target }, () => makeStar(true));
        context.clearRect(0, 0, width, height);
    }

    function drawStatic() {
        context.clearRect(0, 0, width, height);
        stars.forEach((star) => {
            const scale = 1 / star.z;
            const x = centerX + star.x * scale * centerX;
            const y = centerY + star.y * scale * centerY;
            if (x < 0 || x > width || y < 0 || y > height) return;
            context.fillStyle = star.hue + "0.7)";
            context.fillRect(x, y, 1.4, 1.4);
        });
    }

    function step() {
        // Fade rather than clear, so each star leaves a short trail.
        context.fillStyle = "rgba(6, 10, 20," + TRAIL_ALPHA + ")";
        context.fillRect(0, 0, width, height);

        for (let i = 0; i < stars.length; i++) {
            const star = stars[i];
            star.z -= SPEED;

            if (star.z <= 0.12) {
                stars[i] = makeStar(false);
                continue;
            }

            const scale = 1 / star.z;
            const x = centerX + star.x * scale * centerX;
            const y = centerY + star.y * scale * centerY;

            if (x < -40 || x > width + 40 || y < -40 || y > height + 40) {
                stars[i] = makeStar(false);
                continue;
            }

            // Nearer stars are bigger and brighter.
            const size = Math.max(0.6, (1 - star.z / DEPTH) * 2.4);
            const alpha = Math.min(0.9, 0.15 + (1 - star.z / DEPTH) * 0.85);
            context.fillStyle = star.hue + alpha.toFixed(2) + ")";
            context.fillRect(x, y, size, size);
        }

        frame = window.requestAnimationFrame(step);
    }

    function start() {
        if (frame !== null) return;
        if (reduceMotion.matches) {
            drawStatic();
            return;
        }
        frame = window.requestAnimationFrame(step);
    }

    function stop() {
        if (frame === null) return;
        window.cancelAnimationFrame(frame);
        frame = null;
    }

    window.addEventListener("resize", () => {
        resize();
        if (reduceMotion.matches) drawStatic();
    });

    // Do not burn frames on a tab nobody is looking at.
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) stop();
        else start();
    });

    reduceMotion.addEventListener("change", () => {
        stop();
        start();
    });

    resize();
    start();
})();
