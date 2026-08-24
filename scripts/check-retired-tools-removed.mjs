import fs from "node:fs";
import assert from "node:assert/strict";

const retiredFiles = [
  "engines.html",
  "lab.html",
  "css/engine-enhancements.css",
  "css/engines-extra.css",
  "css/engines.css",
  "css/lab-graph.css",
  "js/engine-model.js",
  "js/engines-extra.js",
  "js/engines-impact.js",
  "js/engines-shared.js",
  "js/engines.js",
  "js/lab-combo-cost.js",
  "js/lab-combo-explorer.js",
  "js/lab-graph.js",
  "js/lab-turn-planner.js",
  "js/lab.js"
];

for (const file of retiredFiles) {
  assert.equal(fs.existsSync(file), false, `${file} is retired and must not return`);
}

const activeFiles = [
  "README.md",
  "index.html",
  "collection.html",
  "battle.html",
  "css/base.css",
  "js/features-loader.js",
  "js/format-control.js",
  "js/mobile-ui.js",
  "js/tool-page-nav.js"
];

for (const file of activeFiles) {
  const source = fs.readFileSync(file, "utf8");
  assert.doesNotMatch(source, /(?:engines|lab)\.html/i, `${file} still links to a retired tool page`);
  assert.doesNotMatch(source, /(?:\.\/)?(?:engines(?:-extra|-impact|-shared)?|engine-model|lab(?:-combo-cost|-combo-explorer|-graph|-turn-planner)?)\.js/i, `${file} still imports a retired tool module`);
}

console.log("Retired Deck Lab / Engines cleanup: OK");
