import fs from "node:fs/promises";

const source = await fs.readFile("js/battle-engine-v5.js", "utf8");
const blocks = [
  ["classRules", "function bindHavencraftRuntime", "function highRiskWordNumber"],
  ["planner", "function runTurnAi", "function fuseRequirement"],
  ["highRisk", "function highRiskWordNumber", "function isSpellboostRecipient"],
  ["combat", "function maybeEvolve", "function restoreTemporaryAttack"]
];
const builtins = new Set(["if","for","while","switch","catch","function","return","typeof","Number","String","Boolean","Math","Object","Array","Set","Map","Date","RegExp","Error","Promise","parseInt","parseFloat","isNaN","Infinity","console"]);
const allTop = new Set([...source.matchAll(/^(?:export\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map(m=>m[1]));
const out = [];
for (const [name, startMarker, endMarker] of blocks) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) { out.push(`${name}: boundary missing`); continue; }
  const block = source.slice(start, end);
  const local = new Set([...block.matchAll(/^(?:export\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map(m=>m[1]));
  const called = new Set([...block.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)].map(m=>m[1]));
  const external = [...called].filter(id => !local.has(id) && !builtins.has(id)).sort();
  const topExternal = external.filter(id => allTop.has(id));
  const importedOrUnknown = external.filter(id => !allTop.has(id));
  out.push(`## ${name}`);
  out.push(`chars=${block.length} localFunctions=${local.size}`);
  out.push(`local=${[...local].join(", ")}`);
  out.push(`topLevelDeps=${topExternal.join(", ")}`);
  out.push(`otherCalls=${importedOrUnknown.join(", ")}`);
  out.push("");
}
await fs.writeFile(".v5-block-deps.txt", `${out.join("\n")}\n`, "utf8");
console.log(out.join("\n"));
