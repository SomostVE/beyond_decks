export function unitView(unit) { const { card, ...view } = unit; return { ...view, keywords: [...(unit.keywords ?? [])] }; }
export function cloneStats(stats) { return Object.fromEntries(Object.entries(stats).map(([key,value]) => [key, Array.isArray(value) ? [...value] : value])); }
export function compact(base, actions) { const details = (actions ?? []).map(String).filter(Boolean); return details.length ? `${base} · ${details.slice(0,6).join(" · ")}${details.length > 6 ? " · …" : ""}` : base; }
export function has(card, keyword) { return (card.keywords ?? []).includes(keyword) || new RegExp(`\\b${keyword.replace("-","[- ]")}\\b`, "i").test(String(card.text ?? "")); }
export function hasU(unit, keyword) { return (unit.keywords ?? []).includes(keyword) || (keyword === "Barrier" && unit.barrier > 0) || (keyword === "Ambush" && unit.ambush) || (keyword === "Aura" && unit.aura) || (keyword === "Intimidate" && unit.intimidate); }
export function norm(value) { return String(value ?? "").toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim(); }
export function uniq(values) { return [...new Set(values.filter(Boolean).map(String))]; }
export function cap(value) { const text = String(value ?? ""); return text ? text[0].toUpperCase() + text.slice(1) : ""; }
export function word(value) { const map = { a:1, an:1, one:1, two:2, three:3, four:4, five:5 }; return /^\d+$/.test(String(value)) ? Number(value) : (map[norm(value)] ?? 0); }
export function createRng(seedValue) { let seed = 2166136261; for (const ch of String(seedValue ?? "")) { seed ^= ch.charCodeAt(0); seed = Math.imul(seed, 16777619); } seed >>>= 0; return () => { seed += 0x6D2B79F5; let t = seed; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export function shuffle(array, rng) { for (let index = array.length - 1; index > 0; index -= 1) { const other = Math.floor(rng() * (index + 1)); [array[index], array[other]] = [array[other], array[index]]; } }
export function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
