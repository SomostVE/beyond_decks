import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { analyzeCardSupport, inspectHighRiskCandidateResolution } from "../js/battle-engine-v5.js";

const CODEX_URL = "https://raw.githubusercontent.com/SomostVE/beyond_codex/main/api/v1/cards.json";
const LOCAL = new URL("../data/official/cards.json", import.meta.url);
const EXPECTED_CREST_COUNT = 59;

async function loadCards() {
  try {
    const response = await fetch(CODEX_URL, { headers: { "cache-control": "no-cache" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const cards = await response.json();
    console.log(`Crest audit source: Beyond Codex (${cards.length} cards)`);
    return cards;
  } catch (error) {
    const cards = JSON.parse(await fs.readFile(LOCAL, "utf8"));
    console.log(`Crest audit source: local fallback (${cards.length} cards) · ${error.message}`);
    return cards;
  }
}

const cards = await loadCards();
const crestCards = cards.filter(card => /\bcrest\b/i.test(`${card.text ?? ""}\n${card.rawSkillText ?? ""}\n${(card.keywords ?? []).join("\n")}`));
const runtimeSources = ["js/battle-engine-v5-runtime.js", "js/battle-rules.js", "js/battle-rules-core.js"];
const testSources = (await fs.readdir(new URL("./", import.meta.url)))
  .filter(name => name.endsWith(".mjs") && (name.startsWith("check-battle-") || name.startsWith("audit-battle-")))
  .map(name => `scripts/${name}`);
const runtimeText = (await Promise.all(runtimeSources.map(path => fs.readFile(new URL(`../${path}`, import.meta.url), "utf8")))).join("\n").toLowerCase();
const testText = (await Promise.all(testSources.map(path => fs.readFile(new URL(`../${path}`, import.meta.url), "utf8")))).join("\n").toLowerCase();

const ids = crestCards.map(card => Number(card.id));
const probes = inspectHighRiskCandidateResolution({ cards, cardIds: ids }).filter(row => row.event === "base" || row.event === "evolved");
const probesById = new Map();
for (const row of probes) {
  if (!probesById.has(Number(row.id))) probesById.set(Number(row.id), []);
  probesById.get(Number(row.id)).push(row);
}

const rows = crestCards.map(card => {
  const support = analyzeCardSupport(card);
  const sourceNeedle = String(card.name ?? "").toLowerCase();
  const cardProbes = probesById.get(Number(card.id)) ?? [];
  return {
    id: Number(card.id),
    name: card.name,
    className: card.class,
    support: support.level,
    reason: support.reason,
    runtimeMention: runtimeText.includes(sourceNeedle),
    directTestMention: testText.includes(sourceNeedle),
    probeCount: cardProbes.length,
    genericProbeUnresolved: cardProbes.filter(row => row.unresolved).length,
    text: String(card.text ?? "").replace(/\s+/g, " ").trim()
  };
});

const byClass = new Map();
for (const row of rows) byClass.set(row.className, (byClass.get(row.className) ?? 0) + 1);
console.log("=== CREST INVENTORY ===");
console.log(`Crest-bearing cards: ${rows.length}`);
for (const [className, count] of [...byClass.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])))) {
  console.log(`${className}: ${count}`);
}

for (const row of [...rows].sort((a, b) => String(a.className).localeCompare(String(b.className)) || a.name.localeCompare(b.name))) {
  console.log(`CREST|${row.className}|${row.id}|${row.name}|support=${row.support}|runtime=${row.runtimeMention ? "yes" : "no"}|direct-test=${row.directTestMention ? "yes" : "no"}|generic-probes=${row.probeCount}|generic-unresolved=${row.genericProbeUnresolved}|TEXT=${row.text}`);
}

const runtimeGaps = rows.filter(row => row.support !== "full" || !row.runtimeMention);
const directNamed = rows.filter(row => row.directTestMention).length;
const genericProbeFlags = rows.filter(row => row.genericProbeUnresolved > 0);

console.log(`Direct card-name test evidence: ${directNamed}/${rows.length} (informational; class and Crest lifecycle regressions provide shared behavior locks)`);
console.log(`Generic probe flags: ${genericProbeFlags.length} (informational; strict high-risk runtime gate validates candidate resolution separately)`);
console.log(`Actual Crest runtime gaps: ${runtimeGaps.length}`);
for (const row of runtimeGaps) {
  console.error(`CREST_RUNTIME_GAP|${row.className}|${row.id}|${row.name}|support=${row.support}|runtime=${row.runtimeMention}`);
}

assert.equal(rows.length, EXPECTED_CREST_COUNT, `Beyond Codex Crest inventory changed from ${EXPECTED_CREST_COUNT}; review every new/removed Crest before updating this gate`);
assert.equal(runtimeGaps.length, 0, "Every Crest-bearing card must be Full and have explicit runtime handling evidence");

console.log(`Crest audit pass: ${rows.length}/${rows.length} Crest-bearing cards Full with runtime evidence · ${byClass.size}/8 classes covered · 0 runtime gaps`);
