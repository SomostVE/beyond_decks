import fs from "node:fs/promises";

const ENGINE_PATH = "js/battle-engine-v5.js";
const MODULE_PATH = "js/battle-engine-v5-card-preparation.js";
const VERSION = "01.05.014";
const PREVIOUS_VERSION = "01.05.013";

const source = await fs.readFile(ENGINE_PATH, "utf8");
const blockStartMarker = "function prepareSimulationCardMap(cardMap) {";
const blockEndMarker = "\n\nfunction createStats()";
const blockStart = source.indexOf(blockStartMarker);
if (blockStart < 0) throw new Error("prepareSimulationCardMap block not found");
if (source.indexOf(blockStartMarker, blockStart + blockStartMarker.length) >= 0) {
  throw new Error("Multiple prepareSimulationCardMap blocks found");
}
const blockEnd = source.indexOf(blockEndMarker, blockStart);
if (blockEnd < 0) throw new Error("createStats boundary not found");

const block = source.slice(blockStart, blockEnd);
for (const marker of [
  "function prepareOriginalCardMap(cardMap)",
  "function sanitizeHandledReactiveText(textValue)",
  "function adaptSkyboundText(card, textValue)",
  "function expandEnhanceWithBaseFanfare(textValue)",
  "function injectGapHook(textValue)"
]) {
  if (!block.includes(marker)) throw new Error(`Card preparation block is missing ${marker}`);
}
if (!block.trimEnd().endsWith("}")) throw new Error("Card preparation block has unexpected ending");

const supportImport = 'import { HANDLED_REACTIVE_CLAUSES } from "./battle-engine-v5-support.js";\n';
const fullOverridesImport = 'import { FULL_OVERRIDES } from "./battle-engine-v5-overrides.js";\n';
const preparationImport = 'import { prepareOriginalCardMap, prepareSimulationCardMap as prepareSimulationCardMapWithSupport } from "./battle-engine-v5-card-preparation.js";\n';
const gapLine = 'const GAP_HOOK = "[[battle-rule-gap-hook]]";\n';
const cacheLine = 'const SIMULATION_CARD_MAP_CACHE = new WeakMap();\n';

if (!source.includes(supportImport)) throw new Error("HANDLED_REACTIVE_CLAUSES import not found");
if (!source.includes(fullOverridesImport)) throw new Error("FULL_OVERRIDES import anchor not found");
if (source.includes(preparationImport)) throw new Error("Card preparation import already present");
if (!source.includes(gapLine) || !source.includes(cacheLine)) throw new Error("Card preparation constants not found");

let nextSource = source.slice(0, blockStart) + source.slice(blockEnd);
nextSource = nextSource.replace(supportImport, "");
nextSource = nextSource.replace(gapLine, "");
nextSource = nextSource.replace(cacheLine, "");
nextSource = nextSource.replace(fullOverridesImport, fullOverridesImport + preparationImport);

const wrapper = `function prepareSimulationCardMap(cardMap) {\n  return prepareSimulationCardMapWithSupport(cardMap, analyzeCardSupport);\n}`;
const createStatsAnchor = "\n\nfunction createStats()";
if (!nextSource.includes(createStatsAnchor)) throw new Error("createStats anchor disappeared");
nextSource = nextSource.replace(createStatsAnchor, `\n\n${wrapper}${createStatsAnchor}`);

for (const forbidden of ["HANDLED_REACTIVE_CLAUSES", "GAP_HOOK", "SIMULATION_CARD_MAP_CACHE", "function prepareOriginalCardMap(cardMap)", "function sanitizeHandledReactiveText(textValue)"]) {
  if (nextSource.includes(forbidden)) throw new Error(`${forbidden} remained in battle-engine-v5.js`);
}

let moduleBlock = block
  .replace("function prepareSimulationCardMap(cardMap) {", "export function prepareSimulationCardMap(cardMap, analyzeCardSupport) {")
  .replace("function prepareOriginalCardMap(cardMap) {", "export function prepareOriginalCardMap(cardMap) {");

const moduleSource = `import { HANDLED_REACTIVE_CLAUSES } from "./battle-engine-v5-support.js";\n\nconst GAP_HOOK = "[[battle-rule-gap-hook]]";\nconst SIMULATION_CARD_MAP_CACHE = new WeakMap();\n\n${moduleBlock.trimEnd()}\n\nfunction norm(value) { return String(value ?? "").toLowerCase().replace(/[’‘]/g, "'").replace(/\\s+/g, " ").trim(); }\n`;

await fs.writeFile(ENGINE_PATH, nextSource, "utf8");
await fs.writeFile(MODULE_PATH, moduleSource, "utf8");

const versionPath = "version.json";
const versionJson = JSON.parse(await fs.readFile(versionPath, "utf8"));
if (versionJson.version !== PREVIOUS_VERSION) {
  throw new Error(`Expected ${PREVIOUS_VERSION}, found ${versionJson.version}`);
}
versionJson.version = VERSION;
await fs.writeFile(versionPath, `${JSON.stringify(versionJson, null, 2)}\n`, "utf8");

for (const path of ["index.html", "collection.html", "battle.html"]) {
  const html = await fs.readFile(path, "utf8");
  if (!html.includes(PREVIOUS_VERSION)) {
    throw new Error(`${path} does not contain ${PREVIOUS_VERSION}`);
  }
  await fs.writeFile(path, html.replaceAll(PREVIOUS_VERSION, VERSION), "utf8");
}

console.log(`Extracted Battle V5 card preparation into ${MODULE_PATH} and bumped ${VERSION}.`);
