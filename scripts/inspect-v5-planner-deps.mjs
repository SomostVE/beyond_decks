import fs from "node:fs/promises";

const source = await fs.readFile("js/battle-engine-v5.js", "utf8");
const startMarker = "function runTurnAi";
const endMarker = "function fuseRequirement";
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start + startMarker.length);
if (start < 0 || end < 0) throw new Error("Planner block boundaries not found");
const block = source.slice(start, end);

const localFunctions = [...block.matchAll(/^(?:export\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map(match => match[1]);
const allTopFunctions = [...source.matchAll(/^(?:export\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map(match => match[1]);
const localSet = new Set(localFunctions);
const called = new Set([...block.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)].map(match => match[1]));
const topFunctionDeps = allTopFunctions.filter(name => !localSet.has(name) && called.has(name));

const imported = new Set();
for (const match of source.matchAll(/^import\s+\{([^}]+)\}\s+from\s+[^;]+;/gm)) {
  for (const raw of match[1].split(",")) {
    const part = raw.trim();
    if (!part) continue;
    const pieces = part.split(/\s+as\s+/);
    imported.add((pieces[1] ?? pieces[0]).trim());
  }
}
const importedDeps = [...imported].filter(name => new RegExp(`\\b${name.replace(/[$]/g, "\\$")}\\b`).test(block)).sort();

const topConsts = [...source.slice(0, start).matchAll(/^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=/gm)].map(match => match[1]);
const constDeps = topConsts.filter(name => new RegExp(`\\b${name.replace(/[$]/g, "\\$")}\\b`).test(block));

const allIdentifiers = new Set([...block.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)].map(match => match[1]));
const known = new Set([...localFunctions, ...topFunctionDeps, ...importedDeps, ...constDeps]);
const interestingUnknown = [...allIdentifiers]
  .filter(name => /^(MAX_|BATTLE_|[a-z].*(Plan|Score|Value|Target|Attack|Evol|Play|Turn|State|Card|Deck|Mode|Strategy))/i.test(name))
  .filter(name => !known.has(name))
  .sort();

const lineAt = index => source.slice(0, index).split("\n").length;
const out = [
  `startLine=${lineAt(start)}`,
  `endLine=${lineAt(end) - 1}`,
  `chars=${block.length}`,
  `localFunctions=${localFunctions.length}`,
  "",
  `LOCAL=${localFunctions.join(", ")}`,
  "",
  `TOP_FUNCTION_DEPS=${topFunctionDeps.join(", ")}`,
  "",
  `IMPORTED_DEPS=${importedDeps.join(", ")}`,
  "",
  `CONST_DEPS=${constDeps.join(", ")}`,
  "",
  `INTERESTING_UNKNOWN=${interestingUnknown.join(", ")}`
];
await fs.writeFile(".v5-planner-deps.txt", `${out.join("\n")}\n`, "utf8");
console.log(out.join("\n"));
