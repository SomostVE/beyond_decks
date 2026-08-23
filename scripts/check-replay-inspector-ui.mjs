import fs from "node:fs";
import assert from "node:assert/strict";

const read = path => fs.readFileSync(path, "utf8");
const version = JSON.parse(read("version.json")).version;
const inspector = read("js/battle-replay-inspector.js");
const inspectorCss = read("css/battle-replay-inspector.css");
const readabilityCss = read("css/readability-fixes.css");
const battleHtml = read("battle.html");
const battleJs = read("js/battle.js");
const collectionHtml = read("collection.html");
const labHtml = read("lab.html");
const enginesHtml = read("engines.html");
const toolNav = read("js/tool-page-nav.js");
const toolsMobile = read("css/tools-mobile.css");
const toolHeaderCss = read("css/tool-header.css");
const baseCss = read("css/base.css");
const mobileUi = read("js/mobile-ui.js");
const mobileMenuCss = read("css/mobile-menu.css");
const mobileNavCss = read("css/mobile-nav.css");
const collectionUi = read("js/collection-ui.js");
const decisionSummary = read("js/battle-decision-summary.js");
const versionGuard = read("js/version-guard.js");

assert.match(version, /^01\.05\.\d{3}$/, "Battle Sim UI must remain on the 01.05 release line");

for (const tab of ["action", "changes", "decision", "state"]) {
  assert.match(inspector, new RegExp(`data-inspector-tab=\\"${tab}\\"`), `Missing Replay Inspector ${tab} tab`);
}

for (const filter of ["all", "play", "attack", "evolve", "turn", "draw"]) {
  assert.match(inspector, new RegExp(`\\[\\"${filter}\\"`), `Missing replay timeline ${filter} filter`);
}

assert.match(inspector, /captureRenderedFrame/, "Replay Inspector must capture rendered frame state");
assert.match(inspector, /renderChanges/, "Replay Inspector must compare adjacent frames");
assert.match(inspector, /Observed decision context only/, "Decision tab must remain explanatory rather than strengthening the AI");
assert.match(inspector, /classMechanics:/, "Replay Inspector must capture class-specific visible mechanics");
assert.match(inspectorCss, /\.battle-inspector-state-grid/, "Replay Inspector responsive styles are missing");

