import { getCountdown } from "./battle-rules.js";
import { canUseClassMechanic, canUseClassRules } from "./battle-class-mechanics.js";
import { costOf } from "./battle-engine-v5-state.js";
import { has, hasU, norm, uniq, shuffle } from "./battle-engine-v5-utils.js";
import { hasCrest, gainCrest } from "./battle-engine-v5-crests.js";
import { choosePlannedTarget, chooseRandomTarget } from "./battle-engine-v5-targeting.js";

export function createClassRules(runtime) {
  const {
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
  } = runtime;

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

  return {
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
  };
}
