import {
  executeGenericEffects,
  getCountdown,
  getTriggeredText,
  applyEntryCrestEffects,
  applyFollowerDestroyedEffects,
  applySpellPlayedEffects,
  applyBuffedFollowerEffects
} from "./battle-rules.js";
import { canUseClassMechanic, canUseClassRules, classMechanicStatus, isSpellboostRecipientCard, resolveDeckClass } from "./battle-class-mechanics.js";
import { prepareOriginalCardMap, prepareSimulationCardMap as prepareSimulationCardMapWithSupport } from "./battle-engine-v5-card-preparation.js";
import { analyzeCardSupport, analyzeDeckCoverage, normalizeDeck } from "./battle-engine-v5-coverage.js";
import { createStats, costOf, snap } from "./battle-engine-v5-state.js";
import { cloneStats, compact, has, hasU, norm, uniq, cap, word, createRng, shuffle, clamp } from "./battle-engine-v5-utils.js";
import { expandModes, baseText, crystallizeText, section } from "./battle-engine-v5-text.js";
import { hasCrest, gainCrest, crestCountdown } from "./battle-engine-v5-crests.js";
import { modes } from "./battle-engine-v5-modes.js";
import { targetableEnemyFollowers, targetEffectSpec, followerThreatValue, targetBranchValue, expandPlayTargetBranches, chooseTarget, choosePlannedTarget, chooseRandomTarget, tradeTarget } from "./battle-engine-v5-targeting.js";
import { createClassRules } from "./battle-engine-v5-class-rules.js";
import { createPlanner } from "./battle-engine-v5-planner.js";
import { createHighRiskRules } from "./battle-engine-v5-high-risk.js";

export { analyzeCardSupport, analyzeDeckCoverage };

export const BATTLE_RULES_VERSION = 5;

const MAX_ROUNDS = 60;
const MAX_ACTIONS = 24;

const {
  bindHavencraftRuntime,
  applyHavencraftDrawTriggers,
  applyHavencraftEngageTriggers,
  applyHavencraftSuperEvolveHandTriggers,
  applyHavencraftMarkedEndTurnBanish,
  dealHavenSplitDamage,
  drawDefenseFourFollower,
  havencraftCrestLastWords,
  applyHavencraftCrestTurnEnd,
  resolveHavencraftCardText,
  replaceWithMjerrabaineDeck,
  replaceWithApocalypseDeck,
  applyNeutralCardPlayedTriggers,
  neutralCrestLastWords,
  applyNeutralMarkedEndTurnBanish,
  applyNeutralCrestTurnEnd,
  resolveNeutralCardText,
  isPortalArtifactFollower,
  isPortalPuppetryFollower,
  isBaseCostAtLeast,
  applyPortalTemporaryCost,
  applyPortalTemporaryCostToHand,
  restorePortalcraftTemporaryCosts,
  applyPortalcraftEntryEvents,
  applyPortalcraftSpellPlayedTriggers,
  chooseUnusedPortalMode,
  applyPortalcraftSlausMode,
  applyPortalcraftPreTickCrestTurnStart,
  applyPortalcraftCrestTurnEnd,
  resolvePortalcraftCardText,
  boardFollower,
  boardAmulet,
  recordAbyssModeSelection,
  isDepartedFollower,
  applyAbysscraftEntryEvents,
  applyAbysscraftSuperEvolveTriggers,
  applyAbysscraftFollowerDestroyedEvents,
  applyAbysscraftCrestTurnStart,
  handHasFourSameCost,
  applyAbysscraftCrestTurnEnd,
  abysscraftCrestLastWords,
  destroyAbyssCrest,
  advanceAbyssCrest,
  transformFollowerInto,
  resolveAbysscraftCardText,
  isMarineFollower,
  drawMatchingCard,
  applyDragoncraftEntryEvents,
  applyDragoncraftSuperEvolveHandTriggers,
  restoreDragoncraftTemporaryCosts,
  applyDragoncraftAttackDeclaration,
  dragoncraftCrestLastWords,
  applyDragoncraftFollowerTurnEnd,
  applyDragoncraftCrestTurnEnd,
  triggerDiscardedCard,
  discardDragoncraftCard,
  applyAzurifritTripleDamage,
  resolveDragoncraftCardText,
  isPixieFollower,
  applyForestSuperEvolveHandTriggers,
  applyForestEvolutionTriggers,
  summonExactFollowerCopy,
  applyForestEntryEvents,
  forestcraftCrestLastWords,
  applyForestCrestTurnStart,
  applyForestCrestTurnEnd,
  applyForestFollowerPlayedCrest,
  transformEnemyFollowerInto,
  resolveForestcraftCardText,
  runecraftTrait,
  isCrystalspawn,
  isGolemFollower,
  recordDestroyedShikigami,
  performEarthRite,
  silenceFollower,
  applySwordcraftSuperEvolveHandTriggers,
  applySwordcraftSpellPlayedTriggers,
  swordcraftCrestLastWords,
  applySwordcraftLootCrestEvent,
  applySwordcraftCrestTurnEnd,
  applySwordcraftEnemyEntryEvents,
  applySwordcraftTurnStartLocks,
  clearSwordcraftTurnLocks,
  resolveSwordcraftCardText,
  runecraftCrestLastWords,
  destroyRunecraftCrest,
  applyRunecraftEntryEvents,
  applyRunecraftCardPlayedTriggers,
  applyInstituteChangedCostTrigger,
  applyRunecraftAttackDeclaration,
  applyRunecraftCrestTurnStart,
  applyRunecraftCrestTurnEnd,
  applyRunecraftOpponentTurnEndCrests,
  transformAlliedFollowersFromDeck,
  resolveRunecraftCardText,
  buff
} = createClassRules({
  addHand,
  afterLeaderHeal,
  applyEntryEvents,
  banish,
  cleanup,
  damageLeader,
  damageUnit,
  destroyObject,
  destroyUnit,
  drawCards,
  effectContext,
  evolveUnitByAbility,
  findByName,
  giveKeyword,
  hasTrait,
  healPlayer,
  instance,
  notifyFollowerLeavesField,
  reanimate,
  related,
  resolveText,
  spellboostHand,
  summonWithEvents,
  superEvolveUnitByAbility,
  toCemetery,
  transformHandInstance
});

const {
  highRiskWordNumber,
  highRiskIsArtifact,
  highRiskCopyInstance,
  highRiskAddCopyToHand,
  highRiskSummonExactFromHand,
  highRiskSummonExactFromUnit,
  highRiskSummonAmulet,
  highRiskHistoryCards,
  highRiskDiscardItems,
  highRiskReplayFanfare,
  highRiskRandomAbilitySegments,
  highRiskApplyEndOpponentTurnDestruction,
  highRiskRestoreOpponentHandCosts,
  highRiskEnemySuperEvolveHandTriggers,
  highRiskHandTurnEndTriggers,
  highRiskDrawMatching,
  highRiskSummonDeckCard,
  highRiskOtherAlliedFollower,
  highRiskGrantKeyword,
  highRiskAlliedGroup,
  resolveHighRiskGenericText,
  resolveText,
  effectContext,
  effectContextBare
} = createHighRiskRules({
  instance,
  recordHandEvolution,
  skyboundCountForInstance,
  drawCards,
  spellboostHand,
  reanimate,
  related,
  findByName,
  summonWithEvents,
  summonFromDeckDifferentNames,
  summonWithoutLastWords,
  addHand,
  giveKeyword,
  applyEntryEvents,
  afterLeaderHeal,
  evolveUnitByAbility,
  superEvolveUnitByAbility,
  damageLeader,
  damageUnit,
  healPlayer,
  notifyFollowerLeavesField,
  cleanup,
  destroyObject,
  toCemetery,
  destroyUnit,
  banish,
  bounce,
  executeGenericEffects,
  applyBuffedFollowerEffects,
  canUseClassMechanic,
  costOf,
  has,
  hasU,
  norm,
  uniq,
  cap,
  word,
  shuffle,
  expandModes,
  section,
  gainCrest,
  modes,
  followerThreatValue,
  choosePlannedTarget,
  chooseRandomTarget,
  resolveHavencraftCardText,
  resolveNeutralCardText,
  resolvePortalcraftCardText,
  boardFollower,
  boardAmulet,
  recordAbyssModeSelection,
  resolveAbysscraftCardText,
  drawMatchingCard,
  triggerDiscardedCard,
  resolveDragoncraftCardText,
  summonExactFollowerCopy,
  resolveForestcraftCardText,
  performEarthRite,
  silenceFollower,
  resolveSwordcraftCardText,
  resolveRunecraftCardText,
  buff
});

const {
  runTurnAi,
  clonePlanningItem,
  clonePlanningUnit,
  clonePlanningPlayer,
  clonePlanningState,
  planningPublicSeed,
  makePlanningRoot,
  plannerCardResourceValue,
  plannerDeathTriggerValue,
  plannerBoardValue,
  plannerStateValue,
  actionKey,
  plannerAttackPrior,
  enumerateAttackDecisions,
  evolutionTargetPlans,
  enumerateEvolutionDecisions,
  enumerateEngageDecisions,
  diversifyPlannerActions,
  enumeratePlannerActions,
  plannerReadyFaceDamage,
  plannerOptimisticBurst,
  shouldRunPlannerLethalSearch,
  enumerateLethalPlannerActions,
  plannerLethalSearchScore,
  findPlannerLethal,
  hasAnyPlannerAction,
  executeEvolutionDecision,
  executeSingleAttackDecision,
  executePlannerAction,
  plannerEvolutionSpendCost,
  plannerNodeScore,
  planCurrentTurnBase,
  resetPlanningTurnState,
  beginPlanningTurn,
  finishPlanningTurn,
  executePlannerSequence,
  resampleFutureScenario,
  simulateOneOpponentResponse,
  uniqueFirstActionCandidates,
  buildFutureFirstActionCandidates,
  shouldUseTwoTurnLookahead,
  evaluateCandidateFuture,
  planCurrentTurn,
  plannerActionView,
  inspectTurnPlan,
  inspectTwoTurnPlan
} = createPlanner({
  makePlayer,
  installLeaderDamageGuard,
  instance,
  recordHandEvolution,
  drawCards,
  useBonusPpIfUseful,
  getFuseActions,
  resolveFuseAction,
  scoredPlayOptions,
  scorePassDecision,
  estimateVisibleIncomingDamage,
  playCard,
  highRiskEnemySuperEvolveHandTriggers,
  resolveText,
  afterLeaderHeal,
  turnStart,
  turnEnd,
  readyBoard,
  engageInfo,
  scoreEngage,
  resolveEngage,
  scoreEvolutionCandidate,
  attackPhase,
  attackable,
  activeWards,
  willFollowerDieInCombat,
  damageLeader,
  damageUnit,
  hasCollectiveBoardLethal,
  canCombatRemove,
  strike,
  healPlayer,
  cleanup,
  getUnitTriggeredText,
  destroyUnit,
  banish,
  createStats,
  snap,
  cloneStats,
  compact,
  has,
  hasU,
  norm,
  cap,
  createRng,
  shuffle,
  hasCrest,
  modes,
  targetableEnemyFollowers,
  targetEffectSpec,
  followerThreatValue,
  targetBranchValue,
  MAX_ACTIONS,
  applyHavencraftSuperEvolveHandTriggers,
  boardFollower,
  applyAbysscraftSuperEvolveTriggers,
  applyDragoncraftSuperEvolveHandTriggers,
  applyForestEvolutionTriggers,
  applySwordcraftSuperEvolveHandTriggers,
  applyRunecraftAttackDeclaration,
  buff
});

export { inspectTurnPlan, inspectTwoTurnPlan };





export function simulateBattle({ playerDeck, opponentDeck, cardMap, playerStrategy = {}, opponentStrategy = {}, playerClass = null, opponentClass = null, seed = "deci-builder", playerSide = "random", recordFrames = true }) {
  const simulationMap = prepareSimulationCardMap(cardMap);
  const inferClass = (deck, requested) => {
    if (requested) return resolveDeckClass(deck, simulationMap, requested);
    try { return resolveDeckClass(deck, simulationMap); }
    catch { return null; }
  };
  const resolvedPlayerClass = inferClass(playerDeck, playerClass);
  const resolvedOpponentClass = inferClass(opponentDeck, opponentClass);
  const rng = createRng(seed);
  const side = playerSide === "first" ? 0 : playerSide === "second" ? 1 : (rng() < .5 ? 0 : 1);
  const first = side === 0 ? 0 : 1;
  const second = 1 - first;
  const players = [
    makePlayer("You", playerDeck, playerStrategy, simulationMap, rng, resolvedPlayerClass),
    makePlayer("Opponent", opponentDeck, opponentStrategy, simulationMap, rng, resolvedOpponentClass)
  ];
  players[first].goingFirst = true;
  players[second].goingSecond = true;
  players[second].bonusPpAvailable = true;
  const stats = createStats();
  const frames = [];

  drawCards(players[0], 4, stats, 0);
  drawCards(players[1], 4, stats, 1);
  snap(frames, players, { round: 0, active: first, phase: "opening", action: "Both players draw 4 cards." }, stats, recordFrames);
  mulligan(players[0], rng, stats, 0, frames, players, recordFrames);
  mulligan(players[1], rng, stats, 1, frames, players, recordFrames);

  let winner = null;
  let lastRound = 0;
  outer: for (let round = 1; round <= MAX_ROUNDS; round += 1) {
    lastRound = round;
    for (const active of [first, second]) {
      const enemy = 1 - active;
      const p = players[active], o = players[enemy];
      p.isActive = true;
      o.isActive = false;
      p.personalTurn += 1;
      p.cardsPlayedThisTurn = 0;
      p.spellsPlayedThisTurn = 0;
      p.evolutionActionUsed = false;
      p.followersAttackedThisTurn = false;
      // [[battle-runecraft-turn-state]]
      p.shikigamiDestroyedBaseAttackThisTurn = 0;
      p.shikigamiDestroyedBaseDefenseThisTurn = 0;
      // Fuse is usable once per turn per current Fuse card. A transformed card
      // is a new Fuse card and resets this flag immediately in transformHandInstance.
      for (const item of p.hand) item.fusedThisTurn = false;
      p.futureLookaheadUsedThisTurn = false;
      p.maxPp = Math.min(10, p.maxPp + 1);
      p.pp = p.maxPp;
      if (p.goingSecond && p.personalTurn === 6 && p.bonusPpUses < 2) p.bonusPpAvailable = true;
      readyBoard(p);

      const start = turnStart(p, o, active, enemy, stats, rng, simulationMap);
      snap(frames, players, { round, active, phase: "turn-start", action: compact(`${p.name} starts turn ${p.personalTurn} with ${p.pp}/${p.maxPp} PP.`, start) }, stats, recordFrames);
      if (p.hp <= 0) { winner = enemy; break outer; }
      if (o.hp <= 0) { winner = active; break outer; }

      drawCards(p, 1, stats, active);
      if (p.specialVictory) {
        winner = active;
        snap(frames, players, { round, active, phase: "draw", action: `${p.name} draws the Victory card and wins.` }, stats, recordFrames);
        break outer;
      }
      if (p.deckOut) {
        winner = enemy;
        snap(frames, players, { round, active, phase: "draw", action: `${p.name} cannot draw from an empty deck and loses.` }, stats, recordFrames);
        break outer;
      }
      snap(frames, players, { round, active, phase: "draw", action: `${p.name} draws a card.` }, stats, recordFrames);

      runTurnAi({
        player: p, opponent: o, playerIndex: active, enemyIndex: enemy,
        stats, frames, players, round, rng, map: simulationMap, record: recordFrames
      });
      if (p.hp <= 0) { winner = enemy; break outer; }
      if (o.hp <= 0) { winner = active; break outer; }

      const end = turnEnd(p, o, active, enemy, stats, rng, simulationMap);
      stats.ppWasted[active] += Math.max(0, Math.min(p.pp, p.maxPp));
      snap(frames, players, { round, active, phase: "turn-end", action: compact(`${p.name} ends turn ${p.personalTurn}.`, end) }, stats, recordFrames);
      if (p.specialVictory) { winner = active; break outer; }
      if (p.hp <= 0) { winner = enemy; break outer; }
      if (o.hp <= 0) { winner = active; break outer; }
      p.isActive = false;
    }
  }

  const coverage = [analyzeDeckCoverage(playerDeck, cardMap), analyzeDeckCoverage(opponentDeck, cardMap)];
  return {
    frames,
    coverage,
    summary: {
      winner: winner == null ? "Draw / turn limit" : players[winner].name,
      winnerIndex: winner,
      rounds: lastRound,
      finalHp: players.map(p => p.hp),
      stats,
      experimental: coverage.some(item => item.unsupported || item.partial)
    }
  };
}



// [[battle-haven-full-qa]]
export function inspectHavenFullRules({ supplicant, sacredGriffon, lapis } = {}) {
  const syntheticAmulet = {
    id: -990001,
    name: "QA Engage Amulet",
    class: "Havencraft",
    type: "Amulet",
    cost: 0,
    text: "Engage (0): Restore 1 defense to your leader.",
    keywords: ["Engage"],
    traits: [],
    relatedCards: []
  };
  const cards = [supplicant, sacredGriffon, lapis, syntheticAmulet].filter(Boolean);
  const map = new Map(cards.map(card => [Number(card.id), card]));
  const rng = createRng("haven-full-qa");
  const stats = createStats();
  const player = makePlayer("You", [], { style: "ward-control" }, map, rng);
  const opponent = makePlayer("Opponent", [], { style: "midrange" }, map, rng);
  player.isActive = true;
  opponent.isActive = false;
  player.personalTurn = 5;

  gainCrest(player, "Supplicant of Repose", supplicant);
  const supplicantCrest = player.crests.find(crest => norm(crest.name) === "supplicant of repose");
  player.hp = 10;
  player.followersAttackedThisTurn = false;
  const supplicantActions = applyCrestTurnEnd(player, opponent, 0, 1, stats, rng, map);
  const supplicantHeals = player.hp === 11;
  player.hp = 10;
  player.followersAttackedThisTurn = true;
  applyCrestTurnEnd(player, opponent, 0, 1, stats, rng, map);
  const supplicantBlocksAfterAttack = player.hp === 10;

  player.board = [];
  player.crests = [];
  player.pp = 1;
  const griffon = boardFollower(instance(player, sacredGriffon));
  const amulet = {
    uid: "qa-engage-amulet",
    card: syntheticAmulet,
    cardId: syntheticAmulet.id,
    name: syntheticAmulet.name,
    type: "Amulet",
    countdown: null,
    engagedThisTurn: false
  };
  player.board.push(griffon, amulet);
  const engageResult = resolveEngage(amulet, player, opponent, 0, 1, stats, rng, map);
  const griffonGetsStorm = hasU(griffon, "Storm") && griffon.canAttackLeader;

  player.board = [];
  player.crests = [];
  player.personalTurn = 6;
  gainCrest(player, "Lapis, Shining Seraph", lapis);
  const lapisCrest = player.crests.find(crest => norm(crest.name) === "lapis, shining seraph");
  if (lapisCrest) {
    lapisCrest.countdown = 1;
    lapisCrest.gainedTurn = 5;
  }
  const lapisActions = [];
  tickCrests(player, opponent, 0, 1, stats, rng, map, lapisActions);
  const summonedLapis = player.board.find(unit => norm(unit.name) === "lapis, shining seraph");

  return {
    supplicant: {
      countdown: supplicantCrest?.countdown ?? null,
      healsWithoutAttack: supplicantHeals,
      blocksHealAfterAttack: supplicantBlocksAfterAttack,
      actions: supplicantActions
    },
    sacredGriffon: {
      gainsStormOnEngage: griffonGetsStorm,
      actions: engageResult.actions ?? []
    },
    lapis: {
      countdown: crestCountdown("Lapis, Shining Seraph"),
      summonsWithStorm: Boolean(summonedLapis && hasU(summonedLapis, "Storm")),
      crestRemoved: !hasCrest(player, "Lapis, Shining Seraph"),
      actions: lapisActions
    }
  };
}

// [[battle-runecraft-full-qa]]
export function inspectRunecraftFullRules({ cards = [] } = {}) {
  const map = new Map(cards.map(card => [Number(card.id), card]));
  prepareOriginalCardMap(map);
  const byName = name => findByName(map, name);
  const rng = createRng("runecraft-full-qa");
  const stats = createStats();
  const player = makePlayer("You", [], { style: "spell-combo" }, map, rng);
  const opponent = makePlayer("Opponent", [], {}, map, rng);
  player.isActive = true;
  opponent.isActive = false;
  player.personalTurn = 7;
  player.maxPp = player.pp = 10;
  const actions = [];

  // Lhynkal Crest only starts reducing max defense on subsequent entries.
  gainCrest(player, "Lhynkal, Wandering Fool", byName("Lhynkal, Wandering Fool"));
  const lhynkal = boardFollower(instance(player, byName("Lhynkal, Wandering Fool")));
  player.board.push(lhynkal);
  applyEntryEvents({ player, opponent, playerIndex: 0, enemyIndex: 1, stats, rng, cardMap: map }, lhynkal);
  const lhynkalMaxDefense = opponent.maxHp;
  player.board = [];

  // Earth Rite must discount both reactive hand spells exactly once per Rite.
  const bottomless = instance(player, byName("Bottomless Gluttony"));
  const heel = instance(player, byName("Heel, My Dearie"));
  player.hand = [bottomless, heel];
  player.earthSigils = 2;
  performEarthRite(player, 2, actions);
  const earthRiteDiscounts = [bottomless.costDelta, heel.costDelta];

  // Crystalspawn increments Faith and discounts Calge-Danthla in hand.
  const calge = instance(player, byName("Calge-Danthla, Eld Crystals"));
  player.hand = [calge];
  player.faithActive = true;
  player.faith = 0;
  const crystal = boardFollower(instance(player, byName("Crystalspawn")));
  player.board = [crystal];
  applyEntryEvents({ player, opponent, playerIndex: 0, enemyIndex: 1, stats, rng, cardMap: map }, crystal);
  const faithAfterCrystal = player.faith;
  const calgeDiscount = calge.costDelta;

  // Tico Crest damages on Mysteria spell play.
  gainCrest(player, "Tico, Mysterian Spellcrafter", byName("Tico, Mysterian Spellcrafter"));
  opponent.hp = 20;
  applyRunecraftCardPlayedTriggers(player, opponent, byName("Mysterian Missile"), 0, stats, actions);
  const ticoDamage = 20 - opponent.hp;

  // Shymm Crest buffs Crystalspawn as the attack is declared.
  gainCrest(player, "Shymm, Love Bewitched", byName("Shymm, Love Bewitched"));
  const attackBefore = crystal.attack;
  applyRunecraftAttackDeclaration(player, crystal, actions);
  const shymmAttackBuff = crystal.attack - attackBefore;

  // Institute Engage changes cost and stats; playing a changed-cost follower draws and advances countdown.
  const instituteCard = byName("Institute of Truth");
  const institute = boardAmulet(instance(player, instituteCard));
  institute.countdown = 5;
  const targetHand = instance(player, byName("Lhynkal, Wandering Fool"));
  player.board = [institute];
  player.hand = [targetHand];
  resolveRunecraftCardText("Select a follower in your hand, increase its cost by 1, and give it +1/+1.", { card: instituteCard, sourceUnit: institute, player, opponent, playerIndex: 0, enemyIndex: 1, stats, rng, cardMap: map });
  const instituteEngage = { costDelta: targetHand.costDelta, attackBonus: targetHand.attackBonus, defenseBonus: targetHand.defenseBonus };
  player.deck = [instance(player, byName("Lhynkal, Wandering Fool"))];
  player.hand = [];
  applyInstituteChangedCostTrigger(player, opponent, targetHand.card, true, 0, 1, stats, rng, map, actions);
  const instituteReaction = { countdown: institute.countdown, hand: player.hand.length };

  // Depths uses one equal X/Y/Z roll per pre-summon Faith point.
  player.board = [];
  player.hand = [];
  player.faithActive = true;
  player.faith = 6;
  player.hp = 10;
  player.maxHp = 20;
  opponent.hp = 20;
  const depths = byName("Depths of the Eld Crystals");
  const beforeFaith = player.faith;
  const beforeHp = player.hp;
  const beforeEnemyHp = opponent.hp;
  resolveRunecraftCardText(depths.text, { card: depths, player, opponent, playerIndex: 0, enemyIndex: 1, stats, rng, cardMap: map });
  const depthCrystal = player.board.find(isCrystalspawn);
  const depthX = depthCrystal ? Math.max(0, depthCrystal.attack - (Number(depthCrystal.card?.attack) || 0)) : 0;
  const depthY = player.hp - beforeHp;
  const depthZ = beforeEnemyHp - opponent.hp;
  const depthPartition = { faith: beforeFaith, x: depthX, y: depthY, z: depthZ, sum: depthX + depthY + depthZ };

  // Grandeur copies followers from deck without removing them.
  const odin = byName("Odin, Twilit Fate");
  player.deck = odin ? [instance(player, odin)] : [];
  const dummyCard = { id: -88101, name: "QA Rune Body", class: "Runecraft", type: "Follower", cost: 1, attack: 1, defense: 1, text: "", keywords: [], traits: [] };
  player.board = [boardFollower(instance(player, dummyCard)), boardFollower(instance(player, dummyCard))];
  transformAlliedFollowersFromDeck({ player, opponent, playerIndex: 0, enemyIndex: 1, stats, rng, cardMap: map }, actions);
  const grandeurNames = player.board.map(unit => unit.name);

  // Countdown Crest Last Words.
  const enemyDummy = boardFollower(instance(opponent, { ...dummyCard, id: -88102, name: "QA Enemy", defense: 4 }));
  opponent.board = [enemyDummy];
  player.board = [];
  player.deck = [instance(player, dummyCard), instance(player, dummyCard)];
  player.hand = [];
  const crystalGazing = { name: "Crystal Gazing" };
  runecraftCrestLastWords(crystalGazing, player, opponent, 0, 1, stats, rng, map, actions);
  const crystalGazingResult = { drawn: player.hand.length, enemyBoard: opponent.board.length };

  return {
    lhynkalMaxDefense,
    earthRiteDiscounts,
    faithAfterCrystal,
    calgeDiscount,
    ticoDamage,
    shymmAttackBuff,
    instituteEngage,
    instituteReaction,
    depthPartition,
    grandeurNames,
    crystalGazingResult
  };
}

