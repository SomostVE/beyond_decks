const APP_STORAGE_PREFIXES = [
  "shadowverse-deck-assistant:",
  "svwb-"
];
const BACKUP_FORMAT = "svwb-deck-assistant-backup";
const BACKUP_VERSION = 1;
const DATABASE_GENERATED_AT_KEY = "svwb-database-generated-at";

const trigger = document.getElementById("io-menu-trigger");
const dropdown = document.getElementById("io-scope-dropdown");
const deckProxy = document.getElementById("open-io");
const collectionProxy = document.getElementById("open-collection");
const backupDialog = document.getElementById("backup-dialog");
const backupClose = document.getElementById("backup-dialog-close");
const backupText = document.getElementById("backup-text");
const backupStatus = document.getElementById("backup-status");
const exportEverythingButton = document.getElementById("export-everything");
const importEverythingButton = document.getElementById("import-everything");

trigger?.addEventListener("click", event => {
  event.stopPropagation();
  setMenuOpen(dropdown?.hidden ?? true);
});

dropdown?.addEventListener("click", event => {
  const option = event.target.closest("[data-io-scope]");
  if (!option) return;
  setMenuOpen(false);

  if (option.dataset.ioScope === "deck") {
    deckProxy?.click();
    return;
  }

  if (option.dataset.ioScope === "collection") {
    collectionProxy?.click();
    return;
  }

  if (option.dataset.ioScope === "all") {
    backupText.value = JSON.stringify(exportEverything(), null, 2);
    setBackupStatus("Full backup ready.", "info");
    backupDialog?.showModal();
  }
});

document.addEventListener("click", event => {
  if (!dropdown || dropdown.hidden) return;
  if (trigger?.contains(event.target) || dropdown.contains(event.target)) return;
  setMenuOpen(false);
});

document.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  if (dropdown && !dropdown.hidden) setMenuOpen(false);
});

window.addEventListener("resize", positionDropdown);
window.addEventListener("scroll", positionDropdown, true);

backupClose?.addEventListener("click", () => backupDialog?.close());
backupDialog?.addEventListener("click", event => {
  if (event.target === backupDialog) backupDialog.close();
});

exportEverythingButton?.addEventListener("click", () => {
  backupText.value = JSON.stringify(exportEverything(), null, 2);
  setBackupStatus("Full backup refreshed.", "success");
});

importEverythingButton?.addEventListener("click", () => {
  try {
    const payload = JSON.parse(backupText.value);
    const count = importEverything(payload);
    setBackupStatus(`Imported ${count} app storage entr${count === 1 ? "y" : "ies"}. Reloading…`, "success");
    setTimeout(() => location.reload(), 250);
  } catch (error) {
    setBackupStatus(`Import failed: ${error.message}`, "error");
  }
});

function setMenuOpen(open) {
  if (!trigger || !dropdown) return;
  dropdown.hidden = !open;
  trigger.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) positionDropdown();
}

function positionDropdown() {
  if (!trigger || !dropdown || dropdown.hidden) return;
  const rect = trigger.getBoundingClientRect();
  const width = Math.max(230, dropdown.offsetWidth || 230);
  const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width));
  dropdown.style.left = `${Math.round(left)}px`;
  dropdown.style.top = `${Math.round(rect.bottom + 6)}px`;
}

function isAppStorageKey(key) {
  return APP_STORAGE_PREFIXES.some(prefix => String(key ?? "").startsWith(prefix));
}

function exportEverything() {
  const storage = {};
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!key || !isAppStorageKey(key)) continue;
    storage[key] = localStorage.getItem(key);
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    databaseGeneratedAt: readDatabaseGeneratedAt(),
    note: "Full local backup for Beyond Decks. Only app-owned localStorage keys are included.",
    storage
  };
}

function importEverything(payload) {
  if (payload?.format !== BACKUP_FORMAT) {
    throw new Error("This JSON is not a Beyond Decks full backup.");
  }
  if (Number(payload?.version) !== BACKUP_VERSION) {
    throw new Error(`Unsupported backup version: ${payload?.version ?? "unknown"}.`);
  }
  if (!payload.storage || typeof payload.storage !== "object" || Array.isArray(payload.storage)) {
    throw new Error("Backup storage section is missing or invalid.");
  }

  const incoming = Object.entries(payload.storage).filter(([key, value]) =>
    isAppStorageKey(key) && (typeof value === "string" || value === null)
  );

  if (!incoming.length) {
    throw new Error("No app data found in this backup.");
  }

  const existingKeys = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (key && isAppStorageKey(key)) existingKeys.push(key);
  }
  for (const key of existingKeys) localStorage.removeItem(key);

  for (const [key, value] of incoming) {
    if (value !== null) localStorage.setItem(key, value);
  }
  return incoming.length;
}

function readDatabaseGeneratedAt() {
  return localStorage.getItem(DATABASE_GENERATED_AT_KEY) || null;
}

function setBackupStatus(message, type) {
  if (!backupStatus) return;
  backupStatus.textContent = message;
  backupStatus.dataset.type = type;
}
