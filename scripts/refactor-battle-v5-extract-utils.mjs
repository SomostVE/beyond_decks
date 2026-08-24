import fs from "node:fs/promises";

const ENGINE_PATH = "js/battle-engine-v5.js";
const UTILS_PATH = "js/battle-engine-v5-utils.js";
const PREPARATION_PATH = "js/battle-engine-v5-card-preparation.js";
const COVERAGE_PATH = "js/battle-engine-v5-coverage.js";
const VERSION = "01.05.016";
const PREVIOUS_VERSION = "01.05.015";

const source = await fs.readFile(ENGINE_PATH, "utf8");
const utilitiesStartMarker = "function unitView(unit) {";
const utilitiesStart = source.indexOf(utilitiesStartMarker);
if (utilitiesStart < 0) throw new Error("V5 utility tail not found");
const utilitiesBlock = source.slice(utilitiesStart).trimEnd();
const utilityNames = ["unitView", "cloneStats", "compact", "has", "hasU", "norm", "uniq", "cap", "word", "createRng", "shuffle", "clamp"];
for (const name of utilityNames) {
  if (!utilitiesBlock.includes(`function ${name}(`)) throw new Error(`Utility ${name} missing from tail`);
}
if (!utilitiesBlock.endsWith("}")) throw new Error("Utility tail has unexpected ending");
if (source.indexOf(utilitiesStartMarker, utilitiesStart + utilitiesStartMarker.length) >= 0) throw new Error("Multiple utility tails found");

const coverageImport = 'import { analyzeCardSupport, analyzeDeckCoverage, normalizeDeck } from "./battle-engine-v5-coverage.js";\n';
const utilsImport = 'import { unitView, cloneStats, compact, has, hasU, norm, uniq, cap, word, createRng, shuffle, clamp } from "./battle-engine-v5-utils.js";\n';
if (!source.includes(coverageImport)) throw new Error("Coverage import anchor missing");
if (source.includes(utilsImport)) throw new Error("Utils import already present");

let nextSource = source.slice(0, utilitiesStart).trimEnd() + "\n";
nextSource = nextSource.replace(coverageImport, coverageImport + utilsImport);
for (const name of utilityNames) {
  if (nextSource.includes(`function ${name}(`)) throw new Error(`Utility ${name} remained in V5`);
}

let moduleSource = utilitiesBlock;
for (const name of utilityNames) {
  moduleSource = moduleSource.replace(`function ${name}(`, `export function ${name}(`);
}
moduleSource += "\n";

let preparation = await fs.readFile(PREPARATION_PATH, "utf8");
const supportImport = 'import { HANDLED_REACTIVE_CLAUSES } from "./battle-engine-v5-support.js";\n';
const normImport = 'import { norm } from "./battle-engine-v5-utils.js";\n';
const localNorm = `function norm(value) { return String(value ?? "").toLowerCase().replace(/[’‘]/g, "'").replace(/\\s+/g, " ").trim(); }\n`;
if (!preparation.includes(supportImport) || !preparation.includes(localNorm)) throw new Error("Card preparation norm wiring did not match expected source");
preparation = preparation.replace(supportImport, supportImport + normImport).replace(`\n${localNorm}`, "");

let coverage = await fs.readFile(COVERAGE_PATH, "utf8");
const preparationImport = 'import { prepareOriginalCardMap } from "./battle-engine-v5-card-preparation.js";\n';
const normUniqImport = 'import { norm, uniq } from "./battle-engine-v5-utils.js";\n';
const localNormCoverage = `function norm(value) { return String(value ?? "").toLowerCase().replace(/[’‘]/g, "'").replace(/\\s+/g, " ").trim(); }\n`;
const localUniqCoverage = `function uniq(values) { return [...new Set(values.filter(Boolean).map(String))]; }\n`;
if (!coverage.includes(preparationImport) || !coverage.includes(localNormCoverage) || !coverage.includes(localUniqCoverage)) throw new Error("Coverage utility wiring did not match expected source");
coverage = coverage.replace(preparationImport, preparationImport + normUniqImport)
  .replace(`\n${localNormCoverage}${localUniqCoverage}`, "");

await fs.writeFile(ENGINE_PATH, nextSource, "utf8");
await fs.writeFile(UTILS_PATH, moduleSource, "utf8");
await fs.writeFile(PREPARATION_PATH, preparation, "utf8");
await fs.writeFile(COVERAGE_PATH, coverage, "utf8");

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

console.log(`Extracted Battle V5 pure utilities into ${UTILS_PATH} and bumped ${VERSION}.`);