// [[battle-runecraft-extended-qa]]
export function inspectRunecraftExtendedRules({ cards = [] } = {}) {
  const map = new Map(cards.map(card => [Number(card.id), card]));
  prepareOriginalCardMap(map);
  const byName = name => findByName(map, name);
  const makePair = seed => {
    const rng = createRng(`runecraft-extended:${seed}`);
    const stats = createStats();
    const player = makePlayer("You", [], { style: "spell-combo" }, map, rng);
    const opponent = makePlayer("Opponent", [], {}, map, rng);
    player.isActive = true;
    opponent.isActive = false;
    player.personalTurn = 7;
    player.maxPp = player.pp = 10;
    return { player, opponent, rng, stats };
  };
  const dummy = (id, name, attack = 1, defense = 3, keywords = [], traits = []) => ({
    id, name, class: "Runecraft", type: "Follower", cost: 1, attack, defense, text: "", keywords, traits, relatedCards: []
  });

  // Persistent Runecraft Crest start-turn effects.
  const elm = makePair("elmott");
  gainCrest(elm.player, "Elmott, Remembrance Aflame", byName("Elmott, Remembrance Aflame"));
  elm.opponent.hp = 20;
  applyRunecraftCrestTurnStart(elm.player, elm.opponent, 0, 1, elm.stats, elm.rng, map);
  const elmottStartDamage = 20 - elm.opponent.hp;

  const cag = makePair("cagliostro");
  cag.player.earthSigils = 1;
  gainCrest(cag.player, "Cagliostro, Genius Alchemist", byName("Cagliostro, Genius Alchemist"));
  applyRunecraftCrestTurnStart(cag.player, cag.opponent, 0, 1, cag.stats, cag.rng, map);
  const cagliostroStart = {
    earthSigils: cag.player.earthSigils,
    ars: cag.player.hand.filter(item => norm(item.card?.name) === "ars magna").length
  };

  const berg = makePair("bergent");
  gainCrest(berg.player, "Bergent, Rejected Artes", byName("Bergent, Rejected Artes"));
  applyRunecraftCrestTurnStart(berg.player, berg.opponent, 0, 1, berg.stats, berg.rng, map);
  const bergentStart = berg.player.board.filter(unit => norm(unit.name) === "onion patch").length;

  // End-turn Runecraft Crests.
  const pas = makePair("pascale");
  gainCrest(pas.player, "Pascale's Dance", byName("Pascale's Dance"));
  pas.player.earthSigils = 10;
  pas.player.deck = [instance(pas.player, dummy(-88201, "QA Draw"))];
  const pasUnit = boardFollower(instance(pas.player, dummy(-88202, "QA Double", 2, 3)));
  pas.player.board = [pasUnit];
  applyRunecraftCrestTurnEnd(pas.player, pas.opponent, 0, 1, pas.stats, pas.rng, map);
  const pascaleEnd = { attack: pasUnit.attack, defense: pasUnit.defense, earthSigils: pas.player.earthSigils, hand: pas.player.hand.length };

  const juno = makePair("juno");
  gainCrest(juno.player, "Juno, Visionary Alchemist", byName("Juno, Visionary Alchemist"));
  juno.player.earthSigils = 1;
  applyRunecraftCrestTurnEnd(juno.player, juno.opponent, 0, 1, juno.stats, juno.rng, map);
  const junoEnd = { earthSigils: juno.player.earthSigils, guardians: juno.player.board.filter(unit => norm(unit.name) === "guardian golem").length };

  // Countdown Crest Last Words.
  const ins = makePair("insomniac");
  ins.player.board = [boardFollower(instance(ins.player, dummy(-88203, "QA Ally", 1, 3)))];
  ins.opponent.board = [boardFollower(instance(ins.opponent, dummy(-88204, "QA Enemy", 1, 3)))];
  runecraftCrestLastWords({ name: "Insomniac Witch" }, ins.player, ins.opponent, 0, 1, ins.stats, ins.rng, map, []);
  const insomniacLastWords = { allied: ins.player.board.length, enemy: ins.opponent.board.length };

  // Entry reactions.
  const enr = makePair("enraptured");
  enr.player.hp = 10;
  const student = boardFollower(instance(enr.player, byName("Enraptured Student")));
  const crystal = boardFollower(instance(enr.player, byName("Crystalspawn")));
  enr.player.board = [student, crystal];
  applyEntryEvents({ player: enr.player, opponent: enr.opponent, playerIndex: 0, enemyIndex: 1, stats: enr.stats, rng: enr.rng, cardMap: map }, crystal);
  const enrapturedHeal = enr.player.hp - 10;

  const emp = makePair("emperor");
  emp.player.earthSigils = 1;
  const emperor = boardFollower(instance(emp.player, byName("Emperor of Elements")));
  const guardian = boardFollower(instance(emp.player, byName("Guardian Golem")));
  emp.player.board = [emperor, guardian];
  applyEntryEvents({ player: emp.player, opponent: emp.opponent, playerIndex: 0, enemyIndex: 1, stats: emp.stats, rng: emp.rng, cardMap: map }, guardian);
  const emperorEntry = { evolved: guardian.evolved, earthSigils: emp.player.earthSigils };

  const gin = makePair("ginger");
  const ginger = boardFollower(instance(gin.player, byName("Ginger, Disastrous Word")));
  const gingerGolem = boardFollower(instance(gin.player, byName("Guardian Golem")));
  const boostTargetCard = cards.find(card => norm(card.class) === "runecraft" && isSpellboostRecipient(card));
  if (!boostTargetCard) throw new Error("Runecraft QA requires an On Spellboost recipient");
  const boostTarget = instance(gin.player, boostTargetCard);
  gin.player.hand = [boostTarget];
  gin.player.board = [ginger, gingerGolem];
  applyEntryEvents({ player: gin.player, opponent: gin.opponent, playerIndex: 0, enemyIndex: 1, stats: gin.stats, rng: gin.rng, cardMap: map }, gingerGolem);
  const gingerEntry = { rush: hasU(gingerGolem, "Rush"), spellboost: boostTarget.spellboost };

  const noble = makePair("noble");
  noble.player.shikigamiDestroyedBaseAttackThisTurn = 4;
  noble.player.shikigamiDestroyedBaseDefenseThisTurn = 5;
  const nobleCard = byName("Noble Shikigami");
  const nobleUnit = boardFollower(instance(noble.player, nobleCard));
  const nobleBase = { attack: nobleUnit.attack, defense: nobleUnit.defense };
  noble.player.board = [nobleUnit];
  applyEntryEvents({ player: noble.player, opponent: noble.opponent, playerIndex: 0, enemyIndex: 1, stats: noble.stats, rng: noble.rng, cardMap: map }, nobleUnit);
  const nobleEntry = { attack: nobleUnit.attack - nobleBase.attack, defense: nobleUnit.defense - nobleBase.defense };

  // Lilanthim Crest fires at the end of the opponent's turn and evolves the summoned copy.
  const lil = makePair("lilanthim");
  gainCrest(lil.player, "Lilanthim, Anathema of Predation", byName("Lilanthim, Anathema of Predation"));
  lil.player.earthSigils = 0;
  applyRunecraftOpponentTurnEndCrests(lil.player, lil.opponent, 0, 1, lil.stats, lil.rng, map);
  const lilUnit = lil.player.board.find(unit => norm(unit.name) === "lilanthim, anathema of predation");
  const lilanthimEnd = { summoned: Boolean(lilUnit), evolved: Boolean(lilUnit?.evolved) };

  // Calge-Danthla summons two Storm Crystalspawns; each increases Faith.
  const cal = makePair("calge");
  cal.player.faithActive = true;
  cal.player.faith = 0;
  const calgeCard = byName("Calge-Danthla, Eld Crystals");
  resolveRunecraftCardText("Summon 2 copies of Crystalspawn and give them Storm.", { card: calgeCard, player: cal.player, opponent: cal.opponent, playerIndex: 0, enemyIndex: 1, stats: cal.stats, rng: cal.rng, cardMap: map });
  const calgeUnits = cal.player.board.filter(isCrystalspawn);
  const calgeFanfare = { count: calgeUnits.length, storm: calgeUnits.filter(unit => hasU(unit, "Storm")).length, faith: cal.player.faith };

  // Tico evolution discount.
  const tic = makePair("tico-discount");
  const missile = instance(tic.player, byName("Mysterian Missile"));
  tic.player.hand = [missile];
  resolveRunecraftCardText("Reduce the cost of all Mysteria spells in your hand by 1.", { card: byName("Tico, Mysterian Spellcrafter"), player: tic.player, opponent: tic.opponent, playerIndex: 0, enemyIndex: 1, stats: tic.stats, rng: tic.rng, cardMap: map });
  const ticoDiscount = missile.costDelta;

  // Elmott silence removes card abilities before damage.
  const sil = makePair("elmott-silence");
  const wardCard = { ...dummy(-88205, "QA Ward", 1, 5, ["Ward"]), text: "Ward Last Words: Draw a card." };
  const ward = boardFollower(instance(sil.opponent, wardCard));
  sil.opponent.board = [ward];
  resolveRunecraftCardText("Select an enemy follower on the field, remove all abilities from it, and deal it 3 damage.", { card: byName("Elmott, Remembrance Aflame"), player: sil.player, opponent: sil.opponent, playerIndex: 0, enemyIndex: 1, stats: sil.stats, rng: sil.rng, cardMap: map });
  const elmottSilence = { defense: ward.defense, ward: hasU(ward, "Ward"), triggeredText: getUnitTriggeredText(ward, "lastWords") };

  // Lhynkal Super-Evolve deck injection.
  const lhi = makePair("lhynkal-inject");
  const lhynkalCard = byName("Lhynkal, Wandering Fool");
  resolveRunecraftCardText("Add 10 copies of Lhynkal, Wandering Fool to your deck.", { card: lhynkalCard, sourceUnit: boardFollower(instance(lhi.player, lhynkalCard)), player: lhi.player, opponent: lhi.opponent, playerIndex: 0, enemyIndex: 1, stats: lhi.stats, rng: lhi.rng, cardMap: map });
  const lhynkalInjection = lhi.player.deck.filter(item => norm(item.card?.name) === "lhynkal, wandering fool").length;

  return {
    elmottStartDamage,
    cagliostroStart,
    bergentStart,
    pascaleEnd,
    junoEnd,
    insomniacLastWords,
    enrapturedHeal,
    emperorEntry,
    gingerEntry,
    nobleEntry,
    lilanthimEnd,
    calgeFanfare,
    ticoDiscount,
    elmottSilence,
    lhynkalInjection
  };
}





// [[battle-crest-lifecycle-qa-v1]]
export function inspectCrestLifecycleRules({ cards = [] } = {}) {
  const rawMap = new Map(cards.map(card => [Number(card.id), card]));
  const map = prepareSimulationCardMap(rawMap);
  const byName = name => findByName(map, name);
  const crestCards = cards.filter(card => /\bcrest\b/i.test([card.text ?? '', card.rawSkillText ?? '', ...(card.keywords ?? [])].join('\n')));
  const makePair = seed => {
    const rng = createRng('crest-lifecycle-qa:' + seed);
    const stats = createStats();
    const player = makePlayer('You', [], {}, map, rng);
    const opponent = makePlayer('Opponent', [], {}, map, rng);
    player.isActive = true; opponent.isActive = false;
    player.personalTurn = 5; opponent.personalTurn = 4;
    return { rng, stats, player, opponent };
  };

  const capacity = makePair('capacity');
  const unique = [];
  const seen = new Set();
  for (const card of crestCards) {
    const key = norm(card.name);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(card);
    if (unique.length >= 6) break;
  }
  const capacityResults = unique.map(card => gainCrest(capacity.player, card.name, map.get(Number(card.id)) ?? card));
  const duplicateAccepted = unique[0] ? gainCrest(capacity.player, unique[0].name, map.get(Number(unique[0].id)) ?? unique[0]) : false;

  const orderRun = names => {
    const pair = makePair(names.join('-'));
    pair.player.followersAttackedThisTurn = false;
    const allyCard = cards.find(card => card.type === 'Follower' && !card.token) ?? null;
    const enemyCard = cards.find(card => card.type === 'Follower' && !card.token && card.id !== allyCard?.id) ?? allyCard;
    if (!allyCard || !enemyCard) throw new Error('Crest lifecycle QA needs follower fixtures');
    const ally = boardFollower(instance(pair.player, map.get(Number(allyCard.id)) ?? allyCard));
    ally.superEvolved = true; ally.defense = ally.maxDefense = 20;
    const enemy = boardFollower(instance(pair.opponent, map.get(Number(enemyCard.id)) ?? enemyCard));
    enemy.defense = enemy.maxDefense = 20;
    pair.player.board = [ally]; pair.opponent.board = [enemy];
    for (const name of names) {
      const card = byName(name);
      if (!card) throw new Error('Missing Crest QA card: ' + name);
      gainCrest(pair.player, name, card);
    }
    return applyCrestTurnEnd(pair.player, pair.opponent, 0, 1, pair.stats, pair.rng, map);
  };

  const charon = makePair('charon-expiry');
  charon.player.personalTurn = 0;
  const charonCard = byName('Charon, Stygian Oarswoman');
  const deadCard = cards.find(card => card.class === 'Abysscraft' && card.type === 'Follower' && Number(card.cost) === 3 && !card.token);
  if (!charonCard || !deadCard) throw new Error('Missing Charon Crest QA fixtures');
  charon.player.destroyedFollowers = [{ card: map.get(Number(deadCard.id)) ?? deadCard }];
  gainCrest(charon.player, 'Charon, Stygian Oarswoman', charonCard);
  const charonActions = [];
  const charonBoardSizes = [];
  for (const turn of [1, 2]) {
    charon.player.personalTurn = turn;
    charonActions.push(...applyCrestTurnStartOrdered(charon.player, charon.opponent, 0, 1, charon.stats, charon.rng, map));
    tickCrests(charon.player, charon.opponent, 0, 1, charon.stats, charon.rng, map, charonActions);
    charonBoardSizes.push(charon.player.board.length);
  }

  return {
    crestCount: crestCards.length,
    capacity: { accepted: capacityResults, duplicateAccepted, active: capacity.player.crests.length },
    order: {
      grimnirThenMarwynn: orderRun(['Grimnir, Heavenly Gale', 'Marwynn, Despair Manifest']),
      marwynnThenGrimnir: orderRun(['Marwynn, Despair Manifest', 'Grimnir, Heavenly Gale'])
    },
    charon: { boardSizes: charonBoardSizes, activeAfterSecondStart: hasCrest(charon.player, 'Charon, Stygian Oarswoman'), actions: charonActions }
  };
}

// [[battle-abysscraft-full-qa]]
export function inspectAbysscraftFullRules({ cards = [] } = {}) {
  const rawMap = new Map(cards.map(card => [Number(card.id), card]));
  const map = prepareSimulationCardMap(rawMap);
  const byName = name => findByName(map, name);
  const makePair = seed => {
    const rng = createRng(`abysscraft-full-qa:${seed}`);
    const stats = createStats();
    const player = makePlayer("You", [], { style: "midrange" }, map, rng);
    const opponent = makePlayer("Opponent", [], {}, map, rng);
    player.isActive = true;
    opponent.isActive = false;
    player.personalTurn = 7;
    opponent.personalTurn = 6;
    player.maxPp = player.pp = 10;
    opponent.maxPp = opponent.pp = 10;
    return { rng, stats, player, opponent };
  };
  const dummy = (name, cost = 2, attack = 2, defense = 4, className = "Abysscraft", text = "") => ({
    id: -940000 - name.length * 11 - cost, name, class: className, type: "Follower", cost,
    attack, defense, text, keywords: [], traits: [], relatedCards: []
  });
  const ctxOf = q => ({ player: q.player, opponent: q.opponent, playerIndex: 0, enemyIndex: 1, stats: q.stats, rng: q.rng, cardMap: map });

  // Sham-Nacha: Faith pays 10 for a persistent extra Mode selection, and Mode
  // selection itself raises Abyss Faith by one.
  const sham = makePair("sham");
  sham.player.abyssFaithActive = true;
  sham.player.faith = 10;
  const shamCard = byName("Sham-Nacha, Heir to Entwining");
  resolveAbysscraftCardText(baseText(shamCard.text), { ...ctxOf(sham), card: shamCard, sourceUnit: boardFollower(instance(sham.player, shamCard)) });
  const chaos = byName("Chaos Cyclone");
  const chaosInst = instance(sham.player, chaos);
  sham.player.hand = [chaosInst];
  const chaosModes = modes(chaosInst, sham.player);
  const chaosMode = chaosModes[0];
  if (chaosMode) playCard(chaosInst, chaosMode, sham.player, sham.opponent, 0, 1, sham.stats, sham.rng, map);
  const shamFaith = { afterPayment: sham.player.faith, bonus: sham.player.abyssFaithModeBonus, selected: chaosMode?.selectedModeCount ?? 0 };

  const shamCopy = makePair("sham-copy");
  const copyTarget = boardFollower(instance(shamCopy.opponent, dummy("Copy Target", 4, 3, 6, "Neutral")));
  shamCopy.opponent.board = [copyTarget];
  resolveAbysscraftCardText("Select an enemy follower on the field, destroy it, and add a copy of it to your hand.", { ...ctxOf(shamCopy), card: shamCard, sourceUnit: boardFollower(instance(shamCopy.player, shamCard)) });
  const shamSuperCopy = { enemyBoard: shamCopy.opponent.board.length, handName: shamCopy.player.hand[0]?.card?.name ?? null };

  const rigor = makePair("rigor");
  const sameCost = dummy("Same Cost", 2);
  rigor.player.hand = [instance(rigor.player, sameCost), instance(rigor.player, sameCost), instance(rigor.player, sameCost)];
  rigor.player.deck = [instance(rigor.player, sameCost)];
  gainCrest(rigor.player, "Rigor of the Nightblossom", byName("Rigor of the Nightblossom"));
  const rigorCrest = rigor.player.crests[0];
  applyAbysscraftCrestTurnEnd(rigor.player, rigor.opponent, 0, 1, rigor.stats, rigor.rng, map);
  const rigorSkeleton = rigor.player.board.find(unit => norm(unit.name) === "skeleton");
  const rigorResult = { countdown: rigorCrest.countdown, hand: rigor.player.hand.length, skeletonWard: Boolean(rigorSkeleton && hasU(rigorSkeleton, "Ward")) };

  const valiant = makePair("valiant");
  valiant.player.hp = 10;
  const valiantEnemy = boardFollower(instance(valiant.opponent, dummy("Valiant Enemy", 3, 2, 5, "Neutral")));
  valiant.opponent.board = [valiantEnemy];
  gainCrest(valiant.player, "Valiant Edge", byName("Valiant Edge"));
  applyAbysscraftCrestTurnEnd(valiant.player, valiant.opponent, 0, 1, valiant.stats, valiant.rng, map);
  const valiantResult = { enemyDefense: valiantEnemy.defense, hp: valiant.player.hp, countdown: valiant.player.crests[0].countdown };

  const balto = makePair("balto");
  gainCrest(balto.player, "Balto, Dusk Bounty Hunter", byName("Balto, Dusk Bounty Hunter"));
  applyAbysscraftCrestTurnEnd(balto.player, balto.opponent, 0, 1, balto.stats, balto.rng, map);
  const baltoResult = { self: balto.player.hp, enemy: balto.opponent.hp, countdown: balto.player.crests[0].countdown };

  const vuella = makePair("vuella");
  const vuellaUnit = boardFollower(instance(vuella.player, byName("Vuella, the Blastwing")));
  const vuellaTarget = boardFollower(instance(vuella.player, dummy("Super Target", 4, 2, 4)));
  vuella.player.board = [vuellaUnit, vuellaTarget];
  const vuellaBefore = [vuellaUnit.attack, vuellaTarget.attack];
  superEvolveUnitByAbility(ctxOf(vuella), vuellaTarget, []);
  const vuellaBuff = [vuellaUnit.attack - vuellaBefore[0], vuellaTarget.attack - vuellaBefore[1] - 3];

  const departed = makePair("departed");
  const mukan = boardFollower(instance(departed.player, byName("Mukan, Shadowcrypt Ward")));
  const charon = boardFollower(instance(departed.player, byName("Charon, Stygian Oarswoman")));
  const beast = boardFollower(instance(departed.player, byName("Beastmaster Bones")));
  const mac = boardFollower(instance(departed.player, byName("Macmillan, Reaper of Ceremonies")));
  const departedUnit = boardFollower(instance(departed.player, dummy("Departed QA", 3, 2, 4)));
  giveKeyword(departedUnit, "Departed");
  departed.player.board = [mukan, charon, beast, mac, departedUnit];
  const departedBaseAttack = departedUnit.attack;
  applyAbysscraftEntryEvents(ctxOf(departed), departedUnit);
  const departedResult = {
    bane: hasU(departedUnit, "Bane"), ward: hasU(departedUnit, "Ward"), storm: hasU(departedUnit, "Storm"), rush: hasU(departedUnit, "Rush"),
    attackGain: departedUnit.attack - departedBaseAttack, leaderDamage: 20 - departed.opponent.hp
  };

  const charonCrestQa = makePair("charon-crest");
  charonCrestQa.player.destroyedFollowers = [{ card: dummy("Reanimate Three", 3, 3, 3) }];
  gainCrest(charonCrestQa.player, "Charon, Stygian Oarswoman", byName("Charon, Stygian Oarswoman"));
  applyAbysscraftCrestTurnStart(charonCrestQa.player, charonCrestQa.opponent, 0, 1, charonCrestQa.stats, charonCrestQa.rng, map);
  const charonCrestResult = { countdown: charonCrestQa.player.crests[0].countdown, departed: Boolean(charonCrestQa.player.board[0] && hasU(charonCrestQa.player.board[0], "Departed")) };

  const corrupt = makePair("corruption");
  const corruptAlly = boardFollower(instance(corrupt.player, dummy("Corrupt Ally", 2, 3, 4)));
  const corruptEnemy = boardFollower(instance(corrupt.opponent, dummy("Corrupt Enemy", 2, 3, 4, "Neutral")));
  corrupt.player.board = [corruptAlly]; corrupt.opponent.board = [corruptEnemy];
  const corruptionCard = byName("Corruption");
  resolveAbysscraftCardText("Give all followers on the field -2/-2. Give yourself and your opponent Crest: Corruption.", { ...ctxOf(corrupt), card: corruptionCard });
  const corruptionCrests = { own: hasCrest(corrupt.player, "Corruption"), enemy: hasCrest(corrupt.opponent, "Corruption"), allyDefense: corruptAlly.defense, enemyDefense: corruptEnemy.defense };
  applyAbysscraftCrestTurnEnd(corrupt.player, corrupt.opponent, 0, 1, corrupt.stats, corrupt.rng, map);
  const corruptionEndDamage = 20 - corrupt.player.hp;
  destroyAbyssCrest(corrupt.player, "Corruption", corrupt.opponent, 0, 1, corrupt.stats, corrupt.rng, map, []);
  const corruptionDestroyed = !hasCrest(corrupt.player, "Corruption");

  const belial = makePair("belial");
  const belialCard = byName("Belial, Archangel of Cunning");
  gainCrest(belial.player, "Belial, Archangel of Cunning", belialCard);
  resolveAbysscraftCardText("Advance the count of your Crest: Belial, Archangel of Cunning by 1.", { ...ctxOf(belial), card: belialCard, sourceUnit: boardFollower(instance(belial.player, belialCard)) });
  const belialCountdown = belial.player.crests[0]?.countdown ?? null;
  abysscraftCrestLastWords({ name: "Belial, Archangel of Cunning", card: belialCard }, belial.player, belial.opponent, 0, 1, belial.stats, belial.rng, map, []);
  const belialDamage = 20 - belial.opponent.hp;

  const milteo = makePair("milteo");
  gainCrest(milteo.player, "Milteo & Luzen", byName("Milteo & Luzen"));
  const fanfareDummy = dummy("Milteo Play QA", 2, 2, 3, "Abysscraft", "Fanfare: Deal 5 damage to the enemy leader.");
  const milteoInst = instance(milteo.player, fanfareDummy);
  milteo.player.hand = [milteoInst];
  const milteoMode = modes(milteoInst, milteo.player)[0];
  playCard(milteoInst, milteoMode, milteo.player, milteo.opponent, 0, 1, milteo.stats, milteo.rng, map);
  const milteoPlayed = milteo.player.board.find(unit => norm(unit.name) === "milteo play qa");
  const milteoResult = { enemyHp: milteo.opponent.hp, evolved: Boolean(milteoPlayed?.evolved), countdown: milteo.player.crests[0].countdown ?? null };

  const life = makePair("lifestealer");
  life.player.hp = 10;
  const lifestealer = boardFollower(instance(life.player, byName("Lifestealer")));
  life.player.board = [lifestealer];
  const skeletonDead = boardFollower(instance(life.player, byName("Skeleton")));
  applyAbysscraftFollowerDestroyedEvents(life.player, life.opponent, 0, 1, life.stats, skeletonDead);
  const lifestealerHeal = life.player.hp - 10;

  return {
    shamFaith,
    shamSuperCopy,
    rigorResult,
    valiantResult,
    baltoResult,
    vuellaBuff,
    departedResult,
    charonCrestResult,
    corruptionCrests,
    corruptionEndDamage,
    corruptionDestroyed,
    belialCountdown,
    belialDamage,
    milteoResult,
    lifestealerHeal
  };
}







// [[battle-havencraft-final-full-qa]]
export function inspectHavencraftFullRules({ cards = [] } = {}) {
  const rawMap = new Map(cards.map(card => [Number(card.id), card]));
  const map = prepareSimulationCardMap(rawMap);
  const byName = name => findByName(map, name);
  const makePair = seed => {
    const rng = createRng(`havencraft-final-qa:${seed}`), stats = createStats();
    const player = makePlayer("You", [], {}, map, rng), opponent = makePlayer("Opponent", [], {}, map, rng);
    player.isActive = true; opponent.isActive = false; player.personalTurn = 6; opponent.personalTurn = 5; player.maxPp = player.pp = 10;
    bindHavencraftRuntime(player, opponent, 0, 1, stats, rng, map);
    return { rng, stats, player, opponent, ctx: () => ({ player, opponent, playerIndex: 0, enemyIndex: 1, stats, rng, cardMap: map }) };
  };
  const dummy = (name, cost=1, attack=1, defense=4, type="Follower") => ({ id:-940000-name.length, name, class:"Havencraft", type, cost, attack, defense, text:"", keywords:[], traits:[], relatedCards:[] });

  const drawQ = makePair("draw");
  const bouquet = boardFollower(instance(drawQ.player, byName("Bouquet Believer")));
  const mouse = boardFollower(instance(drawQ.player, byName("Desperate Shrinemouse")));
  const foe = boardFollower(instance(drawQ.opponent, dummy("Draw Foe",1,1,5)));
  drawQ.player.board=[bouquet,mouse]; drawQ.opponent.board=[foe]; drawQ.player.deck=[instance(drawQ.player,dummy("Drawn",2))];
  drawCards(drawQ.player,1,drawQ.stats,0);
  const drawTriggers={bouquetRush:hasU(bouquet,"Rush"),mouseDamage:5-foe.defense};

  const engageQ=makePair("engage"); engageQ.player.hp=10;
  const tikoh=boardFollower(instance(engageQ.player,byName("Tikoh, Asclepian Surgeon")));
  const mainyu=boardFollower(instance(engageQ.player,byName("Mainyu, Darkdweller")));
  const troue=boardFollower(instance(engageQ.player,byName("Troue, Heroic Visionary")));
  const sky=instance(engageQ.player,byName("Skyfaring Vessel")); engageQ.player.hand=[sky]; engageQ.player.board=[tikoh,mainyu,troue];
  applyHavencraftEngageTriggers(engageQ.ctx());
  const engageTriggers={heal:engageQ.player.hp-10,mainyu:mainyu.attack-Number(mainyu.card.attack||0),drain:hasU(troue,"Drain"),skyCost:costOf(sky)};
  restoreTemporaryAttack(engageQ.player);

  const devoteeQ=makePair("devotee");
  const devoteeTarget=boardFollower(instance(devoteeQ.player,dummy("Devotee Target",2,4,4))); devoteeQ.player.board=[devoteeTarget]; devoteeQ.player.followersAttackedThisTurn=false;
  gainCrest(devoteeQ.player,"Devotee of Repose",byName("Devotee of Repose")); applyHavencraftCrestTurnEnd(devoteeQ.player,devoteeQ.opponent,0,1,devoteeQ.stats,devoteeQ.rng,map);
  const devotee={attack:devoteeTarget.attack,ward:hasU(devoteeTarget,"Ward")};

  const torrentQ=makePair("torrent"); torrentQ.opponent.board=[boardFollower(instance(torrentQ.opponent,dummy("Torrent Target")))]; gainCrest(torrentQ.player,"Devotee of Repose",byName("Devotee of Repose"));
  const tcrest=torrentQ.player.crests[0], beforeDelay=tcrest.countdown;
  resolveHavencraftCardText("Banish a random enemy follower from the field. Delay the counts of all your crests by 1.",{...torrentQ.ctx(),card:byName("Torrent of Despair")});
  const torrent={enemy:torrentQ.opponent.board.length,delay:tcrest.countdown-beforeDelay};

  const templeQ=makePair("temple"); templeQ.player.hp=10; gainCrest(templeQ.player,"Devotee of Repose",byName("Devotee of Repose"));
  const temple=boardAmulet(instance(templeQ.player,byName("Temple of Repose"))); temple.countdown=1; templeQ.player.board=[temple];
  resolveHavencraftCardText("Advance this amulet's count by X. X is the number of crests you have.",{...templeQ.ctx(),card:temple.card,sourceUnit:temple});
  const templeResult={gone:!templeQ.player.board.includes(temple),hp:templeQ.player.hp,barrier:templeQ.player.leaderBarrier};

  const shiningQ=makePair("shining"); shiningQ.player.hp=10; shiningQ.opponent.hp=20;
  const shiningFoe=boardFollower(instance(shiningQ.opponent,dummy("Shining Foe",1,1,10))); shiningQ.opponent.board=[shiningFoe];
  resolveHavencraftCardText("Deal 4 damage split between all enemies. Restore 4 defense to your leader.",{...shiningQ.ctx(),card:byName("Shining Disenchantment")});
  const shining={totalDamage:(20-shiningQ.opponent.hp)+(10-shiningFoe.defense),heal:shiningQ.player.hp-10};

  const skyQ=makePair("sky"); const evolveTarget=boardFollower(instance(skyQ.player,dummy("Sky Evolve",2,2,2))); const skyAmulet=boardAmulet(instance(skyQ.player,byName("Skyfaring Vessel"))); skyQ.player.board=[skyAmulet,evolveTarget];
  resolveHavencraftCardText("Destroy this card. Select an unevolved allied follower on the field and evolve it.",{...skyQ.ctx(),card:skyAmulet.card,sourceUnit:skyAmulet});
  const skyEngage={destroyed:!skyQ.player.board.includes(skyAmulet),evolved:evolveTarget.evolved};

  const marQ=makePair("marwynn"); marQ.player.followersAttackedThisTurn=false; marQ.opponent.hp=20; gainCrest(marQ.player,"Marwynn, Despair Manifest",byName("Marwynn, Despair Manifest")); gainCrest(marQ.player,"Supplicant of Repose",byName("Supplicant of Repose"));
  applyHavencraftCrestTurnEnd(marQ.player,marQ.opponent,0,1,marQ.stats,marQ.rng,map); const marwynnDamage=20-marQ.opponent.hp;

  const benQ=makePair("benison"); benQ.player.hp=20; gainCrest(benQ.player,"Maddening Benison",byName("Maddening Benison")); const ben=benQ.player.crests[0]; ben.countdown=1; ben.gainedTurn=0; tickCrests(benQ.player,benQ.opponent,0,1,benQ.stats,benQ.rng,map,[]); const benisonHp=benQ.player.hp;

  const conQ=makePair("congregant"); conQ.player.followersAttackedThisTurn=false; conQ.player.deck=[instance(conQ.player,dummy("Defense Four",3,2,4)),instance(conQ.player,dummy("Defense Five",3,2,5))]; gainCrest(conQ.player,"Congregant of Repose",byName("Congregant of Repose")); applyHavencraftCrestTurnEnd(conQ.player,conQ.opponent,0,1,conQ.stats,conQ.rng,map); const congregantDraw=conQ.player.hand[0]?.card.name??null;

  const saintQ=makePair("saint"); saintQ.player.hp=10; const saint=boardFollower(instance(saintQ.player,byName("Saint of Rehabilitation"))); saintQ.player.board=[saint]; const healed=healPlayer(saintQ.player,1,saintQ.stats,0); afterLeaderHeal(saintQ.player,healed,saintQ.stats,0); const saintFox=saintQ.player.board.filter(u=>norm(u.name)==="fox of purity").length;

  const zoeQ=makePair("zoe"); gainCrest(zoeQ.player,"Zoe, Dazzling Hope",byName("Zoe, Dazzling Hope")); const zc=zoeQ.player.crests[0]; zc.countdown=1; zc.gainedTurn=0; tickCrests(zoeQ.player,zoeQ.opponent,0,1,zoeQ.stats,zoeQ.rng,map,[]); const zoe=zoeQ.player.board.find(u=>norm(u.name)==="zoe, dazzling hope"); const zoeCrest={summoned:Boolean(zoe),evolved:Boolean(zoe?.evolved)};

  const himeQ=makePair("himeka"); const hime=boardFollower(instance(himeQ.player,byName("Himeka, Heir to Repose"))); himeQ.player.board=[hime]; himeQ.opponent.board=[boardFollower(instance(himeQ.opponent,dummy("Hime Target",2,3,5)))]; gainCrest(himeQ.player,"Himeka, Heir to Repose",hime.card); applyHavencraftCrestTurnEnd(himeQ.player,himeQ.opponent,0,1,himeQ.stats,himeQ.rng,map); const himeTarget=himeQ.opponent.board[0]; const himekaCrest={locked:himeTarget.permanentAttackLock,marked:himeTarget.himekaBanishAtOwnTurnEnd}; resolveHavencraftCardText("Set the attack of all enemy followers on the field to 4.",{...himeQ.ctx(),card:hime.card,sourceUnit:hime}); const himekaAttack=himeTarget.attack;

  const vicheQ=makePair("viche"); const viche=instance(vicheQ.player,byName("Viche, Abyssal Researcher")); vicheQ.player.hand=[viche]; applyHavencraftSuperEvolveHandTriggers(vicheQ.player); const vicheCost=costOf(viche);

  const kukQ=makePair("kukishiro"); gainCrest(kukQ.player,"Kukishiro, Mistbloom",byName("Kukishiro, Mistbloom")); kukQ.player.deck=[instance(kukQ.player,dummy("Odd Draw",1)),instance(kukQ.player,dummy("Even Draw",2))]; drawCards(kukQ.player,2,kukQ.stats,0); const kukishiro={allied:kukQ.player.board.length,enemy:kukQ.opponent.board.length};

  const lyaQ=makePair("lyanthoth"); lyaQ.player.havenFaithActive=true; const amulet=boardAmulet(instance(lyaQ.player,dummy("Faith Amulet",2,0,0,"Amulet"))); lyaQ.player.board=[amulet]; destroyObject(lyaQ.player,lyaQ.opponent,amulet,0,1,lyaQ.stats,lyaQ.rng,map,true); const faithAfterDestroy=lyaQ.player.faith; lyaQ.player.faith=10; resolveHavencraftCardText("Reduce your faith's value by 10 to add a Depths of the Eld Tome to your hand.",{...lyaQ.ctx(),card:byName("Lyanthoth, Eld Tome")}); const lyanthoth={faithAfterDestroy,faithAfterPay:lyaQ.player.faith,depths:lyaQ.player.hand.some(i=>norm(i.card.name)==="depths of the eld tome")};

  return {drawTriggers,engageTriggers,devotee,torrent,templeResult,shining,skyEngage,marwynnDamage,benisonHp,congregantDraw,saintFox,zoeCrest,himekaCrest,himekaAttack,vicheCost,kukishiro,lyanthoth};
}

