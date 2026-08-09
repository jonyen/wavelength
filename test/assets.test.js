// Run with: node --test
//
// The site has no build step, so every asset URL carries a hand-written ?v=
// that must match in three places: the page that loads it, the service worker's
// precache list, and the file on disk. Getting that wrong fails silently — the
// worker keeps serving a stale file and only returning players see it, which is
// close to impossible to reproduce. These tests do the checking instead.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const PAGES = ["index.html", "admin.html", "audience.html"];

const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

// Local (non-external, non-absolute) href/src values, with their ?v= intact.
function localAssets(html) {
    return [...html.matchAll(/(?:href|src)="([^"]+)"/g)]
        .map((m) => m[1])
        .filter((url) => !/^(https?:|data:|mailto:|#|\/)/.test(url));
}

const stripVersion = (url) => url.split("?")[0].replace(/^\.\//, "");

function precache() {
    const sw = read("sw.js");
    const list = sw.slice(sw.indexOf("urlsToCache"), sw.indexOf("];"));
    return [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

test("every asset a page references exists on disk", () => {
    for (const page of PAGES) {
        for (const url of localAssets(read(page))) {
            const file = stripVersion(url);
            assert.ok(
                fs.existsSync(path.join(root, file)),
                `${page} references ${url}, but ${file} does not exist`
            );
        }
    }
});

test("the service worker precaches every versioned asset the pages load", () => {
    // A file missing from the list is fetched from the network on every visit
    // and is unavailable offline — the opposite of what the worker is for.
    const cached = new Set(precache().map(stripVersion));
    for (const page of PAGES) {
        for (const url of localAssets(read(page))) {
            if (!url.includes("?v=")) continue;
            const file = stripVersion(url);
            assert.ok(cached.has(file), `${file} is loaded by ${page} but is not in the sw.js precache list`);
        }
    }
});

test("asset versions match between the pages and the service worker", () => {
    // The silent failure this catches: bumping ?v= in the HTML but not in
    // sw.js, so the worker precaches the old file and serves it back.
    const swVersions = new Map();
    for (const url of precache()) {
        if (url.includes("?v=")) swVersions.set(stripVersion(url), url.split("?v=")[1]);
    }

    for (const page of PAGES) {
        for (const url of localAssets(read(page))) {
            if (!url.includes("?v=")) continue;
            const file = stripVersion(url);
            const pageVersion = url.split("?v=")[1];
            assert.equal(
                swVersions.get(file),
                pageVersion,
                `${file} is v${pageVersion} in ${page} but v${swVersions.get(file)} in sw.js`
            );
        }
    }
});

test("the same asset is loaded at the same version by every page", () => {
    const seen = new Map();
    for (const page of PAGES) {
        for (const url of localAssets(read(page))) {
            if (!url.includes("?v=")) continue;
            const file = stripVersion(url);
            const version = url.split("?v=")[1];
            const previous = seen.get(file);
            if (previous) {
                assert.equal(version, previous.version,
                    `${file} is v${version} in ${page} but v${previous.version} in ${previous.page}`);
            } else {
                seen.set(file, { version, page });
            }
        }
    }
});

test("the precache list points only at files that exist", () => {
    for (const url of precache()) {
        if (/^https?:/.test(url) || url === "./") continue;
        const file = stripVersion(url);
        assert.ok(fs.existsSync(path.join(root, file)), `sw.js precaches ${url}, which does not exist`);
    }
});

test("the deck generator rewrites asset paths by type, not by name", () => {
    // An allowlist of filenames silently skipped every file added later, so a
    // regenerated deck 404'd on the new script and its game died on load.
    const generator = read("tools-make-deck.py");
    assert.ok(
        !/style\\\.css\|script\\\.js/.test(generator),
        "tools-make-deck.py is matching assets by filename again; a new file will be skipped silently"
    );
    assert.ok(/ASSET\s*=/.test(generator), "tools-make-deck.py should match assets by extension");
});

test("a deck's own pages stay relative so they resolve inside the deck", () => {
    // index.html links to the audience screen. Rewritten to ../audience.html it
    // would send a deck's presenter to the root deck's audience window.
    const generator = read("tools-make-deck.py");
    const assetGroup = generator.match(/ASSET\s*=\s*r?"([^"]+)"/);
    assert.ok(assetGroup, "could not find the generator's asset extension list");
    assert.ok(
        !assetGroup[1].split("|").includes("html"),
        "html must not be rewritten to ../ or in-deck navigation escapes the deck"
    );
});
