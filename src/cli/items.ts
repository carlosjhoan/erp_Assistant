/**
 * npm run items -- --topic <id>          desglosa un tema en ítems
 * npm run items -- --all                 desglosa todos los temas seleccionados sin ítems
 * npm run items -- --rubric <id>         recorre los temas de una rúbrica
 */
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { openDatabase } from "../infra/db/client.ts";
import { topic } from "../infra/db/schema.ts";
import { createItemRepo } from "../infra/db/item-repo.ts";
import { providersFromEnv } from "../infra/llm/providers.ts";
import { generateItems, assertUmbral } from "../app/generate-items.ts";
import { temasDeRubrica } from "../app/create-rubric.ts";

const { db } = openDatabase(process.env.DATABASE_PATH ?? "./data/my_erp.db");
migrate(db, { migrationsFolder: "./drizzle" });

const args = process.argv.slice(2);
const valor = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};

function resolverTema(prefijo: string) {
  const encontrados = db
    .select()
    .from(topic)
    .all()
    .filter((t) => t.id.startsWith(prefijo));

  if (encontrados.length === 0) throw new Error(`No encontré el tema "${prefijo}".`);
  if (encontrados.length > 1) throw new Error(`"${prefijo}" coincide con varios temas. Usá más caracteres.`);
  return encontrados[0]!;
}

function temasObjetivo(): { id: string; title: string }[] {
  const id = valor("--topic");
  if (id) return [{ id: resolverTema(id).id, title: resolverTema(id).title }];

  const rubricaId = valor("--rubric");
  if (rubricaId) {
    return temasDeRubrica(db, rubricaId).map((t) => ({ id: t.id, title: t.title }));
  }

  if (args.includes("--all")) {
    const repo = createItemRepo(db);
    return db
      .select()
      .from(topic)
      .where(eq(topic.status, "selected"))
      .all()
      .filter((t) => repo.porTema(t.id).length === 0)
      .map((t) => ({ id: t.id, title: t.title }));
  }

  throw new Error("Indicá --topic <id>, --rubric <id> o --all.");
}

async function main() {
  const objetivos = temasObjetivo();
  if (objetivos.length === 0) {
    console.log("No hay temas para desglosar.");
    return;
  }

  const providers = providersFromEnv(db);

  for (const t of objetivos) {
    console.log(`\nDesglosando: ${t.title}`);
    const r = await generateItems({ db, ...providers }, t.id);

    console.log(
      `  ${r.generated} ítem(s) · ${r.replaced} reemplazado(s) · ${r.model} · ${r.tokens} tok · ${(r.durationMs / 1000).toFixed(1)} s · ${r.intentos} intento(s)`
    );
    if (r.needsReview > 0) console.log(`  ⚠ ${r.needsReview} para revisión (Jev < ${assertUmbral()})`);

    for (const i of r.items) {
      console.log(`  ${String(i.position + 1).padStart(2)}. ${i.needsReview ? "⚠" : "✓"} [${i.type}] ${i.title}`);
    }
  }
}

main().catch((e) => {
  console.error(`\n${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
