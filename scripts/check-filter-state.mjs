import fs from "node:fs";
import assert from "node:assert/strict";
import { state, resetFilters } from "../js/state.js";
import { filteredCards, pruneUnavailableFilters } from "../js/filters.js";

state.cards = [
  { id: 1, class: "Dragoncraft", cost: 1, setId: 10001, set: "Set A", type: "Follower", rarity: "Bronze", traits: ["Armed"], keywords: ["Rush"], deckSelectable: true, maxCopies: 3 },
  { id: 2, class: "Portalcraft", cost: 1, setId: 10001, set: "Set A", type: "Follower", rarity: "Bronze", traits: ["Artifact"], keywords: ["Rush"], deckSelectable: true, maxCopies: 3 },
  { id: 3, class: "Neutral", cost: 2, setId: 10002, set: "Set B", type: "Spell", rarity: "Silver", traits: ["Neutral Trait"], keywords: ["Draw"], deckSelectable: true, maxCopies: 3 }
];
state.includeNeutral = true;
state.selectedClass = "Dragoncraft";
for (const set of Object.values(state.filters)) set.clear();
state.filters.costs.add("1");
state.filters.types.add("Follower");
state.filters.sets.add("Set A");
state.filters.traits.add("Armed");
state.filters.keywords.add("Rush");

state.selectedClass = "Portalcraft";
pruneUnavailableFilters();
assert(state.filters.costs.has("1"), "Cost filter must carry across classes");
assert(state.filters.types.has("Follower"), "Valid type filter must carry across classes");
assert(state.filters.sets.has("Set A"), "Valid set filter must carry across classes");
assert(state.filters.keywords.has("Rush"), "Valid keyword filter must carry across classes");
assert(!state.filters.traits.has("Armed"), "Unavailable class-specific trait must be removed instead of becoming invisible");

state.filters.traits.add("Neutral Trait");
pruneUnavailableFilters();
assert(state.filters.traits.has("Neutral Trait"), "Neutral filters must stay valid while Neutral is included");
state.includeNeutral = false;
pruneUnavailableFilters();
assert(!state.filters.traits.has("Neutral Trait"), "Neutral-only filter must be removed when Neutral is disabled");

for (const set of Object.values(state.filters)) set.clear();
state.cards = [
  { id: 10, class: "Havencraft", cost: 2, setId: 10008, set: "Chronicle", type: "Follower", rarity: "Gold", traits: [], keywords: [], deckSelectable: true, maxCopies: 3 },
  { id: 11, class: "Neutral", cost: 3, setId: 10008, set: "Chronicle", type: "Follower", rarity: "Silver", traits: [], keywords: [], deckSelectable: true, maxCopies: 3 },
  { id: 12, class: "Havencraft", cost: 1, setId: 10000, set: "Basic", type: "Follower", rarity: "Bronze", traits: [], keywords: [], deckSelectable: true, maxCopies: 3 },
  { id: 13, class: "Havencraft", cost: 4, setId: 10008, set: "Chronicle", type: "Follower", rarity: "Gold", traits: [], keywords: [], deckSelectable: true, maxCopies: 3 }
];
state.cardMap = new Map(state.cards.map(card => [card.id, card]));
state.selectedClass = "Havencraft";
state.includeNeutral = false;
state.format = "Unlimited";
state.showGenerated = false;
state.showExcluded = false;
state.favoritesOnly = false;
state.globalExclusions = new Set();
state.excluded = new Set();
state.favorites = new Set();
state.owned = new Map([[10, 1], [11, 0], [12, 0], [13, 3]]);
state.ownedOnly = false;
state.missingOnly = true;

const missingIds = filteredCards({ sort: false }).map(card => card.id).sort((a, b) => a - b);
assert.deepEqual(missingIds, [10, 12], "Missing view must match Collection semantics: current class cards with owned copies below maxCopies");

state.includeNeutral = true;
const missingWithNeutral = filteredCards({ sort: false }).map(card => card.id).sort((a, b) => a - b);
assert.deepEqual(missingWithNeutral, [10, 11, 12], "Missing view must respect the normal Include Neutral filter");

state.missingOnly = false;
state.ownedOnly = true;
const ownedIds = filteredCards({ sort: false }).map(card => card.id).sort((a, b) => a - b);
assert.deepEqual(ownedIds, [10, 13], "Owned-only view must match Collection semantics: at least one tracked copy");

state.missingOnly = true;
state.ownedOnly = false;
resetFilters();
assert.equal(state.missingOnly, false, "Reset filters must clear missingOnly state");
assert.equal(state.ownedOnly, false, "Reset filters must clear ownedOnly state");

const qol = fs.readFileSync(new URL("../js/qol.js", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const formatControl = fs.readFileSync(new URL("../js/format-control.js", import.meta.url), "utf8");
assert(qol.includes('const FILTER_KEY = "svwb-filters";'), "Filters should use one global persisted state");
assert(!qol.includes("svwb-class-filters:"), "Per-class filter snapshots must no longer be restored");
assert(app.includes("function refreshFilterView()"), "Filter changes must have one synchronized render path");
assert(app.includes("pruneUnavailableFilters();"), "Class changes must prune invisible invalid filters");
assert(formatControl.includes("Missing cards only"), "Cards page Missing label must match Collection semantics");
assert(formatControl.includes("syncViewFilterInputs()"), "Late-mounted View controls must synchronize their checked state");
assert(formatControl.includes('document.getElementById("reset-filters")'), "Reset filters must synchronize late-mounted View controls");
assert(formatControl.includes("refreshViewFilters()"), "Late-mounted View controls must refresh through the normal filter path");
assert.equal((formatControl.match(/location\.reload\(\)/g) ?? []).length, 1, "Only the Format selector may reload; View filters must update in-place");

console.log("Filter state + Collection-style ownership View filters + reset synchronization regression: OK");
