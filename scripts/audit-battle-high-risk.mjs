import fs from "node:fs/promises";
import { analyzeCardSupport } from "../js/battle-engine-v5.js";
import { loadBattleV5SourceCorpus } from "./battle-v5-source-corpus.mjs";

const cards = JSON.parse(await fs.readFile(new URL("../data/official/cards.json", import.meta.url), "utf8"));
const cardMap = new Map(cards.map(card => [Number(card.id), card]));
for (const card of cards) {
  card.__relatedCardObjects = (card.relatedCards ?? []).map(id => cardMap.get(Number(id))).filter(Boolean);
  card.__relatedNames = card.__relatedCardObjects.map(item => item.name);
}

const scriptNames = (await fs.readdir(new URL("./", import.meta.url)))
  .filter(name => /^check-battle-.*\.mjs$/i.test(name));
const scriptCorpus = new Map();
for (const name of scriptNames) {
  scriptCorpus.set(name, (await fs.readFile(new URL(name, import.meta.url), "utf8")).toLowerCase());
}
const engineV5 = (await loadBattleV5SourceCorpus()).toLowerCase();
const engineV4 = (await fs.readFile(new URL("../js/battle-engine-v4.js", import.meta.url), "utf8")).toLowerCase();

const norm = value => String(value ?? "").toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
const oneLine = value => String(value ?? "").replace(/\s*\n+\s*/g, " ⏎ ").replace(/\s+/g, " ").trim();

const categories = [
  ["hand-trigger", /activates in hand/i],
  ["reactive", /whenever|once on each/i],
  ["crest", /\bcrest\b/i],
  ["fuse", /\bfuse\b/i],
  ["engage", /\bengage\b/i],
  ["faith", /\bfaith\b/i],
  ["invoke", /\binvoke\b/i],
  ["skybound", /skybound art/i],
  ["copy-transform", /exact copy|add a copy|summon a copy|transform .* copy|copy of/i],
  ["deck-replacement", /replace your deck|apocalypse deck|victory card/i],
  ["random-replication", /activate .*random abilities|replicate the effects|activate its fanfare/i],
  ["cross-zone", /highest base costs|sum of the .* base costs|opponent'?s hand|opponent'?s deck/i],
  ["damage-modifier", /can'?t take more than|prevent .*damage|takes .* more damage/i],
  ["match-history", /different(?:ly)? named .* this match|entered the field this match|destroyed this match/i],
  ["super-evolve", /super-evolves|super-evolve/i],
  ["evolve-trigger", /when .* evolves|whenever .* evolves/i],
  ["mode", /select (?:a|one|two|three|\d+) modes?/i],
  ["discard-redraw", /discard (?:your hand|\d+|.* hand).*draw/i],
  ["turn-hook", /at the (?:start|end) of (?:your|the opponent'?s) turn/i]
];
const criticalCategories = new Set(["copy-transform", "random-replication", "cross-zone", "match-history", "damage-modifier", "deck-replacement"]);

const classOrder = ["Forestcraft", "Swordcraft", "Runecraft", "Dragoncraft", "Abysscraft", "Havencraft", "Portalcraft", "Neutral"];
const rows = cards
  .map(card => ({ card, support: analyzeCardSupport(card) }))
  .filter(row => row.support.level === "full")
  .map(row => {
    const text = String(row.card.text ?? "");
    const risks = categories.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
    const name = norm(row.card.name);
    const testFiles = [...scriptCorpus.entries()].filter(([, corpus]) => corpus.includes(name)).map(([file]) => file);
    return {
      ...row,
      risks,
      testFiles,
      directTest: testFiles.length > 0,
      explicitV5: engineV5.includes(name),
      explicitV4: engineV4.includes(name)
    };
  })
  .filter(row => row.risks.length > 0);

console.log("=== BATTLE SIM HIGH-RISK AUDIT ===");
console.log(`High-risk Full cards: ${rows.length}`);
console.log(`Direct card-name test evidence: ${rows.filter(row => row.directTest).length}`);
console.log(`No direct card-name test evidence: ${rows.filter(row => !row.directTest).length}`);

console.log("\nBY CLASS");
for (const className of classOrder) {
  const selected = rows.filter(row => row.card.class === className);
  console.log(`${className}: ${selected.length} high-risk · ${selected.filter(row => row.directTest).length} direct-tested · ${selected.filter(row => !row.directTest).length} without direct card-name evidence`);
}

console.log("\nBY RISK CATEGORY");
for (const [label] of categories) {
  const selected = rows.filter(row => row.risks.includes(label));
  console.log(`${label}: ${selected.length} · ${selected.filter(row => row.directTest).length} direct-tested · ${selected.filter(row => !row.directTest).length} without direct evidence`);
}

console.log("\nCRITICAL GENERIC FULL CARDS");
const criticalGeneric = rows.filter(row =>
  !row.directTest && !row.explicitV5 && !row.explicitV4 && row.risks.some(risk => criticalCategories.has(risk))
);
console.log(`Critical generic candidates: ${criticalGeneric.length}`);
for (const row of criticalGeneric) {
  console.log(`CRITICAL|${row.card.class}|${row.card.id}|${row.card.name}|risk=${row.risks.join(",")}|TEXT=${oneLine(row.card.text)}`);
}

console.log("\nCARDS WITHOUT DIRECT CARD-NAME TEST EVIDENCE");
for (const row of rows.filter(row => !row.directTest)) {
  console.log(`UNPROVEN|${row.card.class}|${row.card.id}|${row.card.name}|risk=${row.risks.join(",")}|v5=${row.explicitV5 ? "yes" : "no"}|v4=${row.explicitV4 ? "yes" : "no"}|${row.support.reason}`);
}

console.log("\nDIRECT-TESTED HIGH-RISK CARDS");
for (const row of rows.filter(row => row.directTest)) {
  console.log(`PROVEN|${row.card.class}|${row.card.id}|${row.card.name}|risk=${row.risks.join(",")}|tests=${row.testFiles.join(",")}`);
}
