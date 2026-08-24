import fs from "node:fs/promises";

const ENGINE_PATH = "js/battle-engine-v5.js";
const MODULE_PATH = "js/battle-engine-v5-crests.js";
const VERSION = "01.05.019";
const PREVIOUS_VERSION = "01.05.018";

const source = await fs.readFile(ENGINE_PATH, "utf8");
const hasStartMarker = "function hasCrest(player, name) {";
const hasStart = source.indexOf(hasStartMarker);
if (hasStart < 0) throw new Error("hasCrest not found");
const hasEnd = source.indexOf("\n", hasStart);
if (hasEnd < 0) throw new Error("hasCrest line ending not found");
const hasBlock = source.slice(hasStart, hasEnd);
if (!hasBlock.includes("player.crests") || !hasBlock.trimEnd().endsWith("}")) throw new Error("Unexpected hasCrest implementation");

const gainStartMarker = "function gainCrest(player, name, card) {";
const gainEndMarker = "\n\nfunction giveKeyword(unit, keyword) {";
const gainStart = source.indexOf(gainStartMarker);
const gainEnd = source.indexOf(gainEndMarker, gainStart);
if (gainStart < 0 || gainEnd < 0) throw new Error("Crest state block boundaries not found");
const gainBlock = source.slice(gainStart, gainEnd).trimEnd();
if (!gainBlock.includes("function crestCountdown(name)")) throw new Error("crestCountdown missing from Crest state block");
if (!gainBlock.includes("Mjerrabaine") || !gainBlock.includes("Milteo & Luzen")) throw new Error("Crest countdown table looks incomplete");

const textImport = 'import { expandModes, baseText, crystallizeText, section } from "./battle-engine-v5-text.js";\n';
const crestImport = 'import { hasCrest, gainCrest, crestCountdown } from "./battle-engine-v5-crests.js";\n';
if (!source.includes(textImport)) throw new Error("Text module import anchor not found");
if (source.includes(crestImport)) throw new Error("Crest state import already present");

let nextSource = source.slice(0, gainStart) + source.slice(gainEnd);
const shiftedHasStart = nextSource.indexOf(hasStartMarker);
if (shiftedHasStart < 0) throw new Error("hasCrest disappeared unexpectedly");
const shiftedHasEnd = nextSource.indexOf("\n", shiftedHasStart);
nextSource = nextSource.slice(0, shiftedHasStart) + nextSource.slice(shiftedHasEnd + 1);
nextSource = nextSource.replace(textImport, textImport + crestImport);
for (const marker of ["function hasCrest(", "function gainCrest(", "function crestCountdown("]) {
  if (nextSource.includes(marker)) throw new Error(`${marker} remained in V5`);
}

const moduleHas = hasBlock.replace("function hasCrest(", "export function hasCrest(");
const moduleGain = gainBlock
  .replace("function gainCrest(", "export function gainCrest(")
  .replace("function crestCountdown(", "export function crestCountdown(");
const moduleSource = `import { norm } from "./battle-engine-v5-utils.js";\n\n${moduleHas}\n\n${moduleGain}\n`;

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

console.log(`Extracted Battle V5 Crest state primitives into ${MODULE_PATH} and bumped ${VERSION}.`);
