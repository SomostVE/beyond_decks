import fs from "node:fs/promises";

const ENGINE_PATH = "js/battle-engine-v5.js";
const STATE_PATH = "js/battle-engine-v5-state.js";
const VERSION = "01.05.017";
const PREVIOUS_VERSION = "01.05.016";

const source = await fs.readFile(ENGINE_PATH, "utf8");

function extractBlock(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`Block boundaries not found: ${startMarker}`);
  return { start, end, text: source.slice(start, end) };
}

const stats = extractBlock("function createStats() {", "\n\nfunction makePlayer(");
const cost = extractBlock("function costOf(inst) {", "\n\nfunction expandModes(");
const snapStartMarker = "function snap(frames, players, meta, stats, record) {";
const snapStart = source.indexOf(snapStartMarker);
if (snapStart < 0) throw new Error("Snapshot block not found");
const snapshotTail = source.slice(snapStart).trimEnd();
if (!snapshotTail.includes("function cardView(item)")) throw new Error("cardView missing from snapshot tail");
const tailFunctions = snapshotTail.match(/^function\s+[A-Za-z0-9_]+\s*\(/gm) ?? [];
if (tailFunctions.length !== 2) throw new Error(`Expected snap + cardView at V5 tail, found ${tailFunctions.length} functions`);

const removals = [
  { start: stats.start, end: stats.end },
  { start: cost.start, end: cost.end },
  { start: snapStart, end: source.length }
].sort((a, b) => b.start - a.start);
let nextSource = source;
for (const removal of removals) nextSource = nextSource.slice(0, removal.start) + nextSource.slice(removal.end);
nextSource = nextSource.trimEnd() + "\n";

const coverageImport = 'import { analyzeCardSupport, analyzeDeckCoverage, normalizeDeck } from "./battle-engine-v5-coverage.js";\n';
const stateImport = 'import { createStats, costOf, snap } from "./battle-engine-v5-state.js";\n';
const oldUtilsImport = 'import { unitView, cloneStats, compact, has, hasU, norm, uniq, cap, word, createRng, shuffle, clamp } from "./battle-engine-v5-utils.js";\n';
const newUtilsImport = 'import { cloneStats, compact, has, hasU, norm, uniq, cap, word, createRng, shuffle, clamp } from "./battle-engine-v5-utils.js";\n';
if (!nextSource.includes(coverageImport) || !nextSource.includes(oldUtilsImport)) throw new Error("Expected V5 import anchors missing");
nextSource = nextSource.replace(coverageImport, coverageImport + stateImport).replace(oldUtilsImport, newUtilsImport);
if (nextSource.includes("unitView(")) throw new Error("unitView still used in V5 after snapshot extraction");
for (const marker of ["function createStats()", "function costOf(inst)", snapStartMarker, "function cardView(item)"]) {
  if (nextSource.includes(marker)) throw new Error(`${marker} remained in battle-engine-v5.js`);
}

const exportFunction = (block, name) => block.replace(`function ${name}(`, `export function ${name}(`).trimEnd();
const moduleSource = `import { classMechanicStatus, isSpellboostRecipientCard } from "./battle-class-mechanics.js";\nimport { cloneStats, unitView, norm } from "./battle-engine-v5-utils.js";\n\n${exportFunction(stats.text, "createStats")}\n\n${exportFunction(cost.text, "costOf")}\n\n${exportFunction(snapshotTail, "snap")}\n\nfunction isSpellboostRecipient(card) { return isSpellboostRecipientCard(card); }\n`;

await fs.writeFile(ENGINE_PATH, nextSource, "utf8");
await fs.writeFile(STATE_PATH, moduleSource, "utf8");

const versionPath = "version.json";
const versionJson = JSON.parse(await fs.readFile(versionPath, "utf8"));
if (versionJson.version !== PREVIOUS_VERSION) throw new Error(`Expected ${PREVIOUS_VERSION}, found ${versionJson.version}`);
versionJson.version = VERSION;
await fs.writeFile(versionPath, `${JSON.stringify(versionJson, null, 2)}\n`, "utf8");

for (const path of ["index.html", "collection.html", "battle.html"]) {
  const html = await fs.readFile(path, "utf8");
  if (!html.includes(PREVIOUS_VERSION)) throw new Error(`${path} does not contain ${PREVIOUS_VERSION}`);
  await fs.writeFile(path, html.replaceAll(PREVIOUS_VERSION, VERSION), "utf8");
}

console.log(`Extracted Battle V5 state/replay helpers into ${STATE_PATH} and bumped ${VERSION}.`);