// [[battle-neutral-full-qa]]
export function inspectNeutralFullRules({ cards = [] } = {}) {
  const rawMap = new Map(cards.map(card => [Number(card.id), card]));
  const map = prepareSimulationCardMap(rawMap);
  const byName = name => findByName(map, name);
  const makePair = seed => {
    const rng = createRng(`neutral-full-qa:${seed}`);
    const stats = createStats();
    const player = makePlayer("You", [], {}, map, rng);
    const opponent = makePlayer("Opponent", [], {}, map, rng);
    player.isActive = true;
    player.personalTurn = 6;
    opponent.personalTurn = 5;
    return { rng, stats, player, opponent, ctx() { return { player, opponent, playerIndex: 0, enemyIndex: 1, stats, rng, cardMap: map }; } };
  };
  const synthetic = (name, cost = 1, type = "Follower") => ({ id: -930000 - name.length, name, class: "Neutral", type, cost, attack: 1, defense: 5, text: "", keywords: [], traits: [], relatedCards: [] });

  const world = makePair("world");
  const worldAmulet = boardAmulet(instance(world.player, byName("World of Games")));
  worldAmulet.countdown = 5;
  world.player.board = [worldAmulet];
  world.opponent.board = [boardFollower(instance(world.opponent, synthetic("Opponent Four", 4)))];
  applyNeutralCardPlayedTriggers({ ...world.ctx(), card: synthetic("Played Four", 4, "Spell"), sourceUnit: null });
  const worldCountdown = worldAmulet.countdown;

  const enc = makePair("encroached");
  const original = instance(enc.player, synthetic("Disposable", 2));
  enc.player.hand = [original];
  enc.opponent.deck = [instance(enc.opponent, byName("Silent Rider"))];
  resolveNeutralCardText("Select a card in your hand and transform it into an exact copy of a random card in your opponent's deck.", { ...enc.ctx(), card: byName("Encroached World"), sourceUnit: boardAmulet(instance(enc.player, byName("Encroached World"))) });
  const encroachedCopy = enc.player.hand[0]?.card?.name ?? null;

  const mj = makePair("mjerrabaine");
  resolveNeutralCardText("Gain Crest: Mjerrabaine, Great Manifest.", { ...mj.ctx(), card: byName("Mjerrabaine, Great Manifest"), sourceUnit: boardFollower(instance(mj.player, byName("Mjerrabaine, Great Manifest"))) });
  const mjDeck = { count: mj.player.deck.length, distinct: new Set(mj.player.deck.map(item => Number(item.card?.baseCardId ?? item.card?.id))).size, victory: mj.player.mjerrabaineVictoryOnEmpty };
  const testimony = instance(mj.player, byName("Great Testimony"));
  const discard = instance(mj.player, synthetic("Mj Discard", 2));
  mj.player.hand = [testimony, discard];
  mj.player.deck = Array.from({ length: 6 }, (_, index) => instance(mj.player, synthetic(`Mj Draw ${index}`, index + 1)));
  applyNeutralCrestTurnEnd(mj.player, mj.opponent, 0, 1, mj.stats, mj.rng, map);
  const mjTurnEnd = { testimony: mj.player.hand.some(item => norm(item.card.name) === "great testimony"), hand: mj.player.hand.length, discarded: mj.player.cemetery.some(item => item.card.name === "Mj Discard") };
  mj.player.hand = []; mj.player.deck = []; mj.player.specialVictory = false; mj.player.deckOut = false; mj.player.mjerrabaineVictoryOnEmpty = true;
  drawCards(mj.player, 1, mj.stats, 0);
  const mjVictory = { victory: mj.player.specialVictory, deckOut: mj.player.deckOut };

  const kat = makePair("katalina");
  const katalina = boardFollower(instance(kat.player, byName("Katalina, Sky's Protector")));
  kat.player.board = [katalina];
  const katBefore = katalina.defense;
  damageUnit(katalina, 10, kat.player, kat.opponent, kat.ctx(), []);
  const katalinaDamage = katBefore - katalina.defense;

  const ill = makePair("illamrita");
  const illamrita = boardFollower(instance(ill.player, byName("Illamrita, Designated Target")));
  const victim = boardFollower(instance(ill.opponent, synthetic("Illamrita Victim", 3)));
  ill.player.board = [illamrita]; ill.opponent.board = [victim];
  resolveNeutralCardText('Give this follower Barrier. Give the opposing follower "Can\'t attack followers or leaders" and "At the end of your turn, banish this card."', { ...ill.ctx(), card: illamrita.card, sourceUnit: illamrita, opposingFollower: victim });
  const illStrike = { barrier: illamrita.barrier, locked: victim.permanentAttackLock, marked: victim.illamritaBanishAtOwnTurnEnd };
  applyNeutralMarkedEndTurnBanish(ill.opponent);
  const illBanish = ill.opponent.board.length;
  ill.player.board = [];
  gainCrest(ill.player, "Illamrita, Designated Target", byName("Illamrita, Designated Target"));
  const illCrest = ill.player.crests.find(crest => norm(crest.name) === "illamrita, designated target");
  illCrest.countdown = 1; illCrest.gainedTurn = 0; ill.player.personalTurn = 2;
  tickCrests(ill.player, ill.opponent, 0, 1, ill.stats, ill.rng, map, []);
  const illSummon = ill.player.board.find(unit => norm(unit.name) === "illamrita, designated target");
  const illCrestResult = { summoned: Boolean(illSummon), evolved: Boolean(illSummon?.evolved) };

  const bahFollowers = makePair("bah-followers");
  const bah = boardFollower(instance(bahFollowers.player, byName("Alabaster Bahamut")));
  bahFollowers.player.board = [bah, boardFollower(instance(bahFollowers.player, synthetic("Ally")))];
  bahFollowers.opponent.board = [boardFollower(instance(bahFollowers.opponent, synthetic("Enemy")))];
  resolveNeutralCardText("Banish all other followers from the field.", { ...bahFollowers.ctx(), card: bah.card, sourceUnit: bah });
  const bahamutFollowers = { allied: bahFollowers.player.board.length, enemy: bahFollowers.opponent.board.length, survived: bahFollowers.player.board[0]?.name === "Alabaster Bahamut" };

  const bahAmulets = makePair("bah-amulets");
  const bahA = boardFollower(instance(bahAmulets.player, byName("Alabaster Bahamut")));
  bahAmulets.player.board = [bahA, boardAmulet(instance(bahAmulets.player, synthetic("Ally Amulet", 2, "Amulet")))];
  bahAmulets.opponent.board = [boardAmulet(instance(bahAmulets.opponent, synthetic("Enemy Amulet", 2, "Amulet")))];
  resolveNeutralCardText("Banish all amulets from the field.", { ...bahAmulets.ctx(), card: bahA.card, sourceUnit: bahA });
  const bahamutAmulets = [bahAmulets.player.board.filter(unit => unit.type === "Amulet").length, bahAmulets.opponent.board.filter(unit => unit.type === "Amulet").length];

  const bahCrests = makePair("bah-crests");
  gainCrest(bahCrests.player, "Grimnir, Heavenly Gale", byName("Grimnir, Heavenly Gale"));
  gainCrest(bahCrests.opponent, "Grimnir, Heavenly Gale", byName("Grimnir, Heavenly Gale"));
  resolveNeutralCardText("Banish all crests.", { ...bahCrests.ctx(), card: byName("Alabaster Bahamut"), sourceUnit: null });
  const bahamutCrests = [bahCrests.player.crests.length, bahCrests.opponent.crests.length];

  const coc = makePair("cocytus");
  resolveNeutralCardText("Replace your deck with the Apocalypse Deck.", { ...coc.ctx(), card: byName("Ruler of Cocytus"), sourceUnit: boardFollower(instance(coc.player, byName("Ruler of Cocytus"))) });
  const composition = Object.fromEntries([...coc.player.deck.reduce((m, item) => m.set(item.card.name, (m.get(item.card.name) ?? 0) + 1), new Map()).entries()].sort());

  const ast = makePair("astaroth");
  ast.opponent.hp = 17; ast.opponent.maxHp = 20;
  resolveNeutralCardText("Set the enemy leader's max defense to 1.", { ...ast.ctx(), card: byName("Astaroth's Reckoning"), sourceUnit: null });
  const astaroth = { hp: ast.opponent.hp, maxHp: ast.opponent.maxHp };

  return { worldCountdown, encroachedCopy, mjDeck, mjTurnEnd, mjVictory, katalinaDamage, illStrike, illBanish, illCrestResult, bahamutFollowers, bahamutAmulets, bahamutCrests, apocalypse: { count: coc.player.deck.length, composition }, astaroth };
}

// [[battle-portalcraft-full-qa]]
export function inspectPortalcraftFullRules({ cards = [] } = {}) {
  const rawMap = new Map(cards.map(card => [Number(card.id), card]));
  const map = prepareSimulationCardMap(rawMap);
  const byName = name => findByName(map, name);
  const makePair = seed => {
    const rng = createRng(`portalcraft-full-qa:${seed}`);
    const stats = createStats();
    const player = makePlayer("You", [], { style: "puppetry-tempo" }, map, rng);
    const opponent = makePlayer("Opponent", [], {}, map, rng);
    player.isActive = true;
    opponent.isActive = false;
    player.personalTurn = 7;
    opponent.personalTurn = 6;
    player.maxPp = player.pp = 10;
    opponent.maxPp = opponent.pp = 10;
    return { rng, stats, player, opponent };
  };
  const dummy = (name, cost = 1, attack = 1, defense = 5, traits = [], className = "Portalcraft") => ({
    id: -970000 - name.length * 7 - cost, name, class: className, type: "Follower", cost,
    attack, defense, text: "", keywords: [], traits, relatedCards: []
  });
  const ctxOf = q => ({ player: q.player, opponent: q.opponent, playerIndex: 0, enemyIndex: 1, stats: q.stats, rng: q.rng, cardMap: map });

  const eudie = makePair("eudie");
  eudie.player.deck = [instance(eudie.player, dummy("Eudie Draw", 1, 0, 1, [], "Neutral"))];
  eudie.player.hp = 10;
  gainCrest(eudie.player, "Eudie, Maiden Reborn", byName("Eudie, Maiden Reborn"));
  const eudieCrest = eudie.player.crests.find(crest => norm(crest.name) === "eudie, maiden reborn");
  applyPortalcraftCrestTurnEnd(eudie.player, eudie.opponent, 0, 1, eudie.stats, eudie.rng, map);
  const eudieDraw = eudie.player.hand.length;
  while (eudie.player.hand.length < 6) eudie.player.hand.push(instance(eudie.player, dummy(`Eudie Hand ${eudie.player.hand.length}`, 1, 0, 1, [], "Neutral")));
  applyPortalcraftCrestTurnEnd(eudie.player, eudie.opponent, 0, 1, eudie.stats, eudie.rng, map);
  const eudieResult = { countdown: eudieCrest?.countdown ?? null, drawn: eudieDraw, healed: eudie.player.hp - 10 };

  const medical = makePair("medical");
  const assassin = boardFollower(instance(medical.player, byName("Medical-Grade Assassin")));
  const puppetA = boardFollower(instance(medical.player, byName("Enhanced Puppet")));
  medical.player.board = [assassin, puppetA];
  applyEntryEvents(ctxOf(medical), puppetA);
  const firstBane = hasU(puppetA, "Bane");
  const puppetB = boardFollower(instance(medical.player, byName("Puppet")));
  medical.player.board.push(puppetB);
  applyEntryEvents(ctxOf(medical), puppetB);
  const medicalResult = { firstBane, secondSameTurnBane: hasU(puppetB, "Bane") };

  const slaus = makePair("slaus");
  const slausUnit = boardFollower(instance(slaus.player, byName("Slaus, Revolving Wheel of Fortune")));
  slausUnit.evolved = true;
  slaus.player.board = [slausUnit, boardFollower(instance(slaus.player, dummy("Slaus Ally", 2, 2, 4)))];
  for (let i = 0; i < 3; i += 1) {
    resolvePortalcraftCardText("Activate a random ability that hasn't been activated yet from the following. 1. Reduce the cost of all cards in your hand by 1 until the end of the turn. 2. Give all allied followers on the field +2/+2. 3. Restore 3 defense to your leader.", { ...ctxOf(slaus), card: slausUnit.card, sourceUnit: slausUnit });
  }
  resolvePortalcraftCardText("If this follower is evolved, give your opponent Crest: Slaus, Revolving Wheel of Fortune and banish this card.", { ...ctxOf(slaus), card: slausUnit.card, sourceUnit: slausUnit });
  const opponentSlausCrest = slaus.opponent.crests.find(crest => norm(crest.name) === "slaus, revolving wheel of fortune");
  const slausResult = { ownModes: (slausUnit.portalSlausUsedStartModes ?? []).length, banished: !slaus.player.board.includes(slausUnit), opponentCountdown: opponentSlausCrest?.countdown ?? null };

  const curse = makePair("slaus-crest");
  gainCrest(curse.player, "Slaus, Revolving Wheel of Fortune", byName("Slaus, Revolving Wheel of Fortune"));
  const curseCrest = curse.player.crests[0];
  curseCrest.gainedTurn = 0;
  for (let turn = 1; turn <= 3; turn += 1) {
    curse.player.personalTurn = turn;
    applyPortalcraftPreTickCrestTurnStart(curse.player, curse.opponent, 0, 1, curse.stats, curse.rng, map);
    tickCrests(curse.player, curse.opponent, 0, 1, curse.stats, curse.rng, map, []);
  }
  const slausCrestResult = { modes: (curseCrest.portalSlausUsedModes ?? []).length, expired: !curse.player.crests.includes(curseCrest) };

  const axe = makePair("axe");
  const axeInst = instance(axe.player, byName("Unfeeling Eld Axe"));
  axe.player.hand = [axeInst];
  const highA = boardFollower(instance(axe.player, dummy("High A", 5, 2, 5)));
  axe.player.board = [highA];
  applyEntryEvents(ctxOf(axe), highA);
  const afterOne = costOf(axeInst);
  const highB = boardFollower(instance(axe.player, dummy("High B", 6, 2, 5)));
  axe.player.board.push(highB);
  applyEntryEvents(ctxOf(axe), highB);
  const afterTwo = costOf(axeInst);
  restorePortalcraftTemporaryCosts(axe.player);
  const axeResult = { afterOne, afterTwo, restored: costOf(axeInst) };

  const barkeep = makePair("barkeep");
  barkeep.player.hp = 10;
  const barkeepUnit = boardFollower(instance(barkeep.player, byName("Brusque Barkeep")));
  const barkeepArtifact = boardFollower(instance(barkeep.player, byName("Ancient Artifact")));
  barkeep.player.board = [barkeepUnit, barkeepArtifact];
  applyEntryEvents(ctxOf(barkeep), barkeepArtifact);
  const barkeepHeal = barkeep.player.hp - 10;

  const myuu = makePair("myuu");
  const myuuUnit = boardFollower(instance(myuu.player, byName("Myuu, Hot on His Heels")));
  const myuuArtifact = boardFollower(instance(myuu.player, byName("Ancient Artifact")));
  const myuuEnemy = boardFollower(instance(myuu.opponent, dummy("Myuu Enemy", 2, 1, 10, [], "Neutral")));
  myuu.player.board = [myuuUnit, myuuArtifact];
  myuu.opponent.board = [myuuEnemy];
  applyEntryEvents(ctxOf(myuu), myuuArtifact);
  myuu.player.artifactFollowerNamesEntered = ["analyzing artifact", "ancient artifact", "mystic artifact"];
  resolvePortalcraftCardText("Then, if at least 3 differently named allied Artifact followers have entered the field this match, give this follower Storm.", { ...ctxOf(myuu), card: myuuUnit.card, sourceUnit: myuuUnit });
  const myuuResult = { enemyDefense: myuuEnemy.defense, storm: hasU(myuuUnit, "Storm") };

  const artisan = makePair("artisan");
  const artisanUnit = boardFollower(instance(artisan.player, byName("Flowering Artisan")));
  const artisanEnemy = boardFollower(instance(artisan.opponent, dummy("Artisan Enemy", 2, 1, 10, [], "Neutral")));
  artisan.player.board = [artisanUnit];
  artisan.opponent.board = [artisanEnemy];
  applyPortalcraftSpellPlayedTriggers(ctxOf(artisan));
  const artisanDefense = artisanEnemy.defense;

  const cami = makePair("camiscilla");
  const camiUnit = boardFollower(instance(cami.player, byName("Camiscilla, Unfeeling Heart")));
  const camiHigh = boardFollower(instance(cami.player, dummy("Camiscilla High", 5, 2, 5)));
  cami.player.board = [camiUnit, camiHigh];
  applyEntryEvents(ctxOf(cami), camiHigh);
  const camiAutoEvolve = camiHigh.evolved;
  const hpBeforeCami = cami.opponent.hp;
  resolvePortalcraftCardText("Deal X damage to the enemy leader. X is the number of allied followers on the field with a base cost of 5 or more.", { ...ctxOf(cami), card: camiUnit.card, sourceUnit: camiUnit });
  const camiscillaResult = { autoEvolve: camiAutoEvolve, leaderDamage: hpBeforeCami - cami.opponent.hp };

  return { eudieResult, medicalResult, slausResult, slausCrestResult, axeResult, barkeepHeal, myuuResult, artisanDefense, camiscillaResult };
}


// [[battle-dragoncraft-full-qa]]
export function inspectDragoncraftFullRules({ cards = [] } = {}) {
  const rawMap = new Map(cards.map(card => [Number(card.id), card]));
  const map = prepareSimulationCardMap(rawMap);
  const byName = name => findByName(map, name);
  const makePair = seed => {
    const rng = createRng(`dragoncraft-full-qa:${seed}`);
    const stats = createStats();
    const player = makePlayer("You", [], { style: "ramp-midrange" }, map, rng);
    const opponent = makePlayer("Opponent", [], {}, map, rng);
    player.isActive = true;
    opponent.isActive = false;
    player.personalTurn = 7;
    opponent.personalTurn = 6;
    player.maxPp = player.pp = 10;
    opponent.maxPp = opponent.pp = 10;
    return { rng, stats, player, opponent };
  };
  const dummy = (name, cost = 1, attack = 1, defense = 5, traits = [], className = "Dragoncraft") => ({
    id: -930000 - name.length * 7 - cost, name, class: className, type: "Follower", cost,
    attack, defense, text: "", keywords: [], traits, relatedCards: []
  });
  const ctxOf = q => ({ player: q.player, opponent: q.opponent, playerIndex: 0, enemyIndex: 1, stats: q.stats, rng: q.rng, cardMap: map });
  const playNamed = (q, name, customText = null) => {
    const card = byName(name);
    const inst = instance(q.player, card);
    q.player.hand.push(inst);
    const mode = { kind: "base", cost: Math.min(q.player.pp, costOf(inst)), text: customText ?? baseText(card.text), modeIndex: 0, scoreBonus: 0 };
    return playCard(inst, mode, q.player, q.opponent, 0, 1, q.stats, q.rng, map);
  };

  const devotee = makePair("devotee");
  const devoteeUnit = boardFollower(instance(devotee.player, byName("Devotee of Disdain")));
  // Give the QA subject enough defense to survive two separate damage events;
  // the card only draws when the damage event does not destroy it.
  devoteeUnit.defense += 2;
  devoteeUnit.maxDefense += 2;
  devotee.player.board = [devoteeUnit];
  devotee.player.deck = [instance(devotee.player, dummy("Dragon Draw A")), instance(devotee.player, dummy("Dragon Draw B"))];
  damageUnit(devoteeUnit, 1, devotee.player, devotee.opponent, ctxOf(devotee), []);
  damageUnit(devoteeUnit, 1, devotee.player, devotee.opponent, ctxOf(devotee), []);
  const devoteeDraws = devotee.player.hand.length;

  const jelly = makePair("jelly");
  const jellyUnit = boardFollower(instance(jelly.player, byName("Jellyfish Dancer")));
  const jellyMarine = boardFollower(instance(jelly.player, byName("Majestic Megalorca")));
  jelly.player.board = [jellyUnit, jellyMarine];
  applyEntryEvents(ctxOf(jelly), jellyMarine);
  const jellyfish = { rush: hasU(jellyUnit, "Rush"), bane: hasU(jellyUnit, "Bane") };

  const mari = makePair("mari");
  const mariInst = instance(mari.player, byName("Mari, Meg's Bestie"));
  mari.player.hand = [mariInst];
  const base3 = boardFollower(instance(mari.player, dummy("Base Three", 3, 2, 2)));
  const mariSource = boardFollower(instance(mari.player, byName("Mari, Meg's Bestie")));
  mari.player.board = [base3, mariSource];
  superEvolveUnitByAbility(ctxOf(mari), base3, []);
  const mariCostDuring = costOf(mariInst);
  const statsBeforeMari = [base3.attack, base3.defense];
  applyDragoncraftFollowerTurnEnd(ctxOf(mari), mariSource);
  const mariBuff = [base3.attack - statsBeforeMari[0], base3.defense - statsBeforeMari[1]];
  restoreDragoncraftTemporaryCosts(mari.player);
  const mariCostAfter = costOf(mariInst);

  const spirit = makePair("spirit");
  gainCrest(spirit.player, "Spirit of Wadatsumi", byName("Spirit of Wadatsumi"));
  const spiritMarine = boardFollower(instance(spirit.player, byName("Majestic Megalorca")));
  spirit.player.board = [spiritMarine];
  const spiritBefore = [spiritMarine.attack, spiritMarine.defense];
  applyEntryEvents(ctxOf(spirit), spiritMarine);
  const spiritBuff = [spiritMarine.attack - spiritBefore[0], spiritMarine.defense - spiritBefore[1]];

  const crescent = makePair("crescent");
  gainCrest(crescent.player, "Crescent Tube Ride", byName("Crescent Tube Ride"));
  const crescentUnit = boardFollower(instance(crescent.player, dummy("Crescent Target", 2, 2, 3)));
  crescent.player.board = [crescentUnit];
  const crescentCrest = crescent.player.crests[0];
  const crescentBefore = [crescentUnit.attack, crescentUnit.defense];
  applyDragoncraftCrestTurnEnd(crescent.player, crescent.opponent, 0, 1, crescent.stats, crescent.rng, map);
  const crescentResult = { countdown: crescentCrest.countdown, buff: [crescentUnit.attack - crescentBefore[0], crescentUnit.defense - crescentBefore[1]] };

  const meg = makePair("meg");
  const megUnit = boardFollower(instance(meg.player, byName("Meg, Girl Next Door")));
  meg.player.board = [megUnit];
  const base2 = boardFollower(instance(meg.player, dummy("Base Two", 2)));
  meg.player.board.push(base2);
  applyEntryEvents(ctxOf(meg), base2);
  const megWardAfterBase2 = hasU(megUnit, "Ward");
  megUnit.keywords = megUnit.keywords.filter(keyword => keyword !== "Ward");
  const generatedDrache = instance(meg.player, byName("Drache & Aluzard, Burning Blood"));
  generatedDrache.costDelta = -2;
  const cost2Drache = boardFollower(generatedDrache);
  meg.player.board.push(cost2Drache);
  applyEntryEvents(ctxOf(meg), cost2Drache);
  const megIgnoresChangedCost = !hasU(megUnit, "Ward");

  const rider = makePair("rider");
  const riderUnit = boardFollower(instance(rider.player, byName("Ocean Rider")));
  const riderMarine = boardFollower(instance(rider.player, byName("Majestic Megalorca")));
  rider.player.board = [riderUnit, riderMarine];
  applyEntryEvents(ctxOf(rider), riderMarine);
  const oceanRiderWard = hasU(riderMarine, "Ward");

  const yube = makePair("yube");
  gainCrest(yube.player, "Yube, Crestpetal", byName("Yube, Crestpetal"));
  const yubeMarine = boardFollower(instance(yube.player, byName("Majestic Megalorca")));
  yube.player.board = [yubeMarine];
  const yubeBaseAttack = yubeMarine.attack;
  const yubeActions = [];
  applyDragoncraftAttackDeclaration(ctxOf(yube), yubeMarine, yubeActions);
  applyDragoncraftAttackDeclaration(ctxOf(yube), yubeMarine, yubeActions);
  const yubeResult = { attackGain: yubeMarine.attack - yubeBaseAttack, generated: yube.player.hand.filter(item => norm(item.card.name) === "majestic megalorca").length };

  const drache = makePair("drache");
  const dracheCard = byName("Drache & Aluzard, Burning Blood");
  const dracheStats = [];
  for (let n = 0; n < 3; n += 1) {
    const unit = boardFollower(instance(drache.player, dracheCard));
    drache.player.board.push(unit);
    applyEntryEvents(ctxOf(drache), unit);
    resolveDragoncraftCardText(baseText(dracheCard.text), { ...ctxOf(drache), card: dracheCard, sourceUnit: unit });
    dracheStats.push({ attack: unit.attack, defense: unit.defense, evolved: unit.evolved });
  }
  gainCrest(drache.player, "Drache & Aluzard, Burning Blood", dracheCard);
  const dracheCrest = drache.player.crests.find(crest => norm(crest.name) === "drache & aluzard, burning blood");
  dracheCrest.countdown = 1; dracheCrest.gainedTurn = 0;
  tickCrests(drache.player, drache.opponent, 0, 1, drache.stats, drache.rng, map, []);
  const dracheGenerated = drache.player.hand.find(item => norm(item.card.name) === "drache & aluzard, burning blood");
  const dracheResult = { stats: dracheStats, generatedCost: dracheGenerated ? costOf(dracheGenerated) : null, generatedBaseCost: dracheGenerated?.card?.cost ?? null };

  const shred = makePair("shredder");
  shred.player.hp = 10;
  const shredder = boardFollower(instance(shred.player, byName("Stormy Shamisen Shredder")));
  const shredMarine = boardFollower(instance(shred.player, byName("Majestic Megalorca")));
  shred.player.board = [shredder, shredMarine];
  applyEntryEvents(ctxOf(shred), shredMarine);
  const shredderHeal = shred.player.hp - 10;

  const flame = makePair("flame");
  const burnite = byName("Burnite, Anathema of Flame");
  const discard = instance(flame.player, dummy("Discard Four", 4));
  flame.player.hand = [discard];
  flame.opponent.board = [boardFollower(instance(flame.opponent, dummy("Flame Target", 2, 1, 8)))];
  resolveDragoncraftCardText(baseText(burnite.text), { ...ctxOf(flame), card: burnite, sourceUnit: boardFollower(instance(flame.player, burnite)) });
  const burniteBoardDamage = 8 - flame.opponent.board[0].defense;
  gainCrest(flame.player, "Burnite, Anathema of Flame", burnite);
  flame.player.hp = flame.player.maxHp;
  const hpBeforeZeroHeal = flame.player.hp;
  healPlayer(flame.player, 0, flame.stats, 0);
  const burniteZeroHealDamage = hpBeforeZeroHeal - flame.player.hp;
  const hpBeforeSecondHeal = flame.player.hp;
  healPlayer(flame.player, 1, flame.stats, 0);
  const burniteOncePerTurn = flame.player.hp - hpBeforeSecondHeal;
  flame.player.personalTurn += 1;
  const hpBeforeStart = flame.player.hp;
  turnStart(flame.player, flame.opponent, 0, 1, flame.stats, flame.rng, map);
  const burniteStartDamage = hpBeforeStart - flame.player.hp;

  const az = makePair("azurifrit");
  const azCard = byName("Azurifrit, Heir to Disdain");
  const azUnit = boardFollower(instance(az.player, azCard));
  az.player.board = [azUnit];
  az.opponent.board = [boardFollower(instance(az.opponent, dummy("Azurifrit Enemy", 2, 1, 10)))];
  const azEnemyHp = az.opponent.hp;
  resolveDragoncraftCardText(baseText(azCard.text), { ...ctxOf(az), card: azCard, sourceUnit: azUnit });
  const azurifrit = { leaderDamage: azEnemyHp - az.opponent.hp, ownDefense: azUnit.defense, enemyDefense: az.opponent.board[0]?.defense ?? 0 };

  const elder = makePair("elder");
  const elderCard = byName("Dragon's Vale Elder");
  gainCrest(elder.player, "Dragon's Vale Elder", elderCard);
  const elderCrest = elder.player.crests[0];
  const elderEndBefore = elder.player.board.length;
  applyDragoncraftCrestTurnEnd(elder.player, elder.opponent, 0, 1, elder.stats, elder.rng, map);
  const elderEndSummons = elder.player.board.length - elderEndBefore;
  resolveDragoncraftCardText("Delay the count of your Crest: Dragon's Vale Elder by 2.", { ...ctxOf(elder), card: elderCard, sourceUnit: null });
  const elderResult = { initialCountdown: 2, afterDelay: elderCrest.countdown, endSummons: elderEndSummons };

  const wise = makePair("wise");
  const wiseInst = instance(wise.player, byName("Wise Guardian Dragon"));
  wise.player.hand = [wiseInst];
  const wiseSuperA = boardFollower(instance(wise.player, dummy("Wise Super A", 4)));
  const wiseSuperB = boardFollower(instance(wise.player, dummy("Wise Super B", 4)));
  wise.player.board = [wiseSuperA, wiseSuperB];
  superEvolveUnitByAbility(ctxOf(wise), wiseSuperA, []);
  superEvolveUnitByAbility(ctxOf(wise), wiseSuperB, []);
  const wiseCost = costOf(wiseInst);

  return {
    devoteeDraws, jellyfish, mariCostDuring, mariCostAfter, mariBuff, spiritBuff, crescentResult,
    megWardAfterBase2, megIgnoresChangedCost, oceanRiderWard, yubeResult, dracheResult, shredderHeal,
    burniteBoardDamage, burniteZeroHealDamage, burniteOncePerTurn, burniteStartDamage, azurifrit,
    elderResult, wiseCost
  };
}

