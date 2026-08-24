import fs from "node:fs";
import assert from "node:assert/strict";

const read = path => fs.readFileSync(path, "utf8");
const version = JSON.parse(read("version.json")).version;
const codex = read("js/codex-client.js");
const loader = read("js/data-loader.js");
const report = read("js/update-report.js");
const serviceWorker = read("sw.js");
const syncScript = read("scripts/sync-beyond-codex.mjs");
const validationWorkflow = read(".github/workflows/validate-site.yml");
const referenceWorkflow = read(".github/workflows/update-reference-decks.yml");

assert.match(version, /^01\.05\.\d{3}$/, "Beyond Codex integration must remain on the 01.05 application line");
assert.match(codex, /somostve\.github\.io\/beyond_codex\/api\/v1/, "Beyond Decks must prefer the Beyond Codex GitHub Pages API");
assert.match(codex, /raw\.githubusercontent\.com\/SomostVE\/beyond_codex\/main\/api\/v1/, "Beyond Decks must retain a second remote Codex endpoint");
assert.doesNotMatch(codex, /LOCAL_OFFICIAL_BASE|\.\/data\/official/, "Runtime official data must not fall back to a stale embedded snapshot");
assert.match(codex, /validateSnapshot/, "Beyond Decks must validate the Codex manifest/card snapshot contract");
assert.match(loader, /loadOfficialCardData/, "Main data loader must use the Beyond Codex client");
assert.doesNotMatch(loader, /extractOfficialKeywords/, "Beyond Decks must not re-parse official keywords owned by Codex");
assert.match(loader, /Beyond Codex owns official keyword extraction/, "Data loader must document the normalization ownership boundary");
assert.match(report, /loadOfficialChangelog/, "Update report must use the Beyond Codex changelog");
assert.match(serviceWorker, /CODEX_API_PATH = "\/beyond_codex\/api\/"/, "Service worker must identify the same-origin Codex API path");
assert.match(serviceWorker, /url\.pathname\.startsWith\(CODEX_API_PATH\)[\s\S]*?fetch\(request, \{ cache: "no-store" \}\)/, "Codex API requests must bypass the application cache");
assert.equal(fs.existsSync("scripts/update-cards.mjs"), false, "Official card updater belongs in Beyond Codex, not Beyond Decks");
assert.equal(fs.existsSync(".github/workflows/update-cards.yml"), false, "Official card update workflow belongs in Beyond Codex");
assert.equal(fs.existsSync("scripts/sync-beyond-codex.mjs"), true, "Battle CI must have a transient Codex snapshot sync helper");
assert.match(syncScript, /raw\.githubusercontent\.com\/SomostVE\/beyond_codex/, "CI sync must read Beyond Codex rather than the official Shadowverse API");
assert.match(validationWorkflow, /node scripts\/sync-beyond-codex\.mjs/, "Site validation must refresh its test snapshot before Battle audits");
assert.equal(fs.existsSync(".github/workflows/update-reference-decks.yml"), true, "Beyond Decks must retain its application-specific reference deck updater");
assert.doesNotMatch(referenceWorkflow, /schedule:/, "Beyond Decks must not run a weekly official-data schedule");
assert.doesNotMatch(referenceWorkflow, /scripts\/update-cards\.mjs/, "Reference deck workflow must not call the removed official card updater");

console.log(`Beyond Codex ownership regression: OK · Beyond Decks ${version}`);
