import fs from "node:fs/promises";

const ENGINE_PATH = "js/battle-engine-v5.js";
const MODULE_PATH = "js/battle-engine-v5-high-risk.js";
const VERSION = "01.05.024";
const PREVIOUS_VERSION = "01.05.023";

let source = await fs.readFile(ENGINE_PATH, "utf8");
const startMarker = "function highRiskWordNumber";
const endMarker = "function isSpellboostRecipient";
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start + startMarker.length);
if (start < 0 || end < 0) throw new Error("High-risk block boundaries not found");
const rawBlock = source.slice(start, end).trimEnd();
const functionNames = [...rawBlock.matchAll(/^(?:export\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map(match => match[1]);
const exportedNames = [...rawBlock.matchAll(/^export\s+function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map(match => match[1]);
if (functionNames.length < 20) throw new Error(`Expected a large high-risk block, found ${functionNames.length} functions`);
for (const name of ["highRiskWordNumber", "resolveHighRiskGenericText"]) {
  if (!functionNames.includes(name)) throw new Error(`High-risk block missing ${name}`);
}

const block = rawBlock.replace(/^export\s+function\s+/gm, "function ");
const localSet = new Set(functionNames);
const before = source.slice(0, start);
const outside = source.slice(0, start) + source.slice(end);
const appears = name => new RegExp(`\\b${name.replace(/[$]/g, "\\$")}\\b`).test(block);
const runtimeDeps = [];
const addDep = name => {
  if (!name || localSet.has(name) || runtimeDeps.includes(name) || !appears(name)) return;
  runtimeDeps.push(name);
};

for (const match of outside.matchAll(/^(?:export\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) addDep(match[1]);
for (const match of source.matchAll(/^import\s+\{([^}]+)\}\s+from\s+[^;]+;/gm)) {
  for (const raw of match[1].split(",")) {
    const part = raw.trim();
    if (!part) continue;
    const pieces = part.split(/\s+as\s+/);
    addDep((pieces[1] ?? pieces[0]).trim());
  }
}
for (const match of before.matchAll(/^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=/gm)) addDep(match[1]);
for (const match of before.matchAll(/^const\s+\{([\s\S]*?)\}\s*=\s*[A-Za-z_$][\w$]*\s*\(/gm)) {
  for (const raw of match[1].split(",")) {
    const cleaned = raw.replace(/\/\/.*$/g, "").trim();
    const id = cleaned.match(/^([A-Za-z_$][\w$]*)/)?.[1];
    addDep(id);
  }
}

source = source.slice(0, start) + source.slice(end);
for (const name of functionNames) {
  if (new RegExp(`^(?:export\\s+)?function\\s+${name}\\s*\\(`, "m").test(source)) throw new Error(`${name} remained as a V5 function declaration`);
}

const plannerImport = 'import { createPlanner } from "./battle-engine-v5-planner.js";\n';
const highRiskImport = 'import { createHighRiskRules } from "./battle-engine-v5-high-risk.js";\n';
if (!source.includes(plannerImport)) throw new Error("Planner import anchor not found");
source = source.replace(plannerImport, plannerImport + highRiskImport);

const plannerBindingMarker = "const {\n  runTurnAi,";
const plannerBindingAt = source.indexOf(plannerBindingMarker);
if (plannerBindingAt < 0) throw new Error("Planner binding anchor not found");
const binding = `const {\n  ${functionNames.join(",\n  ")}\n} = createHighRiskRules({\n  ${runtimeDeps.join(",\n  ")}\n});\n${exportedNames.length ? `\nexport { ${exportedNames.join(", ")} };\n` : ""}\n`;
source = source.slice(0, plannerBindingAt) + binding + source.slice(plannerBindingAt);

const moduleSource = `export function createHighRiskRules(runtime) {\n  const {\n    ${runtimeDeps.join(",\n    ")}\n  } = runtime;\n\n${block.split("\n").map(line => `  ${line}`).join("\n")}\n\n  return {\n    ${functionNames.join(",\n    ")}\n  };\n}\n`;

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

console.log(`Extracted ${functionNames.length} high-risk functions with ${runtimeDeps.length} injected dependencies into ${MODULE_PATH}; exports: ${exportedNames.join(", ")}; bumped ${VERSION}.`);