// [[battle-forestcraft-full-qa]]
export function inspectForestcraftFullRules({ cards = [] } = {}) {
  const rawMap = new Map(cards.map(card => [Number(card.id), card]));
  const map = prepareSimulationCardMap(rawMap);
  const byName = name => findByName(map, name);
  const makePair = seed => {
    const rng = createRng(`forestcraft-full-qa:${seed}`);
    const stats = createStats();
    const player = makePlayer("You", [], { style: "buff-tempo" }, map, rng);
    const opponent = makePlayer("Opponent", [], {}, map, rng);
    player.isActive = true;
    opponent.isActive = false;
    player.personalTurn = 6;
    opponent.personalTurn = 5;
    player.maxPp = player.pp = 10;
    opponent.maxPp = opponent.pp = 10;
    return { rng, stats, player, opponent };
  };
  const dummy = (name, attack = 1, defense = 3, traits = []) => ({
    id: -910000 - name.length, name, class: "Forestcraft", type: "Follower", cost: 0,
    attack, defense, text: "", keywords: [], traits, relatedCards: []
  });
  const playNamed = (q, name, text = null) => {
    const card = byName(name);
    const inst = instance(q.player, card);
    q.player.hand.push(inst);
    const mode = { kind: "base", cost: Math.max(0, Number(card.cost) || 0), text: text ?? baseText(card.text), modeIndex: 0, scoreBonus: 0 };
    return playCard(inst, mode, q.player, q.opponent, 0, 1, q.stats, q.rng, map);
  };

  const mag = makePair("magnified");
  mag.player.cardsPlayedThisTurn = 2;
  mag.opponent.board = [boardFollower(instance(mag.opponent, dummy("Malice Target", 1, 5)))];
  playNamed(mag, "Magnified Malice");
  const magCrest = mag.player.crests.find(crest => norm(crest.name) === "magnified malice");
  if (magCrest) { magCrest.countdown = 1; magCrest.gainedTurn = 0; }
  tickCrests(mag.player, mag.opponent, 0, 1, mag.stats, mag.rng, map, []);
  const magnified = { gained: Boolean(magCrest), minimized: mag.player.hand.filter(item => norm(item.card.name) === "minimized anxiety").length };

  const min = makePair("minimized");
  min.player.hp = 10;
  min.player.cardsPlayedThisTurn = 2;
  playNamed(min, "Minimized Anxiety");
  const minHeal = min.player.hp;
  const minCrest = min.player.crests.find(crest => norm(crest.name) === "minimized anxiety");
  if (minCrest) { minCrest.countdown = 1; minCrest.gainedTurn = 0; }
  tickCrests(min.player, min.opponent, 0, 1, min.stats, min.rng, map, []);
  const minimized = { healedHp: minHeal, magnified: min.player.hand.filter(item => norm(item.card.name) === "magnified malice").length };

  const star = makePair("starry");
  star.player.cardsPlayedThisTurn = 4;
  star.opponent.hp = 20;
  star.opponent.board = [boardFollower(instance(star.opponent, dummy("Starry Target", 1, 5)))];
  playNamed(star, "Starry Sky");
  const starCrest = star.player.crests.find(crest => norm(crest.name) === "starry sky");
  if (starCrest) { starCrest.countdown = 1; starCrest.gainedTurn = 0; }
  tickCrests(star.player, star.opponent, 0, 1, star.stats, star.rng, map, []);
  const starry = { leaderDamage: 20 - star.opponent.hp, regenerated: star.player.hand.filter(item => norm(item.card.name) === "starry sky").length };

  const sat = makePair("sathanid");
  sat.player.forestFaithActive = true;
  sat.player.faith = 10;
  playNamed(sat, "Sathanid, Eld Lance");
  const depths = sat.player.hand.find(item => norm(item.card.name) === "depths of the eld lance");
  const depthTarget = boardFollower(instance(sat.player, dummy("Depths Target", 2, 2)));
  sat.player.board.push(depthTarget);
  const hpBeforeDepths = sat.opponent.hp;
  if (depths) playCard(depths, { kind: "base", cost: 1, text: depths.card.text, modeIndex: 0, scoreBonus: 0 }, sat.player, sat.opponent, 0, 1, sat.stats, sat.rng, map);
  const sathanid = { faith: sat.player.faith, granted: sat.player.forestFaithEvolveDamage, depths: Boolean(depths), evolved: depthTarget.evolved, damage: hpBeforeDepths - sat.opponent.hp };

  const blade = makePair("blade");
  const bladeSource = boardFollower(instance(blade.player, map.get(10311120)));
  const bladeFairy = boardFollower(instance(blade.player, byName("Fairy")));
  blade.player.board = [bladeSource, bladeFairy];
  applyEntryEvents({ player: blade.player, opponent: blade.opponent, playerIndex: 0, enemyIndex: 1, stats: blade.stats, rng: blade.rng, cardMap: map }, bladeFairy);
  const fairyBladeAttack = bladeSource.attack;

  const fencer = makePair("fencer");
  const fencerInst = instance(fencer.player, byName("Fairy Fencer"));
  fencer.player.hand = [fencerInst];
  const fencerDummy = boardFollower(instance(fencer.player, dummy("Super Dummy")));
  fencer.player.board = [fencerDummy];
  superEvolveUnitByAbility({ player: fencer.player, opponent: fencer.opponent, playerIndex: 0, enemyIndex: 1, stats: fencer.stats, rng: fencer.rng, cardMap: map }, fencerDummy, []);
  const fairyFencerCost = costOf(fencerInst);

  const prof = makePair("profusion");
  const profusion = boardAmulet(instance(prof.player, byName("Wild Profusion")));
  const profFairy = boardFollower(instance(prof.player, byName("Fairy")));
  const profEnemy = boardFollower(instance(prof.opponent, dummy("Profusion Enemy", 1, 4)));
  prof.player.board = [profusion, profFairy]; prof.opponent.board = [profEnemy];
  applyEntryEvents({ player: prof.player, opponent: prof.opponent, playerIndex: 0, enemyIndex: 1, stats: prof.stats, rng: prof.rng, cardMap: map }, profFairy);
  const wildProfusionDamage = 4 - profEnemy.defense;

  const th = makePair("thestae");
  const thEnemy = boardFollower(instance(th.opponent, dummy("Thestae Enemy", 2, 8)));
  th.opponent.board = [thEnemy];
  playNamed(th, "Thestae, Anathema of Distortion");
  const thUnit = th.player.board.find(unit => norm(unit.name) === "thestae, anathema of distortion");
  const thestaeFanfare = { defense: thEnemy.defense, combo: th.player.cardsPlayedThisTurn };
  if (thUnit) evolveUnitByAbility({ player: th.player, opponent: th.opponent, playerIndex: 0, enemyIndex: 1, stats: th.stats, rng: th.rng, cardMap: map }, thUnit, []);
  th.player.cardsPlayedThisTurn = 3;
  const deckBuffTarget = instance(th.player, dummy("Deck Buff Target", 1, 1));
  th.player.deck = [deckBuffTarget];
  applyForestCrestTurnEnd(th.player, th.opponent, 0, 1, th.stats, th.rng, map);
  const thestaeCrest = { attackBonus: deckBuffTarget.attackBonus, defenseBonus: deckBuffTarget.defenseBonus };

  const tit = makePair("titania");
  gainCrest(tit.player, "Titania, Queen of Fairies", byName("Titania, Queen of Fairies"));
  applyForestCrestTurnStart(tit.player, tit.opponent, 0, 1, tit.stats, tit.rng, map);
  const titaniaStartFairy = tit.player.hand.filter(item => norm(item.card.name) === "fairy").length;
  const titania = boardFollower(instance(tit.player, byName("Titania, Queen of Fairies")));
  const titEnemy = boardFollower(instance(tit.opponent, dummy("Titania Enemy", 7, 7)));
  tit.player.board = [titania]; tit.opponent.board = [titEnemy];
  evolveUnitByAbility({ player: tit.player, opponent: tit.opponent, playerIndex: 0, enemyIndex: 1, stats: tit.stats, rng: tit.rng, cardMap: map }, titania, []);
  const titaniaTransform = tit.opponent.board[0]?.name ?? null;

  const bat = makePair("battledore");
  const woodsmaiden = boardFollower(instance(bat.player, byName("Battledore Woodsmaiden")));
  const batFairy = boardFollower(instance(bat.player, byName("Fairy")));
  bat.player.board = [woodsmaiden, batFairy];
  const batHp = bat.opponent.hp;
  applyEntryEvents({ player: bat.player, opponent: bat.opponent, playerIndex: 0, enemyIndex: 1, stats: bat.stats, rng: bat.rng, cardMap: map }, batFairy);
  const battledoreLeaderDamage = batHp - bat.opponent.hp;
  const boardBeforeEvolve = bat.player.board.length;
  evolveUnitByAbility({ player: bat.player, opponent: bat.opponent, playerIndex: 0, enemyIndex: 1, stats: bat.stats, rng: bat.rng, cardMap: map }, woodsmaiden, []);
  const battledoreEvolveSummons = bat.player.board.length - boardBeforeEvolve;

  const floral = makePair("floral");
  const floralInst = instance(floral.player, byName("Floral Offering"));
  floral.player.hand = [floralInst];
  const floralUnit = boardFollower(instance(floral.player, dummy("Floral Evolve")));
  floral.player.board = [floralUnit];
  evolveUnitByAbility({ player: floral.player, opponent: floral.opponent, playerIndex: 0, enemyIndex: 1, stats: floral.stats, rng: floral.rng, cardMap: map }, floralUnit, []);
  const floralCost = costOf(floralInst);

  const mercy = makePair("merciful");
  mercy.player.hp = 10;
  const attendant = boardFollower(instance(mercy.player, byName("Merciful Attendant")));
  const mercyUnit = boardFollower(instance(mercy.player, dummy("Mercy Evolve")));
  mercy.player.board = [attendant, mercyUnit];
  evolveUnitByAbility({ player: mercy.player, opponent: mercy.opponent, playerIndex: 0, enemyIndex: 1, stats: mercy.stats, rng: mercy.rng, cardMap: map }, mercyUnit, []);
  const mercifulHeal = mercy.player.hp - 10;

  const yuel = makePair("yuel");
  gainCrest(yuel.player, "Yuel & Societte, Dancing Duo", byName("Yuel & Societte, Dancing Duo"));
  const y1 = instance(yuel.player, dummy("Yuel First"));
  const y2 = instance(yuel.player, dummy("Yuel Second"));
  yuel.player.hand = [y1, y2];
  playCard(y1, { kind: "base", cost: 0, text: "", modeIndex: 0, scoreBonus: 0 }, yuel.player, yuel.opponent, 0, 1, yuel.stats, yuel.rng, map);
  playCard(y2, { kind: "base", cost: 0, text: "", modeIndex: 0, scoreBonus: 0 }, yuel.player, yuel.opponent, 0, 1, yuel.stats, yuel.rng, map);
  const yuelCrest = { first: yuel.player.board.find(unit => unit.name === "Yuel First")?.evolved ?? false, second: yuel.player.board.find(unit => unit.name === "Yuel Second")?.evolved ?? false };

  const aria = makePair("aria");
  gainCrest(aria.player, "Aria, Lady of the Woods", byName("Aria, Lady of the Woods"));
  const ariaFairy = boardFollower(instance(aria.player, byName("Fairy")));
  aria.player.board = [ariaFairy];
  applyEntryEvents({ player: aria.player, opponent: aria.opponent, playerIndex: 0, enemyIndex: 1, stats: aria.stats, rng: aria.rng, cardMap: map }, ariaFairy);
  const ariaStorm = hasU(ariaFairy, "Storm");
  const ariaUnit = boardFollower(instance(aria.player, byName("Aria, Lady of the Woods")));
  aria.player.board = [ariaUnit];
  evolveUnitByAbility({ player: aria.player, opponent: aria.opponent, playerIndex: 0, enemyIndex: 1, stats: aria.stats, rng: aria.rng, cardMap: map }, ariaUnit, []);
  const ariaFairies = aria.player.board.filter(unit => norm(unit.name) === "fairy").length;
  const ariaFairyStorms = aria.player.board.filter(unit => norm(unit.name) === "fairy" && hasU(unit, "Storm")).length;

  const hart = makePair("hart");
  const hartUnit = boardFollower(instance(hart.player, byName("Great Hart of the Glacial Realm")));
  hart.player.board = [hartUnit];
  hart.opponent.board = [boardFollower(instance(hart.opponent, dummy("Hart A", 1, 10))), boardFollower(instance(hart.opponent, dummy("Hart B", 1, 10)))];
  const hartBefore = hart.opponent.board.reduce((sum, unit) => sum + unit.defense, 0);
  resolveForestcraftCardText("Deal X damage split between all enemy followers. X is this follower's attack.", { card: hartUnit.card, sourceUnit: hartUnit, player: hart.player, opponent: hart.opponent, playerIndex: 0, enemyIndex: 1, stats: hart.stats, rng: hart.rng, cardMap: map });
  const greatHartSplit = hartBefore - hart.opponent.board.reduce((sum, unit) => sum + unit.defense, 0);
  gainCrest(hart.player, "Great Hart of the Glacial Realm", hartUnit.card);
  hart.player.cardsPlayedThisTurn = 3;
  applyForestCrestTurnEnd(hart.player, hart.opponent, 0, 1, hart.stats, hart.rng, map);
  const greatHartBounty = hart.player.hand.filter(item => norm(item.card.name) === "deepwood bounty").length;

  const macro = makePair("macrobear");
  playNamed(macro, "Macrobear");
  const macroUnits = macro.player.board.filter(unit => norm(unit.name) === "macrobear");
  const macroTarget = macroUnits[0];
  const macroBefore = macroTarget?.defense ?? 0;
  if (macroTarget) damageUnit(macroTarget, 10, macro.player, macro.opponent, { player: macro.opponent, opponent: macro.player, playerIndex: 1, enemyIndex: 0, stats: macro.stats, rng: macro.rng, cardMap: map }, []);
  const macrobear = { copies: macroUnits.length, damageTaken: macroBefore - (macroTarget?.defense ?? macroBefore) };

  const cong = makePair("congregant");
  playNamed(cong, "Congregant of Unkilling");
  const congregants = cong.player.board.filter(unit => norm(unit.name) === "congregant of unkilling");
  const congregant = { count: congregants.length, defenses: congregants.map(unit => unit.defense) };

  return {
    magnified, minimized, starry, sathanid, fairyBladeAttack, fairyFencerCost,
    wildProfusionDamage, thestaeFanfare, thestaeCrest, titaniaStartFairy, titaniaTransform,
    battledoreLeaderDamage, battledoreEvolveSummons, floralCost, mercifulHeal, yuelCrest,
    ariaStorm, ariaFairies, ariaFairyStorms, greatHartSplit, greatHartBounty, macrobear, congregant
  };
}

// [[battle-swordcraft-full-qa]]
export function inspectSwordcraftFullRules({ cards = [] } = {}) {
  const map = new Map(cards.map(card => [Number(card.id), card]));
  prepareOriginalCardMap(map);
  const byName = name => findByName(map, name);
  const makePair = seed => {
    const rng = createRng(`swordcraft-full-qa:${seed}`);
    const stats = createStats();
    const player = makePlayer("You", [], {}, map, rng);
    const opponent = makePlayer("Opponent", [], {}, map, rng);
    player.isActive = true;
    opponent.isActive = false;
    player.personalTurn = 6;
    opponent.personalTurn = 5;
    player.maxPp = player.pp = 10;
    opponent.maxPp = opponent.pp = 10;
    return { rng, stats, player, opponent };
  };
  const syntheticFollower = (name, traits = []) => ({ id: -700000 - name.length, name, class: "Swordcraft", type: "Follower", cost: 1, attack: 1, defense: 1, text: "", keywords: [], traits });
  const enterWith = (sourceName, entrant = syntheticFollower("QA Officer", ["Officer"])) => {
    const q = makePair(sourceName);
    const sourceCard = byName(sourceName);
    const source = sourceCard.type === "Amulet" ? boardAmulet(instance(q.player, sourceCard)) : boardFollower(instance(q.player, sourceCard));
    q.player.board.push(source);
    const unit = boardFollower(instance(q.player, entrant));
    q.player.board.push(unit);
    q.player.rally += 1;
    const actions = applyEntryEvents({ player: q.player, opponent: q.opponent, playerIndex: 0, enemyIndex: 1, stats: q.stats, rng: q.rng, cardMap: map }, unit);
    return { ...q, source, unit, actions };
  };

  const commander = enterWith("Luminous Commander");
  const commanderBuff = commander.source.attack - Number(commander.source.card.attack || 0);
  restoreTemporaryAttack(commander.player);
  const commanderRestored = commander.source.attack;

  const lyrala = enterWith("Lyrala, Luminous Potionwright");
  lyrala.player.hp = 10;
  const lyralaUnit = boardFollower(instance(lyrala.player, syntheticFollower("Second QA Officer", ["Officer"])));
  lyrala.player.board.push(lyralaUnit);
  applyEntryEvents({ player: lyrala.player, opponent: lyrala.opponent, playerIndex: 0, enemyIndex: 1, stats: lyrala.stats, rng: lyrala.rng, cardMap: map }, lyralaUnit);
  const lyralaHeal = lyrala.player.hp - 10;

  const magus = enterWith("Luminous Magus");
  const magusWard = hasU(magus.unit, "Ward");

  const crown = enterWith("Ancestral Crown", syntheticFollower("QA Crown Follower"));
  const crownBuff = [crown.unit.attack, crown.unit.defense];

  const amalia = enterWith("Amalia, Luxsteel Paladin", syntheticFollower("QA Amalia Follower"));
  const amaliaEntry = { attack: amalia.unit.attack, rush: hasU(amalia.unit, "Rush"), ward: hasU(amalia.unit, "Ward") };

  const peace = enterWith("Gildaria, Anathema of Peace", syntheticFollower("QA Peace Follower"));
  peace.opponent.board = [
    boardFollower(instance(peace.opponent, syntheticFollower("Peace Enemy A"))),
    boardFollower(instance(peace.opponent, syntheticFollower("Peace Enemy B")))
  ];
  for (const unit of peace.opponent.board) { unit.defense = 2; unit.maxDefense = 2; }
  const peaceEntry = boardFollower(instance(peace.player, syntheticFollower("QA Peace Trigger")));
  peace.player.board.push(peaceEntry);
  applyEntryEvents({ player: peace.player, opponent: peace.opponent, playerIndex: 0, enemyIndex: 1, stats: peace.stats, rng: peace.rng, cardMap: map }, peaceEntry);
  const peaceBoardDefense = peace.opponent.board.map(unit => unit.defense);

  const bomb = makePair("bombardier");
  bomb.player.hand.push(instance(bomb.player, byName("Bombastic Bombardier")));
  applySwordcraftSuperEvolveHandTriggers(bomb.player);
  const bombardierCost = costOf(bomb.player.hand[0]);

  const katze = makePair("katze");
  const katzeUnit = boardFollower(instance(katze.player, byName("Katze, Magical Thief")));
  katze.player.board.push(katzeUnit);
  const katzeEnemy = boardFollower(instance(katze.opponent, syntheticFollower("Katze Enemy")));
  katzeEnemy.defense = 5; katzeEnemy.maxDefense = 5;
  katze.opponent.board.push(katzeEnemy);
  applySwordcraftSpellPlayedTriggers(katze.player, katze.opponent, 0, 1, katze.stats, katze.rng, map);
  applySwordcraftSpellPlayedTriggers(katze.player, katze.opponent, 0, 1, katze.stats, katze.rng, map);
  const katzeDefense = katzeEnemy.defense;

  const majestic = makePair("majestic");
  gainCrest(majestic.player, "Majestic Conquest", byName("Majestic Conquest"));
  const majesticCtx = { card: byName("Majestic Conquest"), player: majestic.player, opponent: majestic.opponent, playerIndex: 0, enemyIndex: 1, stats: majestic.stats, rng: majestic.rng, cardMap: map };
  applyEnhancedCardPlayed(majesticCtx);
  resolveSwordcraftCardText("Delay the count of your Crest: Majestic Conquest by 2.", majesticCtx);
  const majesticResult = {
    countdown: majestic.player.crests.find(crest => norm(crest.name) === "majestic conquest")?.countdown ?? null,
    fearless: majestic.player.board.filter(unit => norm(unit.name) === "fearless soldier").length
  };

  const kage = makePair("kagemitsu");
  gainCrest(kage.player, "Kagemitsu, Enduring Warrior", byName("Kagemitsu, Enduring Warrior"));
  const kageCrest = kage.player.crests.find(crest => norm(crest.name) === "kagemitsu, enduring warrior");
  kageCrest.countdown = 1; kageCrest.gainedTurn = 0;
  tickCrests(kage.player, kage.opponent, 0, 1, kage.stats, kage.rng, map, []);
  const kagemitsuSummoned = kage.player.board.some(unit => norm(unit.name) === "kagemitsu, enduring warrior");

  const octrice = makePair("octrice");
  gainCrest(octrice.player, "Octrice, Hollowness Manifest", byName("Octrice, Hollowness Manifest"));
  octrice.player.hand.push(instance(octrice.player, byName("Sinciro, Heir to Usurpation")));
  octrice.player.hand.push(instance(octrice.player, byName("Gilded Blade")));
  octrice.player.hand.push(instance(octrice.player, byName("Gilded Necklace")));
  const sinciro = octrice.player.hand.find(item => norm(item.card.name) === "sinciro, heir to usurpation");
  const loot = octrice.player.hand.filter(item => ["gilded blade", "gilded necklace"].includes(norm(item.card.name)));
  resolveFuseAction({ target: sinciro, materials: loot }, octrice.player, octrice.opponent, 0, 1, octrice.stats, octrice.rng, map);
  const octriceAfterTwoLootFuse = octrice.player.crests.find(crest => norm(crest.name) === "octrice, hollowness manifest")?.countdown ?? null;
  const octriceCrest = octrice.player.crests.find(crest => norm(crest.name) === "octrice, hollowness manifest");
  if (octriceCrest) octriceCrest.countdown = 1;
  applySwordcraftLootCrestEvent(octrice.player, octrice.opponent, 0, 1, octrice.stats, octrice.rng, map, [], "play");
  const octriceRemnant = octrice.player.hand.filter(item => norm(item.card.name) === "remnant of hollowness").length;

  const unkei = makePair("unkei");
  gainCrest(unkei.player, "Unkei, Goldbloom", byName("Unkei, Goldbloom"));
  applySwordcraftCrestTurnEnd(unkei.player, unkei.opponent, 0, 1, unkei.stats, unkei.rng, map);
  const unkeiGold = unkei.player.hand.filter(item => norm(item.card.name) === "glittering gold").length;

  const gildariaAt19 = makePair("gildaria-19");
  gildariaAt19.player.rally = 19;
  const g19 = instance(gildariaAt19.player, byName("Gildaria, Anathema of Peace"));
  gildariaAt19.player.hand.push(g19);
  playCard(g19, { kind: "base", cost: 6, text: "Rally (20) - Super-evolve this follower." }, gildariaAt19.player, gildariaAt19.opponent, 0, 1, gildariaAt19.stats, gildariaAt19.rng, map);
  const gildaria19Super = Boolean(gildariaAt19.player.board.find(unit => norm(unit.name) === "gildaria, anathema of peace")?.superEvolved);

  const gildariaAt20 = makePair("gildaria-20");
  gildariaAt20.player.rally = 20;
  const g20 = instance(gildariaAt20.player, byName("Gildaria, Anathema of Peace"));
  gildariaAt20.player.hand.push(g20);
  playCard(g20, { kind: "base", cost: 6, text: "Rally (20) - Super-evolve this follower." }, gildariaAt20.player, gildariaAt20.opponent, 0, 1, gildariaAt20.stats, gildariaAt20.rng, map);
  const g20Unit = gildariaAt20.player.board.find(unit => norm(unit.name) === "gildaria, anathema of peace");
  const gildaria20 = {
    superEvolved: Boolean(g20Unit?.superEvolved),
    steelclad: gildariaAt20.player.board.filter(unit => norm(unit.name) === "steelclad knight").length,
    rush: gildariaAt20.player.board.filter(unit => norm(unit.name) === "steelclad knight" && hasU(unit, "Rush")).length
  };

  const yurius = makePair("yurius");
  yurius.player.hp = 10;
  const yuriusUnit = boardFollower(instance(yurius.player, byName("Yurius, Levin Authority")));
  yurius.player.board.push(yuriusUnit);
  const enemyEntry = boardFollower(instance(yurius.opponent, syntheticFollower("Yurius Enemy Entry")));
  yurius.opponent.board.push(enemyEntry);
  applyEntryEvents({ player: yurius.opponent, opponent: yurius.player, playerIndex: 1, enemyIndex: 0, stats: yurius.stats, rng: yurius.rng, cardMap: map }, enemyEntry);
  const yuriusEntry = { locked: Boolean(enemyEntry.yuriusAttackLocked), enemyHp: yurius.opponent.hp, ownerHp: yurius.player.hp };
  applySwordcraftTurnStartLocks(yurius.opponent);
  const yuriusLockedAtStart = !enemyEntry.canAttackLeader && !enemyEntry.canAttackFollower;
  clearSwordcraftTurnLocks(yurius.opponent);

  return {
    commander: { buff: commanderBuff, restoredAttack: commanderRestored },
    lyralaHeal,
    magusWard,
    crownBuff,
    amaliaEntry,
    peaceBoardDefense,
    bombardierCost,
    katzeDefense,
    majesticResult,
    kagemitsuSummoned,
    octriceAfterTwoLootFuse,
    octriceRemnant,
    unkeiGold,
    gildaria19Super,
    gildaria20,
    yuriusEntry,
    yuriusLockedAtStart
  };
}

export function inspectEffectiveCost(card, { spellboost = 0, costDelta = 0 } = {}) {
  return costOf({ card, spellboost, costDelta });
}


// [[battle-high-risk-runtime-probe]]
export function inspectHighRiskCandidateResolution({ cards = [], cardIds = [] } = {}) {
  const rawMap = new Map(cards.map(card => [Number(card.id), card]));
  const map = prepareSimulationCardMap(rawMap);
  const requested = new Set(cardIds.map(Number));
  const selected = [...map.values()].filter(card => !requested.size || requested.has(Number(card.id)));

  const synthetic = (id, name, type = "Follower", cost = 2, attack = 2, defense = 8, traits = []) => ({
    id, name, class: "Neutral", type, cost,
    attack: type === "Follower" ? attack : null,
    defense: type === "Follower" ? defense : null,
    text: type === "Amulet" ? "Last Words: Draw a card." : "",
    keywords: [], traits, relatedCards: []
  });
  const allyA = synthetic(-981001, "Probe Ally Artifact", "Follower", 5, 3, 8, ["Artifact"]);
  const allyB = synthetic(-981002, "Probe Ally Pixie", "Follower", 4, 2, 8, ["Pixie"]);
  const allyC = synthetic(-981003, "Probe Ally", "Follower", 3, 2, 8, []);
  const enemyA = synthetic(-981011, "Probe Enemy A", "Follower", 5, 4, 20, []);
  const enemyB = synthetic(-981012, "Probe Enemy B", "Follower", 4, 3, 20, []);
  const enemyC = synthetic(-981013, "Probe Enemy C", "Follower", 2, 2, 20, []);
  const amuletA = synthetic(-981021, "Probe Amulet A", "Amulet", 1);
  const amuletB = synthetic(-981022, "Probe Amulet B", "Amulet", 2);
  const amuletC = synthetic(-981023, "Probe Amulet C", "Amulet", 4);

  const makePair = seed => {
    const rng = createRng(`high-risk-probe:${seed}`);
    const stats = createStats();
    const player = makePlayer("You", [], { style: "midrange" }, map, rng);
    const opponent = makePlayer("Opponent", [], { style: "midrange" }, map, rng);
    player.isActive = true; opponent.isActive = false;
    player.personalTurn = 20; opponent.personalTurn = 19;
    player.maxPp = player.pp = 10; opponent.maxPp = opponent.pp = 10;
    player.ep = player.sep = opponent.ep = opponent.sep = 2;
    player.shadows = 30; player.rally = 30; player.earthSigils = 30; player.faith = 30;
    player.cardsPlayedThisTurn = 10; player.spellsPlayedThisTurn = 5; player.evolutionsThisMatch = 10;
    player.artifactFollowerNamesEntered = ["analyzing artifact", "ancient artifact", "mystic artifact"];
    player.destroyedFollowers = [
      { card: allyA }, { card: allyB }, { card: allyC },
      { card: map.get(90071110) ?? allyA }, { card: map.get(90072110) ?? allyA }
    ];
    player.destroyedAmulets = [{ card: amuletA }, { card: amuletB }, { card: amuletC }];
    player.hand = [
      instance(player, map.get(90071110) ?? allyA),
      instance(player, map.get(90072110) ?? allyA),
      instance(player, allyA), instance(player, allyB), instance(player, allyC)
    ];
    opponent.hand = [instance(opponent, enemyA), instance(opponent, enemyB), instance(opponent, enemyC)];
    player.deck = [instance(player, allyA), instance(player, allyB), instance(player, allyC), instance(player, amuletA), instance(player, enemyA), instance(player, enemyB)];
    opponent.deck = [instance(opponent, enemyA), instance(opponent, enemyB), instance(opponent, enemyC), instance(opponent, allyA), instance(opponent, allyB), instance(opponent, allyC)];
    return { rng, stats, player, opponent };
  };

  const labels = [
    ["base", "base", null],
    ["evolve", "trigger", "evolve"],
    ["super-evolve", "trigger", "superEvolve"],
    ["last-words", "trigger", "lastWords"],
    ["engage", "section", "engage"],
    ["strike", "trigger", "strike"],
    ["turn-start", "trigger", "turnStart"],
    ["turn-end", "trigger", "turnEnd"]
  ];
  const results = [];

  for (const card of selected) {
    for (const [event, kind, key] of labels) {
      const raw = kind === "base" ? baseText(card.text)
        : kind === "trigger" ? getTriggeredText(card, key)
        : section(card.text, key);
      if (!raw) continue;
      const basePair = makePair(`${card.id}:${event}`);
      const choices = expandModes(raw, basePair.player);
      for (let modeIndex = 0; modeIndex < choices.length; modeIndex += 1) {
        const q = makePair(`${card.id}:${event}:${modeIndex}`);
        const preparedCard = map.get(Number(card.id));
        const inst = instance(q.player, preparedCard);
        let sourceUnit = null;
        if (preparedCard.type === "Follower") {
          sourceUnit = boardFollower(inst);
          q.player.board.push(sourceUnit);
        } else if (preparedCard.type === "Amulet") {
          sourceUnit = boardAmulet(inst);
          q.player.board.push(sourceUnit);
        }
        for (const extraCard of [allyA, allyB, amuletA]) {
          if (q.player.board.length >= 5) break;
          q.player.board.push(extraCard.type === "Amulet" ? boardAmulet(instance(q.player, extraCard)) : boardFollower(instance(q.player, extraCard)));
        }
        q.opponent.board = [enemyA, enemyB, enemyC].map(value => boardFollower(instance(q.opponent, value)));
        const ctx = { card: preparedCard, instance: inst, sourceUnit, player: q.player, opponent: q.opponent, playerIndex: 0, enemyIndex: 1, stats: q.stats, rng: q.rng, cardMap: map };
        const choice = expandModes(raw, q.player)[modeIndex] ?? { text: raw, i: 0 };
        const resolved = resolveText(choice.text, ctx);
        results.push({
          id: Number(preparedCard.id), name: preparedCard.name, className: preparedCard.class,
          event, modeIndex, raw: choice.text, unresolved: Boolean(resolved.unresolved), actions: resolved.actions
        });
      }
    }
  }
  return results;
}



