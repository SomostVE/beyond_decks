import { loadOfficialCardData } from "./codex-client.js";

export async function loadData() {
  const [officialData, packagesResponse, tagsResponse, exclusionsResponse] = await Promise.all([
    loadOfficialCardData(),
    fetch("./data/custom/packages.json"),
    fetch("./data/custom/tags.json"),
    fetch("./data/custom/exclusions.json")
  ]);

  const cards = officialData.cards;
  const metadata = officialData.metadata ?? {};
  const packageData = packagesResponse.ok ? await packagesResponse.json() : { packages: [] };
  const tagData = tagsResponse.ok ? await tagsResponse.json() : { cards: {} };
  const exclusionData = exclusionsResponse.ok ? await exclusionsResponse.json() : { global: [] };

  const packages = Array.isArray(packageData?.packages) ? packageData.packages : [];
  const customTags = tagData?.cards && typeof tagData.cards === "object" ? tagData.cards : {};
  const globalExclusions = new Set((exclusionData?.global ?? []).map(Number));

  enrichCards(cards, packages, customTags);

  return { cards, metadata, packages, customTags, globalExclusions };
}

function enrichCards(cards, packages, customTags) {
  const cardMap = new Map(cards.map(card => [Number(card.id), card]));

  for (const card of cards) {
    card.id = Number(card.id);
    card.setId = Number(card.setId ?? 0);
    if (card.setId === 90000 || card.set === "90000") card.set = "Token";

    // Beyond Codex owns official keyword extraction and normalization. Do not
    // re-parse rawSkillText here or Decks can diverge from the API contract.
    card.keywords = Array.isArray(card.keywords)
      ? [...new Set(card.keywords.map(String).filter(Boolean))].sort((a, b) => a.localeCompare(b))
      : [];
    card.traits = Array.isArray(card.traits) ? card.traits.map(String).filter(Boolean) : [];
    card.relatedCards = Array.isArray(card.relatedCards) ? card.relatedCards.map(Number).filter(Number.isFinite) : [];
    card.deckSelectable = !Boolean(card.token) && card.setId !== 90000 && card.set !== "Token" && Number(card.maxCopies ?? 3) > 0;
    card.generatedBy = [];
    card.relations = [];
    card.packages = [];

    const custom = customTags[String(card.id)] ?? customTags[card.id] ?? {};
    const customRoleList = Array.isArray(custom) ? custom : (custom.roles ?? []);
    const extraTags = Array.isArray(custom?.tags) ? custom.tags : [];
    card.customTags = [...new Set(extraTags.map(String))];
    card.roles = [...new Set([...inferRoles(card), ...customRoleList.map(String)])];
  }

  // Official related_card_ids are treated as the strongest relationship signal.
  // If the target is not deck-selectable, it is considered a generated/token card.
  for (const card of cards) {
    for (const relatedId of card.relatedCards ?? []) {
      const target = cardMap.get(Number(relatedId));
      if (!target) continue;

      if (target.deckSelectable) {
        addRelation(card, target.id, "Direct relation");
      } else {
        addRelation(card, target.id, "Generates");
        if (!target.generatedBy.includes(card.id)) target.generatedBy.push(card.id);
      }
    }
  }

  // Rules text can mention token/generated cards for many reasons: creating them,
  // consuming them, checking for them, etc. These fallback links are shown as direct
  // profile relations, but are intentionally not labelled as generation relationships.
  const generatedMatchers = cards
    .filter(card => !card.deckSelectable && card.name?.length >= 3)
    .map(card => ({ card, pattern: buildCardNamePattern(card.name) }))
    .filter(entry => entry.pattern);

  for (const source of cards) {
    const text = normalizeText(source.text);
    if (!text) continue;

    for (const entry of generatedMatchers) {
      const target = entry.card;
      if (source.id === target.id || hasRelation(source, target.id)) continue;
      if (entry.pattern.test(text)) addRelation(source, target.id, "Direct relation");
    }
  }

  for (const packageDef of packages) {
    const packageId = String(packageDef.id ?? packageDef.name ?? "").trim();
    if (!packageId) continue;

    for (const entry of normalizePackageCards(packageDef.cards)) {
      const card = cardMap.get(entry.id);
      if (card && !card.packages.includes(packageId)) card.packages.push(packageId);
    }
  }

  for (const card of cards) {
    if (card.relations.some(relation => relation.type === "Generates") && !card.roles.includes("Generate")) {
      card.roles.push("Generate");
    }
    card.roles.sort();
    card.__searchText = [
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
  }
}

function inferRoles(card) {
  const text = normalizeText(card.text);
  const keywords = new Set((card.keywords ?? []).map(value => String(value).toLowerCase()));
  const roles = new Set();

  if (Number(card.cost) <= 2 && card.deckSelectable) roles.add("Early Game");
  if (/\bdraw (?:a|an|one|two|three|\d+) cards?\b/.test(text) || /\bdraw cards?\b/.test(text)) roles.add("Draw");
  if (/\b(?:destroy|banish|return) (?:an?|the|all|each|random) enemy/.test(text) || /deal \d+ damage to (?:an?|the|a random) enemy follower/.test(text)) roles.add("Removal");
  if (/all enemy followers|each enemy follower|all other followers/.test(text)) roles.add("Board Clear");
  if (/restore \d+ defense to your leader|restore .* defense to your leader|recover .* defense/.test(text)) roles.add("Heal");
  if (/maximum play points|play point orb|empty play point/.test(text)) roles.add("Ramp");
  if (keywords.has("storm") || (/enemy leader/.test(text) && Number(card.cost) >= 5)) roles.add("Finisher");
  if (keywords.has("combo") || keywords.has("mode") || /select a mode|if .* cards? (?:have|has) been/.test(text)) roles.add("Combo Piece");

  return [...roles];
}

function addRelation(card, targetId, type) {
  const id = Number(targetId);
  if (hasRelation(card, id, type)) return;
  card.relations.push({ id, type });
}

function hasRelation(card, targetId, type = null) {
  return (card.relations ?? []).some(relation =>
    Number(relation.id) === Number(targetId) && (!type || relation.type === type)
  );
}

function normalizePackageCards(cards) {
  return (cards ?? []).map(entry => {
    if (typeof entry === "number" || typeof entry === "string") {
      return { id: Number(entry), count: 1 };
    }
    return { id: Number(entry.id), count: Number(entry.count ?? entry.quantity ?? 1) };
  }).filter(entry => Number.isFinite(entry.id));
}

function buildCardNamePattern(name) {
  const normalizedName = normalizeText(name);
  if (!normalizedName) return null;
  const escaped = normalizedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i");
}

function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
