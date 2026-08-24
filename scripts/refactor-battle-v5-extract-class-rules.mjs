import fs from "node:fs/promises";

const ENGINE_PATH = "js/battle-engine-v5.js";
const MODULE_PATH = "js/battle-engine-v5-class-rules.js";
const VERSION = "01.05.022";
const PREVIOUS_VERSION = "01.05.021";

let source = await fs.readFile(ENGINE_PATH, "utf8");
const startMarker = "function bindHavencraftRuntime";
const endMarker = "function highRiskWordNumber";
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start);
if (start < 0 || end < 0) throw new Error("Class-rule block boundaries not found");
const block = source.slice(start, end).trimEnd();
const functionNames = [...block.matchAll(/^(?:export\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map(match => match[1]);
if (functionNames.length < 90) throw new Error(`Expected a large class-rule block, found ${functionNames.length} functions`);
for (const name of [
  "resolveHavencraftCardText", "resolveNeutralCardText", "resolvePortalcraftCardText", "resolveAbysscraftCardText",
  "resolveDragoncraftCardText", "resolveForestcraftCardText", "resolveSwordcraftCardText", "resolveRunecraftCardText",
  "boardFollower", "boardAmulet", "performEarthRite", "silenceFollower", "buff"
]) {
  if (!functionNames.includes(name)) throw new Error(`Class-rule block missing ${name}`);
}

const runtimeDeps = [
  "addHand", "afterLeaderHeal", "applyEntryEvents", "banish", "cleanup", "damageLeader", "damageUnit",
  "destroyObject", "destroyUnit", "drawCards", "effectContext", "evolveUnitByAbility", "findByName", "giveKeyword",
  "hasTrait", "healPlayer", "instance", "notifyFollowerLeavesField", "reanimate", "related", "resolveText",
  "spellboostHand", "summonWithEvents", "superEvolveUnitByAbility", "toCemetery", "transformHandInstance"
];
for (const dep of runtimeDeps) {
  if (!new RegExp(`\\b${dep}\\s*\\(`).test(block)) throw new Error(`Expected runtime dependency ${dep} is no longer called by class rules`);
}

source = source.slice(0, start) + source.slice(end);
for (const name of functionNames) {
  if (new RegExp(`^(?:export\\s+)?function\\s+${name}\\s*\\(`, "m").test(source)) throw new Error(`${name} remained as a V5 function declaration`);
}

const targetingImport = 'import { targetableEnemyFollowers, targetEffectSpec, followerThreatValue, targetBranchValue, expandPlayTargetBranches, chooseTarget, choosePlannedTarget, chooseRandomTarget, tradeTarget } from "./battle-engine-v5-targeting.js";\n';
const classImport = 'import { createClassRules } from "./battle-engine-v5-class-rules.js";\n';
if (!source.includes(targetingImport)) throw new Error("Targeting import anchor not found");
source = source.replace(targetingImport, targetingImport + classImport);

const maxActionAnchor = "const MAX_ACTIONS = 24;\n";
if (!source.includes(maxActionAnchor)) throw new Error("MAX_ACTIONS anchor not found");
const bindings = `\nconst {\n  ${functionNames.join(",\n  ")}\n} = createClassRules({\n  ${runtimeDeps.join(",\n  ")}\n});\n`;
source = source.replace(maxActionAnchor, maxActionAnchor + bindings);

const moduleSource = `import { getCountdown } from "./battle-rules.js";\nimport { canUseClassMechanic, canUseClassRules } from "./battle-class-mechanics.js";\nimport { costOf } from "./battle-engine-v5-state.js";\nimport { has, hasU, norm, uniq, shuffle } from "./battle-engine-v5-utils.js";\nimport { hasCrest, gainCrest } from "./battle-engine-v5-crests.js";\nimport { choosePlannedTarget, chooseRandomTarget } from "./battle-engine-v5-targeting.js";\n\nexport function createClassRules(runtime) {\n  const {\n    ${runtimeDeps.join(",\n    ")}\n  } = runtime;\n\n${block.split("\n").map(line => `  ${line}`).join("\n")}\n\n  return {\n    ${functionNames.join(",\n    ")}\n  };\n}\n`;

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

console.log(`Extracted ${functionNames.length} Battle V5 class-rule functions into ${MODULE_PATH} and bumped ${VERSION}.`);
