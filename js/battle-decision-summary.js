import "./battle-replay-inspector.js";

const actionRoot = document.getElementById("battle-action");

if (actionRoot) {
  installDecisionSummaryStyles();

  const observer = new MutationObserver(() => renderDecisionSummary());
  observer.observe(actionRoot, { childList: true, characterData: true, subtree: true });
  renderDecisionSummary();
}

function renderDecisionSummary() {
  if (!actionRoot || actionRoot.querySelector(".battle-decision-actor")) return;

  const raw = String(actionRoot.textContent ?? "").trim();
  if (!raw) return;

  const actor = detectActor(raw);
  const summary = summarizeAction(raw, actor);

  actionRoot.title = raw;
  actionRoot.innerHTML = `
    <strong class="battle-decision-actor ${actor === "You" ? "you" : actor === "Opponent" ? "opponent" : "both"}">${escapeHtml(actor)}</strong>
    <span class="battle-decision-text">${escapeHtml(summary)}</span>
  `;
}

function detectActor(raw) {
  if (/^Both players\b/i.test(raw)) return "Both";
  if (/^You\b/i.test(raw)) return "You";
  if (/^Opponent\b/i.test(raw)) return "Opponent";
  if (/attacks Opponent's leader/i.test(raw)) return "You";
  if (/attacks You's leader/i.test(raw)) return "Opponent";
  if (document.querySelector("#battle-player-area .battle-leader-row.active")) return "You";
  if (document.querySelector("#battle-opponent-area .battle-leader-row.active")) return "Opponent";
  return "Battle";
}

function summarizeAction(raw, actor) {
  if (/^Both players draw 4 cards/i.test(raw)) return "Opening hands drawn.";

  let match = raw.match(/^(?:You|Opponent) redraws (\d+) opening cards?/i);
  if (match) return `Redrew ${match[1]} opening card${Number(match[1]) === 1 ? "" : "s"}.`;

  match = raw.match(/^(?:You|Opponent) starts turn (\d+)/i);
  if (match) return `Started turn ${match[1]}.`;

  if (/^(?:You|Opponent) draws a card/i.test(raw)) return "Drew a card.";
  if (/^(?:You|Opponent) cannot draw from an empty deck/i.test(raw)) return "Decked out and lost.";

  match = raw.match(/^(?:You|Opponent) plays (.+?) \(/i);
  if (match) return `Played ${match[1]}.`;

  match = raw.match(/^(?:You|Opponent) Fuses .+? into (.+?)(?:\.| ·|$)/i);
  if (match) return `Fused cards into ${match[1]}.`;

  match = raw.match(/^(?:You|Opponent) engages (.+?)(?:\.| ·|$)/i);
  if (match) return `Used Engage on ${match[1]}.`;

  match = raw.match(/^(?:You|Opponent) super-evolves (.+?)(?:\.| ·|$)/i);
  if (match) return `Super-evolved ${match[1]}.`;

  match = raw.match(/^(?:You|Opponent) evolves (.+?)(?:\.| ·|$)/i);
  if (match) return `Evolved ${match[1]}.`;

  if (/^(?:You|Opponent) ends the action sequence/i.test(raw)) return "Kept the remaining resources.";
  if (/^(?:You|Opponent) ends turn/i.test(raw)) return "Ended the turn.";

  match = raw.match(/^(.+?) attacks (?:Opponent|You)'s leader(?: for (\d+))?/i);
  if (match) {
    const damage = match[2] ? ` for ${match[2]}` : "";
    return actor === "Opponent"
      ? `Attacked your leader with ${match[1]}${damage}.`
      : `Attacked the opposing leader with ${match[1]}${damage}.`;
  }

  match = raw.match(/^(.+?) attacks (.+?)(?:\.| ·|$)/i);
  if (match) return `Attacked ${match[2]} with ${match[1]}.`;

  const first = raw.split(" · ")[0].replace(/^(?:You|Opponent)\s+/i, "").trim();
  return first || "Action resolved.";
}

function installDecisionSummaryStyles() {
  if (document.getElementById("battle-decision-summary-style")) return;
  const style = document.createElement("style");
  style.id = "battle-decision-summary-style";
  style.textContent = `
    #battle-action {
      gap: .55rem;
    }
    .battle-decision-actor {
      flex: 0 0 auto;
      min-width: 70px;
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: .22rem .5rem;
      text-align: center;
      font-size: .66rem;
      line-height: 1;
    }
    .battle-decision-actor.you {
      border-color: rgba(91, 214, 174, .5);
      background: rgba(91, 214, 174, .11);
      color: #9ce8cf;
    }
    .battle-decision-actor.opponent {
      border-color: rgba(241, 141, 141, .45);
      background: rgba(241, 141, 141, .09);
      color: #f2adad;
    }
    .battle-decision-actor.both {
      border-color: rgba(124, 140, 255, .45);
      background: rgba(124, 140, 255, .1);
      color: #c4caff;
    }
    .battle-decision-text {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `;
  document.head.appendChild(style);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
