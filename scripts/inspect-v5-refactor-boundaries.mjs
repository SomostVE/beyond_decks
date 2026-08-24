import fs from "node:fs/promises";

const path = "js/battle-engine-v5.js";
const source = await fs.readFile(path, "utf8");
const lines = source.split("\n");
const targets = [
  "modes",
  "expandModes",
  "stripFuseAbilityText",
  "baseText",
  "section",
  "playableOptions",
  "inspectPlayableModes",
  "engageInfo",
  "resolveText"
];
const functionRegex = /^(?:export\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/;
const functions = [];
for (let index = 0; index < lines.length; index += 1) {
  const match = lines[index].match(functionRegex);
  if (match) functions.push({ name: match[1], line: index + 1 });
}
const byName = new Map(functions.map((entry, index) => [entry.name, { ...entry, index }]));
const out = [`totalLines=${lines.length}`];
for (const target of targets) {
  const entry = byName.get(target);
  if (!entry) {
    out.push(`${target}=missing`);
    continue;
  }
  const next = functions[entry.index + 1] ?? null;
  out.push(`${target}=line ${entry.line}; next=${next ? `${next.name}@${next.line}` : "EOF"}`);
}
out.push("\nFunctions from modes through section:");
const start = byName.get("modes")?.index ?? 0;
const end = byName.get("section")?.index ?? start;
for (const entry of functions.slice(start, end + 4)) out.push(`${entry.line}: ${entry.name}`);
await fs.writeFile(".v5-refactor-boundaries.txt", `${out.join("\n")}\n`, "utf8");
console.log(out.join("\n"));
