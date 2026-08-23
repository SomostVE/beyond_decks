import { state } from "./state.js";
import { compareGameCardOrder } from "./card-sort.js";

export const CLASSES = [
  "Forestcraft",
  "Swordcraft",
  "Runecraft",
  "Dragoncraft",
  "Abysscraft",
  "Havencraft",
  "Portalcraft",
  "Neutral"
];

export function pruneUnavailableFilters() {
  const available = state.cards.filter(card =>
    card.class === state.selectedClass ||
    (state.includeNeutral && card.class === "Neutral")
  );

  const valid = {
    sets: new Set(available.map(card => card.set).filter(Boolean)),
    types: new Set(available.map(card => card.type).filter(Boolean)),
    rarities: new Set(available.map(card => card.rarity).filter(Boolean)),
    traits: new Set(available.flatMap(card => card.traits ?? []).filter(value => value && value !== "-")),
    keywords: new Set(available.flatMap(card => card.keywords ?? []).filter(value => value && value !== "-"))
  };

  let changed = false;
  for (const [key, allowed] of Object.entries(valid)) {
    const selected = state.filters[key];
    if (!selected) continue;
    for (const value of [...selected]) {
      if (allowed.has(value)) continue;
      selected.delete(value);
      changed = true;
    }
  }
  return changed;
}

export function filteredCards({ sort = true } = {}) {
  const query = parseSearch(state.search);
  const relatedTargets = resolveRelatedTargets(query.related);
  const discoverSource = state.discoverCardId ? state.cardMap.get(Number(state.discoverCardId)) : null;

  const cards = state.cards.filter(card => {
    const classMatch =
      card.class === state.selectedClass ||
      (state.includeNeutral && card.class === "Neutral");

    if (!classMatch) return false;
    if (!matchesFormat(card, state.format)) return false;
    if (!state.showGenerated && !card.deckSelectable) return false;

    const isExcluded = state.excluded.has(card.id) || state.globalExclusions.has(card.id);
    if (!state.showExcluded && isExcluded) return false;
    if (state.favoritesOnly && !state.favorites.has(card.id)) return false;
    if (state.ownedOnly && card.deckSelectable && card.set !== "Basic" && Number(card.setId) !== 10000 && Number(state.owned.get(card.id) ?? 0) <= 0) return false;
    if (state.missingOnly && !isMissingFromCurrentDeck(card)) return false;

    if (!matchesAdvancedSearch(card, query, relatedTargets)) return false;

    if (state.filters.costs.size && !matchesCostFilter(card.cost)) return false;
    if (state.filters.sets.size && !state.filters.sets.has(card.set)) return false;
    if (state.filters.types.size && !state.filters.types.has(card.type)) return false;
    if (state.filters.rarities.size && !state.filters.rarities.has(card.rarity)) return false;

    if (state.filters.traits.size) {
      const traits = new Set(card.traits ?? []);
      if (![...state.filters.traits].every(value => traits.has(value))) return false;
    }

    if (state.filters.keywords.size) {
      const keywords = new Set(card.keywords ?? []);
      if (![...state.filters.keywords].every(value => keywords.has(value))) return false;
    }

    if (discoverSource && card.id !== discoverSource.id && discoveryScore(discoverSource, card) <= 0) return false;

    return true;
  });

  if (!sort) return cards;

  if (discoverSource) {
    cards.sort((a, b) =>
      discoveryScore(discoverSource, b) - discoveryScore(discoverSource, a) ||
      compareGameCardOrder(a, b)
    );
  } else {
    cards.sort(compareGameCardOrder);
  }

  return cards;
}

export function countFilteredCards() {
  return filteredCards({ sort: false }).length;
}

export function matchesFormat(card, format = state.format) {
  if (!card) return false;
  if (format === "Rotation") return Boolean(card.rotation) || card.set === "Basic" || Number(card.setId) === 10000;
  // The imported CardList dataset does not currently include Unlimited ban/restriction status.
  return true;
}

function isMissingFromCurrentDeck(card) {
  if (!card?.deckSelectable) return false;
  const required = Math.min(3, Number(state.deck.get(card.id) ?? 0));
  if (required <= 0) return false;
  if (card.set === "Basic" || Number(card.setId) === 10000) return false;
  return Number(state.owned.get(card.id) ?? 0) < required;
}

