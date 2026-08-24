import { norm } from "./battle-engine-v5-utils.js";

export function hasCrest(player, name) { const target = norm(name); return (player.crests ?? []).some(crest => norm(crest.name) === target); }

export function gainCrest(player, name, card) {
  if ((player.crests ?? []).some(crest => norm(crest.name) === norm(name))) return false;
  if ((player.crests ?? []).length >= 5) return false;
  player.crests.push({
    name,
    card,
    countdown: crestCountdown(name),
    gainedTurn: Number(player.personalTurn) || 0,
    __damageTriggerTurn: -1,
    __healTriggerTurn: -1
  });
  return true;
}

export function crestCountdown(name) {
  const normalized = norm(name);
  if (normalized === "sandalphon, primarch successor") return 2;
  if (normalized === "lu woh, light personified") return 2;
  if (normalized === "krulle, heir to unkilling") return 2;
  if (normalized === "gildaria, anathema of attunement") return 1;
  // [[battle-haven-crest-countdowns]]
  if (normalized === "supplicant of repose") return 4;
  if (normalized === "lapis, shining seraph") return 2;
  // [[battle-havencraft-final-crest-countdowns]]
  if (normalized === "devotee of repose") return 4;
  if (normalized === "maddening benison") return 2;
  if (normalized === "congregant of repose") return 4;
  if (normalized === "zoe, dazzling hope") return 1;
  if (normalized === "himeka, heir to repose") return 4;
  // [[battle-swordcraft-crest-countdowns]]
  if (normalized === "majestic conquest") return 2;
  if (normalized === "kagemitsu, enduring warrior") return 2;
  if (normalized === "octrice, hollowness manifest") return 8;
  if (normalized === "unkei, goldbloom") return 4;
  // [[battle-forestcraft-crest-countdowns]]
  if (normalized === "magnified malice") return 1;
  if (normalized === "minimized anxiety") return 1;
  if (normalized === "starry sky") return 1;
  if (normalized === "thestae, anathema of distortion") return 3;
  if (normalized === "yuel & societte, dancing duo") return 4;
  if (normalized === "great hart of the glacial realm") return 3;
  // [[battle-dragoncraft-crest-countdowns]]
  if (normalized === "crescent tube ride") return 4;
  if (normalized === "drache & aluzard, burning blood") return 2;
  if (normalized === "dragon's vale elder") return 2;
  // [[battle-abysscraft-crest-countdowns]]
  if (normalized === "rigor of the nightblossom") return 2;
  if (normalized === "valiant edge") return 2;
  if (normalized === "balto, dusk bounty hunter") return 4;
  if (normalized === "charon, stygian oarswoman") return 2;
  if (normalized === "corruption") return 4;
  // [[battle-neutral-crest-countdowns]]
  if (normalized === "illamrita, designated target") return 2;
  // Mjerrabaine is persistent and intentionally has no Countdown.
  // [[battle-portalcraft-crest-countdowns]]
  if (normalized === "eudie, maiden reborn") return 3;
  if (normalized === "slaus, revolving wheel of fortune") return 3;
  if (normalized === "belial, archangel of cunning") return 4;
  // Milteo & Luzen is persistent and intentionally has no Countdown.
  // [[battle-runecraft-crest-countdowns]]
  if (normalized === "pascale's dance") return 1;
  if (normalized === "insomniac witch") return 2;
  if (normalized === "crystal gazing") return 2;
  if (normalized === "juno, visionary alchemist") return 3;
  if (normalized === "lilanthim, anathema of predation") return 1;
  return null;
}
