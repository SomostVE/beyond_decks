const mq = matchMedia("(max-width: 760px)");
const shell = document.querySelector(".app-shell");
const appHeader = document.querySelector(".app-header");

ensureMobileStyles();

if (shell) {
  const topbar = document.createElement("div");
  topbar.className = "mobile-topbar";
  topbar.innerHTML = `
    <button class="mobile-menu-toggle" type="button" aria-label="Open filters and controls" aria-expanded="false">☰</button>
    <strong class="mobile-brand">Beyond Decks</strong>
    <span class="mobile-view-label">Cards</span>
  `;
  document.body.insertBefore(topbar, appHeader ?? shell);

  const backdrop = document.createElement("button");
  backdrop.className = "mobile-menu-backdrop";
  backdrop.type = "button";
  backdrop.setAttribute("aria-label", "Close filters and controls");
  document.body.appendChild(backdrop);

  if (appHeader && !appHeader.querySelector(".mobile-drawer-head")) {
    const drawerHead = document.createElement("div");
    drawerHead.className = "mobile-drawer-head";
    drawerHead.innerHTML = '<strong>Filters & controls</strong><button type="button" class="mobile-menu-close" aria-label="Close">×</button>';
    appHeader.prepend(drawerHead);

    const primaryNav = document.createElement("nav");
    primaryNav.className = "mobile-primary-nav";
    primaryNav.setAttribute("aria-label", "Main pages");
    primaryNav.innerHTML = `
      <a href="./collection.html">Collection</a>
      <a href="./battle.html">Battle Sim</a>
    `;
    drawerHead.insertAdjacentElement("afterend", primaryNav);
  }

  const nav = document.createElement("nav");
  nav.className = "mobile-section-nav";
  nav.setAttribute("aria-label", "Mobile navigation");
  nav.innerHTML = `
    <button type="button" data-view="cards">Cards</button>
    <button type="button" data-view="filters">Filters</button>
    <button type="button" data-view="deck">Deck <span class="mobile-deck-count"></span></button>
    <a href="./collection.html">Collection</a>
    <a href="./battle.html">Battle</a>
  `;
  document.body.appendChild(nav);

  const buttons = [...nav.querySelectorAll("[data-view]")];
  const deckCount = document.getElementById("deck-count");
  const deckBadge = nav.querySelector(".mobile-deck-count");
  const menuToggle = topbar.querySelector(".mobile-menu-toggle");
  const menuClose = appHeader?.querySelector(".mobile-menu-close");
  const viewLabel = topbar.querySelector(".mobile-view-label");

  function setControlsOpen(open) {
    if (!mq.matches) open = false;
    document.body.classList.toggle("mobile-controls-open", open);
    menuToggle?.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function choose(view, save = true) {
    const next = ["cards", "filters", "deck"].includes(view) ? view : "cards";
    document.body.dataset.mobileView = next;
    buttons.forEach(button => button.classList.toggle("active", button.dataset.view === next));
    if (viewLabel) viewLabel.textContent = next[0].toUpperCase() + next.slice(1);
    if (save) localStorage.setItem("svwb-mobile-view", next);
    setControlsOpen(false);
  }

  function refreshMode() {
    if (mq.matches) choose(localStorage.getItem("svwb-mobile-view") || "cards", false);
    else {
      delete document.body.dataset.mobileView;
      setControlsOpen(false);
    }
  }

  function refreshDeckBadge() {
    if (!deckCount || !deckBadge) return;
    deckBadge.textContent = String(deckCount.textContent || "0").match(/\d+/)?.[0] || "0";
  }

  menuToggle?.addEventListener("click", () => setControlsOpen(!document.body.classList.contains("mobile-controls-open")));
  menuClose?.addEventListener("click", () => setControlsOpen(false));
  backdrop.addEventListener("click", () => setControlsOpen(false));

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") setControlsOpen(false);
  });

  buttons.forEach(button => button.addEventListener("click", () => choose(button.dataset.view)));
  if (deckCount) new MutationObserver(refreshDeckBadge).observe(deckCount, { childList: true, subtree: true, characterData: true });
  mq.addEventListener?.("change", refreshMode);
  refreshDeckBadge();
  refreshMode();
}

function ensureMobileStyles() {
  for (const href of ["./css/mobile.css", "./css/mobile-menu.css", "./css/mobile-nav.css"]) {
    const name = href.split("/").pop().split("?")[0];
    if (document.querySelector(`link[href*="${name}"]`)) continue;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }
}
