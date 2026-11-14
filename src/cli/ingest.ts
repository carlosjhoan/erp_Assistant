/**
 * node --import tsx src/cli/ingest.ts [--since 2026-11-06] [--all]
 */
import { ingestGranola } from "../app/ingest.ts";

const TITLE_MATCH = process.env.INGEST_TITLE_MATCH ?? "Landing page activation plan";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const titulo = process.argv.includes("--all") ? "" : (arg("--title") ?? TITLE_MATCH);
const sinceRaw = arg("--since");

async function main() {
  console.log(`Buscando en Granola: ${titulo ? `"${titulo}"` : "todas las notas"}`);

  const r = await ingestGranola({
    titleMatch: titulo,
    ...(sinceRaw ? { since: new Date(sinceRaw) } : {}),
  });

  console.log("");
  console.log(`${r.found} encontrada(s) · ${r.created} nueva(s) · ${r.updated} actualizada(s) · ${r.unchanged} sin cambios`);

  for (const t of r.titles) console.log(`  · ${t}`);

  if (r.found === 0) {
    console.log("\nNinguna nota coincide. Probá con --all para ver qué hay disponible.");
  }
}

main().catch((e) => {
  console.error("\nFalló la ingesta:", e instanceof Error ? e.message : e);
  process.exit(1);
});
