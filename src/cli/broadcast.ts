/**
 * npm run broadcast -- --topic <id>                difunde el alcance a los repos
 * npm run broadcast -- --topic <id> --show         muestra las propuestas guardadas
 * npm run broadcast -- --topic <id> --accept       materializa en ítems
 * npm run broadcast -- --topic <id> --accept --repo <prefijo>
 */
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { openDatabase } from "../infra/db/client.ts";
import { repo as repoTable, topic, topicRepo } from "../infra/db/schema.ts";
import { providersFromEnv } from "../infra/llm/providers.ts";
import { workerFromEnv } from "../infra/opencode/worker.ts";
import { aceptarPropuestas, broadcast } from "../app/broadcast.ts";

const { db } = openDatabase(process.env.DATABASE_PATH ?? "./data/my_erp.db");
migrate(db, { migrationsFolder: "./drizzle" });

const args = process.argv.slice(2);
const valor = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};

function resolverTema(prefijo: string) {
  const encontrados = db.select().from(topic).all().filter((t) => t.id.startsWith(prefijo));
  if (encontrados.length === 0) throw new Error(`No encontré el tema "${prefijo}".`);
  if (encontrados.length > 1) throw new Error(`"${prefijo}" coincide con varios temas.`);
  return encontrados[0]!;
}

function nombreDe(repoId: string) {
  return db.select().from(repoTable).where(eq(repoTable.id, repoId)).get()?.name ?? repoId.slice(0, 8);
}

function mostrar(topicId: string) {
  const filas = db.select().from(topicRepo).where(eq(topicRepo.topicId, topicId)).all();
  if (filas.length === 0) {
    console.log("No hay propuestas guardadas. Corré el broadcast primero.");
    return;
  }

  for (const f of filas) {
    const marca = f.status === "involucrado" ? "✓" : f.status === "excluido" ? "—" : "✗";
    const aprobado = f.approvedAt ? " · aprobado" : "";
    console.log(`\n${marca} ${nombreDe(f.repoId)}  [${f.papel}] ${f.status}${aprobado}`);
    if (f.reason) console.log(`   ${f.reason.slice(0, 160)}`);
    if (f.approach) console.log(`   enfoque: ${f.approach.slice(0, 200)}`);
    if (f.surfaces.length > 0) console.log(`   superficies: ${f.surfaces.join(", ")}`);
    if (f.steps.length > 0) {
      f.steps.forEach((p, i) => {
        console.log(`   ${i + 1}. ${p.title}`);
        console.log(`      ✓ ${p.acceptanceCriteria.slice(0, 110)}`);
      });
    }
    if (f.contaminated) console.log(`   ⚠ EL AGENTE MODIFICÓ EL REPO — resultado no aceptable`);
    if (f.error) console.log(`   ⚠ ${f.error.slice(0, 200)}`);
  }

  // Colisiones de superficie entre repos
  const porSuperficie = new Map<string, string[]>();
  for (const f of filas.filter((x) => x.status === "involucrado")) {
    for (const s of f.surfaces) {
      porSuperficie.set(s, [...(porSuperficie.get(s) ?? []), nombreDe(f.repoId)]);
    }
  }
  const choques = [...porSuperficie.entries()].filter(([, r]) => r.length > 1);

  if (choques.length > 0) {
    console.log("\n⚠ Superficies compartidas por más de un repo:");
    for (const [s, r] of choques) console.log(`   ${s}: ${r.join(", ")}`);
  }
}

async function main() {
  const idPedido = valor("--topic");
  if (!idPedido) throw new Error("Indicá --topic <id>.");

  const tema = resolverTema(idPedido);

  if (args.includes("--show")) {
    mostrar(tema.id);
    return;
  }

  if (args.includes("--accept")) {
    const r = aceptarPropuestas({ db }, tema.id, valor("--repo") ? { repoPrefijo: valor("--repo")! } : {});
    console.log(`${r.materializados} ítem(s) materializados en la rúbrica`);
    for (const x of r.repos) console.log(`  · ${x.nombre}: ${x.items} ítem(s)`);
    if (r.omitidos.length > 0) {
      console.log("\nOmitidos:");
      for (const o of r.omitidos) console.log(`  · ${o}`);
    }
    if (r.materializados > 0) console.log("\nVer: npm run rubric -- show");
    return;
  }

  console.log(`Difundiendo alcance: ${tema.title}\n`);

  const r = await broadcast({ db, ...providersFromEnv(db), worker: workerFromEnv() }, tema.id);

  for (const rep of r.repos) {
    const marca = rep.status === "involucrado" ? "✓" : rep.status === "excluido" ? "—" : "✗";
    const extra = rep.status === "involucrado" ? `${rep.pasos} paso(s)` : rep.status;
    console.log(`${marca} ${rep.nombre.padEnd(26)} [${rep.papel}] ${extra}  · ${rep.tokens} tok · ${(rep.durationMs / 1000).toFixed(1)} s`);
    if (rep.reason) console.log(`   ${rep.reason.slice(0, 180)}`);
    if (rep.contaminado) console.log(`   ⚠ EL AGENTE MODIFICÓ EL REPO — resultado rechazado`);
    if (rep.error) console.log(`   ⚠ ${rep.error.slice(0, 200)}`);
  }

  if (r.dudas.length > 0) {
    console.log("\nDudas del modelo:");
    for (const d of r.dudas) console.log(`  · ${d}`);
  }

  console.log("\nRevisar:  npm run broadcast -- --topic " + tema.id.slice(0, 8) + " --show");
}

main().catch((e) => {
  console.error(`\n${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
