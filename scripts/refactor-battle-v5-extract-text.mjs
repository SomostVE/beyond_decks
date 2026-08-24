import fs from "node:fs/promises";

const ENGINE_PATH = "js/battle-engine-v5.js";
const MODULE_PATH = "js/battle-engine-v5-text.js";
const VERSION = "01.05.018";
const PREVIOUS_VERSION = "01.05.017";

const source = await fs.readFile(ENGINE_PATH, "utf8");
const startMarker = "function expandModes(text, player = null) {";
const endMarker = "\n\nfunction targetableEnemyFollowers(board) {";
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start);
if (start < 0 || end < 0) throw new Error("V5 text parsing block boundaries not found");
if (source.indexOf(startMarker, start + startMarker.length) >= 0) throw new Error("Multiple expandModes blocks found");
const block = source.slice(start, end).trimEnd();
for (const marker of [
  "function expandModes(text, player = null)",
  "function stripFuseAbilityText(textValue)",
  "function baseText(text)",
  "function crystallizeText(textValue, cost)",
  "function section(textValue, label)"
]) {
  if (!block.includes(marker)) throw new Error(`Text parsing block is missing ${marker}`);
}
if (block.includes("function targetableEnemyFollowers")) throw new Error("Text block swallowed target selection logic");

const utilsImport = 'import { cloneStats, compact, has, hasU, norm, uniq, cap, word, createRng, shuffle, clamp } from "./battle-engine-v5-utils.js";\n';
const textImport = 'import { expandModes, baseText, crystallizeText, section } from "./battle-engine-v5-text.js";\n';
if (!source.includes(utilsImport)) throw new Error("V5 utils import anchor not found");
if (source.includes(textImport)) throw new Error("Text parsing import already present");

let nextSource = source.slice(0, start) + source.slice(end);
nextSource = nextSource.replace(utilsImport, utilsImport + textImport);
for (const marker of ["function expandModes(", "function stripFuseAbilityText(", "function baseText(", "function crystallizeText(", "function section("]) {
  if (nextSource.includes(marker)) throw new Error(`${marker} remained in V5`);
}

let moduleBlock = block
  .replace("function expandModes(text, player = null) {", "export function expandModes(text, player = null) {")
  .replace("function baseText(text) {", "export function baseText(text) {")
  .replace("function crystallizeText(textValue, cost) {", "export function crystallizeText(textValue, cost) {")
  .replace("function section(textValue, label) {", "export function section(textValue, label) {");
const moduleSource = `import { norm, word } from "./battle-engine-v5-utils.js";\n\n${moduleBlock}\n`;

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

console.log(`Extracted Battle V5 text/mode parsing into ${MODULE_PATH} and bumped ${VERSION}.`);
