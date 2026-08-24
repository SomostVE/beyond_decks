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

export { analyzeCardSupport, analyzeDeckCoverage };

export const BATTLE_RULES_VERSION = 5;

const MAX_ROUNDS = 60;
const MAX_ACTIONS = 24;




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

function createStats() {
  const pair = () => [0, 0];
  return {
    damageDealt: pair(), cardsPlayed: pair(), attacks: pair(), draws: pair(), unsupportedEffects: pair(),
    evolutions: pair(), superEvolutions: pair(), healing: pair(), followersLost: pair(), cardsGenerated: pair(), cardsFused: pair(),
    cardsBurned: pair(), ppSpent: pair(), ppWasted: pair(), spellsPlayed: pair(), lastWordsTriggered: pair(), strikeTriggered: pair()
  };
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
function runTurnAi({ player, opponent, playerIndex, enemyIndex, stats, frames, players, round, rng, map, record }) {
  let safety = 0;
  while (safety++ < MAX_ACTIONS) {
    // Extra PP remains a public, explicit resource. Re-evaluate it between
    // planned actions; the turn planner then sees the resulting PP budget.
    useBonusPpIfUseful(player, opponent);

    // Exact board lethal is resolved immediately instead of spending planner
    // budget proving something already certain.
    if (hasCollectiveBoardLethal(player, opponent)) {
      attackPhase(player, opponent, playerIndex, enemyIndex, stats, frames, players, round, rng, map, record);
      return;
    }

    const plan = planCurrentTurn({ player, opponent, playerIndex, enemyIndex, stats, map });
    if (plan.futureEvaluated) player.futureLookaheadUsedThisTurn = true;
    const decision = plan.sequence[0] ?? { kind: "end" };
    if (decision.kind === "end") {
      if (hasAnyPlannerAction(player, opponent, map)) {
        snap(frames, players, {
          round,
          active: playerIndex,
          phase: "decision",
          action: `${player.name} ends the action sequence and keeps the remaining resources.`
        }, stats, record);
      }
      break;
    }

    const outcome = executePlannerAction(
      { player, opponent, playerIndex, enemyIndex, stats },
      decision,
      map,
      rng
    );
    if (!outcome.applied) break;
    snap(frames, players, {
      round,
      active: playerIndex,
      phase: outcome.phase,
      action: outcome.action
    }, stats, record);
    if (player.hp <= 0 || opponent.hp <= 0) return;
  }
}

function clonePlanningItem(item) {
  return {
    ...item,
    card: item.card,
    fusedCards: [...(item.fusedCards ?? [])].map(value => ({ ...value, traits: [...(value.traits ?? [])] })),
    fusedNames: [...(item.fusedNames ?? [])]
  };
}

function clonePlanningUnit(unit) {
  return {
    ...unit,
    card: unit.card,
    keywords: [...(unit.keywords ?? [])],
    fusedCards: [...(unit.fusedCards ?? [])].map(value => ({ ...value, traits: [...(value.traits ?? [])] })),
    fusedNames: [...(unit.fusedNames ?? [])]
  };
}

function clonePlanningPlayer(source) {
  const clone = {
    ...source,
    hp: Number(source.hp) || 0,
    strategy: source.strategy,
    deck: (source.deck ?? []).map(clonePlanningItem),
    hand: (source.hand ?? []).map(clonePlanningItem),
    board: (source.board ?? []).map(clonePlanningUnit),
    cemetery: (source.cemetery ?? []).map(item => ({ ...item, card: item.card })),
    banished: (source.banished ?? []).map(item => ({ ...item, card: item.card })),
    fusedCards: (source.fusedCards ?? []).map(item => ({ ...item, card: item.card })),
    destroyedFollowers: (source.destroyedFollowers ?? []).map(item => ({ ...item, card: item.card })),
    destroyedAmulets: (source.destroyedAmulets ?? []).map(item => ({ ...item, card: item.card })),
    artifactFollowerNamesEntered: [...(source.artifactFollowerNamesEntered ?? [])],
    crests: (source.crests ?? []).map(crest => ({ ...crest, card: crest.card }))
  };
  installLeaderDamageGuard(clone);
  return clone;
}

function clonePlanningState(state) {
  return {
    player: clonePlanningPlayer(state.player),
    opponent: clonePlanningPlayer(state.opponent),
    playerIndex: state.playerIndex,
    enemyIndex: state.enemyIndex,
    stats: cloneStats(state.stats)
  };
}

function planningPublicSeed(player, opponent) {
  const ownHand = player.hand.map(item => `${item.card?.id}:${item.spellboost ?? 0}:${item.x ?? 0}`).sort().join(",");
  const ownDeck = player.deck.map(item => Number(item.card?.id) || 0).sort((a,b)=>a-b).join(",");
  // Hand count is public; identities are deliberately mixed with the remaining
  // deck before planning so the AI cannot peek at the opponent's hidden hand.
  const enemyUnknown = [...opponent.hand, ...opponent.deck].map(item => Number(item.card?.id) || 0).sort((a,b)=>a-b).join(",");
  const visibleEnemy = opponent.board.map(unit => `${unit.cardId}:${unit.attack}:${unit.defense}`).sort().join(",");
  return [
    "turn-planner-v1", player.personalTurn, player.hp, player.pp, player.maxPp,
    player.ep, player.sep, ownHand, ownDeck,
    opponent.hp, opponent.hand.length, enemyUnknown, visibleEnemy
  ].join("|");
}

function makePlanningRoot({ player, opponent, playerIndex, enemyIndex, stats }) {
  const root = {
    player: clonePlanningPlayer(player),
    opponent: clonePlanningPlayer(opponent),
    playerIndex,
    enemyIndex,
    stats: cloneStats(stats)
  };
  const seed = planningPublicSeed(player, opponent);
  const rng = createRng(seed);

  // Own deck order is unknown to the player. Shuffle a planning copy so draw
  // effects cannot reveal the real future topdeck to the AI.
  shuffle(root.player.deck, rng);

  // Preserve only the public opponent hand count. The unknown-zone multiset is
  // redistributed independently from the actual hidden hand/deck split.
  const handCount = root.opponent.hand.length;
  const unknown = [...root.opponent.hand, ...root.opponent.deck];
  shuffle(unknown, rng);
  root.opponent.hand = unknown.slice(0, handCount);
  root.opponent.deck = unknown.slice(handCount);
  return { state: root, seed };
}

function plannerCardResourceValue(item) {
  const card = item?.card;
  if (!card) return 0;
  const text = norm(card.text);
  let value = .6 + Math.min(8, Math.max(0, Number(card.cost) || 0)) * .16;
  if (/draw|add .* to your hand/.test(text)) value += .35;
  if (/destroy|banish|return .*enemy follower/.test(text)) value += .45;
  if (/restore .*leader/.test(text)) value += .3;
  if (has(card, "Storm")) value += .4;
  return value;
}

// [[battle-ai-stage4-exchange-value]]
function plannerDeathTriggerValue(unit) {
  const text = norm(getUnitTriggeredText(unit, "lastWords") || "");
  if (!text) return 0;
  let value = 1.1;
  if (/draw|add .* to your hand/.test(text)) value += 1.8;
  if (/summon/.test(text)) value += 2.4;
  if (/restore .*leader|restore .*defense/.test(text)) value += 1.2;
  if (/gain crest/.test(text)) value += 1.5;
  if (/deal .*damage/.test(text)) value += 1.7;
  if (/destroy|banish/.test(text)) value += 2.2;
  return value;
}

function plannerBoardValue(player) {
  return player.board.reduce((sum, unit) => {
    if (unit.type === "Amulet") {
      const text = norm(unit.card?.text);
      return sum + 1.2 + (/engage|countdown|at the end of your turn|at the start of your turn/.test(text) ? 1.1 : 0);
    }
    let value = Math.max(0, Number(unit.attack) || 0) * 1.55 + Math.max(0, Number(unit.defense) || 0) * .9;
    if (hasU(unit, "Ward")) value += 2;
    if (hasU(unit, "Bane")) value += 1.7;
    if (hasU(unit, "Storm")) value += 1;
    if (hasU(unit, "Drain")) value += .8;
    if (hasU(unit, "Ambush") || unit.ambush) value += 1.1;
    if (hasU(unit, "Barrier")) value += 1.4;
    if (hasU(unit, "Invincible")) value += 2.2;
    value += plannerDeathTriggerValue(unit) * .55;
    if (unit.evolved) value += .8;
    if (unit.superEvolved) value += 1.2;
    if (unit.aura) value += 1.1;
    return sum + value;
  }, 0);
}

function plannerStateValue(state, ended = false) {
  const player = state.player, opponent = state.opponent;
  if (opponent.hp <= 0) return 100000;
  if (player.hp <= 0) return -100000;
  const style = String(player.strategy?.style ?? "midrange");
  const faceWeight = style === "aggro" ? 3.2 : style === "buff-tempo" || style === "puppetry-tempo" ? 2.6 : 2.1;
  const boardWeight = style === "control" || style === "ward-control" ? 1.25 : 1;
  const enemyBoard = plannerBoardValue(opponent);
  const ownBoard = plannerBoardValue(player);
  const incoming = estimateVisibleIncomingDamage(player, opponent);
  const margin = player.hp - incoming;
  const ownHand = player.hand.reduce((sum, item) => sum + plannerCardResourceValue(item), 0);
  let score = (20 - opponent.hp) * faceWeight + player.hp * .7;
  score += (ownBoard - enemyBoard * 1.08) * boardWeight;
  score += ownHand * .42;
  score += Math.max(0, player.ep) * .55 + Math.max(0, player.sep) * .8;
  if (margin <= 0) score -= 65;
  else if (margin <= 3) score -= 22;
  else if (margin <= 6) score -= 8;
  else score += Math.min(5, margin * .18);
  if (opponent.hp <= 6) score += Math.max(0, 7 - opponent.hp) * 2.5;
  if (ended) {
    // Unspent PP is not inherently a mistake. Passing can be the correct
    // decision when every available play destroys future card value. Keep a
    // small tempo cost for floating PP, but let the explicit pass/hold policy
    // dominate rather than forcing the planner to dump context-only cards.
    score += scorePassDecision(player, opponent) * .9;
    score -= Math.max(0, Number(player.pp) || 0) * (style === "aggro" ? .12 : .04);
  }
  return score;
}

function actionKey(action) {
  if (!action) return "none";
  if (action.kind === "play") return `play:${action.instanceUid}:${action.mode?.kind}:${action.mode?.cost}:${action.targetPlan?.enemyUid ?? ""}`;
  if (action.kind === "fuse") return `fuse:${action.targetUid}:${action.materialUids.join(",")}`;
  if (action.kind === "engage") return `engage:${action.unitUid}`;
  if (action.kind === "evolve") return `evolve:${action.unitUid}:${action.superMode ? 1 : 0}:${action.targetPlan?.enemyUid ?? ""}`;
  if (action.kind === "attack") return `attack:${action.attackerUid}:${action.leader ? "leader" : action.targetUid}`;
  return action.kind;
}

// [[battle-ai-stage3-trade-quality]]
// [[battle-ai-stage4-exchange-value]]
function plannerAttackPrior(attacker, target, leader, player, opponent) {
  const outgoing = Math.max(0, Number(attacker.attack) || 0);
  const missingDefense = Math.max(0, 20 - (Number(player.hp) || 0));
  const drainValue = hasU(attacker, "Drain") ? Math.min(outgoing, missingDefense) * .85 : 0;

  if (leader) {
    const damage = outgoing;
    return (damage >= opponent.hp ? 1000 : 8 + damage * (player.strategy?.style === "aggro" ? 2.4 : 1.5)) + drainValue;
  }

  if (!target) return -100;
  const removes = canCombatRemove(attacker, target);
  const survives = !willFollowerDieInCombat(attacker, target, player);
  const targetThreat = followerThreatValue(target);
  const attackerThreat = followerThreatValue(attacker);
  const targetDefense = Math.max(0, Number(target.defense) || 0);
  const overkill = removes ? Math.max(0, outgoing - targetDefense) : 0;
  const attackerHasBane = hasU(attacker, "Bane");
  const targetHasBane = hasU(target, "Bane");
  const targetHasWard = hasU(target, "Ward");
  const attackerHasWard = hasU(attacker, "Ward");
  const ownDeathValue = plannerDeathTriggerValue(attacker);
  const enemyDeathValue = plannerDeathTriggerValue(target);
  const otherThreats = (opponent.board ?? []).filter(unit => unit !== target && unit.type === "Follower");
  const highestOtherThreat = otherThreats.reduce((best, unit) => Math.max(best, followerThreatValue(unit)), 0);

  let score = removes ? 20 : 1;
  score += targetThreat * .72;
  if (survives) score += 7;
  else {
    score -= attackerThreat * .3;
    score += ownDeathValue * .8;
    if (attackerHasWard) score -= 2.5;
  }
  if (removes && survives) score += 5;
  if (targetHasWard) score += 5;

  // Killing a Last Words follower can hand the opponent material, healing,
  // board presence or a Crest. Account for that downside without refusing a
  // necessary defensive removal or a Ward clear.
  if (removes && enemyDeathValue > 0) {
    const urgency = targetHasWard || targetThreat >= 8 ? .35 : .85;
    score -= enemyDeathValue * urgency;
  }

  // Prefer the smallest sufficient body instead of cashing in a premium
  // attacker on a target a cheaper unit can already remove.
  if (removes) score -= Math.min(6, overkill * .4);

  // Bane is most valuable when it converts a tiny attacker into removal for a
  // follower that normal combat could not efficiently answer. Do not burn it
  // on a trivial target while a much larger threat remains available.
  if (attackerHasBane) {
    if (targetDefense > outgoing || targetThreat >= attackerThreat + 4) score += 8;
    if (targetThreat + 3 < highestOtherThreat) score -= 8;
  }

  // Conversely, do not throw a premium follower into enemy Bane when the
  // exchange is materially unfavorable and another line can answer it.
  if (targetHasBane && !survives && attackerThreat > targetThreat + 3) score -= 5;

  // Drain has extra combat value while the leader is damaged, especially when
  // the trade also removes incoming damage from the next turn.
  if (hasU(attacker, "Drain")) score += Math.min(outgoing, targetDefense, missingDefense) * 1.05;

  // Partial damage can be useful as setup, but should sit behind clean trades
  // unless the target itself is an urgent threat.
  if (!removes) score -= Math.max(0, targetDefense - outgoing) * .25;
  return score;
}

function enumerateAttackDecisions(player, opponent) {
  const wards = activeWards(opponent.board);
  const targets = wards.length ? wards : attackable(opponent.board);
  const out = [];
  for (const attacker of player.board.filter(unit => unit.type === "Follower" && unit.attacksMade < unit.maxAttacks)) {
    if (attacker.canAttackFollower) {
      for (const target of targets) {
        out.push({
          kind: "attack", attackerUid: attacker.uid, targetUid: target.uid, leader: false,
          prior: plannerAttackPrior(attacker, target, false, player, opponent)
        });
      }
    }
    if (!wards.length && attacker.canAttackLeader) {
      out.push({
        kind: "attack", attackerUid: attacker.uid, targetUid: null, leader: true,
        prior: plannerAttackPrior(attacker, null, true, player, opponent)
      });
    }
  }
  return out.sort((a,b)=>b.prior-a.prior);
}

function evolutionTargetPlans(unit, superMode, opponent) {
  const evolveText = getUnitTriggeredText(unit, "evolve") || "";
  const superText = superMode ? (getUnitTriggeredText(unit, "superEvolve") || "") : "";
  const pseudo = { instance: { x: unit.x ?? 0, card: unit.card }, mode: { text: `${evolveText} ${superText}` } };
  const spec = targetEffectSpec(pseudo);
  if (!spec) return [null];
  const targets = targetableEnemyFollowers(opponent.board);
  return targets.length
    ? targets.map(target => ({ enemyUid: target.uid, enemyName: target.name, kind: spec.kind, amount: spec.amount }))
    : [null];
}

function enumerateEvolutionDecisions(player, opponent) {
  if (player.evolutionActionUsed) return [];
  const normalAvailable = player.personalTurn >= (player.goingFirst ? 5 : 4) && player.ep > 0;
  const superAvailable = player.personalTurn >= (player.goingFirst ? 7 : 6) && player.sep > 0;
  if (!normalAvailable && !superAvailable) return [];
  const units = player.board.filter(unit => unit.type === "Follower" && !unit.evolved && !unit.superEvolved && !unit.attacked);
  const out = [];
  for (const unit of units) {
    if (normalAvailable) {
      for (const targetPlan of evolutionTargetPlans(unit, false, opponent)) {
        out.push({ kind: "evolve", unitUid: unit.uid, superMode: false, targetPlan, prior: scoreEvolutionCandidate(unit, player, opponent, false) + targetBranchValue(targetPlan, opponent) * .25 });
      }
    }
    if (superAvailable) {
      for (const targetPlan of evolutionTargetPlans(unit, true, opponent)) {
        out.push({ kind: "evolve", unitUid: unit.uid, superMode: true, targetPlan, prior: scoreEvolutionCandidate(unit, player, opponent, true) + targetBranchValue(targetPlan, opponent) * .25 });
      }
    }
  }
  return out.sort((a,b)=>b.prior-a.prior);
}

function enumerateEngageDecisions(player, opponent) {
  return player.board.filter(unit => unit.type === "Amulet" && !unit.engagedThisTurn)
    .map(unit => ({ unit, ...engageInfo(unit) }))
    .filter(item => item.text != null && item.cost <= player.pp)
    .map(item => ({ kind: "engage", unitUid: item.unit.uid, prior: scoreEngage(item, player, opponent) }))
    .sort((a,b)=>b.prior-a.prior);
}

function diversifyPlannerActions(groups, limit = 8) {
  const chosen = [];
  const rest = [];
  for (const group of groups) {
    if (!group.length) continue;
    chosen.push(group[0]);
    rest.push(...group.slice(1));
  }
  rest.sort((a,b)=>(b.prior ?? 0)-(a.prior ?? 0));
  for (const action of rest) {
    if (chosen.length >= limit) break;
    chosen.push(action);
  }
  return chosen.sort((a,b)=>(b.prior ?? 0)-(a.prior ?? 0)).slice(0, limit);
}

function enumeratePlannerActions(player, opponent, map) {
  const plays = scoredPlayOptions(player, opponent, false).slice(0, 4).map(item => ({
    kind: "play", instanceUid: item.instance.uid, mode: { ...item.mode }, targetPlan: item.targetPlan ? { ...item.targetPlan } : null, prior: item.score
  }));
  const fuses = getFuseActions(player, opponent, map).slice(0, 3).map(item => ({
    kind: "fuse", targetUid: item.target.uid, materialUids: item.materials.map(material => material.uid), prior: item.score
  }));
  const engages = enumerateEngageDecisions(player, opponent).slice(0, 2);
  const evolutions = enumerateEvolutionDecisions(player, opponent).slice(0, 4);
  const attacks = enumerateAttackDecisions(player, opponent).slice(0, 5);
  const actions = diversifyPlannerActions([plays, fuses, engages, evolutions, attacks], 8);
  actions.push({ kind: "end", prior: scorePassDecision(player, opponent) });
  return actions;
}

// [[battle-ai-stage5-lethal-solver]]
function plannerReadyFaceDamage(player, opponent) {
  if (activeWards(opponent.board).length) return 0;
  return player.board
    .filter(unit => unit.type === "Follower" && unit.canAttackLeader && unit.attacksMade < unit.maxAttacks)
    .reduce((sum, unit) => {
      const attacks = Math.max(0, (Number(unit.maxAttacks) || 1) - (Number(unit.attacksMade) || 0));
      return sum + Math.max(0, Number(unit.attack) || 0) * attacks;
    }, 0);
}

function plannerOptimisticBurst(player) {
  let burst = player.board
    .filter(unit => unit.type === "Follower" && unit.attacksMade < unit.maxAttacks)
    .reduce((sum, unit) => {
      const attacks = Math.max(0, (Number(unit.maxAttacks) || 1) - (Number(unit.attacksMade) || 0));
      return sum + Math.max(0, Number(unit.attack) || 0) * attacks;
    }, 0);

  for (const item of player.hand ?? []) {
    const legal = modes(item, player).filter(mode => mode.cost <= player.pp);
    if (!legal.length) continue;
    const card = item.card;
    const text = norm(card?.text);
    if (card?.type === "Follower" && (has(card, "Storm") || /give this follower storm|\bstorm\b/.test(text))) {
      burst += Math.max(0, Number(card.attack) || 0);
    }
    for (const match of text.matchAll(/deal\s+(\d+)\s+damage\s+to\s+(?:the\s+)?enemy\s+leader/g)) {
      burst += Math.max(0, Number(match[1]) || 0);
    }
    for (const match of text.matchAll(/deal\s+(\d+)\s+damage\s+to\s+a\s+random\s+enemy/g)) {
      burst += Math.max(0, Number(match[1]) || 0);
    }
    for (const match of text.matchAll(/give[^.\n]*\+(\d+)\s*\/\s*[+-]?\d+/g)) {
      burst += Math.max(0, Number(match[1]) || 0);
    }
  }

  if (!player.evolutionActionUsed) {
    const normalAvailable = player.personalTurn >= (player.goingFirst ? 5 : 4) && player.ep > 0;
    const superAvailable = player.personalTurn >= (player.goingFirst ? 7 : 6) && player.sep > 0;
    if (superAvailable) burst += 3;
    else if (normalAvailable) burst += 2;
  }
  return burst;
}

function shouldRunPlannerLethalSearch(root, best, options = {}) {
  if (options.disableLethalSearch) return false;
  const player = root.player, opponent = root.opponent;
  if (player.hp <= 0 || opponent.hp <= 0 || best?.state?.opponent?.hp <= 0) return false;

  // The deliberately shallow future-response planner stays cheap. Real turns
  // and explicit QA searches still get the extended lethal solver.
  if ((Number(options.depth) || 0) <= 1 && (Number(options.beamWidth) || 0) <= 1) return false;

  const projectedHp = Number(best?.state?.opponent?.hp ?? opponent.hp);
  if (projectedHp <= 6 && projectedHp < opponent.hp) return true;
  if (plannerOptimisticBurst(player) >= opponent.hp) return true;

  // At low defense, search even when generic text cannot estimate a bespoke
  // class combo. Exact simulation, not the estimate, decides whether lethal is
  // actually legal.
  if (opponent.hp <= 10 && (player.hand.length || player.board.some(unit => unit.type === "Follower"))) return true;
  return false;
}

function enumerateLethalPlannerActions(player, opponent, map) {
  const plays = scoredPlayOptions(player, opponent, false).slice(0, 8).map(item => ({
    kind: "play", instanceUid: item.instance.uid, mode: { ...item.mode }, targetPlan: item.targetPlan ? { ...item.targetPlan } : null, prior: item.score
  }));
  const fuses = getFuseActions(player, opponent, map).slice(0, 4).map(item => ({
    kind: "fuse", targetUid: item.target.uid, materialUids: item.materials.map(material => material.uid), prior: item.score
  }));
  const engages = enumerateEngageDecisions(player, opponent).slice(0, 3);
  const evolutions = enumerateEvolutionDecisions(player, opponent).slice(0, 8);
  const allAttacks = enumerateAttackDecisions(player, opponent);
  const attacks = activeWards(opponent.board).length
    ? allAttacks.slice(0, 10)
    : [...allAttacks.filter(action => action.leader), ...allAttacks.filter(action => !action.leader).slice(0, 5)].slice(0, 10);
  return diversifyPlannerActions([plays, fuses, engages, evolutions, attacks], 16)
    .filter(action => action.kind !== "end");
}

function plannerLethalSearchScore(node, startingOpponentHp) {
  const player = node.state.player, opponent = node.state.opponent;
  if (opponent.hp <= 0) return 1000000 + plannerNodeScore(node, false);
  if (player.hp <= 0) return -1000000;
  const damage = Math.max(0, startingOpponentHp - opponent.hp);
  const wards = activeWards(opponent.board);
  const wardDefense = wards.reduce((sum, unit) => sum + Math.max(0, Number(unit.defense) || 0), 0);
  const readyFace = plannerReadyFaceDamage(player, opponent);
  const remainingBurst = plannerOptimisticBurst(player);
  const actionCount = node.sequence.length;
  return damage * 70
    + readyFace * 12
    + Math.min(20, remainingBurst) * 2.5
    - wards.length * 18
    - wardDefense * 1.4
    + Math.max(0, Number(player.pp) || 0) * .4
    + node.priorTotal * .035
    - actionCount * .35;
}

function findPlannerLethal(root, map, seed, options = {}) {
  const depthLimit = Math.max(5, Math.min(8, Number(options.lethalDepth ?? 7) || 7));
  const beamWidth = Math.max(8, Math.min(24, Number(options.lethalBeamWidth ?? 16) || 16));
  const startingOpponentHp = root.opponent.hp;
  let beam = [{ state: root, sequence: [], priorTotal: 0, score: plannerLethalSearchScore({ state: root, sequence: [], priorTotal: 0 }, startingOpponentHp) }];
  const lethals = [];
  let explored = 0;

  for (let depth = 0; depth < depthLimit; depth += 1) {
    const expanded = [];
    for (const node of beam) {
      const actions = enumerateLethalPlannerActions(node.state.player, node.state.opponent, map);
      for (const action of actions) {
        explored += 1;
        const childState = clonePlanningState(node.state);
        const sequence = [...node.sequence, action];
        const branchRng = createRng(seed + "|lethal|" + sequence.map(actionKey).join(">"));
        const outcome = executePlannerAction(childState, action, map, branchRng);
        if (!outcome.applied) continue;
        const child = {
          state: childState,
          sequence,
          priorTotal: node.priorTotal + Math.max(-20, Math.min(40, Number(action.prior) || 0))
        };
        child.score = plannerLethalSearchScore(child, startingOpponentHp);
        if (childState.opponent.hp <= 0) lethals.push(child);
        else if (childState.player.hp > 0) expanded.push(child);
      }
    }
    if (!expanded.length) break;
    expanded.sort((a, b) => b.score - a.score || a.sequence.length - b.sequence.length || a.sequence.map(actionKey).join("|").localeCompare(b.sequence.map(actionKey).join("|")));
    beam = expanded.slice(0, beamWidth);
  }

  if (!lethals.length) return null;
  lethals.sort((a, b) => plannerNodeScore(b, false) - plannerNodeScore(a, false) || a.sequence.length - b.sequence.length);
  return { node: lethals[0], explored };
}

function hasAnyPlannerAction(player, opponent, map) {
  return enumeratePlannerActions(player, opponent, map).some(action => action.kind !== "end");
}

function executeEvolutionDecision(state, action, map, rng) {
  const { player, opponent, playerIndex, enemyIndex, stats } = state;
  if (player.evolutionActionUsed) return { applied: false, actions: [] };
  const unit = player.board.find(item => item.uid === action.unitUid);
  if (!unit || unit.type !== "Follower" || unit.evolved || unit.superEvolved || unit.attacked) return { applied: false, actions: [] };
  const superMode = Boolean(action.superMode);
  const unlockTurn = player.goingFirst ? (superMode ? 7 : 5) : (superMode ? 6 : 4);
  if (player.personalTurn < unlockTurn || player[superMode ? "sep" : "ep"] <= 0) return { applied: false, actions: [] };

  const bonus = superMode ? 3 : 2;
  player[superMode ? "sep" : "ep"] -= 1;
  player.evolutionActionUsed = true;
  unit.attack += bonus;
  unit.defense += bonus;
  unit.maxDefense += bonus;
  unit.canAttackFollower = !unit.yuriusAttackLocked && !/can't attack followers or leaders/i.test(String(unit.card?.text ?? ""));
  if (unit.yuriusAttackLocked || /can't attack followers or leaders/i.test(String(unit.card?.text ?? ""))) unit.canAttackLeader = false;
  unit.evolved = true;
  unit.superEvolved = superMode;
  player.evolutionsThisMatch += 1;
  recordHandEvolution(player);
  if (superMode) stats.superEvolutions[playerIndex] += 1;
  else stats.evolutions[playerIndex] += 1;
  const actions = [];
  // [[battle-high-risk-enemy-hand-super-evolve-event]]
  if (superMode) actions.push(...highRiskEnemySuperEvolveHandTriggers(opponent));
  // [[battle-swordcraft-manual-super-evolve-event]]
  if (superMode) actions.push(...applySwordcraftSuperEvolveHandTriggers(player));
  // [[battle-dragoncraft-manual-super-evolve-event]]
  if (superMode) actions.push(...applyDragoncraftSuperEvolveHandTriggers(player, unit));
  // [[battle-havencraft-manual-super-evolve-event]]
  if (superMode) actions.push(...applyHavencraftSuperEvolveHandTriggers(player));
  // [[battle-abysscraft-manual-super-evolve-event]]
  if (superMode) actions.push(...applyAbysscraftSuperEvolveTriggers({ player, opponent, playerIndex, enemyIndex, stats, rng, cardMap: map }, unit));
  // [[battle-forestcraft-manual-evolve-event]]
  actions.push(...applyForestEvolutionTriggers({ player, opponent, playerIndex, enemyIndex, stats, rng, cardMap: map }, unit, superMode));
  const evolveText = getUnitTriggeredText(unit, "evolve");
  if (evolveText) actions.push(...resolveText(evolveText, { card: unit.card, sourceUnit: unit, player, opponent, playerIndex, enemyIndex, stats, rng, cardMap: map, targetPlan: action.targetPlan ?? null }).actions);
  if (superMode) {
    const superText = getUnitTriggeredText(unit, "superEvolve");
    if (superText) actions.push(...resolveText(superText, { card: unit.card, sourceUnit: unit, player, opponent, playerIndex, enemyIndex, stats, rng, cardMap: map, targetPlan: action.targetPlan ?? null }).actions);
  }
  actions.push(...cleanup(opponent, player, enemyIndex, playerIndex, stats, rng, map));
  return {
    applied: true,
    actions,
    phase: superMode ? "super-evolve" : "evolve",
    action: compact(`${player.name} ${superMode ? "super-evolves" : "evolves"} ${unit.name}.`, actions)
  };
}

function executeSingleAttackDecision(state, action, map, rng) {
  const { player, opponent, playerIndex, enemyIndex, stats } = state;
  const attacker = player.board.find(unit => unit.uid === action.attackerUid);
  if (!attacker || attacker.type !== "Follower" || attacker.attacksMade >= attacker.maxAttacks) return { applied: false, actions: [] };
  const wards = activeWards(opponent.board);
  let target = action.leader ? null : opponent.board.find(unit => unit.uid === action.targetUid);
  if (action.leader) {
    if (wards.length || !attacker.canAttackLeader) return { applied: false, actions: [] };
  } else {
    if (!target || !attacker.canAttackFollower || target.intimidate || target.ambush) return { applied: false, actions: [] };
    if (wards.length && !wards.includes(target)) return { applied: false, actions: [] };
  }

  const actions = [];
  if (target && attacker.superEvolved && hasCrest(player, "Verdilia & Castelle, Sisters")) {
    attacker.maxAttacks = Math.max(attacker.maxAttacks, 2);
    actions.push("Verdilia & Castelle Crest: can attack twice this turn");
  }
  // [[battle-runecraft-shymm-attack-planner]]
  applyRunecraftAttackDeclaration(player, attacker, actions);
  if (action.leader && hasU(attacker, "Storm") && hasCrest(opponent, "Lu Woh, Light Personified")) {
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

  if (action.leader) {
    actions.push(...strike(attacker, player, opponent, playerIndex, enemyIndex, stats, rng, map, typeof target !== "undefined" ? target : null));
    actions.push(...cleanup(opponent, player, enemyIndex, playerIndex, stats, rng, map), ...cleanup(player, opponent, playerIndex, enemyIndex, stats, rng, map));
    let dealt = 0;
    if (player.board.includes(attacker) && opponent.hp > 0) {
      dealt = damageLeader(opponent, Math.max(0, attacker.attack));
      stats.damageDealt[playerIndex] += dealt;
      if (hasU(attacker, "Drain")) {
        const healed = healPlayer(player, dealt, stats, playerIndex);
        if (healed) actions.push(`Drain heals ${healed}`);
        actions.push(...afterLeaderHeal(player, healed, stats, playerIndex));
      }
    }
    return { applied: true, actions, phase: "attack", action: compact(`${attacker.name} attacks ${opponent.name}'s leader for ${dealt}.`, actions) };
  }

  const declaredName = target.name;
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
    return { applied: true, actions, phase: "attack", action: compact(`${attacker.name} attacks ${declaredName}.`, actions) };
  }

  const outgoing = Math.max(0, attacker.attack);
  const incoming = Math.max(0, target.attack);
  const dealtToTarget = damageUnit(target, outgoing, opponent, player, { player, opponent, playerIndex, enemyIndex, stats, rng, cardMap: map }, actions);
  damageUnit(attacker, incoming, player, opponent, { player, opponent, playerIndex, enemyIndex, stats, rng, cardMap: map }, actions);
  if (hasU(attacker, "Bane")) destroyUnit(opponent, target);
  if (hasU(target, "Bane")) destroyUnit(player, attacker);
  if (hasU(attacker, "Drain")) {
    const healed = healPlayer(player, dealtToTarget, stats, playerIndex);
    if (healed) actions.push(`Drain heals ${healed}`);
    actions.push(...afterLeaderHeal(player, healed, stats, playerIndex));
  }
  if (attacker.superEvolved && target.defense <= 0) {
    const dealt = damageLeader(opponent, 1);
    stats.damageDealt[playerIndex] += dealt;
    if (dealt) actions.push("Super-Evolution deals 1 leader damage");
  }
  actions.push(...cleanup(opponent, player, enemyIndex, playerIndex, stats, rng, map), ...cleanup(player, opponent, playerIndex, enemyIndex, stats, rng, map));
  return { applied: true, actions, phase: "attack", action: compact(`${attacker.name} attacks ${declaredName}.`, actions) };
}

function executePlannerAction(state, action, map, rng) {
  const { player, opponent, playerIndex, enemyIndex, stats } = state;
  if (action.kind === "play") {
    const inst = player.hand.find(item => item.uid === action.instanceUid);
    if (!inst) return { applied: false, actions: [] };
    const legal = modes(inst, player).find(mode => mode.kind === action.mode.kind && mode.cost === action.mode.cost && (mode.modeIndex ?? 0) === (action.mode.modeIndex ?? 0));
    if (!legal) return { applied: false, actions: [] };
    const result = playCard(inst, legal, player, opponent, playerIndex, enemyIndex, stats, rng, map, { targetPlan: action.targetPlan ?? null });
    return { applied: true, actions: result.actions, phase: "play", action: compact(`${player.name} plays ${inst.card.name} (${legal.cost} PP${legal.kind !== "base" ? ` · ${cap(legal.kind)}` : ""}).`, result.actions) };
  }
  if (action.kind === "fuse") {
    const target = player.hand.find(item => item.uid === action.targetUid);
    const materials = action.materialUids.map(uid => player.hand.find(item => item.uid === uid)).filter(Boolean);
    if (!target || !materials.length) return { applied: false, actions: [] };
    const result = resolveFuseAction({ target, targetName: target.card.name, materials }, player, opponent, playerIndex, enemyIndex, stats, rng, map);
    return { applied: Boolean(result.applied), actions: result.actions, phase: "fuse", action: compact(`${player.name} Fuses ${materials.map(item => item.card.name).join(" + ")} into ${target.card.name}.`, result.actions) };
  }
  if (action.kind === "engage") {
    const unit = player.board.find(item => item.uid === action.unitUid);
    if (!unit || unit.engagedThisTurn) return { applied: false, actions: [] };
    const result = resolveEngage(unit, player, opponent, playerIndex, enemyIndex, stats, rng, map);
    return { applied: true, actions: result.actions, phase: "play", action: compact(`${player.name} engages ${unit.name}.`, result.actions) };
  }
  if (action.kind === "evolve") return executeEvolutionDecision(state, action, map, rng);
  if (action.kind === "attack") return executeSingleAttackDecision(state, action, map, rng);
  return { applied: false, actions: [] };
}

// [[battle-ai-stage2-efficiency]]
function plannerEvolutionSpendCost(node) {
  const sequence = node.sequence ?? [];
  let cost = 0;
  for (const action of sequence) {
    if (action.kind !== "evolve") continue;
    const superMode = Boolean(action.superMode);
    cost += superMode ? 5.5 : 3.75;

    const unit = node.state?.player?.board?.find(item => item.uid === action.unitUid) ?? null;
    if (!unit) continue;
    const evolveText = getUnitTriggeredText(unit, "evolve") || "";
    const superText = superMode ? (getUnitTriggeredText(unit, "superEvolve") || "") : "";
    const attacked = Boolean(unit.attacked) || (Number(unit.attacksMade) || 0) > 0;
    const enemyFollowers = (node.state?.opponent?.board ?? []).filter(item => item.type === "Follower").length;

    // Pure stat evolutions that neither trigger an ability nor participate in
    // combat this turn are the most common way for the planner to burn a scarce
    // evolution resource for no immediate purpose. Make those lines expensive,
    // especially on an empty enemy board.
    if (!attacked && !evolveText.trim() && !superText.trim() && enemyFollowers === 0) {
      cost += superMode ? 4.5 : 3;
    }
  }
  return cost;
}

function plannerNodeScore(node, ended = false) {
  const actionCount = (node.sequence ?? []).filter(action => action.kind !== "end").length;
  const evolutionCost = plannerEvolutionSpendCost(node);

  // Once lethal has been reached, extra setup actions have no strategic value.
  // Prefer the shortest lethal line and preserve Evo / Super Evo unless the
  // resource was actually required to create lethal.
  if (node.state?.opponent?.hp <= 0) return 100000 - evolutionCost - actionCount * .1;
  if (node.state?.player?.hp <= 0) return -100000 - actionCount * .1;

  return plannerStateValue(node.state, ended)
    + node.priorTotal * .14
    - node.sequence.length * .04
    - evolutionCost;
}

function planCurrentTurnBase({ player, opponent, playerIndex, enemyIndex, stats, map }, options = {}) {
  const { state: root, seed } = makePlanningRoot({ player, opponent, playerIndex, enemyIndex, stats });
  const depthLimit = Math.max(1, Number(options.depth ?? (player.personalTurn <= 2 ? 2 : 4)) || 4);
  const beamWidth = Math.max(2, Number(options.beamWidth ?? 4) || 4);
  let beam = [{ state: root, sequence: [], priorTotal: 0, score: plannerStateValue(root, false) }];
  const terminal = [];

  for (let depth = 0; depth < depthLimit; depth += 1) {
    const expanded = [];
    for (const node of beam) {
      const candidates = enumeratePlannerActions(node.state.player, node.state.opponent, map);
      for (const action of candidates) {
        if (action.kind === "end") {
          const finished = { ...node, sequence: [...node.sequence, action], priorTotal: node.priorTotal + (action.prior ?? 0) * .25 };
          finished.score = plannerNodeScore(finished, true);
          terminal.push(finished);
          continue;
        }
        const childState = clonePlanningState(node.state);
        const sequence = [...node.sequence, action];
        const branchRng = createRng(`${seed}|${sequence.map(actionKey).join(">")}`);
        const outcome = executePlannerAction(childState, action, map, branchRng);
        if (!outcome.applied) continue;
        const child = {
          state: childState,
          sequence,
          priorTotal: node.priorTotal + Math.max(-20, Math.min(40, Number(action.prior) || 0))
        };
        child.score = plannerNodeScore(child, false);
        if (childState.player.hp <= 0 || childState.opponent.hp <= 0) terminal.push(child);
        else expanded.push(child);
      }
    }
    if (!expanded.length) break;
    expanded.sort((a,b)=>b.score-a.score || a.sequence.map(actionKey).join("|").localeCompare(b.sequence.map(actionKey).join("|")));
    beam = expanded.slice(0, beamWidth);
  }

  const finalists = [...terminal, ...beam.map(node => ({ ...node, score: plannerNodeScore(node, true) }))]
    .filter(node => node.sequence.length > 0)
    .sort((a,b)=>b.score-a.score || a.sequence.length-b.sequence.length);
  const best = finalists[0] ?? { sequence: [{ kind: "end" }], score: plannerStateValue(root, true), state: root, priorTotal: 0 };

  if (shouldRunPlannerLethalSearch(root, best, options)) {
    const solved = findPlannerLethal(root, map, seed, options);
    if (solved?.node?.state?.opponent?.hp <= 0) {
      const lethalNode = solved.node;
      return {
        sequence: lethalNode.sequence,
        score: plannerNodeScore(lethalNode, false),
        explored: finalists.length + solved.explored,
        candidates: [lethalNode],
        lethalSolved: true,
        lethalSearchExplored: solved.explored
      };
    }
  }

  const candidateLimit = Math.max(1, Number(options.candidateLimit ?? 4) || 4);
  const diverseCandidates = [];
  const firstActionKeys = new Set();
  for (const candidate of (finalists.length ? finalists : [best])) {
    const key = actionKey(candidate.sequence?.[0] ?? { kind: "end" });
    if (firstActionKeys.has(key)) continue;
    firstActionKeys.add(key);
    diverseCandidates.push(candidate);
    if (diverseCandidates.length >= candidateLimit) break;
  }
  return {
    sequence: best.sequence,
    score: best.score,
    explored: finalists.length,
    candidates: diverseCandidates.length ? diverseCandidates : [best],
    lethalSolved: Boolean(best.state?.opponent?.hp <= 0),
    lethalSearchExplored: 0
  };
}

// [[battle-ai-two-turn-lookahead-v1]]
function resetPlanningTurnState(player) {
  player.cardsPlayedThisTurn = 0;
  player.spellsPlayedThisTurn = 0;
  player.evolutionActionUsed = false;
  player.followersAttackedThisTurn = false;
  // [[battle-runecraft-planner-turn-state]]
  player.shikigamiDestroyedBaseAttackThisTurn = 0;
  player.shikigamiDestroyedBaseDefenseThisTurn = 0;
  for (const item of player.hand) item.fusedThisTurn = false;
}

function beginPlanningTurn(player, opponent, playerIndex, enemyIndex, stats, rng, map) {
  player.isActive = true;
  opponent.isActive = false;
  player.personalTurn += 1;
  resetPlanningTurnState(player);
  player.maxPp = Math.min(10, player.maxPp + 1);
  player.pp = player.maxPp;
  if (player.goingSecond && player.personalTurn === 6 && player.bonusPpUses < 2) player.bonusPpAvailable = true;
  readyBoard(player);
  turnStart(player, opponent, playerIndex, enemyIndex, stats, rng, map);
  if (player.hp <= 0 || opponent.hp <= 0) return false;
  drawCards(player, 1, stats, playerIndex);
  if (player.deckOut) {
    player.hp = 0;
    return false;
  }
  useBonusPpIfUseful(player, opponent);
  return player.hp > 0 && opponent.hp > 0;
}

function finishPlanningTurn(player, opponent, playerIndex, enemyIndex, stats, rng, map) {
  turnEnd(player, opponent, playerIndex, enemyIndex, stats, rng, map);
  stats.ppWasted[playerIndex] += Math.max(0, Math.min(player.pp, player.maxPp));
  player.isActive = false;
}

function executePlannerSequence(state, sequence, map, seed) {
  let steps = 0;
  for (const action of sequence ?? []) {
    if (action.kind === "end" || steps++ >= MAX_ACTIONS) break;
    const outcome = executePlannerAction(state, action, map, createRng(`${seed}|${steps}|${actionKey(action)}`));
    if (!outcome.applied || state.player.hp <= 0 || state.opponent.hp <= 0) break;
  }
  return state;
}

function resampleFutureScenario(candidateState, seed) {
  const scenario = clonePlanningState(candidateState);
  const rng = createRng(seed);

  // Our hand is known to us, but the future draw order is not.
  shuffle(scenario.player.deck, rng);

  // Opponent hand identities are hidden. Only the public hand count and the
  // remaining unknown-zone multiset are preserved; hand/deck identity is
  // resampled independently for each future scenario.
  const opponentHandCount = scenario.opponent.hand.length;
  const unknown = [...scenario.opponent.hand, ...scenario.opponent.deck];
  shuffle(unknown, rng);
  scenario.opponent.hand = unknown.slice(0, opponentHandCount);
  scenario.opponent.deck = unknown.slice(opponentHandCount);
  return scenario;
}

function simulateOneOpponentResponse(candidateState, map, seed) {
  const state = resampleFutureScenario(candidateState, `${seed}|unknown`);
  const original = state.player;
  const enemy = state.opponent;
  const originalIndex = state.playerIndex;
  const enemyIndex = state.enemyIndex;
  const rng = createRng(`${seed}|future-events`);

  finishPlanningTurn(original, enemy, originalIndex, enemyIndex, state.stats, rng, map);
  if (original.hp <= 0) return { value: -100000, survived: false, state };
  if (enemy.hp <= 0) return { value: 100000, survived: true, state };

  if (!beginPlanningTurn(enemy, original, enemyIndex, originalIndex, state.stats, rng, map)) {
    return { value: original.hp > 0 ? 100000 : -100000, survived: original.hp > 0, state };
  }

  const responseState = {
    player: enemy,
    opponent: original,
    playerIndex: enemyIndex,
    enemyIndex: originalIndex,
    stats: state.stats
  };
  const responsePlan = planCurrentTurnBase(
    { ...responseState, map },
    { depth: 1, beamWidth: 1, candidateLimit: 1 }
  );
  executePlannerSequence(responseState, responsePlan.sequence, map, `${seed}|response`);
  if (original.hp <= 0) return { value: -100000, survived: false, state };
  if (enemy.hp <= 0) return { value: 100000, survived: true, state };

  finishPlanningTurn(enemy, original, enemyIndex, originalIndex, state.stats, rng, map);
  if (original.hp <= 0) return { value: -100000, survived: false, state };
  if (enemy.hp <= 0) return { value: 100000, survived: true, state };

  if (!beginPlanningTurn(original, enemy, originalIndex, enemyIndex, state.stats, rng, map)) {
    return { value: original.hp > 0 ? 100000 : -100000, survived: original.hp > 0, state };
  }

  // Reaching our following turn is the second ply. Evaluate that real state and
  // its best immediate option instead of launching another beam tree: this keeps
  // future reasoning bounded while still valuing saved cards and next-turn plays.
  const nextState = {
    player: original,
    opponent: enemy,
    playerIndex: originalIndex,
    enemyIndex,
    stats: state.stats
  };
  const immediateOptions = [
    ...scoredPlayOptions(original, enemy, false).slice(0, 1).map(option => option.score),
    ...getFuseActions(original, enemy, map).slice(0, 1).map(option => option.score),
    ...enumerateEvolutionDecisions(original, enemy).slice(0, 1).map(option => option.prior),
    ...enumerateAttackDecisions(original, enemy).slice(0, 1).map(option => option.prior)
  ];
  const nextActionValue = immediateOptions.length ? Math.max(...immediateOptions) : scorePassDecision(original, enemy);
  const nextScore = plannerStateValue(nextState, false) + Math.max(-10, Math.min(30, nextActionValue)) * .18;
  return { value: nextScore, survived: original.hp > 0, state, responsePlan, nextPlan: null };
}

function uniqueFirstActionCandidates(candidates, limit = 3) {
  const seen = new Set();
  const out = [];
  for (const candidate of candidates ?? []) {
    const first = candidate.sequence?.[0] ?? { kind: "end" };
    const key = actionKey(first);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
    if (out.length >= limit) break;
  }
  return out;
}

function buildFutureFirstActionCandidates({ player, opponent, playerIndex, enemyIndex, stats, map }, options = {}) {
  const { state: root, seed } = makePlanningRoot({ player, opponent, playerIndex, enemyIndex, stats });
  const rootActions = enumeratePlannerActions(root.player, root.opponent, map);
  const limit = Math.max(2, Math.min(5, Number(options.futureCandidateLimit ?? 4) || 4));
  const selected = [];
  const seen = new Set();
  for (const action of rootActions) {
    const key = actionKey(action);
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(action);
    if (selected.length >= limit) break;
  }
  if (!selected.some(action => action.kind === "end")) selected.push({ kind: "end", prior: scorePassDecision(root.player, root.opponent) });

  const candidates = [];
  for (const first of selected) {
    if (first.kind === "end") {
      candidates.push({
        state: clonePlanningState(root),
        sequence: [first],
        priorTotal: Number(first.prior) || 0,
        score: plannerStateValue(root, true)
      });
      continue;
    }

    const child = clonePlanningState(root);
    const firstRng = createRng(`${seed}|future-first|${actionKey(first)}`);
    const outcome = executePlannerAction(child, first, map, firstRng);
    if (!outcome.applied) continue;
    const sequence = [first];
    let priorTotal = Math.max(-20, Math.min(40, Number(first.prior) || 0));

    if (child.player.hp > 0 && child.opponent.hp > 0) {
      const continuation = planCurrentTurnBase(
        { ...child, map },
        {
          depth: Math.max(1, Math.min(3, Number(options.futureContinuationDepth ?? 2) || 2)),
          beamWidth: 2,
          candidateLimit: 1
        }
      );
      const remaining = continuation.sequence ?? [];
      executePlannerSequence(child, remaining, map, `${seed}|future-continuation|${actionKey(first)}`);
      sequence.push(...remaining);
    }

    candidates.push({
      state: child,
      sequence,
      priorTotal,
      score: plannerStateValue(child, true) + priorTotal * .14
    });
  }
  return candidates.sort((a,b)=>b.score-a.score);
}

function shouldUseTwoTurnLookahead(base, player, opponent, options) {
  if (options.disableFuture) return false;
  const candidates = uniqueFirstActionCandidates(base.candidates, 3);
  if (candidates.length < 2) return false;
  if (options.forceFuture) return true;
  if (player.futureLookaheadUsedThisTurn) return false;
  if (player.personalTurn < 4) return false;

  const incoming = estimateVisibleIncomingDamage(player, opponent);
  const margin = player.hp - incoming;
  const topGap = Math.abs((candidates[0]?.score ?? 0) - (candidates[1]?.score ?? 0));
  const style = String(player.strategy?.style ?? "midrange");
  const resourceSensitive = style === "control" || style === "ward-control" || style === "spell-combo" || style === "ramp";

  // Future search is a critical-decision layer, not something to run after every
  // action. One deep check per real turn is enough; the full-turn beam planner
  // handles ordinary sequencing. This keeps 100-1000 game benchmarks practical.
  if (margin <= 4) return true;
  return resourceSensitive && player.personalTurn >= 5 && player.hand.length >= 3 && topGap <= 2.5;
}

function evaluateCandidateFuture(candidate, player, opponent, map, options) {
  if (candidate.state?.opponent?.hp <= 0) return { combined: 100000, future: 100000, worst: 100000, samples: 0 };
  if (candidate.state?.player?.hp <= 0) return { combined: -100000, future: -100000, worst: -100000, samples: 0 };

  const defaultSamples = options.forceFuture ? 2 : 1;
  const sampleCount = Math.max(1, Math.min(2, Number(options.futureSamples ?? defaultSamples) || defaultSamples));
  const seedBase = `${planningPublicSeed(player, opponent)}|${candidate.sequence.map(actionKey).join(">")}`;
  const values = [];
  for (let index = 0; index < sampleCount; index += 1) {
    values.push(simulateOneOpponentResponse(candidate.state, map, `${seedBase}|scenario:${index}`).value);
  }
  const worst = Math.min(...values);
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (worst <= -90000) {
    return { combined: -90000 + candidate.score * .02, future: average, worst, samples: sampleCount };
  }
  const robustFuture = average * .65 + worst * .35;
  const combined = candidate.score * .72 + robustFuture * .28;
  return { combined, future: robustFuture, worst, samples: sampleCount };
}

function planCurrentTurn({ player, opponent, playerIndex, enemyIndex, stats, map }, options = {}) {
  const input = { player, opponent, playerIndex, enemyIndex, stats, map };
  const base = planCurrentTurnBase(
    input,
    { ...options, candidateLimit: Math.max(4, Number(options.candidateLimit ?? 4) || 4) }
  );
  const futureCandidates = buildFutureFirstActionCandidates(input, options);
  const futureBase = { ...base, candidates: futureCandidates };
  if (!shouldUseTwoTurnLookahead(futureBase, player, opponent, options)) {
    return { ...base, futureEvaluated: false, immediateScore: base.score, futureScore: null, worstFutureScore: null, futureDiagnostics: [] };
  }

  const candidates = uniqueFirstActionCandidates(futureCandidates, 4);
  const evaluated = candidates.map(candidate => ({
    candidate,
    ...evaluateCandidateFuture(candidate, player, opponent, map, options)
  })).sort((a,b)=>b.combined-a.combined || b.candidate.score-a.candidate.score);
  const best = evaluated[0];
  return {
    sequence: best?.candidate?.sequence ?? base.sequence,
    score: best?.combined ?? base.score,
    explored: base.explored,
    candidates: futureCandidates,
    futureEvaluated: true,
    immediateScore: best?.candidate?.score ?? base.score,
    futureScore: best?.future ?? null,
    worstFutureScore: best?.worst ?? null,
    futureSamples: best?.samples ?? 0,
    futureDiagnostics: evaluated.map(entry => ({
      firstAction: actionKey(entry.candidate.sequence?.[0] ?? { kind: "end" }),
      immediate: entry.candidate.score,
      future: entry.future,
      worst: entry.worst,
      combined: entry.combined
    }))
  };
}

function plannerActionView(action, state) {
  if (action.kind === "play") {
    const item = state.player.hand.find(entry => entry.uid === action.instanceUid);
    return { kind: "play", card: item?.card?.name ?? null, target: action.targetPlan?.enemyName ?? null };
  }
  if (action.kind === "fuse") {
    const target = state.player.hand.find(entry => entry.uid === action.targetUid);
    return { kind: "fuse", card: target?.card?.name ?? null };
  }
  if (action.kind === "engage") {
    const unit = state.player.board.find(entry => entry.uid === action.unitUid);
    return { kind: "engage", card: unit?.name ?? null };
  }
  if (action.kind === "evolve") {
    const unit = state.player.board.find(entry => entry.uid === action.unitUid);
    return { kind: action.superMode ? "super-evolve" : "evolve", card: unit?.name ?? null, target: action.targetPlan?.enemyName ?? null };
  }
  if (action.kind === "attack") {
    const attacker = state.player.board.find(entry => entry.uid === action.attackerUid);
    const target = action.leader ? "leader" : state.opponent.board.find(entry => entry.uid === action.targetUid)?.name;
    return { kind: "attack", card: attacker?.name ?? null, target: target ?? null };
  }
  return { kind: "end", card: null, target: null };
}

export function inspectTurnPlan({
  hand = [], deck = [], board = [], opponentBoard = [], opponentHand = [], opponentDeck = [], pp = 0, maxPp = pp, hp = 20, opponentHp = 20,
  personalTurn = 5, goingFirst = true, goingSecond = false, ep = 2, sep = 2,
  opponentPersonalTurn = 0, opponentMaxPp = 0, opponentEp = 2, opponentSep = 2,
  strategy = {}, opponentStrategy = {}, depth = 4, beamWidth = 4, future = false, futureSamples = 2
} = {}) {
  const allCards = [...hand, ...deck, ...opponentHand, ...opponentDeck, ...board.map(value => value.card).filter(Boolean), ...opponentBoard.map(value => value.card).filter(Boolean)];
  const map = new Map(allCards.filter(Boolean).map(card => [Number(card.id), card]));
  const rng = createRng("inspect-turn-plan");
  const player = makePlayer("You", [], strategy, map, rng);
  const opponent = makePlayer("Opponent", [], opponentStrategy, map, rng);
  player.isActive = true;
  opponent.isActive = false;
  player.goingFirst = Boolean(goingFirst);
  player.goingSecond = Boolean(goingSecond);
  player.personalTurn = Math.max(1, Number(personalTurn) || 1);
  player.pp = Math.max(0, Number(pp) || 0);
  player.maxPp = Math.max(0, Number(maxPp) || 0);
  player.hp = Number(hp) || 0;
  player.ep = Math.max(0, Number(ep) || 0);
  player.sep = Math.max(0, Number(sep) || 0);
  opponent.hp = Number(opponentHp) || 0;
  opponent.goingFirst = !player.goingFirst;
  opponent.goingSecond = !player.goingSecond;
  opponent.personalTurn = Math.max(0, Number(opponentPersonalTurn) || 0);
  opponent.maxPp = Math.max(0, Number(opponentMaxPp) || 0);
  opponent.pp = opponent.maxPp;
  opponent.ep = Math.max(0, Number(opponentEp) || 0);
  opponent.sep = Math.max(0, Number(opponentSep) || 0);

  player.hand = hand.map(card => instance(player, card));
  player.deck = deck.map(card => instance(player, card));
  opponent.hand = opponentHand.map(card => instance(opponent, card));
  opponent.deck = opponentDeck.map(card => instance(opponent, card));
  const makeUnit = (spec, owner, prefix, index) => {
    const card = spec.card ?? {
      id: spec.id ?? (-20000 - index), name: spec.name ?? `${prefix} ${index + 1}`, class: "Neutral", type: "Follower",
      cost: Number(spec.cost) || 1, attack: Number(spec.attack) || 0, defense: Number(spec.defense) || 1,
      text: spec.text ?? "", keywords: [...(spec.keywords ?? [])], traits: []
    };
    const unit = boardFollower(instance(owner, card));
    unit.name = spec.name ?? card.name;
    unit.attack = Number(spec.attack ?? unit.attack) || 0;
    unit.defense = Number(spec.defense ?? unit.defense) || 1;
    unit.maxDefense = Number(spec.maxDefense ?? unit.defense) || unit.defense;
    unit.summonedThisTurn = Boolean(spec.summonedThisTurn);
    unit.canAttackLeader = spec.canAttackLeader ?? (!unit.summonedThisTurn || has(card, "Storm"));
    unit.canAttackFollower = spec.canAttackFollower ?? (!unit.summonedThisTurn || has(card, "Rush") || has(card, "Storm"));
    unit.attacked = Boolean(spec.attacked);
    unit.attacksMade = Number(spec.attacksMade) || 0;
    unit.permanentAttackLock = Boolean(spec.permanentAttackLock);
    if (spec.permanentAttackLock) { unit.canAttackLeader = false; unit.canAttackFollower = false; }
    return unit;
  };
  player.board = board.map((spec, index) => makeUnit(spec, player, "Ally", index));
  opponent.board = opponentBoard.map((spec, index) => makeUnit(spec, opponent, "Enemy", index));
  const state = { player, opponent, playerIndex: 0, enemyIndex: 1, stats: createStats() };
  const plan = planCurrentTurn({ ...state, map }, { depth, beamWidth, disableFuture: !future, forceFuture: future, futureSamples });

  // Decode views against a cloned state as the plan advances, so transformed or
  // removed objects still produce useful QA labels.
  const viewState = clonePlanningState(state);
  const views = [];
  for (const action of plan.sequence) {
    views.push(plannerActionView(action, viewState));
    if (action.kind === "end") break;
    executePlannerAction(viewState, action, map, createRng(`inspect-view:${views.length}`));
  }
  return {
    sequence: views,
    score: plan.score,
    explored: plan.explored,
    lethalSolved: Boolean(plan.lethalSolved),
    lethalSearchExplored: Number(plan.lethalSearchExplored) || 0,
    futureEvaluated: Boolean(plan.futureEvaluated),
    immediateScore: plan.immediateScore ?? plan.score,
    futureScore: plan.futureScore ?? null,
    worstFutureScore: plan.worstFutureScore ?? null,
    futureSamples: plan.futureSamples ?? 0,
    futureDiagnostics: plan.futureDiagnostics ?? []
  };
}

export function inspectTwoTurnPlan(options = {}) {
  return inspectTurnPlan({ ...options, future: true });
}

// [[battle-fuse-v1]]
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

function modes(inst, player) {
  const card = inst.card;
  const text = String(card.text ?? "");
  if (/\bcan'?t be played\b/i.test(text)) return [];
  const base = costOf(inst);
  const out = [];
  const canUseFieldSlot = card.type === "Spell" || player.board.length < 5;
  const milteoSuppressesEntryAbilities = card.type === "Follower" && hasCrest(player, "Milteo & Luzen");
  const enhance = [...text.matchAll(/Enhance\s*\(?\s*(\d+)\s*\)?\s*:/gi)]
    .map(match => Number(match[1]))
    .filter(cost => cost <= player.pp)
    .sort((a,b)=>b-a);
  if (enhance.length && !milteoSuppressesEntryAbilities) {
    if (!canUseFieldSlot) return out;
    const cost = enhance[0];
    for (const choice of expandModes(section(text, `enhance ${cost}`), player)) out.push({ kind: choice.i ? "mode" : "enhance", cost, text: choice.text, modeIndex: choice.i, selectedModeCount: choice.selectedModeCount ?? 0, scoreBonus: 5, enhanced: true });
    return out;
  }

  // Accelerate and Crystallize are fallback play modes: they are available only
  // when the card itself cannot be paid at its current effective cost.
  if (base <= player.pp) {
    if (canUseFieldSlot) {
      for (const choice of expandModes(baseText(text), player)) out.push({ kind: choice.i ? "mode" : "base", cost: base, text: choice.text, modeIndex: choice.i, selectedModeCount: choice.selectedModeCount ?? 0, scoreBonus: 0 });
    }
    return out;
  }

  const crystallizeCosts = [...text.matchAll(/Crystallize\s*\(?\s*(\d+)\s*\)?\s*:?/gi)]
    .map(match => Number(match[1]))
    .filter(cost => cost <= player.pp);
  const accelerateCosts = [...text.matchAll(/Accelerate\s*\(?\s*(\d+)\s*\)?\s*:/gi)]
    .map(match => Number(match[1]))
    .filter(cost => cost <= player.pp);
  const highestAlternativeCost = Math.max(-1, ...crystallizeCosts, ...accelerateCosts);
  if (highestAlternativeCost < 0) return out;

  if (player.board.length < 5 && crystallizeCosts.includes(highestAlternativeCost)) {
    out.push({ kind: "crystallize", cost: highestAlternativeCost, text: crystallizeText(text, highestAlternativeCost), modeIndex: 0, scoreBonus: 5 });
  }
  if (accelerateCosts.includes(highestAlternativeCost)) {
    for (const choice of expandModes(section(text, `accelerate ${highestAlternativeCost}`), player)) {
      out.push({ kind: choice.i ? "mode" : "accelerate", cost: highestAlternativeCost, text: choice.text, modeIndex: choice.i, selectedModeCount: choice.selectedModeCount ?? 0, scoreBonus: 4, accelerated: true });
    }
  }
  return out;
}

function costOf(inst) {
  let cost = (Number(inst.card.cost) || 0) + (Number(inst.costDelta) || 0);
  const text = norm(inst.card.text);
  const reduction = Number(text.match(/(?:on )?spellboost\s*:\s*(?:subtract|reduce)(?: the cost of this card by)?\s*(\d+)/i)?.[1] ?? 0);
  if (reduction) cost -= reduction * (Number(inst.spellboost) || 0);
  else if (/(?:on )?spellboost\s*:\s*subtract 1 from this card'?s cost/.test(text)) cost -= Number(inst.spellboost) || 0;
  return Math.max(0, cost);
}

function expandModes(text, player = null) {
  const raw = String(text ?? "");
  const choices = [...raw.matchAll(/(?:^|\s)(\d+)\.\s*/g)];
  const select = raw.match(/select\s+(a|an|one|two|three|four|five|\d+)\s+modes?\s+to activate/i);
  if (!select || !choices.length) return [{ i: 0, text: raw, selectedModeCount: 0 }];

  const segments = choices.map((match, index) => ({
    number: Number(match[1]),
    bit: 1 << Math.max(0, Number(match[1]) - 1),
    text: raw.slice(match.index + match[0].length, choices[index + 1]?.index ?? raw.length).split(/\b(?:Evolve|Super-Evolve|Last Words|Strike|Engage)\s*:/i)[0].trim()
  }));
  const baseCount = Math.max(1, word(select[1]) || Number(select[1]) || 1);
  const bonus = Math.max(0, Number(player?.abyssFaithModeBonus) || 0);
  const count = Math.min(segments.length, baseCount + bonus);
  const combinations = [];
  const visit = (start, picked) => {
    if (picked.length === count) { combinations.push([...picked]); return; }
    for (let index = start; index <= segments.length - (count - picked.length); index += 1) {
      picked.push(segments[index]);
      visit(index + 1, picked);
      picked.pop();
    }
  };
  visit(0, []);
  return combinations.map(combo => ({
    i: combo.reduce((mask, choice) => mask | choice.bit, 0),
    text: combo.map(choice => choice.text).filter(Boolean).join(" "),
    selectedModeCount: combo.length,
    selectedModeIndices: combo.map(choice => choice.number)
  }));
}

function stripFuseAbilityText(textValue) {
  return String(textValue ?? "")
    .replace(/^\s*Fuse\s*:[^\n]*(?:\n+|$)/gim, "")
    .replace(/^\s*When you Fuse to this card,[^\n]*(?:\n+|$)/gim, "")
    .replace(/^\s*When you've Fused both to this card,[^\n]*(?:\n+|$)/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function baseText(text) {
  const clean = stripFuseAbilityText(text);
  const fanfare = section(clean, "fanfare");
  if (fanfare) return fanfare;
  const value = String(clean);
  const colonIndex = value.search(/\b(?:Last Words|Strike|Clash|Evolve|Super-Evolve|Enhance|Accelerate|Crystallize|Engage|On Spellboost|At the start of your turn|At the end of your turn)\s*\(?\s*\d*\s*\)?\s*:/i);
  const naturalIndex = value.search(/(?<!["“])\b(?:At the end of your turn|At the start of your turn|When this follower evolves),\s*/i);
  const indexes = [colonIndex, naturalIndex].filter(index => index >= 0);
  const index = indexes.length ? Math.min(...indexes) : -1;
  return index < 0 ? value : value.slice(0, index).trim();
}

function crystallizeText(textValue, cost) {
  const text = String(textValue ?? "");
  const regex = new RegExp(`Crystallize\\s*\\(?\\s*${cost}\\s*\\)?\\s*:`, "i");
  const match = regex.exec(text);
  if (!match) return "";
  const tail = text.slice(match.index + match[0].length);
  const next = tail.search(/\b(?:Fanfare|Evolve|Super-Evolve|Enhance\s*\(?\s*\d+\s*\)?|Accelerate\s*\(?\s*\d+\s*\)?|Engage|On Spellboost|At the start of your turn|At the end of your turn)\s*:/i);
  return (next < 0 ? tail : tail.slice(0, next)).trim();
}

function section(textValue, label) {
  const text = String(textValue);
  const target = norm(label).replace(/[()]/g, "");
  const regex = /(Last Words|On Spellboost|Super-Evolve|Evolve|Strike|Clash|Fanfare|At the start of your turn|At the end of your turn|Enhance\s*\(?\s*\d+\s*\)?|Accelerate\s*\(?\s*\d+\s*\)?|Crystallize\s*\(?\s*\d+\s*\)?|Engage\s*\(?\s*\d*\s*\)?)\s*:/gi;
  const markers = [];
  let match;
  while ((match = regex.exec(text))) markers.push({ label: norm(match[1]).replace(/[()]/g, ""), start: match.index, end: regex.lastIndex });
  const hit = markers.find(marker => marker.label === target);
  if (!hit) return "";
  const next = markers.find(marker => marker.start > hit.start);
  const tailEnd = next?.start ?? text.length;
  const tail = text.slice(hit.end, tailEnd);
  const natural = tail.search(/(?<!["“])\b(?:at the end of your turn|at the start of your turn|when this follower evolves),\s*/i);
  return (natural < 0 ? tail : tail.slice(0, natural)).trim();
}

function targetableEnemyFollowers(board) {
  return board.filter(unit => unit.type === "Follower" && !unit.aura && !unit.ambush);
}

function targetEffectSpec(item) {
  const text = String(item?.mode?.text || item?.instance?.card?.text || "");
  let match = text.match(/deal\s+(\d+)\s+damage to (?:an|a|the) enemy follower/i);
  if (match) return { kind: "damage", amount: Number(match[1]) || 0 };
  if (/destroy (?:an|a|the) enemy follower/i.test(text)) return { kind: "destroy", amount: 0 };
  if (/banish (?:an|a|the) enemy follower/i.test(text)) return { kind: "banish", amount: 0 };
  if (/return (?:an|a|the) enemy follower to (?:its owner'?s|their) hand/i.test(text)) return { kind: "return", amount: 0 };
  if (/deal X damage to (?:an|a|the) enemy follower/i.test(text)) return { kind: "damage", amount: Math.max(0, Number(item?.instance?.x) || 0), x: true };

  match = text.match(/select an enemy follower(?: on the field)? and deal it\s+(\d+)\s+damage/i);
  if (match) return { kind: "damage", amount: Number(match[1]) || 0, selectedGrammar: true };
  if (/select an enemy follower(?: on the field)? and destroy it/i.test(text)) return { kind: "destroy", amount: 0, selectedGrammar: true };
  if (/select an enemy follower(?: on the field)? and banish it/i.test(text)) return { kind: "banish", amount: 0, selectedGrammar: true };
  // [[battle-forestcraft-target-branches]]
  if (/select an enemy follower(?: on the field)? and transform it into/i.test(text)) return { kind: "transform", amount: 0, selectedGrammar: true };
  if (/select an enemy follower(?: on the field)? and give it -0\/-X/i.test(text)) return { kind: "debuff", amount: 0, selectedGrammar: true };
  return null;
}

function followerThreatValue(unit) {
  if (!unit) return 0;
  const attack = Math.max(0, Number(unit.attack) || 0);
  const defense = Math.max(0, Number(unit.defense) || 0);
  const text = norm(unit.card?.text ?? "");
  return attack * 2.5 + defense
    + (hasU(unit, "Ward") ? 2.5 : 0)
    + (hasU(unit, "Bane") ? 2.5 : 0)
    + (hasU(unit, "Storm") ? 2 : 0)
    + (unit.evolved ? 1.5 : 0)
    + (unit.superEvolved ? 2.5 : 0)
    + (/at the (?:start|end) of your turn|whenever|once on each/.test(text) ? 2 : 0);
}

function targetBranchValue(plan, opponent) {
  if (!plan?.enemyUid) return 0;
  const unit = opponent.board.find(item => item.uid === plan.enemyUid);
  if (!unit) return -6;
  const threat = followerThreatValue(unit);
  const text = norm(unit.card?.text ?? "");
  const lastWords = /last words\s*:/.test(text);
  const fanfare = /fanfare\s*:/.test(text);
  if (plan.kind === "banish") return 8 + threat + (lastWords ? 7 : 0);
  if (plan.kind === "destroy") return 8 + threat - (lastWords ? 4 : 0);
  if (plan.kind === "return") return 5 + threat + Math.max(0, Number(unit.card?.cost) || 0) * .6 - (fanfare ? 3 : 0);
  if (plan.kind === "transform") return 9 + threat + (lastWords ? 7 : 0);
  if (plan.kind === "debuff") return 5 + threat * .7;
  if (plan.kind === "damage") {
    const amount = Math.max(0, Number(plan.amount) || 0);
    const barrier = Math.max(0, Number(unit.barrier) || 0) > 0;
    const kill = !barrier && amount >= Math.max(1, Number(unit.defense) || 1);
    const effective = barrier ? 0 : Math.min(amount, Math.max(0, Number(unit.defense) || 0));
    const overkill = kill ? Math.max(0, amount - Math.max(0, Number(unit.defense) || 0)) : 0;
    return (kill ? 12 + threat : effective * .9 + threat * .16) - overkill * .35;
  }
  return 0;
}

function expandPlayTargetBranches(item, opponent) {
  const spec = targetEffectSpec(item);
  if (!spec) return [{ ...item, targetPlan: null }];
  const targets = targetableEnemyFollowers(opponent.board);
  if (!targets.length) return [{ ...item, targetPlan: null }];
  return targets.map(unit => ({
    ...item,
    targetPlan: { enemyUid: unit.uid, enemyName: unit.name, kind: spec.kind, amount: spec.amount, selectedGrammar: Boolean(spec.selectedGrammar) }
  }));
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
function bindHavencraftRuntime(player, opponent, playerIndex, enemyIndex, stats, rng, map) {
  const value = { player, opponent, playerIndex, enemyIndex, stats, rng, cardMap: map };
  if (Object.prototype.hasOwnProperty.call(player, "__havencraftRuntime")) player.__havencraftRuntime = value;
  else Object.defineProperty(player, "__havencraftRuntime", { value, writable: true, configurable: true, enumerable: false });
}

function applyHavencraftDrawTriggers(player, item) {
  const ctx = player?.__havencraftRuntime;
  if (!ctx || !player.isActive || !item?.card) return [];
  const actions = [];
  for (const unit of [...player.board].filter(unit => unit.type === "Follower")) {
    const name = norm(unit.name);
    if (name === "bouquet believer") {
      giveKeyword(unit, "Rush");
      actions.push("Bouquet Believer: gain Rush");
    }
    if (name === "desperate shrinemouse") {
      for (const enemy of [...ctx.opponent.board].filter(target => target.type === "Follower")) damageUnit(enemy, 1, ctx.opponent, player, ctx, actions);
      actions.push("Desperate Shrinemouse: 1 damage to all enemy followers");
    }
  }
  const kukishiro = (player.crests ?? []).find(crest => norm(crest.name) === "kukishiro, mistbloom");
  const cost = Math.max(0, Number(item.card.cost) || 0);
  if (kukishiro && cost >= 1 && cost <= 6) {
    const names = ["Fox of Purity", "Holy Falcon"];
    const token = findByName(ctx.cardMap, names[Math.floor(ctx.rng() * names.length)]) ?? findByName(ctx.cardMap, names[0]);
    if (token) {
      if (cost % 2 === 1) {
        const count = summonWithEvents(player, token, 1, ctx.playerIndex, ctx);
        actions.push(`Kukishiro Crest: summon ${count ? token.name : "no allied follower"}`);
      } else {
        const enemyCtx = { ...ctx, player: ctx.opponent, opponent: player, playerIndex: ctx.enemyIndex, enemyIndex: ctx.playerIndex };
        const count = summonWithEvents(ctx.opponent, token, 1, ctx.enemyIndex, enemyCtx);
        actions.push(`Kukishiro Crest: summon enemy ${count ? token.name : "no follower"}`);
      }
    }
  }
  actions.push(...cleanup(ctx.opponent, player, ctx.enemyIndex, ctx.playerIndex, ctx.stats, ctx.rng, ctx.cardMap));
  return uniq(actions);
}

function applyHavencraftEngageTriggers(ctx) {
  const actions = [];
  for (const unit of ctx.player.board.filter(unit => unit.type === "Follower")) {
    const name = norm(unit.name);
    if (name === "tikoh, asclepian surgeon") {
      const healed = healPlayer(ctx.player, 1, ctx.stats, ctx.playerIndex);
      actions.push(`Tikoh: restore ${healed} leader defense`);
      if (healed) actions.push(...afterLeaderHeal(ctx.player, healed, ctx.stats, ctx.playerIndex));
    }
    if (name === "mainyu, darkdweller") {
      unit.attack += 1;
      unit.havencraftTempAttackBonus = (Number(unit.havencraftTempAttackBonus) || 0) + 1;
      actions.push("Mainyu: +1/+0 this turn");
    }
    if (name === "troue, heroic visionary") {
      giveKeyword(unit, "Drain");
      actions.push("Troue: gain Drain");
    }
  }
  for (const item of ctx.player.hand ?? []) {
    if (norm(item.card?.name) !== "skyfaring vessel") continue;
    item.costDelta = (Number(item.costDelta) || 0) - 1;
    actions.push("Skyfaring Vessel: cost -1");
  }
  return uniq(actions);
}

function applyHavencraftSuperEvolveHandTriggers(player) {
  const actions = [];
  for (const item of player.hand ?? []) {
    if (norm(item.card?.name) !== "viche, abyssal researcher") continue;
    item.costDelta = (Number(item.costDelta) || 0) - 3;
    actions.push("Viche, Abyssal Researcher: cost -3");
  }
  return actions;
}

function applyHavencraftMarkedEndTurnBanish(player) {
  const actions = [];
  for (const unit of [...(player.board ?? [])]) {
    if (!unit.himekaBanishAtOwnTurnEnd) continue;
    banish(player, unit);
    actions.push(`Himeka: banish ${unit.name} at end of its controller's turn`);
  }
  return actions;
}

function dealHavenSplitDamage(ctx, amount, actions, label) {
  let remaining = Math.max(0, Number(amount) || 0);
  const original = remaining;
  while (remaining > 0) {
    const followers = ctx.opponent.board.filter(unit => unit.type === "Follower");
    const slots = followers.length + 1;
    const pick = Math.floor(ctx.rng() * slots);
    if (pick >= followers.length) {
      const dealt = damageLeader(ctx.opponent, 1);
      ctx.stats.damageDealt[ctx.playerIndex] += dealt;
    } else damageUnit(followers[pick], 1, ctx.opponent, ctx.player, ctx, actions);
    remaining -= 1;
    actions.push(...cleanup(ctx.opponent, ctx.player, ctx.enemyIndex, ctx.playerIndex, ctx.stats, ctx.rng, ctx.cardMap));
  }
  actions.push(`${label}: ${original} split damage`);
}

function drawDefenseFourFollower(ctx) {
  return drawMatchingCard(ctx.player, card => card.type === "Follower" && Number(card.defense) === 4, ctx.stats, ctx.playerIndex, ctx.rng);
}

function havencraftCrestLastWords(crest, player, opponent, playerIndex, enemyIndex, stats, rng, map, actions) {
  const name = norm(crest?.name);
  if (name === "maddening benison") {
    const before = player.hp;
    player.hp -= 10;
    actions.push(`Maddening Benison Crest Last Words: ${Math.max(0, before - player.hp)} damage to your leader`);
    return true;
  }
  if (name === "zoe, dazzling hope") {
    if (player.board.length >= 5) { actions.push("Zoe Crest: field full"); return true; }
    const card = crest.card ?? findByName(map, "Zoe, Dazzling Hope");
    if (!card) return true;
    const unit = boardFollower(instance(player, card));
    player.board.push(unit); player.rally += 1;
    const ctx = { player, opponent, playerIndex, enemyIndex, stats, rng, cardMap: map };
    actions.push("Zoe Crest: summon Zoe");
    actions.push(...applyEntryEvents(ctx, unit));
    evolveUnitByAbility(ctx, unit, actions);
    return true;
  }
  return false;
}

function applyHavencraftCrestTurnEnd(player, opponent, playerIndex, enemyIndex, stats, rng, map, onlyCrest = null) {
  const actions = [];
  const ctx = { player, opponent, playerIndex, enemyIndex, stats, rng, cardMap: map };
  for (const crest of onlyCrest ? [onlyCrest] : [...(player.crests ?? [])]) {
    const name = norm(crest.name);
    if (name === "devotee of repose" && !player.followersAttackedThisTurn) {
      const candidates = player.board.filter(unit => unit.type === "Follower");
      if (candidates.length) {
        const unit = candidates[Math.floor(rng() * candidates.length)];
        unit.attack = Math.max(0, unit.attack - 2);
        giveKeyword(unit, "Ward");
        actions.push(`Devotee Crest: -2/-0 and Ward ${unit.name}`);
      }
    }
    if (name === "marwynn, despair manifest" && !player.followersAttackedThisTurn) {
      dealHavenSplitDamage(ctx, (player.crests ?? []).length, actions, "Marwynn Crest");
    }
    if (name === "congregant of repose" && !player.followersAttackedThisTurn) {
      const drawn = drawDefenseFourFollower(ctx);
      actions.push(`Congregant Crest: draw ${drawn?.card?.name ?? "no defense-4 follower"}`);
    }
    if (name === "himeka, heir to repose" && player.board.some(unit => norm(unit.name) === "himeka, heir to repose")) {
      let eligible = opponent.board.filter(unit => unit.type === "Follower" && Number(unit.attack) <= 4 && !unit.himekaBanishAtOwnTurnEnd);
      let count = Math.min((player.crests ?? []).length, eligible.length);
      while (count-- > 0 && eligible.length) {
        const index = Math.floor(rng() * eligible.length);
        const unit = eligible.splice(index, 1)[0];
        unit.permanentAttackLock = true;
        unit.canAttackLeader = false;
        unit.canAttackFollower = false;
        unit.himekaBanishAtOwnTurnEnd = true;
        actions.push(`Himeka Crest: lock ${unit.name}`);
      }
    }
  }
  return uniq(actions);
}

function resolveHavencraftCardText(raw, ctx) {
  let text = String(raw ?? "").trim();
  const actions = [];
  const name = norm(ctx.card?.name);

  if (name === "torrent of despair") {
    const banishClause = /Banish a random enemy follower from the field\.?/i;
    if (banishClause.test(text)) {
      const target = chooseRandomTarget(ctx.opponent.board, ctx.rng);
      if (target) { banish(ctx.opponent, target); actions.push(`Torrent of Despair: banish ${target.name}`); }
      text = text.replace(banishClause, " ");
    }
    const delay = /Delay the counts of all your crests by 1\.?/i;
    if (delay.test(text)) {
      let count = 0;
      for (const crest of ctx.player.crests ?? []) if (Number.isFinite(crest.countdown)) { crest.countdown += 1; count += 1; }
      actions.push(`Torrent of Despair: delay ${count} Crest${count === 1 ? "" : "s"}`);
      text = text.replace(delay, " ");
    }
  }

  if (name === "temple of repose" || name === "shining disenchantment") {
    const engageAdvance = /Advance this amulet'?s count by X\.\s*X is the number of crests you have\.?/i;
    if (engageAdvance.test(text) && ctx.sourceUnit) {
      const amount = (ctx.player.crests ?? []).length;
      if (Number.isFinite(ctx.sourceUnit.countdown)) ctx.sourceUnit.countdown -= amount;
      actions.push(`${ctx.card.name}: advance count by ${amount}`);
      text = text.replace(engageAdvance, " ");
      if (ctx.sourceUnit.countdown <= 0 && ctx.player.board.includes(ctx.sourceUnit)) actions.push(...destroyObject(ctx.player, ctx.opponent, ctx.sourceUnit, ctx.playerIndex, ctx.enemyIndex, ctx.stats, ctx.rng, ctx.cardMap, true));
    }
    if (name === "temple of repose") {
      const lw = /Restore 2 defense to your leader\.\s*Give your leader Barrier\.?/i;
      if (lw.test(text)) {
        const healed = healPlayer(ctx.player, 2, ctx.stats, ctx.playerIndex);
        if (healed) actions.push(...afterLeaderHeal(ctx.player, healed, ctx.stats, ctx.playerIndex));
        ctx.player.leaderBarrier = 1;
        actions.push(`Temple of Repose: restore ${healed} and leader Barrier`);
        text = text.replace(lw, " ");
      }
    } else {
      const lw = /Deal 4 damage split between all enemies\.\s*Restore 4 defense to your leader\.?/i;
      if (lw.test(text)) {
        dealHavenSplitDamage(ctx, 4, actions, "Shining Disenchantment");
        const healed = healPlayer(ctx.player, 4, ctx.stats, ctx.playerIndex);
        if (healed) actions.push(...afterLeaderHeal(ctx.player, healed, ctx.stats, ctx.playerIndex));
        actions.push(`Shining Disenchantment: restore ${healed}`);
        text = text.replace(lw, " ");
      }
    }
  }

  if (name === "skyfaring vessel") {
    const engage = /Destroy this card\.\s*Select an unevolved allied follower on the field and evolve it\.?/i;
    if (engage.test(text) && ctx.sourceUnit) {
      const candidates = ctx.player.board.filter(unit => unit.type === "Follower" && !unit.evolved && !unit.superEvolved);
      if (ctx.player.board.includes(ctx.sourceUnit)) actions.push(...destroyObject(ctx.player, ctx.opponent, ctx.sourceUnit, ctx.playerIndex, ctx.enemyIndex, ctx.stats, ctx.rng, ctx.cardMap, true));
      const target = candidates.sort((a,b)=>(Number(b.attack)+Number(b.defense))-(Number(a.attack)+Number(a.defense)))[0] ?? null;
      if (target) evolveUnitByAbility(ctx, target, actions);
      text = text.replace(engage, " ");
    }
  }

  if (name === "himeka, heir to repose") {
    const clause = /Set the attack of all enemy followers on the field to 4\.?/i;
    if (clause.test(text)) {
      for (const unit of ctx.opponent.board.filter(unit => unit.type === "Follower")) unit.attack = 4;
      actions.push("Himeka: set all enemy follower attack to 4");
      text = text.replace(clause, " ");
    }
  }

  if (name === "kukishiro, mistbloom") {
    const crest = /Gain Crest:\s*Kukishiro, Mistbloom\.?/i;
    if (crest.test(text)) {
      if (gainCrest(ctx.player, "Kukishiro, Mistbloom", ctx.card)) actions.push("Crest: Kukishiro, Mistbloom");
      text = text.replace(crest, " ");
    }
    const cycle = /Return 2 random cards from your hand to deck\.\s*Draw 2 cards\.?/i;
    if (cycle.test(text)) {
      const returned = [];
      for (let i = 0; i < 2 && ctx.player.hand.length; i += 1) {
        const index = Math.floor(ctx.rng() * ctx.player.hand.length);
        const item = ctx.player.hand.splice(index, 1)[0];
        ctx.player.deck.push(item); returned.push(item.card.name);
      }
      shuffle(ctx.player.deck, ctx.rng);
      const drawn = drawCards(ctx.player, 2, ctx.stats, ctx.playerIndex);
      actions.push(`Kukishiro: return ${returned.length}, draw ${drawn}`);
      text = text.replace(cycle, " ");
    }
  }

  if (name === "lyanthoth, eld tome") {
    ctx.player.havenFaithActive = true;
    const fanfare = /Select 3 other cards on the field and destroy them\.?/i;
    if (fanfare.test(text)) {
      const enemy = ctx.opponent.board.map(unit => ({ owner: ctx.opponent, unit, enemy: true })).sort((a,b)=>(Number(b.unit.attack)+Number(b.unit.defense))-(Number(a.unit.attack)+Number(a.unit.defense)));
      const allied = ctx.player.board.filter(unit => unit !== ctx.sourceUnit).map(unit => ({ owner: ctx.player, unit, enemy: false })).sort((a,b)=>(Number(a.unit.attack)+Number(a.unit.defense))-(Number(b.unit.attack)+Number(b.unit.defense)));
      const selected = [...enemy, ...allied].slice(0, 3);
      for (const entry of selected) actions.push(...destroyObject(entry.owner, entry.owner === ctx.player ? ctx.opponent : ctx.player, entry.unit, entry.owner === ctx.player ? ctx.playerIndex : ctx.enemyIndex, entry.owner === ctx.player ? ctx.enemyIndex : ctx.playerIndex, ctx.stats, ctx.rng, ctx.cardMap, true));
      actions.push(`Lyanthoth: destroy ${selected.length} other cards`);
      text = text.replace(fanfare, " ");
    }
    const payment = /reduce your faith'?s value by 10 to add a Depths of the Eld Tome to your hand\.?/i;
    if (payment.test(text)) {
      if ((Number(ctx.player.faith) || 0) >= 10) {
        ctx.player.faith -= 10;
        const token = findByName(ctx.cardMap, "Depths of the Eld Tome") ?? related(ctx.card, ctx.cardMap).find(card => norm(card.name) === "depths of the eld tome");
        const added = token ? addHand(ctx.player, token, 1, ctx.playerIndex, ctx.stats) : 0;
        if (added) ctx.stats.cardsGenerated[ctx.playerIndex] += added;
        actions.push(`Lyanthoth: Faith -10 · add ${added ? "Depths of the Eld Tome" : "no card"}`);
      } else actions.push(`Lyanthoth: Faith ${ctx.player.faith}/10`);
      text = text.replace(payment, " ");
    }
  }

  if (name === "depths of the eld tome") {
    const clause = /Select a card on the field and destroy it\.\s*If you selected an allied amulet, deal 2 damage to the enemy leader and add a Depths of the Eld Tome to your hand\.?/i;
    if (clause.test(text)) {
      const alliedAmulet = ctx.player.board.find(unit => unit.type === "Amulet") ?? null;
      const enemy = choosePlannedTarget(ctx, ctx.opponent.board);
      const target = alliedAmulet ?? enemy ?? ctx.player.board.find(unit => unit !== ctx.sourceUnit) ?? null;
      if (target) {
        const owner = ctx.player.board.includes(target) ? ctx.player : ctx.opponent;
        const wasAlliedAmulet = owner === ctx.player && target.type === "Amulet";
        actions.push(...destroyObject(owner, owner === ctx.player ? ctx.opponent : ctx.player, target, owner === ctx.player ? ctx.playerIndex : ctx.enemyIndex, owner === ctx.player ? ctx.enemyIndex : ctx.playerIndex, ctx.stats, ctx.rng, ctx.cardMap, true));
        if (wasAlliedAmulet) {
          const dealt = damageLeader(ctx.opponent, 2); ctx.stats.damageDealt[ctx.playerIndex] += dealt;
          const token = findByName(ctx.cardMap, "Depths of the Eld Tome") ?? ctx.card;
          const added = addHand(ctx.player, token, 1, ctx.playerIndex, ctx.stats); if (added) ctx.stats.cardsGenerated[ctx.playerIndex] += added;
          actions.push(`Depths of the Eld Tome: ${dealt} leader damage · add ${added ? "copy" : "no card"}`);
        }
      }
      text = text.replace(clause, " ");
    }
  }

  return { text: text.replace(/\s+/g, " ").trim(), actions: uniq(actions) };
}

// [[battle-neutral-full-rules]]
function replaceWithMjerrabaineDeck(ctx, actions) {
  const cards = [...ctx.cardMap.values()]
    .filter(card => Number(card?.setId) === 10003 && Number(card?.baseCardId ?? card?.id) !== 10304110 && !card?.token);
  // The official Mjerrabaine Deck is exactly one copy of every other Heirs of
  // the Omen main-set card: 76 real cards. The bottom Reaper is represented by
  // mjerrabaineVictoryOnEmpty and becomes the conceptual Victory card.
  ctx.player.deck = cards.map(card => instance(ctx.player, card));
  shuffle(ctx.player.deck, ctx.rng);
  ctx.player.deckOut = false;
  ctx.player.specialVictory = false;
  ctx.player.mjerrabaineVictoryOnEmpty = true;
  actions.push(`Mjerrabaine Crest: replace deck with ${ctx.player.deck.length}-card Mjerrabaine Deck`);
}

function replaceWithApocalypseDeck(ctx, actions) {
  const spec = [
    ["Silent Rider", 3],
    ["Servant of Cocytus", 3],
    ["Demon of Purgatory", 3],
    ["Astaroth's Reckoning", 1]
  ];
  const next = [];
  for (const [name, count] of spec) {
    const card = findByName(ctx.cardMap, name);
    if (!card) continue;
    for (let index = 0; index < count; index += 1) next.push(instance(ctx.player, card));
  }
  ctx.player.deck = next;
  shuffle(ctx.player.deck, ctx.rng);
  ctx.player.deckOut = false;
  ctx.player.specialVictory = false;
  ctx.player.mjerrabaineVictoryOnEmpty = false;
  actions.push(`Ruler of Cocytus: replace deck with ${next.length}-card Apocalypse Deck`);
}

function applyNeutralCardPlayedTriggers(ctx) {
  const actions = [];
  if (!ctx?.card) return actions;
  const baseCost = Math.max(0, Number(ctx.card.cost) || 0);
  const field = [...(ctx.player.board ?? []), ...(ctx.opponent.board ?? [])];
  for (const amulet of [...(ctx.player.board ?? [])].filter(unit => unit.type === "Amulet" && norm(unit.name) === "world of games")) {
    // A World of Games does not trigger for the event that put that same copy
    // onto the field, but older copies do trigger when another World is played.
    if (ctx.sourceUnit && amulet.uid === ctx.sourceUnit.uid) continue;
    const match = field.some(unit => (!ctx.sourceUnit || unit.uid !== ctx.sourceUnit.uid) && Math.max(0, Number(unit.card?.cost) || 0) === baseCost);
    if (!match || !Number.isFinite(amulet.countdown)) continue;
    amulet.countdown -= 1;
    actions.push(`World of Games: countdown ${Math.max(0, amulet.countdown)}`);
  }
  return actions;
}

function neutralCrestLastWords(crest, player, opponent, playerIndex, enemyIndex, stats, rng, map, actions) {
  if (norm(crest?.name) !== "illamrita, designated target") return false;
  if (player.board.length >= 5) {
    actions.push("Illamrita Crest: field full, summon skipped");
    return true;
  }
  const card = crest.card ?? findByName(map, "Illamrita, Designated Target");
  if (!card) return true;
  const unit = boardFollower(instance(player, card));
  player.board.push(unit);
  player.rally += 1;
  const ctx = { player, opponent, playerIndex, enemyIndex, stats, rng, cardMap: map };
  actions.push(`Illamrita Crest: summon ${unit.name}`);
  actions.push(...applyEntryEvents(ctx, unit));
  evolveUnitByAbility(ctx, unit, actions);
  return true;
}

function applyNeutralMarkedEndTurnBanish(player) {
  const actions = [];
  for (const unit of [...(player.board ?? [])]) {
    if (!unit.illamritaBanishAtOwnTurnEnd) continue;
    banish(player, unit);
    actions.push(`Illamrita: banish ${unit.name} at end of its controller's turn`);
  }
  return actions;
}

function applyNeutralCrestTurnEnd(player, opponent, playerIndex, enemyIndex, stats, rng, map, onlyCrest = null) {
  const actions = [];
  if (onlyCrest && norm(onlyCrest.name) !== "mjerrabaine, great manifest") return actions;
  if (!hasCrest(player, "Mjerrabaine, Great Manifest")) return actions;
  const kept = [];
  const discarded = [];
  for (const item of player.hand ?? []) {
    if (norm(item.card?.name) === "great testimony") kept.push(item);
    else discarded.push(item);
  }
  player.hand = kept;
  const ctx = { player, opponent, playerIndex, enemyIndex, stats, rng, cardMap: map };
  for (const item of discarded) {
    toCemetery(player, item, false);
    triggerDiscardedCard(ctx, item, actions);
  }
  if (discarded.length) actions.push(`Mjerrabaine Crest: discard ${discarded.length} non-Testimony card${discarded.length === 1 ? "" : "s"}`);
  const drawn = drawCards(player, 6, stats, playerIndex);
  actions.push(`Mjerrabaine Crest: draw ${drawn}${player.specialVictory ? " · Victory" : ""}`);
  return uniq(actions);
}

function resolveNeutralCardText(raw, ctx) {
  let text = String(raw ?? "").trim();
  const actions = [];
  const name = norm(ctx.card?.name);

  if (name === "encroached world") {
    const clause = /Select a card in your hand and transform it into an exact copy of a random card in your opponent'?s deck\.?/i;
    if (clause.test(text)) {
      const target = ctx.player.hand?.[0] ?? null;
      const opponentCard = ctx.opponent.deck?.length ? ctx.opponent.deck[Math.floor(ctx.rng() * ctx.opponent.deck.length)]?.card : null;
      if (target && opponentCard) {
        transformHandInstance(target, opponentCard);
        actions.push(`Encroached World: transform hand card into ${opponentCard.name}`);
      } else actions.push("Encroached World: no valid hand/deck transformation");
      text = text.replace(clause, " ");
    }
  }

  if (name === "mjerrabaine, great manifest") {
    const clause = /Gain Crest:\s*Mjerrabaine, Great Manifest\.?/i;
    if (clause.test(text)) {
      if (gainCrest(ctx.player, "Mjerrabaine, Great Manifest", ctx.card)) replaceWithMjerrabaineDeck(ctx, actions);
      text = text.replace(clause, " ");
    }
  }

  if (name === "illamrita, designated target") {
    if (ctx.opposingFollower && /Give this follower Barrier/i.test(text)) {
      giveKeyword(ctx.sourceUnit, "Barrier");
      ctx.opposingFollower.permanentAttackLock = true;
      ctx.opposingFollower.canAttackLeader = false;
      ctx.opposingFollower.canAttackFollower = false;
      ctx.opposingFollower.illamritaBanishAtOwnTurnEnd = true;
      actions.push(`Illamrita: Barrier · lock ${ctx.opposingFollower.name} · banish at turn end`);
      text = "";
    }
    const crestClause = /Gain Crest:\s*Illamrita, Designated Target\.?/i;
    if (crestClause.test(text)) {
      if (gainCrest(ctx.player, "Illamrita, Designated Target", ctx.card)) actions.push("Crest: Illamrita, Designated Target");
      text = text.replace(crestClause, " ");
    }
  }

  if (name === "alabaster bahamut") {
    const followers = /Banish all other followers from the field\.?/i;
    const amulets = /Banish all amulets from the field\.?/i;
    const crests = /Banish all crests\.?/i;
    if (followers.test(text)) {
      let count = 0;
      for (const owner of [ctx.player, ctx.opponent]) for (const unit of [...owner.board]) {
        if (unit.type !== "Follower" || unit === ctx.sourceUnit) continue;
        banish(owner, unit); count += 1;
      }
      actions.push(`Alabaster Bahamut: banish ${count} other followers`);
      text = text.replace(followers, " ");
    }
    if (amulets.test(text)) {
      let count = 0;
      for (const owner of [ctx.player, ctx.opponent]) for (const unit of [...owner.board]) {
        if (unit.type !== "Amulet") continue;
        banish(owner, unit); count += 1;
      }
      actions.push(`Alabaster Bahamut: banish ${count} amulets`);
      text = text.replace(amulets, " ");
    }
    if (crests.test(text)) {
      const count = (ctx.player.crests?.length ?? 0) + (ctx.opponent.crests?.length ?? 0);
      ctx.player.crests = [];
      ctx.opponent.crests = [];
      actions.push(`Alabaster Bahamut: banish ${count} Crests`);
      text = text.replace(crests, " ");
    }
  }

  if (name === "ruler of cocytus") {
    const clause = /Replace your deck with the Apocalypse Deck\.?/i;
    if (clause.test(text)) {
      replaceWithApocalypseDeck(ctx, actions);
      text = text.replace(clause, " ");
    }
  }

  if (name === "astaroth's reckoning") {
    const clause = /Set the enemy leader'?s max defense to 1\.?/i;
    if (clause.test(text)) {
      ctx.opponent.maxHp = 1;
      ctx.opponent.hp = Math.min(ctx.opponent.hp, 1);
      actions.push("Astaroth's Reckoning: enemy max defense set to 1");
      text = text.replace(clause, " ");
    }
  }

  return { text: text.replace(/\s+/g, " ").trim(), actions: uniq(actions) };
}

// [[battle-portalcraft-full-rules]]
function isPortalArtifactFollower(unit) {
  return unit?.type === "Follower" && hasTrait(unit.card, "Artifact");
}

function isPortalPuppetryFollower(unit) {
  return unit?.type === "Follower" && hasTrait(unit.card, "Puppetry");
}

function isBaseCostAtLeast(unit, amount) {
  return unit?.type === "Follower" && (Number(unit.card?.cost) || 0) >= Number(amount);
}

function applyPortalTemporaryCost(item, delta) {
  if (!item) return;
  item.costDelta = (Number(item.costDelta) || 0) + Number(delta || 0);
  item.portalcraftTempCostDelta = (Number(item.portalcraftTempCostDelta) || 0) + Number(delta || 0);
}

function applyPortalTemporaryCostToHand(player, delta) {
  for (const item of player.hand ?? []) applyPortalTemporaryCost(item, delta);
}

function restorePortalcraftTemporaryCosts(player) {
  for (const item of player.hand ?? []) {
    const delta = Number(item.portalcraftTempCostDelta) || 0;
    if (!delta) continue;
    item.costDelta = (Number(item.costDelta) || 0) - delta;
    delete item.portalcraftTempCostDelta;
  }
}

function applyPortalcraftEntryEvents(ctx, unit) {
  const actions = [];
  if (!unit || unit.type !== "Follower") return actions;
  // [[battle-high-risk-artifact-history]]
  if ((unit.card?.traits ?? []).some(trait => norm(trait) === "artifact")) {
    ctx.player.artifactFollowerNamesEntered ??= [];
    ctx.player.artifactFollowerNamesEntered.push(norm(unit.name));
  }

  if (isPortalPuppetryFollower(unit) && ctx.player.isActive) {
    for (const source of ctx.player.board.filter(source => source.type === "Follower" && norm(source.name) === "medical-grade assassin")) {
      if (source.__medicalPuppetryTriggerTurn === ctx.player.personalTurn) continue;
      source.__medicalPuppetryTriggerTurn = ctx.player.personalTurn;
      giveKeyword(unit, "Bane");
      actions.push(`Medical-Grade Assassin: ${unit.name} gains Bane`);
    }
  }

  if (isPortalArtifactFollower(unit)) {
    for (const source of ctx.player.board.filter(source => source.type === "Follower")) {
      const sourceName = norm(source.name);
      if (sourceName === "brusque barkeep") {
        const healed = healPlayer(ctx.player, 1, ctx.stats, ctx.playerIndex);
        actions.push(`Brusque Barkeep: restore ${healed} leader defense`);
        if (healed) actions.push(...afterLeaderHeal(ctx.player, healed, ctx.stats, ctx.playerIndex));
      }
      if (sourceName === "myuu, hot on his heels") {
        const target = chooseRandomTarget(ctx.opponent.board, ctx.rng);
        if (target) {
          damageUnit(target, 3, ctx.opponent, ctx.player, ctx, actions);
          actions.push(`Myuu: 3 damage to ${target.name}`);
        }
      }
    }
  }

  if (isBaseCostAtLeast(unit, 5)) {
    for (const item of ctx.player.hand ?? []) {
      if (norm(item.card?.name) !== "unfeeling eld axe") continue;
      applyPortalTemporaryCost(item, -1);
      actions.push(`Unfeeling Eld Axe: cost -1 (${costOf(item)})`);
    }

    for (const source of ctx.player.board.filter(source => source.type === "Follower" && source !== unit && norm(source.name) === "camiscilla, unfeeling heart")) {
      if (unit.evolved || unit.superEvolved) break;
      evolveUnitByAbility(ctx, unit, actions);
      actions.push(`Camiscilla: evolve ${unit.name}`);
    }
  }

  return uniq(actions);
}

function applyPortalcraftSpellPlayedTriggers(ctx) {
  const actions = [];
  for (const source of ctx.player.board.filter(unit => unit.type === "Follower" && norm(unit.name) === "flowering artisan")) {
    const targets = [...ctx.opponent.board].filter(unit => unit.type === "Follower");
    for (const target of targets) damageUnit(target, 3, ctx.opponent, ctx.player, ctx, actions);
    actions.push(`Flowering Artisan: 3 damage to ${targets.length} enemy follower${targets.length === 1 ? "" : "s"}`);
  }
  return uniq(actions);
}

function chooseUnusedPortalMode(container, key, rng) {
  const used = new Set((container?.[key] ?? []).map(Number));
  const remaining = [1, 2, 3].filter(value => !used.has(value));
  if (!remaining.length) return null;
  const mode = remaining[Math.floor(rng() * remaining.length)];
  container[key] = [...used, mode];
  return mode;
}

function applyPortalcraftSlausMode(owner, opponent, ownerIndex, enemyIndex, stats, rng, map, mode, positive, actions) {
  if (mode === 1) {
    const delta = positive ? -1 : 1;
    applyPortalTemporaryCostToHand(owner, delta);
    actions.push(`Slaus: hand costs ${delta > 0 ? "+1" : "-1"} until turn end`);
    return;
  }
  if (mode === 2) {
    const delta = positive ? 2 : -2;
    for (const unit of owner.board.filter(unit => unit.type === "Follower")) {
      unit.attack = Math.max(0, (Number(unit.attack) || 0) + delta);
      unit.defense += delta;
      unit.maxDefense += delta;
    }
    actions.push(`Slaus: allied followers ${delta > 0 ? "+2/+2" : "-2/-2"}`);
    return;
  }
  if (mode === 3) {
    if (positive) {
      const healed = healPlayer(owner, 3, stats, ownerIndex);
      actions.push(`Slaus: restore ${healed} leader defense`);
      if (healed) actions.push(...afterLeaderHeal(owner, healed, stats, ownerIndex));
    } else {
      const dealt = damageLeader(owner, 3);
      stats.damageDealt[enemyIndex] += dealt;
      actions.push(`Slaus Crest: ${dealt} damage to leader`);
    }
  }
}

function applyPortalcraftPreTickCrestTurnStart(player, opponent, playerIndex, enemyIndex, stats, rng, map, onlyCrest = null) {
  const actions = [];
  const crest = onlyCrest
    ? (norm(onlyCrest.name) === "slaus, revolving wheel of fortune" ? onlyCrest : null)
    : (player.crests ?? []).find(item => norm(item.name) === "slaus, revolving wheel of fortune");
  if (!crest || (Number(crest.gainedTurn) || 0) >= player.personalTurn) return actions;
  const mode = chooseUnusedPortalMode(crest, "portalSlausUsedModes", rng);
  if (mode == null) return actions;
  applyPortalcraftSlausMode(player, opponent, playerIndex, enemyIndex, stats, rng, map, mode, false, actions);
  return uniq(actions);
}

function applyPortalcraftCrestTurnEnd(player, opponent, playerIndex, enemyIndex, stats, rng, map, onlyCrest = null) {
  const actions = [];
  if (onlyCrest && norm(onlyCrest.name) !== "eudie, maiden reborn") return actions;
  if (!hasCrest(player, "Eudie, Maiden Reborn")) return actions;
  if ((player.hand?.length ?? 0) <= 5) {
    const drawn = drawCards(player, 1, stats, playerIndex);
    actions.push(`Eudie Crest: draw ${drawn}`);
  } else {
    const healed = healPlayer(player, 1, stats, playerIndex);
    actions.push(`Eudie Crest: restore ${healed} leader defense`);
    if (healed) actions.push(...afterLeaderHeal(player, healed, stats, playerIndex));
  }
  return uniq(actions);
}

function resolvePortalcraftCardText(raw, ctx) {
  let text = String(raw ?? "").trim();
  const actions = [];
  const name = norm(ctx.card?.name);

  if (name === "slaus, revolving wheel of fortune" && ctx.sourceUnit) {
    if (/activate a random ability that hasn'?t been activated yet/i.test(text)) {
      const mode = chooseUnusedPortalMode(ctx.sourceUnit, "portalSlausUsedStartModes", ctx.rng);
      if (mode != null) applyPortalcraftSlausMode(ctx.player, ctx.opponent, ctx.playerIndex, ctx.enemyIndex, ctx.stats, ctx.rng, ctx.cardMap, mode, true, actions);
      else actions.push("Slaus: all start-turn abilities already activated");
      text = "";
    }

    const endClause = /if this follower is evolved, give your opponent Crest\s*:\s*Slaus, Revolving Wheel of Fortune and banish this card\.?/i;
    if (endClause.test(text)) {
      if (ctx.sourceUnit.evolved || ctx.sourceUnit.superEvolved) {
        if (gainCrest(ctx.opponent, "Slaus, Revolving Wheel of Fortune", ctx.card)) actions.push("Opponent Crest: Slaus, Revolving Wheel of Fortune");
        banish(ctx.player, ctx.sourceUnit);
        actions.push("Slaus: banish this card");
      }
      text = text.replace(endClause, " ");
    }
  }

  if (name === "unfeeling eld axe") {
    const clause = /evolve a random unevolved allied follower on the field with a base cost of 5 or more\.\s*Deal 6 damage to a random enemy follower\.?/i;
    if (clause.test(text)) {
      const candidates = ctx.player.board.filter(unit => isBaseCostAtLeast(unit, 5) && !unit.evolved && !unit.superEvolved);
      if (candidates.length) {
        const unit = candidates[Math.floor(ctx.rng() * candidates.length)];
        evolveUnitByAbility(ctx, unit, actions);
      }
      const target = chooseRandomTarget(ctx.opponent.board, ctx.rng);
      if (target) damageUnit(target, 6, ctx.opponent, ctx.player, ctx, actions);
      actions.push(`Unfeeling Eld Axe: evolve ${candidates.length ? "base-5+ follower" : "none"} and deal ${target ? 6 : 0} damage`);
      text = text.replace(clause, " ");
    }
  }

  if (name === "myuu, hot on his heels") {
    const clause = /(?:Then,\s*)?if at least 3 differently named allied Artifact followers have entered the field this match, give this follower Storm\.?/i;
    if (clause.test(text)) {
      const count = new Set((ctx.player.artifactFollowerNamesEntered ?? []).map(norm)).size;
      if (count >= 3 && ctx.sourceUnit) giveKeyword(ctx.sourceUnit, "Storm");
      actions.push(`Myuu: Artifact history ${count}${count >= 3 ? " · gain Storm" : ""}`);
      text = text.replace(clause, " ");
    }
  }

  if (name === "camiscilla, unfeeling heart") {
    const clause = /deal X damage to the enemy leader\.\s*X is the number of allied followers on the field with a base cost of 5 or more\.?/i;
    if (clause.test(text)) {
      const x = ctx.player.board.filter(unit => isBaseCostAtLeast(unit, 5)).length;
      const dealt = damageLeader(ctx.opponent, x);
      ctx.stats.damageDealt[ctx.playerIndex] += dealt;
      actions.push(`Camiscilla: ${dealt} damage to enemy leader (X=${x})`);
      text = text.replace(clause, " ");
    }
  }

  return { text: text.replace(/\s+/g, " ").trim(), actions };
}


function boardFollower(inst) {
  const card = inst.card;
  const attack = (Number(card.attack) || 0) + (Number(inst.attackBonus) || 0);
  const defense = (Number(card.defense) || 0) + (Number(inst.defenseBonus) || 0);
  const keywords = [...new Set([...(card.keywords ?? []), ...(inst.grantedKeywords ?? [])])];
  const baseMaxAttacks = Number(String(card.text ?? "").match(/can attack (\d+) times per turn/i)?.[1] ?? 1);
  return {
    uid: inst.uid, cardId: Number(card.id), card, name: card.name, image: card.image, type: "Follower",
    attack, defense, maxDefense: defense, keywords,
    barrier: has(card, "Barrier") ? 1 : 0, ambush: has(card, "Ambush"), aura: has(card, "Aura"), intimidate: has(card, "Intimidate"),
    summonedThisTurn: true, canAttackLeader: has(card, "Storm"), canAttackFollower: has(card, "Storm") || has(card, "Rush"),
    attacked: false, attacksMade: 0, baseMaxAttacks, maxAttacks: baseMaxAttacks,
    evolved: false, superEvolved: false, reactedThisTurn: false, tempAttackPenalty: 0,
    fusedCards: [...(inst.fusedCards ?? [])], fusedNames: [...(inst.fusedNames ?? [])], x: Number(inst.x) || 0
  };
}

function boardAmulet(inst, overrideText = null, crystallized = false) {
  const card = inst.card;
  const text = overrideText ?? card.text;
  return {
    uid: inst.uid, cardId: Number(card.id), card, name: card.name, image: card.image, type: "Amulet",
    attack: 0, defense: 0, maxDefense: 0, countdown: getCountdown({ ...card, text }), keywords: [...(card.keywords ?? [])],
    engagedThisTurn: false, summonedThisTurn: true, attacked: true, evolved: false, superEvolved: false,
    overrideText: overrideText ?? null, crystallized
  };
}






// [[battle-abysscraft-full-rules]]
function recordAbyssModeSelection(player, selectedModeCount) {
  if (!player?.abyssFaithActive || Number(selectedModeCount) <= 0) return [];
  player.faith = (Number(player.faith) || 0) + 1;
  return [`Abyss Faith +1 (${player.faith})`];
}

function isDepartedFollower(unit) {
  return unit?.type === "Follower" && hasU(unit, "Departed");
}

function applyAbysscraftEntryEvents(ctx, unit) {
  const actions = [];
  if (!isDepartedFollower(unit)) return actions;
  for (const source of ctx.player.board.filter(source => source.type === "Follower" && source !== unit)) {
    const name = norm(source.name);
    if (name === "mukan, shadowcrypt ward") {
      giveKeyword(unit, "Bane");
      actions.push(`Mukan: ${unit.name} gains Bane`);
    }
    if (name === "charon, stygian oarswoman") {
      giveKeyword(unit, "Ward");
      actions.push(`Charon: ${unit.name} gains Ward`);
    }
    if (name === "beastmaster bones") {
      giveKeyword(unit, "Storm");
      actions.push(`Beastmaster Bones: ${unit.name} gains Storm`);
    }
    if (name === "macmillan, reaper of ceremonies" && ctx.player.isActive) {
      unit.attack += 1;
      giveKeyword(unit, "Rush");
      giveKeyword(unit, "Ward");
      const dealt = damageLeader(ctx.opponent, 1);
      ctx.stats.damageDealt[ctx.playerIndex] += dealt;
      actions.push(`Macmillan: ${unit.name} +1/+0, Rush, Ward · ${dealt} damage to enemy leader`);
    }
  }
  return uniq(actions);
}

function applyAbysscraftSuperEvolveTriggers(ctx, evolvedUnit) {
  const actions = [];
  if (!evolvedUnit?.superEvolved) return actions;
  for (const source of ctx.player.board.filter(unit => unit.type === "Follower" && unit !== evolvedUnit && norm(unit.name) === "vuella, the blastwing")) {
    source.attack += 2;
    evolvedUnit.attack += 2;
    actions.push(`Vuella: +2/+0 ${source.name} and ${evolvedUnit.name}`);
  }
  return actions;
}

function applyAbysscraftFollowerDestroyedEvents(owner, opponent, ownerIndex, opponentIndex, stats, destroyedUnit) {
  if (!destroyedUnit || norm(destroyedUnit.name) !== "skeleton") return [];
  const actions = [];
  for (const side of [
    { player: owner, index: ownerIndex, label: "owner" },
    { player: opponent, index: opponentIndex, label: "opponent" }
  ]) {
    for (const source of side.player.board.filter(unit => unit.type === "Follower" && norm(unit.name) === "lifestealer")) {
      const healed = healPlayer(side.player, 1, stats, side.index);
      actions.push(`Lifestealer (${side.label}): restore ${healed} leader defense`);
      if (healed) actions.push(...afterLeaderHeal(side.player, healed, stats, side.index));
    }
  }
  return actions;
}

function applyAbysscraftCrestTurnStart(player, opponent, playerIndex, enemyIndex, stats, rng, map, onlyCrest = null) {
  const actions = [];
  if (onlyCrest && norm(onlyCrest.name) !== "charon, stygian oarswoman") return actions;
  if (!hasCrest(player, "Charon, Stygian Oarswoman")) return actions;
  const unit = reanimate(player, 3, playerIndex, map, rng);
  if (!unit) return actions;
  actions.push(`Charon Crest: Reanimate ${unit.name}`);
  actions.push(...applyEntryEvents({ player, opponent, playerIndex, enemyIndex, stats, rng, cardMap: map }, unit));
  return uniq(actions);
}

function handHasFourSameCost(player) {
  const counts = new Map();
  for (const item of player.hand ?? []) {
    const cost = costOf(item);
    counts.set(cost, (counts.get(cost) ?? 0) + 1);
    if (counts.get(cost) >= 4) return true;
  }
  return false;
}

function applyAbysscraftCrestTurnEnd(player, opponent, playerIndex, enemyIndex, stats, rng, map, onlyCrest = null) {
  const actions = [];
  const ctx = { player, opponent, playerIndex, enemyIndex, stats, rng, cardMap: map };
  for (const crest of onlyCrest ? [onlyCrest] : [...(player.crests ?? [])]) {
    const name = norm(crest.name);
    if (name === "rigor of the nightblossom") {
      const drawn = drawCards(player, 1, stats, playerIndex);
      actions.push(`Rigor Crest: draw ${drawn}`);
      if (handHasFourSameCost(player)) {
        const skeleton = findByName(map, "Skeleton") ?? related(crest.card, map).find(card => norm(card.name) === "skeleton");
        const before = new Set(player.board.map(unit => unit.uid));
        if (skeleton) summonWithEvents(player, skeleton, 1, playerIndex, ctx);
        const unit = player.board.find(unit => !before.has(unit.uid) && norm(unit.name) === "skeleton");
        if (unit) {
          giveKeyword(unit, "Ward");
          actions.push("Rigor Crest: summon Skeleton with Ward");
        }
      }
    }
    if (name === "valiant edge") {
      const target = chooseRandomTarget(opponent.board, rng);
      if (target) {
        damageUnit(target, 2, opponent, player, ctx, actions);
        actions.push(`Valiant Edge Crest: 2 damage to ${target.name}`);
      }
      const healed = healPlayer(player, 1, stats, playerIndex);
      actions.push(`Valiant Edge Crest: restore ${healed} leader defense`);
      if (healed) actions.push(...afterLeaderHeal(player, healed, stats, playerIndex));
    }
    if (name === "balto, dusk bounty hunter") {
      const self = damageLeader(player, 1);
      const enemy = damageLeader(opponent, 1);
      stats.damageDealt[playerIndex] += enemy;
      actions.push(`Balto Crest: ${self} damage to your leader · ${enemy} damage to enemy leader`);
    }
    if (name === "corruption") {
      const self = damageLeader(player, 2);
      actions.push(`Corruption Crest: ${self} damage to your leader`);
    }
  }
  return uniq(actions);
}

function abysscraftCrestLastWords(crest, player, opponent, playerIndex, enemyIndex, stats, rng, map, actions) {
  if (norm(crest?.name) !== "belial, archangel of cunning") return false;
  const dealt = damageLeader(opponent, 20);
  stats.damageDealt[playerIndex] += dealt;
  actions.push(`Belial Crest Last Words: ${dealt} damage to enemy leader`);
  return true;
}

function destroyAbyssCrest(player, name, opponent, playerIndex, enemyIndex, stats, rng, map, actions = []) {
  const wanted = norm(name);
  const crest = (player.crests ?? []).find(item => norm(item.name) === wanted);
  if (!crest) return false;
  player.crests = player.crests.filter(item => item !== crest);
  if (wanted === "belial, archangel of cunning") abysscraftCrestLastWords(crest, player, opponent, playerIndex, enemyIndex, stats, rng, map, actions);
  return true;
}

function advanceAbyssCrest(player, name, amount, opponent, playerIndex, enemyIndex, stats, rng, map, actions = []) {
  const crest = (player.crests ?? []).find(item => norm(item.name) === norm(name));
  if (!crest || !Number.isFinite(crest.countdown)) return false;
  crest.countdown -= Math.max(0, Number(amount) || 0);
  actions.push(`${crest.name} Crest countdown ${Math.max(0, crest.countdown)}`);
  if (crest.countdown <= 0) destroyAbyssCrest(player, name, opponent, playerIndex, enemyIndex, stats, rng, map, actions);
  return true;
}

function transformFollowerInto(owner, target, card) {
  const index = owner.board.findIndex(unit => unit.uid === target.uid);
  if (index < 0 || !card) return null;
  const replacement = boardFollower(instance(owner, card));
  replacement.uid = target.uid;
  replacement.summonedThisTurn = target.summonedThisTurn;
  replacement.attacked = target.attacked;
  replacement.attacksMade = target.attacksMade;
  if (!replacement.summonedThisTurn) {
    replacement.canAttackLeader = !/can't attack followers or leaders/i.test(String(card.text ?? ""));
    replacement.canAttackFollower = replacement.canAttackLeader;
  }
  owner.board[index] = replacement;
  return replacement;
}

function resolveAbysscraftCardText(textValue, ctx) {
  if (!canUseClassRules(ctx.player, "Abysscraft", ctx.card)) return { text: String(textValue ?? ""), actions: [] };
  let text = String(textValue ?? "");
  const actions = [];
  const name = norm(ctx.card?.name);

  if (name === "sham-nacha, heir to entwining") {
    const faith = /Reduce your faith'?s value by 10 to give it "Increase the number of Modes you can select by 1\."/i;
    if (faith.test(text)) {
      if ((Number(ctx.player.faith) || 0) >= 10) {
        ctx.player.faith -= 10;
        ctx.player.abyssFaithModeBonus = (Number(ctx.player.abyssFaithModeBonus) || 0) + 1;
        actions.push(`Sham-Nacha: Faith -10 · Mode selections +1`);
      } else actions.push(`Sham-Nacha: Faith ${ctx.player.faith}/10`);
      text = text.replace(faith, " ");
    }
    const copyRemoval = /Select an enemy follower on the field, destroy it, and add a copy of it to your hand\.?/i;
    if (copyRemoval.test(text)) {
      const target = choosePlannedTarget(ctx, ctx.opponent.board);
      if (target) {
        const copied = addHand(ctx.player, target.card, 1, ctx.playerIndex, ctx.stats);
        if (copied) ctx.stats.cardsGenerated[ctx.playerIndex] += copied;
        destroyUnit(ctx.opponent, target);
        actions.push(`Sham-Nacha: destroy ${target.name} and add a copy`);
        actions.push(...cleanup(ctx.opponent, ctx.player, ctx.enemyIndex, ctx.playerIndex, ctx.stats, ctx.rng, ctx.cardMap));
      }
      text = text.replace(copyRemoval, " ");
    }
  }

  if (name === "corruption") {
    const base = /Give all followers on the field -2\/-2\.\s*Give yourself and your opponent Crest\s*:\s*Corruption\.?/i;
    if (base.test(text)) {
      for (const unit of ctx.player.board.filter(unit => unit.type === "Follower")) {
        unit.attack -= 2; unit.defense -= 2; unit.maxDefense -= 2;
      }
      for (const unit of ctx.opponent.board.filter(unit => unit.type === "Follower")) {
        unit.attack -= 2; unit.defense -= 2; unit.maxDefense -= 2;
      }
      gainCrest(ctx.player, "Corruption", ctx.card);
      gainCrest(ctx.opponent, "Corruption", ctx.card);
      actions.push("Corruption: all followers -2/-2 · both leaders gain Crest");
      text = text.replace(base, " ");
      actions.push(...cleanup(ctx.player, ctx.opponent, ctx.playerIndex, ctx.enemyIndex, ctx.stats, ctx.rng, ctx.cardMap));
      actions.push(...cleanup(ctx.opponent, ctx.player, ctx.enemyIndex, ctx.playerIndex, ctx.stats, ctx.rng, ctx.cardMap));
    }
    const destroy = /Destroy your Crest\s*:\s*Corruption\.?/i;
    if (destroy.test(text)) {
      if (destroyAbyssCrest(ctx.player, "Corruption", ctx.opponent, ctx.playerIndex, ctx.enemyIndex, ctx.stats, ctx.rng, ctx.cardMap, actions)) actions.push("Corruption: destroy own Crest");
      text = text.replace(destroy, " ");
    }
  }

  if (name === "beastmaster bones") {
    const sacrifice = /Select another allied follower on the field\.\s*If you selected one, destroy it and a random enemy follower\.?/i;
    if (sacrifice.test(text)) {
      const allies = ctx.player.board.filter(unit => unit.type === "Follower" && unit !== ctx.sourceUnit);
      const ally = [...allies].sort((a,b)=>(a.attack+a.defense)-(b.attack+b.defense))[0] ?? null;
      const enemy = chooseRandomTarget(ctx.opponent.board, ctx.rng);
      if (ally) {
        destroyUnit(ctx.player, ally);
        if (enemy) destroyUnit(ctx.opponent, enemy);
        actions.push(`Beastmaster Bones: destroy ${ally.name}${enemy ? ` and ${enemy.name}` : ""}`);
        actions.push(...cleanup(ctx.player, ctx.opponent, ctx.playerIndex, ctx.enemyIndex, ctx.stats, ctx.rng, ctx.cardMap));
        actions.push(...cleanup(ctx.opponent, ctx.player, ctx.enemyIndex, ctx.playerIndex, ctx.stats, ctx.rng, ctx.cardMap));
      }
      text = text.replace(sacrifice, " ");
    }
  }

  if (name === "belial, archangel of cunning") {
    const sweep = /Deal 10 damage to all other followers\.?/i;
    if (sweep.test(text)) {
      for (const unit of ctx.player.board.filter(unit => unit.type === "Follower" && unit !== ctx.sourceUnit)) damageUnit(unit, 10, ctx.player, ctx.opponent, ctx, actions);
      for (const unit of ctx.opponent.board.filter(unit => unit.type === "Follower")) damageUnit(unit, 10, ctx.opponent, ctx.player, ctx, actions);
      actions.push("Belial: 10 damage to all other followers");
      text = text.replace(sweep, " ");
    }
    const advance = /Advance the count of your Crest\s*:\s*Belial, Archangel of Cunning by 1\.?/i;
    if (advance.test(text)) {
      advanceAbyssCrest(ctx.player, "Belial, Archangel of Cunning", 1, ctx.opponent, ctx.playerIndex, ctx.enemyIndex, ctx.stats, ctx.rng, ctx.cardMap, actions);
      text = text.replace(advance, " ");
    }
  }

  if (name === "milteo & luzen") {
    const destroySix = /destroy 6 other random followers\.?/i;
    if (destroySix.test(text)) {
      const candidates = [
        ...ctx.player.board.filter(unit => unit.type === "Follower" && unit !== ctx.sourceUnit).map(unit => ({ owner: ctx.player, unit })),
        ...ctx.opponent.board.filter(unit => unit.type === "Follower").map(unit => ({ owner: ctx.opponent, unit }))
      ];
      let destroyed = 0;
      while (candidates.length && destroyed < 6) {
        const index = Math.floor(ctx.rng() * candidates.length);
        const { owner, unit } = candidates.splice(index, 1)[0];
        if (destroyUnit(owner, unit)) destroyed += 1;
      }
      actions.push(`Milteo & Luzen: destroy ${destroyed} other random follower${destroyed === 1 ? "" : "s"}`);
      actions.push(...cleanup(ctx.player, ctx.opponent, ctx.playerIndex, ctx.enemyIndex, ctx.stats, ctx.rng, ctx.cardMap));
      actions.push(...cleanup(ctx.opponent, ctx.player, ctx.enemyIndex, ctx.playerIndex, ctx.stats, ctx.rng, ctx.cardMap));
      text = text.replace(destroySix, " ");
    }
  }

  if (name === "lifestealer") {
    const transform = /Transform all other followers on the field into copies of Skeleton\.?/i;
    if (transform.test(text)) {
      const skeleton = findByName(ctx.cardMap, "Skeleton") ?? related(ctx.card, ctx.cardMap).find(card => norm(card.name) === "skeleton");
      let changed = 0;
      if (skeleton) {
        for (const unit of [...ctx.player.board].filter(unit => unit.type === "Follower" && unit !== ctx.sourceUnit)) if (transformFollowerInto(ctx.player, unit, skeleton)) changed += 1;
        for (const unit of [...ctx.opponent.board].filter(unit => unit.type === "Follower")) if (transformFollowerInto(ctx.opponent, unit, skeleton)) changed += 1;
      }
      actions.push(`Lifestealer: transform ${changed} other follower${changed === 1 ? "" : "s"} into Skeleton`);
      text = text.replace(transform, " ");
    }
    const sweep = /Deal 1 damage to all other followers\.?/i;
    if (sweep.test(text)) {
      for (const unit of ctx.player.board.filter(unit => unit.type === "Follower" && unit !== ctx.sourceUnit)) damageUnit(unit, 1, ctx.player, ctx.opponent, ctx, actions);
      for (const unit of ctx.opponent.board.filter(unit => unit.type === "Follower")) damageUnit(unit, 1, ctx.opponent, ctx.player, ctx, actions);
      actions.push("Lifestealer: 1 damage to all other followers");
      text = text.replace(sweep, " ");
    }
  }

  return { text: text.replace(/\s+/g, " ").trim(), actions };
}

// [[battle-dragoncraft-full-rules]]
function isMarineFollower(unit) {
  return unit?.type === "Follower" && (unit.card?.traits ?? []).some(trait => norm(trait) === "marine");
}

function drawMatchingCard(player, predicate, stats, index, rng) {
  const candidates = player.deck.filter(item => predicate(item.card));
  if (!candidates.length) return null;
  const item = candidates[Math.floor(rng() * candidates.length)];
  player.deck = player.deck.filter(entry => entry.uid !== item.uid);
  stats.draws[index] += 1;
  if (player.hand.length >= 9) {
    toCemetery(player, item, false);
    stats.cardsBurned[index] += 1;
    applyHavencraftDrawTriggers(player, item);
    return item;
  }
  player.hand.push(item);
  applyHavencraftDrawTriggers(player, item);
  return item;
}

function applyDragoncraftEntryEvents(ctx, unit) {
  const actions = [];
  if (!unit || unit.type !== "Follower") return actions;

  if (norm(unit.name) === "drache & aluzard, burning blood") {
    ctx.player.dracheEntriesThisMatch = (Number(ctx.player.dracheEntriesThisMatch) || 0) + 1;
    actions.push(`Drache & Aluzard entries this match: ${ctx.player.dracheEntriesThisMatch}`);
  }

  const marine = isMarineFollower(unit);
  if (marine && hasCrest(ctx.player, "Spirit of Wadatsumi")) {
    unit.attack += 1;
    unit.defense += 1;
    unit.maxDefense += 1;
    actions.push(`Spirit of Wadatsumi Crest: +1/+1 ${unit.name}`);
  }

  for (const source of ctx.player.board.filter(source => source.type === "Follower")) {
    const sourceName = norm(source.name);
    if (marine && sourceName === "jellyfish dancer") {
      giveKeyword(source, "Rush");
      giveKeyword(source, "Bane");
      actions.push(`Jellyfish Dancer: gains Rush and Bane after ${unit.name} enters`);
    }
    if (marine && sourceName === "ocean rider") {
      giveKeyword(unit, "Ward");
      actions.push(`Ocean Rider: ${unit.name} gains Ward`);
    }
    if (marine && sourceName === "stormy shamisen shredder") {
      const healed = healPlayer(ctx.player, 2, ctx.stats, ctx.playerIndex);
      actions.push(`Stormy Shamisen Shredder: restore ${healed} leader defense`);
      actions.push(...afterLeaderHeal(ctx.player, healed, ctx.stats, ctx.playerIndex));
    }
    if (sourceName === "meg, girl next door" && Number(unit.card?.cost) === 2) {
      giveKeyword(source, "Ward");
      actions.push(`Meg, Girl Next Door: gains Ward after base-2 ${unit.name} enters`);
    }
  }
  return uniq(actions);
}

function applyDragoncraftSuperEvolveHandTriggers(player, evolvedUnit) {
  const actions = [];
  for (const item of player.hand ?? []) {
    const name = norm(item.card?.name);
    if (name === "wise guardian dragon") {
      item.costDelta = (Number(item.costDelta) || 0) - 3;
      actions.push(`Wise Guardian Dragon: cost -3 (${costOf(item)})`);
    }
    if (name === "mari, meg's bestie" && Number(evolvedUnit?.card?.cost) === 3) {
      if (item.dragonMariOriginalCostDelta == null) item.dragonMariOriginalCostDelta = Number(item.costDelta) || 0;
      item.costDelta = -(Number(item.card?.cost) || 0);
      actions.push("Mari, Meg's Bestie: cost set to 0 until turn end");
    }
  }
  return actions;
}

function restoreDragoncraftTemporaryCosts(player) {
  for (const item of player.hand ?? []) {
    if (item.dragonMariOriginalCostDelta == null) continue;
    item.costDelta = Number(item.dragonMariOriginalCostDelta) || 0;
    delete item.dragonMariOriginalCostDelta;
  }
}

function applyDragoncraftAttackDeclaration(ctx, attacker, actions) {
  if (!isMarineFollower(attacker)) return;
  const crest = (ctx.player.crests ?? []).find(item => norm(item.name) === "yube, crestpetal");
  if (!crest) return;

  attacker.attack += 1;
  attacker.dragoncraftTempAttackBonus = (Number(attacker.dragoncraftTempAttackBonus) || 0) + 1;
  actions.push(`Yube Crest: ${attacker.name} +1/+0 until turn end`);

  if (crest.__marineAttackTurn === ctx.player.personalTurn) return;
  crest.__marineAttackTurn = ctx.player.personalTurn;
  const token = findByName(ctx.cardMap, "Majestic Megalorca") ?? related(crest.card, ctx.cardMap).find(card => norm(card.name) === "majestic megalorca");
  const added = token ? addHand(ctx.player, token, 1, ctx.playerIndex, ctx.stats) : 0;
  if (added) ctx.stats.cardsGenerated[ctx.playerIndex] += added;
  actions.push(`Yube Crest: add ${added ? "Majestic Megalorca" : "no card"}`);
}

function dragoncraftCrestLastWords(crest, player, opponent, playerIndex, enemyIndex, stats, rng, map, actions) {
  if (norm(crest?.name) !== "drache & aluzard, burning blood") return false;
  const card = crest.card ?? findByName(map, "Drache & Aluzard, Burning Blood");
  if (!card) return true;
  const item = instance(player, card);
  item.costDelta = 2 - (Number(card.cost) || 0);
  if (player.hand.length >= 9) {
    toCemetery(player, item, false);
    stats.cardsBurned[playerIndex] += 1;
    actions.push("Drache & Aluzard Crest Last Words: generated card burned");
    return true;
  }
  player.hand.push(item);
  stats.cardsGenerated[playerIndex] += 1;
  actions.push("Drache & Aluzard Crest Last Words: add cost-2 Drache & Aluzard");
  return true;
}

function applyDragoncraftFollowerTurnEnd(ctx, unit) {
  if (!unit || unit.type !== "Follower" || norm(unit.name) !== "mari, meg's bestie") return [];
  const candidates = ctx.player.board.filter(target => target.type === "Follower" && target.superEvolved);
  if (!candidates.length) return [];
  const target = candidates[Math.floor(ctx.rng() * candidates.length)];
  target.attack += 1;
  target.defense += 1;
  target.maxDefense += 1;
  return [`Mari, Meg's Bestie: +1/+1 ${target.name}`];
}

function applyDragoncraftCrestTurnEnd(player, opponent, playerIndex, enemyIndex, stats, rng, map, onlyCrest = null) {
  const actions = [];
  const ctx = { player, opponent, playerIndex, enemyIndex, stats, rng, cardMap: map };
  for (const crest of onlyCrest ? [onlyCrest] : [...(player.crests ?? [])]) {
    const name = norm(crest.name);
    if (name === "crescent tube ride") {
      const candidates = player.board.filter(unit => unit.type === "Follower");
      if (candidates.length) {
        const unit = candidates[Math.floor(rng() * candidates.length)];
        unit.attack += 1;
        unit.defense += 1;
        unit.maxDefense += 1;
        actions.push(`Crescent Tube Ride Crest: +1/+1 ${unit.name}`);
      }
    }
    if (name === "dragon's vale elder") {
      const token = findByName(map, "Vastwing Dragon") ?? related(crest.card, map).find(card => norm(card.name) === "vastwing dragon");
      const count = token ? summonWithEvents(player, token, 1, playerIndex, ctx) : 0;
      actions.push(`Dragon's Vale Elder Crest: summon ${count ? "Vastwing Dragon" : "no follower"}`);
    }
  }
  return uniq(actions);
}

function triggerDiscardedCard(ctx, item, actions) {
  if (!item?.card) return;
  const raw = String(item.card.text ?? "");
  const match = raw.match(/When this card is discarded,\s*([\s\S]*?)(?=(?:\n\n|\bFanfare\s*:|\bEvolve\s*:|\bSuper-Evolve\s*:|\bLast Words\s*:|$))/i);
  if (!match?.[1]) return;
  const result = resolveText(match[1].trim(), { ...ctx, card: item.card, instance: item, sourceUnit: null });
  actions.push(...result.actions.map(action => `${item.card.name} discarded: ${action}`));
}

function discardDragoncraftCard(ctx, preferHighCost = false) {
  if (!ctx.player.hand.length) return { item: null, cost: 0, actions: [] };
  const ranked = [...ctx.player.hand].sort((a, b) => {
    const costA = costOf(a), costB = costOf(b);
    return preferHighCost ? costB - costA : costA - costB;
  });
  const item = ranked[0];
  const cost = costOf(item);
  ctx.player.hand = ctx.player.hand.filter(entry => entry.uid !== item.uid);
  toCemetery(ctx.player, item, false);
  const actions = [`discard ${item.card.name}`];
  triggerDiscardedCard(ctx, item, actions);
  return { item, cost, actions };
}

function applyAzurifritTripleDamage(ctx, sourceUnit, actions) {
  for (let repeat = 1; repeat <= 3; repeat += 1) {
    const allied = [...ctx.player.board.filter(unit => unit.type === "Follower")];
    const enemy = [...ctx.opponent.board.filter(unit => unit.type === "Follower")];
    for (const unit of allied) damageUnit(unit, 2, ctx.player, ctx.opponent, ctx, actions);
    for (const unit of enemy) damageUnit(unit, 2, ctx.opponent, ctx.player, ctx, actions);
    actions.push(`Azurifrit: all followers take 2 (${repeat}/3)`);
    actions.push(...cleanup(ctx.player, ctx.opponent, ctx.playerIndex, ctx.enemyIndex, ctx.stats, ctx.rng, ctx.cardMap));
    actions.push(...cleanup(ctx.opponent, ctx.player, ctx.enemyIndex, ctx.playerIndex, ctx.stats, ctx.rng, ctx.cardMap));
    if (!ctx.player.board.includes(sourceUnit)) break;
  }
}

function resolveDragoncraftCardText(textValue, ctx) {
  if (!canUseClassRules(ctx.player, "Dragoncraft", ctx.card)) return { text: String(textValue ?? ""), actions: [] };
  let text = String(textValue ?? "");
  const actions = [];
  const name = norm(ctx.card?.name);

  if (name === "mari, meg's bestie") {
    const endBuff = /give a random super-evolved allied follower on the field \+1\/\+1\.?/i;
    if (endBuff.test(text)) {
      const candidates = ctx.player.board.filter(unit => unit.type === "Follower" && unit.superEvolved);
      if (candidates.length) {
        const unit = candidates[Math.floor(ctx.rng() * candidates.length)];
        unit.attack += 1; unit.defense += 1; unit.maxDefense += 1;
        actions.push(`Mari: +1/+1 ${unit.name}`);
      }
      text = text.replace(endBuff, " ");
    }
  }

  if (name === "drache & aluzard, burning blood") {
    const fanfare = /Give this follower \+X\/\+X\.\s*If X is at least 2, evolve this follower\.\s*X is the number of other allied copies of Drache & Aluzard, Burning Blood that have entered the field this match\.?/i;
    if (fanfare.test(text) && ctx.sourceUnit) {
      const x = Math.max(0, (Number(ctx.player.dracheEntriesThisMatch) || 0) - 1);
      ctx.sourceUnit.attack += x;
      ctx.sourceUnit.defense += x;
      ctx.sourceUnit.maxDefense += x;
      actions.push(`Drache & Aluzard: +${x}/+${x}`);
      if (x >= 2) evolveUnitByAbility(ctx, ctx.sourceUnit, actions);
      text = text.replace(fanfare, " ");
    }
  }

  if (name === "burnite, anathema of flame") {
    const fanfare = /Select a card in your hand and discard it\.\s*Deal X damage to all enemy followers\.\s*X is the cost of the selected card\.?/i;
    if (fanfare.test(text)) {
      const discarded = discardDragoncraftCard(ctx, true);
      actions.push(...discarded.actions);
      const x = discarded.cost;
      for (const unit of [...ctx.opponent.board.filter(unit => unit.type === "Follower")]) damageUnit(unit, x, ctx.opponent, ctx.player, ctx, actions);
      actions.push(`Burnite, Anathema of Flame: ${x} damage to all enemy followers`);
      text = text.replace(fanfare, " ");
    }
  }

  if (name === "azurifrit, heir to disdain") {
    const triple = /Do this 3 times:\s*["“]Deal 2 damage to all followers\.["”]/i;
    if (triple.test(text) && ctx.sourceUnit) {
      applyAzurifritTripleDamage(ctx, ctx.sourceUnit, actions);
      text = text.replace(triple, " ");
    }
    const restore = /Fully restore the defense of this follower\.?/i;
    if (restore.test(text) && ctx.sourceUnit) {
      ctx.sourceUnit.defense = ctx.sourceUnit.maxDefense;
      actions.push(`Azurifrit: fully restore defense to ${ctx.sourceUnit.defense}`);
      text = text.replace(restore, " ");
    }
  }

  if (name === "dragon's vale elder") {
    const delay = /Delay the count of your Crest:\s*Dragon's Vale Elder by 2\.?/i;
    if (delay.test(text)) {
      const crest = (ctx.player.crests ?? []).find(item => norm(item.name) === "dragon's vale elder");
      if (crest && Number.isFinite(crest.countdown)) {
        crest.countdown += 2;
        actions.push(`Dragon's Vale Elder Crest: countdown +2 (${crest.countdown})`);
      }
      text = text.replace(delay, " ");
    }
  }

  return { text: text.replace(/\s+/g, " ").trim(), actions: uniq(actions) };
}

// [[battle-forestcraft-full-rules]]
function isPixieFollower(value) {
  return value?.type === "Follower" && (value.card?.traits ?? []).some(trait => norm(trait) === "pixie");
}

function applyForestSuperEvolveHandTriggers(player) {
  const actions = [];
  for (const item of player.hand ?? []) {
    if (norm(item.card?.name) !== "fairy fencer") continue;
    const base = Math.max(0, Number(item.card?.cost) || 0);
    item.costDelta = 1 - base;
    actions.push("Fairy Fencer: cost set to 1");
  }
  return actions;
}

function applyForestEvolutionTriggers(ctx, unit, superMode = false) {
  const actions = [];
  if (!unit || unit.type !== "Follower") return actions;

  if (ctx.player.forestFaithActive) {
    ctx.player.faith = (Number(ctx.player.faith) || 0) + 1;
    actions.push(`Forest Faith +1 (${ctx.player.faith})`);
    const stacks = Math.max(0, Number(ctx.player.forestFaithEvolveDamage) || 0);
    for (let index = 0; index < stacks; index += 1) {
      const dealt = damageLeader(ctx.opponent, 1);
      ctx.stats.damageDealt[ctx.playerIndex] += dealt;
      actions.push(`Sathanid Faith: ${dealt} damage to enemy leader`);
    }
  }

  for (const item of ctx.player.hand ?? []) {
    if (norm(item.card?.name) !== "floral offering") continue;
    item.costDelta = (Number(item.costDelta) || 0) - 1;
    actions.push("Floral Offering: cost -1");
  }

  for (const source of ctx.player.board.filter(source => source.type === "Follower" && norm(source.name) === "merciful attendant")) {
    const healed = healPlayer(ctx.player, 1, ctx.stats, ctx.playerIndex);
    actions.push(`Merciful Attendant: restore ${healed} leader defense`);
    if (healed) actions.push(...afterLeaderHeal(ctx.player, healed, ctx.stats, ctx.playerIndex));
  }

  if (superMode) actions.push(...applyForestSuperEvolveHandTriggers(ctx.player));
  return uniq(actions);
}

function summonExactFollowerCopy(ctx, source, defenseDelta = 0) {
  if (!source || source.type !== "Follower" || ctx.player.board.length >= 5) return null;
  const inst = instance(ctx.player, source.card);
  const copy = boardFollower(inst);
  copy.attack = Number(source.attack) || 0;
  copy.defense = (Number(source.defense) || 0) + Number(defenseDelta || 0);
  copy.maxDefense = (Number(source.maxDefense) || Number(source.defense) || 0) + Number(defenseDelta || 0);
  copy.keywords = [...(source.keywords ?? [])];
  copy.barrier = Number(source.barrier) || 0;
  copy.ambush = Boolean(source.ambush);
  copy.aura = Boolean(source.aura);
  copy.intimidate = Boolean(source.intimidate);
  copy.permanentAttackLock = Boolean(source.permanentAttackLock);
  copy.baseMaxAttacks = Number(source.baseMaxAttacks) || 1;
  copy.maxAttacks = copy.baseMaxAttacks;
  copy.canAttackLeader = hasU(copy, "Storm") && !copy.permanentAttackLock;
  copy.canAttackFollower = (hasU(copy, "Storm") || hasU(copy, "Rush")) && !copy.permanentAttackLock;
  ctx.player.board.push(copy);
  ctx.player.rally += 1;
  return copy;
}

function applyForestEntryEvents(ctx, unit) {
  const actions = [];
  if (!unit || unit.type !== "Follower") return actions;
  if (norm(unit.name) === "congregant of unkilling" && ctx.player.board.length < 5) {
    const copy = summonExactFollowerCopy(ctx, unit, -1);
    if (copy) {
      actions.push(`Congregant of Unkilling: exact copy ${copy.attack}/${copy.defense}`);
      actions.push(...applyEntryEvents(ctx, copy));
    }
  }
  return uniq(actions);
}

function forestcraftCrestLastWords(crest, player, opponent, playerIndex, enemyIndex, stats, rng, map, actions) {
  const name = norm(crest?.name);
  if (name === "magnified malice" || name === "minimized anxiety") {
    const nextName = name === "magnified malice" ? "Minimized Anxiety" : "Magnified Malice";
    const token = findByName(map, nextName);
    const added = token ? addHand(player, token, 1, playerIndex, stats) : 0;
    if (added) stats.cardsGenerated[playerIndex] += added;
    actions.push(`${crest.name} Crest Last Words: add ${added ? nextName : "no card"}`);
    return true;
  }
  if (name === "starry sky") {
    const dealt = damageLeader(opponent, 1);
    stats.damageDealt[playerIndex] += dealt;
    const token = findByName(map, "Starry Sky") ?? crest.card;
    const added = token ? addHand(player, token, 1, playerIndex, stats) : 0;
    if (added) stats.cardsGenerated[playerIndex] += added;
    actions.push(`Starry Sky Crest Last Words: ${dealt} damage to enemy leader · add ${added ? "Starry Sky" : "no card"}`);
    return true;
  }
  return false;
}

function applyForestCrestTurnStart(player, opponent, playerIndex, enemyIndex, stats, rng, map, onlyCrest = null) {
  const actions = [];
  if ((!onlyCrest || norm(onlyCrest.name) === "titania, queen of fairies") && hasCrest(player, "Titania, Queen of Fairies")) {
    const fairy = findByName(map, "Fairy");
    const added = fairy ? addHand(player, fairy, 1, playerIndex, stats) : 0;
    if (added) stats.cardsGenerated[playerIndex] += added;
    actions.push(`Titania Crest: add ${added ? "Fairy" : "no card"}`);
  }
  return actions;
}

function applyForestCrestTurnEnd(player, opponent, playerIndex, enemyIndex, stats, rng, map, onlyCrest = null) {
  const actions = [];
  const combo = Math.max(0, Number(player.cardsPlayedThisTurn) || 0);
  for (const crest of onlyCrest ? [onlyCrest] : [...(player.crests ?? [])]) {
    const name = norm(crest.name);
    if (name === "thestae, anathema of distortion" && combo >= 3) {
      let count = 0;
      for (const item of player.deck) {
        if (item.card?.type !== "Follower") continue;
        item.attackBonus = (Number(item.attackBonus) || 0) + 1;
        item.defenseBonus = (Number(item.defenseBonus) || 0) + 1;
        count += 1;
      }
      actions.push(`Thestae Crest: +1/+1 to ${count} deck follower${count === 1 ? "" : "s"}`);
    }
    if (name === "great hart of the glacial realm" && combo >= 3) {
      const token = findByName(map, "Deepwood Bounty") ?? related(crest.card, map).find(card => norm(card.name) === "deepwood bounty");
      const added = token ? addHand(player, token, 1, playerIndex, stats) : 0;
      if (added) stats.cardsGenerated[playerIndex] += added;
      actions.push(`Great Hart Crest: add ${added ? "Deepwood Bounty" : "no card"}`);
    }
  }
  return uniq(actions);
}

function applyForestFollowerPlayedCrest(ctx) {
  const actions = [];
  const crest = (ctx.player.crests ?? []).find(item => norm(item.name) === "yuel & societte, dancing duo");
  if (!crest || crest.__forestPlayedEvolveTurn === ctx.player.personalTurn || !ctx.sourceUnit || ctx.sourceUnit.evolved || ctx.sourceUnit.superEvolved) return actions;
  crest.__forestPlayedEvolveTurn = ctx.player.personalTurn;
  if (evolveUnitByAbility(ctx, ctx.sourceUnit, actions)) actions.push(`Yuel & Societte Crest: evolve ${ctx.sourceUnit.name}`);
  return uniq(actions);
}

function transformEnemyFollowerInto(ctx, target, card, actions) {
  if (!target || !card) return null;
  const index = ctx.opponent.board.indexOf(target);
  if (index < 0) return null;
  notifyFollowerLeavesField(ctx.opponent, target);
  const replacement = boardFollower(instance(ctx.opponent, card));
  replacement.summonedThisTurn = target.summonedThisTurn;
  replacement.attacksMade = Number(target.attacksMade) || 0;
  replacement.attacked = Boolean(target.attacked);
  if (!replacement.summonedThisTurn) {
    replacement.canAttackLeader = !/can't attack followers or leaders/i.test(String(replacement.card?.text ?? ""));
    replacement.canAttackFollower = !/can't attack followers or leaders/i.test(String(replacement.card?.text ?? ""));
  }
  ctx.opponent.board[index] = replacement;
  actions.push(`${target.name} transforms into ${replacement.name}`);
  return replacement;
}

function resolveForestcraftCardText(textValue, ctx) {
  if (!canUseClassRules(ctx.player, "Forestcraft", ctx.card)) return { text: String(textValue ?? ""), actions: [] };
  let text = String(textValue ?? "");
  const actions = [];
  const name = norm(ctx.card?.name);

  if (["magnified malice", "minimized anxiety", "starry sky"].includes(name)) {
    const comboCrest = /Combo\s*\(?\s*(\d+)\s*\)?\s*-\s*Gain Crest\s*:\s*([^.;]+)\.?/i;
    const match = text.match(comboCrest);
    if (match) {
      const need = Number(match[1]) || 0;
      if ((Number(ctx.player.cardsPlayedThisTurn) || 0) >= need) {
        if (gainCrest(ctx.player, match[2].trim(), ctx.card)) actions.push(`Crest: ${match[2].trim()}`);
      } else actions.push(`Combo ${ctx.player.cardsPlayedThisTurn}/${need}`);
      text = text.replace(match[0], " ");
    }
  }

  if (name === "sathanid, eld lance") {
    const fanfare = /Reduce your faith'?s value by 10 to add a Depths of the Eld Lance to your hand and give your faith ["“]Whenever an allied follower evolves, deal 1 damage to the enemy leader\.["”]/i;
    if (fanfare.test(text)) {
      if ((Number(ctx.player.faith) || 0) >= 10) {
        ctx.player.faith -= 10;
        const token = findByName(ctx.cardMap, "Depths of the Eld Lance") ?? related(ctx.card, ctx.cardMap).find(card => norm(card.name) === "depths of the eld lance");
        const added = token ? addHand(ctx.player, token, 1, ctx.playerIndex, ctx.stats) : 0;
        if (added) ctx.stats.cardsGenerated[ctx.playerIndex] += added;
        ctx.player.forestFaithEvolveDamage = (Number(ctx.player.forestFaithEvolveDamage) || 0) + 1;
        actions.push(`Sathanid: Faith -10 · add ${added ? "Depths of the Eld Lance" : "no card"} · evolution damage ×${ctx.player.forestFaithEvolveDamage}`);
      } else actions.push(`Sathanid: Faith ${ctx.player.faith}/10`);
      text = text.replace(fanfare, " ");
    }
  }

  if (name === "depths of the eld lance") {
    const evolve = /Select an unevolved allied follower on the field and evolve it\.?/i;
    if (evolve.test(text)) {
      const target = ctx.player.board.filter(unit => unit.type === "Follower" && !unit.evolved && !unit.superEvolved)
        .sort((a, b) => (Number(b.attack) + Number(b.defense)) - (Number(a.attack) + Number(a.defense)))[0] ?? null;
      if (target) evolveUnitByAbility(ctx, target, actions);
      text = text.replace(evolve, " ");
    }
  }

  if (name === "thestae, anathema of distortion") {
    const fanfare = /Select an enemy follower on the field and give it -0\/-X\.\s*X is this follower'?s attack\.\s*Increase your Combo by 1\.?/i;
    if (fanfare.test(text)) {
      const target = choosePlannedTarget(ctx, ctx.opponent.board);
      const amount = Math.max(0, Number(ctx.sourceUnit?.attack) || 0);
      if (target) {
        target.defense -= amount;
        target.maxDefense -= amount;
        actions.push(`Thestae: -0/-${amount} ${target.name}`);
      }
      ctx.player.cardsPlayedThisTurn += 1;
      actions.push(`Thestae: Combo +1 (${ctx.player.cardsPlayedThisTurn})`);
      text = text.replace(fanfare, " ");
    }
  }

  if (name === "titania, queen of fairies") {
    const transform = /Select an enemy follower on the field and transform it into a Fairy\.?/i;
    if (transform.test(text)) {
      const target = choosePlannedTarget(ctx, ctx.opponent.board);
      const fairy = findByName(ctx.cardMap, "Fairy") ?? related(ctx.card, ctx.cardMap).find(card => norm(card.name) === "fairy");
      if (target && fairy) transformEnemyFollowerInto(ctx, target, fairy, actions);
      text = text.replace(transform, " ");
    }
  }

  // [[battle-forestcraft-aria-evolve]]
  if (name === "aria, lady of the woods") {
    const summonFairies = /Summon 3 copies of Fairy\.?/i;
    if (summonFairies.test(text)) {
      const fairy = findByName(ctx.cardMap, "Fairy") ?? related(ctx.card, ctx.cardMap).find(card => norm(card.name) === "fairy");
      const count = fairy ? summonWithEvents(ctx.player, fairy, 3, ctx.playerIndex, ctx) : 0;
      actions.push(`Aria: summon ${count} Fairies`);
      text = text.replace(summonFairies, " ");
    }
  }

  if (name === "battledore woodsmaiden") {
    const replicate = /Replicate the effects of this card'?s Fanfare ability\.?/i;
    if (replicate.test(text)) {
      const fairy = findByName(ctx.cardMap, "Fairy") ?? related(ctx.card, ctx.cardMap).find(card => norm(card.name) === "fairy");
      const count = fairy ? summonWithEvents(ctx.player, fairy, 1, ctx.playerIndex, ctx) : 0;
      actions.push(`Battledore Woodsmaiden: replicate Fanfare · summon ${count} Fairy`);
      text = text.replace(replicate, " ");
    }
  }

  if (name === "great hart of the glacial realm") {
    const split = /deal X damage split between all enemy followers\.\s*X is this follower'?s attack\.?/i;
    if (split.test(text)) {
      let left = Math.max(0, Number(ctx.sourceUnit?.attack) || 0);
      const original = left;
      const targets = ctx.opponent.board.filter(unit => unit.type === "Follower");
      while (left > 0 && targets.length) {
        const target = targets[Math.floor(ctx.rng() * targets.length)];
        damageUnit(target, 1, ctx.opponent, ctx.player, ctx, actions);
        left -= 1;
      }
      actions.push(`Great Hart: ${original} split damage`);
      text = text.replace(split, " ");
    }
  }

  if (name === "macrobear") {
    const copyText = /Summon an exact copy of this card\.?/i;
    if (copyText.test(text) && ctx.sourceUnit) {
      const copy = summonExactFollowerCopy(ctx, ctx.sourceUnit, 0);
      if (copy) {
        actions.push(`Macrobear: summon exact copy ${copy.attack}/${copy.defense}`);
        actions.push(...applyEntryEvents(ctx, copy));
      }
      text = text.replace(copyText, " ");
    }
  }

  return { text: text.replace(/\s+/g, " ").trim(), actions: uniq(actions) };
}

// [[battle-runecraft-exact-rules]]
function runecraftTrait(card, trait) {
  return (card?.traits ?? []).some(value => norm(value) === norm(trait));
}

function isCrystalspawn(value) {
  return norm(value?.name ?? value?.card?.name) === "crystalspawn";
}

function isGolemFollower(unit) {
  return unit?.type === "Follower" && runecraftTrait(unit.card, "Golem");
}

function recordDestroyedShikigami(player, unit) {
  if (!unit || unit.type !== "Follower" || !runecraftTrait(unit.card, "Shikigami")) return;
  player.shikigamiDestroyedBaseAttackThisTurn = (Number(player.shikigamiDestroyedBaseAttackThisTurn) || 0) + Math.max(0, Number(unit.card?.attack) || 0);
  player.shikigamiDestroyedBaseDefenseThisTurn = (Number(player.shikigamiDestroyedBaseDefenseThisTurn) || 0) + Math.max(0, Number(unit.card?.defense) || 0);
}

function performEarthRite(player, amountValue, actions = []) {
  if (player.className && !canUseClassMechanic(player, "earthRite")) return false;
  const amount = Math.max(1, Number(amountValue) || 1);
  if ((Number(player.earthSigils) || 0) < amount) return false;
  player.earthSigils -= amount;
  for (const item of player.hand ?? []) {
    const name = norm(item.card?.name);
    if (name !== "bottomless gluttony" && name !== "heel, my dearie") continue;
    item.costDelta = (Number(item.costDelta) || 0) - 1;
  }
  actions.push(`Earth Rite ${amount}`);
  return true;
}

function silenceFollower(unit) {
  if (!unit) return;
  unit.overrideText = " ";
  unit.keywords = [];
  unit.barrier = 0;
  unit.aura = false;
  unit.ambush = false;
  unit.intimidate = false;
  unit.permanentAttackLock = false;
  unit.baseMaxAttacks = 1;
  unit.maxAttacks = 1;
}

// [[battle-swordcraft-full-rules]]
function applySwordcraftSuperEvolveHandTriggers(player) {
  const actions = [];
  for (const item of player.hand ?? []) {
    if (norm(item.card?.name) !== "bombastic bombardier") continue;
    const base = Math.max(0, Number(item.card?.cost) || 0);
    item.costDelta = 1 - base;
    actions.push("Bombastic Bombardier: cost set to 1");
  }
  return actions;
}

function applySwordcraftSpellPlayedTriggers(player, opponent, playerIndex, enemyIndex, stats, rng, map) {
  const actions = [];
  const ctx = { player, opponent, playerIndex, enemyIndex, stats, rng, cardMap: map };
  for (const source of player.board.filter(unit => unit.type === "Follower" && norm(unit.name) === "katze, magical thief")) {
    if (source.__katzeSpellTriggerTurn === player.personalTurn) continue;
    source.__katzeSpellTriggerTurn = player.personalTurn;
    const targets = opponent.board.filter(unit => unit.type === "Follower");
    if (!targets.length) {
      actions.push("Katze: spell trigger has no enemy follower");
      continue;
    }
    const target = targets[Math.floor(rng() * targets.length)];
    damageUnit(target, 2, opponent, player, ctx, actions);
    actions.push(`Katze: 2 damage to ${target.name}`);
  }
  return actions;
}

function swordcraftCrestLastWords(crest, player, opponent, playerIndex, enemyIndex, stats, rng, map, actions) {
  const name = norm(crest?.name);
  if (name === "kagemitsu, enduring warrior") {
    const card = crest.card ?? findByName(map, "Kagemitsu, Enduring Warrior");
    if (!card || player.board.length >= 5) {
      actions.push("Kagemitsu Crest Last Words: summon skipped");
      return true;
    }
    const unit = boardFollower(instance(player, card));
    player.board.push(unit);
    player.rally += 1;
    stats.cardsGenerated[playerIndex] += 1;
    actions.push("Kagemitsu Crest Last Words: summon Kagemitsu", ...applyEntryEvents({ player, opponent, playerIndex, enemyIndex, stats, rng, cardMap: map }, unit));
    return true;
  }
  if (name === "octrice, hollowness manifest") {
    const token = findByName(map, "Remnant of Hollowness") ?? related(crest.card, map).find(card => norm(card.name) === "remnant of hollowness");
    const added = token ? addHand(player, token, 1, playerIndex, stats) : 0;
    if (added) stats.cardsGenerated[playerIndex] += added;
    actions.push(`Octrice Crest Last Words: add ${added ? "Remnant of Hollowness" : "no card"}`);
    return true;
  }
  return false;
}

function applySwordcraftLootCrestEvent(player, opponent, playerIndex, enemyIndex, stats, rng, map, actions, eventName) {
  const crest = (player.crests ?? []).find(item => norm(item.name) === "octrice, hollowness manifest");
  if (!crest || !Number.isFinite(crest.countdown)) return false;
  crest.countdown = Math.max(0, crest.countdown - 1);
  actions.push(`Octrice Crest: ${eventName} advances countdown to ${crest.countdown}`);
  if (crest.countdown > 0) return true;
  player.crests = player.crests.filter(item => item !== crest);
  swordcraftCrestLastWords(crest, player, opponent, playerIndex, enemyIndex, stats, rng, map, actions);
  return true;
}

function applySwordcraftCrestTurnEnd(player, opponent, playerIndex, enemyIndex, stats, rng, map, onlyCrest = null) {
  const actions = [];
  for (const crest of onlyCrest ? [onlyCrest] : [...(player.crests ?? [])]) {
    if (norm(crest.name) !== "unkei, goldbloom") continue;
    const token = findByName(map, "Glittering Gold") ?? related(crest.card, map).find(card => norm(card.name) === "glittering gold");
    const added = token ? addHand(player, token, 1, playerIndex, stats) : 0;
    if (added) stats.cardsGenerated[playerIndex] += added;
    actions.push(`Unkei Crest: add ${added ? "Glittering Gold" : "no card"}`);
  }
  return actions;
}

function applySwordcraftEnemyEntryEvents(ctx, unit) {
  if (!unit || unit.type !== "Follower") return [];
  const actions = [];
  for (const source of ctx.opponent.board.filter(source => source.type === "Follower" && norm(source.name) === "yurius, levin authority")) {
    unit.yuriusAttackLocked = true;
    unit.canAttackLeader = false;
    unit.canAttackFollower = false;
    const dealt = damageLeader(ctx.player, 1);
    ctx.stats.damageDealt[ctx.enemyIndex] += dealt;
    const healed = healPlayer(ctx.opponent, 1, ctx.stats, ctx.enemyIndex);
    actions.push(`Yurius: lock ${unit.name} · ${dealt} damage to enemy leader · restore ${healed} defense`);
    if (healed) actions.push(...afterLeaderHeal(ctx.opponent, healed, ctx.stats, ctx.enemyIndex));
  }
  return actions;
}

function applySwordcraftTurnStartLocks(player) {
  for (const unit of player.board.filter(unit => unit.type === "Follower" && unit.yuriusAttackLocked)) {
    unit.canAttackLeader = false;
    unit.canAttackFollower = false;
  }
}

function clearSwordcraftTurnLocks(player) {
  for (const unit of player.board.filter(unit => unit.type === "Follower" && unit.yuriusAttackLocked)) {
    unit.yuriusAttackLocked = false;
  }
}

function resolveSwordcraftCardText(textValue, ctx) {
  if (!canUseClassRules(ctx.player, "Swordcraft", ctx.card)) return { text: String(textValue ?? ""), actions: [] };
  let text = String(textValue ?? "");
  const actions = [];
  const name = norm(ctx.card?.name);

  if (name === "majestic conquest") {
    const delay = /Delay the count of your Crest\s*:\s*Majestic Conquest by 2\.?/i;
    if (delay.test(text)) {
      if (!hasCrest(ctx.player, "Majestic Conquest")) gainCrest(ctx.player, "Majestic Conquest", ctx.card);
      const crest = ctx.player.crests.find(item => norm(item.name) === "majestic conquest");
      if (crest && Number.isFinite(crest.countdown)) {
        crest.countdown += 2;
        actions.push(`Majestic Conquest: delay Crest countdown to ${crest.countdown}`);
      }
      text = text.replace(delay, " ");
    }
  }

  if (name === "gildaria, anathema of peace") {
    const gated = /Rally\s*\(?\s*20\s*\)?\s*-\s*Super-evolve this follower\.?/i;
    if (gated.test(text)) {
      const rally = Number.isFinite(Number(ctx.rallyBeforePlay)) ? Number(ctx.rallyBeforePlay) : Math.max(0, (Number(ctx.player.rally) || 0) - 1);
      if (rally >= 20 && ctx.sourceUnit) {
        const before = new Set(ctx.player.board.map(unit => unit.uid));
        superEvolveUnitByAbility(ctx, ctx.sourceUnit, actions);
        let steelclad = ctx.player.board.filter(unit => !before.has(unit.uid) && norm(unit.name) === "steelclad knight");
        const missing = Math.max(0, 2 - steelclad.length);
        if (missing && ctx.player.board.length < 5) {
          const token = related(ctx.card, ctx.cardMap).find(card => norm(card.name) === "steelclad knight") ?? findByName(ctx.cardMap, "Steelclad Knight");
          if (token) summonWithEvents(ctx.player, token, missing, ctx.playerIndex, ctx);
          steelclad = ctx.player.board.filter(unit => !before.has(unit.uid) && norm(unit.name) === "steelclad knight");
        }
        for (const unit of steelclad) giveKeyword(unit, "Rush");
        if (steelclad.length) actions.push(`Gildaria: summon ${steelclad.length} Steelclad Knight${steelclad.length === 1 ? "" : "s"} with Rush`);
      } else actions.push(`Rally ${rally}/20`);
      text = text.replace(gated, " ");
    }
  }

  if (name === "yurius, levin authority") {
    const summon = /Summon 2 enemy copies of Knight\.?/i;
    if (summon.test(text)) {
      const token = related(ctx.card, ctx.cardMap).find(card => norm(card.name) === "knight") ?? findByName(ctx.cardMap, "Knight");
      const count = token ? summonWithEvents(ctx.opponent, token, 2, ctx.enemyIndex, ctx) : 0;
      actions.push(`Yurius: summon ${count} enemy Knight${count === 1 ? "" : "s"}`);
      text = text.replace(summon, " ");
    }
  }

  return { text: text.replace(/\s+/g, " ").trim(), actions };
}

function runecraftCrestLastWords(crest, player, opponent, playerIndex, enemyIndex, stats, rng, map, actions) {
  const name = norm(crest?.name);
  const ctx = { player, opponent, playerIndex, enemyIndex, stats, rng, cardMap: map };
  if (name === "insomniac witch") {
    for (const unit of player.board.filter(unit => unit.type === "Follower")) damageUnit(unit, 3, player, opponent, ctx, actions);
    for (const unit of opponent.board.filter(unit => unit.type === "Follower")) damageUnit(unit, 3, opponent, player, ctx, actions);
    actions.push("Insomniac Crest Last Words: 3 damage to all followers");
    actions.push(...cleanup(player, opponent, playerIndex, enemyIndex, stats, rng, map), ...cleanup(opponent, player, enemyIndex, playerIndex, stats, rng, map));
    return true;
  }
  if (name === "crystal gazing") {
    const drawn = drawCards(player, 2, stats, playerIndex);
    for (const unit of opponent.board.filter(unit => unit.type === "Follower")) damageUnit(unit, 4, opponent, player, ctx, actions);
    actions.push(`Crystal Gazing Crest Last Words: draw ${drawn} · 4 damage to enemy followers`);
    actions.push(...cleanup(opponent, player, enemyIndex, playerIndex, stats, rng, map));
    return true;
  }
  return false;
}

function destroyRunecraftCrest(player, name, opponent, playerIndex, enemyIndex, stats, rng, map, actions) {
  const crest = (player.crests ?? []).find(item => norm(item.name) === norm(name));
  if (!crest) return false;
  player.crests = player.crests.filter(item => item !== crest);
  runecraftCrestLastWords(crest, player, opponent, playerIndex, enemyIndex, stats, rng, map, actions);
  return true;
}

function applyRunecraftEntryEvents(ctx, unit) {
  if (!unit || unit.type !== "Follower") return [];
  const actions = [];
  const name = norm(unit.name);

  if (name === "lhynkal, wandering fool" && hasCrest(ctx.player, "Lhynkal, Wandering Fool")) {
    const before = Math.max(0, Number(ctx.opponent.maxHp) || 0);
    ctx.opponent.maxHp = Math.max(0, before - 2);
    ctx.opponent.hp = Math.min(ctx.opponent.hp, ctx.opponent.maxHp);
    actions.push(`Lhynkal Crest: enemy max defense ${before} → ${ctx.opponent.maxHp}`);
  }

  if (isCrystalspawn(unit)) {
    if (ctx.player.faithActive) {
      ctx.player.faith = (Number(ctx.player.faith) || 0) + 1;
      actions.push(`Faith +1 (${ctx.player.faith})`);
    }
    for (const item of ctx.player.hand ?? []) {
      if (norm(item.card?.name) !== "calge-danthla, eld crystals") continue;
      item.costDelta = (Number(item.costDelta) || 0) - 1;
    }
    for (const source of ctx.player.board.filter(source => source.type === "Follower" && norm(source.name) === "enraptured student")) {
      const healed = healPlayer(ctx.player, 1, ctx.stats, ctx.playerIndex);
      actions.push(`Enraptured Student: restore ${healed} leader defense`);
      if (healed) actions.push(...afterLeaderHeal(ctx.player, healed, ctx.stats, ctx.playerIndex));
    }
  }

  if (name === "noble shikigami") {
    const attack = Math.max(0, Number(ctx.player.shikigamiDestroyedBaseAttackThisTurn) || 0);
    const defense = Math.max(0, Number(ctx.player.shikigamiDestroyedBaseDefenseThisTurn) || 0);
    if (attack || defense) {
      unit.attack += attack;
      unit.defense += defense;
      unit.maxDefense += defense;
      actions.push(`Noble Shikigami: +${attack}/+${defense}`);
    }
  }

  for (const source of [...ctx.player.board]) {
    if (source === unit || source.type !== "Follower") continue;
    const sourceName = norm(source.name);
    if (sourceName === "emperor of elements" && isGolemFollower(unit) && !unit.evolved && !unit.superEvolved) {
      if (performEarthRite(ctx.player, 1, actions)) {
        evolveUnitByAbility(ctx, unit, actions);
        actions.push(`Emperor of Elements: evolve ${unit.name}`);
      }
    }
    if (sourceName === "ginger, disastrous word") {
      giveKeyword(unit, "Rush");
      spellboostHand(ctx.player, 1, ctx.cardMap, actions);
      actions.push(`Ginger: ${unit.name} gains Rush · Spellboost`);
    }
  }
  return uniq(actions);
}

function applyRunecraftCardPlayedTriggers(player, opponent, card, playerIndex, stats, actions) {
  if (!card || card.type !== "Spell" || !hasCrest(player, "Tico, Mysterian Spellcrafter")) return;
  const mysterian = runecraftTrait(card, "Mysteria") || /mysterian|mysteria/i.test(String(card.name ?? ""));
  if (!mysterian) return;
  const dealt = damageLeader(opponent, 1);
  stats.damageDealt[playerIndex] += dealt;
  actions.push(`Tico Crest: ${dealt} damage to enemy leader`);
}

function applyInstituteChangedCostTrigger(player, opponent, playedCard, changed, playerIndex, enemyIndex, stats, rng, map, actions) {
  if (!changed || playedCard?.type !== "Follower") return;
  for (const institute of [...player.board].filter(unit => unit.type === "Amulet" && norm(unit.name) === "institute of truth")) {
    const drawn = drawCards(player, 1, stats, playerIndex);
    if (Number.isFinite(institute.countdown)) institute.countdown = Math.max(0, institute.countdown - 1);
    actions.push(`Institute of Truth: draw ${drawn} · advance countdown by 1`);
    if (Number.isFinite(institute.countdown) && institute.countdown <= 0) {
      actions.push(...destroyObject(player, opponent, institute, playerIndex, enemyIndex, stats, rng, map, true));
    }
  }
}

function applyRunecraftAttackDeclaration(player, attacker, actions) {
  if (!isCrystalspawn(attacker) || !hasCrest(player, "Shymm, Love Bewitched")) return;
  attacker.attack += 1;
  actions.push(`Shymm Crest: ${attacker.name} +1/+0`);
}

function applyRunecraftCrestTurnStart(player, opponent, playerIndex, enemyIndex, stats, rng, map, onlyCrest = null) {
  const actions = [];
  for (const crest of onlyCrest ? [onlyCrest] : [...(player.crests ?? [])]) {
    const name = norm(crest.name);
    if (name === "elmott, remembrance aflame") {
      const dealt = damageLeader(opponent, 1);
      stats.damageDealt[playerIndex] += dealt;
      actions.push(`Elmott Crest: ${dealt} damage to enemy leader`);
    }
    if (name === "cagliostro, genius alchemist" && performEarthRite(player, 1, actions)) {
      const token = findByName(map, "Ars Magna");
      const added = token ? addHand(player, token, 1, playerIndex, stats) : 0;
      if (added) stats.cardsGenerated[playerIndex] += added;
      actions.push(`Cagliostro Crest: add ${added ? "Ars Magna" : "no card"}`);
    }
    if (name === "bergent, rejected artes") {
      const token = findByName(map, "Onion Patch");
      if (token && player.board.length < 5) {
        const unit = boardFollower(instance(player, token));
        player.board.push(unit);
        player.rally += 1;
        stats.cardsGenerated[playerIndex] += 1;
        actions.push("Bergent Crest: summon Onion Patch", ...applyEntryEvents({ player, opponent, playerIndex, enemyIndex, stats, rng, cardMap: map }, unit));
      }
    }
  }
  return uniq(actions);
}

function applyRunecraftCrestTurnEnd(player, opponent, playerIndex, enemyIndex, stats, rng, map, onlyCrest = null) {
  const actions = [];
  for (const crest of onlyCrest ? [onlyCrest] : [...(player.crests ?? [])]) {
    const name = norm(crest.name);
    if (name === "pascale's dance") {
      const drawn = drawCards(player, 1, stats, playerIndex);
      actions.push(`Pascale Crest: draw ${drawn}`);
      if (performEarthRite(player, 10, actions)) {
        const ctx = { player, opponent, playerIndex, enemyIndex, stats, rng, cardMap: map };
        for (const unit of player.board.filter(unit => unit.type === "Follower")) {
          const attack = Math.max(0, Number(unit.attack) || 0);
          const defense = Math.max(0, Number(unit.defense) || 0);
          const context = effectContext(ctx);
          context.buffUnit(unit, attack, defense);
        }
        actions.push("Pascale Crest: double allied follower attack/defense");
      }
    }
    if (name === "juno, visionary alchemist" && performEarthRite(player, 1, actions)) {
      const token = findByName(map, "Guardian Golem");
      if (token && player.board.length < 5) {
        const unit = boardFollower(instance(player, token));
        player.board.push(unit);
        player.rally += 1;
        stats.cardsGenerated[playerIndex] += 1;
        actions.push("Juno Crest: summon Guardian Golem", ...applyEntryEvents({ player, opponent, playerIndex, enemyIndex, stats, rng, cardMap: map }, unit));
      }
    }
  }
  return uniq(actions);
}

function applyRunecraftOpponentTurnEndCrests(owner, endingPlayer, ownerIndex, endingIndex, stats, rng, map) {
  const actions = [];
  if (!hasCrest(owner, "Lilanthim, Anathema of Predation") || owner.board.length >= 5) return actions;
  const crest = owner.crests.find(item => norm(item.name) === "lilanthim, anathema of predation");
  const card = crest?.card ?? findByName(map, "Lilanthim, Anathema of Predation");
  if (!card) return actions;
  const unit = boardFollower(instance(owner, card));
  owner.board.push(unit);
  owner.rally += 1;
  actions.push("Lilanthim Crest: summon Lilanthim", ...applyEntryEvents({ player: owner, opponent: endingPlayer, playerIndex: ownerIndex, enemyIndex: endingIndex, stats, rng, cardMap: map }, unit));
  const ctx = { card, sourceUnit: unit, player: owner, opponent: endingPlayer, playerIndex: ownerIndex, enemyIndex: endingIndex, stats, rng, cardMap: map };
  if (evolveUnitByAbility(ctx, unit, actions)) actions.push("Lilanthim Crest: evolve Lilanthim");
  actions.push(...cleanup(endingPlayer, owner, endingIndex, ownerIndex, stats, rng, map));
  return uniq(actions);
}

function transformAlliedFollowersFromDeck(ctx, actions) {
  const pool = ctx.player.deck.filter(item => item.card?.type === "Follower");
  if (!pool.length) return 0;
  let transformed = 0;
  for (const old of [...ctx.player.board].filter(unit => unit.type === "Follower")) {
    const index = ctx.player.board.indexOf(old);
    if (index < 0) continue;
    const chosen = pool[Math.floor(ctx.rng() * pool.length)];
    const replacement = boardFollower({ ...chosen, uid: old.uid });
    replacement.summonedThisTurn = old.summonedThisTurn;
    replacement.attacksMade = Number(old.attacksMade) || 0;
    replacement.attacked = Boolean(old.attacked);
    if (!replacement.summonedThisTurn) {
      const locked = /can'?t attack followers or leaders/i.test(String(replacement.card?.text ?? ""));
      replacement.canAttackLeader = !locked;
      replacement.canAttackFollower = !locked;
    }
    notifyFollowerLeavesField(ctx.player, old);
    ctx.player.board[index] = replacement;
    transformed += 1;
    actions.push(`${old.name} transforms into ${replacement.name}`);
  }
  return transformed;
}

function resolveRunecraftCardText(textValue, ctx) {
  if (!canUseClassRules(ctx.player, "Runecraft", ctx.card)) return { text: String(textValue ?? ""), actions: [] };
  let text = String(textValue ?? "");
  const actions = [];
  const name = norm(ctx.card?.name);

  if (name === "lhynkal, wandering fool") {
    const inject = /add 10 copies of Lhynkal, Wandering Fool to your deck\.?/i;
    if (inject.test(text)) {
      for (let index = 0; index < 10; index += 1) ctx.player.deck.push(instance(ctx.player, ctx.card));
      shuffle(ctx.player.deck, ctx.rng);
      actions.push("Lhynkal: add 10 copies to deck");
      text = text.replace(inject, " ");
    }
  }

  if (name === "institute of truth") {
    const engage = /select a follower in your hand, increase its cost by 1, and give it \+1\/\+1\.?/i;
    if (engage.test(text)) {
      const target = ctx.player.hand.filter(item => item.card?.type === "Follower")
        .sort((a, b) => ((Number(b.card?.attack) || 0) + (Number(b.card?.defense) || 0)) - ((Number(a.card?.attack) || 0) + (Number(a.card?.defense) || 0)))[0] ?? null;
      if (target) {
        target.costDelta = (Number(target.costDelta) || 0) + 1;
        target.attackBonus = (Number(target.attackBonus) || 0) + 1;
        target.defenseBonus = (Number(target.defenseBonus) || 0) + 1;
        actions.push(`Institute of Truth: ${target.card.name} cost +1 and +1/+1`);
      }
      text = text.replace(engage, " ");
    }
  }

  if (name === "elmott, remembrance aflame") {
    const fanfare = /select an enemy follower on the field, remove all abilities from it, and deal it 3 damage\.?/i;
    if (fanfare.test(text)) {
      const target = choosePlannedTarget(ctx, ctx.opponent.board);
      if (target) {
        silenceFollower(target);
        damageUnit(target, 3, ctx.opponent, ctx.player, ctx, actions);
        actions.push(`Elmott: remove abilities and deal 3 to ${target.name}`);
      }
      text = text.replace(fanfare, " ");
    }
  }

  if (name === "tico, mysterian spellcrafter") {
    const discount = /reduce the cost of all Mysteria spells in your hand by 1\.?/i;
    if (discount.test(text)) {
      let count = 0;
      for (const item of ctx.player.hand.filter(item => item.card?.type === "Spell" && runecraftTrait(item.card, "Mysteria"))) {
        item.costDelta = (Number(item.costDelta) || 0) - 1;
        count += 1;
      }
      actions.push(`Tico: reduce ${count} Mysteria spell cost${count === 1 ? "" : "s"} by 1`);
      text = text.replace(discount, " ");
    }
  }

  if (name === "insomniac witch") {
    const destroy = /destroy your Crest\s*:\s*Insomniac Witch\.?/i;
    if (destroy.test(text)) {
      destroyRunecraftCrest(ctx.player, "Insomniac Witch", ctx.opponent, ctx.playerIndex, ctx.enemyIndex, ctx.stats, ctx.rng, ctx.cardMap, actions);
      actions.push("Insomniac Witch: destroy Crest");
      text = text.replace(destroy, " ");
    }
  }

  if (name === "juno, visionary alchemist") {
    const fanfare = /select an enemy follower on the field and deal it X damage\.\s*X is the number of earth sigils you have\.?/i;
    if (fanfare.test(text)) {
      const target = choosePlannedTarget(ctx, ctx.opponent.board);
      const amount = Math.max(0, Number(ctx.player.earthSigils) || 0);
      if (target) {
        damageUnit(target, amount, ctx.opponent, ctx.player, ctx, actions);
        actions.push(`Juno: ${amount} damage to ${target.name}`);
      }
      text = text.replace(fanfare, " ");
    }
  }

  if (name === "depths of the eld crystals") {
    const exact = /summon a Crystalspawn and give it \+X\/\+X\.\s*Restore Y defense to your leader\.\s*Deal Z damage to the enemy leader\.\s*X, Y, and Z are determined randomly and add up to your faith'?s value\.?/i;
    if (exact.test(text)) {
      const faith = Math.max(0, Number(ctx.player.faith) || 0);
      let x = 0, y = 0, z = 0;
      // Official Q&A: each Faith point independently rolls X, Y or Z with equal probability.
      for (let index = 0; index < faith; index += 1) {
        const roll = Math.floor(ctx.rng() * 3);
        if (roll === 0) x += 1;
        else if (roll === 1) y += 1;
        else z += 1;
      }
      const token = findByName(ctx.cardMap, "Crystalspawn") ?? related(ctx.card, ctx.cardMap).find(card => norm(card.name) === "crystalspawn");
      let summoned = null;
      if (token && ctx.player.board.length < 5) {
        const before = new Set(ctx.player.board.map(unit => unit.uid));
        summonWithEvents(ctx.player, token, 1, ctx.playerIndex, ctx);
        summoned = ctx.player.board.find(unit => !before.has(unit.uid) && isCrystalspawn(unit)) ?? null;
        if (summoned) {
          summoned.attack += x;
          summoned.defense += x;
          summoned.maxDefense += x;
        }
      }
      const healed = healPlayer(ctx.player, y, ctx.stats, ctx.playerIndex);
      if (healed) actions.push(...afterLeaderHeal(ctx.player, healed, ctx.stats, ctx.playerIndex));
      const dealt = damageLeader(ctx.opponent, z);
      ctx.stats.damageDealt[ctx.playerIndex] += dealt;
      actions.push(`Depths: X=${x} · Y=${y} · Z=${z}${summoned ? " · summon Crystalspawn" : ""}`);
      text = text.replace(exact, " ");
    }
  }

  if (name === "grandeur of the dawnblossom") {
    const transform = /transform all allied followers on the field into exact copies of random followers in your deck\.?/i;
    if (transform.test(text)) {
      const count = transformAlliedFollowersFromDeck(ctx, actions);
      actions.push(`Grandeur: transform ${count} allied follower${count === 1 ? "" : "s"}`);
      text = text.replace(transform, " ");
    }
  }

  if (name === "calge-danthla, eld crystals") {
    const fanfare = /summon 2 copies of Crystalspawn and give them Storm\.?/i;
    if (fanfare.test(text)) {
      const token = findByName(ctx.cardMap, "Crystalspawn") ?? related(ctx.card, ctx.cardMap).find(card => norm(card.name) === "crystalspawn");
      const before = new Set(ctx.player.board.map(unit => unit.uid));
      if (token) summonWithEvents(ctx.player, token, 2, ctx.playerIndex, ctx);
      const summoned = ctx.player.board.filter(unit => !before.has(unit.uid) && isCrystalspawn(unit));
      for (const unit of summoned) giveKeyword(unit, "Storm");
      actions.push(`Calge-Danthla: summon ${summoned.length} Crystalspawn with Storm`);
      text = text.replace(fanfare, " ");
    }
  }

  return { text: text.replace(/\s+/g, " ").trim(), actions };
}


// [[battle-high-risk-generic-foundation]]
function buff(unit, attack, defense) {
  if (!unit) return;
  unit.attack += Number(attack) || 0;
  unit.defense += Number(defense) || 0;
  unit.maxDefense += Number(defense) || 0;
}

function highRiskWordNumber(value, fallback = 1) {
  const map = { a:1, an:1, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10 };
  const key = norm(value);
  return Number.isFinite(Number(value)) ? Number(value) : (map[key] ?? fallback);
}

function highRiskIsArtifact(card) {
  return card?.type === "Follower" && (card.traits ?? []).some(trait => norm(trait) === "artifact");
}

function highRiskCopyInstance(player, source) {
  const card = source?.card ?? source;
  if (!card) return null;
  const copy = instance(player, card);
  if (source?.card) {
    for (const key of ["spellboost", "costDelta", "attackBonus", "defenseBonus", "skyboundEvolutions", "x"]) {
      if (Number.isFinite(Number(source[key]))) copy[key] = Number(source[key]);
    }
    copy.fusedThisTurn = Boolean(source.fusedThisTurn);
    copy.fusedCards = [...(source.fusedCards ?? [])];
    copy.fusedNames = [...(source.fusedNames ?? [])];
  }
  return copy;
}

function highRiskAddCopyToHand(ctx, source, { exact = false, costDelta = 0 } = {}) {
  const item = exact ? highRiskCopyInstance(ctx.player, source) : instance(ctx.player, source?.card ?? source);
  if (!item) return null;
  if (source?.type === "Follower" && source.card) {
    item.attackBonus = (Number(source.attack) || 0) - (Number(source.card.attack) || 0);
    item.defenseBonus = (Number(source.maxDefense ?? source.defense) || 0) - (Number(source.card.defense) || 0);
  }
  item.costDelta = (Number(item.costDelta) || 0) + Number(costDelta || 0);
  if (ctx.player.hand.length >= 9) {
    toCemetery(ctx.player, item, false);
    ctx.stats.cardsBurned[ctx.playerIndex] += 1;
    return null;
  }
  ctx.player.hand.push(item);
  ctx.stats.cardsGenerated[ctx.playerIndex] += 1;
  return item;
}

function highRiskSummonExactFromHand(ctx, source, delayed = false) {
  if (!source?.card || source.card.type !== "Follower" || ctx.player.board.length >= 5) return null;
  const inst = highRiskCopyInstance(ctx.player, source);
  const unit = boardFollower(inst);
  if (delayed) unit.highRiskDestroyAtOpponentTurnEnd = true;
  ctx.player.board.push(unit);
  ctx.player.rally += 1;
  ctx.__sideActions?.push?.(`summon exact copy of ${unit.name}`, ...applyEntryEvents(ctx, unit));
  return unit;
}

function highRiskSummonExactFromUnit(ctx, source, delayed = false) {
  if (!source || source.type !== "Follower" || ctx.player.board.length >= 5) return null;
  const unit = summonExactFollowerCopy(ctx, source, 0);
  if (!unit) return null;
  if (delayed) unit.highRiskDestroyAtOpponentTurnEnd = true;
  ctx.__sideActions?.push?.(...applyEntryEvents(ctx, unit));
  return unit;
}

function highRiskSummonAmulet(ctx, card) {
  if (!card || card.type !== "Amulet" || ctx.player.board.length >= 5) return null;
  const unit = boardAmulet(instance(ctx.player, card));
  ctx.player.board.push(unit);
  return unit;
}

function highRiskHistoryCards(entries, count, predicate, rng, differentNames = true) {
  let pool = (entries ?? []).map(entry => entry.card ?? entry).filter(Boolean).filter(card => !predicate || predicate(card));
  if (differentNames) {
    const seen = new Set();
    pool = pool.filter(card => { const key = norm(card.name); if (seen.has(key)) return false; seen.add(key); return true; });
  }
  const out = [];
  while (out.length < count && pool.length) {
    const index = Math.floor(rng() * pool.length);
    out.push(pool.splice(index, 1)[0]);
  }
  return out;
}

function highRiskDiscardItems(ctx, items, actions) {
  const ids = new Set(items.filter(Boolean).map(item => item.uid));
  const discarded = ctx.player.hand.filter(item => ids.has(item.uid));
  ctx.player.hand = ctx.player.hand.filter(item => !ids.has(item.uid));
  for (const item of discarded) {
    toCemetery(ctx.player, item, false);
    triggerDiscardedCard(ctx, item, actions);
  }
  return discarded.length;
}

function highRiskReplayFanfare(ctx, actions) {
  const depth = Math.max(0, Number(ctx.__highRiskFanfareDepth) || 0);
  if (depth >= 64) {
    // Random Fanfare recursion (notably Omegotep) can legally select itself
    // again. The chain terminates almost surely; keep an emergency simulation
    // cap without falsely classifying the already-modeled branch as unresolved.
    actions.push("Fanfare replay emergency recursion cap");
    return true;
  }
  const fanfare = section(ctx.card?.text, "fanfare");
  if (!fanfare) return false;
  const nestedCtx = { ...ctx, __highRiskFanfareDepth: depth + 1 };
  const nested = resolveText(fanfare, nestedCtx);
  actions.push("replicate Fanfare", ...nested.actions);
  if (nested.unresolved || nestedCtx.__highRiskNestedUnresolved) ctx.__highRiskNestedUnresolved = true;
  return true;
}

function highRiskRandomAbilitySegments(raw) {
  const matches = [...String(raw).matchAll(/(?:^|\s)(\d+)\.\s*/g)];
  return matches.map((match, index) => ({
    number: Number(match[1]),
    text: String(raw).slice(match.index + match[0].length, matches[index + 1]?.index ?? String(raw).length).trim()
  })).filter(item => item.text);
}

function highRiskApplyEndOpponentTurnDestruction(owner) {
  for (const unit of owner.board ?? []) {
    if (unit.type === "Follower" && unit.highRiskDestroyAtOpponentTurnEnd) unit.defense = 0;
  }
}

function highRiskRestoreOpponentHandCosts(player) {
  for (const item of player.hand ?? []) {
    const amount = Number(item.highRiskOpponentTempCost) || 0;
    if (!amount) continue;
    item.costDelta = (Number(item.costDelta) || 0) - amount;
    delete item.highRiskOpponentTempCost;
  }
}


// [[battle-high-risk-common-helpers]]
function highRiskEnemySuperEvolveHandTriggers(player) {
  const actions = [];
  for (const item of player.hand ?? []) {
    const name = norm(item.card?.name);
    let keyword = null;
    if (name === "inspirational one") keyword = "Bane";
    if (name === "dogged one") keyword = "Storm";
    if (!keyword) continue;
    item.grantedKeywords ??= [];
    if (!item.grantedKeywords.includes(keyword)) item.grantedKeywords.push(keyword);
    actions.push(`${item.card.name}: gains ${keyword} in hand`);
  }
  return actions;
}

function highRiskHandTurnEndTriggers(player) {
  const actions = [];
  for (const item of player.hand ?? []) {
    if (Number(item.card?.id) !== 90014320) continue;
    item.costDelta = (Number(item.costDelta) || 0) - 1;
    actions.push("Annihilating Onslaught: cost -1 in hand");
  }
  return actions;
}

function highRiskDrawMatching(ctx, count, predicate, label) {
  let drawn = 0;
  for (let i = 0; i < count; i += 1) {
    const item = drawMatchingCard(ctx.player, predicate, ctx.stats, ctx.playerIndex, ctx.rng);
    if (!item) break;
    drawn += 1;
  }
  ctx.__sideActions?.push?.(`${label}: draw ${drawn}`);
  return drawn;
}

function highRiskSummonDeckCard(ctx, predicate) {
  if (ctx.player.board.length >= 5) return null;
  const candidates = ctx.player.deck.filter(item => predicate(item.card));
  if (!candidates.length) return null;
  const item = candidates[Math.floor(ctx.rng() * candidates.length)];
  ctx.player.deck = ctx.player.deck.filter(entry => entry.uid !== item.uid);
  const unit = item.card.type === "Amulet" ? boardAmulet(item) : boardFollower(item);
  ctx.player.board.push(unit);
  if (unit.type === "Follower") ctx.player.rally += 1;
  ctx.__sideActions?.push?.(`summon from deck ${unit.name}`, ...applyEntryEvents(ctx, unit));
  return unit;
}

function highRiskOtherAlliedFollower(ctx) {
  return ctx.player.board.filter(unit => unit.type === "Follower" && unit.uid !== ctx.sourceUnit?.uid)
    .sort((a,b) => (Number(b.attack)+Number(b.defense))-(Number(a.attack)+Number(a.defense)))[0] ?? null;
}

function highRiskGrantKeyword(unit, keyword) {
  if (!unit) return;
  giveKeyword(unit, keyword);
  if (keyword === "Storm") { unit.canAttackFollower = true; unit.canAttackLeader = true; }
  else if (keyword === "Rush") unit.canAttackFollower = true;
}

function highRiskAlliedGroup(ctx, { other = false, className = null, trait = null } = {}) {
  return ctx.player.board.filter(unit => {
    if (unit.type !== "Follower") return false;
    if (other && unit.uid === ctx.sourceUnit?.uid) return false;
    if (className && norm(unit.card?.class) !== norm(className)) return false;
    if (trait && !(unit.card?.traits ?? []).some(value => norm(value) === norm(trait))) return false;
    return true;
  });
}

function resolveHighRiskGenericText(textValue, ctx) {
  let text = String(textValue ?? "");
  const actions = [];

  // [[battle-high-risk-last-eight]]
  const finalCardName = norm(ctx.card?.name);

  if (finalCardName === "fediel, darkness personified" && /Necromancy/i.test(text) && /evolve them/i.test(text)) {
    const summoned = [];
    if ((Number(ctx.player.shadows) || 0) >= 6) {
      ctx.player.shadows -= 6;
      for (const cost of [2, 1]) {
        const unit = reanimate(ctx.player, cost, ctx.playerIndex, ctx.cardMap, ctx.rng);
        if (!unit || ctx.player.board.length >= 5) continue;
        ctx.player.board.push(unit);
        ctx.player.rally += 1;
        actions.push(`Fediel: Reanimate ${cost} ${unit.name}`, ...applyEntryEvents(ctx, unit));
        summoned.push(unit);
      }
      for (const unit of summoned) evolveUnitByAbility(ctx, unit, actions);
    }
    actions.push(`Fediel: Necromancy 6 · ${summoned.length} evolved reanimates`);
    text = "";
  }

  if (["armes, depletive demon", "reno, luxwing featherfolk", "karula, eternal arts"].includes(finalCardName)
      && /can attack\s*\d+\s*times per turn/i.test(text)) {
    const match = text.match(/can attack\s*(\d+)\s*times per turn/i);
    const count = Number(match?.[1]) || 1;
    if (ctx.sourceUnit) {
      ctx.sourceUnit.baseMaxAttacks = Math.max(count, Number(ctx.sourceUnit.baseMaxAttacks) || 1);
      ctx.sourceUnit.maxAttacks = Math.max(count, Number(ctx.sourceUnit.maxAttacks) || 1);
    }
    actions.push(`${ctx.card.name}: attack ×${count}`);
    text = "";
  }

  if (finalCardName === "inspirational one" && /activates in hand/i.test(text)) {
    if (ctx.sourceUnit) highRiskGrantKeyword(ctx.sourceUnit, "Ward");
    actions.push("Inspirational One: enemy Super-Evolve hand trigger · Ward");
    text = "";
  }
  if (finalCardName === "dogged one" && /activates in hand/i.test(text)) {
    if (ctx.sourceUnit) highRiskGrantKeyword(ctx.sourceUnit, "Rush");
    actions.push("Dogged One: enemy Super-Evolve hand trigger · Rush");
    text = "";
  }

  if (finalCardName === "chaos legion" && /Super Skybound Art/i.test(text)) {
    const gauge = skyboundCountForInstance(ctx);
    const amount = gauge >= 15 ? 6 : 3;
    for (const unit of ctx.opponent.board.filter(unit => unit.type === "Follower")) {
      damageUnit(unit, amount, ctx.opponent, ctx.player, ctx, actions);
    }
    const dealt = damageLeader(ctx.opponent, amount);
    ctx.stats.damageDealt[ctx.playerIndex] += dealt;
    actions.push(`Chaos Legion: ${amount} damage to all enemies · gauge ${gauge}`);
    text = "";
  }

  if (finalCardName === "seofon, leader of the eternals" && /Skybound Art/i.test(text)) {
    const gauge = skyboundCountForInstance(ctx);
    const targets = [...ctx.player.board].filter(unit => unit.type === "Follower" && !unit.evolved && !unit.superEvolved);
    if (gauge >= 15) {
      for (const unit of targets) superEvolveUnitByAbility(ctx, unit, actions);
    } else if (gauge >= 10) {
      for (const unit of targets) evolveUnitByAbility(ctx, unit, actions);
    }
    actions.push(`Seofon: ${gauge >= 15 ? "Super Skybound" : gauge >= 10 ? "Skybound" : "inactive"} · gauge ${gauge}`);
    text = "";
  }


  // [[battle-high-risk-tail-preflight]]
  // These remaining clauses need the whole sentence intact, so resolve them
  // before broader generic fragments (damage, evolve, destroy, keyword, etc.).
  const cardName = norm(ctx.card?.name);

  // Generic article-bearing tutors that escaped the first tutor grammar.
  for (const match of [...text.matchAll(/Draw\s+(?:a|an|one|1)\s+(?:(Forestcraft|Swordcraft|Runecraft|Dragoncraft|Abysscraft|Havencraft|Portalcraft|Neutral)\s+)?follower\.?/gi)]) {
    const cls = match[1] ? norm(match[1]) : null;
    const item = drawMatchingCard(ctx.player, card => card.type === "Follower" && (!cls || norm(card.class) === cls), ctx.stats, ctx.playerIndex, ctx.rng);
    actions.push(`draw follower${item ? ` ${item.card.name}` : " unavailable"}`);
    text = text.replace(match[0], " ");
  }

  // --- Abysscraft ---------------------------------------------------------
  if (cardName === "baal, elemental resonance") {
    const effect = /Give this follower and another random allied follower on the field \+1\/\+1\.?/i;
    if (effect.test(text)) {
      if (ctx.sourceUnit) buff(ctx.sourceUnit, 1, 1);
      const pool = ctx.player.board.filter(unit => unit.type === "Follower" && unit.uid !== ctx.sourceUnit?.uid);
      const target = pool.length ? pool[Math.floor(ctx.rng() * pool.length)] : null;
      if (target) buff(target, 1, 1);
      actions.push(`Baal: self and ${target?.name ?? "no other ally"} +1/+1`);
      text = text.replace(effect, " ");
    }
  }

  if (cardName === "deprived destroyer") {
    const effect = /Select another allied follower on the field\.\s*If you selected one, destroy it and evolve this follower\.?/i;
    if (effect.test(text)) {
      const target = ctx.player.board.filter(unit => unit.type === "Follower" && unit.uid !== ctx.sourceUnit?.uid)
        .sort((a,b) => (Number(a.attack)+Number(a.defense))-(Number(b.attack)+Number(b.defense)))[0] ?? null;
      if (target) {
        actions.push(...destroyObject(ctx.player, ctx.opponent, target, ctx.playerIndex, ctx.enemyIndex, ctx.stats, ctx.rng, ctx.cardMap, true));
        if (ctx.sourceUnit) evolveUnitByAbility(ctx, ctx.sourceUnit, actions);
      }
      actions.push(`Deprived Destroyer: sacrifice ${target?.name ?? "unavailable"}`);
      text = text.replace(effect, " ");
    }
  }

  if (cardName === "nezha, soaring war god") {
    const effect = /deal 4 damage to a random enemy follower, then deal 2 damage to a random enemy follower\.?/i;
    if (effect.test(text)) {
      for (const amount of [4, 2]) {
        const pool = ctx.opponent.board.filter(unit => unit.type === "Follower" && unit.defense > 0);
        const target = pool.length ? pool[Math.floor(ctx.rng() * pool.length)] : null;
        if (target) damageUnit(target, amount, ctx.opponent, ctx.player, ctx, actions);
      }
      actions.push("Nezha: sequential 4 then 2 random damage");
      text = text.replace(effect, " ");
    }
  }

  if (cardName === "fediel, darkness personified") {
    const effect = /Necromancy\s*\(?\s*6\s*\)?\s*[-–—:]\s*Reanimate\s*\(?\s*2\s*\)?\s*,\s*Reanimate\s*\(?\s*1\s*\)?\s*,?\s*and evolve them\.?/i;
    if (effect.test(text)) {
      const summoned = [];
      if ((Number(ctx.player.shadows) || 0) >= 6) {
        ctx.player.shadows -= 6;
        for (const cost of [2, 1]) {
          const unit = reanimate(ctx.player, cost, ctx.playerIndex, ctx.cardMap, ctx.rng);
          if (!unit || ctx.player.board.length >= 5) continue;
          ctx.player.board.push(unit);
          ctx.player.rally += 1;
          actions.push(`Fediel: Reanimate ${cost} ${unit.name}`, ...applyEntryEvents(ctx, unit));
          summoned.push(unit);
        }
        for (const unit of summoned) evolveUnitByAbility(ctx, unit, actions);
      }
      actions.push(`Fediel: Necromancy 6 · ${summoned.length} evolved reanimates`);
      text = text.replace(effect, " ");
    }
  }

  // --- Conditional auto-evolution must precede plain "evolve this" grammar.
  const maxPpAuto = /If you have 10 max play points, evolve this follower\.?/i;
  if (maxPpAuto.test(text)) {
    if ((Number(ctx.player.maxPp) || 0) >= 10 && ctx.sourceUnit) evolveUnitByAbility(ctx, ctx.sourceUnit, actions);
    text = text.replace(maxPpAuto, " ");
  }
  const overflowAuto = /If you'?re in Overflow, evolve this follower\.?/i;
  if (overflowAuto.test(text)) {
    if (canUseClassMechanic(ctx.player, "overflow", ctx.card) && (Number(ctx.player.maxPp) || 0) >= 7 && ctx.sourceUnit) evolveUnitByAbility(ctx, ctx.sourceUnit, actions);
    text = text.replace(overflowAuto, " ");
  }
  const evolvedAllyAuto = /If there'?s an evolved allied follower on the field, evolve this follower\.?/i;
  if (evolvedAllyAuto.test(text)) {
    if (ctx.player.board.some(unit => unit.type === "Follower" && unit.uid !== ctx.sourceUnit?.uid && (unit.evolved || unit.superEvolved)) && ctx.sourceUnit) {
      evolveUnitByAbility(ctx, ctx.sourceUnit, actions);
    }
    text = text.replace(evolvedAllyAuto, " ");
  }

  // --- Dragoncraft --------------------------------------------------------
  if (cardName === "springwell steward") {
    const effect = /select 2 instead\.?/i;
    if (effect.test(text)) {
      const targets = [...ctx.opponent.board].filter(unit => unit.type === "Follower")
        .sort((a,b) => followerThreatValue(b)-followerThreatValue(a)).slice(0, 2);
      for (const target of targets) damageUnit(target, 5, ctx.opponent, ctx.player, ctx, actions);
      actions.push(`Springwell Steward: 5 damage to ${targets.length} targets`);
      text = text.replace(effect, " ");
    }
  }

  if (cardName === "vorlalai, eld blades") {
    const effect = /add 3 copies instead\.?/i;
    if (effect.test(text)) {
      const token = findByName(ctx.cardMap, "Depths of the Eld Blades") ?? related(ctx.card, ctx.cardMap).find(card => norm(card.name) === "depths of the eld blades");
      const added = token ? addHand(ctx.player, token, 3, ctx.playerIndex, ctx.stats) : 0;
      if (added) ctx.stats.cardsGenerated[ctx.playerIndex] += added;
      actions.push(`Vorlalai: add ${added} Depths`);
      text = text.replace(effect, " ");
    }
  }

  if (cardName === "draconic berserker") {
    const effect = /deal damage to all enemy followers instead\.?/i;
    if (effect.test(text)) {
      for (const unit of ctx.opponent.board.filter(unit => unit.type === "Follower")) damageUnit(unit, 4, ctx.opponent, ctx.player, ctx, actions);
      actions.push("Draconic Berserker: 4 damage to all enemy followers");
      text = text.replace(effect, " ");
    }
  }

  const giveSelfKeyword = text.match(/Give this follower\s+(Ambush|Aura|Bane|Barrier|Drain|Intimidate|Rush|Storm|Ward)\.?/i);
  if (giveSelfKeyword && ctx.sourceUnit) {
    const keyword = giveSelfKeyword[1][0].toUpperCase() + giveSelfKeyword[1].slice(1).toLowerCase();
    highRiskGrantKeyword(ctx.sourceUnit, keyword);
    actions.push(`${ctx.sourceUnit.name}: gain ${keyword}`);
    text = text.replace(giveSelfKeyword[0], " ");
  }

  if (cardName === "congregant of disdain") {
    const effect = /if this follower'?s defense is 3 or less, give all Dragoncraft followers in your hand \+1\/\+1\.?/i;
    if (effect.test(text)) {
      let count = 0;
      if ((Number(ctx.sourceUnit?.defense) || 0) <= 3) {
        for (const item of ctx.player.hand) {
          if (item.card?.type !== "Follower" || norm(item.card?.class) !== "dragoncraft") continue;
          item.attackBonus = (Number(item.attackBonus) || 0) + 1;
          item.defenseBonus = (Number(item.defenseBonus) || 0) + 1;
          count += 1;
        }
      }
      actions.push(`Congregant of Disdain: hand buff ×${count}`);
      text = text.replace(effect, " ");
    }
  }

  if (cardName === "ruinbringer") {
    const effect = /banish all 1-, 3-, 5-, 7-, and 9-cost cards from your deck\.\s*deal x damage split between all enemy followers\.\s*x is the number of cards you banished\.?/i;
    if (effect.test(text)) {
      const odd = new Set([1,3,5,7,9]);
      const banished = ctx.player.deck.filter(item => odd.has(Number(item.card?.cost) || 0));
      ctx.player.deck = ctx.player.deck.filter(item => !odd.has(Number(item.card?.cost) || 0));
      ctx.player.banished.push(...banished.map(item => ({ uid: item.uid, card: item.card })));
      let remaining = banished.length;
      const total = remaining;
      while (remaining > 0) {
        const pool = ctx.opponent.board.filter(unit => unit.type === "Follower" && unit.defense > 0);
        if (!pool.length) break;
        const target = pool[Math.floor(ctx.rng() * pool.length)];
        damageUnit(target, 1, ctx.opponent, ctx.player, ctx, actions);
        remaining -= 1;
      }
      actions.push(`Ruinbringer: banish ${total} odd-cost deck cards · split ${total}`);
      text = text.replace(effect, " ");
    }
  }

  if (cardName === "garyu, fabled dragonkin") {
    for (const [tokenName, keyword] of [["Supreme Golden Dragon", "Storm"], ["Supreme Silver Dragon", "Barrier"]]) {
      const regex = new RegExp(`Give all allied copies of ${tokenName} on the field ${keyword}\\.?`, "i");
      if (!regex.test(text)) continue;
      let count = 0;
      for (const unit of ctx.player.board.filter(unit => unit.type === "Follower" && norm(unit.name) === norm(tokenName))) { highRiskGrantKeyword(unit, keyword); count += 1; }
      actions.push(`Garyu: ${tokenName} ${keyword} ×${count}`);
      text = text.replace(regex, " ");
    }
  }

  if (cardName === "lumiore & argente, shining wings") {
    const effect = /Select 2 cards in your hand and discard them\.\s*Deal 4 damage to all enemies\.?/i;
    if (effect.test(text)) {
      const discarded = highRiskDiscardItems(ctx, ctx.player.hand.slice(0,2), actions);
      for (const unit of ctx.opponent.board.filter(unit => unit.type === "Follower")) damageUnit(unit, 4, ctx.opponent, ctx.player, ctx, actions);
      const dealt = damageLeader(ctx.opponent, 4); ctx.stats.damageDealt[ctx.playerIndex] += dealt;
      actions.push(`Lumiore & Argente: discard ${discarded} · 4 damage all enemies`);
      text = text.replace(effect, " ");
    }
  }

  if (cardName === "mugen, steel-bodied honesty") {
    const effect = /Super Skybound Art\s*:\s*Give this follower Storm\.?/i;
    if (effect.test(text)) {
      if (skyboundCountForInstance(ctx) >= 15 && ctx.sourceUnit) highRiskGrantKeyword(ctx.sourceUnit, "Storm");
      actions.push(`Mugen: Super Skybound ${skyboundCountForInstance(ctx) >= 15 ? "active" : "inactive"}`);
      text = text.replace(effect, " ");
    }
  }

  if (cardName === "erntz, governing justice") {
    const effect = /remove ward from this follower\.\s*give it intimidate\.?/i;
    if (effect.test(text) && ctx.sourceUnit) {
      ctx.sourceUnit.keywords = ctx.sourceUnit.keywords.filter(keyword => norm(keyword) !== "ward");
      highRiskGrantKeyword(ctx.sourceUnit, "Intimidate");
      actions.push("Erntz: remove Ward · gain Intimidate");
      text = text.replace(effect, " ");
    }
  }

  // --- Forestcraft --------------------------------------------------------
  if (cardName === "lymaga, untamed wild") {
    const lock = /Select 2 enemy followers on the field and give them ["“]Can'?t attack followers or leaders["”] until the end of your opponent'?s turn\.?/i;
    if (lock.test(text)) {
      const targets = [...ctx.opponent.board].filter(unit => unit.type === "Follower")
        .sort((a,b) => followerThreatValue(b)-followerThreatValue(a)).slice(0,2);
      for (const target of targets) { target.yuriusAttackLocked = true; target.canAttackLeader = false; target.canAttackFollower = false; }
      actions.push(`Lymaga: lock ${targets.length} enemies`);
      text = text.replace(lock, " ");
    }
    const curse = /select 2 enemy followers on the field and give them ["“]at the end of each turn, deal 1 damage to your leader and 2 damage to this follower\.["”]/i;
    if (curse.test(text)) {
      const targets = [...ctx.opponent.board].filter(unit => unit.type === "Follower")
        .sort((a,b) => followerThreatValue(b)-followerThreatValue(a)).slice(0,2);
      for (const target of targets) target.highRiskLymagaEndTurnCurse = true;
      actions.push(`Lymaga: curse ${targets.length} enemies`);
      text = text.replace(curse, " ");
    }
  }

  const bareAttackCount = text.match(/Can attack\s*(\d+)\s*times per turn\.?/i);
  if (bareAttackCount && ctx.sourceUnit) {
    const count = Number(bareAttackCount[1]) || 1;
    ctx.sourceUnit.baseMaxAttacks = Math.max(count, Number(ctx.sourceUnit.baseMaxAttacks) || 1);
    ctx.sourceUnit.maxAttacks = Math.max(count, Number(ctx.sourceUnit.maxAttacks) || 1);
    actions.push(`${ctx.sourceUnit.name}: attack ×${count}`);
    text = text.replace(bareAttackCount[0], " ");
  }

  // --- Havencraft ---------------------------------------------------------
  if (cardName === "damus, oracle of malice") {
    const effect = /Select an enemy follower on the field and give it ["“]At the end of your turn, destroy this card\.["”]/i;
    if (effect.test(text)) {
      const target = choosePlannedTarget(ctx, ctx.opponent.board.filter(unit => unit.type === "Follower"));
      if (target) target.highRiskDestroyAtOwnTurnEnd = true;
      actions.push(`Damus: mark ${target?.name ?? "no target"} for owner-turn destruction`);
      text = text.replace(effect, " ");
    }
  }

  if (cardName === "lamretta, sisterly shepherd") {
    const effect = /if this follower is evolved, deal 2 damage to all followers\.?/i;
    if (effect.test(text)) {
      if (ctx.sourceUnit?.evolved || ctx.sourceUnit?.superEvolved) {
        for (const unit of ctx.player.board.filter(unit => unit.type === "Follower")) damageUnit(unit, 2, ctx.player, ctx.opponent, ctx, actions);
        for (const unit of ctx.opponent.board.filter(unit => unit.type === "Follower")) damageUnit(unit, 2, ctx.opponent, ctx.player, ctx, actions);
      }
      actions.push("Lamretta: evolved all-follower damage check");
      text = text.replace(effect, " ");
    }
  }

  if (cardName === "unholy vessel") {
    const effect = /Destroy this card and all followers\.?/i;
    if (effect.test(text)) {
      if (ctx.sourceUnit) actions.push(...destroyObject(ctx.player, ctx.opponent, ctx.sourceUnit, ctx.playerIndex, ctx.enemyIndex, ctx.stats, ctx.rng, ctx.cardMap, true));
      for (const unit of [...ctx.player.board].filter(unit => unit.type === "Follower")) destroyUnit(ctx.player, unit);
      for (const unit of [...ctx.opponent.board].filter(unit => unit.type === "Follower")) destroyUnit(ctx.opponent, unit);
      actions.push("Unholy Vessel: destroy self and all followers");
      text = text.replace(effect, " ");
    }
  }

  // --- Neutral ------------------------------------------------------------
  if (cardName === "inspirational one" || cardName === "dogged one") {
    const reactive = /Activates in hand\.\s*When an enemy follower super-evolves, give this follower (Bane|Storm)\.?/i;
    if (reactive.test(text)) {
      actions.push(`${ctx.card.name}: enemy Super-Evolve hand trigger registered`);
      text = text.replace(reactive, " ");
    }
  }

  if (cardName === "arriet, luxminstrel") {
    const effect = /restore 4 defense instead\.?/i;
    if (effect.test(text)) {
      const healed = healPlayer(ctx.player, 4, ctx.stats, ctx.playerIndex);
      actions.push(`Arriet: restore ${healed}/4 leader defense`);
      text = text.replace(effect, " ");
    }
  }

  if (cardName === "dark dimensions") {
    const effect = /deal 2 damage to all non-Encroacher followers\.?/i;
    if (effect.test(text)) {
      const isEncroacher = unit => (unit.card?.traits ?? []).some(trait => norm(trait) === "encroacher");
      for (const unit of ctx.player.board.filter(unit => unit.type === "Follower" && !isEncroacher(unit))) damageUnit(unit, 2, ctx.player, ctx.opponent, ctx, actions);
      for (const unit of ctx.opponent.board.filter(unit => unit.type === "Follower" && !isEncroacher(unit))) damageUnit(unit, 2, ctx.opponent, ctx.player, ctx, actions);
      actions.push("Dark Dimensions: 2 damage to all non-Encroacher followers");
      text = text.replace(effect, " ");
    }
  }

  // --- Portalcraft --------------------------------------------------------
  if (cardName === "axia, heir to destruction") {
    const effect = /deal x damage to the enemy leader\.\s*x is the number of other allied cards on the field\.\s*destroy all other allied cards on the field\.?/i;
    if (effect.test(text)) {
      const others = [...ctx.player.board].filter(unit => unit.uid !== ctx.sourceUnit?.uid);
      const dealt = damageLeader(ctx.opponent, others.length); ctx.stats.damageDealt[ctx.playerIndex] += dealt;
      for (const unit of others) actions.push(...destroyObject(ctx.player, ctx.opponent, unit, ctx.playerIndex, ctx.enemyIndex, ctx.stats, ctx.rng, ctx.cardMap, true));
      actions.push(`Axia: ${dealt} leader damage · destroy ${others.length} allied cards`);
      text = text.replace(effect, " ");
    }
  }

  if (cardName === "the journey ahead") {
    const effect = /Select an enemy follower on the field and deal it 6 damage\.\s*If at least 3 differently named allied Artifact followers have entered the field this match, recover 1 evolution point\.?/i;
    if (effect.test(text)) {
      const target = choosePlannedTarget(ctx, ctx.opponent.board.filter(unit => unit.type === "Follower"));
      if (target) damageUnit(target, 6, ctx.opponent, ctx.player, ctx, actions);
      const history = new Set((ctx.player.artifactFollowerNamesEntered ?? []).map(norm)).size;
      if (history >= 3) ctx.player.ep = Math.min(2, (Number(ctx.player.ep) || 0) + 1);
      actions.push(`Journey Ahead: 6 damage · Artifact history ${history}`);
      text = text.replace(effect, " ");
    }
  }

  if (cardName === "mecha cavalier") {
    const effect = /summon 2 instead\.?/i;
    if (effect.test(text)) {
      const summoned = summonWithEvents(ctx.player, ctx.card, 2, ctx.playerIndex, ctx);
      actions.push(`Mecha Cavalier: summon ${summoned}/2 copies`);
      text = text.replace(effect, " ");
    }
  }

  if (cardName === "chaos legion") {
    const effect = /Deal 3 damage to all enemies\.\s*Super Skybound Art\s*:\s*Deal 6 damage instead\.?/i;
    if (effect.test(text)) {
      const amount = skyboundCountForInstance(ctx) >= 15 ? 6 : 3;
      for (const unit of ctx.opponent.board.filter(unit => unit.type === "Follower")) damageUnit(unit, amount, ctx.opponent, ctx.player, ctx, actions);
      const dealt = damageLeader(ctx.opponent, amount); ctx.stats.damageDealt[ctx.playerIndex] += dealt;
      actions.push(`Chaos Legion: ${amount} damage to all enemies`);
      text = text.replace(effect, " ");
    }
  }

  if (cardName === "sylvia, garden executioner") {
    const effect = /select 2 instead\.?/i;
    if (effect.test(text)) {
      const targets = [...ctx.opponent.board].filter(unit => unit.type === "Follower")
        .sort((a,b) => followerThreatValue(b)-followerThreatValue(a)).slice(0,2);
      for (const target of targets) actions.push(...destroyObject(ctx.opponent, ctx.player, target, ctx.enemyIndex, ctx.playerIndex, ctx.stats, ctx.rng, ctx.cardMap, true));
      actions.push(`Sylvia: destroy ${targets.length}/2 enemies`);
      text = text.replace(effect, " ");
    }
  }

  // --- Runecraft ----------------------------------------------------------
  if (cardName === "velharia, heir to truth") {
    const selectedBanish = /Select an enemy follower on the field and banish it\.?/i;
    if (selectedBanish.test(text)) {
      const target = choosePlannedTarget(ctx, ctx.opponent.board.filter(unit => unit.type === "Follower"));
      if (target) { if (ctx.sourceUnit) ctx.sourceUnit.highRiskLastSelectedEnemyName = norm(target.name); banish(ctx.opponent, target); }
      actions.push(`Velharia: banish selected ${target?.name ?? "none"}`);
      text = text.replace(selectedBanish, " ");
    }
    const copies = /banish all enemy copies of it from the field\.?/i;
    if (copies.test(text)) {
      const name = ctx.sourceUnit?.highRiskLastSelectedEnemyName;
      const targets = name ? [...ctx.opponent.board].filter(unit => unit.type === "Follower" && norm(unit.name) === name) : [];
      for (const target of targets) banish(ctx.opponent, target);
      actions.push(`Velharia: banish ${targets.length} matching enemy copies`);
      text = text.replace(copies, " ");
    }
  }

  // --- Swordcraft ---------------------------------------------------------
  if (cardName === "gelt, intrepid vice-captain") {
    const effect = /if there'?s a super-evolved allied follower on the field, give all allied followers on the field \+1\/\+1\.?/i;
    if (effect.test(text)) {
      let count = 0;
      if (ctx.player.board.some(unit => unit.type === "Follower" && unit.superEvolved)) {
        for (const unit of ctx.player.board.filter(unit => unit.type === "Follower")) { buff(unit, 1, 1); count += 1; }
      }
      actions.push(`Gelt: board +1/+1 ×${count}`);
      text = text.replace(effect, " ");
    }
  }

  if (cardName === "rusty, luxcard trickster") {
    const effect = /draw all copies of rusty, luxcard trickster and give them storm\.?/i;
    if (effect.test(text)) {
      const copies = ctx.player.deck.filter(item => norm(item.card?.name) === cardName);
      ctx.player.deck = ctx.player.deck.filter(item => norm(item.card?.name) !== cardName);
      let drawn = 0;
      for (const item of copies) {
        item.grantedKeywords ??= [];
        if (!item.grantedKeywords.includes("Storm")) item.grantedKeywords.push("Storm");
        if (ctx.player.hand.length < 9) { ctx.player.hand.push(item); ctx.stats.draws[ctx.playerIndex] += 1; drawn += 1; }
        else { toCemetery(ctx.player, item, false); ctx.stats.cardsBurned[ctx.playerIndex] += 1; }
      }
      actions.push(`Rusty: draw ${drawn}/${copies.length} copies with Storm`);
      text = text.replace(effect, " ");
    }
  }

  if (cardName === "seofon, leader of the eternals") {
    const effect = /Skybound Art\s*:\s*Evolve all unevolved allied followers on the field\.\s*Super Skybound Art\s*:\s*Super-evolve them instead\.?/i;
    if (effect.test(text)) {
      const gauge = skyboundCountForInstance(ctx);
      if (gauge >= 15) {
        for (const unit of [...ctx.player.board].filter(unit => unit.type === "Follower" && !unit.evolved && !unit.superEvolved)) superEvolveUnitByAbility(ctx, unit, actions);
      } else if (gauge >= 10) {
        for (const unit of [...ctx.player.board].filter(unit => unit.type === "Follower" && !unit.evolved && !unit.superEvolved)) evolveUnitByAbility(ctx, unit, actions);
      }
      actions.push(`Seofon: Skybound gauge ${gauge}`);
      text = text.replace(effect, " ");
    }
  }

  if (cardName === "golden knight, true king's blade") {
    const effect = /Super-evolve this follower\.?/i;
    if (effect.test(text)) {
      if (ctx.sourceUnit) superEvolveUnitByAbility(ctx, ctx.sourceUnit, actions);
      text = text.replace(effect, " ");
    }
  }

  if (cardName === "oluon, raging chariot") {
    const effect = /if this follower is unevolved, deal 7 damage to all enemy followers\.\s*If it'?s evolved, do this 3 times:\s*["“]Deal 7 damage to another random ally or enemy\.["”]/i;
    if (effect.test(text)) {
      if (ctx.sourceUnit?.evolved || ctx.sourceUnit?.superEvolved) {
        for (let i = 0; i < 3; i += 1) {
          const pool = [
            ...ctx.player.board.filter(unit => unit.type === "Follower" && unit.uid !== ctx.sourceUnit?.uid && unit.defense > 0).map(unit => ({ owner: ctx.player, unit })),
            ...ctx.opponent.board.filter(unit => unit.type === "Follower" && unit.defense > 0).map(unit => ({ owner: ctx.opponent, unit }))
          ];
          if (!pool.length) break;
          const picked = pool[Math.floor(ctx.rng() * pool.length)];
          damageUnit(picked.unit, 7, picked.owner, picked.owner === ctx.player ? ctx.opponent : ctx.player, ctx, actions);
        }
      } else {
        for (const unit of ctx.opponent.board.filter(unit => unit.type === "Follower")) damageUnit(unit, 7, ctx.opponent, ctx.player, ctx, actions);
      }
      actions.push(`Oluon: ${ctx.sourceUnit?.evolved || ctx.sourceUnit?.superEvolved ? "3 random 7-damage hits" : "7 damage all enemies"}`);
      text = text.replace(effect, " ");
    }
  }

  ctx.__sideActions = actions;

  // [[battle-high-risk-common-preflight]]
  // Generic Skybound labels use the standard 10/15 turn+evolution gauges.
  const sky = skyboundCountForInstance(ctx);
  const superSky = text.match(/Super Skybound Art\s*:\s*([\s\S]*)$/i);
  if (superSky) {
    if (sky >= 15) text = `${text.slice(0, superSky.index)} ${superSky[1]}`.trim();
    else text = text.slice(0, superSky.index).trim();
  }
  const skybound = text.match(/Skybound Art\s*:\s*([\s\S]*)$/i);
  if (skybound) {
    if (sky >= 10) text = `${text.slice(0, skybound.index)} ${skybound[1]}`.trim();
    else text = text.slice(0, skybound.index).trim();
  }

  // Structural labels/state that do not themselves perform an action.
  text = text.replace(/\bCountdown\s*\(?\s*\d+\s*\)?\.?/gi, " ");
  text = text.replace(/\bActivates in hand\.?/gi, " ");
  text = text.replace(/^Earth Sigil\.?/i, () => { if (canUseClassMechanic(ctx.player, "earthRite", ctx.card)) { ctx.player.earthSigils += 1; actions.push(`Earth Sigils +1 (${ctx.player.earthSigils})`); } return " "; });
  const leaveBanish = /When this card leaves the field, banish it\.?/i;
  if (leaveBanish.test(text) && ctx.sourceUnit) { ctx.sourceUnit.banishOnLeave = true; actions.push(`${ctx.sourceUnit.name}: banish on leave`); text = text.replace(leaveBanish, " "); }
  const banishThis = /Banish this card\.?/i;
  if (banishThis.test(text) && ctx.sourceUnit) { banish(ctx.player, ctx.sourceUnit); actions.push(`banish ${ctx.sourceUnit.name}`); text = text.replace(banishThis, " "); }

  // Draw/tutor primitives.
  for (const match of [...text.matchAll(/Draw\s+(?:(\d+)\s+)?(?:(Forestcraft|Swordcraft|Runecraft|Dragoncraft|Abysscraft|Havencraft|Portalcraft|Neutral)\s+)?followers?\.?/gi)]) {
    const count = Number(match[1] || 1); const cls = match[2] ? norm(match[2]) : null;
    const drawn = highRiskDrawMatching(ctx, count, card => card.type === "Follower" && (!cls || norm(card.class) === cls), "follower tutor");
    actions.push(`draw ${drawn}/${count} follower${count === 1 ? "" : "s"}`); text = text.replace(match[0], " ");
  }
  for (const match of [...text.matchAll(/Draw\s+(?:a|an|one|1)\s+(\d+)-cost spell\.?/gi)]) {
    const cost = Number(match[1]); const drawn = highRiskDrawMatching(ctx, 1, card => card.type === "Spell" && Number(card.cost) === cost, `${cost}-cost spell tutor`);
    actions.push(`draw ${drawn} ${cost}-cost spell`); text = text.replace(match[0], " ");
  }
  const wardDraw = text.match(/Draw X cards\.\s*X is the number of allied followers on the field with Ward\.?/i);
  if (wardDraw) { const x = ctx.player.board.filter(unit => unit.type === "Follower" && hasU(unit, "Ward")).length; const drawn = drawCards(ctx.player, x, ctx.stats, ctx.playerIndex); actions.push(`draw ${drawn}/${x} from allied Ward count`); text = text.replace(wardDraw[0], " "); }

  // Resource changes.
  for (const match of [...text.matchAll(/Gain\s+(\d+)\s+shadows?\.?/gi)]) { ctx.player.shadows += Number(match[1]); actions.push(`Shadows +${match[1]}`); text = text.replace(match[0], " "); }
  for (const match of [...text.matchAll(/Recover\s+(\d+)\s+evolution points?\.?/gi)]) { const n=Number(match[1]); ctx.player.ep=Math.min(2,(Number(ctx.player.ep)||0)+n); actions.push(`EP +${n}`); text=text.replace(match[0]," "); }
  for (const match of [...text.matchAll(/Gain\s+(\d+)\s+max play points?\.?/gi)]) { const n=Number(match[1]); ctx.player.maxPp=Math.min(10,(Number(ctx.player.maxPp)||0)+n); actions.push(`max PP +${n}`); text=text.replace(match[0]," "); }
  const classCost = text.match(/Reduce the cost of all (Forestcraft|Swordcraft|Runecraft|Dragoncraft|Abysscraft|Havencraft|Portalcraft|Neutral) cards in your hand by\s*(\d+)\.?/i);
  if (classCost) { let n=0; for(const item of ctx.player.hand){ if(norm(item.card?.class)===norm(classCost[1])){item.costDelta=(Number(item.costDelta)||0)-Number(classCost[2]); n+=1;}} actions.push(`${classCost[1]} hand cost -${classCost[2]} ×${n}`); text=text.replace(classCost[0]," "); }
  const sbN = text.match(/Spellboost your hand\s+(\d+)\s+times?\.?/i);
  if (sbN) { spellboostHand(ctx.player, Number(sbN[1]), ctx.cardMap, actions); text=text.replace(sbN[0]," "); }
  const sbX = /Spellboost your hand X times\.\s*X is this follower'?s attack\.?/i;
  if (sbX.test(text)) { const x=Math.max(0,Number(ctx.sourceUnit?.attack)||0); spellboostHand(ctx.player,x,ctx.cardMap,actions); actions.push(`Spellboost hand ×${x}`); text=text.replace(sbX," "); }
  const gauge = text.match(/Increase the Skybound Art gauges of all cards in your hand by\s*(\d+)\.?/i);
  if (gauge) { const n=Number(gauge[1]); for(const item of ctx.player.hand) item.skyboundEvolutions=(Number(item.skyboundEvolutions)||0)+n; actions.push(`hand Skybound gauges +${n}`); text=text.replace(gauge[0]," "); }

  // Evolution primitives and common conditions.
  const evolveSelf = /Evolve this follower\.?/i;
  if (evolveSelf.test(text) && ctx.sourceUnit) { evolveUnitByAbility(ctx, ctx.sourceUnit, actions); text=text.replace(evolveSelf," "); }
  const superSelf = /Super-evolve this follower\.?/i;
  if (superSelf.test(text) && ctx.sourceUnit) { superEvolveUnitByAbility(ctx, ctx.sourceUnit, actions); text=text.replace(superSelf," "); }
  const maxPpEvolve = /If you have 10 max play points, evolve this follower\.?/i;
  if (maxPpEvolve.test(text)) { if((Number(ctx.player.maxPp)||0)>=10 && ctx.sourceUnit) evolveUnitByAbility(ctx,ctx.sourceUnit,actions); text=text.replace(maxPpEvolve," "); }
  const overflowEvolve = /If you'?re in Overflow, evolve this follower\.?/i;
  if (overflowEvolve.test(text)) { if(canUseClassMechanic(ctx.player, "overflow", ctx.card) && (Number(ctx.player.maxPp)||0)>=7 && ctx.sourceUnit) evolveUnitByAbility(ctx,ctx.sourceUnit,actions); text=text.replace(overflowEvolve," "); }
  const evolvedAllyEvolve = /If there'?s an evolved allied follower on the field, evolve this follower\.?/i;
  if (evolvedAllyEvolve.test(text)) { if(ctx.player.board.some(unit=>unit.type==="Follower" && unit.uid!==ctx.sourceUnit?.uid && (unit.evolved||unit.superEvolved)) && ctx.sourceUnit) evolveUnitByAbility(ctx,ctx.sourceUnit,actions); text=text.replace(evolvedAllyEvolve," "); }
  const superAllyDamage = text.match(/If there'?s a super-evolved allied follower on the field, select an enemy follower on the field and deal it\s*(\d+)\s*damage\.?/i);
  if (superAllyDamage) { if(ctx.player.board.some(unit=>unit.type==="Follower"&&unit.uid!==ctx.sourceUnit?.uid&&unit.superEvolved)){ const target=choosePlannedTarget(ctx,ctx.opponent.board.filter(unit=>unit.type==="Follower")); if(target) damageUnit(target,Number(superAllyDamage[1]),ctx.opponent,ctx.player,ctx,actions);} text=text.replace(superAllyDamage[0]," "); }
  const evolveOther = /Select another unevolved allied follower on the field and evolve it(?: and this follower)?\.?/i;
  const evolveOtherMatch=text.match(evolveOther);
  if(evolveOtherMatch){ const target=ctx.player.board.find(unit=>unit.type==="Follower"&&unit.uid!==ctx.sourceUnit?.uid&&!unit.evolved&&!unit.superEvolved); if(target)evolveUnitByAbility(ctx,target,actions); if(/and this follower/i.test(evolveOtherMatch[0])&&ctx.sourceUnit)evolveUnitByAbility(ctx,ctx.sourceUnit,actions); text=text.replace(evolveOther," "); }
  const superOther=/Select another unevolved allied follower on the field and super-evolve it\.?/i;
  if(superOther.test(text)){ const target=ctx.player.board.find(unit=>unit.type==="Follower"&&unit.uid!==ctx.sourceUnit?.uid&&!unit.evolved&&!unit.superEvolved); if(target)superEvolveUnitByAbility(ctx,target,actions); text=text.replace(superOther," "); }
  const evolveAll=/Evolve all unevolved allied followers on the field\.?/i;
  if(evolveAll.test(text)){ for(const unit of [...ctx.player.board]) if(unit.type==="Follower"&&!unit.evolved&&!unit.superEvolved)evolveUnitByAbility(ctx,unit,actions); text=text.replace(evolveAll," "); }
  const superAll=/Super-evolve all unevolved allied followers on the field\.?/i;
  if(superAll.test(text)){ for(const unit of [...ctx.player.board]) if(unit.type==="Follower"&&!unit.evolved&&!unit.superEvolved)superEvolveUnitByAbility(ctx,unit,actions); text=text.replace(superAll," "); }

  // Targeted keyword grants/removal and attack locks.
  for (const match of [...text.matchAll(/Select another allied follower on the field and give it\s+(Bane|Storm|Rush|Ward|Barrier|Ambush|Aura|Intimidate)\.?/gi)]) { const target=highRiskOtherAlliedFollower(ctx); if(target)highRiskGrantKeyword(target, match[1][0].toUpperCase()+match[1].slice(1).toLowerCase()); actions.push(`other ally gains ${match[1]}`); text=text.replace(match[0]," "); }
  const selectAllyRush=/Select an allied follower on the field and give it Rush\.?/i;
  if(selectAllyRush.test(text)){ const target=ctx.player.board.find(unit=>unit.type==="Follower")??null; if(target)highRiskGrantKeyword(target,"Rush"); text=text.replace(selectAllyRush," "); }
  const shikiStorm=/Select an allied Shikigami follower on the field and give it Storm\.?/i;
  if(shikiStorm.test(text)){ const target=ctx.player.board.find(unit=>unit.type==="Follower"&&(unit.card?.traits??[]).some(t=>norm(t)==="shikigami")); if(target)highRiskGrantKeyword(target,"Storm"); text=text.replace(shikiStorm," "); }
  const removeSelfWard=/Remove Ward from this follower\.?/i;
  if(removeSelfWard.test(text)&&ctx.sourceUnit){ ctx.sourceUnit.keywords=ctx.sourceUnit.keywords.filter(k=>norm(k)!=="ward"); actions.push(`${ctx.sourceUnit.name}: remove Ward`); text=text.replace(removeSelfWard," "); }
  const removeTargetWard=/Select an enemy follower on the field and remove Ward from it\.?/i;
  if(removeTargetWard.test(text)){ const target=choosePlannedTarget(ctx,ctx.opponent.board.filter(unit=>unit.type==="Follower")); if(target)target.keywords=target.keywords.filter(k=>norm(k)!=="ward"); text=text.replace(removeTargetWard," "); }
  const cantAttack=/Give this follower ["“]Can'?t attack followers or leaders\.?["”](?: until the end of the turn)?\.?/i;
  if(cantAttack.test(text)&&ctx.sourceUnit){ctx.sourceUnit.canAttackLeader=false;ctx.sourceUnit.canAttackFollower=false;ctx.sourceUnit.highRiskAttackLockThisTurn=true;actions.push(`${ctx.sourceUnit.name}: attack locked this turn`);text=text.replace(cantAttack," ");}
  const staticCant=/Can'?t attack followers or leaders\.?/i;
  if(staticCant.test(text)&&ctx.sourceUnit){ctx.sourceUnit.permanentAttackLock=true;ctx.sourceUnit.canAttackLeader=false;ctx.sourceUnit.canAttackFollower=false;actions.push(`${ctx.sourceUnit.name}: permanent attack lock`);text=text.replace(staticCant," ");}
  const abilityImmune=/Can'?t be destroyed by abilities\.?/i;
  if(abilityImmune.test(text)&&ctx.sourceUnit){ctx.sourceUnit.abilityDestructionImmune=true;actions.push(`${ctx.sourceUnit.name}: ability-destruction immune`);text=text.replace(abilityImmune," ");}
  const attacksN=text.match(/Give this follower ["“]Can attack\s*(\d+)\s*times per turn\.?["”]/i);
  if(attacksN&&ctx.sourceUnit){ const n=Number(attacksN[1]);ctx.sourceUnit.baseMaxAttacks=Math.max(n,Number(ctx.sourceUnit.baseMaxAttacks)||1);ctx.sourceUnit.maxAttacks=Math.max(n,Number(ctx.sourceUnit.maxAttacks)||1);actions.push(`${ctx.sourceUnit.name}: attack ×${n}`);text=text.replace(attacksN[0]," ");}

  // Group buffs + keyword grants, including class-restricted variants.
  for(const match of [...text.matchAll(/Give all (other )?allied(?:(?:\s+(Forestcraft|Swordcraft|Runecraft|Dragoncraft|Abysscraft|Havencraft|Portalcraft|Neutral))?) followers on the field\s*\+(\d+)\/\+(\d+)(?:\s+and\s+(Rush|Ward|Barrier|Storm|Bane|Ambush|Aura|Intimidate))?\.?/gi)]){
    const units=highRiskAlliedGroup(ctx,{other:Boolean(match[1]),className:match[2]||null});const a=Number(match[3]),d=Number(match[4]);for(const unit of units){buff(unit,a,d);if(match[5])highRiskGrantKeyword(unit,match[5][0].toUpperCase()+match[5].slice(1).toLowerCase());}actions.push(`group buff ${units.length}: +${a}/+${d}${match[5]?` ${match[5]}`:""}`);text=text.replace(match[0]," ");
  }
  for(const match of [...text.matchAll(/Give all (other )?allied(?:(?:\s+(Forestcraft|Swordcraft|Runecraft|Dragoncraft|Abysscraft|Havencraft|Portalcraft|Neutral))?) followers on the field\s+(Rush|Ward|Barrier|Storm|Bane|Ambush|Aura|Intimidate)\.?/gi)]){
    const units=highRiskAlliedGroup(ctx,{other:Boolean(match[1]),className:match[2]||null});for(const unit of units)highRiskGrantKeyword(unit,match[3][0].toUpperCase()+match[3].slice(1).toLowerCase());actions.push(`group keyword ${match[3]} ×${units.length}`);text=text.replace(match[0]," ");
  }
  const classHandBuff=text.match(/Give all (Forestcraft|Swordcraft|Runecraft|Dragoncraft|Abysscraft|Havencraft|Portalcraft|Neutral) followers in your hand\s*\+(\d+)\/\+(\d+)\.?/i);
  if(classHandBuff){let n=0;for(const item of ctx.player.hand){if(item.card?.type==="Follower"&&norm(item.card?.class)===norm(classHandBuff[1])){item.attackBonus=(Number(item.attackBonus)||0)+Number(classHandBuff[2]);item.defenseBonus=(Number(item.defenseBonus)||0)+Number(classHandBuff[3]);n+=1;}}actions.push(`${classHandBuff[1]} hand buff ×${n}`);text=text.replace(classHandBuff[0]," ");}
  const leftmostAttack = text.match(/Give the leftmost allied (Forestcraft|Swordcraft|Runecraft|Dragoncraft|Abysscraft|Havencraft|Portalcraft|Neutral) follower on the field ["“]Can attack\s*(\d+)\s*times per turn\.?["”]/i);
  if (leftmostAttack) {
    const target = ctx.player.board.find(unit => unit.type === "Follower" && norm(unit.card?.class) === norm(leftmostAttack[1])) ?? null;
    if (target) {
      const count = Number(leftmostAttack[2]) || 1;
      target.baseMaxAttacks = Math.max(count, Number(target.baseMaxAttacks) || 1);
      target.maxAttacks = Math.max(count, Number(target.maxAttacks) || 1);
    }
    text = text.replace(leftmostAttack[0], " ");
  }

  // Common target removal/bounce.
  const returnOther=/Select another allied card on the field and return it to hand\.?/i;
  if(returnOther.test(text)){const target=ctx.player.board.find(unit=>unit.uid!==ctx.sourceUnit?.uid)??null;if(target)bounce(ctx.player,target);actions.push(`return allied card ${target?.name??"unavailable"}`);text=text.replace(returnOther," ");}
  const returnEnemy=/Select an enemy follower on the field and return it to hand\.?/i;
  if(returnEnemy.test(text)){const target=choosePlannedTarget(ctx,ctx.opponent.board.filter(unit=>unit.type==="Follower"));if(target)bounce(ctx.opponent,target);actions.push(`return enemy follower ${target?.name??"unavailable"}`);text=text.replace(returnEnemy," ");}
  const destroyHighest=/Destroy a random enemy follower with the highest attack\.?/i;
  if(destroyHighest.test(text)){const pool=ctx.opponent.board.filter(unit=>unit.type==="Follower");const max=Math.max(-Infinity,...pool.map(unit=>Number(unit.attack)||0));const candidates=pool.filter(unit=>(Number(unit.attack)||0)===max);const target=candidates.length?candidates[Math.floor(ctx.rng()*candidates.length)]:null;if(target)destroyUnit(ctx.opponent,target);actions.push(`destroy highest-attack enemy ${target?.name??"unavailable"}`);text=text.replace(destroyHighest," ");}
  const destroyTwo=/Select 2 enemy followers on the field and destroy them\.?/i;
  if(destroyTwo.test(text)){const targets=[...ctx.opponent.board].filter(unit=>unit.type==="Follower").sort((a,b)=>followerThreatValue(b)-followerThreatValue(a)).slice(0,2);for(const target of targets)destroyUnit(ctx.opponent,target);actions.push(`destroy ${targets.length} selected enemies`);text=text.replace(destroyTwo," ");}
  const destroySuper=/Select a super-evolved enemy follower on the field and destroy it\.?/i;
  if(destroySuper.test(text)){const target=ctx.opponent.board.find(unit=>unit.type==="Follower"&&unit.superEvolved)??null;if(target)destroyUnit(ctx.opponent,target);text=text.replace(destroySuper," ");}
  const banishLow=text.match(/Select an enemy follower on the field with\s*(\d+)\s*defense or less and banish it\.?/i);
  if(banishLow){const target=choosePlannedTarget(ctx,ctx.opponent.board.filter(unit=>unit.type==="Follower"&&(Number(unit.defense)||0)<=Number(banishLow[1])));if(target)banish(ctx.opponent,target);text=text.replace(banishLow[0]," ");}
  const banishAllLow=text.match(/Banish all enemy followers with\s*(\d+)\s*defense or less(?: instead)?\.?/i);
  if(banishAllLow){for(const target of [...ctx.opponent.board].filter(unit=>unit.type==="Follower"&&(Number(unit.defense)||0)<=Number(banishAllLow[1])))banish(ctx.opponent,target);text=text.replace(banishAllLow[0]," ");}
  const banishSelected=/Select an enemy follower on the field and banish it\.?/i;
  if(banishSelected.test(text)){const target=choosePlannedTarget(ctx,ctx.opponent.board.filter(unit=>unit.type==="Follower"));if(target)banish(ctx.opponent,target);text=text.replace(banishSelected," ");}

  // Attack-scaled target/split damage and all-followers damage.
  const attackDamage=/Select an enemy follower on the field and deal it X damage\.\s*X is this follower'?s attack\.?/i;
  if(attackDamage.test(text)){const x=Math.max(0,Number(ctx.sourceUnit?.attack)||0);const target=choosePlannedTarget(ctx,ctx.opponent.board.filter(unit=>unit.type==="Follower"));if(target)damageUnit(target,x,ctx.opponent,ctx.player,ctx,actions);actions.push(`attack-scaled damage ${x}`);text=text.replace(attackDamage," ");}
  const splitAttack=/Deal X damage split between all enemy followers\.\s*X is this follower'?s attack\.?/i;
  if(splitAttack.test(text)){let x=Math.max(0,Number(ctx.sourceUnit?.attack)||0);const original=x;const pool=ctx.opponent.board.filter(unit=>unit.type==="Follower");while(x>0&&pool.length){damageUnit(pool[Math.floor(ctx.rng()*pool.length)],1,ctx.opponent,ctx.player,ctx,actions);x-=1;}actions.push(`attack split damage ${original}`);text=text.replace(splitAttack," ");}
  const allFollowers=text.match(/Deal\s*(\d+)\s*damage to all followers\.?/i);
  if(allFollowers){const n=Number(allFollowers[1]);for(const unit of ctx.player.board.filter(unit=>unit.type==="Follower"))damageUnit(unit,n,ctx.player,ctx.opponent,ctx,actions);for(const unit of ctx.opponent.board.filter(unit=>unit.type==="Follower"))damageUnit(unit,n,ctx.opponent,ctx.player,ctx,actions);actions.push(`${n} damage all followers`);text=text.replace(allFollowers[0]," ");}

  // Healing / temporary states.
  const fullHeal=/Fully restore the defense of this follower and restore the same amount to your leader\.?/i;
  if(fullHeal.test(text)&&ctx.sourceUnit){const amount=Math.max(0,(Number(ctx.sourceUnit.maxDefense)||0)-(Number(ctx.sourceUnit.defense)||0));ctx.sourceUnit.defense=ctx.sourceUnit.maxDefense;healPlayer(ctx.player,amount,ctx.stats,ctx.playerIndex);actions.push(`fully heal self/leader ${amount}`);text=text.replace(fullHeal," ");}
  const allAlliesHeal=text.match(/Restore\s*(\d+)\s*defense to all allies\.?/i);
  if(allAlliesHeal){const n=Number(allAlliesHeal[1]);healPlayer(ctx.player,n,ctx.stats,ctx.playerIndex);for(const unit of ctx.player.board.filter(unit=>unit.type==="Follower"))unit.defense=Math.min(Number(unit.maxDefense)||unit.defense,(Number(unit.defense)||0)+n);actions.push(`restore ${n} to all allies`);text=text.replace(allAlliesHeal[0]," ");}

  // Deck summons / deck maintenance.
  const summonClass=text.match(/Summon a random (Forestcraft|Swordcraft|Runecraft|Dragoncraft|Abysscraft|Havencraft|Portalcraft|Neutral) follower that costs\s*(\d+)\s*or less from your deck\.?/i);
  if(summonClass){highRiskSummonDeckCard(ctx,card=>card.type==="Follower"&&norm(card.class)===norm(summonClass[1])&&(Number(card.cost)||0)<=Number(summonClass[2]));text=text.replace(summonClass[0]," ");}
  const summonAmulets=text.match(/Summon\s*(\d+)\s*random differently named amulets that cost\s*(\d+)\s*or less from your deck\.?/i);
  if(summonAmulets){const count=Number(summonAmulets[1]),max=Number(summonAmulets[2]);const seen=new Set();let n=0;for(let i=0;i<count;i++){const unit=highRiskSummonDeckCard(ctx,card=>card.type==="Amulet"&&(Number(card.cost)||0)<=max&&!seen.has(norm(card.name)));if(!unit)break;seen.add(norm(unit.name));n+=1;}actions.push(`summon ${n} different amulets from deck`);text=text.replace(summonAmulets[0]," ");}
  const dupes=/Banish all duplicates from your deck\.?/i;
  if(dupes.test(text)){const seen=new Set(),keep=[],ban=[];for(const item of ctx.player.deck){const key=norm(item.card?.name);if(seen.has(key))ban.push(item);else{seen.add(key);keep.push(item);}}ctx.player.deck=keep;ctx.player.banished.push(...ban.map(item=>({uid:item.uid,card:item.card})));actions.push(`banish ${ban.length} deck duplicates`);text=text.replace(dupes," ");}

  // Delayed/conditional board-wide wording.
  const ifSpells=text.match(/If you have at least\s*(\d+)\s*spells in your hand, deal\s*(\d+)\s*damage to all enemy followers\.?/i);
  if(ifSpells){if(ctx.player.hand.filter(item=>item.card?.type==="Spell").length>=Number(ifSpells[1]))for(const unit of ctx.opponent.board.filter(unit=>unit.type==="Follower"))damageUnit(unit,Number(ifSpells[2]),ctx.opponent,ctx.player,ctx,actions);text=text.replace(ifSpells[0]," ");}
  const ifAmulets=text.match(/If there are at least\s*(\d+)\s*allied amulets on the field, deal\s*(\d+)\s*damage to all enemies\.?/i);
  if(ifAmulets){if(ctx.player.board.filter(unit=>unit.type==="Amulet").length>=Number(ifAmulets[1])){for(const unit of ctx.opponent.board.filter(unit=>unit.type==="Follower"))damageUnit(unit,Number(ifAmulets[2]),ctx.opponent,ctx.player,ctx,actions);const dealt=damageLeader(ctx.opponent,Number(ifAmulets[2]));ctx.stats.damageDealt[ctx.playerIndex]+=dealt;}text=text.replace(ifAmulets[0]," ");}

  // Named special-pronoun bridge: Amorous Necromancer's Super-Evolve refers to
  // the Ghosts created by its Evolve ability.
  if(norm(ctx.card?.name)==="amorous necromancer" && /Give them Drain\.?/i.test(text)){for(const unit of ctx.player.board.filter(unit=>norm(unit.name)==="ghost"))highRiskGrantKeyword(unit,"Drain");actions.push("Amorous Necromancer: Ghosts gain Drain");text=text.replace(/Give them Drain\.?/i," ");}

  // [[battle-high-risk-earth-sigil-grammar]]
  // Some imported cards use singular lower-case wording which historically
  // escaped the resource pass after other sentence fragments were rewritten.
  for (const match of [...text.matchAll(/Gain\s+(?:an?|one|1)\s+earth sigil\.?/gi)]) {
    if (canUseClassMechanic(ctx.player, "earthRite", ctx.card)) {
      ctx.player.earthSigils += 1;
      actions.push(`Earth Sigils +1 (${ctx.player.earthSigils})`);
    }
    text = text.replace(match[0], " ");
  }

  // [[battle-high-risk-compound-preflight]]
  // Compound clauses must be consumed before their inner generic subclauses,
  // otherwise a broad summon/damage matcher can erase the condition/payoff.
  const limil = text.match(/If your leader'?s defense is higher than the enemy leader'?s defense, summon\s*(\d+)\s+copies of Bat\.?/i);
  if (limil) {
    let summoned = 0;
    if (ctx.player.hp > ctx.opponent.hp) {
      const bat = findByName(ctx.cardMap, "Bat") ?? related(ctx.card, ctx.cardMap).find(card => norm(card.name) === "bat");
      if (bat) summoned = summonWithEvents(ctx.player, bat, Number(limil[1]) || 0, ctx.playerIndex, ctx);
    }
    actions.push(`conditional Bat summons ${summoned}`);
    text = text.replace(limil[0], " ");
  }

  const marsha = text.match(/Deal\s*(\d+)\s*damage to all enemy followers and both leaders\.?/i);
  if (marsha) {
    const amount = Number(marsha[1]) || 0;
    for (const unit of ctx.opponent.board.filter(unit => unit.type === "Follower")) damageUnit(unit, amount, ctx.opponent, ctx.player, ctx, actions);
    const dealt = damageLeader(ctx.opponent, amount); ctx.stats.damageDealt[ctx.playerIndex] += dealt;
    damageLeader(ctx.player, amount);
    actions.push(`${amount} damage to enemy followers and both leaders`);
    text = text.replace(marsha[0], " ");
  }

  const kandima = text.match(/Select another card on the field and destroy it\.\s*If you selected an allied amulet, deal\s*(\d+)\s*damage to all enemy followers\.?/i);
  if (kandima) {
    const target = ctx.player.board.find(unit => unit.uid !== ctx.sourceUnit?.uid && unit.type === "Amulet")
      ?? ctx.opponent.board[0] ?? ctx.player.board.find(unit => unit.uid !== ctx.sourceUnit?.uid) ?? null;
    const alliedAmulet = Boolean(target && ctx.player.board.includes(target) && target.type === "Amulet");
    if (target) {
      const owner = ctx.player.board.includes(target) ? ctx.player : ctx.opponent;
      const other = owner === ctx.player ? ctx.opponent : ctx.player;
      const oi = owner === ctx.player ? ctx.playerIndex : ctx.enemyIndex;
      const ei = owner === ctx.player ? ctx.enemyIndex : ctx.playerIndex;
      actions.push(...destroyObject(owner, other, target, oi, ei, ctx.stats, ctx.rng, ctx.cardMap, true));
    }
    if (alliedAmulet) for (const unit of ctx.opponent.board.filter(unit => unit.type === "Follower")) damageUnit(unit, Number(kandima[1]) || 0, ctx.opponent, ctx.player, ctx, actions);
    actions.push(`selected destruction${alliedAmulet ? " · allied amulet payoff" : ""}`);
    text = text.replace(kandima[0], " ");
  }

  const supplicant = text.match(/Select another allied card on the field\.\s*If you selected one, destroy it and deal\s*(\d+)\s*damage to a random enemy follower\.?/i);
  if (supplicant) {
    const target = ctx.player.board.find(unit => unit.uid !== ctx.sourceUnit?.uid) ?? null;
    if (target) actions.push(...destroyObject(ctx.player, ctx.opponent, target, ctx.playerIndex, ctx.enemyIndex, ctx.stats, ctx.rng, ctx.cardMap, true));
    const pool = ctx.opponent.board.filter(unit => unit.type === "Follower");
    const enemy = pool.length ? pool[Math.floor(ctx.rng() * pool.length)] : null;
    if (target && enemy) damageUnit(enemy, Number(supplicant[1]) || 0, ctx.opponent, ctx.player, ctx, actions);
    actions.push(`selected allied destruction${target ? "" : " unavailable"}`);
    text = text.replace(supplicant[0], " ");
  }

  const destroyedFollowerHidden = text.match(/Add a copy of a random allied follower destroyed this match to your hand without revealing it\.?/i);
  if (destroyedFollowerHidden) {
    const cards = highRiskHistoryCards(ctx.player.destroyedFollowers, 1, null, ctx.rng, true);
    for (const card of cards) highRiskAddCopyToHand(ctx, card);
    actions.push(`destroyed follower hidden copy ${cards.length}`);
    text = text.replace(destroyedFollowerHidden[0], " ");
  }
  const destroyedArtifactHidden = text.match(/Add a copy of a random allied Artifact follower destroyed this match to your hand without revealing it\.?/i);
  if (destroyedArtifactHidden) {
    const cards = highRiskHistoryCards(ctx.player.destroyedFollowers, 1, highRiskIsArtifact, ctx.rng, true);
    for (const card of cards) highRiskAddCopyToHand(ctx, card);
    actions.push(`destroyed Artifact hidden copy ${cards.length}`);
    text = text.replace(destroyedArtifactHidden[0], " ");
  }

  const doomwright = text.match(/Select 2 Artifact followers in your hand that cost 5 or less, summon an exact copy of each, and give the exact copies ["“]At the end of your opponent'?s turn, destroy this card\.["”]/i);
  if (doomwright) {
    const candidates = ctx.player.hand.filter(item => highRiskIsArtifact(item.card) && costOf(item) <= 5).slice(0, 2);
    let summoned = 0;
    for (const item of candidates) if (highRiskSummonExactFromHand(ctx, item, true)) summoned += 1;
    actions.push(`summon ${summoned} delayed exact Artifact copies`);
    text = text.replace(doomwright[0], " ");
  }

  const congregantConditional = text.match(/If this card'?s cost isn'?t 3, summon\s*(\d+)\s+exact copies of it\.?/i);
  if (congregantConditional) {
    let summoned = 0;
    if (costOf(ctx.instance) !== 3 && ctx.sourceUnit) {
      for (let i = 0; i < Number(congregantConditional[1]); i += 1) if (highRiskSummonExactFromUnit(ctx, ctx.sourceUnit, false)) summoned += 1;
    }
    actions.push(`conditional exact self copies ${summoned}`);
    text = text.replace(congregantConditional[0], " ");
  }
  const selfExact = text.match(/Summon an exact copy of this card\.?/i);
  if (selfExact && ctx.sourceUnit) {
    const summoned = highRiskSummonExactFromUnit(ctx, ctx.sourceUnit, false) ? 1 : 0;
    actions.push(`summon ${summoned} exact self copy`);
    text = text.replace(selfExact[0], " ");
  }

  const damageSigil = text.match(/Select an enemy follower on the field and deal it\s*(\d+)\s*damage\.\s*Gain an earth sigil\.?/i);
  if (damageSigil) {
    const target = choosePlannedTarget(ctx, ctx.opponent.board.filter(unit => unit.type === "Follower"));
    if (target) damageUnit(target, Number(damageSigil[1]) || 0, ctx.opponent, ctx.player, ctx, actions);
    if (canUseClassMechanic(ctx.player, "earthRite", ctx.card)) {
      ctx.player.earthSigils += 1;
      actions.push(`selected damage ${damageSigil[1]} · Earth Sigil +1`);
    }
    text = text.replace(damageSigil[0], " ");
  }

  const selfBuff = text.match(/Give this follower\s*\+(\d+)\s*\/\s*\+(\d+)(?:\s+and)?\.?/i);
  if (selfBuff && ctx.sourceUnit) {
    buff(ctx.sourceUnit, Number(selfBuff[1]) || 0, Number(selfBuff[2]) || 0);
    actions.push(`this follower +${selfBuff[1]}/+${selfBuff[2]}`);
    text = text.replace(selfBuff[0], " ");
  }

  // General Fanfare replay used by many Evolve/Super-Evolve/Engage abilities.
  const replicate = /Replicate the effects of this card'?s Fanfare ability\.?/i;
  if (replicate.test(text)) {
    highRiskReplayFanfare(ctx, actions);
    text = text.replace(replicate, " ");
  }
  const activateFanfare = /Activate (?:this card'?s|its) Fanfare ability\.?/i;
  if (activateFanfare.test(text)) {
    highRiskReplayFanfare(ctx, actions);
    text = text.replace(activateFanfare, " ");
  }

  // Random numbered ability lists (Kitty Cunning / Omegotep family).
  const randomAbilities = text.match(/Activate\s+(a|an|one|two|three|four|five|\d+)\s+random abilities? from the following\.\s*([\s\S]*)$/i);
  if (randomAbilities) {
    const count = highRiskWordNumber(randomAbilities[1], 1);
    const pool = highRiskRandomAbilitySegments(randomAbilities[2]);
    const chosen = [];
    while (chosen.length < count && pool.length) chosen.push(pool.splice(Math.floor(ctx.rng() * pool.length), 1)[0]);
    for (const option of chosen) {
      const nested = resolveText(option.text, ctx);
      actions.push(`random ability ${option.number}`, ...nested.actions);
      if (nested.unresolved) ctx.__highRiskNestedUnresolved = true;
    }
    text = text.slice(0, randomAbilities.index).trim();
  }

  // Hand discard / redraw primitives.
  const discardOne = /Select a card in your hand and discard it\.?/i;
  if (discardOne.test(text)) {
    const item = [...ctx.player.hand].sort((a,b) => costOf(a) - costOf(b))[0] ?? null;
    const count = item ? highRiskDiscardItems(ctx, [item], actions) : 0;
    actions.push(`discard ${count} selected card`);
    text = text.replace(discardOne, " ");
  }
  const discardThree = /Select 3 cards in your hand and discard them\.?/i;
  if (discardThree.test(text)) {
    const items = [...ctx.player.hand].slice(0, 3);
    const count = highRiskDiscardItems(ctx, items, actions);
    actions.push(`discard ${count} selected cards`);
    text = text.replace(discardThree, " ");
  }
  const discardHand = /Discard your hand\.?/i;
  if (discardHand.test(text)) {
    const count = highRiskDiscardItems(ctx, [...ctx.player.hand], actions);
    actions.push(`discard hand (${count})`);
    text = text.replace(discardHand, " ");
  }
  const returnAllDrawX = /Return your hand to (?:your )?deck\.\s*Draw X cards\.\s*X is the number of cards you returned\.?/i;
  if (returnAllDrawX.test(text)) {
    const returned = [...ctx.player.hand];
    ctx.player.hand = [];
    ctx.player.deck.push(...returned);
    shuffle(ctx.player.deck, ctx.rng);
    const drawn = drawCards(ctx.player, returned.length, ctx.stats, ctx.playerIndex);
    actions.push(`return hand ${returned.length} · draw ${drawn}`);
    text = text.replace(returnAllDrawX, " ");
  }
  const returnOneDraw = /Select a card in your hand and return it to (?:your )?deck\.\s*Draw a card\.?/i;
  if (returnOneDraw.test(text)) {
    const item = ctx.player.hand[0] ?? null;
    if (item) {
      ctx.player.hand = ctx.player.hand.filter(entry => entry.uid !== item.uid);
      ctx.player.deck.push(item);
      shuffle(ctx.player.deck, ctx.rng);
    }
    const drawn = drawCards(ctx.player, 1, ctx.stats, ctx.playerIndex);
    actions.push(`return selected hand card · draw ${drawn}`);
    text = text.replace(returnOneDraw, " ");
  }

  // Exact-copy / cross-zone primitives.
  const banishEnemySummonCopy = /Select an enemy follower(?: on the field)?(?: with (\d+) attack or less)?, banish it, and summon an exact copy of it\.?/i;
  const banishCopyMatch = text.match(banishEnemySummonCopy);
  if (banishCopyMatch) {
    const limit = banishCopyMatch[1] ? Number(banishCopyMatch[1]) : Infinity;
    const candidates = ctx.opponent.board.filter(unit => unit.type === "Follower" && (Number(unit.attack) || 0) <= limit);
    const target = choosePlannedTarget(ctx, candidates);
    if (target) {
      banish(ctx.opponent, target);
      const copy = highRiskSummonExactFromUnit(ctx, target, false);
      actions.push(`banish ${target.name} · summon exact copy${copy ? "" : " failed"}`);
    }
    text = text.replace(banishEnemySummonCopy, " ");
  }
  const banishEnemyAddCopy = /Select an enemy card on the field, banish it, and add a copy of it to your hand\.?/i;
  if (banishEnemyAddCopy.test(text)) {
    const target = [...ctx.opponent.board].sort((a,b) => (Number(b.card?.cost)||0) - (Number(a.card?.cost)||0))[0] ?? null;
    if (target) {
      banish(ctx.opponent, target);
      highRiskAddCopyToHand(ctx, target.card, { exact: false });
      actions.push(`banish ${target.name} · add copy`);
    }
    text = text.replace(banishEnemyAddCopy, " ");
  }
  const addFieldCopy = /Select an allied follower on the field with a base cost of at least\s*(\d+), add a copy of it to your hand, and reduce the cost of the copy by\s*(\d+)\.?/i;
  const addFieldMatch = text.match(addFieldCopy);
  if (addFieldMatch) {
    const minCost = Number(addFieldMatch[1]) || 0;
    const reduction = Number(addFieldMatch[2]) || 0;
    const source = ctx.player.board.filter(unit => unit.type === "Follower" && (Number(unit.card?.cost)||0) >= minCost)
      .sort((a,b) => (Number(b.card?.cost)||0) - (Number(a.card?.cost)||0))[0] ?? null;
    const copy = source ? highRiskAddCopyToHand(ctx, source, { exact: false, costDelta: -reduction }) : null;
    actions.push(`field copy to hand${copy ? ` (${copy.card.name})` : " unavailable"}`);
    text = text.replace(addFieldCopy, " ");
  }
  const opponentHandCopy = /Add an exact copy of a random card in your opponent'?s hand to your hand(?: without revealing it)? and reduce its cost by\s*(\d+)\.\s*Draw a card\.?/i;
  const opponentHandMatch = text.match(opponentHandCopy);
  if (opponentHandMatch) {
    const pool = ctx.opponent.hand ?? [];
    const source = pool.length ? pool[Math.floor(ctx.rng() * pool.length)] : null;
    if (source) highRiskAddCopyToHand(ctx, source, { exact: true, costDelta: -Number(opponentHandMatch[1] || 0) });
    const drawn = drawCards(ctx.player, 1, ctx.stats, ctx.playerIndex);
    actions.push(`copy opponent hand · draw ${drawn}`);
    text = text.replace(opponentHandCopy, " ");
  }
  const opponentDeckFive = /Add exact copies of 5 random cards from your opponent'?s deck to your hand without revealing them\.?/i;
  if (opponentDeckFive.test(text)) {
    const pool = [...(ctx.opponent.deck ?? [])];
    let added = 0;
    while (added < 5 && pool.length) {
      const source = pool.splice(Math.floor(ctx.rng() * pool.length), 1)[0];
      if (highRiskAddCopyToHand(ctx, source, { exact: true })) added += 1;
    }
    actions.push(`copy ${added} opponent-deck cards`);
    text = text.replace(opponentDeckFive, " ");
  }

  const summonHandCopies = text.match(/Select\s+(?:(a|an|one|two|three|four|five|\d+)\s+)?Artifact followers? in your hand that costs? 5 or less, summon an exact copy of (?:it|each)(?:,? and give (?:the copy|them) ["“]At the end of your opponent'?s turn, destroy this card\.["”])?\.?/i);
  if (summonHandCopies) {
    const count = highRiskWordNumber(summonHandCopies[1] ?? "one", 1);
    const delayed = /end of your opponent'?s turn, destroy this card/i.test(summonHandCopies[0]);
    const candidates = ctx.player.hand.filter(item => highRiskIsArtifact(item.card) && costOf(item) <= 5).slice(0, count);
    let summoned = 0;
    for (const item of candidates) if (highRiskSummonExactFromHand(ctx, item, delayed)) summoned += 1;
    actions.push(`summon ${summoned} exact Artifact hand cop${summoned === 1 ? "y" : "ies"}`);
    text = text.replace(summonHandCopies[0], " ");
  }

  const summonThisCopies = text.match(/Summon\s+(?:(a|an|one|two|three|four|five|\d+)\s+)?exact copies? of (?:this card|it)\.?/i);
  if (summonThisCopies && ctx.sourceUnit) {
    const count = highRiskWordNumber(summonThisCopies[1] ?? "one", 1);
    let summoned = 0;
    for (let i = 0; i < count; i += 1) if (highRiskSummonExactFromUnit(ctx, ctx.sourceUnit, false)) summoned += 1;
    actions.push(`summon ${summoned} exact self cop${summoned === 1 ? "y" : "ies"}`);
    text = text.replace(summonThisCopies[0], " ");
  }

  // Destroyed-follower history copies.
  const destroyedTwo = /Add copies of 2 random differently named allied followers destroyed this match to your hand\.?/i;
  if (destroyedTwo.test(text)) {
    const cards = highRiskHistoryCards(ctx.player.destroyedFollowers, 2, null, ctx.rng, true);
    for (const card of cards) highRiskAddCopyToHand(ctx, card);
    actions.push(`destroyed follower copies ${cards.length}`);
    text = text.replace(destroyedTwo, " ");
  }
  const destroyedArtifact = /Add a copy of a random allied Artifact follower destroyed this match to your hand\.?/i;
  if (destroyedArtifact.test(text)) {
    const cards = highRiskHistoryCards(ctx.player.destroyedFollowers, 1, highRiskIsArtifact, ctx.rng, true);
    for (const card of cards) highRiskAddCopyToHand(ctx, card);
    actions.push(`destroyed Artifact copy ${cards.length}`);
    text = text.replace(destroyedArtifact, " ");
  }
  const destroyedOne = /Add a copy of a random allied follower destroyed this match to your hand\.?/i;
  if (destroyedOne.test(text)) {
    const cards = highRiskHistoryCards(ctx.player.destroyedFollowers, 1, null, ctx.rng, true);
    for (const card of cards) highRiskAddCopyToHand(ctx, card);
    actions.push(`destroyed follower copy ${cards.length}`);
    text = text.replace(destroyedOne, " ");
  }

  // Destroyed-amulet history summons.
  const destroyedAmuletsTwo = /Summon copies of 2 random differently named allied amulets with Last Words abilities and base costs of 2 or less destroyed this match\.?/i;
  if (destroyedAmuletsTwo.test(text)) {
    const cards = highRiskHistoryCards(ctx.player.destroyedAmulets, 2, card => card.type === "Amulet" && /Last Words\s*:/i.test(String(card.text ?? "")) && (Number(card.cost)||0) <= 2, ctx.rng, true);
    let count = 0; for (const card of cards) if (highRiskSummonAmulet(ctx, card)) count += 1;
    actions.push(`summon ${count} destroyed amulet copies`);
    text = text.replace(destroyedAmuletsTwo, " ");
  }
  const destroyedAmuletRandom = /Summon a copy of a random allied amulet with a Last Words ability and a base cost of 2 or less destroyed this match\.?/i;
  if (destroyedAmuletRandom.test(text)) {
    const cards = highRiskHistoryCards(ctx.player.destroyedAmulets, 1, card => card.type === "Amulet" && /Last Words\s*:/i.test(String(card.text ?? "")) && (Number(card.cost)||0) <= 2, ctx.rng, true);
    const count = cards[0] && highRiskSummonAmulet(ctx, cards[0]) ? 1 : 0;
    actions.push(`summon ${count} destroyed amulet copy`);
    text = text.replace(destroyedAmuletRandom, " ");
  }
  const destroyedAmuletHighest = /Summon a copy of a random allied amulet destroyed this match with the highest base cost\.?/i;
  if (destroyedAmuletHighest.test(text)) {
    const pool = (ctx.player.destroyedAmulets ?? []).map(entry => entry.card).filter(Boolean);
    const highest = Math.max(-Infinity, ...pool.map(card => Number(card.cost)||0));
    const candidates = pool.filter(card => (Number(card.cost)||0) === highest);
    const card = candidates.length ? candidates[Math.floor(ctx.rng() * candidates.length)] : null;
    const count = card && highRiskSummonAmulet(ctx, card) ? 1 : 0;
    actions.push(`summon ${count} highest-cost destroyed amulet copy`);
    text = text.replace(destroyedAmuletHighest, " ");
  }

  // Artifact match-history conditions.
  const artifactHistory = new Set((ctx.player.artifactFollowerNamesEntered ?? []).map(norm)).size;
  const artifactEp = /If at least 3 differently named allied Artifact followers have entered the field this match, recover 1 evolution point\.?/i;
  if (artifactEp.test(text)) {
    if (artifactHistory >= 3) ctx.player.ep = Math.min(2, (Number(ctx.player.ep)||0) + 1);
    actions.push(`Artifact history ${artifactHistory}${artifactHistory >= 3 ? " · recover EP" : ""}`);
    text = text.replace(artifactEp, " ");
  }
  const artifactDamage = /Deal X damage to all enemy followers\.\s*X is the number of differently named allied Artifact followers that have entered the field this match\.\s*Deal 1 damage to the enemy leader\.?/i;
  if (artifactDamage.test(text)) {
    for (const unit of ctx.opponent.board.filter(unit => unit.type === "Follower")) damageUnit(unit, artifactHistory, ctx.opponent, ctx.player, ctx, actions);
    const dealt = damageLeader(ctx.opponent, 1); ctx.stats.damageDealt[ctx.playerIndex] += dealt;
    actions.push(`Artifact history ${artifactHistory}: board ${artifactHistory} · leader ${dealt}`);
    text = text.replace(artifactDamage, " ");
  }
  const artifactSummons = /If at least 3 differently named allied Artifact followers have entered the field this match, summon an Ancient Artifact and a Mystic Artifact\.?/i;
  if (artifactSummons.test(text)) {
    if (artifactHistory >= 3) {
      for (const tokenName of ["Ancient Artifact", "Mystic Artifact"]) {
        const token = findByName(ctx.cardMap, tokenName);
        if (token) summonWithEvents(ctx.player, token, 1, ctx.playerIndex, ctx);
      }
    }
    actions.push(`Artifact history ${artifactHistory}: conditional Artifact summons`);
    text = text.replace(artifactSummons, " ");
  }

  // Persistent damage and temporary opponent-hand cost modifiers.
  const takesMore = text.match(/Give the enemy leader ["“]Takes\s+(\d+)\s+more damage\.?["”]/i);
  if (takesMore) {
    ctx.opponent.leaderDamageTakenBonus = (Number(ctx.opponent.leaderDamageTakenBonus)||0) + Number(takesMore[1]||0);
    actions.push(`enemy leader takes +${takesMore[1]} damage per instance`);
    text = text.replace(takesMore[0], " ");
  }
  const opponentCost = text.match(/Increase the cost of all cards in your opponent'?s hand by\s*(\d+)\s*until the end of their turn\.?/i);
  if (opponentCost) {
    const amount = Number(opponentCost[1]) || 0;
    for (const item of ctx.opponent.hand ?? []) {
      item.costDelta = (Number(item.costDelta)||0) + amount;
      item.highRiskOpponentTempCost = (Number(item.highRiskOpponentTempCost)||0) + amount;
    }
    actions.push(`opponent hand cost +${amount} this turn`);
    text = text.replace(opponentCost[0], " ");
  }

  // Generic selected-target lockdown used by Friendly Blue Ogre.
  const lock = /Select an enemy follower on the field and give it ["“]Can'?t attack followers or leaders["”] until the end of your opponent'?s turn\.?/i;
  if (lock.test(text)) {
    const target = choosePlannedTarget(ctx, ctx.opponent.board.filter(unit => unit.type === "Follower"));
    if (target) { target.yuriusAttackLocked = true; target.canAttackLeader = false; target.canAttackFollower = false; actions.push(`lock ${target.name} until owner turn end`); }
    text = text.replace(lock, " ");
  }

  // Common board-wide "all enemies" wording means followers plus leader.
  for (const match of [...text.matchAll(/Deal\s+(\d+)\s+damage to all enemies\.?/gi)]) {
    const amount = Number(match[1]) || 0;
    for (const unit of ctx.opponent.board.filter(unit => unit.type === "Follower")) damageUnit(unit, amount, ctx.opponent, ctx.player, ctx, actions);
    const dealt = damageLeader(ctx.opponent, amount); ctx.stats.damageDealt[ctx.playerIndex] += dealt;
    actions.push(`${amount} damage to all enemies`);
    text = text.replace(match[0], " ");
  }

  // Silence + fixed damage to two selected followers (Beelzebub grammar).
  const silenceTwo = text.match(/Select 2 enemy followers on the field, remove all abilities from them, and deal them\s*(\d+)\s+damage\.?/i);
  if (silenceTwo) {
    const targets = [...ctx.opponent.board].filter(unit => unit.type === "Follower").sort((a,b) => followerThreatValue(b)-followerThreatValue(a)).slice(0,2);
    for (const target of targets) { silenceFollower(target); damageUnit(target, Number(silenceTwo[1])||0, ctx.opponent, ctx.player, ctx, actions); }
    actions.push(`silence/damage ${targets.length} enemy followers`);
    text = text.replace(silenceTwo[0], " ");
  }

  // Trait-restricted keyword grant used by Spirited Skipper.
  const pixieBane = /Give all allied Pixie followers on the field Bane\.?/i;
  if (pixieBane.test(text)) {
    for (const unit of ctx.player.board.filter(unit => unit.type === "Follower" && (unit.card?.traits ?? []).some(trait => norm(trait) === "pixie"))) giveKeyword(unit, "Bane");
    actions.push("all allied Pixies gain Bane");
    text = text.replace(pixieBane, " ");
  }

  // Base-cost hand comparison used by Behemoth General.
  const topThree = /If the sum of the 3 highest base costs of cards in your hand is greater than that of your opponent'?s, destroy all enemy followers\.?/i;
  if (topThree.test(text)) {
    const sum = hand => [...hand].map(item => Number(item.card?.cost)||0).sort((a,b)=>b-a).slice(0,3).reduce((a,b)=>a+b,0);
    const own = sum(ctx.player.hand), enemy = sum(ctx.opponent.hand);
    if (own > enemy) for (const unit of ctx.opponent.board.filter(unit => unit.type === "Follower")) destroyUnit(ctx.opponent, unit);
    actions.push(`top-3 hand cost ${own} vs ${enemy}`);
    text = text.replace(topThree, " ");
  }

  // Goddess of Starlight: after the discard primitive, copy the 3 leftmost survivors.
  const leftmostCopies = /Add exact copies of the 3 leftmost cards in your hand to your hand\.?/i;
  if (leftmostCopies.test(text)) {
    const sources = ctx.player.hand.slice(0,3);
    let added = 0; for (const source of sources) if (highRiskAddCopyToHand(ctx, source, { exact:true })) added += 1;
    actions.push(`copy ${added} leftmost hand cards`);
    text = text.replace(leftmostCopies, " ");
  }

  // Selected allied-card destruction, with amulets preferred when a follow-up
  // explicitly rewards destroying an allied amulet.
  const destroyAnother = /Select another allied card on the field and destroy it\.?/i;
  if (destroyAnother.test(text)) {
    const pool = ctx.player.board.filter(unit => unit.uid !== ctx.sourceUnit?.uid);
    const wantsAmulet = /if (?:the card|it) is an allied amulet/i.test(text);
    const target = (wantsAmulet ? pool.find(unit => unit.type === "Amulet") : null) ?? pool[0] ?? null;
    if (target) actions.push(...destroyObject(ctx.player, ctx.opponent, target, ctx.playerIndex, ctx.enemyIndex, ctx.stats, ctx.rng, ctx.cardMap, true));
    ctx.__highRiskDestroyedSelectedAmulet = target?.type === "Amulet";
    actions.push(`destroy selected allied card${target ? ` ${target.name}` : " unavailable"}`);
    text = text.replace(destroyAnother, " ");
  }
  const destroyedAmuletPp = /If (?:the card|it) is an allied amulet, recover\s*(\d+)\s+play points\.?/i;
  const destroyedAmuletPpMatch = text.match(destroyedAmuletPp);
  if (destroyedAmuletPpMatch) {
    if (ctx.__highRiskDestroyedSelectedAmulet) ctx.player.pp = Math.min(ctx.player.maxPp, ctx.player.pp + Number(destroyedAmuletPpMatch[1]||0));
    actions.push(`destroyed-amulet PP condition ${ctx.__highRiskDestroyedSelectedAmulet ? "active" : "inactive"}`);
    text = text.replace(destroyedAmuletPp, " ");
  }


  // [[battle-high-risk-generic-grammar]]
  // Frequently recurring target grammar that V3 classified as Full but the
  // generic executor did not actually consume.
  for (const match of [...text.matchAll(/Select an enemy follower(?: on the field)? and deal it\s*(\d+)\s*damage\.?/gi)]) {
    const target = choosePlannedTarget(ctx, ctx.opponent.board.filter(unit => unit.type === "Follower"));
    if (target) damageUnit(target, Number(match[1]) || 0, ctx.opponent, ctx.player, ctx, actions);
    actions.push(`selected enemy follower: ${match[1]} damage`);
    text = text.replace(match[0], " ");
  }
  for (const match of [...text.matchAll(/Deal\s*(\d+)\s*damage to a random enemy follower\.?/gi)]) {
    const pool = ctx.opponent.board.filter(unit => unit.type === "Follower");
    const target = pool.length ? pool[Math.floor(ctx.rng() * pool.length)] : null;
    if (target) damageUnit(target, Number(match[1]) || 0, ctx.opponent, ctx.player, ctx, actions);
    actions.push(`random enemy follower: ${match[1]} damage`);
    text = text.replace(match[0], " ");
  }
  for (const match of [...text.matchAll(/Deal\s*(\d+)\s*damage to all enemy followers\.?/gi)]) {
    const amount = Number(match[1]) || 0;
    for (const unit of ctx.opponent.board.filter(unit => unit.type === "Follower")) damageUnit(unit, amount, ctx.opponent, ctx.player, ctx, actions);
    actions.push(`${amount} damage to all enemy followers`);
    text = text.replace(match[0], " ");
  }
  const bothLeaders = text.match(/Deal\s*(\d+)\s*damage to all enemy followers and both leaders\.?/i);
  if (bothLeaders) {
    const amount = Number(bothLeaders[1]) || 0;
    for (const unit of ctx.opponent.board.filter(unit => unit.type === "Follower")) damageUnit(unit, amount, ctx.opponent, ctx.player, ctx, actions);
    const enemy = damageLeader(ctx.opponent, amount); ctx.stats.damageDealt[ctx.playerIndex] += enemy;
    damageLeader(ctx.player, amount);
    actions.push(`${amount} damage to enemy followers and both leaders`);
    text = text.replace(bothLeaders[0], " ");
  }

  const selectedDestroy = /Select an enemy follower(?: on the field)? and destroy it\.?/i;
  if (selectedDestroy.test(text)) {
    const target = choosePlannedTarget(ctx, ctx.opponent.board.filter(unit => unit.type === "Follower"));
    if (target) actions.push(...destroyObject(ctx.opponent, ctx.player, target, ctx.enemyIndex, ctx.playerIndex, ctx.stats, ctx.rng, ctx.cardMap, true));
    actions.push(`destroy selected enemy follower${target ? ` ${target.name}` : " unavailable"}`);
    text = text.replace(selectedDestroy, " ");
  }
  const selectedDebuff = text.match(/Select an enemy follower(?: on the field)? and give it\s*(-?\d+)\s*\/\s*(-?\d+)\.?/i);
  if (selectedDebuff) {
    const target = choosePlannedTarget(ctx, ctx.opponent.board.filter(unit => unit.type === "Follower"));
    const attack = Number(selectedDebuff[1]) || 0, defense = Number(selectedDebuff[2]) || 0;
    if (target) { target.attack += attack; target.defense += defense; target.maxDefense += defense; }
    actions.push(`selected enemy follower ${attack}/${defense}`);
    text = text.replace(selectedDebuff[0], " ");
  }
  const allEnemyDebuff = text.match(/Give all enemy followers on the field\s*(-?\d+)\s*\/\s*(-?\d+)\.?/i);
  if (allEnemyDebuff) {
    const attack = Number(allEnemyDebuff[1]) || 0, defense = Number(allEnemyDebuff[2]) || 0;
    for (const target of ctx.opponent.board.filter(unit => unit.type === "Follower")) { target.attack += attack; target.defense += defense; target.maxDefense += defense; }
    actions.push(`all enemy followers ${attack}/${defense}`);
    text = text.replace(allEnemyDebuff[0], " ");
  }

  const randomAllyBuff = text.match(/Give a random allied follower on the field\s*\+(\d+)\s*\/\s*\+(\d+)\.?/i);
  if (randomAllyBuff) {
    const pool = ctx.player.board.filter(unit => unit.type === "Follower");
    const target = pool.length ? pool[Math.floor(ctx.rng() * pool.length)] : null;
    if (target) buff(target, Number(randomAllyBuff[1]) || 0, Number(randomAllyBuff[2]) || 0);
    actions.push(`random allied follower +${randomAllyBuff[1]}/+${randomAllyBuff[2]}`);
    text = text.replace(randomAllyBuff[0], " ");
  }
  const allOtherBuff = text.match(/Give all other allied followers on the field\s*\+(\d+)\s*\/\s*\+(\d+)\.?/i);
  if (allOtherBuff) {
    for (const unit of ctx.player.board.filter(unit => unit.type === "Follower" && unit.uid !== ctx.sourceUnit?.uid)) buff(unit, Number(allOtherBuff[1]) || 0, Number(allOtherBuff[2]) || 0);
    actions.push(`all other allied followers +${allOtherBuff[1]}/+${allOtherBuff[2]}`);
    text = text.replace(allOtherBuff[0], " ");
  }
  const namedCopiesBuff = text.match(/Give all allied copies of ([^.]+?) on the field\s*\+(\d+)\s*\/\s*\+(\d+)\.?/i);
  if (namedCopiesBuff) {
    const targetName = norm(namedCopiesBuff[1]);
    for (const unit of ctx.player.board.filter(unit => unit.type === "Follower" && norm(unit.name) === targetName)) buff(unit, Number(namedCopiesBuff[2]) || 0, Number(namedCopiesBuff[3]) || 0);
    actions.push(`${namedCopiesBuff[1]} copies +${namedCopiesBuff[2]}/+${namedCopiesBuff[3]}`);
    text = text.replace(namedCopiesBuff[0], " ");
  }
  const comboBuff = /Give this follower \+X\/\+X\.\s*X is your Combo\.?/i;
  if (comboBuff.test(text)) {
    if (ctx.sourceUnit && canUseClassMechanic(ctx.player, "combo", ctx.card)) {
      const x = Math.max(0, Number(ctx.player.cardsPlayedThisTurn) || 0);
      buff(ctx.sourceUnit, x, x);
      actions.push(`this follower +${x}/+${x} from Combo`);
    }
    text = text.replace(comboBuff, " ");
  }

  // Token copies use exact named cards from the database/related-card map.
  for (const match of [...text.matchAll(/Summon\s*(a|an|one|two|three|four|five|\d+)\s+copies? of ([^.;]+)\.?/gi)]) {
    const count = highRiskWordNumber(match[1], 1);
    const tokenName = String(match[2]).trim();
    const token = findByName(ctx.cardMap, tokenName) ?? related(ctx.card, ctx.cardMap).find(card => norm(card.name) === norm(tokenName));
    const summoned = token ? summonWithEvents(ctx.player, token, count, ctx.playerIndex, ctx) : 0;
    actions.push(`summon ${summoned}/${count} ${tokenName}`);
    text = text.replace(match[0], " ");
  }
  for (const match of [...text.matchAll(/Add\s*(a|an|one|two|three|four|five|\d+)\s+copies? of ([^.;]+?) to your hand\.?/gi)]) {
    const count = highRiskWordNumber(match[1], 1);
    const tokenName = String(match[2]).trim();
    const token = findByName(ctx.cardMap, tokenName) ?? related(ctx.card, ctx.cardMap).find(card => norm(card.name) === norm(tokenName));
    const added = token ? addHand(ctx.player, token, count, ctx.playerIndex, ctx.stats) : 0;
    if (added) ctx.stats.cardsGenerated[ctx.playerIndex] += added;
    actions.push(`add ${added}/${count} ${tokenName}`);
    text = text.replace(match[0], " ");
  }
  const conditionalBat = /If your leader'?s defense is higher than the enemy leader'?s defense, summon\s*(\d+)\s+copies of Bat\.?/i;
  const conditionalBatMatch = text.match(conditionalBat);
  if (conditionalBatMatch) {
    let summoned = 0;
    if (ctx.player.hp > ctx.opponent.hp) {
      const bat = findByName(ctx.cardMap, "Bat") ?? related(ctx.card, ctx.cardMap).find(card => norm(card.name) === "bat");
      if (bat) summoned = summonWithEvents(ctx.player, bat, Number(conditionalBatMatch[1]) || 0, ctx.playerIndex, ctx);
    }
    actions.push(`conditional Bat summons ${summoned}`);
    text = text.replace(conditionalBat, " ");
  }

  // Reanimate without a trailing clause is itself an executable effect.
  const reanimateOnly = text.match(/Reanimate\s*\(?\s*(\d+)\s*\)?\.?/i);
  if (reanimateOnly) {
    const unit = reanimate(ctx.player, Number(reanimateOnly[1]) || 0, ctx.playerIndex, ctx.cardMap, ctx.rng);
    if (unit) { ctx.player.board.push(unit); ctx.player.rally += 1; actions.push(`Reanimate ${reanimateOnly[1]}: ${unit.name}`, ...applyEntryEvents(ctx, unit)); }
    else actions.push(`Reanimate ${reanimateOnly[1]}: unavailable`);
    text = text.replace(reanimateOnly[0], " ");
  }

  // Miscellaneous recurring clauses.
  const destroyDamaged = /Destroy all damaged enemy followers\.?/i;
  if (destroyDamaged.test(text)) {
    const targets = ctx.opponent.board.filter(unit => unit.type === "Follower" && (Number(unit.defense)||0) < (Number(unit.maxDefense)||0));
    for (const unit of targets) destroyUnit(ctx.opponent, unit);
    actions.push(`destroy ${targets.length} damaged enemy followers`);
    text = text.replace(destroyDamaged, " ");
  }
  const splitDamage = text.match(/Deal\s*(\d+)\s+damage split between all enemy followers\.?/i);
  if (splitDamage) {
    let remaining = Number(splitDamage[1]) || 0;
    const pool = ctx.opponent.board.filter(unit => unit.type === "Follower");
    while (remaining > 0 && pool.length) {
      const target = pool[Math.floor(ctx.rng() * pool.length)];
      damageUnit(target, 1, ctx.opponent, ctx.player, ctx, actions);
      remaining -= 1;
    }
    actions.push(`${splitDamage[1]} split damage`);
    text = text.replace(splitDamage[0], " ");
  }
  const comboOne = /Increase your Combo by 1\.?/i;
  if (comboOne.test(text)) {
    if (canUseClassMechanic(ctx.player, "combo", ctx.card)) {
      ctx.player.cardsPlayedThisTurn += 1;
      actions.push(`Combo +1 (${ctx.player.cardsPlayedThisTurn})`);
    }
    text = text.replace(comboOne, " ");
  }
  const spellboostHandClause = /Spellboost your hand\.?/i;
  if (spellboostHandClause.test(text)) {
    spellboostHand(ctx.player, 1, ctx.cardMap, actions);
    text = text.replace(spellboostHandClause, " ");
  }

  // Self-destruction is common on Engage abilities.
  const destroyThis = /Destroy this card\.?/i;
  if (destroyThis.test(text) && ctx.sourceUnit) {
    actions.push(...destroyObject(ctx.player, ctx.opponent, ctx.sourceUnit, ctx.playerIndex, ctx.enemyIndex, ctx.stats, ctx.rng, ctx.cardMap, true));
    text = text.replace(destroyThis, " ");
  }

  // Trait-wide board buff used by Ralmia and reusable by future Artifact cards.
  const artifactBoardBuff = text.match(/Give all allied Artifact followers on the field\s*\+(\d+)\s*\/\s*\+(\d+)\.?/i);
  if (artifactBoardBuff) {
    for (const unit of ctx.player.board.filter(unit => unit.type === "Follower" && (unit.card?.traits ?? []).some(trait => norm(trait) === "artifact"))) {
      buff(unit, Number(artifactBoardBuff[1]) || 0, Number(artifactBoardBuff[2]) || 0);
    }
    actions.push(`all allied Artifacts +${artifactBoardBuff[1]}/+${artifactBoardBuff[2]}`);
    text = text.replace(artifactBoardBuff[0], " ");
  }

  // Keywords can appear inline in card text rather than the keyword array.
  for (const keyword of ["Ward", "Barrier", "Rush", "Storm", "Bane", "Drain", "Intimidate", "Aura", "Ambush"]) {
    const regex = new RegExp(`(?:^|\\s)${keyword}(?=\\s|$|[.])`, "i");
    if (!regex.test(text)) continue;
    if (ctx.sourceUnit?.type === "Follower") giveKeyword(ctx.sourceUnit, keyword);
    actions.push(`${ctx.sourceUnit?.name ?? "source"} gains ${keyword}`);
    text = text.replace(regex, " ");
  }

  const twoAttacks = /Give this follower ["“]Can attack 2 times per turn\.?["”]/i;
  if (twoAttacks.test(text) && ctx.sourceUnit) {
    ctx.sourceUnit.baseMaxAttacks = Math.max(2, Number(ctx.sourceUnit.baseMaxAttacks) || 1);
    ctx.sourceUnit.maxAttacks = Math.max(2, Number(ctx.sourceUnit.maxAttacks) || 1);
    actions.push(`${ctx.sourceUnit.name} can attack twice`);
    text = text.replace(twoAttacks, " ");
  }

  // Grammar variants for cross-zone/history primitives.
  const wolfCopies = /Add an exact copy each of 5 random cards in your opponent'?s deck to your hand without revealing them\.?/i;
  if (wolfCopies.test(text)) {
    const pool = [...(ctx.opponent.deck ?? [])]; let added = 0;
    while (added < 5 && pool.length) {
      const source = pool.splice(Math.floor(ctx.rng() * pool.length), 1)[0];
      if (highRiskAddCopyToHand(ctx, source, { exact: true })) added += 1;
    }
    actions.push(`copy ${added} opponent-deck cards`);
    text = text.replace(wolfCopies, " ");
  }
  const fieldCopyVariant = text.match(/Select an allied follower on the field with a base cost of\s*(\d+)\s+or more, add a copy of it to your hand without revealing it, and reduce the cost of the copy by\s*(\d+)\.?/i);
  if (fieldCopyVariant) {
    const source = ctx.player.board.filter(unit => unit.type === "Follower" && (Number(unit.card?.cost)||0) >= Number(fieldCopyVariant[1]))
      .sort((a,b) => (Number(b.card?.cost)||0) - (Number(a.card?.cost)||0))[0] ?? null;
    if (source) highRiskAddCopyToHand(ctx, source, { costDelta: -Number(fieldCopyVariant[2]) });
    actions.push(`field follower copy ${source?.name ?? "unavailable"}`);
    text = text.replace(fieldCopyVariant[0], " ");
  }
  const destroyedTwoVariant = /Add a copy each of 2 random differently named allied followers destroyed this match to your hand without revealing them\.?/i;
  if (destroyedTwoVariant.test(text)) {
    const cards = highRiskHistoryCards(ctx.player.destroyedFollowers, 2, null, ctx.rng, true);
    for (const card of cards) highRiskAddCopyToHand(ctx, card);
    actions.push(`destroyed follower copies ${cards.length}`);
    text = text.replace(destroyedTwoVariant, " ");
  }
  const destroyedArtifactVariant = /Add a copy of a random allied Artifact follower destroyed this match to your hand without revealing it\.?/i;
  if (destroyedArtifactVariant.test(text)) {
    const cards = highRiskHistoryCards(ctx.player.destroyedFollowers, 1, highRiskIsArtifact, ctx.rng, true);
    for (const card of cards) highRiskAddCopyToHand(ctx, card);
    actions.push(`destroyed Artifact copy ${cards.length}`);
    text = text.replace(destroyedArtifactVariant, " ");
  }
  const destroyedOneVariant = /Add a copy of a random allied follower destroyed this match to your hand without revealing it\.?/i;
  if (destroyedOneVariant.test(text)) {
    const cards = highRiskHistoryCards(ctx.player.destroyedFollowers, 1, null, ctx.rng, true);
    for (const card of cards) highRiskAddCopyToHand(ctx, card);
    actions.push(`destroyed follower copy ${cards.length}`);
    text = text.replace(destroyedOneVariant, " ");
  }
  const kandimaHistory = /Summon a copy each of 2 random differently named allied amulets destroyed this match with Last Words and a base cost of 2 or less\.?/i;
  if (kandimaHistory.test(text)) {
    const cards = highRiskHistoryCards(ctx.player.destroyedAmulets, 2, card => card.type === "Amulet" && /Last Words\s*:/i.test(String(card.text ?? "")) && (Number(card.cost)||0) <= 2, ctx.rng, true);
    let count = 0; for (const card of cards) if (highRiskSummonAmulet(ctx, card)) count += 1;
    actions.push(`summon ${count} Kandima amulet copies`);
    text = text.replace(kandimaHistory, " ");
  }
  const amuletHistoryVariant = /Summon a copy of a random allied amulet destroyed this match with Last Words and a base cost of 2 or less\.?/i;
  if (amuletHistoryVariant.test(text)) {
    const cards = highRiskHistoryCards(ctx.player.destroyedAmulets, 1, card => card.type === "Amulet" && /Last Words\s*:/i.test(String(card.text ?? "")) && (Number(card.cost)||0) <= 2, ctx.rng, true);
    if (cards[0]) highRiskSummonAmulet(ctx, cards[0]);
    actions.push(`summon destroyed amulet copy ${cards.length}`);
    text = text.replace(amuletHistoryVariant, " ");
  }

  // Flexible Artifact hand-copy grammar (one/two/three, with or without comma).
  const artifactHandCopy = text.match(/Select\s+(?:(a|an|one|two|three|four|five|\d+)\s+)?Artifact followers? in your hand that costs? 5 or less(?:,| and)?\s*summon an exact copy of (?:it|each)(?:,?\s*and give (?:the exact copies|the copies|them) ["“]At the end of your opponent'?s turn, destroy this card\.["”])?\.?/i);
  if (artifactHandCopy) {
    const count = highRiskWordNumber(artifactHandCopy[1] ?? "one", 1);
    const delayed = /end of your opponent'?s turn, destroy this card/i.test(artifactHandCopy[0]);
    const candidates = ctx.player.hand.filter(item => highRiskIsArtifact(item.card) && costOf(item) <= 5).slice(0, count);
    let summoned = 0; for (const item of candidates) if (highRiskSummonExactFromHand(ctx, item, delayed)) summoned += 1;
    actions.push(`summon ${summoned} exact Artifact hand copies`);
    text = text.replace(artifactHandCopy[0], " ");
  }

  const selfCopyVariant = text.match(/Summon\s+(?:(a|an|one|two|three|four|five|\d+)\s+)?(?:an?\s+)?exact copies? of (?:this card|it)\.?/i);
  if (selfCopyVariant && ctx.sourceUnit) {
    const count = highRiskWordNumber(selfCopyVariant[1] ?? "one", 1); let summoned = 0;
    for (let i=0;i<count;i+=1) if (highRiskSummonExactFromUnit(ctx, ctx.sourceUnit, false)) summoned += 1;
    actions.push(`summon ${summoned} exact self copies`);
    text = text.replace(selfCopyVariant[0], " ");
  }
  const conditionalSelfCopies = text.match(/If this card'?s cost isn'?t 3,\s*Summon\s*(\d+)\s+exact copies of it\.?/i);
  if (conditionalSelfCopies && ctx.sourceUnit) {
    let summoned = 0;
    if (costOf(ctx.instance) !== 3) for (let i=0;i<Number(conditionalSelfCopies[1]);i+=1) if (highRiskSummonExactFromUnit(ctx, ctx.sourceUnit, false)) summoned += 1;
    actions.push(`conditional exact self copies ${summoned}`);
    text = text.replace(conditionalSelfCopies[0], " ");
  }

  // Kandima's Super-Evolve grammar can select either side; prefer an allied
  // amulet because that is the tactically meaningful branch.
  const kandimaDestroy = /Select another card on the field and destroy it\.\s*If you selected an allied amulet, deal\s*(\d+)\s+damage to all enemy followers\.?/i;
  const kandimaDestroyMatch = text.match(kandimaDestroy);
  if (kandimaDestroyMatch) {
    const target = ctx.player.board.find(unit => unit.uid !== ctx.sourceUnit?.uid && unit.type === "Amulet")
      ?? ctx.opponent.board[0] ?? ctx.player.board.find(unit => unit.uid !== ctx.sourceUnit?.uid) ?? null;
    const alliedAmulet = target && ctx.player.board.includes(target) && target.type === "Amulet";
    if (target) {
      const owner = ctx.player.board.includes(target) ? ctx.player : ctx.opponent;
      const other = owner === ctx.player ? ctx.opponent : ctx.player;
      const oi = owner === ctx.player ? ctx.playerIndex : ctx.enemyIndex;
      const ei = owner === ctx.player ? ctx.enemyIndex : ctx.playerIndex;
      actions.push(...destroyObject(owner, other, target, oi, ei, ctx.stats, ctx.rng, ctx.cardMap, true));
    }
    if (alliedAmulet) for (const unit of ctx.opponent.board.filter(unit => unit.type === "Follower")) damageUnit(unit, Number(kandimaDestroyMatch[1])||0, ctx.opponent, ctx.player, ctx, actions);
    actions.push(`Kandima selected destruction${alliedAmulet ? " · amulet payoff" : ""}`);
    text = text.replace(kandimaDestroy, " ");
  }

  const supplicantDestroy = /Select another allied card on the field\.\s*If you selected one, destroy it and deal\s*(\d+)\s+damage to a random enemy follower\.?/i;
  const supplicantDestroyMatch = text.match(supplicantDestroy);
  if (supplicantDestroyMatch) {
    const target = ctx.player.board.find(unit => unit.uid !== ctx.sourceUnit?.uid) ?? null;
    if (target) actions.push(...destroyObject(ctx.player, ctx.opponent, target, ctx.playerIndex, ctx.enemyIndex, ctx.stats, ctx.rng, ctx.cardMap, true));
    const pool = ctx.opponent.board.filter(unit => unit.type === "Follower");
    const enemy = pool.length ? pool[Math.floor(ctx.rng()*pool.length)] : null;
    if (target && enemy) damageUnit(enemy, Number(supplicantDestroyMatch[1])||0, ctx.opponent, ctx.player, ctx, actions);
    actions.push(`Supplicant selected destruction${target ? "" : " unavailable"}`);
    text = text.replace(supplicantDestroy, " ");
  }

  // Combined selected damage + Artifact-history EP grammar.
  const journey = text.match(/Select an enemy follower on the field and deal it\s*(\d+)\s*damage\.\s*If at least 3 differently named allied Artifact followers have entered the field this match, recover 1 evolution point\.?/i);
  if (journey) {
    const target = choosePlannedTarget(ctx, ctx.opponent.board.filter(unit => unit.type === "Follower"));
    if (target) damageUnit(target, Number(journey[1])||0, ctx.opponent, ctx.player, ctx, actions);
    const history = new Set((ctx.player.artifactFollowerNamesEntered ?? []).map(norm)).size;
    if (history >= 3) ctx.player.ep = Math.min(2, (Number(ctx.player.ep)||0)+1);
    actions.push(`Journey: damage ${journey[1]} · Artifact history ${history}`);
    text = text.replace(journey[0], " ");
  }

  const behemothVariant = /If the sum of the 3 highest base costs in your hand is higher than that of your opponent'?s, destroy all enemy followers\.?/i;
  if (behemothVariant.test(text)) {
    const sum = hand => [...hand].map(item => Number(item.card?.cost)||0).sort((a,b)=>b-a).slice(0,3).reduce((a,b)=>a+b,0);
    const own = sum(ctx.player.hand), enemy = sum(ctx.opponent.hand);
    if (own > enemy) for (const unit of ctx.opponent.board.filter(unit => unit.type === "Follower")) destroyUnit(ctx.opponent, unit);
    actions.push(`top-3 hand cost ${own} vs ${enemy}`);
    text = text.replace(behemothVariant, " ");
  }
  const goddessVariant = /Add an exact copy each of the 3 leftmost cards in your hand to your hand without revealing them\.?/i;
  if (goddessVariant.test(text)) {
    const sources = ctx.player.hand.slice(0,3); let added=0;
    for (const source of sources) if (highRiskAddCopyToHand(ctx, source, {exact:true})) added += 1;
    actions.push(`copy ${added} leftmost hand cards`);
    text = text.replace(goddessVariant, " ");
  }

  // A consumed sentence can leave only punctuation (for example the pre-existing
  // Earth Sigil pass did not consume the final period). Punctuation-only residue
  // is not an unresolved Battle Sim rule.
  const remainingText = text.replace(/\s+/g, " ").trim().replace(/^[.,;:\s]+|[.,;:\s]+$/g, "").trim();
  return { text: remainingText, actions: uniq(actions) };
}

function resolveText(raw, ctx) {
  // [[battle-high-risk-final-three-preprocess]]
  // These effects contain syntax that is itself consumed by earlier generic
  // preprocessors (Necromancy/Skybound). Resolve the complete compound first.
  const highRiskRaw = String(raw ?? "");
  const highRiskName = norm(ctx.card?.name);

  if (highRiskName === "fediel, darkness personified" && /Necromancy/i.test(highRiskRaw) && /evolve them/i.test(highRiskRaw)) {
    const actions = [];
    if (!canUseClassMechanic(ctx.player, "necromancy", ctx.card)) return { applied: false, actions: ["Necromancy unavailable outside Abysscraft"], unresolved: false };
    const summoned = [];
    if ((Number(ctx.player.shadows) || 0) >= 6) {
      ctx.player.shadows -= 6;
      for (const cost of [2, 1]) {
        const unit = reanimate(ctx.player, cost, ctx.playerIndex, ctx.cardMap, ctx.rng);
        if (!unit || ctx.player.board.length >= 5) continue;
        ctx.player.board.push(unit);
        ctx.player.rally += 1;
        actions.push(`Fediel: Reanimate ${cost} ${unit.name}`, ...applyEntryEvents(ctx, unit));
        summoned.push(unit);
      }
      for (const unit of summoned) evolveUnitByAbility(ctx, unit, actions);
    }
    actions.push(`Fediel: Necromancy 6 · ${summoned.length} evolved reanimates`);
    return { applied: true, actions: uniq(actions), unresolved: false };
  }

  if (highRiskName === "chaos legion" && /Super Skybound Art/i.test(highRiskRaw)) {
    const actions = [];
    const gauge = skyboundCountForInstance(ctx);
    const amount = gauge >= 15 ? 6 : 3;
    for (const unit of ctx.opponent.board.filter(unit => unit.type === "Follower")) {
      damageUnit(unit, amount, ctx.opponent, ctx.player, ctx, actions);
    }
    const dealt = damageLeader(ctx.opponent, amount);
    ctx.stats.damageDealt[ctx.playerIndex] += dealt;
    actions.push(`Chaos Legion: ${amount} damage to all enemies · gauge ${gauge}`);
    return { applied: true, actions: uniq(actions), unresolved: false };
  }

  if (highRiskName === "seofon, leader of the eternals" && /Skybound Art/i.test(highRiskRaw)) {
    const actions = [];
    const gauge = skyboundCountForInstance(ctx);
    const targets = [...ctx.player.board].filter(unit => unit.type === "Follower" && !unit.evolved && !unit.superEvolved);
    if (gauge >= 15) {
      for (const unit of targets) superEvolveUnitByAbility(ctx, unit, actions);
    } else if (gauge >= 10) {
      for (const unit of targets) evolveUnitByAbility(ctx, unit, actions);
    }
    actions.push(`Seofon: ${gauge >= 15 ? "Super Skybound" : gauge >= 10 ? "Skybound" : "inactive"} · gauge ${gauge}`);
    return { applied: true, actions: uniq(actions), unresolved: false };
  }
  let text = String(raw ?? "").trim();
  const actions = [];
  if (!text) return { actions, applied: false, unresolved: false };

  // [[battle-inline-mode-selection]]
  if (/select\s+(?:a|an|one|two|three|four|five|\d+)\s+modes?\s+to activate/i.test(text)) {
    const choices = expandModes(text, ctx.player);
    const choice = choices[0];
    if (choice) {
      text = choice.text;
      actions.push(...recordAbyssModeSelection(ctx.player, choice.selectedModeCount ?? 0));
    }
  }

  // [[battle-swordcraft-resolve-text]]
  const swordcraft = resolveSwordcraftCardText(text, ctx);
  text = swordcraft.text;
  actions.push(...swordcraft.actions);

  // [[battle-dragoncraft-resolve-text]]
  const dragoncraft = resolveDragoncraftCardText(text, ctx);
  text = dragoncraft.text;
  actions.push(...dragoncraft.actions);

  // [[battle-forestcraft-resolve-text]]
  const forestcraft = resolveForestcraftCardText(text, ctx);
  text = forestcraft.text;
  actions.push(...forestcraft.actions);

  // [[battle-havencraft-final-resolve-text]]
  const havencraft = resolveHavencraftCardText(text, ctx);
  text = havencraft.text;
  actions.push(...havencraft.actions);

  // [[battle-neutral-resolve-text]]
  const neutral = resolveNeutralCardText(text, ctx);
  text = neutral.text;
  actions.push(...neutral.actions);

  // [[battle-portalcraft-resolve-text]]
  const portalcraft = resolvePortalcraftCardText(text, ctx);
  text = portalcraft.text;
  actions.push(...portalcraft.actions);

  // [[battle-runecraft-resolve-text]]
  const runecraft = resolveRunecraftCardText(text, ctx);
  text = runecraft.text;
  actions.push(...runecraft.actions);

  // Earth Sigils are a numeric field resource in the simulator. Spells and Engage
  // effects can create them directly without occupying an additional board slot.
  for (const match of [...text.matchAll(/gain\s+(an?|one|two|three|four|five|\d+)\s+earth sigils?/gi)]) {
    const amount = word(match[1]) || 1;
    if (canUseClassMechanic(ctx.player, "earthRite", ctx.card)) {
      ctx.player.earthSigils += amount;
      actions.push(`Earth Sigils +${amount} (${ctx.player.earthSigils})`);
    }
    text = text.replace(match[0], " ");
  }

  // [[battle-fuse-play-effects]]
  const fusedNames = ctx.instance?.fusedNames ?? ctx.sourceUnit?.fusedNames ?? [];
  const fusedCards = ctx.instance?.fusedCards ?? ctx.sourceUnit?.fusedCards ?? [];
  const hasFused = fusedCards.length > 0 || fusedNames.length > 0;
  const fuseCardName = norm(ctx.card?.name);
  if (fuseCardName === "garden's allure") {
    const clause = /Draw a card\.\s*If you've Fused to this card, draw 2 instead\.?/i;
    if (clause.test(text)) {
      const amount = hasFused ? 2 : 1;
      const drawn = drawCards(ctx.player, amount, ctx.stats, ctx.playerIndex);
      actions.push(`draw ${drawn}`);
      text = text.replace(clause, " ");
    }
  }
  if (fuseCardName === "returning slash") {
    const clause = /If you've Fused to this card, draw a card\.?/i;
    if (clause.test(text)) {
      if (hasFused) {
        const drawn = drawCards(ctx.player, 1, ctx.stats, ctx.playerIndex);
        actions.push(`Fuse bonus: draw ${drawn}`);
      }
      text = text.replace(clause, " ");
    }
  }
  if (fuseCardName === "sinciro, heir to usurpation") {
    const xValue = new Set(fusedNames.map(norm)).size;
    const fanfare = /Deal X damage to all enemies\.\s*X is the number of differently named cards Fused to this card\.?/i;
    const replicate = /Replicate the effects of this card'?s Fanfare ability\.?/i;
    if (fanfare.test(text) || replicate.test(text)) {
      for (const unit of ctx.opponent.board.filter(unit => unit.type === "Follower")) damageUnit(unit, xValue, ctx.opponent, ctx.player, ctx, actions);
      const dealt = damageLeader(ctx.opponent, xValue);
      ctx.stats.damageDealt[ctx.playerIndex] += dealt;
      actions.push(`Sinciro: ${xValue} damage to all enemies`);
      text = text.replace(fanfare, " ").replace(replicate, " ");
    }
  }

  // [[battle-gildaria-rally]]
  if (norm(ctx.card?.name) === "gildaria, anathema of attunement") {
    const gated = /Rally\s*\(?\s*20\s*\)?\s*-\s*Gain Crest\s*:\s*Gildaria, Anathema of Attunement\.\s*Evolve this follower\.?/i;
    if (gated.test(text)) {
      if (ctx.player.rally >= 20) {
        if (gainCrest(ctx.player, "Gildaria, Anathema of Attunement", ctx.card)) actions.push("Gildaria Crest");
        if (ctx.sourceUnit) evolveUnitByAbility(ctx, ctx.sourceUnit, actions);
      } else actions.push(`Rally ${ctx.player.rally}/20`);
      text = text.replace(gated, " ");
    }
  }

  const necromancy = text.match(/Necromancy\s*\(?\s*(\d+)\s*\)?\s*[-–—:]\s*(.*)$/i);
  if (necromancy) {
    if (!canUseClassMechanic(ctx.player, "necromancy", ctx.card)) return { actions: ["Necromancy unavailable outside Abysscraft"], applied: false, unresolved: false };
    if (ctx.player.shadows < Number(necromancy[1])) return { actions: [`Necromancy ${necromancy[1]} unavailable`], applied: false, unresolved: false };
    ctx.player.shadows -= Number(necromancy[1]);
    actions.push(`Necromancy ${necromancy[1]}`);
    text = necromancy[2];
  }
  const rally = text.match(/Rally\s*\(?\s*(\d+)\s*\)?\s*:\s*(.*)$/i);
  if (rally) {
    if (!canUseClassMechanic(ctx.player, "rally", ctx.card)) return { actions: ["Rally unavailable outside Swordcraft"], applied: false, unresolved: false };
    if (ctx.player.rally < Number(rally[1])) return { actions: [`Rally ${ctx.player.rally}/${rally[1]}`], applied: false, unresolved: false };
    actions.push(`Rally ${rally[1]}`);
    text = rally[2];
  }
  const combo = text.match(/Combo\s*\(?\s*(\d+)\s*\)?\s*:\s*(.*)$/i);
  if (combo) {
    if (!canUseClassMechanic(ctx.player, "combo", ctx.card)) return { actions: ["Combo unavailable outside Forestcraft"], applied: false, unresolved: false };
    if (ctx.player.cardsPlayedThisTurn < Number(combo[1])) return { actions: [`Combo ${ctx.player.cardsPlayedThisTurn}/${combo[1]}`], applied: false, unresolved: false };
    text = combo[2];
  }
  const superSkybound = text.match(/Super Skybound Art\s*\(?\s*(\d+)?\s*\)?\s*:\s*(.*)$/i);
  if (superSkybound) {
    const need = Number(superSkybound[1] ?? 15);
    if (skyboundCountForInstance(ctx) < need) return { actions: [], applied: false, unresolved: false };
    text = superSkybound[2];
    actions.push("Super Skybound Art");
  }
  const skybound = text.match(/Skybound Art\s*\(?\s*(\d+)?\s*\)?\s*:\s*(.*)$/i);
  if (skybound && !/Super Skybound Art/i.test(text)) {
    const need = Number(skybound[1] ?? 10);
    if (skyboundCountForInstance(ctx) < need) return { actions: [], applied: false, unresolved: false };
    text = skybound[2];
    actions.push("Skybound Art");
  }
  if (/if overflow is active/i.test(text) && (!canUseClassMechanic(ctx.player, "overflow", ctx.card) || ctx.player.maxPp < 7)) text = text.replace(/if overflow is active[^.]*\.?/ig, "");
  else if (/if overflow is active/i.test(text)) text = text.replace(/if overflow is active[, ]*/ig, "");
  if (/Earth Rite\s*\(?\s*(\d+)?\s*\)?\s*[-–—:]/i.test(text)) {
    if (!canUseClassMechanic(ctx.player, "earthRite", ctx.card)) return { actions: ["Earth Rite unavailable outside Runecraft"], applied: false, unresolved: false };
    const amount = Number(text.match(/Earth Rite\s*\(?\s*(\d+)?/i)?.[1] ?? 1);
    if (ctx.player.earthSigils < amount) return { actions: [`Earth Rite ${ctx.player.earthSigils}/${amount}`], applied: false, unresolved: false };
    performEarthRite(ctx.player, amount, actions);
    text = text.replace(/Earth Rite\s*\(?\s*\d*\s*\)?\s*[-–—:]/i, "");
  }

  // [[battle-abysscraft-resolve-text]]
  const abysscraft = resolveAbysscraftCardText(text, ctx);
  text = abysscraft.text;
  actions.push(...abysscraft.actions);

  // [[battle-high-risk-generic-resolve]]
  const highRisk = resolveHighRiskGenericText(text, ctx);
  text = highRisk.text;
  actions.push(...highRisk.actions);

  const x = ctx.instance?.x ?? ctx.sourceUnit?.x ?? 0;
  text = text.replace(/if X is at least\s*(\d+)\s*,\s*([^.]*)\.?/gi, (_, threshold, effect) => x >= Number(threshold) ? `${effect}.` : "");

  const doN = text.match(/Do this (\d+) times?\s*:\s*(?:["“](.*?)["”]|([^\n]+))/i);
  if (doN) {
    const repeated = (doN[2] ?? doN[3] ?? "").trim();
    for (let index = 0; index < Number(doN[1]); index += 1) {
      const result = resolveText(repeated, ctx);
      actions.push(...result.actions);
    }
    text = text.replace(doN[0], "");
  }

  for (const match of [...text.matchAll(/Spellboost your hand(?:\s+(\d+|one|two|three|four|five)\s+times?)?/gi)]) {
    const amount = word(match[1] ?? "one") || 1;
    spellboostHand(ctx.player, amount, ctx.cardMap, actions);
    text = text.replace(match[0], "");
    actions.push(`Spellboost ×${amount}`);
  }
  for (const match of [...text.matchAll(/Reanimate\s*\(?\s*(\d+)\s*\)?/gi)]) {
    const unit = reanimate(ctx.player, Number(match[1]), ctx.playerIndex, ctx.cardMap, ctx.rng);
    if (unit) {
      actions.push(`Reanimate ${unit.name}`);
      actions.push(...applyEntryEvents(ctx, unit));
    }
    text = text.replace(match[0], "");
  }
  if (/return your hand to (?:the )?deck/i.test(text)) {
    const count = ctx.player.hand.length;
    ctx.player.deck.push(...ctx.player.hand);
    ctx.player.hand = [];
    shuffle(ctx.player.deck, ctx.rng);
    actions.push(`return ${count} hand cards to deck`);
    text = text.replace(/return your hand to (?:the )?deck\.?/i, "");
  }
  if (/recover all (?:of )?your play points/i.test(text)) {
    ctx.player.pp = ctx.player.maxPp;
    actions.push("recover all PP");
    text = text.replace(/recover all (?:of )?your play points\.?/i, "");
  }

  const opponentCrest = text.match(/Give your opponent Crest\s*:\s*([^.;]+)/i);
  if (opponentCrest) {
    if (gainCrest(ctx.opponent, opponentCrest[1].trim(), ctx.card)) actions.push(`Opponent Crest: ${opponentCrest[1].trim()}`);
    text = text.replace(opponentCrest[0], "");
  }
  const crest = text.match(/Gain Crest\s*:\s*([^.;]+)/i);
  if (crest) {
    if (gainCrest(ctx.player, crest[1].trim(), ctx.card)) actions.push(`Crest: ${crest[1].trim()}`);
    text = text.replace(crest[0], "");
  }

  if (norm(ctx.card?.name) === "verdilia & castelle, sisters") {
    const pattern = /Summon a random follower that costs 2 or less from your deck and super-evolve it\.?/i;
    if (pattern.test(text)) {
      const eligible = ctx.player.deck.filter(item => item.card.type === "Follower" && Number(item.card.cost) <= 2);
      if (eligible.length && ctx.player.board.length < 5) {
        const chosen = eligible[Math.floor(ctx.rng() * eligible.length)];
        ctx.player.deck = ctx.player.deck.filter(item => item.uid !== chosen.uid);
        const unit = boardFollower(chosen);
        ctx.player.board.push(unit);
        ctx.player.rally += 1;
        actions.push(`summon ${unit.name}`);
        actions.push(...applyEntryEvents(ctx, unit));
        superEvolveUnitByAbility(ctx, unit, actions);
      }
      text = text.replace(pattern, "");
    }
  }

  const grant = text.match(/Give (?:this follower|it) (Ward|Rush|Storm|Bane|Drain|Barrier|Aura|Ambush|Intimidate)/i);
  if (grant && ctx.sourceUnit) {
    giveKeyword(ctx.sourceUnit, grant[1]);
    actions.push(grant[1]);
    text = text.replace(grant[0], "");
  }

  for (const match of [...text.matchAll(/deal (\d+) damage to (a random|random|an|a|the) enemy follower/gi)]) {
    const random = /random/i.test(match[2]);
    const target = random ? chooseRandomTarget(ctx.opponent.board, ctx.rng) : choosePlannedTarget(ctx, ctx.opponent.board);
    if (target) {
      damageUnit(target, Number(match[1]), ctx.opponent, ctx.player, ctx, actions);
      actions.push(`${match[1]} to ${target.name}`);
    }
    text = text.replace(match[0], "");
  }
  for (const match of [...text.matchAll(/deal (\d+) damage to (?:all|each) enemy followers?/gi)]) {
    for (const unit of ctx.opponent.board.filter(unit => unit.type === "Follower")) damageUnit(unit, Number(match[1]), ctx.opponent, ctx.player, ctx, actions);
    actions.push(`${match[1]} to enemy board`);
    text = text.replace(match[0], "");
  }
  for (const match of [...text.matchAll(/deal (\d+) damage to a random enemy(?! follower)/gi)]) {
    const candidates = [{ leader: true }, ...ctx.opponent.board.filter(unit => unit.type === "Follower").map(unit => ({ unit }))];
    if (candidates.length) {
      const target = candidates[Math.floor(ctx.rng() * candidates.length)];
      if (target.leader) {
        const dealt = damageLeader(ctx.opponent, Number(match[1]));
        ctx.stats.damageDealt[ctx.playerIndex] += dealt;
        actions.push(`${dealt} to enemy leader`);
      } else {
        damageUnit(target.unit, Number(match[1]), ctx.opponent, ctx.player, ctx, actions);
        actions.push(`${match[1]} to ${target.unit.name}`);
      }
    }
    text = text.replace(match[0], "");
  }
  if (/destroy (?:an|a|the) enemy follower/i.test(text)) {
    const unit = choosePlannedTarget(ctx, ctx.opponent.board);
    if (unit && destroyUnit(ctx.opponent, unit)) actions.push(`destroy ${unit.name}`);
    text = text.replace(/destroy (?:an|a|the) enemy follower\.?/i, "");
  }
  if (/destroy (?:a random|random) enemy follower/i.test(text)) {
    const unit = chooseRandomTarget(ctx.opponent.board, ctx.rng);
    if (unit && destroyUnit(ctx.opponent, unit)) actions.push(`destroy ${unit.name}`);
    text = text.replace(/destroy (?:a random|random) enemy follower\.?/i, "");
  }
  if (/banish (?:an|a|the) enemy follower/i.test(text)) {
    const unit = choosePlannedTarget(ctx, ctx.opponent.board);
    if (unit) { banish(ctx.opponent, unit); actions.push(`banish ${unit.name}`); }
    text = text.replace(/banish (?:an|a|the) enemy follower\.?/i, "");
  }
  if (/return (?:an|a|the) enemy follower to (?:its owner'?s|their) hand/i.test(text)) {
    const unit = choosePlannedTarget(ctx, ctx.opponent.board);
    if (unit) { bounce(ctx.opponent, unit); actions.push(`return ${unit.name}`); }
    text = text.replace(/return (?:an|a|the) enemy follower to (?:its owner'?s|their) hand\.?/i, "");
  }
  const xDamage = text.match(/deal X damage to (?:an|a|the) enemy follower/i);
  if (xDamage) {
    const target = choosePlannedTarget(ctx, ctx.opponent.board);
    if (target) { damageUnit(target, x, ctx.opponent, ctx.player, ctx, actions); actions.push(`${x} to ${target.name}`); }
    text = text.replace(xDamage[0], "");
  }
  const xAll = text.match(/deal X damage to all enemy followers/i);
  if (xAll) {
    for (const unit of ctx.opponent.board.filter(unit => unit.type === "Follower")) damageUnit(unit, x, ctx.opponent, ctx.player, ctx, actions);
    actions.push(`${x} to enemy board`);
    text = text.replace(xAll[0], "");
  }
  const split = text.match(/deal X damage split between all enemy followers/i);
  if (split) {
    let left = x;
    const targets = [...ctx.opponent.board.filter(unit => unit.type === "Follower")];
    while (left > 0 && targets.length) {
      const unit = targets[Math.floor(ctx.rng() * targets.length)];
      damageUnit(unit, 1, ctx.opponent, ctx.player, ctx, actions);
      left -= 1;
    }
    actions.push(`${x} split damage`);
    text = text.replace(split[0], "");
  }

  ctx.__sideActions = [];
  const context = effectContext(ctx);
  const beforeHp = ctx.player.hp;
  const core = executeGenericEffects(text, context);
  actions.push(...core.actions, ...ctx.__sideActions);
  if (ctx.player.hp > beforeHp) actions.push(...afterLeaderHeal(ctx.player, ctx.player.hp - beforeHp, ctx.stats, ctx.playerIndex));
  return { applied: actions.length > 0 || core.applied, actions: uniq(actions), unresolved: core.unresolved || Boolean(ctx.__highRiskNestedUnresolved) };
}

function effectContext(ctx) {
  return {
    card: ctx.card, instance: ctx.instance, sourceUnit: ctx.sourceUnit, player: ctx.player, opponent: ctx.opponent,
    playerIndex: ctx.playerIndex, enemyIndex: ctx.enemyIndex, stats: ctx.stats, rng: ctx.rng,
    recordHandEvolution: () => recordHandEvolution(ctx.player),
    draw: (player, amount, index) => drawCards(player, amount, ctx.stats, index),
    // [[battle-swordcraft-entry-context]]
    healPlayer: (player, amount, index = ctx.playerIndex) => healPlayer(player, amount, ctx.stats, index),
    damageEnemyFollower: (unit, amount, actionBuffer = []) => damageUnit(unit, amount, ctx.opponent, ctx.player, ctx, actionBuffer),
    damageEnemyLeader: amount => {
      const dealt = damageLeader(ctx.opponent, amount);
      ctx.stats.damageDealt[ctx.playerIndex] += dealt;
      return dealt;
    },
    chooseRandomEnemyFollower: () => chooseRandomTarget(ctx.opponent.board, ctx.rng),
    chooseEnemyFollower: board => choosePlannedTarget(ctx, board),
    chooseAlliedFollower: (board, excluded) => board.filter(unit => unit.type === "Follower" && unit !== excluded).sort((a,b)=>b.attack+b.defense-a.attack-a.defense)[0] ?? excluded,
    chooseHandFollower: hand => hand.filter(item => item.card.type === "Follower").sort((a,b)=>(Number(b.card.cost)||0)-(Number(a.card.cost)||0))[0] ?? null,
    // [[battle-coverage-100-context]]
    gainCrest: (player, name, card) => gainCrest(player, name, card),
    isSuperEvolutionUnlocked: () => ctx.player.personalTurn >= (ctx.player.goingFirst ? 7 : 6),
    evolveRandomUnitByAbility: predicate => {
      const candidates = ctx.player.board.filter(unit => unit.type === "Follower" && !unit.evolved && !unit.superEvolved && (!predicate || predicate(unit)));
      if (!candidates.length) return null;
      const unit = candidates[Math.floor(ctx.rng() * candidates.length)];
      const sideActions = [];
      evolveUnitByAbility(ctx, unit, sideActions);
      if (sideActions.length) ctx.__sideActions?.push?.(...sideActions);
      return unit;
    },
    summonFromDeckDifferentNames: (limit, predicate) => summonFromDeckDifferentNames(ctx, limit, predicate),
    summonWithoutLastWords: card => summonWithoutLastWords(ctx, card),
    setLeaderDamageCap: (player, cap) => {
      player.leaderDamageCap = Math.max(0, Number(cap) || 0);
      player.leaderDamageCapUntilOpponentTurnEnd = true;
    },
    notifyLeaveField: (player, unit) => notifyFollowerLeavesField(player, unit),
    // [[battle-ability-evolve-context-v5]]
    evolveUnitByAbility: unit => {
      const sideActions = [];
      const evolved = evolveUnitByAbility(ctx, unit, sideActions);
      if (sideActions.length) ctx.__sideActions?.push?.(...sideActions);
      return evolved;
    },
    buffUnit: (unit, attack, defense) => {
      const before = { attack: Number(unit.attack) || 0, defense: Number(unit.defense) || 0 };
      unit.attack += Number(attack) || 0;
      unit.defense += Number(defense) || 0;
      unit.maxDefense += Number(defense) || 0;
      const beforeHp = ctx.player.hp;
      const extra = applyBuffedFollowerEffects(effectContextBare(ctx), unit, before);
      if (ctx.player.hp > beforeHp) afterLeaderHeal(ctx.player, ctx.player.hp - beforeHp, ctx.stats, ctx.playerIndex);
      if (extra?.length) ctx.__sideActions?.push?.(...extra);

      // [[battle-krulle-defense-reaction]]
      if ((Number(defense) || 0) < 0 && ctx.opponent.board.includes(unit) && ctx.player.isActive) {
        const krulle = ctx.player.board.find(source => source.type === "Follower" && norm(source.name) === "krulle, heir to unkilling");
        if (krulle && krulle.__defenseReactionTurn !== ctx.player.personalTurn) {
          krulle.__defenseReactionTurn = ctx.player.personalTurn;
          const healed = healPlayer(ctx.player, 1, ctx.stats, ctx.playerIndex);
          if (healed) ctx.__sideActions?.push?.(`Krulle: restore ${healed} leader defense`, ...afterLeaderHeal(ctx.player, healed, ctx.stats, ctx.playerIndex));
        }
      }
    },
    buffHand: (item, attack, defense) => {
      item.attackBonus = (Number(item.attackBonus) || 0) + (Number(attack) || 0);
      item.defenseBonus = (Number(item.defenseBonus) || 0) + (Number(defense) || 0);
    },
    relatedCards: card => related(card, ctx.cardMap),
    summon: (player, card, amount, index) => summonWithEvents(player, card, amount, index, ctx),
    addToHand: (player, card, amount, index) => addHand(player, card, amount, index, ctx.stats),
    cleanup: player => player === ctx.player
      ? cleanup(ctx.player, ctx.opponent, ctx.playerIndex, ctx.enemyIndex, ctx.stats, ctx.rng, ctx.cardMap)
      : cleanup(ctx.opponent, ctx.player, ctx.enemyIndex, ctx.playerIndex, ctx.stats, ctx.rng, ctx.cardMap),
    banish: (player, unit) => banish(player, unit),
    returnToHand: (player, unit) => bounce(player, unit)
  };
}

function effectContextBare(ctx) {
  return {
    player: ctx.player, opponent: ctx.opponent, playerIndex: ctx.playerIndex, enemyIndex: ctx.enemyIndex, stats: ctx.stats,
    buffUnit(unit, attack, defense) { unit.attack += attack; unit.defense += defense; unit.maxDefense += defense; }
  };
}

// [[class-mechanic-boundaries-v1]]
export function isSpellboostRecipient(card) {
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

function gainCrest(player, name, card) {
  if ((player.crests ?? []).some(crest => norm(crest.name) === norm(name))) return false;
  if ((player.crests ?? []).length >= 5) return false;
  player.crests.push({
    name,
    card,
    countdown: crestCountdown(name),
    gainedTurn: Number(player.personalTurn) || 0,
    __damageTriggerTurn: -1,
    __healTriggerTurn: -1
  });
  return true;
}

function crestCountdown(name) {
  const normalized = norm(name);
  if (normalized === "sandalphon, primarch successor") return 2;
  if (normalized === "lu woh, light personified") return 2;
  if (normalized === "krulle, heir to unkilling") return 2;
  if (normalized === "gildaria, anathema of attunement") return 1;
  // [[battle-haven-crest-countdowns]]
  if (normalized === "supplicant of repose") return 4;
  if (normalized === "lapis, shining seraph") return 2;
  // [[battle-havencraft-final-crest-countdowns]]
  if (normalized === "devotee of repose") return 4;
  if (normalized === "maddening benison") return 2;
  if (normalized === "congregant of repose") return 4;
  if (normalized === "zoe, dazzling hope") return 1;
  if (normalized === "himeka, heir to repose") return 4;
  // [[battle-swordcraft-crest-countdowns]]
  if (normalized === "majestic conquest") return 2;
  if (normalized === "kagemitsu, enduring warrior") return 2;
  if (normalized === "octrice, hollowness manifest") return 8;
  if (normalized === "unkei, goldbloom") return 4;
  // [[battle-forestcraft-crest-countdowns]]
  if (normalized === "magnified malice") return 1;
  if (normalized === "minimized anxiety") return 1;
  if (normalized === "starry sky") return 1;
  if (normalized === "thestae, anathema of distortion") return 3;
  if (normalized === "yuel & societte, dancing duo") return 4;
  if (normalized === "great hart of the glacial realm") return 3;
  // [[battle-dragoncraft-crest-countdowns]]
  if (normalized === "crescent tube ride") return 4;
  if (normalized === "drache & aluzard, burning blood") return 2;
  if (normalized === "dragon's vale elder") return 2;
  // [[battle-abysscraft-crest-countdowns]]
  if (normalized === "rigor of the nightblossom") return 2;
  if (normalized === "valiant edge") return 2;
  if (normalized === "balto, dusk bounty hunter") return 4;
  if (normalized === "charon, stygian oarswoman") return 2;
  if (normalized === "corruption") return 4;
  // [[battle-neutral-crest-countdowns]]
  if (normalized === "illamrita, designated target") return 2;
  // Mjerrabaine is persistent and intentionally has no Countdown.
  // [[battle-portalcraft-crest-countdowns]]
  if (normalized === "eudie, maiden reborn") return 3;
  if (normalized === "slaus, revolving wheel of fortune") return 3;
  if (normalized === "belial, archangel of cunning") return 4;
  // Milteo & Luzen is persistent and intentionally has no Countdown.
  // [[battle-runecraft-crest-countdowns]]
  if (normalized === "pascale's dance") return 1;
  if (normalized === "insomniac witch") return 2;
  if (normalized === "crystal gazing") return 2;
  if (normalized === "juno, visionary alchemist") return 3;
  if (normalized === "lilanthim, anathema of predation") return 1;
  return null;
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

function chooseTarget(board, targeted) {
  return board.filter(unit => unit.type === "Follower" && (!targeted || (!unit.aura && !unit.ambush))).sort((a,b)=>b.attack+b.defense-a.attack-a.defense)[0] ?? null;
}

function choosePlannedTarget(ctx, board) {
  const legal = targetableEnemyFollowers(board);
  const planned = ctx?.targetPlan?.enemyUid ? legal.find(unit => unit.uid === ctx.targetPlan.enemyUid) : null;
  return planned ?? legal.sort((a,b)=>followerThreatValue(b)-followerThreatValue(a))[0] ?? null;
}

function chooseRandomTarget(board, rng) {
  const eligible = board.filter(unit => unit.type === "Follower");
  if (!eligible.length) return null;
  return eligible[Math.floor(rng() * eligible.length)] ?? eligible[0];
}

function tradeTarget(attacker, targets, strategy) {
  const tradeBias = clamp(Number(strategy?.tradeBias ?? .5), 0, 1);
  const score = target => {
    const kills = hasU(attacker, "Bane") || Math.max(0, Number(attacker.attack) || 0) >= Math.max(0, Number(target.defense) || 0);
    const enemyBane = hasU(target, "Bane");
    const invincible = attacker.superEvolved;
    const survivesDamage = invincible || (Number(attacker.defense) || 0) > Math.max(0, Number(target.attack) || 0);
    const survives = invincible || (!enemyBane && survivesDamage);
    const threat = Math.max(0, Number(target.attack) || 0) * 3 + Math.max(0, Number(target.defense) || 0);
    return (kills ? 100 : 0) + (survives ? 18 : 0) + threat * (0.45 + tradeBias) + (hasU(target, "Ward") ? 3 : 0);
  };
  return [...targets].sort((a,b) => score(b) - score(a))[0] ?? null;
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

function hasCrest(player, name) { const target = norm(name); return (player.crests ?? []).some(crest => norm(crest.name) === target); }
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

function snap(frames, players, meta, stats, record) {
  if (!record) return;
  frames.push({
    index: frames.length, round: meta.round, active: meta.active, phase: meta.phase, action: meta.action,
    players: players.map(player => ({
      name: player.name, className: player.className, hp: player.hp, maxHp: player.maxHp, pp: player.pp, maxPp: player.maxPp, ep: player.ep, sep: player.sep,
      shadows: player.shadows, rally: player.rally, earthSigils: player.earthSigils, cardsPlayedThisTurn: player.cardsPlayedThisTurn,
      classMechanics: classMechanicStatus(player), bonusPpAvailable: player.bonusPpAvailable, bonusPpUses: player.bonusPpUses,
      personalTurn: player.personalTurn, deckCount: player.deck.length, cemeteryCount: player.cemetery.length, fusedCount: player.fusedCards?.length ?? 0,
      hand: player.hand.map(cardView), board: player.board.map(unitView), crests: player.crests.map(crest => Number.isFinite(crest.countdown) ? `${crest.name} (${crest.countdown})` : crest.name)
    })),
    stats: cloneStats(stats)
  });
}

function cardView(item) {
  const card = item.card;
  return { id: Number(card.id), name: card.name, image: card.image, type: card.type, cost: costOf(item), attack: (Number(card.attack)||0)+(Number(item.attackBonus)||0), defense: (Number(card.defense)||0)+(Number(item.defenseBonus)||0), spellboost: isSpellboostRecipient(card) ? (Number(item.spellboost)||0) : 0, x: Number(item.x)||0, fusedNames: [...(item.fusedNames ?? [])], keywords: [...(card.keywords ?? [])] };
}
function unitView(unit) { const { card, ...view } = unit; return { ...view, keywords: [...(unit.keywords ?? [])] }; }
function cloneStats(stats) { return Object.fromEntries(Object.entries(stats).map(([key,value]) => [key, Array.isArray(value) ? [...value] : value])); }
function compact(base, actions) { const details = (actions ?? []).map(String).filter(Boolean); return details.length ? `${base} · ${details.slice(0,6).join(" · ")}${details.length > 6 ? " · …" : ""}` : base; }
function has(card, keyword) { return (card.keywords ?? []).includes(keyword) || new RegExp(`\\b${keyword.replace("-","[- ]")}\\b`, "i").test(String(card.text ?? "")); }
function hasU(unit, keyword) { return (unit.keywords ?? []).includes(keyword) || (keyword === "Barrier" && unit.barrier > 0) || (keyword === "Ambush" && unit.ambush) || (keyword === "Aura" && unit.aura) || (keyword === "Intimidate" && unit.intimidate); }
function norm(value) { return String(value ?? "").toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim(); }
function uniq(values) { return [...new Set(values.filter(Boolean).map(String))]; }
function cap(value) { const text = String(value ?? ""); return text ? text[0].toUpperCase() + text.slice(1) : ""; }
function word(value) { const map = { a:1, an:1, one:1, two:2, three:3, four:4, five:5 }; return /^\d+$/.test(String(value)) ? Number(value) : (map[norm(value)] ?? 0); }
function createRng(seedValue) { let seed = 2166136261; for (const ch of String(seedValue ?? "")) { seed ^= ch.charCodeAt(0); seed = Math.imul(seed, 16777619); } seed >>>= 0; return () => { seed += 0x6D2B79F5; let t = seed; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function shuffle(array, rng) { for (let index = array.length - 1; index > 0; index -= 1) { const other = Math.floor(rng() * (index + 1)); [array[index], array[other]] = [array[other], array[index]]; } }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
