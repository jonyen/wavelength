// Run with: node --test
//
// Visit counting. Every page a visitor can stay on loads GoatCounter once, for
// the wavelength site, pinned by SRI, and reports the one path "/", so a group
// that opens the audience screen or the clue editor still counts as one visit.
// The service worker must leave GoatCounter's requests to the network: never
// answered from its cache, never stored in it.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

// The retired /julie pages are not listed: they redirect to the home page at
// once, and the visit is counted there.
const PAGES = ["index.html", "admin.html", "audience.html", "about.html",
    "privacy.html", "terms.html", "changelog.html"];
const TAGS = /<script\b[^>]*\bdata-goatcounter="[^"]*"[^>]*><\/script>/g;

test("every page loads GoatCounter once, for the wavelength site, pinned by SRI", () => {
    for (const page of PAGES) {
        const tags = read(page).match(TAGS) ?? [];
        assert.equal(tags.length, 1, `${page} should load GoatCounter exactly once`);
        const tag = tags[0];
        assert.ok(tag.includes('data-goatcounter="https://jonyen-wavelength.goatcounter.com/count"'), page);
        assert.ok(tag.includes('src="https://gc.zgo.at/count.v5.js"'), page);
        assert.ok(tag.includes('crossorigin="anonymous"'), page);
        assert.ok(tag.includes(
            'integrity="sha384-atnOLvQb9t+jTSipvd75X2yginT4PjVbqDdlJAmxMm+wYElFmeR6EmLP5bYeoRVQ"'), page);
        const settings = tag.match(/data-goatcounter-settings='([^']*)'/);
        assert.ok(settings, `${page} should set data-goatcounter-settings`);
        assert.deepEqual(JSON.parse(settings[1]), { path: "/" }, page);
    }
});

test("every top-level page is on the counted list", () => {
    // A page added later has to be counted too, or deliberately left out here.
    const pages = fs.readdirSync(root).filter((file) => file.endsWith(".html"));
    assert.deepEqual(pages.sort(), [...PAGES].sort());
});

test("the service worker leaves GoatCounter's requests to the network", () => {
    const handlers = {};
    const sandbox = {
        self: { addEventListener: (type, fn) => { handlers[type] = fn; }, skipWaiting() {}, clients: { claim() {} } },
        caches: { match: async () => undefined, open: async () => ({ put() {}, addAll: async () => {} }), keys: async () => [] },
        fetch: async () => ({ clone() { return this; } }),
        URL,
        console,
    };
    vm.runInNewContext(read("sw.js"), sandbox);
    const answered = (url, method) => {
        let used = false;
        handlers.fetch({
            request: { url, method, mode: "no-cors", headers: { get: () => "*/*" } },
            respondWith() { used = true; },
        });
        return used;
    };
    assert.equal(answered("https://gc.zgo.at/count.v5.js", "GET"), false, "the script");
    assert.equal(answered("https://jonyen-wavelength.goatcounter.com/count?p=%2F&rnd=x1", "POST"), false, "the beacon");
    assert.equal(answered("https://jonyen-wavelength.goatcounter.com/count?p=%2F&rnd=x1", "GET"), false, "the image fallback");
    assert.equal(answered("https://wavelength.jonyen.com/style.css?v=76", "GET"), true, "the game's own assets");
});
