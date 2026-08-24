import { classMechanicStatus, isSpellboostRecipientCard } from "./battle-class-mechanics.js";
import { cloneStats, unitView, norm } from "./battle-engine-v5-utils.js";

export function createStats() {
  const pair = () => [0, 0];
  return {
    damageDealt: pair(), cardsPlayed: pair(), attacks: pair(), draws: pair(), unsupportedEffects: pair(),
    evolutions: pair(), superEvolutions: pair(), healing: pair(), followersLost: pair(), cardsGenerated: pair(), cardsFused: pair(),
    cardsBurned: pair(), ppSpent: pair(), ppWasted: pair(), spellsPlayed: pair(), lastWordsTriggered: pair(), strikeTriggered: pair()
  };
}

export function costOf(inst) {
  let cost = (Number(inst.card.cost) || 0) + (Number(inst.costDelta) || 0);
  const text = norm(inst.card.text);
  const reduction = Number(text.match(/(?:on )?spellboost\s*:\s*(?:subtract|reduce)(?: the cost of this card by)?\s*(\d+)/i)?.[1] ?? 0);
  if (reduction) cost -= reduction * (Number(inst.spellboost) || 0);
  else if (/(?:on )?spellboost\s*:\s*subtract 1 from this card'?s cost/.test(text)) cost -= Number(inst.spellboost) || 0;
  return Math.max(0, cost);
}

export function snap(frames, players, meta, stats, record) {
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

function isSpellboostRecipient(card) { return isSpellboostRecipientCard(card); }
