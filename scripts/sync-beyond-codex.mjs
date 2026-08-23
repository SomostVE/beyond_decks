import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "data", "official");
const CODEX_REF = process.env.BEYOND_CODEX_REF || "main";
const BASE = `https://raw.githubusercontent.com/SomostVE/beyond_codex/${CODEX_REF}/api/v1`;
const FILES = ["manifest.json", "cards.json", "metadata.json", "changelog.json"];

async function fetchJson(file) {
  const response = await fetch(`${BASE}/${file}`, {
    headers: { "User-Agent": "Beyond Decks CI" },
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  return response.json();
}

async function main() {
  const [manifest, cards, metadata, changelog] = await Promise.all(FILES.map(fetchJson));

  if (manifest?.schemaVersion !== 1) throw new Error(`Unsupported Codex schema ${manifest?.schemaVersion ?? "unknown"}`);
  if (!Array.isArray(cards) || cards.length < 100) throw new Error(`Suspicious Codex card count ${cards?.length ?? "invalid"}`);
  if (Number(manifest?.counts?.cards) !== cards.length) throw new Error("Codex manifest/card count mismatch");
  if (Number(metadata?.count) !== cards.length) throw new Error("Codex metadata/card count mismatch");
  if (manifest.generatedAt !== metadata.generatedAt || manifest.generatedAt !== changelog.generatedAt) {
    throw new Error("Codex snapshot timestamps disagree");
  }

  await fs.mkdir(OUT_DIR, { recursive: true });
  for (const [file, value] of FILES.map((file, index) => [file, [manifest, cards, metadata, changelog][index]])) {
    await fs.writeFile(path.join(OUT_DIR, file), `${JSON.stringify(value, null, 2)}\n`);
  }

  console.log(`Beyond Codex synced for tests: ${cards.length} cards · ${manifest.generatedAt} · ref ${CODEX_REF}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
