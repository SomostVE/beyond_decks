import fs from "node:fs/promises";

const ENGINE_PATH = "js/battle-engine-v5.js";
const OVERRIDES_PATH = "js/battle-engine-v5-overrides.js";
const VERSION = "01.05.012";
const PREVIOUS_VERSION = "01.05.011";

const source = await fs.readFile(ENGINE_PATH, "utf8");
const declaration = "const FULL_OVERRIDES = new Map([";
const start = source.indexOf(declaration);
if (start < 0) throw new Error("FULL_OVERRIDES declaration not found");
if (source.indexOf(declaration, start + declaration.length) >= 0) {
  throw new Error("Multiple FULL_OVERRIDES declarations found");
}

const closing = "\n]);";
const closingStart = source.indexOf(closing, start);
if (closingStart < 0) throw new Error("FULL_OVERRIDES closing marker not found");
const end = closingStart + closing.length;
const block = source.slice(start, end);
if (!block.includes('"prostrating coward"') || !block.includes('"lyanthoth, eld tome"')) {
  throw new Error("FULL_OVERRIDES boundaries do not match expected table");
}

const importLine = 'import { FULL_OVERRIDES } from "./battle-engine-v5-overrides.js";\n';
const importAnchor = 'from "./battle-class-mechanics.js";\n';
const anchorStart = source.indexOf(importAnchor);
if (anchorStart < 0) throw new Error("Battle class mechanics import anchor not found");
const insertAt = anchorStart + importAnchor.length;
if (source.includes(importLine)) throw new Error("FULL_OVERRIDES import already present");

let nextSource = source.slice(0, start) + source.slice(end);
nextSource = nextSource.slice(0, insertAt) + importLine + nextSource.slice(insertAt);
if (nextSource.includes(declaration)) throw new Error("FULL_OVERRIDES declaration remained in V5");
if (!nextSource.includes(importLine.trim())) throw new Error("FULL_OVERRIDES import was not inserted");

const exportedBlock = block.replace(/^const FULL_OVERRIDES/, "export const FULL_OVERRIDES");
const moduleSource = `${exportedBlock}\n`;

await fs.writeFile(ENGINE_PATH, nextSource, "utf8");
await fs.writeFile(OVERRIDES_PATH, moduleSource, "utf8");

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

console.log(`Extracted FULL_OVERRIDES into ${OVERRIDES_PATH} and bumped ${VERSION}.`);
