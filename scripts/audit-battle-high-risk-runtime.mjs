import fs from "node:fs/promises";
import { analyzeCardSupport, inspectHighRiskCandidateResolution } from "../js/battle-engine-v5.js";
import { loadBattleV5SourceCorpus } from "./battle-v5-source-corpus.mjs";

const cards = JSON.parse(await fs.readFile(new URL("../data/official/cards.json", import.meta.url), "utf8"));
const norm = value => String(value ?? "").toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
const highRiskPatterns = [
  /activates in hand/i,
  /whenever|once on each/i,
  /\bcrest\b/i,
  /\bfuse\b|\bengage\b|\bfaith\b|\binvoke\b/i,
  /skybound art/i,
  /exact copy|add a copy|summon a copy|transform .* copy|copy of/i,
  /replace your deck|apocalypse deck|victory card/i,
  /activate .*random abilities|replicate the effects|activate its fanfare/i,
  /highest base costs|sum of the .* base costs|opponent'?s hand|opponent'?s deck/i,
  /can'?t take more than|prevent .*damage|takes .* more damage/i,
  /different(?:ly)? named .* this match|entered the field this match|destroyed this match/i,
  /super-evolves|super-evolve/i,
  /when .* evolves|whenever .* evolves/i,
  /select (?:a|one|two|three|\d+) modes?/i,
  /discard (?:your hand|\d+|.* hand).*draw/i,
  /at the (?:start|end) of (?:your|the opponent'?s) turn/i
];

const scriptNames = (await fs.readdir(new URL("./", import.meta.url)))
  .filter(name => /^check-battle-.*\.mjs$/i.test(name));
const checkCorpus = (await Promise.all(scriptNames.map(name => fs.readFile(new URL(name, import.meta.url), "utf8")))).join("\n").toLowerCase();
const engineV5 = (await loadBattleV5SourceCorpus()).toLowerCase();
const engineV4 = (await fs.readFile(new URL("../js/battle-engine-v4.js", import.meta.url), "utf8")).toLowerCase();

const candidateCards = cards.filter(card => {
  if (analyzeCardSupport(card).level !== "full") return false;
  if (!highRiskPatterns.some(pattern => pattern.test(String(card.text ?? "")))) return false;
  const name = norm(card.name);
  if (checkCorpus.includes(name)) return false;
  const explicitNeedle = `["${name}"`;
  if (engineV5.includes(explicitNeedle) || engineV4.includes(explicitNeedle)) return false;
  return true;
});
const candidateIds = candidateCards.map(card => Number(card.id));

const results = inspectHighRiskCandidateResolution({ cards, cardIds: candidateIds });
const unresolved = results.filter(row => row.unresolved);
console.log(`Runtime generic high-risk probe: ${candidateIds.length} cards · ${results.length} event/mode sections · ${unresolved.length} unresolved sections`);
for (const row of unresolved) {
  const raw = String(row.raw ?? "").replace(/\s+/g, " ").trim();
  console.log(`UNRESOLVED|${row.className}|${row.id}|${row.name}|${row.event}|mode=${row.modeIndex}|${raw}`);
}
if (unresolved.length) {
  console.log("\nFULL SOURCE TEXT FOR UNRESOLVED CARDS");
  const ids = new Set(unresolved.map(row => row.id));
  for (const card of candidateCards.filter(card => ids.has(Number(card.id)))) {
    console.log(`FULLTEXT|${card.class}|${card.id}|${card.name}|${String(card.text ?? "").replace(/\s+/g, " ").trim()}`);
  }
}
console.log("\nResolved sections by card:");
for (const card of candidateCards) {
  const rows = results.filter(row => row.id === Number(card.id));
  const bad = rows.filter(row => row.unresolved).length;
  console.log(`${card.id}|${card.name}|${rows.length - bad}/${rows.length} resolved`);
}

if (unresolved.length) {
  throw new Error(`Generic high-risk runtime audit still has ${unresolved.length} unresolved section(s).`);
}
console.log(`Generic high-risk runtime gate: ${candidateIds.length}/${candidateIds.length} cards resolved.`);
