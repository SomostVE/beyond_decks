export function createHighRiskRules(runtime) {
  const {
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
  } = runtime;

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
  export

  return {
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
  };
}
