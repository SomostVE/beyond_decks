import fs from "node:fs/promises";

const enginePath = "js/battle-engine-v5.js";
const modulePath = "js/battle-engine-v5-high-risk.js";

let moduleSource = await fs.readFile(modulePath, "utf8");
const strayExport = "  // [[class-mechanic-boundaries-v1]]\n  export\n\n  return {";
if (!moduleSource.includes(strayExport)) throw new Error("Expected stray export boundary not found in high-risk module");
moduleSource = moduleSource.replace(strayExport, "  // [[class-mechanic-boundaries-v1]]\n\n  return {");
await fs.writeFile(modulePath, moduleSource, "utf8");

let engine = await fs.readFile(enginePath, "utf8");
const missingExport = "// [[class-mechanic-boundaries-v1]]\nfunction isSpellboostRecipient";
if (!engine.includes(missingExport)) throw new Error("Expected isSpellboostRecipient boundary not found in V5");
engine = engine.replace(missingExport, "// [[class-mechanic-boundaries-v1]]\nexport function isSpellboostRecipient");
await fs.writeFile(enginePath, engine, "utf8");

console.log("Restored the split export boundary between high-risk rules and isSpellboostRecipient.");
