export const BEYOND_CODEX_BASES = [
  "https://somostve.github.io/beyond_codex/api/v1",
  "https://raw.githubusercontent.com/SomostVE/beyond_codex/main/api/v1"
];
export const BEYOND_CODEX_BASE = BEYOND_CODEX_BASES[0];

let officialDataPromise = null;
let changelogPromise = null;
let resolvedContextPromise = null;

export function loadOfficialCardData() {
  if (!officialDataPromise) officialDataPromise = loadOfficialCardDataOnce();
  return officialDataPromise;
}

export function loadOfficialChangelog() {
  if (!changelogPromise) changelogPromise = loadOfficialChangelogOnce();
  return changelogPromise;
}

export function codexEndpoint(file, base = BEYOND_CODEX_BASE) {
  return `${String(base).replace(/\/$/, "")}/${String(file).replace(/^\/+/, "")}`;
}

async function loadOfficialCardDataOnce() {
  const errors = [];

  for (const base of BEYOND_CODEX_BASES) {
    try {
      const context = await loadManifest(base);
      const [cards, metadata] = await Promise.all([
        fetchJson(base, "cards.json", context.manifest.generatedAt),
        fetchJson(base, "metadata.json", context.manifest.generatedAt)
      ]);

      validateSnapshot(cards, metadata, context.manifest);
      resolvedContextPromise = Promise.resolve(context);
      return { cards, metadata, manifest: context.manifest, sourceBase: base };
    } catch (error) {
      console.warn(`[Beyond Decks] Beyond Codex endpoint failed: ${base}`, error);
      errors.push(`${base}: ${error.message}`);
    }
  }

  throw new Error(`Unable to load Beyond Codex from any endpoint. ${errors.join(" | ")}`);
}

async function loadOfficialChangelogOnce() {
  try {
    const context = await resolveContext();
    return await fetchJson(context.base, "changelog.json", context.manifest.generatedAt);
  } catch (error) {
    console.warn("[Beyond Decks] Beyond Codex changelog unavailable.", error);
    return {
      schemaVersion: 1,
      generatedAt: null,
      counts: { added: 0, modified: 0, removed: 0 },
      added: [],
      modified: [],
      removed: []
    };
  }
}

async function resolveContext() {
  if (!resolvedContextPromise) {
    resolvedContextPromise = (async () => {
      const errors = [];
      for (const base of BEYOND_CODEX_BASES) {
        try {
          return await loadManifest(base);
        } catch (error) {
          errors.push(`${base}: ${error.message}`);
        }
      }
      throw new Error(`No healthy Beyond Codex endpoint. ${errors.join(" | ")}`);
    })();
  }
  return resolvedContextPromise;
}

async function loadManifest(base) {
  const response = await fetch(codexEndpoint("manifest.json", base), { cache: "no-store" });
  if (!response.ok) throw new Error(`manifest.json HTTP ${response.status}`);
  const manifest = await response.json();

  if (manifest?.schemaVersion !== 1) throw new Error(`Unsupported schemaVersion ${manifest?.schemaVersion ?? "unknown"}`);
  if (!Number.isFinite(Number(manifest?.counts?.cards)) || Number(manifest.counts.cards) < 100) {
    throw new Error(`Suspicious manifest card count ${manifest?.counts?.cards ?? "unknown"}`);
  }
  if (!manifest?.generatedAt) throw new Error("Manifest has no generatedAt timestamp");

  return { base, manifest };
}

async function fetchJson(base, file, generatedAt = "") {
  const url = new URL(codexEndpoint(file, base));
  if (generatedAt) url.searchParams.set("snapshot", generatedAt);
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${file} HTTP ${response.status}`);
  return response.json();
}

function validateSnapshot(cards, metadata, manifest) {
  if (!Array.isArray(cards) || cards.length < 100) {
    throw new Error("Beyond Codex returned an invalid card database");
  }

  const manifestCount = Number(manifest?.counts?.cards);
  if (cards.length !== manifestCount) {
    throw new Error(`Beyond Codex cards/manifest mismatch: ${cards.length} vs ${manifestCount}`);
  }
  if (Number(metadata?.count) !== cards.length) {
    throw new Error(`Beyond Codex cards/metadata mismatch: ${cards.length} vs ${metadata?.count ?? "unknown"}`);
  }
  if (metadata?.schemaVersion !== manifest?.schemaVersion) {
    throw new Error("Beyond Codex metadata schema does not match manifest schema");
  }
  if (metadata?.generatedAt !== manifest?.generatedAt) {
    throw new Error("Beyond Codex metadata timestamp does not match manifest timestamp");
  }
}
