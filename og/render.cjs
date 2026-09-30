#!/usr/bin/env node
// Regenerates the link-preview assets at the repository root:
//
//   og-image.png          1200x630, from og/template.html
//   apple-touch-icon.png  180x180, from favicon.svg
//
// Needs Playwright (either package) resolvable and a Chromium it can launch:
//
//   npm i --no-save playwright-core && node og/render.cjs
//
// Set CHROMIUM_PATH to use a specific browser binary. Both PNGs are committed;
// nothing runs this at deploy time.
const fs = require("node:fs");
const path = require("node:path");

let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require("playwright-core")); }

const root = path.join(__dirname, "..");
const executablePath = process.env.CHROMIUM_PATH
    || (fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

(async () => {
    const browser = await chromium.launch(executablePath ? { executablePath } : {});
    try {
        const og = await browser.newPage({ viewport: { width: 1200, height: 630 } });
        await og.goto("file://" + path.join(__dirname, "template.html"), { waitUntil: "networkidle" });
        await og.evaluate(() => document.fonts.ready);
        await og.screenshot({ path: path.join(root, "og-image.png") });

        // The favicon's own rounded corners would leave transparent notches, and
        // iOS applies its own mask, so render it over a full-bleed background.
        const svg = fs.readFileSync(path.join(root, "favicon.svg"), "utf8");
        const icon = await browser.newPage({ viewport: { width: 180, height: 180 } });
        await icon.setContent(
            `<style>html,body{margin:0;background:#0b1120}svg{display:block;width:180px;height:180px}</style>${svg}`
        );
        await icon.screenshot({ path: path.join(root, "apple-touch-icon.png") });
    } finally {
        await browser.close();
    }
})();
