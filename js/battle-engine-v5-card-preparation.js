import { HANDLED_REACTIVE_CLAUSES } from "./battle-engine-v5-support.js";
import { norm } from "./battle-engine-v5-utils.js";

const GAP_HOOK = "[[battle-rule-gap-hook]]";
const SIMULATION_CARD_MAP_CACHE = new WeakMap();

export function prepareSimulationCardMap(cardMap, analyzeCardSupport) {
  const cached = cardMap && typeof cardMap === "object" ? SIMULATION_CARD_MAP_CACHE.get(cardMap) : null;
  if (cached) return cached;

  prepareOriginalCardMap(cardMap);
  const prepared = new Map();
  for (const [id, original] of cardMap.entries()) {
    if (!original) continue;
    const support = analyzeCardSupport(original);
    let text = sanitizeHandledReactiveText(original.text);
    text = adaptSkyboundText(original, text);
    text = expandEnhanceWithBaseFanfare(text);
    if (support.level !== "full") text = injectGapHook(text);
    prepared.set(Number(id), {
      ...original,
      keywords: [...(original.keywords ?? [])],
      traits: [...(original.traits ?? [])],
      relatedCards: [...(original.relatedCards ?? [])],
      text
    });
  }
  for (const card of prepared.values()) {
    card.__relatedCardObjects = (card.relatedCards ?? []).map(id => prepared.get(Number(id))).filter(Boolean);
    card.__relatedNames = card.__relatedCardObjects.map(item => item.name);
  }
  if (cardMap && typeof cardMap === "object") SIMULATION_CARD_MAP_CACHE.set(cardMap, prepared);
  return prepared;
}

export function prepareOriginalCardMap(cardMap) {
  if (!(cardMap instanceof Map)) return;
  for (const card of cardMap.values()) {
    if (!card || Array.isArray(card.__relatedNames)) continue;
    card.__relatedNames = (card.relatedCards ?? []).map(id => cardMap.get(Number(id))?.name).filter(Boolean);
  }
}

function sanitizeHandledReactiveText(textValue) {
  let text = String(textValue ?? "");
  for (const pattern of HANDLED_REACTIVE_CLAUSES) text = text.replace(pattern, " ");
  return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function adaptSkyboundText(card, textValue) {
  let text = String(textValue ?? "");
  const name = norm(card?.name);
  if (name === "vira, luminous primal knight") {
    text = text.replace(/Super Skybound Art\s*[-–—:]\s*Super-evolve this follower\.?/i, "[[battle-super-skybound-self:15]]");
  }
  if (name === "lu woh, light personified") {
    text = text.replace(/Skybound Art\s*[-–—:]\s*Gain Crest\s*:\s*Lu Woh, Light Personified\.?/i, "[[battle-skybound-crest:10:Lu Woh, Light Personified]]");
  }
  text = text.replace(/Super Skybound Art\s*[-–—]\s*/gi, "Super Skybound Art: ");
  text = text.replace(/Skybound Art\s*[-–—]\s*/gi, "Skybound Art: ");
  return text;
}

function expandEnhanceWithBaseFanfare(textValue) {
  const text = String(textValue ?? "");
  const fanfare = text.match(/\bFanfare\s*:\s*([\s\S]*?)(?=\b(?:Enhance\s*\(?\s*\d+\s*\)?|Accelerate\s*\(?\s*\d+\s*\)?|Crystallize\s*\(?\s*\d+\s*\)?|Last Words|Strike|Clash|Evolve|Super-Evolve|Engage|On Spellboost|At the start of your turn|At the end of your turn)\s*:|$)/i)?.[1]?.trim();
  if (!fanfare || !/\bEnhance\s*\(?\s*\d+\s*\)?\s*:/i.test(text)) return text;
  return text.replace(/\bEnhance\s*\(?\s*(\d+)\s*\)?\s*:/gi, match => `${match} ${fanfare} `);
}

function injectGapHook(textValue) {
  const text = String(textValue ?? "");
  if (/\bFanfare\s*:/i.test(text)) return text.replace(/\bFanfare\s*:/i, match => `${match} ${GAP_HOOK} `);
  return `${GAP_HOOK}${text ? ` ${text}` : ""}`.trim();
}
