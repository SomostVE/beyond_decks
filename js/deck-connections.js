import { state } from "./state.js";
import { getMainDeckMap } from "./tools-common.js";

const root = document.getElementById("deck-list");
let scheduled = false;

if (root) {
  new MutationObserver(schedule).observe(root, { childList: true, subtree: true });
  waitForCards();
}

function waitForCards() {
  if (state.cardMap?.size) {
    schedule();
    return;
  }
  setTimeout(waitForCards, 120);
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    renderConnections();
  });
}

function renderConnections() {
  if (!root || !state.cardMap?.size) return;

  const mainDeck = getMainDeckMap(state.deck);
  const cards = [...mainDeck.keys()]
    .map(id => state.cardMap.get(Number(id)))
    .filter(Boolean);
  const cardsByName = new Map(cards.map(card => [card.name, card]));
  const traitSets = new Map(cards.map(card => [card.id, new Set((card.traits ?? []).filter(value => value && value !== "-"))]));

  for (const row of root.querySelectorAll(".deck-row")) {
    const name = row.querySelector(".deck-row-title > strong")?.textContent?.trim();
    const card = cardsByName.get(name);
    const meta = row.querySelector(".deck-row-meta");
    if (!card || !meta) continue;

    let direct = false;
    let shared = false;
    const cardTraits = traitSets.get(card.id) ?? new Set();

    for (const other of cards) {
      if (other.id === card.id) continue;
      if (
        (card.relations ?? []).some(relation => Number(relation.id) === other.id) ||
        (other.relations ?? []).some(relation => Number(relation.id) === card.id)
      ) {
        direct = true;
        break;
      }
      if (!shared && (other.traits ?? []).some(value => cardTraits.has(value))) shared = true;
    }

    const level = direct ? "Strong" : shared ? "Medium" : "Weak";
    let badge = meta.querySelector(".deck-synergy-badge");
    if (!badge) {
      badge = document.createElement("span");
      meta.append(badge);
    }
    badge.className = `deck-synergy-badge synergy-${level.toLowerCase()}`;
    if (badge.textContent !== level) badge.textContent = level;
    badge.title = `${level} connection: official relations and shared archetype traits`;
  }
}
