export function getMainDeckMap(deck, limit = 40) {
  const main = new Map();
  let remaining = Math.max(0, Number(limit) || 0);

  for (const [idValue, qtyValue] of deck?.entries?.() ?? []) {
    if (remaining <= 0) break;
    const id = Number(idValue);
    const count = Math.min(Math.max(0, Number(qtyValue) || 0), remaining);
    if (Number.isFinite(id) && count > 0) main.set(id, count);
    remaining -= count;
  }

  return main;
}

export function isBasicCard(card) {
  return Number(card?.setId) === 10000 || String(card?.set ?? "").toLowerCase() === "basic";
}

export function getMissingMainDeckCardIds(deck, cardMap, owned) {
  const missing = new Set();
  const mainDeck = getMainDeckMap(deck);

  for (const [id, required] of mainDeck) {
    const card = cardMap?.get?.(Number(id));
    if (!card?.deckSelectable || isBasicCard(card)) continue;

    const ownedCopies = Math.max(0, Number(owned?.get?.(Number(id)) ?? 0) || 0);
    if (ownedCopies < required) missing.add(Number(id));
  }

  return missing;
}
