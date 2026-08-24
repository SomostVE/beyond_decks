ensureStylesheet("./css/modern-ui-v2.css", "modern-ui-v2.css");

const undoButton = document.getElementById("undo-deck");
const redoButton = document.getElementById("redo-deck");
const clearDeckButton = document.getElementById("clear-deck");
const activeFilters = document.getElementById("active-filters");
const classFilter = document.getElementById("class-filter");

setupIconButton(undoButton, "↶", "Undo");
setupIconButton(redoButton, "↷", "Redo");
setupClearDeckConfirmation(clearDeckButton);
setupCompactActiveFilters(activeFilters);
setupClassTheme(classFilter);
setupNeutralControl(classFilter);

function ensureStylesheet(href, suffix) {
  if (document.querySelector(`link[href*="${suffix}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

function setupIconButton(button, glyph, label) {
  if (!button) return;
  button.textContent = glyph;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.classList.add("header-icon-button");
}

function setupClearDeckConfirmation(button) {
  if (!button) return;

  const normalLabel = "Clear deck";
  let armedUntil = 0;
  let resetTimer = 0;

  const reset = () => {
    armedUntil = 0;
    window.clearTimeout(resetTimer);
    button.classList.remove("confirming");
    button.textContent = normalLabel;
    button.setAttribute("aria-label", normalLabel);
    button.title = normalLabel;
  };

  button.title = normalLabel;

  button.addEventListener("click", event => {
    const deckCount = Number.parseInt(document.getElementById("deck-count")?.textContent ?? "0", 10) || 0;
    if (deckCount <= 0) {
      reset();
      return;
    }

    const now = performance.now();
    if (now < armedUntil) {
      reset();
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    armedUntil = now + 2600;
    button.classList.add("confirming");
    button.textContent = "Confirm";
    button.setAttribute("aria-label", "Confirm clear deck");
    button.title = "Click again to clear the deck";
    resetTimer = window.setTimeout(reset, 2600);
  }, true);

  document.addEventListener("pointerdown", event => {
    if (!armedUntil || event.target === button || button.contains(event.target)) return;
    reset();
  }, true);

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && armedUntil) reset();
  });
}

function setupCompactActiveFilters(root) {
  if (!root) return;

  const compact = () => {
    for (const button of root.querySelectorAll(".active-filter-chip")) {
      if (button.dataset.compactFilter === "1") continue;

      const raw = String(button.textContent ?? "").trim();
      const match = raw.match(/^([^:]+):\s*(.*?)\s*×$/);
      if (!match) {
        button.dataset.compactFilter = "1";
        continue;
      }

      const kind = match[1].trim();
      const value = match[2].trim();
      if (!value) continue;

      button.dataset.compactFilter = "1";
      button.dataset.filterKind = kind.toLowerCase().replace(/\s+/g, "-");
      button.title = `${kind}: ${value}`;
      button.setAttribute("aria-label", `Remove ${kind} filter: ${value}`);
      button.textContent = `${value} ×`;
    }
  };

  const observer = new MutationObserver(compact);
  observer.observe(root, { childList: true, subtree: true });
  compact();
}

function setupClassTheme(root) {
  if (!root) return;

  const themes = {
    Forestcraft: ["#69d77b", "105, 215, 123"],
    Swordcraft: ["#e1c44f", "225, 196, 79"],
    Runecraft: ["#8f94ff", "143, 148, 255"],
    Dragoncraft: ["#f39a4b", "243, 154, 75"],
    Abysscraft: ["#df5b83", "223, 91, 131"],
    Havencraft: ["#dbc983", "219, 201, 131"],
    Portalcraft: ["#45ced7", "69, 206, 215"],
    Neutral: ["#aeb8c7", "174, 184, 199"]
  };

  const apply = () => {
    const active = root.querySelector(".class-button.active");
    const className = active?.title || active?.getAttribute("aria-label") || "";
    const [accent, rgb] = themes[className] ?? ["#72b8ff", "114, 184, 255"];
    document.documentElement.style.setProperty("--class-accent", accent);
    document.documentElement.style.setProperty("--class-accent-rgb", rgb);
    document.body.dataset.classTheme = className || "default";
  };

  new MutationObserver(apply).observe(root, { childList: true });
  apply();
}

function setupNeutralControl(root) {
  if (!root) return;

  const hideLegacyIncludeNeutral = () => {
    const includeNeutral = root.querySelector(".neutral-icon-toggle");
    if (includeNeutral) includeNeutral.hidden = true;
  };

  new MutationObserver(hideLegacyIncludeNeutral).observe(root, { childList: true });
  hideLegacyIncludeNeutral();
}