function prepareSimulationCardMap(cardMap) {
  return prepareSimulationCardMapWithSupport(cardMap, analyzeCardSupport);
}



function makePlayer(name, deck, strategy, cardMap, rng, className = null) {
  const player = {
    name, className, strategy: normStrategy(strategy), hp: 20, maxHp: 20, maxPp: 0, pp: 0, ep: 2, sep: 2,
    shadows: 0, rally: 0, earthSigils: 0, faith: 0, faithActive: false, faithEnhanceBuffs: 0, forestFaithActive: false, forestFaithEvolveDamage: 0,
    abyssFaithActive: false, abyssFaithModeBonus: 0, havenFaithActive: false, crests: [], bonusPpAvailable: false, bonusPpUses: 0,
    leaderDamageCap: null, leaderDamageCapUntilOpponentTurnEnd: false, leaderBarrier: 0, leaderDamageTakenBonus: 0,
    goingFirst: false, goingSecond: false, personalTurn: 0, cardsPlayedThisTurn: 0, spellsPlayedThisTurn: 0, futureLookaheadUsedThisTurn: false,
    evolutionsThisMatch: 0, evolutionActionUsed: false,
    // [[battle-dragoncraft-state]]
    dracheEntriesThisMatch: 0,
    // [[battle-runecraft-state]]
    shikigamiDestroyedBaseAttackThisTurn: 0, shikigamiDestroyedBaseDefenseThisTurn: 0,
    nextSerial: 0, deck: [], hand: [], board: [], cemetery: [],
    banished: [], fusedCards: [], destroyedFollowers: [], destroyedAmulets: [], artifactFollowerNamesEntered: [], deckOut: false, isActive: false,
    // [[battle-neutral-special-victory-state]]
    mjerrabaineVictoryOnEmpty: false, specialVictory: false
  };
  // [[battle-leader-damage-guard-install]]
  installLeaderDamageGuard(player);
  for (const [id, qty] of normalizeDeck(deck)) {
    const card = cardMap.get(Number(id));
    if (!card) continue;
    for (let index = 0; index < qty; index += 1) player.deck.push(instance(player, card));
  }
  // [[battle-faith-initialization]]
  // Faith activates automatically when a Faith card is present in the starting deck.
  player.faithActive = player.deck.some(item => (has(item.card, "Faith") && !["abysscraft", "havencraft"].includes(norm(item.card?.class)))
    || ["yidmetra, eld sword", "calge-danthla, eld crystals"].includes(norm(item.card?.name)));
  // Havencraft Lyanthoth Faith increments only when allied amulets are destroyed.
  player.havenFaithActive = player.deck.some(item => norm(item.card?.name) === "lyanthoth, eld tome");
  // Abysscraft Faith counts Mode-selection events rather than Enhanced-card events.
  player.abyssFaithActive = player.deck.some(item => norm(item.card?.class) === "abysscraft");
  // Sathanid's Faith uses evolution, not Enhanced-card events. Keep its
  // activation separate from the Runecraft Faith implementation while sharing
  // the public numeric Faith value.
  player.forestFaithActive = player.deck.some(item => norm(item.card?.name) === "sathanid, eld lance");
  shuffle(player.deck, rng);
  return player;
}

// [[battle-leader-damage-guard]]
function installLeaderDamageGuard(player) {
  let value = Number(player.hp) || 0;
  Object.defineProperty(player, "hp", {
    enumerable: true,
    configurable: true,
    get() { return value; },
    set(nextValue) {
      const next = Number(nextValue);
      if (!Number.isFinite(next)) return;
      if (next < value && (Number(player.leaderBarrier) || 0) > 0) {
        player.leaderBarrier = 0;
        return;
      }
      if (next < value) {
        const requestedLoss = value - next + Math.max(0, Number(player.leaderDamageTakenBonus) || 0);
        if (Number.isFinite(player.leaderDamageCap)) {
          value -= Math.min(requestedLoss, Math.max(0, Number(player.leaderDamageCap) || 0));
          return;
        }
        value -= requestedLoss;
        return;
      }
      value = next;
    }
  });
}

function instance(player, card) {
  return {
    uid: `${player.name}-${player.nextSerial++}`,
    card,
    spellboost: 0,
    costDelta: 0,
    attackBonus: 0,
    defenseBonus: 0,
    skyboundEvolutions: 0,
    fusedThisTurn: false,
    fusedCards: [],
    fusedNames: [],
    x: initialX(card)
  };
}

function initialX(card) {
  const match = String(card?.text ?? "").match(/X starts at\s*(-?\d+)/i);
  return match ? Number(match[1]) : 0;
}

function recordHandEvolution(player) {
  for (const item of player.hand ?? []) item.skyboundEvolutions = (Number(item.skyboundEvolutions) || 0) + 1;
}

function skyboundCountForInstance(ctx) {
  return (Number(ctx.player?.personalTurn) || 0) + (Number(ctx.instance?.skyboundEvolutions) || 0);
}

export function inspectPlayableModes(card, { pp = 0, boardSize = 0, spellboost = 0, costDelta = 0 } = {}) {
  const inst = {
    uid: "inspect-mode",
    card,
    spellboost: Number(spellboost) || 0,
    costDelta: Number(costDelta) || 0,
    attackBonus: 0,
    defenseBonus: 0,
    skyboundEvolutions: 0,
    x: initialX(card)
  };
  const player = {
    pp: Math.max(0, Number(pp) || 0),
    board: Array.from({ length: Math.max(0, Number(boardSize) || 0) }, (_, index) => ({ uid: `inspect-${index}`, type: "Follower" }))
  };
  return modes(inst, player).map(mode => ({ kind: mode.kind, cost: mode.cost, modeIndex: mode.modeIndex ?? 0 }));
}



function normStrategy(strategy) {
  return {
    style: strategy?.style ?? "midrange",
    label: strategy?.label ?? "Baseline",
    mulliganMaxCost: Number(strategy?.mulliganMaxCost ?? 3),
    faceBias: clamp(Number(strategy?.faceBias ?? .5), 0, 1),
    tradeBias: clamp(Number(strategy?.tradeBias ?? .5), 0, 1),
    priorities: Array.isArray(strategy?.priorities) ? strategy.priorities : []
  };
}

function mulligan(player, rng, stats, index, frames, players, record) {
  const out = player.hand.filter(item => shouldMulligan(item, player));
  if (!out.length) return;
  const ids = new Set(out.map(item => item.uid));
  player.hand = player.hand.filter(item => !ids.has(item.uid));
  const replacements = [];
  while (replacements.length < out.length && player.deck.length) replacements.push(player.deck.shift());
  player.hand.push(...replacements);
  player.deck.push(...out);
  shuffle(player.deck, rng);
  snap(frames, players, { round: 0, active: index, phase: "mulligan", action: `${player.name} redraws ${out.length} opening card${out.length === 1 ? "" : "s"}.` }, stats, record);
}

function shouldMulligan(item, player) {
  const card = item.card;
  const cost = Math.max(0, Number(card.cost) || 0);
  const text = norm(card.text);
  const style = String(player.strategy?.style ?? "midrange");
  const maxCost = Math.max(1, Number(player.strategy?.mulliganMaxCost ?? 3));

  if (style === "aggro") {
    if (cost <= 2) return false;
    if (cost >= 4) return true;
  }
  if ((style === "buff-tempo" || style === "puppetry-tempo") && cost <= 2) return false;
  if (style === "ramp" && /maximum play points/.test(text) && cost <= 4) return false;
  if (style === "spell-combo" && cost <= 3 && (card.type === "Spell" || /draw|spellboost/.test(text))) return false;
  if ((style === "ward-control" || style === "control") && cost <= 3 && (has(card, "Ward") || /draw|restore .*leader/.test(text))) return false;

  if (cost > maxCost + 1) return true;
  if (cost > maxCost && !/draw|maximum play points/.test(text)) return true;
  return false;
}

function drawCards(player, amount, stats, index) {
  let drawn = 0;
  for (let i = 0; i < amount; i += 1) {
    if (!player.deck.length) {
      if (player.mjerrabaineVictoryOnEmpty) {
        player.specialVictory = true;
        break;
      }
      player.deckOut = true;
      break;
    }
    const item = player.deck.shift();
    stats.draws[index] += 1;
    drawn += 1;
    if (player.hand.length >= 9) {
      toCemetery(player, item, false);
      stats.cardsBurned[index] += 1;
    } else player.hand.push(item);
    applyHavencraftDrawTriggers(player, item);
  }
  return drawn;
}

// [[battle-ai-v1-extra-pp]]
// [[battle-ai-v1-1-extra-pp-profile]]
function useBonusPpIfUseful(player, opponent) {
  if (!player.bonusPpAvailable) return false;

  const current = bestImmediateTurnAction(player, opponent);
  const currentPp = player.pp;
  const currentSpend = estimateTurnSpend(player, currentPp);

  player.pp = currentPp + 1;
  const boosted = bestImmediateTurnAction(player, opponent);
  const boostedSpend = estimateTurnSpend(player, currentPp + 1);
  player.pp = currentPp;

  if (!boosted) return false;

  const style = String(player.strategy?.style ?? "midrange");
  const control = style === "ward-control" || style === "control";
  const tempo = style === "puppetry-tempo" || style === "buff-tempo";
  const aggro = style === "aggro";
  const currentScore = Number(current?.score ?? -Infinity);
  const boostedScore = Number(boosted.score ?? -Infinity);
  const improvement = boostedScore - currentScore;
  const curveUpgrade = boostedSpend > currentSpend;
  const firstChargeDeadline = player.personalTurn === 5 && player.bonusPpUses === 0;
  const laterCharge = player.personalTurn >= 6 && player.bonusPpUses >= 1;
  const enemyBoard = opponent.board.filter(unit => unit.type === "Follower");
  const boostedText = norm(boosted?.mode?.text || boosted?.instance?.card?.text || boosted?.text || "");
  const boostedCard = boosted?.instance?.card ?? boosted?.unit?.card ?? null;
  const rampUnlock = style === "ramp" && /maximum play points/.test(boostedText);
  const controlUnlock = control && (/destroy|banish|draw|restore .*leader/.test(boostedText) || has(boostedCard ?? {}, "Ward"));
  const earlyEmptyCurve = !current && player.personalTurn <= 3;

  // Going second should not automatically burn its scarce extra-PP charge just
  // to fill an otherwise empty early curve. Ramp/control save it for a real
  // engine, answer or defensive breakpoint.
  if (earlyEmptyCurve && (style === "ramp" || control) && !rampUnlock && !controlUnlock && enemyBoard.length < 2) return false;

  let threshold = 1.5;
  if (aggro) threshold = 1.0;
  else if (tempo) threshold = 1.65;
  else if (style === "spell-combo") threshold = 1.75;
  else if (style === "ramp") threshold = 1.25;
  else if (control) threshold = 3.0;

  // The second charge is strategically scarcer: tempo/control decks should not
  // fire it just because a slightly more expensive card became available.
  if (laterCharge) {
    if (tempo) threshold += 0.75;
    if (control) threshold += 1.5;
  }

  const clearUpgrade = !current || improvement >= threshold;
  const tacticalPressure = enemyBoard.length > 0 && improvement >= (control ? 2.5 : tempo ? 1.25 : 0.75);
  const lethalPressure = opponent.hp <= 8 && improvement > 0;
  const deadlineSpend = firstChargeDeadline && curveUpgrade && (!control || improvement >= -0.25);

  const shouldUse = clearUpgrade || tacticalPressure || lethalPressure || deadlineSpend;
  if (!shouldUse) return false;

  player.pp = currentPp + 1;
  player.bonusPpAvailable = false;
  player.bonusPpUses += 1;
  return true;
}

function bestImmediateTurnAction(player, opponent) {
  const play = bestPlay(player, opponent);
  const engage = bestEngage(player, opponent);
  if (!engage) return play;
  if (!play) return engage;
  return engage.score > play.score ? engage : play;
}


// [[battle-ai-full-turn-planner-v1]]
function fuseRequirement(inst) {
  const match = String(inst?.card?.text ?? "").match(/^\s*Fuse\s*:\s*([^\n]+)/im);
  return match ? match[1].trim() : "";
}

function hasTrait(card, trait) {
  const wanted = norm(trait);
  return (card?.traits ?? []).some(value => norm(value) === wanted);
}

function isFuseMaterial(target, material) {
  if (!target || !material || target.uid === material.uid) return false;
  const requirement = norm(fuseRequirement(target));
  const card = material.card;
  if (!requirement || !card) return false;
  if (requirement === "forestcraft cards") return norm(card.class) === "forestcraft";
  if (requirement === "artifact amulets") return card.type === "Amulet" && hasTrait(card, "Artifact");
  if (requirement === "artifact cards") return hasTrait(card, "Artifact");
  if (requirement === "loot cards") return hasTrait(card, "Loot");
  if (requirement.includes("ominous artifact β") || requirement.includes("ominous artifact γ")) {
    const name = norm(card.name);
    return name === "ominous artifact β" || name === "ominous artifact γ";
  }
  return false;
}

function materialHoldValue(item, player) {
  const card = item.card;
  const text = norm(card?.text);
  let value = 1 + Math.max(0, Number(card?.cost) || 0) * .55;
  if (/draw|add .* to your hand/.test(text)) value += 1.25;
  if (/destroy|banish|return .*enemy follower|damage to .*enemy follower/.test(text)) value += 1.75;
  if (/restore .*leader/.test(text)) value += 1.25;
  if (has(card ?? {}, "Storm")) value += 1.75;
  if (has(card ?? {}, "Ward")) value += .8;
  if (card?.type === "Follower") value += (Math.max(0, Number(card.attack) || 0) + Math.max(0, Number(card.defense) || 0)) * .08;
  if ((player.hand?.length ?? 0) >= 8) value -= 1.5;
  else if ((player.hand?.length ?? 0) >= 7) value -= .6;
  return Math.max(.15, value);
}

function enumerateSubsets(items, maxSize = 4) {
  const source = items.slice(0, 8);
  const out = [];
  const limit = 1 << source.length;
  for (let mask = 1; mask < limit; mask += 1) {
    const subset = [];
    for (let index = 0; index < source.length; index += 1) if (mask & (1 << index)) subset.push(source[index]);
    if (subset.length <= maxSize) out.push(subset);
  }
  return out;
}

function candidateFuseMaterialSets(target, eligible, player) {
  const name = norm(target.card?.name);
  if (!eligible.length) return [];
  if (name === "gear of ambition" || name === "gear of remembrance" || name === "garden's allure" || name === "returning slash") {
    return eligible.map(item => [item]);
  }
  if (name === "ominous artifact α") {
    const fused = new Set((target.fusedNames ?? []).map(norm));
    const beta = eligible.filter(item => norm(item.card.name) === "ominous artifact β" && !fused.has("ominous artifact β"));
    const gamma = eligible.filter(item => norm(item.card.name) === "ominous artifact γ" && !fused.has("ominous artifact γ"));
    const sets = [...beta.map(item => [item]), ...gamma.map(item => [item])];
    if (beta.length && gamma.length) sets.push([beta[0], gamma[0]]);
    return sets.length ? sets : eligible.map(item => [item]);
  }
  if (name === "striker artifact" || name === "fortifier artifact") {
    const byTier = new Map();
    for (const subset of enumerateSubsets(eligible, 4)) {
      const total = subset.reduce((sum, item) => sum + Math.max(0, Number(item.card.cost) || 0), 0);
      const tier = total <= 1 ? 1 : total === 2 ? 2 : 3;
      const penalty = subset.reduce((sum, item) => sum + materialHoldValue(item, player), 0);
      const previous = byTier.get(tier);
      if (!previous || penalty < previous.penalty) byTier.set(tier, { subset, penalty });
    }
    return [...byTier.values()].map(entry => entry.subset);
  }
  if (name === "sinciro, heir to usurpation") {
    const sets = enumerateSubsets(eligible, 4)
      .map(subset => ({
        subset,
        distinct: new Set(subset.map(item => norm(item.card.name))).size,
        penalty: subset.reduce((sum, item) => sum + materialHoldValue(item, player), 0)
      }))
      .sort((a, b) => b.distinct - a.distinct || a.penalty - b.penalty);
    const bestByDistinct = new Map();
    for (const entry of sets) if (!bestByDistinct.has(entry.distinct)) bestByDistinct.set(entry.distinct, entry.subset);
    return [...bestByDistinct.values()].slice(0, 4);
  }
  return eligible.map(item => [item]);
}

function projectedFuseTransformName(target, materials) {
  const name = norm(target.card?.name);
  if (name === "gear of ambition") return "Striker Artifact";
  if (name === "gear of remembrance") return "Fortifier Artifact";
  if (name === "striker artifact" || name === "fortifier artifact") {
    const total = materials.reduce((sum, item) => sum + Math.max(0, Number(item.card.cost) || 0), 0);
    return total <= 1 ? "Ominous Artifact α" : total === 2 ? "Ominous Artifact β" : "Ominous Artifact γ";
  }
  if (name === "ominous artifact α") {
    const names = new Set([...(target.fusedNames ?? []).map(norm), ...materials.map(item => norm(item.card.name))]);
    if (names.has("ominous artifact β") && names.has("ominous artifact γ")) return "Masterwork Artifact Ω";
  }
  return null;
}

function scoreFuseAction(target, materials, player, opponent) {
  const name = norm(target.card?.name);
  const materialPenalty = materials.reduce((sum, item) => sum + materialHoldValue(item, player), 0);
  const fusedBefore = new Set((target.fusedNames ?? []).map(norm));
  const fusedAfter = new Set([...fusedBefore, ...materials.map(item => norm(item.card.name))]);
  const transform = projectedFuseTransformName(target, materials);
  let score = -materialPenalty;

  if (name === "gear of ambition" || name === "gear of remembrance") score += 11;
  else if (name === "striker artifact" || name === "fortifier artifact") {
    const handNames = new Set(player.hand.map(item => norm(item.card.name)));
    if (transform && !handNames.has(norm(transform))) score += 11;
    else score += 7;
    if (transform === "Ominous Artifact γ") score += 1;
  } else if (name === "ominous artifact α") {
    const adds = [...fusedAfter].filter(value => !fusedBefore.has(value)).length;
    score += adds * 5;
    if (transform === "Masterwork Artifact Ω") score += 32;
  } else if (name === "garden's allure") score += (target.fusedCards?.length ?? 0) ? 1 : 7;
  else if (name === "returning slash") score += (target.fusedCards?.length ?? 0) ? 1 : 6;
  else if (name === "sinciro, heir to usurpation") {
    const newDistinct = [...fusedAfter].filter(value => !fusedBefore.has(value)).length;
    score += newDistinct * 4.5;
    if (player.maxPp >= 5 || player.personalTurn >= 5) score += newDistinct * 1.25;
  }

  const cannons = player.board.filter(unit => norm(unit.name) === "ancient cannon").length;
  if (cannons && opponent.board.some(unit => unit.type === "Follower")) score += cannons * 2.5;
  const congregants = player.board.filter(unit => norm(unit.name) === "congregant of usurpation").length;
  const lootCount = materials.filter(item => hasTrait(item.card, "Loot")).length;
  if (congregants && lootCount) score += congregants * lootCount * 2.75;
  if ((player.hand?.length ?? 0) >= 8) score += materials.length * 1.2;
  return score;
}

function getFuseActions(player, opponent, cardMap) {
  const actions = [];
  for (const target of player.hand) {
    if (!fuseRequirement(target) || target.fusedThisTurn) continue;
    const eligible = player.hand.filter(item => isFuseMaterial(target, item));
    for (const materials of candidateFuseMaterialSets(target, eligible, player)) {
      if (!materials.length) continue;
      actions.push({
        kind: "fuse",
        target,
        targetName: target.card.name,
        materials,
        score: scoreFuseAction(target, materials, player, opponent),
        projectedTransform: projectedFuseTransformName(target, materials)
      });
    }
  }
  return actions.sort((a, b) => b.score - a.score || a.materials.length - b.materials.length);
}

function bestFuse(player, opponent, cardMap) {
  const best = getFuseActions(player, opponent, cardMap)[0] ?? null;
  return best && best.score > 1.25 ? best : null;
}

function transformHandInstance(inst, nextCard) {
  if (!inst || !nextCard) return false;
  inst.card = nextCard;
  inst.spellboost = 0;
  inst.costDelta = 0;
  inst.attackBonus = 0;
  inst.defenseBonus = 0;
  inst.skyboundEvolutions = 0;
  inst.fusedCards = [];
  inst.fusedNames = [];
  // A transformation creates a new Fuse card. This enables the official Gear ->
  // Artifact -> Ominous chain in one turn while still enforcing once/turn on
  // non-transforming Fuse cards.
  inst.fusedThisTurn = false;
  inst.x = initialX(nextCard);
  return true;
}

function applyFuseReactiveEffects(player, opponent, materials, playerIndex, enemyIndex, stats, rng, cardMap, actions) {
  const ctx = { player, opponent, playerIndex, enemyIndex, stats, rng, cardMap };
  for (const cannon of player.board.filter(unit => unit.type === "Amulet" && norm(unit.name) === "ancient cannon")) {
    const candidates = opponent.board.filter(unit => unit.type === "Follower");
    if (!candidates.length) continue;
    const target = candidates[Math.floor(rng() * candidates.length)];
    damageUnit(target, 2, opponent, player, ctx, actions);
    actions.push(`${cannon.name}: 2 damage to ${target.name}`);
  }

  const lootMaterials = materials.filter(item => hasTrait(item.card, "Loot"));
  for (const congregant of player.board.filter(unit => unit.type === "Follower" && norm(unit.name) === "congregant of usurpation")) {
    for (const material of lootMaterials) {
      const candidates = opponent.board.filter(unit => unit.type === "Follower");
      if (!candidates.length) break;
      const target = candidates[Math.floor(rng() * candidates.length)];
      damageUnit(target, 3, opponent, player, ctx, actions);
      actions.push(`${congregant.name}: 3 damage after Fusing ${material.card.name}`);
      actions.push(...cleanup(opponent, player, enemyIndex, playerIndex, stats, rng, cardMap));
    }
  }
}

function applyLootPlayedTrigger(player, opponent, card, playerIndex, enemyIndex, stats, rng, cardMap, actions) {
  if (!hasTrait(card, "Loot")) return;
  const ctx = { player, opponent, playerIndex, enemyIndex, stats, rng, cardMap };
  for (const congregant of player.board.filter(unit => unit.type === "Follower" && norm(unit.name) === "congregant of usurpation")) {
    const candidates = opponent.board.filter(unit => unit.type === "Follower");
    if (!candidates.length) continue;
    const target = candidates[Math.floor(rng() * candidates.length)];
    damageUnit(target, 3, opponent, player, ctx, actions);
    actions.push(`${congregant.name}: 3 damage after playing ${card.name}`);
  }
}

function resolveFuseAction(action, player, opponent, playerIndex, enemyIndex, stats, rng, cardMap) {
  const actions = [];
  const target = player.hand.find(item => item.uid === action.target.uid);
  if (!target || target.fusedThisTurn) return { actions: ["Fuse unavailable"], applied: false };
  const materials = action.materials
    .map(material => player.hand.find(item => item.uid === material.uid))
    .filter(material => material && isFuseMaterial(target, material));
  if (!materials.length) return { actions: ["No valid Fuse materials"], applied: false };

  const materialIds = new Set(materials.map(item => item.uid));
  player.hand = player.hand.filter(item => !materialIds.has(item.uid));
  target.fusedThisTurn = true;
  target.fusedCards = [...(target.fusedCards ?? []), ...materials.map(item => ({
    id: Number(item.card.id), name: item.card.name, cost: Number(item.card.cost) || 0,
    class: item.card.class, type: item.card.type, traits: [...(item.card.traits ?? [])]
  }))];
  target.fusedNames = [...new Set([...(target.fusedNames ?? []), ...materials.map(item => item.card.name)])];
  target.x = target.fusedNames.length;
  player.fusedCards.push(...materials.map(item => ({ uid: item.uid, card: item.card })));
  stats.cardsFused[playerIndex] += materials.length;
  actions.push(`Fuse ${materials.length} card${materials.length === 1 ? "" : "s"}`);

  applyFuseReactiveEffects(player, opponent, materials, playerIndex, enemyIndex, stats, rng, cardMap, actions);
  // [[battle-swordcraft-loot-fuse-crest]]
  if (materials.some(item => hasTrait(item.card, "Loot"))) {
    applySwordcraftLootCrestEvent(player, opponent, playerIndex, enemyIndex, stats, rng, cardMap, actions, "Fuse");
  }

  const nextName = projectedFuseTransformName(target, materials);
  if (nextName) {
    const nextCard = findByName(cardMap, nextName);
    if (nextCard) {
      const before = target.card.name;
      transformHandInstance(target, nextCard);
      actions.push(`${before} transforms into ${nextCard.name}`);
    }
  }
  actions.push(...cleanup(opponent, player, enemyIndex, playerIndex, stats, rng, cardMap));
  return { actions: uniq(actions), applied: true };
}

export function inspectFuseSequence({ cards = [], handNames = [], deckNames = [], boardNames = [], opponentBoard = [], steps = [], strategy = {} } = {}) {
  const cardMap = new Map(cards.map(card => [Number(card.id), card]));
  prepareOriginalCardMap(cardMap);
  const rng = createRng("inspect-fuse-sequence");
  const player = makePlayer("You", [], strategy, cardMap, rng);
  const opponent = makePlayer("Opponent", [], {}, cardMap, rng);
  player.isActive = true;
  player.personalTurn = 6;
  player.maxPp = 10;
  player.pp = 10;
  const addNamed = (zone, name) => {
    const card = findByName(cardMap, name);
    if (!card) throw new Error(`Unknown card: ${name}`);
    zone.push(instance(player, card));
  };
  for (const name of handNames) addNamed(player.hand, name);
  for (const name of deckNames) addNamed(player.deck, name);
  for (const name of boardNames) {
    const card = findByName(cardMap, name);
    if (!card) throw new Error(`Unknown board card: ${name}`);
    const inst = instance(player, card);
    player.board.push(card.type === "Follower" ? boardFollower(inst) : boardAmulet(inst));
  }
  for (const spec of opponentBoard) {
    const card = spec.cardName ? findByName(cardMap, spec.cardName) : {
      id: -1000 - opponent.board.length, name: spec.name ?? "Enemy", type: "Follower", cost: 1,
      attack: Number(spec.attack) || 0, defense: Number(spec.defense) || 1, text: "", keywords: [...(spec.keywords ?? [])], traits: []
    };
    const inst = instance(opponent, card);
    const unit = boardFollower(inst);
    unit.attack = Number(spec.attack ?? unit.attack) || 0;
    unit.defense = Number(spec.defense ?? unit.defense) || 1;
    unit.maxDefense = unit.defense;
    opponent.board.push(unit);
  }
  const stats = createStats();
  const log = [];
  const takeMaterials = (target, names) => {
    const used = new Set();
    return names.map(name => {
      const found = player.hand.find(item => item.uid !== target.uid && !used.has(item.uid) && norm(item.card.name) === norm(name));
      if (found) used.add(found.uid);
      return found;
    }).filter(Boolean);
  };
  for (const step of steps) {
    if (step.type === "next-turn") {
      player.personalTurn += 1;
      for (const item of player.hand) item.fusedThisTurn = false;
      log.push({ type: "next-turn" });
      continue;
    }
    if (step.type === "fuse" || step.type === "ai-fuse") {
      let action = null;
      if (step.type === "ai-fuse") action = bestFuse(player, opponent, cardMap);
      else {
        const target = player.hand.find(item => norm(item.card.name) === norm(step.target));
        if (target) action = { target, targetName: target.card.name, materials: takeMaterials(target, step.materials ?? []), score: 0 };
      }
      const result = action ? resolveFuseAction(action, player, opponent, 0, 1, stats, rng, cardMap) : { actions: ["Fuse unavailable"], applied: false };
      log.push({ type: "fuse", applied: Boolean(result.applied), actions: result.actions });
      continue;
    }
    if (step.type === "play") {
      const inst = player.hand.find(item => norm(item.card.name) === norm(step.card));
      const mode = inst ? modes(inst, player)[0] : null;
      const result = inst && mode ? playCard(inst, mode, player, opponent, 0, 1, stats, rng, cardMap) : { actions: ["Play unavailable"] };
      log.push({ type: "play", card: step.card, actions: result.actions });
    }
  }
  return {
    hand: player.hand.map(item => ({ name: item.card.name, fusedThisTurn: Boolean(item.fusedThisTurn), fusedNames: [...(item.fusedNames ?? [])], fusedCount: item.fusedCards?.length ?? 0 })),
    board: player.board.map(unit => ({ name: unit.name, attack: unit.attack, defense: unit.defense })),
    opponentHp: opponent.hp,
    opponentBoard: opponent.board.map(unit => ({ name: unit.name, attack: unit.attack, defense: unit.defense })),
    shadows: player.shadows,
    fusedZone: player.fusedCards.map(item => item.card.name),
    stats,
    log
  };
}

