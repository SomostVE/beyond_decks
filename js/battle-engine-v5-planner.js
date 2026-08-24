export function createPlanner(runtime) {
  const {
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
  } = runtime;

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
  
  function inspectTurnPlan({
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
  
  function inspectTwoTurnPlan(options = {}) {
    return inspectTurnPlan({ ...options, future: true });
  }
  
  // [[battle-fuse-v1]]

  return {
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
  };
}
