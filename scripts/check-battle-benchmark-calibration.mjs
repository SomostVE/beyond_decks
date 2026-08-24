import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { runMatchupBenchmark } from "../js/battle-benchmark-core.js";

const cards = JSON.parse(await fs.readFile(new URL("../data/official/cards.json", import.meta.url), "utf8"));
const refs = JSON.parse(await fs.readFile(new URL("../data/custom/reference-decks.json", import.meta.url), "utf8"));
const cardMap = new Map(cards.map(card => [Number(card.id), card]));
const decks = refs.decks ?? [];

const CALIBRATION_GAMES = 24;
const DETERMINISM_GAMES = 4;
const FOREST_GAMES = 12;

function deckList(reference) {
  return reference.cards.map(card => [Number(card.cardId), Number(card.qty ?? 1)]);
}

function fingerprint(result) {
  return {
    overall: result.overall,
    first: result.first,
    second: result.second,
    coverage: result.coverage,
    diagnostics: result.diagnostics
  };
}

const identityCalibration = decks.filter(deck => ["spell-runecraft", "aggro-abysscraft"].includes(deck.id));
assert.equal(identityCalibration.length, 2, "Calibration expects the two identity-bias reference decks");

for (const reference of identityCalibration) {
  const deck = deckList(reference);
  const shared = {
    playerDeck: deck,
    opponentDeck: deck,
    cardMap,
    playerStrategy: reference.strategy ?? {},
    opponentStrategy: reference.strategy ?? {}
  };

  // Keep the statistical sanity check separate from the exact reproducibility
  // probe. Replaying the full calibration twice made every CI run pay for the
  // same expensive AI simulations purely to prove determinism.
  const firstRun = runMatchupBenchmark({
    ...shared,
    games: CALIBRATION_GAMES,
    seed: `ci-calibration:${reference.id}`
  });

  const determinismInput = {
    ...shared,
    games: DETERMINISM_GAMES,
    seed: `ci-determinism:${reference.id}`
  };
  const deterministicA = runMatchupBenchmark(determinismInput);
  const deterministicB = runMatchupBenchmark(determinismInput);
  assert.deepEqual(fingerprint(deterministicB), fingerprint(deterministicA), `${reference.name}: identical seed/input must be exactly reproducible`);

  assert.equal(firstRun.first.games, CALIBRATION_GAMES / 2, `${reference.name}: calibration must split games evenly for First`);
  assert.equal(firstRun.second.games, CALIBRATION_GAMES / 2, `${reference.name}: calibration must split games evenly for Second`);
  assert.equal(firstRun.coverage.unsupportedCopies, 0, `${reference.name}: full-coverage calibration cannot contain unsupported cards`);
  assert.equal(firstRun.coverage.partialCopies, 0, `${reference.name}: full-coverage calibration cannot contain partial cards`);
  assert.equal(firstRun.overall.ruleGapsPerGame, 0, `${reference.name}: full-coverage mirror should have zero rule-gap exposures`);
  assert.equal(firstRun.diagnostics.rulesTier, "good", `${reference.name}: full-coverage mirror should be a good rules sample`);

  // Deliberately broad: this catches catastrophic identity/side bias without
  // pretending a small deterministic CI sample is a statistical balance test.
  assert.ok(firstRun.overall.winRate >= 20 && firstRun.overall.winRate <= 80, `${reference.name}: mirror win rate ${firstRun.overall.winRate.toFixed(1)}% indicates severe simulator identity bias`);
  assert.ok(firstRun.diagnostics.sideGap <= 60, `${reference.name}: mirror First/Second gap ${firstRun.diagnostics.sideGap.toFixed(1)}% is implausibly large`);

  console.log(`${reference.name}: mirror ${firstRun.overall.winRate.toFixed(1)}% · first ${firstRun.first.winRate.toFixed(1)}% · second ${firstRun.second.winRate.toFixed(1)}% · side gap ${firstRun.diagnostics.sideGap.toFixed(1)}% · deterministic OK`);
}

// Buff Forestcraft used to be the intentional partial-rules sentinel. It is
// now fully modeled, so calibration must fail if it ever regresses below 100%.
const forestReference = decks.find(deck => deck.id === "buff-forestcraft");
assert.ok(forestReference, "Calibration expects Buff Forestcraft");
const forestDeck = deckList(forestReference);
const forest = runMatchupBenchmark({
  playerDeck: forestDeck,
  opponentDeck: forestDeck,
  cardMap,
  playerStrategy: forestReference.strategy ?? {},
  opponentStrategy: forestReference.strategy ?? {},
  games: FOREST_GAMES,
  seed: "ci-calibration:forest-full"
});
assert.equal(forest.coverage.unsupportedCopies, 0, "Buff Forestcraft must contain no unsupported copies");
assert.equal(forest.coverage.partialCopies, 0, "Buff Forestcraft must contain no partial copies");
assert.equal(forest.coverage.player.modeledPercent, 100, "Buff Forestcraft player coverage must be 100%");
assert.equal(forest.coverage.opponent.modeledPercent, 100, "Buff Forestcraft opponent coverage must be 100%");
assert.equal(forest.overall.ruleGapsPerGame, 0, "Buff Forestcraft full mirror must expose zero rule gaps");
assert.equal(forest.diagnostics.rulesTier, "good", "Buff Forestcraft full mirror must be labeled good");

console.log(`Buff Forestcraft full-rules gate: ${forest.overall.ruleGapsPerGame.toFixed(2)} rule gaps/game · ${forest.diagnostics.rulesTier}`);
console.log("Battle Sim benchmark calibration: OK");
