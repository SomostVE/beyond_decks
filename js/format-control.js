import { state } from "./state.js";
import { saveWorkspace } from "./storage.js";
import "./update-report.js";
import "./mobile-ui.js";
import "./header-layout.js";

waitForReady();

function waitForReady() {
  if (!state.cardMap?.size) {
    setTimeout(waitForReady, 100);
    return;
  }
  setup();
}

function setup() {
  const toolbar = document.querySelector(".header-toolbar");
  const actions = document.querySelector(".header-actions");

  if (toolbar && !document.getElementById("deck-format")) {
    const control = document.createElement("label");
    control.className = "format-control";
    control.innerHTML = `
      <span>Format</span>
      <select id="deck-format" aria-label="Deck format">
        <option value="Rotation">Rotation</option>
        <option value="Unlimited">Unlimited</option>
        <option value="Boundless">Boundless</option>
      </select>
    `;
    const select = control.querySelector("select");
    select.value = state.format ?? "Rotation";
    select.addEventListener("change", () => {
      state.format = select.value;
      saveWorkspace(state);
      location.reload();
    });

    const slot = document.getElementById("format-control-slot");
    const typeRoot = document.getElementById("type-filter");
    if (slot) slot.appendChild(control);
    else if (typeRoot) typeRoot.insertAdjacentElement("afterend", control);
    else toolbar.appendChild(control);
  }

  const viewBody = document.querySelector('[data-collapse-key="view"] .sidebar-collapse-body');
  if (viewBody && !document.getElementById("owned-only")) {
    const ownedLabel = document.createElement("label");
    ownedLabel.innerHTML = `<input id="owned-only" type="checkbox" ${state.ownedOnly ? "checked" : ""}> Owned cards only`;
    const missingLabel = document.createElement("label");
    missingLabel.innerHTML = `<input id="missing-only" type="checkbox" ${state.missingOnly ? "checked" : ""}> Missing deck cards only`;
    viewBody.append(ownedLabel, missingLabel);

    const ownedInput = ownedLabel.querySelector("input");
    const missingInput = missingLabel.querySelector("input");

    ownedInput.addEventListener("change", () => {
      state.ownedOnly = ownedInput.checked;
      if (state.ownedOnly) {
        state.missingOnly = false;
        missingInput.checked = false;
      }
      refreshViewFilters();
    });

    missingInput.addEventListener("change", () => {
      state.missingOnly = missingInput.checked;
      if (state.missingOnly) {
        state.ownedOnly = false;
        ownedInput.checked = false;
      }
      refreshViewFilters();
    });
  }

  if (actions) {
    const existingCollection = document.getElementById("open-collection");
    if (existingCollection) {
      existingCollection.hidden = true;
      existingCollection.setAttribute("aria-hidden", "true");
      existingCollection.tabIndex = -1;
    }

    if (!actions.querySelector('[href="./collection.html"]')) {
      const collection = document.createElement("a");
      collection.className = "button page-nav-button";
      collection.href = "./collection.html";
      collection.textContent = "Collection";
      actions.insertBefore(collection, actions.firstChild?.nextSibling ?? actions.firstChild);
    }
  }
}

function refreshViewFilters() {
  // Reuse the app's normal View-filter change path so these late-mounted
  // controls update the filter counts/grid immediately without reloading the page.
  const bridge = document.getElementById("favorites-only");
  if (bridge) {
    bridge.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  saveWorkspace(state);
}