for (const href of ["\.\/index\.html", "\.\/collection\.html", "\.\/battle\.html"]) {
  assert.match(toolNav, new RegExp(href), `Shared tool navigation is missing ${href}`);
}
assert.match(toolsMobile, /\.tools-mobile-nav/, "Tool-page mobile navigation styles are missing");
assert.match(toolNav, /ensureStylesheet\("\.\/css\/tool-header\.css"/, "Tool pages must load the unified header stylesheet without a stale release suffix");
assert.match(baseCss, /\.button\s*\{[\s\S]*?text-decoration:\s*none;/, "Button links must not use browser-default underlines");
assert.match(toolHeaderCss, /\.tools-header \.tools-title[\s\S]*?border:[\s\S]*?background:/, "Current tool page must render as an active header pill");
assert.match(toolHeaderCss, /text-decoration:\s*none\s*!important;/, "Tool header links must explicitly suppress underlines");
assert.match(collectionUi, /import "\.\/tool-page-nav\.js";/, "Collection must load shared tool navigation without a stale release suffix");
assert.match(decisionSummary, /import "\.\/battle-replay-inspector\.js";/, "Battle Sim must load Replay Inspector without a stale release suffix");

assert.match(mobileUi, /mobile-primary-nav/, "Main mobile drawer must expose primary page navigation");
assert.match(mobileUi, /href=\"\.\/collection\.html\"/, "Main mobile UI must link directly to Collection");
assert.match(mobileUi, /href=\"\.\/battle\.html\"/, "Main mobile UI must link directly to Battle Sim");
assert.match(mobileUi, /mobile-brand\">Beyond Decks</, "Mobile header must use the Beyond Decks name");
assert.doesNotMatch(mobileUi, /Deci Builder/, "Legacy Deci Builder branding must not remain in the mobile header");
assert.match(versionGuard, /replaceAll\("Deci Builder", "Beyond Decks"\)/, "Page titles must normalize legacy Deci Builder titles to Beyond Decks");
assert.match(versionGuard, /\[Beyond Decks\] Version/, "Version logging must use the Beyond Decks name");
assert.match(mobileMenuCss, /\.mobile-drawer-head,\s*\.mobile-primary-nav\s*\{\s*display:\s*none;/, "Mobile drawer navigation must stay hidden on desktop");
assert.match(mobileNavCss, /repeat\(5, minmax\(0, 1fr\)\)/, "Main mobile bottom navigation must support five destinations");

assert.match(readabilityCss, /\.collection-body \.collection-tabs[\s\S]*position:\s*static/, "Collection tabs must not float over cards on mobile");
assert.match(readabilityCss, /\.battle-body \.battle-action[\s\S]*font-size:\s*\.95rem/, "Battle action text must be enlarged");
assert.match(readabilityCss, /\.battle-body \.battle-inspector-primary[\s\S]*font-size:\s*\.92rem/, "Replay Inspector primary text must be enlarged");
assert.ok(battleHtml.includes(`readability-fixes.css?v=${version}`), "Battle Sim must load the current readability stylesheet");
assert.ok(collectionHtml.includes(`readability-fixes.css?v=${version}`), "Collection must load the current mobile readability fixes");
assert.match(battleHtml, /Battle Sim · Beyond Decks/, "Battle Sim browser title must use Beyond Decks");
assert.match(labHtml, /Deck Lab · Beyond Decks/, "Deck Lab browser title must use Beyond Decks");
assert.match(enginesHtml, /Deck Engines · Beyond Decks/, "Deck Engines browser title must use Beyond Decks");
assert.match(labHtml, /href="\.\/battle\.html">Battle Sim<\/a>/, "Deck Lab desktop navigation must link to Battle Sim");
assert.match(enginesHtml, /href="\.\/battle\.html">Battle Sim<\/a>/, "Deck Engines desktop navigation must link to Battle Sim");
for (const module of ["version-guard", "battle", "battle-decision-summary", "battle-benchmark-fast"]) {
  assert.ok(battleHtml.includes(`./js/${module}.js?v=${version}`), `Battle Sim must load ${module}.js with the current app version`);
}

assert.match(battleJs, /<span>Evo \$\{player\.ep\}<\/span>/, "Battle board must display Evo instead of EP");
assert.match(battleJs, /<span>Super Evo \$\{player\.sep\}<\/span>/, "Battle board must display Super Evo instead of SEP");
assert.match(battleJs, /battle-class-mechanic/, "Battle board must display only the active class mechanic resources");
assert.doesNotMatch(battleJs, /<span>Shadows \$\{player\.shadows/, "Shadows must not be displayed globally for every class");
assert.match(battleJs, /resolveDeckClass\(player\.deck, state\.cardMap, player\.class\)/, "Battle setup must validate the selected leader class");
assert.match(battleJs, /playerClass:\s*player\.class/, "Battle simulation must pass the player class into the rules engine");
assert.match(battleJs, /opponentClass:\s*opponent\.class/, "Battle simulation must pass the opponent class into the rules engine");
assert.match(inspector, /\["Evo", side\.ep\]/, "Replay Inspector state must display Evo");
assert.match(inspector, /\["Super Evo", side\.sep\]/, "Replay Inspector state must display Super Evo");
assert.match(inspector, /\(\?:Evo\|EP\)/, "Replay Inspector must accept legacy EP snapshots while reading Evo");
assert.match(inspector, /\(\?:Super Evo\|SEP\)/, "Replay Inspector must accept legacy SEP snapshots while reading Super Evo");

console.log("Replay Inspector + class-aware Battle UI + unified tool header regression: OK");
