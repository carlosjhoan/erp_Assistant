/**
 * npm run topics:extract [-- --meeting <id>] [-- --retry]
 */
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { desc } from "drizzle-orm";
import { openDatabase } from "../infra/db/client.ts";
import { meeting } from "../infra/db/schema.ts";
import { createTopicRepo } from "../infra/db/topic-repo.ts";
import { providersFromEnv } from "../infra/llm/providers.ts";
import { extractTopics } from "../app/extract-topics.ts";
import { umbralJev } from "../app/verify-topics.ts";

function arg(nombre: string): string | undefined {
  const i = process.argv.indexOf(nombre);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const { db } = openDatabase(process.env.DATABASE_PATH ?? "./data/my_erp.db");
  migrate(db, { migrationsFolder: "./drizzle" });

  const idPedido = arg("--meeting");
  const reunion = idPedido
    ? db.select().from(meeting).all().find((m) => m.id === idPedido || m.externalId === idPedido)
    : db.select().from(meeting).orderBy(desc(meeting.occurredAt)).all().find((m) => m.summary);

  if (!reunion) {
    console.log("No hay ninguna reunión con summary. Corré primero: npm run ingest");
    process.exit(1);
  }

  console.log(`Extrayendo temas de "${reunion.title}"…\n`);

  const r = await extractTopics({ db, ...providersFromEnv() }, reunion.id);

  if (r.empty) {
    console.log("No se detectó ningún tema sobre el cual trabajar en esta reunión.\n");
    if (r.empty.reason) console.log(`Razón: ${r.empty.reason}`);
    if (r.empty.conversationTopics.length > 0) {
      console.log("La charla giró en torno a:");
      for (const t of r.empty.conversationTopics) console.log(`  · ${t}`);
    }
    console.log("\n¿Estás de acuerdo con este descubrimiento, o querés que lo intente de nuevo?");
    console.log("Para reintentar: npm run topics:extract -- --retry");
    return;
  }

  console.log(
    `${r.extracted} tema(s) · ${r.replaced} reemplazado(s) · ${r.kept} conservado(s) ya decidido(s)`
  );
  if (r.needsReview > 0) {
    console.log(`⚠ ${r.needsReview} para revisión (Jev por debajo de ${umbralJev()})`);
  }
  console.log(`  ${r.model} · ${r.tokens} tokens · ${(r.durationMs / 1000).toFixed(1)} s · ${r.retries} reintento(s)\n`);

  for (const t of r.topics) {
    const marca = t.needsReview ? "⚠" : "✓";
    const señal = t.scopeSignal === "likely_scope" ? "[alcance]" : "[idea]";
    console.log(`${marca} ${señal} ${t.title}`);
    console.log(`    Jev: ${t.score.toFixed(2)}`);
  }

  const pendientes = createTopicRepo(db).triajeIncompleto(reunion.id);
  console.log(`\n${pendientes.length} tema(s) esperando tu calificación (selected / parked / discarded).`);
}

main().catch((e) => {
  console.error("\nFalló la extracción:", e instanceof Error ? e.message : e);
  process.exit(1);
});
