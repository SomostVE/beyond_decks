import fs from "node:fs/promises";

const ENGINE_PATH = "js/battle-engine-v5.js";
const MODULE_PATH = "js/battle-engine-v5-modes.js";
const VERSION = "01.05.020";
const PREVIOUS_VERSION = "01.05.019";

const source = await fs.readFile(ENGINE_PATH, "utf8");
const startMarker = "function modes(inst, player) {";
const endMarker = "\n\nfunction targetableEnemyFollowers(board) {";
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start);
if (start < 0 || end < 0) throw new Error("V5 modes block boundaries not found");
if (source.indexOf(startMarker, start + startMarker.length) >= 0) throw new Error("Multiple modes implementations found");
const block = source.slice(start, end).trimEnd();
for (const marker of ["Enhance", "Accelerate", "Crystallize", "Milteo & Luzen", "highestAlternativeCost"]) {
  if (!block.includes(marker)) throw new Error(`Modes block missing ${marker}`);
}
if (block.includes("function targetableEnemyFollowers")) throw new Error("Modes block swallowed target-selection logic");

const crestImport = 'import { hasCrest, gainCrest, crestCountdown } from "./battle-engine-v5-crests.js";\n';
const modesImport = 'import { modes } from "./battle-engine-v5-modes.js";\n';
if (!source.includes(crestImport)) throw new Error("Crest import anchor not found");
if (source.includes(modesImport)) throw new Error("Modes import already present");

let nextSource = source.slice(0, start) + source.slice(end);
nextSource = nextSource.replace(crestImport, crestImport + modesImport);
if (nextSource.includes("function modes(")) throw new Error("modes remained in V5");

const moduleBlock = block.replace("function modes(inst, player) {", "export function modes(inst, player) {");
const moduleSource = `import { costOf } from "./battle-engine-v5-state.js";\nimport { hasCrest } from "./battle-engine-v5-crests.js";\nimport { expandModes, baseText, crystallizeText, section } from "./battle-engine-v5-text.js";\n\n${moduleBlock}\n`;
await fs.writeFile(ENGINE_PATH, nextSource, "utf8");
await fs.writeFile(MODULE_PATH, moduleSource, "utf8");

const versionJson = JSON.parse(await fs.readFile("version.json", "utf8"));
if (versionJson.version !== PREVIOUS_VERSION) throw new Error(`Expected ${PREVIOUS_VERSION}, found ${versionJson.version}`);
versionJson.version = VERSION;
await fs.writeFile("version.json", `${JSON.stringify(versionJson, null, 2)}\n`, "utf8");
for (const path of ["index.html", "collection.html", "battle.html"]) {
  const html = await fs.readFile(path, "utf8");
  if (!html.includes(PREVIOUS_VERSION)) throw new Error(`${path} does not contain ${PREVIOUS_VERSION}`);
  await fs.writeFile(path, html.replaceAll(PREVIOUS_VERSION, VERSION), "utf8");
}

console.log(`Extracted Battle V5 play-mode legality into ${MODULE_PATH} and bumped ${VERSION}.`);
