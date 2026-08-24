import fs from "node:fs/promises";

const ENGINE_PATH = "js/battle-engine-v5.js";
const MODULE_PATH = "js/battle-engine-v5-targeting.js";
const VERSION = "01.05.021";
const PREVIOUS_VERSION = "01.05.020";

let source = await fs.readFile(ENGINE_PATH, "utf8");

function cutBlock(input, startMarker, endMarker, label) {
  const start = input.indexOf(startMarker);
  const end = input.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`${label} boundaries not found`);
  if (input.indexOf(startMarker, start + startMarker.length) >= 0) throw new Error(`Multiple ${label} starts found`);
  return { block: input.slice(start, end).trimEnd(), source: input.slice(0, start) + input.slice(end) };
}

const branchCut = cutBlock(
  source,
  "function targetableEnemyFollowers(board) {",
  "\n\nfunction scoredPlayOptions(player, opponent, includeContinuation = true) {",
  "target branch"
);
source = branchCut.source;
for (const marker of ["targetEffectSpec", "followerThreatValue", "targetBranchValue", "expandPlayTargetBranches"]) {
  if (!branchCut.block.includes(`function ${marker}`)) throw new Error(`Target branch block missing ${marker}`);
}

const chooserCut = cutBlock(
  source,
  "function chooseTarget(board, targeted) {",
  "\n\n// [[battle-ai-collective-lethal-v1]]",
  "target chooser"
);
source = chooserCut.source;
for (const marker of ["choosePlannedTarget", "chooseRandomTarget", "tradeTarget"]) {
  if (!chooserCut.block.includes(`function ${marker}`)) throw new Error(`Target chooser block missing ${marker}`);
}

const modesImport = 'import { modes } from "./battle-engine-v5-modes.js";\n';
const targetingImport = 'import { targetableEnemyFollowers, targetEffectSpec, followerThreatValue, targetBranchValue, expandPlayTargetBranches, chooseTarget, choosePlannedTarget, chooseRandomTarget, tradeTarget } from "./battle-engine-v5-targeting.js";\n';
if (!source.includes(modesImport)) throw new Error("Modes import anchor not found");
if (source.includes(targetingImport)) throw new Error("Targeting import already present");
source = source.replace(modesImport, modesImport + targetingImport);

const exported = [...branchCut.block, ...chooserCut.block];
let moduleBody = `${branchCut.block}\n\n${chooserCut.block}`;
for (const name of [
  "targetableEnemyFollowers", "targetEffectSpec", "followerThreatValue", "targetBranchValue", "expandPlayTargetBranches",
  "chooseTarget", "choosePlannedTarget", "chooseRandomTarget", "tradeTarget"
]) {
  const marker = `function ${name}(`;
  if (!moduleBody.includes(marker)) throw new Error(`Module missing ${name}`);
  moduleBody = moduleBody.replace(marker, `export function ${name}(`);
  if (source.includes(marker)) throw new Error(`${name} remained in V5`);
}
const moduleSource = `import { norm, hasU, clamp } from "./battle-engine-v5-utils.js";\n\n${moduleBody}\n`;

await fs.writeFile(ENGINE_PATH, source, "utf8");
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

console.log(`Extracted Battle V5 targeting policy into ${MODULE_PATH} and bumped ${VERSION}.`);
