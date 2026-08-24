import fs from "node:fs";
import assert from "node:assert/strict";

const read = path => fs.readFileSync(path, "utf8");
const exists = path => fs.existsSync(path);
const version = JSON.parse(read("version.json")).version;
const engineEntry = read("js/battle-engine.js");
const engine = read("js/battle-engine-v5.js");
const engineState = read("js/battle-engine-v5-state.js");
const engineClassRules = read("js/battle-engine-v5-class-rules.js");
const rulesCore = read("js/battle-rules-core.js");
const classRules = read("js/battle-class-mechanics.js");
const battleUi = read("js/battle.js");
const benchmark = read("js/battle-benchmark-fast.js");
const benchmarkWorker = read("js/battle-benchmark-fast-worker.js");
const replay = read("js/battle-replay-inspector.js");
const workflow = read(".github/workflows/validate-site.yml");
const readme = read("README.md");

assert.match(version, /^01\.05\.\d{3}$/, "Share-ready Battle Sim must remain on the 01.05 release line");
assert.match(engineEntry, /battle-engine-v5\.js/, "Public Battle Sim engine must point to v5");

for (const script of [
  "scripts/check-battle-class-contracts.mjs",
  "scripts/check-battle-class-mechanics.mjs",
  "scripts/check-battle-coverage-100.mjs",
  "scripts/audit-battle-final.mjs",
  "scripts/audit-battle-high-risk-runtime.mjs",
  "scripts/check-battle-v5-integration.mjs",
  "scripts/check-battle-sim.mjs",
  "scripts/check-battle-benchmark.mjs",
  "scripts/check-battle-benchmark-calibration.mjs",
  "scripts/check-battle-benchmark-compare.mjs"
]) assert.ok(exists(script), `Missing share-ready regression: ${script}`);

for (const [mechanic, owner] of [
  ["combo", "Forestcraft"],
  ["rally", "Swordcraft"],
  ["spellboost", "Runecraft"],
  ["earthRite", "Runecraft"],
  ["overflow", "Dragoncraft"],
  ["necromancy", "Abysscraft"]
]) {
  assert.match(classRules, new RegExp(`${mechanic}: \\"${owner}\\"`), `${mechanic} must remain owned by ${owner}`);
}
assert.match(classRules, /export function canUseClassRules/, "Bespoke class rule packages must have a leader-class boundary helper");
assert.doesNotMatch(classRules, /reanimate:\s*"Abysscraft"/, "Reanimate must preserve the official Neutral exception");

assert.match(engine, /playerClass\s*=\s*null, opponentClass\s*=\s*null/, "Simulation API must accept explicit class identities");
assert.match(engine, /resolveDeckClass\(deck, simulationMap, requested\)/, "Simulation must validate explicit class identity");
assert.match(engine, /import \{ createStats, costOf, snap \} from "\.\/battle-engine-v5-state\.js";/, "V5 must use the extracted state/replay module");
assert.match(engine, /import \{ createClassRules \} from "\.\/battle-engine-v5-class-rules\.js";/, "V5 must load the extracted class-rule module");
assert.match(engine, /createClassRules\(\{/, "V5 must wire the extracted class-rule runtime");
assert.match(engineState, /classMechanics:\s*classMechanicStatus\(player\)/, "Replay snapshots must expose class-specific mechanics");
assert.match(engineState, /import \{ classMechanicStatus, isSpellboostRecipientCard \} from "\.\/battle-class-mechanics\.js";/, "Replay state module must source class mechanics from the class boundary layer");
for (const mechanic of ["spellboost", "rally", "combo", "necromancy", "overflow", "earthRite"]) {
  assert.match(engine, new RegExp(`canUseClassMechanic\\([^\\n]+\\"${mechanic}\\"`), `Engine must gate ${mechanic} by class`);
}
for (const owner of ["Forestcraft", "Swordcraft", "Runecraft", "Dragoncraft", "Abysscraft"]) {
  assert.match(engineClassRules, new RegExp(`canUseClassRules\\(ctx\\.player, \\"${owner}\\"`), `${owner} bespoke rules must be leader-class locked`);
}
for (const mechanic of ["combo", "necromancy", "overflow"]) {
  assert.match(rulesCore, new RegExp(`canUseClassMechanic\\([^\\n]+\\"${mechanic}\\"`), `Generic rules must gate ${mechanic} by class`);
}

const fedielFastPathGate = 'if (!canUseClassMechanic(ctx.player, "necromancy", ctx.card)) return { applied: false, actions: ["Necromancy unavailable outside Abysscraft"], unresolved: false };';
assert.equal(engine.split(fedielFastPathGate).length - 1, 1, "Fediel must have one and only one dedicated Necromancy class guard");

assert.match(battleUi, /resolveDeckClass\(player\.deck, state\.cardMap, player\.class\)/, "Battle UI must reject off-class deck content");
assert.match(battleUi, /battle-class-mechanic/, "Battle UI must render class-specific resource state");
assert.doesNotMatch(battleUi, /<span>Shadows \$\{player\.shadows/, "Battle UI must not leak Abysscraft Shadows to every class");
assert.match(replay, /classMechanics:/, "Replay Inspector must retain class-specific state");

assert.match(benchmark, /playerClass:\s*job\.playerClass/, "Benchmark jobs must propagate player class");
assert.match(benchmark, /opponentClass:\s*job\.opponentClass/, "Benchmark jobs must propagate opponent class");
assert.match(benchmarkWorker, /playerClass:\s*payload\.playerClass/, "Benchmark worker must enforce player class");
assert.match(benchmarkWorker, /opponentClass:\s*payload\.opponentClass/, "Benchmark worker must enforce opponent class");

for (const step of [
  "Run Battle Sim exclusive class contracts",
  "Run strict all-card Battle Sim audit",
  "Run Battle Sim high-risk runtime gate",
  "Run Battle Sim benchmark calibration",
  "Run paired benchmark comparison smoke test"
]) assert.ok(workflow.includes(step), `CI is missing: ${step}`);

assert.match(readme, /## Battle Sim status/, "README must publish Battle Sim status");
assert.match(readme, /share-ready/i, "README must describe the Battle Sim as share-ready");
assert.match(readme, /deliberately intermediate/i, "README must state the AI limitation instead of claiming perfect play");
assert.match(readme, /Reanimate.*Neutral/i, "README must document the official Reanimate exception");

for (const temporary of [
  ".github/workflows/materialize-battle-sim-release.yml",
  "scripts/apply-battle-sim-release.mjs",
  "scripts/apply-battle-benchmark-class.mjs",
  ".battle-sim-release-trigger",
  ".github/workflows/materialize-class-rule-hardening.yml",
  "scripts/apply-class-rule-hardening.mjs",
  ".class-rule-hardening-trigger",
  ".github/workflows/materialize-fediel-cleanup.yml",
  "scripts/fix-fediel-class-gate-dup.mjs"
]) assert.equal(exists(temporary), false, `Temporary release materializer must not ship: ${temporary}`);

console.log("Battle Sim share-ready gate: OK · class contracts + bespoke rules + replay + benchmark + publication checks locked");
