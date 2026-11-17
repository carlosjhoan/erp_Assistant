/**
 * npm run rubric                     crea la rúbrica con los temas seleccionados
 * npm run rubric -- --week 2026-11-16 --deadline 2026-11-20
 * npm run rubric -- show             muestra la rúbrica con sus ítems
 */
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { desc, eq } from "drizzle-orm";
import { openDatabase } from "../infra/db/client.ts";
import { rubric, topic } from "../infra/db/schema.ts";
import { createItemRepo } from "../infra/db/item-repo.ts";
import { createRubric, temasDeRubrica } from "../app/create-rubric.ts";

const { db } = openDatabase(process.env.DATABASE_PATH ?? "./data/my_erp.db");
migrate(db, { migrationsFolder: "./drizzle" });

const args = process.argv.slice(2);

function valor(nombre: string): string | undefined {
  const i = args.indexOf(nombre);
  return i >= 0 ? args[i + 1] : undefined;
}

function mostrar(rubricId: string) {
  const r = db.select().from(rubric).where(eq(rubric.id, rubricId)).get();
  if (!r) throw new Error(`No existe la rúbrica ${rubricId}.`);

  const temas = temasDeRubrica(db, r.id);
  const items = createItemRepo(db).porRubrica(r.id);

  console.log(`Rúbrica ${r.weekStart} · v${r.version} · ${r.status} · entrega ${r.deadline ?? "sin fecha"}`);
  console.log(`${temas.length} tema(s) · ${items.length} ítem(s)\n`);

  for (const t of temas) {
    const propios = items.filter((i) => i.topicId === t.id);
    console.log(`▸ ${t.title}`);
    if (propios.length === 0) console.log(`   (sin ítems todavía: npm run items -- --topic ${t.id.slice(0, 8)})`);

    for (const i of propios) {
      const marca = i.verifyStatus === "verified" ? "✓" : "⚠";
      console.log(`   ${String(i.position + 1).padStart(2)}. ${marca} ${i.title}  [${i.type}]`);
      console.log(`       ${i.acceptanceCriteria.slice(0, 100)}`);
      if (i.verifyStatus !== "verified" && i.verifyScore != null) {
        console.log(`       Jev ${i.verifyScore.toFixed(2)}`);
      }
    }
    console.log("");
  }
}

const accion = args[0];

if (accion === "show") {
  const ultima = db.select().from(rubric).orderBy(desc(rubric.createdAt)).all()[0];
  if (!ultima) {
    console.log("No hay rúbricas todavía. npm run rubric");
    process.exit(0);
  }
  mostrar(ultima.id);
} else if (accion === "show-id") {
  const id = valor("--id");
  if (!id) throw new Error("Falta --id");
  mostrar(id);
} else {
  const r = createRubric(
    { db, ...(valor("--meeting") ? { meetingId: valor("--meeting")! } : {}) },
    {
      ...(valor("--week") ? { weekStart: valor("--week")! } : {}),
      ...(valor("--deadline") ? { deadline: valor("--deadline")! } : {}),
    }
  );

  console.log(
    r.reutilizada
      ? `Se sumaron ${r.adjuntos} tema(s) al borrador existente.`
      : `Rúbrica creada: ${r.weekStart} · v${r.version} · ${r.adjuntos} tema(s)`
  );
  console.log(`  entrega: ${r.deadline}`);
  for (const t of r.topics) console.log(`  · ${t.title}`);
  console.log(`\nDesglosar: npm run items -- --topic <id>`);
}
