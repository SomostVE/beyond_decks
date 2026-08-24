import fs from "node:fs/promises";

const ENGINE_PATH = "js/battle-engine-v5.js";
const SUPPORT_PATH = "js/battle-engine-v5-support.js";
const VERSION = "01.05.013";
const PREVIOUS_VERSION = "01.05.012";

const source = await fs.readFile(ENGINE_PATH, "utf8");
const declaration = "const HANDLED_REACTIVE_CLAUSES = [";
const start = source.indexOf(declaration);
if (start < 0) throw new Error("HANDLED_REACTIVE_CLAUSES declaration not found");
if (source.indexOf(declaration, start + declaration.length) >= 0) {
  throw new Error("Multiple HANDLED_REACTIVE_CLAUSES declarations found");
}

const nextFunction = "\n\nexport function simulateBattle";
const functionStart = source.indexOf(nextFunction, start);
if (functionStart < 0) throw new Error("simulateBattle boundary not found");
const block = source.slice(start, functionStart);
if (!block.trimEnd().endsWith("];")) throw new Error("Reactive clause block has unexpected ending");
if (!block.includes("battle-portalcraft-reactive-clauses") || !block.includes("battle-abysscraft-reactive-clauses")) {
  throw new Error("Reactive clause boundaries do not match expected table");
}

const importLine = 'import { HANDLED_REACTIVE_CLAUSES } from "./battle-engine-v5-support.js";\n';
const importAnchor = 'import { FULL_OVERRIDES } from "./battle-engine-v5-overrides.js";\n';
const anchorStart = source.indexOf(importAnchor);
if (anchorStart < 0) throw new Error("FULL_OVERRIDES import anchor not found");
const insertAt = anchorStart + importAnchor.length;
if (source.includes(importLine)) throw new Error("Support import already present");

let nextSource = source.slice(0, start) + source.slice(functionStart);
nextSource = nextSource.slice(0, insertAt) + importLine + nextSource.slice(insertAt);
if (nextSource.includes(declaration)) throw new Error("Reactive clause declaration remained in V5");
if (!nextSource.includes(importLine.trim())) throw new Error("Support import was not inserted");

const moduleSource = `${block.replace(/^const HANDLED_REACTIVE_CLAUSES/, "export const HANDLED_REACTIVE_CLAUSES").trimEnd()}\n`;
await fs.writeFile(ENGINE_PATH, nextSource, "utf8");
await fs.writeFile(SUPPORT_PATH, moduleSource, "utf8");

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

console.log(`Extracted HANDLED_REACTIVE_CLAUSES into ${SUPPORT_PATH} and bumped ${VERSION}.`);
