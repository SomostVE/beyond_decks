import { norm, hasU, clamp } from "./battle-engine-v5-utils.js";

export function targetableEnemyFollowers(board) {
  return board.filter(unit => unit.type === "Follower" && !unit.aura && !unit.ambush);
}

export function targetEffectSpec(item) {
  const text = String(item?.mode?.text || item?.instance?.card?.text || "");
  let match = text.match(/deal\s+(\d+)\s+damage to (?:an|a|the) enemy follower/i);
  if (match) return { kind: "damage", amount: Number(match[1]) || 0 };
  if (/destroy (?:an|a|the) enemy follower/i.test(text)) return { kind: "destroy", amount: 0 };
  if (/banish (?:an|a|the) enemy follower/i.test(text)) return { kind: "banish", amount: 0 };
  if (/return (?:an|a|the) enemy follower to (?:its owner'?s|their) hand/i.test(text)) return { kind: "return", amount: 0 };
  if (/deal X damage to (?:an|a|the) enemy follower/i.test(text)) return { kind: "damage", amount: Math.max(0, Number(item?.instance?.x) || 0), x: true };

  match = text.match(/select an enemy follower(?: on the field)? and deal it\s+(\d+)\s+damage/i);
  if (match) return { kind: "damage", amount: Number(match[1]) || 0, selectedGrammar: true };
  if (/select an enemy follower(?: on the field)? and destroy it/i.test(text)) return { kind: "destroy", amount: 0, selectedGrammar: true };
  if (/select an enemy follower(?: on the field)? and banish it/i.test(text)) return { kind: "banish", amount: 0, selectedGrammar: true };
  // [[battle-forestcraft-target-branches]]
  if (/select an enemy follower(?: on the field)? and transform it into/i.test(text)) return { kind: "transform", amount: 0, selectedGrammar: true };
  if (/select an enemy follower(?: on the field)? and give it -0\/-X/i.test(text)) return { kind: "debuff", amount: 0, selectedGrammar: true };
  return null;
}

export function followerThreatValue(unit) {
  if (!unit) return 0;
  const attack = Math.max(0, Number(unit.attack) || 0);
  const defense = Math.max(0, Number(unit.defense) || 0);
  const text = norm(unit.card?.text ?? "");
  return attack * 2.5 + defense
    + (hasU(unit, "Ward") ? 2.5 : 0)
    + (hasU(unit, "Bane") ? 2.5 : 0)
    + (hasU(unit, "Storm") ? 2 : 0)
    + (unit.evolved ? 1.5 : 0)
    + (unit.superEvolved ? 2.5 : 0)
    + (/at the (?:start|end) of your turn|whenever|once on each/.test(text) ? 2 : 0);
}

export function targetBranchValue(plan, opponent) {
  if (!plan?.enemyUid) return 0;
  const unit = opponent.board.find(item => item.uid === plan.enemyUid);
  if (!unit) return -6;
  const threat = followerThreatValue(unit);
  const text = norm(unit.card?.text ?? "");
  const lastWords = /last words\s*:/.test(text);
  const fanfare = /fanfare\s*:/.test(text);
  if (plan.kind === "banish") return 8 + threat + (lastWords ? 7 : 0);
  if (plan.kind === "destroy") return 8 + threat - (lastWords ? 4 : 0);
  if (plan.kind === "return") return 5 + threat + Math.max(0, Number(unit.card?.cost) || 0) * .6 - (fanfare ? 3 : 0);
  if (plan.kind === "transform") return 9 + threat + (lastWords ? 7 : 0);
  if (plan.kind === "debuff") return 5 + threat * .7;
  if (plan.kind === "damage") {
    const amount = Math.max(0, Number(plan.amount) || 0);
    const barrier = Math.max(0, Number(unit.barrier) || 0) > 0;
    const kill = !barrier && amount >= Math.max(1, Number(unit.defense) || 1);
    const effective = barrier ? 0 : Math.min(amount, Math.max(0, Number(unit.defense) || 0));
    const overkill = kill ? Math.max(0, amount - Math.max(0, Number(unit.defense) || 0)) : 0;
    return (kill ? 12 + threat : effective * .9 + threat * .16) - overkill * .35;
  }
  return 0;
}

export function expandPlayTargetBranches(item, opponent) {
  const spec = targetEffectSpec(item);
  if (!spec) return [{ ...item, targetPlan: null }];
  const targets = targetableEnemyFollowers(opponent.board);
  if (!targets.length) return [{ ...item, targetPlan: null }];
  return targets.map(unit => ({
    ...item,
    targetPlan: { enemyUid: unit.uid, enemyName: unit.name, kind: spec.kind, amount: spec.amount, selectedGrammar: Boolean(spec.selectedGrammar) }
  }));
}

export function chooseTarget(board, targeted) {
  return board.filter(unit => unit.type === "Follower" && (!targeted || (!unit.aura && !unit.ambush))).sort((a,b)=>b.attack+b.defense-a.attack-a.defense)[0] ?? null;
}

export function choosePlannedTarget(ctx, board) {
  const legal = targetableEnemyFollowers(board);
  const planned = ctx?.targetPlan?.enemyUid ? legal.find(unit => unit.uid === ctx.targetPlan.enemyUid) : null;
  return planned ?? legal.sort((a,b)=>followerThreatValue(b)-followerThreatValue(a))[0] ?? null;
}

export function chooseRandomTarget(board, rng) {
  const eligible = board.filter(unit => unit.type === "Follower");
  if (!eligible.length) return null;
  return eligible[Math.floor(rng() * eligible.length)] ?? eligible[0];
}

export function tradeTarget(attacker, targets, strategy) {
  const tradeBias = clamp(Number(strategy?.tradeBias ?? .5), 0, 1);
  const score = target => {
    const kills = hasU(attacker, "Bane") || Math.max(0, Number(attacker.attack) || 0) >= Math.max(0, Number(target.defense) || 0);
    const enemyBane = hasU(target, "Bane");
    const invincible = attacker.superEvolved;
    const survivesDamage = invincible || (Number(attacker.defense) || 0) > Math.max(0, Number(target.attack) || 0);
    const survives = invincible || (!enemyBane && survivesDamage);
    const threat = Math.max(0, Number(target.attack) || 0) * 3 + Math.max(0, Number(target.defense) || 0);
    return (kills ? 100 : 0) + (survives ? 18 : 0) + threat * (0.45 + tradeBias) + (hasU(target, "Ward") ? 3 : 0);
  };
  return [...targets].sort((a,b) => score(b) - score(a))[0] ?? null;
}
