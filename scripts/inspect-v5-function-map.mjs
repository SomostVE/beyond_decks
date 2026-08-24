import fs from "node:fs/promises";

const source = await fs.readFile("js/battle-engine-v5.js", "utf8");
const lines = source.split("\n");
const functionRegex = /^(?:export\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/;
const functions = [];
let lastMarker = "";
for (let index = 0; index < lines.length; index += 1) {
  const line = lines[index];
  const marker = line.match(/^\/\/\s*(\[\[[^\]]+\]\]|---\s*[^-]+|[A-Za-z].*rules.*)$/i);
  if (marker) lastMarker = marker[1].trim();
  const match = line.match(functionRegex);
  if (match) functions.push({ name: match[1], line: index + 1, marker: lastMarker });
}
for (let i = 0; i < functions.length; i += 1) {
  functions[i].end = (functions[i + 1]?.line ?? (lines.length + 1)) - 1;
  functions[i].size = functions[i].end - functions[i].line + 1;
}
const groups = [
  ["simulate", /simulate|inspect|makePlayer|instance|boardFollower|boardAmulet|initialX|recordHandEvolution|skyboundCount/i],
  ["planner-ai", /plan|score|best|lookahead|project|estimate|pass|decision|attack|evol|mulligan|bonus|mode/i],
  ["forest", /forest|yuel|titania|thestae|hart|krulle/i],
  ["sword", /sword|rally|loot|officer|commander/i],
  ["rune", /rune|spellboost|earth|faith|shikigami|crystal|golem/i],
  ["dragon", /dragon|overflow|burnite|drache/i],
  ["abyss", /abyss|necromancy|vengeance|wrath|charon|corruption/i],
  ["haven", /haven|engage|amulet|supplicant|lapis|sandalphon/i],
  ["portal", /portal|artifact|puppet|fuse|eudie|slaus/i],
  ["neutral", /neutral|mjerrabaine|apocalypse|illamrita/i],
  ["generic-effects", /highRisk|resolveText|effectContext|summon|draw|damage|destroy|cleanup|crest|trigger|keyword/i]
];
const out = [`totalLines=${lines.length}`, `topLevelFunctions=${functions.length}`, ""];
out.push("FUNCTIONS");
for (const fn of functions) out.push(`${String(fn.line).padStart(4)}-${String(fn.end).padEnd(4)} ${String(fn.size).padStart(4)} ${fn.name}${fn.marker ? ` | ${fn.marker}` : ""}`);
out.push("", "LARGEST");
for (const fn of [...functions].sort((a,b)=>b.size-a.size).slice(0,40)) out.push(`${String(fn.size).padStart(4)} ${fn.name} @ ${fn.line}-${fn.end}`);
out.push("", "GROUPS");
for (const [name, regex] of groups) {
  const matched = functions.filter(fn => regex.test(`${fn.name} ${fn.marker}`));
  const size = matched.reduce((sum, fn) => sum + fn.size, 0);
  out.push(`${name}: ${matched.length} funcs / ${size} lines`);
  for (const fn of matched.slice(0,80)) out.push(`  ${fn.line}-${fn.end} ${fn.name}`);
}
await fs.writeFile(".v5-function-map.txt", `${out.join("\n")}\n`, "utf8");
console.log(out.join("\n"));
