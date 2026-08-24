import { norm, word } from "./battle-engine-v5-utils.js";

export function expandModes(text, player = null) {
  const raw = String(text ?? "");
  const choices = [...raw.matchAll(/(?:^|\s)(\d+)\.\s*/g)];
  const select = raw.match(/select\s+(a|an|one|two|three|four|five|\d+)\s+modes?\s+to activate/i);
  if (!select || !choices.length) return [{ i: 0, text: raw, selectedModeCount: 0 }];

  const segments = choices.map((match, index) => ({
    number: Number(match[1]),
    bit: 1 << Math.max(0, Number(match[1]) - 1),
    text: raw.slice(match.index + match[0].length, choices[index + 1]?.index ?? raw.length).split(/\b(?:Evolve|Super-Evolve|Last Words|Strike|Engage)\s*:/i)[0].trim()
  }));
  const baseCount = Math.max(1, word(select[1]) || Number(select[1]) || 1);
  const bonus = Math.max(0, Number(player?.abyssFaithModeBonus) || 0);
  const count = Math.min(segments.length, baseCount + bonus);
  const combinations = [];
  const visit = (start, picked) => {
    if (picked.length === count) { combinations.push([...picked]); return; }
    for (let index = start; index <= segments.length - (count - picked.length); index += 1) {
      picked.push(segments[index]);
      visit(index + 1, picked);
      picked.pop();
    }
  };
  visit(0, []);
  return combinations.map(combo => ({
    i: combo.reduce((mask, choice) => mask | choice.bit, 0),
    text: combo.map(choice => choice.text).filter(Boolean).join(" "),
    selectedModeCount: combo.length,
    selectedModeIndices: combo.map(choice => choice.number)
  }));
}

function stripFuseAbilityText(textValue) {
  return String(textValue ?? "")
    .replace(/^\s*Fuse\s*:[^\n]*(?:\n+|$)/gim, "")
    .replace(/^\s*When you Fuse to this card,[^\n]*(?:\n+|$)/gim, "")
    .replace(/^\s*When you've Fused both to this card,[^\n]*(?:\n+|$)/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function baseText(text) {
  const clean = stripFuseAbilityText(text);
  const fanfare = section(clean, "fanfare");
  if (fanfare) return fanfare;
  const value = String(clean);
  const colonIndex = value.search(/\b(?:Last Words|Strike|Clash|Evolve|Super-Evolve|Enhance|Accelerate|Crystallize|Engage|On Spellboost|At the start of your turn|At the end of your turn)\s*\(?\s*\d*\s*\)?\s*:/i);
  const naturalIndex = value.search(/(?<!["“])\b(?:At the end of your turn|At the start of your turn|When this follower evolves),\s*/i);
  const indexes = [colonIndex, naturalIndex].filter(index => index >= 0);
  const index = indexes.length ? Math.min(...indexes) : -1;
  return index < 0 ? value : value.slice(0, index).trim();
}

export function crystallizeText(textValue, cost) {
  const text = String(textValue ?? "");
  const regex = new RegExp(`Crystallize\\s*\\(?\\s*${cost}\\s*\\)?\\s*:`, "i");
  const match = regex.exec(text);
  if (!match) return "";
  const tail = text.slice(match.index + match[0].length);
  const next = tail.search(/\b(?:Fanfare|Evolve|Super-Evolve|Enhance\s*\(?\s*\d+\s*\)?|Accelerate\s*\(?\s*\d+\s*\)?|Engage|On Spellboost|At the start of your turn|At the end of your turn)\s*:/i);
  return (next < 0 ? tail : tail.slice(0, next)).trim();
}

export function section(textValue, label) {
  const text = String(textValue);
  const target = norm(label).replace(/[()]/g, "");
  const regex = /(Last Words|On Spellboost|Super-Evolve|Evolve|Strike|Clash|Fanfare|At the start of your turn|At the end of your turn|Enhance\s*\(?\s*\d+\s*\)?|Accelerate\s*\(?\s*\d+\s*\)?|Crystallize\s*\(?\s*\d+\s*\)?|Engage\s*\(?\s*\d*\s*\)?)\s*:/gi;
  const markers = [];
  let match;
  while ((match = regex.exec(text))) markers.push({ label: norm(match[1]).replace(/[()]/g, ""), start: match.index, end: regex.lastIndex });
  const hit = markers.find(marker => marker.label === target);
  if (!hit) return "";
  const next = markers.find(marker => marker.start > hit.start);
  const tailEnd = next?.start ?? text.length;
  const tail = text.slice(hit.end, tailEnd);
  const natural = tail.search(/(?<!["“])\b(?:at the end of your turn|at the start of your turn|when this follower evolves),\s*/i);
  return (natural < 0 ? tail : tail.slice(0, natural)).trim();
}