function hasBlockedBoardDevelopment(player) {
  if (player.board.length < 5) return false;
  const pp = Math.max(0, Number(player.pp) || 0);
  return player.hand.some(item => {
    if (item.card.type === "Spell") return false;
    if (costOf(item) <= pp) return true;
    const text = String(item.card.text ?? "");
    return [...text.matchAll(/Enhance\s*\(?\s*(\d+)\s*\)?\s*:/gi)].some(match => Number(match[1]) <= pp);
  });
}

function estimateTurnSpend(player, budget) {
  const previousPp = player.pp;
  player.pp = Math.max(0, Number(budget) || 0);
  const options = player.hand.map(item => {
    const available = modes(item, player);
    if (!available.length) return [];
    return [...new Set(available.map(mode => Number(mode.cost) || 0))].filter(cost => cost <= player.pp);
  });
  player.pp = previousPp;

  // Small 0/1 knapsack over hand cards. This intentionally estimates PP usage,
  // not tactical value; bestImmediateTurnAction handles tactical quality.
  const reachable = new Set([0]);
  for (const costs of options) {
    const before = [...reachable];
    for (const spent of before) {
      for (const cost of costs) {
        const total = spent + cost;
        if (total <= budget) reachable.add(total);
      }
    }
  }
  return Math.max(...reachable);
}

function getModesForHand(player) {
  const out = [];
  for (const item of player.hand) for (const mode of modes(item, player)) out.push({ instance: item, mode });
  return out;
}





function scoredPlayOptions(player, opponent, includeContinuation = true) {
  return getModesForHand(player)
    .flatMap(item => expandPlayTargetBranches(item, opponent))
    .map(item => ({ ...item, score: scorePlay(item, player, opponent, includeContinuation) }))
    .sort((a,b)=>b.score-a.score || b.mode.cost-a.mode.cost || String(a.targetPlan?.enemyUid ?? "").localeCompare(String(b.targetPlan?.enemyUid ?? "")));
}

function bestPlay(player, opponent) {
  const options = scoredPlayOptions(player, opponent, true);
  const best = options[0] ?? null;
  if (!best) return null;
  return best.score > scorePassDecision(player, opponent) ? best : null;
}

// Public QA hook for deterministic AI-policy tests. It intentionally only sees
// public board/leader state; look-ahead never reads the opponent hand or deck.
export function inspectAiPlayChoice({
  hand = [], pp = 0, maxPp = pp, hp = 20, maxHp = 20, personalTurn = 1,
  strategy = {}, board = [], opponentHp = 20, opponentBoard = [],
  goingFirst = false, goingSecond = false, bonusPpAvailable = false,
  rally = 0, shadows = 0, earthSigils = 0
} = {}) {
  const toUnit = (unit, index, side) => ({
    uid: unit.uid ?? `${side}-${index}`,
    type: "Follower",
    name: unit.name ?? unit.card?.name ?? `Follower ${index + 1}`,
    card: unit.card ?? {
      name: unit.name ?? `Follower ${index + 1}`,
      text: unit.text ?? "",
      keywords: [...(unit.keywords ?? [])]
    },
    attack: Math.max(0, Number(unit.attack) || 0),
    defense: Math.max(0, Number(unit.defense) || 0),
    maxDefense: Math.max(0, Number(unit.maxDefense ?? unit.defense) || 0),
    keywords: [...(unit.keywords ?? unit.card?.keywords ?? [])],
    aura: Boolean(unit.aura) || (unit.keywords ?? unit.card?.keywords ?? []).some(keyword => norm(keyword) === "aura"),
    ambush: Boolean(unit.ambush) || (unit.keywords ?? unit.card?.keywords ?? []).some(keyword => norm(keyword) === "ambush"),
    intimidate: Boolean(unit.intimidate) || (unit.keywords ?? unit.card?.keywords ?? []).some(keyword => norm(keyword) === "intimidate"),
    permanentAttackLock: Boolean(unit.permanentAttackLock),
    evolved: Boolean(unit.evolved),
    superEvolved: Boolean(unit.superEvolved)
  });
  const player = {
    strategy: normStrategy(strategy), pp: Math.max(0, Number(pp) || 0), maxPp: Math.max(0, Number(maxPp) || 0),
    hp: Number(hp) || 0, maxHp: Math.max(1, Number(maxHp) || 20), personalTurn: Math.max(1, Number(personalTurn) || 1),
    goingFirst: Boolean(goingFirst), goingSecond: Boolean(goingSecond), bonusPpAvailable: Boolean(bonusPpAvailable),
    rally: Math.max(0, Number(rally) || 0), shadows: Math.max(0, Number(shadows) || 0), earthSigils: Math.max(0, Number(earthSigils) || 0),
    cardsPlayedThisTurn: 0,
    board: board.map((unit, index) => toUnit(unit, index, "ally")),
    hand: hand.map((card, index) => ({
      uid: `inspect-hand-${index}`, card, spellboost: 0, costDelta: 0,
      attackBonus: 0, defenseBonus: 0, skyboundEvolutions: 0, x: initialX(card)
    }))
  };
  const opponent = {
    hp: Number(opponentHp) || 0,
    board: opponentBoard.map((unit, index) => toUnit(unit, index, "enemy"))
  };
  const options = scoredPlayOptions(player, opponent, true);
  const best = options[0] ?? null;
  const passScore = scorePassDecision(player, opponent);
  const selected = best && best.score > passScore ? best : null;
  return {
    decision: selected ? "play" : "pass",
    cardName: selected?.instance?.card?.name ?? null,
    mode: selected?.mode?.kind ?? null,
    targetName: selected?.targetPlan?.enemyName ?? null,
    targetKind: selected?.targetPlan?.kind ?? null,
    score: selected ? selected.score : passScore,
    bestPlayScore: best?.score ?? null,
    passScore,
    projectedIncomingDamage: estimateVisibleIncomingDamage(player, opponent)
  };
}

export function inspectRandomEnemyTargets(board = [], seeds = []) {
  const units = board.map((unit, index) => ({
    uid: unit.uid ?? `random-${index}`,
    type: "Follower",
    name: unit.name ?? `Follower ${index + 1}`,
    attack: Math.max(0, Number(unit.attack) || 0),
    defense: Math.max(1, Number(unit.defense) || 1),
    card: { name: unit.name ?? `Follower ${index + 1}`, text: unit.text ?? "", keywords: [...(unit.keywords ?? [])] },
    keywords: [...(unit.keywords ?? [])],
    aura: Boolean(unit.aura), ambush: Boolean(unit.ambush)
  }));
  return seeds.map(seed => chooseRandomTarget(units, createRng(String(seed)))?.name ?? null);
}

function scorePassDecision(player, opponent) {
  const incoming = estimateVisibleIncomingDamage(player, opponent);
  const margin = (Number(player.hp) || 0) - incoming;
  const style = String(player.strategy?.style ?? "midrange");
  let score = 3.8;

  if (margin <= 0) return -20;
  if (margin <= 3) score = -5;
  else if (margin <= 6) score = 1.5;

  if (style === "aggro") score -= 1.5;
  else if (style === "buff-tempo" || style === "puppetry-tempo") score -= .5;
  else if (style === "control" || style === "ward-control" || style === "spell-combo") score += 1;

  // Passing with a nearly full hand risks burning the next draw, so the AI is
  // increasingly willing to spend a merely adequate card instead of hoarding.
  if ((player.hand?.length ?? 0) >= 8) score -= 3;
  else if ((player.hand?.length ?? 0) >= 7) score -= 1;

  return score;
}

function estimateVisibleIncomingDamage(player, opponent) {
  const attackers = opponent.board
    .filter(unit => unit.type === "Follower" && canThreatenLeaderNextTurn(unit))
    .map(unit => ({ attack: Math.max(0, Number(unit.attack) || 0), bane: hasU(unit, "Bane") }))
    .filter(unit => unit.attack > 0)
    .sort((a,b)=>b.attack-a.attack);

  const wards = player.board
    .filter(unit => unit.type === "Follower" && hasU(unit, "Ward") && !unit.ambush && !unit.intimidate)
    .map(unit => ({ defense: Math.max(1, Number(unit.defense) || 1) }))
    .sort((a,b)=>a.defense-b.defense);

  while (attackers.length && wards.length) {
    const attacker = attackers.shift();
    const ward = wards[0];
    ward.defense -= attacker.attack;
    if (attacker.bane || ward.defense <= 0) wards.shift();
  }
  return attackers.reduce((sum, unit) => sum + unit.attack, 0);
}

