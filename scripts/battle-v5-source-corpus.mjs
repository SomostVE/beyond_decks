import fs from "node:fs/promises";

const JS_DIRECTORY = new URL("../js/", import.meta.url);
const V5_MODULE_PATTERN = /^battle-engine-v5(?:-[^.]+)?\.js$/i;

export async function loadBattleV5SourceCorpus() {
  const moduleNames = (await fs.readdir(JS_DIRECTORY))
    .filter(name => V5_MODULE_PATTERN.test(name))
    .sort();

  if (!moduleNames.includes("battle-engine-v5.js")) {
    throw new Error("Battle V5 source corpus is missing battle-engine-v5.js");
  }

  const sources = await Promise.all(
    moduleNames.map(name => fs.readFile(new URL(`../js/${name}`, import.meta.url), "utf8"))
  );

  return sources.join("\n");
}
