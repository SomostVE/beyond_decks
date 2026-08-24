import fs from "node:fs/promises";

const ENGINE_PATH = "js/battle-engine-v5.js";
const MODULE_PATH = "js/battle-engine-v5-coverage.js";
const VERSION = "01.05.015";
const PREVIOUS_VERSION = "01.05.014";

const source = await fs.readFile(ENGINE_PATH, "utf8");

const coverageStartMarker = "export function analyzeDeckCoverage(deck, cardMap) {";
const coverageEndMarker = "\n\n// [[battle-haven-full-qa]]";
const coverageStart = source.indexOf(coverageStartMarker);
const coverageEnd = source.indexOf(coverageEndMarker, coverageStart);
if (coverageStart < 0 || coverageEnd < 0) throw new Error("Coverage block boundaries not found");
const coverageBlock = source.slice(coverageStart, coverageEnd);
if (!coverageBlock.includes("export function analyzeCardSupport(card)")) throw new Error("analyzeCardSupport missing from coverage block");

const normalizeStartMarker = "function normalizeDeck(deck) {";
const normalizeEndMarker = "\n\nfunction normStrategy(strategy)";
const normalizeStart = source.indexOf(normalizeStartMarker);
const normalizeEnd = source.indexOf(normalizeEndMarker, normalizeStart);
if (normalizeStart < 0 || normalizeEnd < 0) throw new Error("normalizeDeck block boundaries not found");
const normalizeBlock = source.slice(normalizeStart, normalizeEnd);
if (!normalizeBlock.includes("entry.cardId") || !normalizeBlock.trimEnd().endsWith("}")) throw new Error("normalizeDeck block does not match expected implementation");

const v4Import = 'import { analyzeCardSupport as analyzeCardSupportV4 } from "./battle-engine-v4.js";\n';
const overridesImport = 'import { FULL_OVERRIDES } from "./battle-engine-v5-overrides.js";\n';
const preparationImport = 'import { prepareOriginalCardMap, prepareSimulationCardMap as prepareSimulationCardMapWithSupport } from "./battle-engine-v5-card-preparation.js";\n';
const coverageImport = 'import { analyzeCardSupport, analyzeDeckCoverage, normalizeDeck } from "./battle-engine-v5-coverage.js";\n';

for (const expected of [v4Import, overridesImport, preparationImport]) {
  if (!source.includes(expected)) throw new Error(`Expected import missing: ${expected.trim()}`);
}
if (source.includes(coverageImport)) throw new Error("Coverage import already present");

let nextSource = source.slice(0, coverageStart) + source.slice(coverageEnd);
const shiftedNormalizeStart = nextSource.indexOf(normalizeStartMarker);
const shiftedNormalizeEnd = nextSource.indexOf(normalizeEndMarker, shiftedNormalizeStart);
if (shiftedNormalizeStart < 0 || shiftedNormalizeEnd < 0) throw new Error("normalizeDeck block disappeared after coverage removal");
nextSource = nextSource.slice(0, shiftedNormalizeStart) + nextSource.slice(shiftedNormalizeEnd);
nextSource = nextSource.replace(v4Import, "");
nextSource = nextSource.replace(overridesImport, "");
nextSource = nextSource.replace(preparationImport, preparationImport + coverageImport);

const versionExportAnchor = "export const BATTLE_RULES_VERSION = 5;";
if (!nextSource.includes(versionExportAnchor)) throw new Error("BATTLE_RULES_VERSION anchor missing");
nextSource = nextSource.replace(versionExportAnchor, `export { analyzeCardSupport, analyzeDeckCoverage };\n\n${versionExportAnchor}`);

for (const forbidden of [coverageStartMarker, "export function analyzeCardSupport(card)", normalizeStartMarker, "analyzeCardSupportV4", "FULL_OVERRIDES"]) {
  if (nextSource.includes(forbidden)) throw new Error(`${forbidden} remained in battle-engine-v5.js`);
}

const exportedNormalizeBlock = normalizeBlock.replace("function normalizeDeck(deck)", "export function normalizeDeck(deck)");
const moduleSource = `import { analyzeCardSupport as analyzeCardSupportV4 } from "./battle-engine-v4.js";\nimport { FULL_OVERRIDES } from "./battle-engine-v5-overrides.js";\nimport { prepareOriginalCardMap } from "./battle-engine-v5-card-preparation.js";\n\n${coverageBlock.trimEnd()}\n\n${exportedNormalizeBlock.trimEnd()}\n\nfunction norm(value) { return String(value ?? "").toLowerCase().replace(/[’‘]/g, "'").replace(/\\s+/g, " ").trim(); }\nfunction uniq(values) { return [...new Set(values.filter(Boolean).map(String))]; }\n`;

await fs.writeFile(ENGINE_PATH, nextSource, "utf8");
await fs.writeFile(MODULE_PATH, moduleSource, "utf8");

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

console.log(`Extracted Battle V5 coverage/support into ${MODULE_PATH} and bumped ${VERSION}.`);