function canThreatenLeaderNextTurn(unit) {
  if (!unit || unit.type !== "Follower" || unit.permanentAttackLock) return false;
  const text = norm(unit.card?.text ?? "");
  if (/can'?t attack (?:followers or leaders|leaders)/.test(text)) return false;
  return (Number(unit.attack) || 0) > 0;
}

function projectedSurvivalAfterPlay(item, player, opponent) {
  const card = item.instance.card;
  const text = norm(item.mode.text || card.text);
  const projectedPlayer = { ...player, board: player.board.map(unit => ({ ...unit, keywords: [...(unit.keywords ?? [])] })) };
  const projectedOpponent = { ...opponent, board: opponent.board.map(unit => ({ ...unit, keywords: [...(unit.keywords ?? [])] })) };
  let projectedHp = Number(player.hp) || 0;

  const heal = Number(text.match(/restore\s+(\d+)\s+defense to your leader/i)?.[1] ?? 0);
  if (heal > 0) projectedHp = Math.min(Number(player.maxHp) || 20, projectedHp + heal);

  const enemyFollowers = projectedOpponent.board.filter(unit => unit.type === "Follower");
  const allRemoval = /(?:destroy|banish|return)[^.]*all enemy followers/.test(text);
  const planned = item.targetPlan?.enemyUid ? enemyFollowers.find(unit => unit.uid === item.targetPlan.enemyUid) : null;
  if (allRemoval) {
    projectedOpponent.board = projectedOpponent.board.filter(unit => unit.type !== "Follower");
  } else if (planned && ["destroy", "banish", "return"].includes(item.targetPlan.kind)) {
    projectedOpponent.board = projectedOpponent.board.filter(unit => unit !== planned);
  } else if (planned && item.targetPlan.kind === "damage") {
    const damage = Math.max(0, Number(item.targetPlan.amount) || 0);
    if (!(Number(planned.barrier) > 0) && damage >= (Number(planned.defense) || 0)) projectedOpponent.board = projectedOpponent.board.filter(unit => unit !== planned);
  } else if (/(?:destroy|banish|return)[^.]*enemy follower/.test(text) && enemyFollowers.length) {
    const target = [...enemyFollowers].sort((a,b)=>(Number(b.attack)||0)-(Number(a.attack)||0))[0];
    projectedOpponent.board = projectedOpponent.board.filter(unit => unit !== target);
  } else {
    const damage = Number(text.match(/deal\s+(\d+)\s+damage to (?:an?|the selected )?enemy follower/i)?.[1] ?? 0);
    if (damage > 0) {
      const killable = enemyFollowers
        .filter(unit => (Number(unit.defense) || 0) <= damage)
        .sort((a,b)=>(Number(b.attack)||0)-(Number(a.attack)||0));
      if (killable.length) projectedOpponent.board = projectedOpponent.board.filter(unit => unit !== killable[0]);
    }
  }

  if (card.type === "Follower" && !["accelerate", "crystallize"].includes(item.mode.kind) && has(card, "Ward") && projectedPlayer.board.length < 5) {
    projectedPlayer.board.push({
      uid: "projected-ward", type: "Follower", card, name: card.name,
      attack: Math.max(0, Number(card.attack) || 0),
      defense: Math.max(1, Number(card.defense) || 1),
      keywords: [...(card.keywords ?? [])], ambush: false, intimidate: false
    });
  }

  return {
    hp: projectedHp,
    incoming: estimateVisibleIncomingDamage(projectedPlayer, projectedOpponent)
  };
}

function survivalLookaheadValue(item, player, opponent) {
  const beforeIncoming = estimateVisibleIncomingDamage(player, opponent);
  const beforeMargin = (Number(player.hp) || 0) - beforeIncoming;
  const after = projectedSurvivalAfterPlay(item, player, opponent);
  const afterMargin = after.hp - after.incoming;
  const improvement = afterMargin - beforeMargin;
  const card = item.instance.card;
  const text = norm(item.mode.text || card.text);
  const defensive = /destroy|banish|return .*enemy follower|damage to .*enemy follower|restore .*leader/.test(text) || has(card, "Ward");

  let score = improvement * .8;
  if (beforeMargin <= 0 && afterMargin > 0) score += 18;
  else if (beforeMargin <= 3 && afterMargin > beforeMargin) score += 8;
  else if (beforeMargin <= 6 && improvement > 0) score += 3;

  if (beforeMargin <= 0 && !defensive) score -= 8;
  if (beforeMargin >= 8 && defensive && improvement <= 0) score -= 1.5;
  return score;
}

function timingLookaheadValue(item, player, opponent) {
  const card = item.instance.card;
  const raw = String(card.text ?? "");
  const text = norm(item.mode.text || raw);
  const incoming = estimateVisibleIncomingDamage(player, opponent);
  const urgent = incoming >= Math.max(1, (Number(player.hp) || 0) - 3);
  let score = 0;

  // If the same card gains an Enhance mode next turn, preserve it when the
  // current board is safe instead of spending the weaker base body/effect now.
  if (!urgent && (item.mode.kind === "base" || item.mode.kind === "mode")) {
    const enhanceCosts = [...raw.matchAll(/Enhance\s*\(?\s*(\d+)\s*\)?\s*:/gi)].map(match => Number(match[1]));
    const nextBudget = Math.min(10, (Number(player.maxPp) || 0) + 1) + (player.goingSecond && player.bonusPpAvailable ? 1 : 0);
    const reachableNext = enhanceCosts.filter(cost => cost > (Number(player.pp) || 0) && cost <= nextBudget).sort((a,b)=>a-b)[0];
    if (reachableNext) score -= 5.5;
  }

  if (!urgent && canUseClassMechanic(player, "overflow", card) && /if overflow is active/.test(norm(raw)) && (Number(player.maxPp) || 0) === 6) score -= 2.5;

  const rallyNeed = Number(raw.match(/Rally\s*\(?\s*(\d+)\s*\)?\s*:/i)?.[1] ?? 0);
  if (!urgent && canUseClassMechanic(player, "rally", card) && rallyNeed > 0 && (Number(player.rally) || 0) < rallyNeed && rallyNeed - (Number(player.rally) || 0) <= 2) score -= 1.5;

  const necroNeed = Number(raw.match(/Necromancy\s*\(?\s*(\d+)\s*\)?\s*[-–—:]/i)?.[1] ?? 0);
  if (!urgent && canUseClassMechanic(player, "necromancy", card) && necroNeed > 0 && (Number(player.shadows) || 0) < necroNeed) score -= 1.5;

  // Purely contextual cards should not be dumped just because PP is available.
  if (!urgent && /restore .*leader/.test(text) && (Number(player.hp) || 0) >= (Number(player.maxHp) || 20)) score -= 1.5;
  return score;
}

function scorePlay(item, player, opponent, includeContinuation = true) {
  const card = item.instance.card;
  const text = norm(item.mode.text || card.text);
  const cost = item.mode.cost;
  const style = String(player.strategy?.style ?? "midrange");
  const foes = opponent.board.filter(unit => unit.type === "Follower");
  const boardSlots = Math.max(0, 5 - player.board.length);
  const handAfterPlay = Math.max(0, player.hand.length - 1);
  let score = 1 + cost * 1.15 + item.mode.scoreBonus;

  if (card.type === "Follower" && !["accelerate","crystallize"].includes(item.mode.kind)) score += 2.2;
  if (item.mode.kind === "crystallize") score += player.personalTurn <= 3 ? 3 : -.5;

  if (/draw/.test(text)) {
    if (handAfterPlay >= 8) score -= 5;
    else if (handAfterPlay <= 4) score += 5;
    else score += 2;
  }

  if (/destroy|banish|damage to .*enemy follower/.test(text)) {
    score += foes.length ? 4 + Math.min(7, strongestFollowerThreat(foes) * .22) : -5;
  }
  if (/return .*enemy follower/.test(text)) score += foes.length ? 4 : -4;

  if (/enemy leader/.test(text) || has(card, "Storm")) score += opponent.hp <= 8 ? 10 : opponent.hp <= 12 ? 6 : 2;
  if (/restore .*leader/.test(text)) score += player.hp <= 8 ? 9 : player.hp <= 13 ? 5 : player.hp < player.maxHp ? 1 : -3;
  if (/maximum play points/.test(text)) score += style === "ramp" && player.maxPp < 7 ? 13 : player.maxPp < 5 ? 4 : 0;

  if (/summon/.test(text)) score += boardSlots >= 2 ? 3 : boardSlots === 1 ? .5 : -6;
  if (has(card, "Ward")) score += (style === "ward-control" || style === "control") ? (player.hp <= 10 ? 3 : .75) : .5;

  if (style === "aggro") {
    if (cost <= 3) score += 3;
    if (has(card, "Storm") || /enemy leader/.test(text)) score += 2;
  }
  if (style === "buff-tempo" && /give .*\+\d+\/\+\d+|buff/.test(text)) score += 3;
  if (style === "puppetry-tempo" && /puppet|puppetry|summon/.test(text)) score += 2.5;
  if (style === "spell-combo" && (card.type === "Spell" || item.mode.kind === "accelerate")) score += 5;
  if (/select a mode/i.test(card.text)) score += 1.5;

  score += targetBranchValue(item.targetPlan, opponent);
  score += timingLookaheadValue(item, player, opponent);
  score += survivalLookaheadValue(item, player, opponent);
  if (includeContinuation) score += continuationValue(item, player, opponent);
  if (cost === player.pp) score += .6;
  return score;
}

function continuationValue(item, player, opponent) {
  const remaining = Math.max(0, (Number(player.pp) || 0) - (Number(item.mode.cost) || 0));
  if (!remaining) return 0;
  const previousPp = player.pp;
  const previousHand = player.hand;
  player.pp = remaining;
  player.hand = player.hand.filter(other => other.uid !== item.instance.uid);
  let bestFollowUp = null;
  let followUpPass = 0;
  try {
    bestFollowUp = scoredPlayOptions(player, opponent, false)[0] ?? null;
    followUpPass = scorePassDecision(player, opponent);
  } finally {
    player.pp = previousPp;
    player.hand = previousHand;
  }
  if (bestFollowUp && bestFollowUp.score > followUpPass) {
    return Math.min(4, Math.max(.5, (bestFollowUp.score - followUpPass) * .35));
  }
  return remaining >= 2 ? -.75 : -.15;
}

function strongestFollowerThreat(foes) {
  return foes.reduce((best, unit) => Math.max(best,
    Math.max(0, Number(unit.attack) || 0) * 2.5
      + Math.max(0, Number(unit.defense) || 0)
      + (hasU(unit, "Ward") ? 2 : 0)
      + (hasU(unit, "Bane") ? 2 : 0)
  ), 0);
}

function playCard(inst, mode, player, opponent, playerIndex, enemyIndex, stats, rng, cardMap, options = {}) {
  // [[battle-swordcraft-pre-entry-rally]]
  const rallyBeforePlay = Number(player.rally) || 0;
  player.hand = player.hand.filter(item => item.uid !== inst.uid);
  player.pp -= mode.cost;
  player.cardsPlayedThisTurn += 1;
  stats.cardsPlayed[playerIndex] += 1;
  stats.ppSpent[playerIndex] += mode.cost;
  const card = inst.card;
  const playedWithChangedCost = card.type === "Follower" && costOf(inst) !== Math.max(0, Number(card.cost) || 0);
  const milteoCrest = card.type === "Follower" && hasCrest(player, "Milteo & Luzen");
  const actions = [];
  let source = null;

  if (mode.kind === "crystallize") {
    source = boardAmulet(inst, mode.text, true);
    player.board.push(source);
  } else if (mode.kind !== "accelerate") {
    if (card.type === "Follower") {
      source = boardFollower(inst);
      player.board.push(source);
      player.rally += 1;
      actions.push(...applyEntryEvents({ player, opponent, playerIndex, enemyIndex, stats, rng, cardMap }, source));
    } else if (card.type === "Amulet") {
      source = boardAmulet(inst);
      player.board.push(source);
      if ((card.traits ?? []).includes("Earth Sigil") && canUseClassMechanic(player, "earthRite", card)) player.earthSigils += 1;
    }
  }

  // [[battle-abysscraft-mode-selection-event]]
  if (!milteoCrest && Number(mode.selectedModeCount) > 0) {
    actions.push(...recordAbyssModeSelection(player, Number(mode.selectedModeCount)));
  }

  // [[battle-enhance-play-event]]
  if (!milteoCrest && (mode.enhanced || mode.kind === "enhance")) {
    actions.push(...applyEnhancedCardPlayed({ card, instance: inst, sourceUnit: source, player, opponent, playerIndex, enemyIndex, stats, rng, cardMap }));
  }

  // "Whenever you play ..." triggers from the play event itself.
  applyLootPlayedTrigger(player, opponent, card, playerIndex, enemyIndex, stats, rng, cardMap, actions);
  // [[battle-swordcraft-loot-play-crest]]
  if (hasTrait(card, "Loot")) applySwordcraftLootCrestEvent(player, opponent, playerIndex, enemyIndex, stats, rng, cardMap, actions, "play");
  // [[battle-runecraft-play-triggers]]
  applyRunecraftCardPlayedTriggers(player, opponent, card, playerIndex, stats, actions);

  if (mode.kind !== "crystallize" && !milteoCrest) {
    const result = resolveText(mode.text || card.text, { card, instance: inst, sourceUnit: source, player, opponent, playerIndex, enemyIndex, stats, rng, cardMap, targetPlan: options.targetPlan ?? null, rallyBeforePlay });
    actions.push(...result.actions);
  }

  // [[battle-abysscraft-milteo-play-evolve]]
  if (milteoCrest && source?.type === "Follower") {
    evolveUnitByAbility({ player, opponent, playerIndex, enemyIndex, stats, rng, cardMap }, source, actions);
  }

  // [[battle-runecraft-institute-trigger]]
  applyInstituteChangedCostTrigger(player, opponent, card, playedWithChangedCost, playerIndex, enemyIndex, stats, rng, cardMap, actions);

  // [[battle-forestcraft-yuel-play-trigger]]
  if (source?.type === "Follower" && mode.kind !== "accelerate" && mode.kind !== "crystallize") {
    actions.push(...applyForestFollowerPlayedCrest({ card, instance: inst, sourceUnit: source, player, opponent, playerIndex, enemyIndex, stats, rng, cardMap }));
  }

  if (card.type === "Spell" || mode.kind === "accelerate") {
    stats.spellsPlayed[playerIndex] += 1;
    player.spellsPlayedThisTurn += 1;
    toCemetery(player, inst, true);
    spellboostHand(player, 1, cardMap, actions);
    const beforeHp = player.hp;
    actions.push(...applySpellPlayedEffects(effectContext({ card, instance: inst, sourceUnit: source, player, opponent, playerIndex, enemyIndex, stats, rng, cardMap })));
    if (player.hp > beforeHp) actions.push(...afterLeaderHeal(player, player.hp - beforeHp, stats, playerIndex));
    // [[battle-swordcraft-spell-play-trigger]]
    actions.push(...applySwordcraftSpellPlayedTriggers(player, opponent, playerIndex, enemyIndex, stats, rng, cardMap));
    // [[battle-portalcraft-spell-play-trigger]]
    actions.push(...applyPortalcraftSpellPlayedTriggers({ card, player, opponent, playerIndex, enemyIndex, stats, rng, cardMap }));
  }

  // [[battle-neutral-card-play-trigger]]
  actions.push(...applyNeutralCardPlayedTriggers({ card, sourceUnit: source, player, opponent, playerIndex, enemyIndex, stats, rng, cardMap }));

  actions.push(...cleanup(player, opponent, playerIndex, enemyIndex, stats, rng, cardMap), ...cleanup(opponent, player, enemyIndex, playerIndex, stats, rng, cardMap));
  return { actions };
}

// [[battle-enhance-play-helper]]
function applyEnhancedCardPlayed(ctx) {
  const actions = [];
  const player = ctx.player;
  // [[battle-swordcraft-majestic-enhanced-trigger]]
  if (hasCrest(player, "Majestic Conquest")) {
    const token = findByName(ctx.cardMap, "Fearless Soldier");
    if (token && player.board.length < 5) {
      const before = new Set(player.board.map(unit => unit.uid));
      summonWithEvents(player, token, 1, ctx.playerIndex, ctx);
      const summoned = player.board.find(unit => !before.has(unit.uid) && norm(unit.name) === "fearless soldier");
      if (summoned) {
        ctx.stats.cardsGenerated[ctx.playerIndex] += 1;
        actions.push("Majestic Conquest Crest: summon Fearless Soldier");
      }
    }
  }
  if (player.faithActive) {
    player.faith += 1;
    actions.push(`Faith +1 (${player.faith})`);
  }
  const stacks = Math.max(0, Number(player.faithEnhanceBuffs) || 0);
  if (!stacks) return actions;
  const context = effectContext(ctx);
  for (const unit of player.board.filter(unit => unit.type === "Follower")) {
    const before = { attack: unit.attack, defense: unit.defense };
    context.buffUnit(unit, stacks, stacks);
    actions.push(`Faith: +${stacks}/+${stacks} ${unit.name}`);
    if ((Number(unit.attack) || 0) <= before.attack && (Number(unit.defense) || 0) <= before.defense) continue;
  }
  return uniq(actions);
}







// [[battle-havencraft-final-full-rules]]
function isSpellboostRecipient(card) {
  return isSpellboostRecipientCard(card);
}

export function inspectSpellboostBoundary(cards, { handNames = [], amount = 1 } = {}) {
  const map = new Map((cards ?? []).map(card => [Number(card.id), card]));
  const byName = name => [...map.values()].find(card => norm(card.name) === norm(name));
  const player = { name: "Spellboost Inspector", nextSerial: 0, hand: [] };
  player.hand = handNames.map(name => byName(name)).filter(Boolean).map(card => instance(player, card));
  spellboostHand(player, Math.max(0, Number(amount) || 0), map, []);
  return player.hand.map(item => ({ name: item.card.name, class: item.card.class, spellboost: Number(item.spellboost) || 0, x: Number(item.x) || 0 }));
}

function spellboostHand(player, amount, cardMap, actions = []) {
  for (let count = 0; count < amount; count += 1) {
    for (const inst of player.hand) {
      if (!canUseClassMechanic(player, "spellboost", inst.card)) continue;
      if (!isSpellboostRecipient(inst.card)) continue;
      inst.spellboost = (Number(inst.spellboost) || 0) + 1;
      const text = section(inst.card.text, "on spellboost");
      if (!text) continue;
      const xIncrease = Number(text.match(/Increase X by\s*(\d+)/i)?.[1] ?? 0);
      if (xIncrease) inst.x = (Number(inst.x) || 0) + xIncrease;
      const stat = text.match(/give this follower\s*\+(\d+)\s*\/\s*\+(\d+)/i);
      if (stat) {
        inst.attackBonus = (Number(inst.attackBonus) || 0) + Number(stat[1]);
        inst.defenseBonus = (Number(inst.defenseBonus) || 0) + Number(stat[2]);
      }
      const threshold = Number(text.match(/if X is at least\s*(\d+)/i)?.[1] ?? Infinity);
      if (inst.x >= threshold && /transform this card into/i.test(text)) {
        const name = text.match(/transform this card into (?:an?\s+)?(.+?)(?:\.|$)/i)?.[1]?.trim();
        const target = name ? findByName(cardMap, name) : null;
        if (target) inst.card = target;
      }
    }
  }
}

function reanimate(player, cost, index, cardMap, rng) {
  const pool = player.destroyedFollowers.filter(item => (Number(item.card.cost) || 0) <= cost);
  if (!pool.length || player.board.length >= 5) return null;
  const max = Math.max(...pool.map(item => Number(item.card.cost) || 0));
  const eligible = pool.filter(item => (Number(item.card.cost) || 0) === max);
  const source = eligible[Math.floor(rng() * eligible.length)];
  const inst = instance(player, source.card);
  const unit = boardFollower(inst);
  unit.keywords = uniq([...unit.keywords, "Departed"]);
  player.board.push(unit);
  player.rally += 1;
  return unit;
}

function related(card, map) {
  const ids = new Set([...(card?.relatedCards ?? []).map(Number), ...(card?.relations ?? []).map(relation => Number(relation.id))]);
  return [...ids].map(id => map.get(id)).filter(Boolean);
}

function findByName(map, name) {
  const target = norm(name);
  return [...map.values()].find(card => norm(card.name) === target) ?? null;
}

function summonRaw(player, card, amount) {
  const out = [];
  for (let index = 0; index < amount && player.board.length < 5; index += 1) {
    const inst = instance(player, card);
    if (card.type === "Follower") {
      const unit = boardFollower(inst);
      player.board.push(unit);
      player.rally += 1;
      out.push(unit);
    } else if (card.type === "Amulet") {
      const unit = boardAmulet(inst);
      player.board.push(unit);
      out.push(unit);
    } else break;
  }
  return out;
}

function summonWithEvents(player, card, amount, index, ctx) {
  const units = summonRaw(player, card, amount);
  const local = player === ctx.player
    ? ctx
    : { ...ctx, player, opponent: ctx.player, playerIndex: ctx.enemyIndex, enemyIndex: ctx.playerIndex };
  // [[battle-runecraft-summon-entry-events]]
  // Entry effects are game state, not optional replay text. Always execute them;
  // only buffering their action strings is optional.
  for (const unit of units) {
    if (unit.type !== "Follower") continue;
    const entryActions = applyEntryEvents(local, unit);
    if (entryActions.length) ctx.__sideActions?.push?.(...entryActions);
  }
  return units.length;
}

// [[battle-deck-summon-primitives]]
function summonFromDeckDifferentNames(ctx, limit, predicate) {
  const summoned = [];
  const usedNames = new Set();
  while (summoned.length < Number(limit) && ctx.player.board.length < 5) {
    const eligible = ctx.player.deck.filter(item => {
      if (item.card.type !== "Follower") return false;
      if (usedNames.has(norm(item.card.name))) return false;
      return !predicate || predicate(item.card);
    });
    if (!eligible.length) break;
    const chosen = eligible[Math.floor(ctx.rng() * eligible.length)];
    ctx.player.deck = ctx.player.deck.filter(item => item.uid !== chosen.uid);
    usedNames.add(norm(chosen.card.name));
    const unit = boardFollower(chosen);
    ctx.player.board.push(unit);
    ctx.player.rally += 1;
    summoned.push(unit);
    ctx.__sideActions?.push?.(`summon ${unit.name} from deck`, ...applyEntryEvents(ctx, unit));
  }
  return summoned;
}

function summonWithoutLastWords(ctx, card) {
  if (!card || ctx.player.board.length >= 5) return null;
  const inst = instance(ctx.player, card);
  const unit = boardFollower(inst);
  unit.overrideText = String(card.text ?? "")
    .replace(/Last Words\s*:\s*[\s\S]*?(?=(?:Super-Evolve|Evolve|Strike|Clash|Fanfare|Enhance|Accelerate|Engage|At the start of your turn|At the end of your turn)\s*:|$)/i, " ")
    .replace(/\s+/g, " ")
    .trim();
  ctx.player.board.push(unit);
  ctx.player.rally += 1;
  ctx.__sideActions?.push?.(`summon ${unit.name} without Last Words`, ...applyEntryEvents(ctx, unit));
  return unit;
}

function addHand(player, card, amount, index, stats) {
  let count = 0;
  for (let i = 0; i < amount; i += 1) {
    const item = instance(player, card);
    if (player.hand.length >= 9) {
      toCemetery(player, item, false);
      stats.cardsBurned[index] += 1;
    } else { player.hand.push(item); count += 1; }
  }
  return count;
}



function giveKeyword(unit, keyword) {
  if (!unit.keywords.includes(keyword)) unit.keywords.push(keyword);
  if (keyword === "Barrier") unit.barrier = 1;
  if (keyword === "Aura") unit.aura = true;
  if (keyword === "Ambush") unit.ambush = true;
  if (keyword === "Intimidate") unit.intimidate = true;
  if (keyword === "Storm" && !unit.yuriusAttackLocked) { unit.canAttackLeader = true; unit.canAttackFollower = true; }
  if (keyword === "Rush" && !unit.yuriusAttackLocked) unit.canAttackFollower = true;
}

function applyEntryEvents(ctx, unit) {
  if (!unit || unit.type !== "Follower") return [];
  const actions = [];
  const beforeHp = ctx.player.hp;
  actions.push(...applyEntryCrestEffects(effectContext(ctx), unit));
  if (ctx.player.hp > beforeHp) actions.push(...afterLeaderHeal(ctx.player, ctx.player.hp - beforeHp, ctx.stats, ctx.playerIndex));

  // [[battle-swordcraft-enemy-entry-events]]
  actions.push(...applySwordcraftEnemyEntryEvents(ctx, unit));
  // [[battle-forestcraft-entry-events]]
  actions.push(...applyForestEntryEvents(ctx, unit));
  // [[battle-runecraft-entry-events]]
  actions.push(...applyRunecraftEntryEvents(ctx, unit));
  // [[battle-dragoncraft-entry-events]]
  actions.push(...applyDragoncraftEntryEvents(ctx, unit));
  // [[battle-abysscraft-entry-events]]
  actions.push(...applyAbysscraftEntryEvents(ctx, unit));
  // [[battle-portalcraft-entry-events]]
  actions.push(...applyPortalcraftEntryEvents(ctx, unit));

  if ((unit.card?.traits ?? []).some(trait => norm(trait) === "marine") && hasCrest(ctx.player, "Neptune, Arbiter of Tides")) {
    const healed = healPlayer(ctx.player, 1, ctx.stats, ctx.playerIndex);
    actions.push(`Neptune Crest: restore ${healed} leader defense`);
    if (healed) actions.push(...afterLeaderHeal(ctx.player, healed, ctx.stats, ctx.playerIndex));
  }

  const selfEntry = String(unit.card?.text ?? "").match(/\bwhen this (?:card|follower) enters the field,\s*([^.]*)\.?/i);
  // Congregant's exact-copy entry is resolved recursively by the Forest entry
  // primitive so each copy can become the source of the next exact copy.
  if (selfEntry && norm(unit.name) !== "congregant of unkilling") {
    const result = resolveText(selfEntry[1], { ...ctx, card: unit.card, sourceUnit: unit });
    actions.push(...result.actions.map(action => `${unit.name}: ${action}`));
  }
  return uniq(actions);
}

function applyFollowerDamagedEvents(unit, owner, opponent, ctx, actions) {
  reactDamage(unit, owner, opponent, ctx, actions);
  if (!owner.isActive || unit.defense <= 0) return;
  // [[battle-dragoncraft-survivor-damage-events]]
  const dragonOwnerIndex = owner === ctx.player ? ctx.playerIndex : ctx.enemyIndex;
  const dragonEnemyIndex = owner === ctx.player ? ctx.enemyIndex : ctx.playerIndex;
  if (norm(unit.name) === "devotee of disdain") {
    const drawn = drawMatchingCard(owner, card => card.type === "Follower" && norm(card.class) === "dragoncraft", ctx.stats, dragonOwnerIndex, ctx.rng);
    actions.push(`Devotee of Disdain: draw ${drawn ? drawn.card.name : "no Dragoncraft follower"}`);
  }
  if (norm(unit.name) === "azurifrit, heir to disdain") {
    const targetLeader = owner === ctx.player ? ctx.opponent : ctx.player;
    const dealt = damageLeader(targetLeader, 1);
    ctx.stats.damageDealt[dragonOwnerIndex] += dealt;
    actions.push(`Azurifrit: ${dealt} damage to enemy leader`);
  }
  const crest = (owner.crests ?? []).find(item => norm(item.name) === "galmieux, ardor manifest");
  if (!crest || crest.__damageTriggerTurn === owner.personalTurn) return;
  const token = related(crest.card, ctx.cardMap).find(card => norm(card.name) === "fangs of ardent destruction") ?? findByName(ctx.cardMap, "Fangs of Ardent Destruction");
  if (!token) return;
  crest.__damageTriggerTurn = owner.personalTurn;
  const ownerIndex = owner === ctx.player ? ctx.playerIndex : ctx.enemyIndex;
  if (addHand(owner, token, 1, ownerIndex, ctx.stats)) {
    ctx.stats.cardsGenerated[ownerIndex] += 1;
    actions.push(`Galmieux Crest: add ${token.name}`);
  }
}

function afterLeaderHeal(player, healed, stats, playerIndex) {
  if (!player.isActive) return [];
  const actions = [];
  if (healed && player.__havencraftRuntime) {
    const ctx = player.__havencraftRuntime;
    const fox = findByName(ctx.cardMap, "Fox of Purity");
    for (const source of [...player.board].filter(unit => unit.type === "Follower" && norm(unit.name) === "saint of rehabilitation")) {
      if (!fox || player.board.length >= 5) break;
      const count = summonWithEvents(player, fox, 1, playerIndex, ctx);
      actions.push(`Saint of Rehabilitation: summon ${count ? "Fox of Purity" : "no follower"}`);
    }
  }
  if (player.__burniteFlameHealActionTurn === player.personalTurn) {
    player.__burniteFlameHealActionTurn = -1;
    actions.push("Burnite Flame Crest: 1 damage to your leader after healing");
  }
  if (!healed) return actions;
  const crest = (player.crests ?? []).find(item => norm(item.name) === "burnite, anathema of ash");
  if (!crest || crest.__healTriggerTurn === player.personalTurn) return actions;
  crest.__healTriggerTurn = player.personalTurn;
  player.hp -= 1;
  actions.push("Burnite Ash Crest: 1 damage to your leader after healing");
  return actions;
}

function applyCrestTurnStartOrdered(player, opponent, playerIndex, enemyIndex, stats, rng, map) {
  const actions = [];
  for (const crest of [...(player.crests ?? [])]) {
    const name = norm(crest.name);
    actions.push(...applyPortalcraftPreTickCrestTurnStart(player, opponent, playerIndex, enemyIndex, stats, rng, map, crest));
    actions.push(...applyAbysscraftCrestTurnStart(player, opponent, playerIndex, enemyIndex, stats, rng, map, crest));
    actions.push(...applyForestCrestTurnStart(player, opponent, playerIndex, enemyIndex, stats, rng, map, crest));
    actions.push(...applyRunecraftCrestTurnStart(player, opponent, playerIndex, enemyIndex, stats, rng, map, crest));
    if (name === "burnite, anathema of ash") {
      player.hp -= 2;
      actions.push("Burnite Ash Crest: 2 damage to your leader");
    }
    if (name === "burnite, anathema of flame") {
      player.hp -= 1;
      actions.push("Burnite Flame Crest: 1 damage to your leader");
    }
  }
  return actions;
}

function turnStart(player, opponent, playerIndex, enemyIndex, stats, rng, map) {
  const actions = [];
  bindHavencraftRuntime(player, opponent, playerIndex, enemyIndex, stats, rng, map);
  for (const unit of player.board) if (unit.type === "Follower") unit.reactedThisTurn = false;
  // [[battle-swordcraft-yurius-turn-lock]]
  applySwordcraftTurnStartLocks(player);

  // [[battle-crest-ordered-turn-start]]
  actions.push(...applyCrestTurnStartOrdered(player, opponent, playerIndex, enemyIndex, stats, rng, map));
  tickCrests(player, opponent, playerIndex, enemyIndex, stats, rng, map, actions);

  for (const amulet of [...player.board].filter(unit => unit.type === "Amulet" && Number.isFinite(unit.countdown))) {
    amulet.countdown -= 1;
    actions.push(`${amulet.name} countdown ${Math.max(0, amulet.countdown)}`);
    if (amulet.countdown <= 0) actions.push(...destroyObject(player, opponent, amulet, playerIndex, enemyIndex, stats, rng, map, true));
  }

  invokeCards(player, opponent, playerIndex, enemyIndex, stats, rng, map, actions);
  for (const unit of [...player.board]) {
    const text = getUnitTriggeredText(unit, "turnStart");
    if (text) {
      const result = resolveText(text, { card: unit.card, sourceUnit: unit, player, opponent, playerIndex, enemyIndex, stats, rng, cardMap: map });
      actions.push(...result.actions.map(action => `${unit.name}: ${action}`));
    }
  }
  actions.push(...cleanup(player, opponent, playerIndex, enemyIndex, stats, rng, map), ...cleanup(opponent, player, enemyIndex, playerIndex, stats, rng, map));
  return actions;
}

function tickCrests(player, opponent, playerIndex, enemyIndex, stats, rng, map, actions) {
  const expired = [];
  for (const crest of player.crests ?? []) {
    if (!Number.isFinite(crest.countdown)) continue;
    if ((Number(crest.gainedTurn) || 0) >= player.personalTurn) continue;
    crest.countdown -= 1;
    actions.push(`${crest.name} Crest countdown ${Math.max(0, crest.countdown)}`);
    if (crest.countdown <= 0) expired.push(crest);
  }
  if (!expired.length) return;

  const expiredSet = new Set(expired);
  player.crests = (player.crests ?? []).filter(crest => !expiredSet.has(crest));

  // [[battle-haven-lapis-crest-last-words]]
  for (const crest of expired) {
    // [[battle-forestcraft-crest-last-words]]
    if (forestcraftCrestLastWords(crest, player, opponent, playerIndex, enemyIndex, stats, rng, map, actions)) continue;
    // [[battle-swordcraft-crest-last-words]]
    if (swordcraftCrestLastWords(crest, player, opponent, playerIndex, enemyIndex, stats, rng, map, actions)) continue;
    // [[battle-runecraft-crest-last-words]]
    if (runecraftCrestLastWords(crest, player, opponent, playerIndex, enemyIndex, stats, rng, map, actions)) continue;
    // [[battle-dragoncraft-crest-last-words]]
    if (dragoncraftCrestLastWords(crest, player, opponent, playerIndex, enemyIndex, stats, rng, map, actions)) continue;
    // [[battle-abysscraft-crest-last-words]]
    if (abysscraftCrestLastWords(crest, player, opponent, playerIndex, enemyIndex, stats, rng, map, actions)) continue;
    // [[battle-neutral-crest-last-words]]
    if (neutralCrestLastWords(crest, player, opponent, playerIndex, enemyIndex, stats, rng, map, actions)) continue;
    // [[battle-havencraft-final-crest-last-words]]
    if (havencraftCrestLastWords(crest, player, opponent, playerIndex, enemyIndex, stats, rng, map, actions)) continue;
    if (norm(crest.name) !== "lapis, shining seraph") continue;
    if (player.board.length >= 5) {
      actions.push("Lapis Crest: field full, summon skipped");
      continue;
    }
    const card = crest.card ?? findByName(map, "Lapis, Shining Seraph");
    if (!card) continue;
    const unit = boardFollower(instance(player, card));
    giveKeyword(unit, "Storm");
    player.board.push(unit);
    player.rally += 1;
    actions.push(`Lapis Crest: summon ${unit.name} with Storm`);
    actions.push(...applyEntryEvents({ player, opponent, playerIndex, enemyIndex, stats, rng, cardMap: map }, unit));
  }
}

function turnEnd(player, opponent, playerIndex, enemyIndex, stats, rng, map) {
  const actions = [];
  // [[battle-high-risk-marked-turn-end]]
  for (const [owner, other, ownerIndex, otherIndex] of [[player, opponent, playerIndex, enemyIndex], [opponent, player, enemyIndex, playerIndex]]) {
    for (const unit of [...owner.board].filter(unit => unit.type === "Follower" && unit.highRiskLymagaEndTurnCurse)) {
      damageLeader(owner, 1);
      damageUnit(unit, 2, owner, other, { player: other, opponent: owner, playerIndex: otherIndex, enemyIndex: ownerIndex, stats, rng, cardMap: map }, actions);
      actions.push(`Lymaga curse: 1 leader + 2 ${unit.name}`);
    }
  }
  for (const unit of [...player.board].filter(unit => unit.type === "Follower" && unit.highRiskDestroyAtOwnTurnEnd)) {
    actions.push(...destroyObject(player, opponent, unit, playerIndex, enemyIndex, stats, rng, map, true));
    actions.push(`delayed own-turn destroy ${unit.name}`);
  }
  actions.push(...highRiskHandTurnEndTriggers(player));
  for (const unit of [...player.board]) {
    const text = getUnitTriggeredText(unit, "turnEnd");
    if (text) {
      const result = resolveText(text, { card: unit.card, sourceUnit: unit, player, opponent, playerIndex, enemyIndex, stats, rng, cardMap: map });
      actions.push(...result.actions.map(action => `${unit.name}: ${action}`));
    } else {
      // [[battle-dragoncraft-follower-turn-end]]
      actions.push(...applyDragoncraftFollowerTurnEnd({ player, opponent, playerIndex, enemyIndex, stats, rng, cardMap: map }, unit));
    }
  }
  actions.push(...applyCrestTurnEnd(player, opponent, playerIndex, enemyIndex, stats, rng, map));
  // [[battle-high-risk-opponent-turn-expiry]]
  highRiskRestoreOpponentHandCosts(player);
  highRiskApplyEndOpponentTurnDestruction(opponent);
  // [[battle-portalcraft-temp-cost-expiry]]
  restorePortalcraftTemporaryCosts(player);
  // [[battle-dragoncraft-temp-cost-expiry]]
  restoreDragoncraftTemporaryCosts(player);
  // [[battle-runecraft-opponent-turn-end-crest]]
  actions.push(...applyRunecraftOpponentTurnEndCrests(opponent, player, enemyIndex, playerIndex, stats, rng, map));
  restoreTemporaryAttack(player);
  // Temporary Commander buffs can also be created during the opponent's turn by summoned Officers.
  restoreTemporaryAttack(opponent);
  // [[battle-swordcraft-yurius-lock-expiry]]
  clearSwordcraftTurnLocks(player);
  // [[battle-neutral-illamrita-end-banish]]
  actions.push(...applyNeutralMarkedEndTurnBanish(player));
  // [[battle-havencraft-himeka-end-banish]]
  actions.push(...applyHavencraftMarkedEndTurnBanish(player));
  actions.push(...cleanup(player, opponent, playerIndex, enemyIndex, stats, rng, map), ...cleanup(opponent, player, enemyIndex, playerIndex, stats, rng, map));
  // [[battle-leader-cap-expiry]]
  if (opponent.leaderDamageCapUntilOpponentTurnEnd) {
    opponent.leaderDamageCap = null;
    opponent.leaderDamageCapUntilOpponentTurnEnd = false;
    actions.push("Leader damage prevention expired");
  }
  return actions;
}

function applyCrestTurnEnd(player, opponent, playerIndex, enemyIndex, stats, rng, map) {
  const actions = [];
  // [[battle-crest-lifecycle-order-v1]]
  for (const crest of [...(player.crests ?? [])]) {
    actions.push(...applyForestCrestTurnEnd(player, opponent, playerIndex, enemyIndex, stats, rng, map, crest));
    actions.push(...applySwordcraftCrestTurnEnd(player, opponent, playerIndex, enemyIndex, stats, rng, map, crest));
    actions.push(...applyRunecraftCrestTurnEnd(player, opponent, playerIndex, enemyIndex, stats, rng, map, crest));
    actions.push(...applyDragoncraftCrestTurnEnd(player, opponent, playerIndex, enemyIndex, stats, rng, map, crest));
    actions.push(...applyAbysscraftCrestTurnEnd(player, opponent, playerIndex, enemyIndex, stats, rng, map, crest));
    actions.push(...applyPortalcraftCrestTurnEnd(player, opponent, playerIndex, enemyIndex, stats, rng, map, crest));
    actions.push(...applyNeutralCrestTurnEnd(player, opponent, playerIndex, enemyIndex, stats, rng, map, crest));
    actions.push(...applyHavencraftCrestTurnEnd(player, opponent, playerIndex, enemyIndex, stats, rng, map, crest));
    const name = norm(crest.name);
    if (name === "grimnir, heavenly gale" && player.board.some(unit => unit.type === "Follower" && unit.superEvolved)) {
      const targets = opponent.board.filter(unit => unit.type === "Follower");
      const ctx = { player, opponent, playerIndex, enemyIndex, stats, rng, cardMap: map };
      for (const target of targets) damageUnit(target, 2, opponent, player, ctx, actions);
      if (targets.length) actions.push(`Grimnir Crest: 2 damage to ${targets.length} enemy follower${targets.length === 1 ? "" : "s"}`);
    }
    // [[battle-haven-supplicant-crest]]
    if (name === "supplicant of repose" && !player.followersAttackedThisTurn) {
      const healed = healPlayer(player, 1, stats, playerIndex);
      actions.push(`Supplicant Crest: restore ${healed} leader defense${healed ? "" : " (already full)"}`);
      if (healed) actions.push(...afterLeaderHeal(player, healed, stats, playerIndex));
    }
    if (name === "sandalphon, primarch successor") {
      const healed = healPlayer(player, 1, stats, playerIndex);
      let followerHealing = 0;
      for (const unit of player.board.filter(unit => unit.type === "Follower")) {
        const before = unit.defense;
        unit.defense = Math.min(unit.maxDefense, unit.defense + 1);
        followerHealing += Math.max(0, unit.defense - before);
      }
      actions.push(`Sandalphon Crest: restore 1 defense to all allies${healed || followerHealing ? "" : " (no damaged allies)"}`);
      if (healed) actions.push(...afterLeaderHeal(player, healed, stats, playerIndex));
    }
  }
  return actions;
}

function invokeCards(player, opponent, playerIndex, enemyIndex, stats, rng, map, actions) {
  for (const inst of [...player.deck]) {
    const text = String(inst.card.text ?? "");
    if (!/Invoke this card/i.test(text)) continue;
    const need = Number(text.match(/evolved at least\s*(\d+) times this match/i)?.[1] ?? Infinity);
    if (player.evolutionsThisMatch < need || player.board.length >= 5) continue;
    player.deck = player.deck.filter(item => item.uid !== inst.uid);
    const unit = boardFollower(inst);
    player.board.push(unit);
    player.rally += 1;
    actions.push(`Invoke ${unit.name}`);
    actions.push(...applyEntryEvents({ player, opponent, playerIndex, enemyIndex, stats, rng, cardMap: map }, unit));
    const after = text.match(/When this card is Invoked[, :]\s*([^]*?)(?:\n\n|Fanfare:|$)/i)?.[1] ?? "";
    if (after) {
      const result = resolveText(after, { card: unit.card, instance: inst, sourceUnit: unit, player, opponent, playerIndex, enemyIndex, stats, rng, cardMap: map });
      actions.push(...result.actions);
    }
    if (/return this card to your hand/i.test(after)) {
      // [[battle-cleanup-leave-hook]]
      notifyFollowerLeavesField(player, unit);
      player.board = player.board.filter(item => item.uid !== unit.uid);
      if (player.hand.length < 9) player.hand.push(inst);
    }
    break;
  }
}

function readyBoard(player) {
  for (const unit of player.board) {
    if (unit.type === "Follower") {
      if (unit.tempAttackPenalty) {
        unit.attack += unit.tempAttackPenalty;
        unit.tempAttackPenalty = 0;
      }
      unit.summonedThisTurn = false;
      const permanentlyLocked = /can't attack followers or leaders/i.test(String(unit.overrideText ?? unit.card?.text ?? ""));
      unit.canAttackLeader = !permanentlyLocked;
      unit.canAttackFollower = !permanentlyLocked;
      unit.attacked = false;
      unit.attacksMade = 0;
      unit.maxAttacks = unit.baseMaxAttacks ?? 1;
    } else if (unit.type === "Amulet") unit.engagedThisTurn = false;
  }
}

function engageInfo(unit) {
  const match = String(unit.card.text ?? "").match(/Engage\s*\(?\s*(\d+)?\s*\)?\s*:/i);
  return match ? { cost: Number(match[1] ?? 0), text: section(unit.card.text, `engage${match[1] ? ` ${match[1]}` : ""}`) } : null;
}

function bestEngage(player, opponent) {
  return player.board.filter(unit => unit.type === "Amulet" && !unit.engagedThisTurn)
    .map(unit => ({ unit, ...engageInfo(unit) }))
    .filter(item => item.text != null && item.cost <= player.pp)
    .map(item => ({ ...item, score: scoreEngage(item, player, opponent) }))
    .sort((a,b)=>b.score-a.score)[0] ?? null;
}

function scoreEngage(item, player, opponent) {
  const text = norm(item.text);
  const foes = opponent.board.filter(unit => unit.type === "Follower");
  let score = 1.5 - item.cost * .15;
  // [[battle-haven-griffon-engage-ai]]
  const dormantGriffons = player.board.filter(unit => unit.type === "Follower" && norm(unit.name) === "sacred griffon" && !hasU(unit, "Storm"));
  if (dormantGriffons.length) {
    const attack = Math.max(...dormantGriffons.map(unit => Math.max(0, Number(unit.attack) || 0)));
    score += 6 + attack * .8;
    if (!activeWards(opponent.board).length && opponent.hp <= attack) score += 40;
  }
  if (/draw/.test(text)) score += player.hand.length >= 8 ? -3 : player.hand.length <= 5 ? 5 : 2;
  if (/destroy|banish|damage/.test(text)) score += foes.length ? 4 + Math.min(5, strongestFollowerThreat(foes) * .18) : -4;
  if (/restore/.test(text)) score += player.hp <= 10 ? 6 : player.hp <= 15 ? 3 : -1;
  if (/summon/.test(text)) score += player.board.length <= 3 ? 4 : player.board.length === 4 ? 1 : -5;
  return score;
}

function resolveEngage(unit, player, opponent, playerIndex, enemyIndex, stats, rng, map) {
  const info = engageInfo(unit);
  if (!info) return { actions: [] };
  player.pp -= info.cost;
  stats.ppSpent[playerIndex] += info.cost;
  unit.engagedThisTurn = true;

  // [[battle-haven-griffon-engage]]
  const reactions = [];
  const engageCtx = { card: unit.card, sourceUnit: unit, player, opponent, playerIndex, enemyIndex, stats, rng, cardMap: map };
  reactions.push(...applyHavencraftEngageTriggers(engageCtx));
  for (const follower of player.board.filter(item => item.type === "Follower" && norm(item.name) === "sacred griffon")) {
    if (hasU(follower, "Storm")) continue;
    giveKeyword(follower, "Storm");
    reactions.push(`Sacred Griffon: gain Storm`);
  }

  const result = resolveText(info.text, { card: unit.card, sourceUnit: unit, player, opponent, playerIndex, enemyIndex, stats, rng, cardMap: map });
  return { ...result, actions: uniq([...reactions, ...(result.actions ?? [])]) };
}

// [[battle-ai-effect-aware-evolution-v1]]
function maybeEvolve(player, opponent, playerIndex, enemyIndex, stats, rng, map, options = {}) {
  if (player.evolutionActionUsed) return null;
  const normalTurn = player.goingFirst ? 5 : 4;
  const superTurn = player.goingFirst ? 7 : 6;
  const candidates = player.board.filter(unit => unit.type === "Follower" && !unit.evolved && !unit.superEvolved && !unit.attacked);
  if (!candidates.length) return null;

  const normalAvailable = player.personalTurn >= normalTurn && player.ep > 0;
  const superAvailable = player.personalTurn >= superTurn && player.sep > 0;
  if (!normalAvailable && !superAvailable) return null;

  const normalRanked = normalAvailable
    ? candidates.map(unit => ({ unit, score: scoreEvolutionCandidate(unit, player, opponent, false) })).sort((a, b) => b.score - a.score)
    : [];
  const superRanked = superAvailable
    ? candidates.map(unit => ({ unit, score: scoreEvolutionCandidate(unit, player, opponent, true) })).sort((a, b) => b.score - a.score)
    : [];

  const normalBest = normalRanked[0] ?? null;
  const superBest = superRanked[0] ?? null;
  const effectBest = Math.max(
    normalBest ? evolutionEffectValue(normalBest.unit, player, opponent, false) : -Infinity,
    superBest ? evolutionEffectValue(superBest.unit, player, opponent, true) : -Infinity
  );

  if (options.phase === "pre-development") {
    const style = String(player.strategy?.style ?? "midrange");
    const foeCount = opponent.board.filter(unit => unit.type === "Follower").length;
    const threshold = style === "ward-control" || style === "control" ? 7 : style === "aggro" ? 9 : 8;
    const highImpact = effectBest >= threshold;
    const urgentClear = foeCount >= 3 && effectBest >= 6;
    const crowdedSequence = player.board.length >= 4 && effectBest >= 7;
    if (!highImpact && !urgentClear && !crowdedSequence) return null;
  }

  const tacticalNeed = opponent.board.some(unit => unit.type === "Follower")
    || player.strategy.faceBias > .7
    || opponent.hp <= 10
    || effectBest >= 4;
  if (!tacticalNeed) return null;

  let choice = normalBest;
  let superMode = false;
  if (superBest) {
    if (!normalBest) {
      choice = superBest;
      superMode = true;
    } else {
      const style = String(player.strategy?.style ?? "midrange");
      const superText = getUnitTriggeredText(superBest.unit, "superEvolve");
      const superEffect = evolutionTextValue(superText, player, opponent, superBest.unit);
      let premium = 2.5;
      if (style === "aggro") premium = 1.25;
      else if (style === "puppetry-tempo" || style === "buff-tempo") premium = 2;
      else if (style === "ward-control" || style === "control") premium = 4;
      const urgent = opponent.hp <= Math.max(6, superBest.unit.attack + 3)
        || opponent.board.filter(unit => unit.type === "Follower").length >= 3;
      if (superBest.score >= normalBest.score + premium || (superEffect >= 7 && superBest.score > normalBest.score) || (urgent && superBest.score > normalBest.score + .5)) {
        choice = superBest;
        superMode = true;
      }
    }
  }
  if (!choice) return null;

  const result = executeEvolutionDecision(
    { player, opponent, playerIndex, enemyIndex, stats },
    { kind: "evolve", unitUid: choice.unit.uid, superMode, targetPlan: null },
    map,
    rng
  );
  return result.applied ? { super: superMode, action: result.action } : null;
}

function scoreEvolutionCandidate(unit, player, opponent, superMode) {
  const bonus = superMode ? 3 : 2;
  const foes = opponent.board.filter(item => item.type === "Follower");
  const postAttack = Math.max(0, Number(unit.attack) || 0) + bonus;
  let score = 1 + postAttack * .22 + Math.max(0, Number(unit.defense) || 0) * .06;

  const evolveText = getUnitTriggeredText(unit, "evolve");
  score += evolutionTextValue(evolveText, player, opponent, unit);
  if (superMode) {
    const superText = getUnitTriggeredText(unit, "superEvolve");
    score += evolutionTextValue(superText, player, opponent, unit);
    score += 1.25; // +1/+1 over a normal evolution and the Super-Evolve combat rider.
  }

  if (foes.length) {
    const killable = foes.some(target => !target.aura && !target.ambush && (postAttack >= target.defense || hasU(unit, "Bane")));
    score += killable ? 4 : 1;
    if (hasU(unit, "Bane")) score += 1.5;
  }

  if (hasU(unit, "Storm") && unit.canAttackLeader) {
    score += opponent.hp <= postAttack ? 12 : opponent.hp <= 10 ? 5 : 1.5;
  }
  if (/can't attack followers or leaders/i.test(String(unit.card?.text ?? ""))) score -= 3;
  if (hasU(unit, "Ward") && (player.strategy.style === "ward-control" || player.hp <= 10)) score += 1.5;
  return score;
}

function evolutionEffectValue(unit, player, opponent, superMode) {
  if (!unit) return 0;
  let value = evolutionTextValue(getUnitTriggeredText(unit, "evolve"), player, opponent, unit);
  if (superMode) value += evolutionTextValue(getUnitTriggeredText(unit, "superEvolve"), player, opponent, unit);
  return value;
}

function evolutionTextValue(textValue, player, opponent, unit) {
  const text = norm(textValue);
  if (!text) return 0;
  const foes = opponent.board.filter(item => item.type === "Follower");
  const allies = player.board.filter(item => item.type === "Follower" && item !== unit);
  let value = 0;

  if (/destroy|banish/.test(text)) value += foes.length ? 10 : -3;
  if (/return .*enemy follower/.test(text)) value += foes.length ? 7 : -2;

  const allDamage = text.match(/deal (\d+) damage to all enemy followers/);
  if (allDamage) value += foes.length ? Math.min(12, foes.length * Math.max(1, Number(allDamage[1])) * 1.35) : -2;
  const targetDamage = text.match(/deal (\d+) damage to .*enemy follower/);
  if (targetDamage && !allDamage) value += foes.length ? Math.min(8, Number(targetDamage[1]) * 1.5 + 2) : -2;

  if (/summon/.test(text)) value += player.board.length < 5 ? 6 : 0;
  if (/draw/.test(text)) value += player.hand.length <= 5 ? 5 : 2;
  if (/add .* to your hand/.test(text)) value += player.hand.length < 9 ? 3 : 0;
  if (/restore .*defense to your leader/.test(text)) value += player.hp <= 10 ? 6 : player.hp <= 15 ? 3 : .5;
  if (/give all .*allied followers|give all other allied followers/.test(text)) value += Math.min(7, allies.length * 2);
  if (/evolve another|evolve a random|super-evolve/.test(text)) value += allies.some(item => !item.evolved && !item.superEvolved) ? 6 : 1;
  if (/gain crest/.test(text)) value += 6;
  if (/barrier|aura/.test(text)) value += 2.5;
  if (/storm/.test(text)) value += opponent.hp <= 10 ? 5 : 2;
  if (/ward/.test(text)) value += player.hp <= 10 ? 3 : 1;
  return value;
}

// [[battle-ability-evolve-helper-v5]]
function evolveUnitByAbility(ctx, unit, actions) {
  if (!unit || unit.type !== "Follower" || unit.evolved || unit.superEvolved) return false;
  unit.attack += 2;
  unit.defense += 2;
  unit.maxDefense += 2;
  unit.canAttackFollower = !unit.yuriusAttackLocked && !/can't attack followers or leaders/i.test(String(unit.card?.text ?? ""));
  if (unit.yuriusAttackLocked || /can't attack followers or leaders/i.test(String(unit.card?.text ?? ""))) unit.canAttackLeader = false;
  unit.evolved = true;
  ctx.player.evolutionsThisMatch += 1;
  recordHandEvolution(ctx.player);
  ctx.stats.evolutions[ctx.playerIndex] += 1;
  actions.push(`evolve ${unit.name} by ability`);
  // [[battle-forestcraft-ability-evolve-event]]
  actions.push(...applyForestEvolutionTriggers(ctx, unit, false));
  const evolveText = getUnitTriggeredText(unit, "evolve");
  if (evolveText) actions.push(...resolveText(evolveText, { ...ctx, card: unit.card, sourceUnit: unit }).actions);
  actions.push(...cleanup(ctx.opponent, ctx.player, ctx.enemyIndex, ctx.playerIndex, ctx.stats, ctx.rng, ctx.cardMap));
  return true;
}

function superEvolveUnitByAbility(ctx, unit, actions) {
  if (unit.evolved || unit.superEvolved) return;
  unit.attack += 3;
  unit.defense += 3;
  unit.maxDefense += 3;
  unit.canAttackFollower = !unit.yuriusAttackLocked && !/can't attack followers or leaders/i.test(String(unit.card?.text ?? ""));
  if (unit.yuriusAttackLocked || /can't attack followers or leaders/i.test(String(unit.card?.text ?? ""))) unit.canAttackLeader = false;
  unit.evolved = true;
  unit.superEvolved = true;
  ctx.player.evolutionsThisMatch += 1;
  recordHandEvolution(ctx.player);
  ctx.stats.superEvolutions[ctx.playerIndex] += 1;
  // [[battle-high-risk-enemy-hand-ability-super-evolve-event]]
  actions.push(...highRiskEnemySuperEvolveHandTriggers(ctx.opponent));
  // [[battle-swordcraft-ability-super-evolve-event]]
  actions.push(...applySwordcraftSuperEvolveHandTriggers(ctx.player));
  // [[battle-dragoncraft-ability-super-evolve-event]]
  actions.push(...applyDragoncraftSuperEvolveHandTriggers(ctx.player, unit));
  // [[battle-havencraft-ability-super-evolve-event]]
  actions.push(...applyHavencraftSuperEvolveHandTriggers(ctx.player));
  // [[battle-abysscraft-ability-super-evolve-event]]
  actions.push(...applyAbysscraftSuperEvolveTriggers(ctx, unit));
  actions.push(`super-evolve ${unit.name}`);
  // [[battle-forestcraft-ability-super-evolve-event]]
  actions.push(...applyForestEvolutionTriggers(ctx, unit, true));
  const evolveText = getUnitTriggeredText(unit, "evolve");
  if (evolveText) actions.push(...resolveText(evolveText, { ...ctx, card: unit.card, sourceUnit: unit }).actions);
  const superText = getUnitTriggeredText(unit, "superEvolve");
  if (superText) actions.push(...resolveText(superText, { ...ctx, card: unit.card, sourceUnit: unit }).actions);
}

function attackPhase(player, opponent, playerIndex, enemyIndex, stats, frames, players, round, rng, map, record, options = {}) {
  const setupOnly = Boolean(options.setupOnly);
  let attackGuard = 0;
  while (attackGuard++ < MAX_ACTIONS) {
    if (setupOnly && player.board.length < 5) return;
    const attackers = setupOnly ? rankSetupAttackers(player, opponent) : rankAttackers(player, opponent);
    const attacker = attackers[0];
    if (!attacker) return;
    while (player.board.includes(attacker) && attacker.attacksMade < attacker.maxAttacks) {
      if (setupOnly && player.board.length < 5) return;
      const wards = activeWards(opponent.board);
      const attackableWards = wards.filter(unit => !unit.intimidate && !unit.ambush);
      const foes = attackable(opponent.board);
      const canFollower = attacker.canAttackFollower;
      const canLeader = attacker.canAttackLeader && !wards.length;
      let target = null, leader = false;
      if (setupOnly) {
        const candidates = wards.length ? attackableWards : foes;
        const sacrificeTargets = candidates.filter(unit => willFollowerDieInCombat(attacker, unit, player));
        if (canFollower && sacrificeTargets.length) target = tradeTarget(attacker, sacrificeTargets, player.strategy);
        else break;
      } else if (wards.length) {
        if (canFollower && attackableWards.length) target = tradeTarget(attacker, attackableWards, player.strategy);
        else break;
      } else if (canLeader && hasCollectiveBoardLethal(player, opponent)) leader = true;
      else if (canLeader && shouldFace(attacker, player, opponent, foes, rng)) leader = true;
      else if (canFollower && foes.length) target = tradeTarget(attacker, foes, player.strategy);
      else if (canLeader) leader = true;
      else break;

      const actions = [];
      if (target && attacker.superEvolved && hasCrest(player, "Verdilia & Castelle, Sisters")) {
        attacker.maxAttacks = Math.max(attacker.maxAttacks, 2);
        actions.push("Verdilia & Castelle Crest: can attack twice this turn");
      }
      if (leader && hasU(attacker, "Storm") && hasCrest(opponent, "Lu Woh, Light Personified")) {
        const reduction = Math.min(3, Math.max(0, attacker.attack));
        attacker.attack -= reduction;
        attacker.tempAttackPenalty = (Number(attacker.tempAttackPenalty) || 0) + reduction;
        actions.push(`Lu Woh Crest: ${attacker.name} -${reduction}/-0 this turn`);
      }

      // [[battle-haven-attack-tracking]]
      player.followersAttackedThisTurn = true;
      attacker.attacksMade += 1;
      attacker.attacked = attacker.attacksMade >= attacker.maxAttacks;
      stats.attacks[playerIndex] += 1;
      if (attacker.ambush) {
        attacker.ambush = false;
        attacker.keywords = attacker.keywords.filter(keyword => keyword !== "Ambush");
      }

      // [[battle-runecraft-shymm-attack-real]]
      applyRunecraftAttackDeclaration(player, attacker, actions);
      // [[battle-dragoncraft-yube-attack-real]]
      applyDragoncraftAttackDeclaration({ player, opponent, playerIndex, enemyIndex, stats, rng, cardMap: map }, attacker, actions);

      if (leader) {
        // [[battle-strike-precombat-v5]] Attack/Strike abilities resolve before combat damage.
        actions.push(...strike(attacker, player, opponent, playerIndex, enemyIndex, stats, rng, map, typeof target !== "undefined" ? target : null));
        actions.push(...cleanup(opponent, player, enemyIndex, playerIndex, stats, rng, map), ...cleanup(player, opponent, playerIndex, enemyIndex, stats, rng, map));
        if (!player.board.includes(attacker) || opponent.hp <= 0) {
          snap(frames, players, { round, active: playerIndex, phase: "attack", action: compact(`${attacker.name} attacks ${opponent.name}'s leader.`, actions) }, stats, record);
          if (opponent.hp <= 0) return;
          break;
        }
        const damage = Math.max(0, attacker.attack);
        const dealt = damageLeader(opponent, damage);
        stats.damageDealt[playerIndex] += dealt;
        if (hasU(attacker, "Drain")) {
          const healed = healPlayer(player, dealt, stats, playerIndex);
          if (healed) actions.push(`Drain heals ${healed}`);
          actions.push(...afterLeaderHeal(player, healed, stats, playerIndex));
        }
        snap(frames, players, { round, active: playerIndex, phase: "attack", action: compact(`${attacker.name} attacks ${opponent.name}'s leader for ${dealt}.`, actions) }, stats, record);
        if (opponent.hp <= 0) return;
        continue;
      }

      if (target) {
        // Attack/Strike and Clash abilities all resolve before combat damage.
        actions.push(...strike(attacker, player, opponent, playerIndex, enemyIndex, stats, rng, map, typeof target !== "undefined" ? target : null));
        const clashAttacker = getUnitTriggeredText(attacker, "clash");
        const clashTarget = getUnitTriggeredText(target, "clash");
        if (clashAttacker) actions.push(...resolveText(clashAttacker, { card: attacker.card, sourceUnit: attacker, player, opponent, playerIndex, enemyIndex, stats, rng, cardMap: map }).actions);
        if (clashTarget) actions.push(...resolveText(clashTarget, { card: target.card, sourceUnit: target, player: opponent, opponent: player, playerIndex: enemyIndex, enemyIndex: playerIndex, stats, rng, cardMap: map }).actions);
        actions.push(...cleanup(player, opponent, playerIndex, enemyIndex, stats, rng, map), ...cleanup(opponent, player, enemyIndex, playerIndex, stats, rng, map));
        const attackerAlive = player.board.includes(attacker);
        const targetAlive = opponent.board.includes(target);
        if (!attackerAlive || !targetAlive) {
          if (attackerAlive && attacker.superEvolved && !targetAlive && target.defense <= 0) {
            const dealt = damageLeader(opponent, 1);
            stats.damageDealt[playerIndex] += dealt;
            if (dealt) actions.push("Super-Evolution deals 1 leader damage");
          }
          snap(frames, players, { round, active: playerIndex, phase: "attack", action: compact(`${attacker.name} attacks ${target.name}.`, actions) }, stats, record);
          if (opponent.hp <= 0) return;
          if (!attackerAlive) break;
          continue;
        }

        const outgoing = Math.max(0, attacker.attack);
        const incoming = Math.max(0, target.attack);
        const dealtToTarget = damageUnit(target, outgoing, opponent, player, { player, opponent, playerIndex, enemyIndex, stats, rng, cardMap: map }, actions);
        const dealtToAttacker = damageUnit(attacker, incoming, player, opponent, { player, opponent, playerIndex, enemyIndex, stats, rng, cardMap: map }, actions);
        // Bane is a combat destruction effect, not a damage threshold. It still
        // applies when attack is 0 or combat damage is prevented.
        if (hasU(attacker, "Bane")) destroyUnit(opponent, target);
        if (hasU(target, "Bane")) destroyUnit(player, attacker);
        if (hasU(attacker, "Drain")) {
          const healed = healPlayer(player, dealtToTarget, stats, playerIndex);
          if (healed) actions.push(`Drain heals ${healed}`);
          actions.push(...afterLeaderHeal(player, healed, stats, playerIndex));
        }
        const targetDied = target.defense <= 0;
        if (attacker.superEvolved && targetDied) {
          const dealt = damageLeader(opponent, 1);
          stats.damageDealt[playerIndex] += dealt;
          if (dealt) actions.push("Super-Evolution deals 1 leader damage");
          if (opponent.hp <= 0) {
            snap(frames, players, { round, active: playerIndex, phase: "attack", action: compact(`${attacker.name} destroys ${target.name}.`, actions) }, stats, record);
            return;
          }
        }
        actions.push(...cleanup(opponent, player, enemyIndex, playerIndex, stats, rng, map), ...cleanup(player, opponent, playerIndex, enemyIndex, stats, rng, map));
        snap(frames, players, { round, active: playerIndex, phase: "attack", action: compact(`${attacker.name} attacks ${target.name}.`, actions) }, stats, record);
        if (opponent.hp <= 0) return;
        continue;
      }
      break;
    }
  }
}

function attackable(board) { return board.filter(unit => unit.type === "Follower" && !unit.intimidate && !unit.ambush); }
function activeWards(board) { return board.filter(unit => unit.type === "Follower" && hasU(unit, "Ward") && !unit.intimidate && !unit.ambush); }

// [[battle-ai-v2-2-attack-order]]
function rankAttackers(player, opponent) {
  const wards = activeWards(opponent.board);
  const foes = attackable(opponent.board);
  const lethal = hasCollectiveBoardLethal(player, opponent);
  return player.board
    .filter(unit => unit.type === "Follower" && unit.attacksMade < unit.maxAttacks && canAttackCurrentState(unit, wards, foes))
    .map(unit => ({ unit, score: attackPriorityScore(unit, player, opponent, wards, foes, lethal) }))
    .sort((a, b) => b.score - a.score || String(a.unit.uid).localeCompare(String(b.unit.uid)))
    .map(entry => entry.unit);
}

function canAttackCurrentState(unit, wards, foes) {
  if (wards.length) return Boolean(unit.canAttackFollower && wards.length);
  return Boolean(unit.canAttackLeader || (unit.canAttackFollower && foes.length));
}

function attackPriorityScore(attacker, player, opponent, wards, foes, lethal) {
  const attack = Math.max(0, Number(attacker.attack) || 0);
  const defense = Math.max(0, Number(attacker.defense) || 0);
  if (lethal && attacker.canAttackLeader && !wards.length) return 1000 + attack * 10;

  const targets = wards.length ? wards : foes;
  const removable = attacker.canAttackFollower
    ? targets.filter(target => canCombatRemove(attacker, target))
    : [];
  let score = 0;

  // Rush-only bodies must cash in their combat utility before versatile
  // attackers. Among valid trades, prefer the smallest sufficient body so a
  // large follower is not wasted into a tiny target.
  if (attacker.canAttackFollower && !attacker.canAttackLeader) score += 18;
  if (removable.length) {
    const bestTarget = tradeTarget(attacker, removable, player.strategy);
    const threat = Math.max(0, Number(bestTarget?.attack) || 0) * 2.5 + Math.max(0, Number(bestTarget?.defense) || 0);
    const overkill = hasU(attacker, "Bane") ? 0 : Math.max(0, attack - Math.max(0, Number(bestTarget?.defense) || 0));
    const survives = !willFollowerDieInCombat(attacker, bestTarget, player);
    score += 22 + threat + (survives ? 8 : 0) - overkill * 1.5;
  }

  const strikeText = getUnitTriggeredText(attacker, "strike");
  if (strikeText) score += 5 + evolutionTextValue(strikeText, player, opponent, attacker) * .5;
  if (attacker.canAttackLeader && !wards.length) {
    const style = String(player.strategy?.style ?? "midrange");
    const faceWeight = style === "aggro" ? 1.8 : style === "buff-tempo" || style === "puppetry-tempo" ? 1.1 : .55;
    score += attack * faceWeight;
    if (opponent.hp <= attack) score += 500;
  }
  if (hasU(attacker, "Bane") && removable.length) score += 3;
  if (attacker.superEvolved && removable.length) score += 2;
  score -= defense * .03;
  return score;
}

function rankSetupAttackers(player, opponent) {
  const wards = activeWards(opponent.board);
  const targets = wards.length ? wards : attackable(opponent.board);
  return player.board
    .filter(unit => unit.type === "Follower" && unit.canAttackFollower && unit.attacksMade < unit.maxAttacks)
    .map(unit => ({ unit, score: setupSacrificeScore(unit, targets, player) }))
    .filter(entry => Number.isFinite(entry.score))
    .sort((a, b) => b.score - a.score)
    .map(entry => entry.unit);
}

function setupSacrificeScore(attacker, targets, player) {
  let best = -Infinity;
  const ownValue = Math.max(0, Number(attacker.attack) || 0) * 1.6 + Math.max(0, Number(attacker.defense) || 0);
  for (const target of targets) {
    if (!willFollowerDieInCombat(attacker, target, player)) continue;
    const kills = canCombatRemove(attacker, target);
    const threat = Math.max(0, Number(target.attack) || 0) * 2.5 + Math.max(0, Number(target.defense) || 0);
    best = Math.max(best, (kills ? 18 : 4) + threat - ownValue * .35);
  }
  return best;
}

function willFollowerDieInCombat(attacker, target, owner) {
  if (!attacker || !target) return false;
  if (attacker.superEvolved && owner.isActive) return false;
  if (hasU(target, "Bane")) return true;
  if ((Number(attacker.barrier) || 0) > 0) return false;
  return Math.max(0, Number(target.attack) || 0) >= Math.max(0, Number(attacker.defense) || 0);
}

// [[battle-actual-damage-v5]]
function damageLeader(player, amountValue) {
  const before = Number(player.hp) || 0;
  player.hp -= Math.max(0, Number(amountValue) || 0);
  return Math.max(0, before - (Number(player.hp) || 0));
}

function damageUnit(unit, amountValue, owner, sourceOwner, ctx, actions) {
  let amount = Math.max(0, Number(amountValue) || 0);
  const attempted = amount > 0;
  if (unit.superEvolved && owner.isActive) {
    amount = 0;
    actions.push(`${unit.name} Invincible`);
  } else if (unit.barrier > 0 && amount > 0) {
    unit.barrier -= 1;
    amount = 0;
    actions.push(`${unit.name} Barrier`);
  } else {
    const cap = Number(String(unit.card?.text ?? "").match(/can'?t take more than\s*(\d+) damage at a time/i)?.[1] ?? 0);
    if (cap > 0 && amount > cap) {
      amount = cap;
      actions.push(`${unit.name} caps damage at ${cap}`);
    }
  }
  unit.defense -= amount;
  if (attempted && amount > 0 && unit.defense > 0) applyFollowerDamagedEvents(unit, owner, sourceOwner, ctx, actions);
  return amount;
}

function reactDamage(unit, owner, opponent, ctx, actions) {
  if (unit.reactedThisTurn) return;
  const match = String(unit.card.text ?? "").match(/once on each of your turns, when this follower takes damage but isn'?t destroyed,\s*([^.]*)/i);
  if (!match || !owner.isActive) return;
  unit.reactedThisTurn = true;
  const playerIndex = owner === ctx.player ? ctx.playerIndex : ctx.enemyIndex;
  const enemyIndex = owner === ctx.player ? ctx.enemyIndex : ctx.playerIndex;
  const result = resolveText(match[1], { card: unit.card, sourceUnit: unit, player: owner, opponent, playerIndex, enemyIndex, stats: ctx.stats, rng: ctx.rng, cardMap: ctx.cardMap });
  actions.push(...result.actions);
}



// [[battle-ai-collective-lethal-v1]]
function hasCollectiveBoardLethal(player, opponent) {
  if (activeWards(opponent.board).length) return false;
  const hasCap = opponent.leaderDamageCap != null && Number.isFinite(Number(opponent.leaderDamageCap));
  const cap = hasCap ? Math.max(0, Number(opponent.leaderDamageCap)) : null;
  if (cap === 0) return false;

  let total = 0;
  for (const unit of player.board.filter(item => item.type === "Follower")) {
    if (!unit.canAttackLeader || unit.attacksMade >= unit.maxAttacks) continue;
    let damage = Math.max(0, Number(unit.attack) || 0);
    if (hasU(unit, "Storm") && hasCrest(opponent, "Lu Woh, Light Personified")) damage = Math.max(0, damage - 3);
    if (cap != null) damage = Math.min(damage, cap);
    total += damage * Math.max(0, (Number(unit.maxAttacks) || 1) - (Number(unit.attacksMade) || 0));
    if (total >= opponent.hp) return true;
  }
  return false;
}

function shouldFace(attacker, player, opponent, foes, rng) {
  if (attacker.attack >= opponent.hp || !foes.length) return true;

  const style = String(player.strategy?.style ?? "midrange");
  const killable = foes.filter(target => canCombatRemove(attacker, target));
  const enemyAttack = foes.reduce((sum, unit) => sum + Math.max(0, Number(unit.attack) || 0), 0);
  const alliedAttack = player.board
    .filter(unit => unit.type === "Follower")
    .reduce((sum, unit) => sum + Math.max(0, Number(unit.attack) || 0), 0);
  const defensiveEmergency = killable.length > 0 && enemyAttack >= Math.max(5, player.hp - 3);
  const materiallyBehind = killable.length > 0 && enemyAttack >= alliedAttack + 4;
  const highThreat = killable.some(target => (Number(target.attack) || 0) >= 4);

  // Aggro should pressure, not blindly ignore every profitable or necessary
  // trade. The previous unconditional face rule amplified first-player snowball.
  if (style === "aggro") {
    if (defensiveEmergency) return false;
    if (materiallyBehind && opponent.hp > 8) return false;
    if (highThreat && opponent.hp > 12) return false;
    return true;
  }

  if (defensiveEmergency) return false;
  const faceBias = clamp(Number(player.strategy?.faceBias ?? .5), 0, 1);
  return faceBias >= .65 || rng() < faceBias;
}

function canCombatRemove(attacker, target) {
  if (!attacker || !target) return false;
  if (hasU(attacker, "Bane")) return true;
  return Math.max(0, Number(attacker.attack) || 0) >= Math.max(0, Number(target.defense) || 0);
}

function strike(attacker, player, opponent, playerIndex, enemyIndex, stats, rng, map, opposingFollower = null) {
  const text = getUnitTriggeredText(attacker, "strike");
  if (!text) return [];
  stats.strikeTriggered[playerIndex] += 1;
  const result = resolveText(text, { card: attacker.card, sourceUnit: attacker, opposingFollower, player, opponent, playerIndex, enemyIndex, stats, rng, cardMap: map });
  return ["Strike", ...result.actions];
}

function healPlayer(player, amount, stats, index) {
  const healed = Math.max(0, Math.min(Number(amount) || 0, player.maxHp - player.hp));
  player.hp += healed;
  stats.healing[index] += healed;
  // [[battle-dragoncraft-burnite-flame-zero-heal]]
  if (player.isActive) {
    const crest = (player.crests ?? []).find(item => norm(item.name) === "burnite, anathema of flame");
    if (crest && crest.__healTriggerTurn !== player.personalTurn) {
      crest.__healTriggerTurn = player.personalTurn;
      player.hp -= 1;
      player.__burniteFlameHealActionTurn = player.personalTurn;
    }
  }
  return healed;
}

// [[battle-follower-leaves-field]]
function notifyFollowerLeavesField(player, unit) {
  if (!unit || unit.type !== "Follower") return;
  for (const item of player.hand ?? []) {
    if (norm(item.card?.name) !== "bayle, luxglaive warrior") continue;
    item.costDelta = (Number(item.costDelta) || 0) - 1;
  }
}

function cleanup(player, opponent, playerIndex, enemyIndex, stats, rng, map) {
  const actions = [];
  let guard = 0;
  while (guard++ < 12) {
    const dead = player.board.filter(unit => unit.type === "Follower" && unit.defense <= 0);
    if (!dead.length) break;
    for (const unit of dead) {
      // [[battle-runecraft-shikigami-destroyed-cleanup]]
      recordDestroyedShikigami(player, unit);
      player.board = player.board.filter(item => item.uid !== unit.uid);
      if (unit.banishOnLeave) player.banished.push({ uid: unit.uid, card: unit.card });
      else {
        toCemetery(player, { uid: unit.uid, card: unit.card }, true);
        player.destroyedFollowers.push({ card: unit.card });
      }
      stats.followersLost[playerIndex] += 1;
      actions.push(...applyFollowerDestroyedEffects(effectContextBare({ player, opponent, playerIndex, enemyIndex, stats }), unit));
      actions.push(...applyAbysscraftFollowerDestroyedEvents(player, opponent, playerIndex, enemyIndex, stats, unit));
      const lastWords = getUnitTriggeredText(unit, "lastWords");
      if (lastWords) {
        stats.lastWordsTriggered[playerIndex] += 1;
        const result = resolveText(lastWords, { card: unit.card, sourceUnit: unit, player, opponent, playerIndex, enemyIndex, stats, rng, cardMap: map });
        actions.push(`${unit.name} Last Words${result.actions.length ? `: ${result.actions.join(" · ")}` : ""}`);
      }
    }
  }
  return actions;
}

function destroyObject(player, opponent, unit, playerIndex, enemyIndex, stats, rng, map, lastWordsEnabled) {
  // [[battle-high-risk-destroyed-amulet-history]]
  if (unit?.type === "Amulet") {
    player.destroyedAmulets ??= [];
    player.destroyedAmulets.push({ card: unit.card });
  }
  // [[battle-havencraft-faith-amulet-destroyed]]
  if (unit?.type === "Amulet" && player.havenFaithActive) player.faith = (Number(player.faith) || 0) + 1;
  // [[battle-runecraft-shikigami-destroyed-object]]
  if (unit.type === "Follower") recordDestroyedShikigami(player, unit);
  // [[battle-destroy-object-leave-hook]]
  if (unit.type === "Follower") notifyFollowerLeavesField(player, unit);
  player.board = player.board.filter(item => item.uid !== unit.uid);
  if (unit?.banishOnLeave) player.banished.push({ uid: unit.uid, card: unit.card });
  else toCemetery(player, { uid: unit.uid, card: unit.card }, true);
  if (unit.type === "Follower" && !unit?.banishOnLeave) {
    player.destroyedFollowers.push({ card: unit.card });
    stats.followersLost[playerIndex] += 1;
    applyFollowerDestroyedEffects(effectContextBare({ player, opponent, playerIndex, enemyIndex, stats }), unit);
    applyAbysscraftFollowerDestroyedEvents(player, opponent, playerIndex, enemyIndex, stats, unit);
  }
  if (!lastWordsEnabled) return [];
  const lastWords = getUnitTriggeredText(unit, "lastWords");
  if (!lastWords) return [];
  stats.lastWordsTriggered[playerIndex] += 1;
  const result = resolveText(lastWords, { card: unit.card, sourceUnit: unit, player, opponent, playerIndex, enemyIndex, stats, rng, cardMap: map });
  return [`${unit.name} Last Words`, ...result.actions];
}

function getUnitTriggeredText(unit, event) {
  if (!unit?.overrideText) return getTriggeredText(unit.card, event);
  return getTriggeredText({ ...unit.card, text: unit.overrideText }, event);
}

function toCemetery(player, item, addShadow = false) { player.cemetery.push(item); if (addShadow) player.shadows += 1; }
function destroyUnit(player, unit) { if (unit.abilityDestructionImmune) return false; if (unit.superEvolved && player.isActive) return false; unit.defense = 0; return true; }
function banish(player, unit) { if (unit.type === "Follower") notifyFollowerLeavesField(player, unit); player.board = player.board.filter(item => item.uid !== unit.uid); player.banished.push({ uid: unit.uid, card: unit.card }); return true; }
function bounce(player, unit) {
  if (unit?.banishOnLeave) return banish(player, unit);
  if (unit.type === "Follower") notifyFollowerLeavesField(player, unit);
  player.board = player.board.filter(item => item.uid !== unit.uid);
  const item = instance(player, unit.card);
  if (player.hand.length >= 9) { toCemetery(player, item, false); return false; }
  player.hand.push(item);
  return true;
}

function restoreTemporaryAttack(player) {
  for (const unit of player.board) {
    if (unit.tempAttackPenalty) { unit.attack += unit.tempAttackPenalty; unit.tempAttackPenalty = 0; }
    if (unit.swordcraftTempAttackBonus) {
      unit.attack = Math.max(0, unit.attack - unit.swordcraftTempAttackBonus);
      unit.swordcraftTempAttackBonus = 0;
    }
    if (unit.dragoncraftTempAttackBonus) {
      unit.attack = Math.max(0, unit.attack - unit.dragoncraftTempAttackBonus);
      unit.dragoncraftTempAttackBonus = 0;
    }
    if (unit.havencraftTempAttackBonus) {
      unit.attack = Math.max(0, unit.attack - unit.havencraftTempAttackBonus);
      unit.havencraftTempAttackBonus = 0;
    }
  }
}
