import fs from "node:fs/promises";

const enginePath = "js/battle-engine-v5.js";
const modulePath = "js/battle-engine-v5-high-risk.js";

let moduleSource = await fs.readFile(modulePath, "utf8");
const strayBoundary = /(\s*\/\/ \[\[class-mechanic-boundaries-v1\]\]\s*\n)\s*export\s*\n(?=\s*return \{)/;
if (!strayBoundary.test(moduleSource)) throw new Error("Expected stray export boundary not found in high-risk module");
moduleSource = moduleSource.replace(strayBoundary, "$1");
await fs.writeFile(modulePath, moduleSource, "utf8");

let engine = await fs.readFile(enginePath, "utf8");
const recipientBoundary = /(\/\/ \[\[class-mechanic-boundaries-v1\]\]\s*\n\s*)(?:export\s+)?function\s+isSpellboostRecipient\b/;
if (!recipientBoundary.test(engine)) {
  const fallback = /(?:export\s+)?function\s+isSpellboostRecipient\b/;
  if (!fallback.test(engine)) throw new Error("isSpellboostRecipient declaration not found in V5");
  engine = engine.replace(fallback, "export function isSpellboostRecipient");
} else {
  engine = engine.replace(recipientBoundary, "$1export function isSpellboostRecipient");
}
await fs.writeFile(enginePath, engine, "utf8");

if (/\/\/ \[\[class-mechanic-boundaries-v1\]\][\s\S]{0,40}\bexport\s*\n\s*return \{/.test(moduleSource)) {
  throw new Error("Stray export still present in high-risk module");
}
if (!/export\s+function\s+isSpellboostRecipient\b/.test(engine)) {
  throw new Error("isSpellboostRecipient export was not restored");
}

console.log("Restored the split export boundary between high-risk rules and isSpellboostRecipient.");
