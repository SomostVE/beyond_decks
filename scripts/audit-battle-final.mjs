import fs from "node:fs/promises";
import { analyzeCardSupport } from "../js/battle-engine-v5.js";
import { loadBattleV5SourceCorpus } from "./battle-v5-source-corpus.mjs";

const cards = JSON.parse(await fs.readFile(new URL("../data/official/cards.json", import.meta.url), "utf8"));
const cardMap = new Map(cards.map(card => [Number(card.id), card]));
for (const card of cards) {
  card.__relatedCardObjects = (card.relatedCards ?? []).map(id => cardMap.get(Number(id))).filter(Boolean);
  card.__relatedNames = card.__relatedCardObjects.map(item => item.name);
}

const scriptNames = (await fs.readdir(new URL("./", import.meta.url))).filter(name => /^check-battle-.*\.mjs$/i.test(name));
const checkCorpus = (await Promise.all(scriptNames.map(async name => fs.readFile(new URL(name, import.meta.url), "utf8")))).join("\n").toLowerCase();
const engineV5 = await loadBattleV5SourceCorpus();
const engineV4 = await fs.readFile(new URL("../js/battle-engine-v4.js", import.meta.url), "utf8");

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

const classOrder = ["Forestcraft", "Swordcraft", "Runecraft", "Dragoncraft", "Abysscraft", "Havencraft", "Portalcraft", "Neutral"];
const rows = cards.map(card => ({ card, support: analyzeCardSupport(card) }));

console.log("=== FINAL BATTLE SIM ALL-CARD AUDIT ===");
console.log(`Cards in database: ${cards.length}`);
for (const className of classOrder) {
  const selected = rows.filter(row => String(row.card.class) === className);
  const counts = selected.reduce((acc, row) => { acc[row.support.level] = (acc[row.support.level] ?? 0) + 1; return acc; }, {});
  console.log(`${className}: ${selected.length} · Full ${counts.full ?? 0} · Partial ${counts.partial ?? 0} · Unsupported ${counts.unsupported ?? 0}`);
}
const gaps = rows.filter(row => row.support.level !== "full");
console.log(`TOTAL GAPS: ${gaps.length}`);
for (const row of gaps) console.log(`GAP|${row.card.class}|${row.card.id}|${row.card.name}|${row.support.level}|${row.support.reason}`);

const risky = rows.filter(row => row.support.level === "full" && highRiskPatterns.some(re => re.test(String(row.card.text ?? ""))));
console.log(`\nHIGH-RISK FULL CARDS: ${risky.length}`);
for (const row of risky) {
  const name = norm(row.card.name);
  const testMention = checkCorpus.includes(name);
  const explicitV5 = engineV5.toLowerCase().includes(name);
  const explicitV4 = engineV4.toLowerCase().includes(name);
  console.log(`RISK|${row.card.class}|${row.card.id}|${row.card.name}|test=${testMention ? "yes" : "NO"}|v5=${explicitV5 ? "yes" : "no"}|v4=${explicitV4 ? "yes" : "no"}|${row.support.reason}`);
}

const overrideNames = [...engineV5.matchAll(/\[\s*"([^"]+)"\s*,\s*"[^"]+"\s*\]/g)].map(match => norm(match[1]));
const v4OverrideNames = [...engineV4.matchAll(/\[\s*"([^"]+)"\s*,\s*"[^"]+"\s*\]/g)].map(match => norm(match[1]));
const allOverrideNames = [...new Set([...overrideNames, ...v4OverrideNames])];
console.log(`\nMANUAL FULL OVERRIDE KEYS FOUND: ${allOverrideNames.length}`);
for (const name of allOverrideNames) {
  const card = cards.find(card => norm(card.name) === name);
  if (!card) continue;
  const testMention = checkCorpus.includes(name);
  console.log(`OVERRIDE|${card.class}|${card.id}|${card.name}|test=${testMention ? "yes" : "NO"}`);
}

const dedicated = classOrder.map(className => {
  const slug = className.toLowerCase();
  const expected = `check-battle-${slug}-full.mjs`;
  return [className, scriptNames.includes(expected), expected];
});
console.log("\nDEDICATED CLASS REGRESSIONS");
for (const [className, exists, expected] of dedicated) console.log(`CLASS_TEST|${className}|${exists ? "yes" : "NO"}|${expected}`);

const missingDedicated = dedicated.filter(([, exists]) => !exists);
if (gaps.length || missingDedicated.length) {
  console.error(`\nFINAL AUDIT FAILED: ${gaps.length} card gap(s), ${missingDedicated.length} missing class regression(s).`);
  process.exitCode = 1;
} else {
  console.log(`\nFINAL AUDIT PASS: ${cards.length}/${cards.length} cards Full · 8/8 class regressions present · 0 gaps.`);
}
