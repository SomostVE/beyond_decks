import { analyzeCardSupport as analyzeCardSupportV4 } from "./battle-engine-v4.js";
import { FULL_OVERRIDES } from "./battle-engine-v5-overrides.js";
import { prepareOriginalCardMap } from "./battle-engine-v5-card-preparation.js";
import { norm, uniq } from "./battle-engine-v5-utils.js";

export function analyzeDeckCoverage(deck, cardMap) {
  prepareOriginalCardMap(cardMap);
  let total = 0, full = 0, partial = 0, unsupported = 0;
  const partialCards = [], unsupportedCards = [], mechanics = new Map();
  for (const [id, qty] of normalizeDeck(deck)) {
    const card = cardMap.get(Number(id));
    const count = Number(qty) || 0;
    total += count;
    const support = analyzeCardSupport(card);
    if (support.level === "full") full += count;
    else if (support.level === "partial") { partial += count; if (card) partialCards.push(card.name); }
    else { unsupported += count; unsupportedCards.push(card?.name ?? `Card ${id}`); }
    for (const mechanic of support.mechanics ?? []) mechanics.set(mechanic, (mechanics.get(mechanic) ?? 0) + count);
  }
  return {
    total, full, partial, unsupported,
    modeledPercent: total ? Math.round((full + partial * .72) / total * 100) : 0,
    partialCards: uniq(partialCards).slice(0, 18),
    unsupportedCards: uniq(unsupportedCards).slice(0, 18),
    mechanics: [...mechanics].sort((a,b)=>b[1]-a[1]).slice(0,14).map(([name,count])=>({name,count}))
  };
}

export function analyzeCardSupport(card) {
  const base = analyzeCardSupportV4(card);
  if (!card) return base;
  // [[battle-forestcraft-fairy-blade-id]]
  // The upstream English data currently masks this card's leading name segment
  // as "***". Keep an ID fallback so coverage is stable if that masked segment
  // contains invisible/source-specific characters.
  const override = FULL_OVERRIDES.get(norm(card.name))
    ?? (Number(card.id) === 10311120 ? "Pixie-entry permanent attack reaction is modeled" : null);
  return override ? { ...base, level: "full", reason: `Battle Sim v5: ${override}` } : base;
}

export function normalizeDeck(deck) {
  if (deck instanceof Map) return [...deck.entries()].map(([id, qty]) => [Number(id), Number(qty)]);
  if (!Array.isArray(deck)) return [];
  return deck.map(entry => Array.isArray(entry)
    ? [Number(entry[0]), Number(entry[1])]
    : [Number(entry.cardId ?? entry.id), Number(entry.qty ?? entry.quantity ?? 1)])
    .filter(([id, qty]) => Number.isFinite(id) && qty > 0);
}