function matchesCostFilter(costValue) {
  const cost = Number(costValue) || 0;
  for (const bucket of state.filters.costs) {
    if (bucket === "10+" && cost >= 10) return true;
    if (bucket !== "10+" && cost === Number(bucket)) return true;
  }
  return false;
}

export function discoveryScore(source, candidate) {
  if (!source || !candidate || source.id === candidate.id) return source?.id === candidate?.id ? 1000 : 0;
  let score = 0;

  if ((source.relations ?? []).some(relation => Number(relation.id) === candidate.id)) score += 100;
  if ((candidate.relations ?? []).some(relation => Number(relation.id) === source.id)) score += 80;
  if ((source.generatedBy ?? []).includes(candidate.id)) score += 90;
  if ((candidate.generatedBy ?? []).includes(source.id)) score += 90;

  const sourcePackages = new Set(source.packages ?? []);
  for (const packageId of candidate.packages ?? []) if (sourcePackages.has(packageId)) score += 50;

  const sourceTraits = new Set(source.traits ?? []);
  for (const trait of candidate.traits ?? []) if (sourceTraits.has(trait) && trait !== "-") score += 20;

  const sourceKeywords = new Set(source.keywords ?? []);
  for (const keyword of candidate.keywords ?? []) if (sourceKeywords.has(keyword)) score += 5;

  const sourceRoles = new Set(source.roles ?? []);
  for (const role of candidate.roles ?? []) if (sourceRoles.has(role)) score += 3;

  return score;
}

function parseSearch(value) {
  let remaining = String(value ?? "");
  const filters = { roles: [], traits: [], keywords: [], sets: [], related: [] };
  const pattern = /\b(role|trait|keyword|set|related):(?:"([^"]+)"|'([^']+)'|([^\s]+))/gi;

  remaining = remaining.replace(pattern, (_, type, quotedDouble, quotedSingle, bare) => {
    const raw = quotedDouble ?? quotedSingle ?? bare ?? "";
    const normalized = raw.trim().toLowerCase();
    if (!normalized) return " ";

    if (type.toLowerCase() === "role") filters.roles.push(normalized);
    if (type.toLowerCase() === "trait") filters.traits.push(normalized);
    if (type.toLowerCase() === "keyword") filters.keywords.push(normalized);
    if (type.toLowerCase() === "set") filters.sets.push(normalized);
    if (type.toLowerCase() === "related") filters.related.push(normalized);
    return " ";
  });

  filters.free = remaining.trim().toLowerCase();
  return filters;
}

function resolveRelatedTargets(wantedNames) {
  if (!wantedNames.length) return [];
  const normalizedCards = state.cards.map(card => ({ card, name: lower(card.name) }));
  return wantedNames.map(wanted =>
    normalizedCards.find(entry => entry.name === wanted)?.card ??
    normalizedCards.find(entry => entry.name.includes(wanted))?.card ??
    null
  );
}

function matchesAdvancedSearch(card, query, relatedTargets) {
  const roles = (card.roles ?? []).map(lower);
  const traits = (card.traits ?? []).map(lower);
  const keywords = (card.keywords ?? []).map(lower);

  if (query.roles.length && !query.roles.every(value => roles.some(role => role.includes(value)))) return false;
  if (query.traits.length && !query.traits.every(value => traits.some(trait => trait.includes(value)))) return false;
  if (query.keywords.length && !query.keywords.every(value => keywords.some(keyword => keyword.includes(value)))) return false;
  if (query.sets.length && !query.sets.every(value => lower(card.set).includes(value))) return false;

  if (relatedTargets.length) {
    for (const target of relatedTargets) {
      if (!target) return false;
      const linked =
        card.id === target.id ||
        (card.relations ?? []).some(relation => Number(relation.id) === target.id) ||
        (target.relations ?? []).some(relation => Number(relation.id) === card.id) ||
        (card.generatedBy ?? []).includes(target.id) ||
        (target.generatedBy ?? []).includes(card.id);
      if (!linked) return false;
    }
  }

  if (query.free) {
    const haystack = card.__searchText ?? [
      card.name,
      card.text,
      card.set,
      card.class,
      card.type,
      card.rarity,
      ...(card.traits ?? []),
      ...(card.keywords ?? []),
      ...(card.roles ?? []),
      ...(card.customTags ?? [])
    ].join(" ").toLowerCase();

    if (!haystack.includes(query.free)) return false;
  }

  return true;
}

function lower(value) {
  return String(value ?? "").toLowerCase();
}
