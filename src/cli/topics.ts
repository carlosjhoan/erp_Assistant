/**
 * La bandeja de triaje en la terminal.
 *
 *   npm run topics                        lista lo que falta calificar
 *   npm run topics -- select a1b2         selecciona
 *   npm run topics -- park a1b2           archiva como idea
 *   npm run topics -- discard a1b2        descarta
 *   npm run topics -- undo a1b2           deshace un descarte
 *   npm run topics -- edit a1b2 --title "..." --description "..."
 *   npm run topics -- merge a1b2,c3d4 --into e5f6
 *   npm run topics -- new --title "..." [--meeting <id>]
 *   npm run topics -- ideas               archivo de ideas
 *   npm run topics -- promote a1b2 --rubric <id>
 */
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { openDatabase } from "../infra/db/client.ts";
import { rubric, topic } from "../infra/db/schema.ts";
import { createTopicRepo } from "../infra/db/topic-repo.ts";
import { cambiarEstado, crear, editar, fusionar, pendientesDeTriaje } from "../app/triage.ts";

const { db } = openDatabase(process.env.DATABASE_PATH ?? "./data/my_erp.db");
migrate(db, { migrationsFolder: "./drizzle" });

const args = process.argv.slice(2);
const accion = args[0] ?? "list";
const resto = args.slice(1);

function valor(nombre: string): string | undefined {
  const i = resto.indexOf(nombre);
  return i >= 0 ? resto[i + 1] : undefined;
}

function idsDe(arg: string | undefined): string[] {
  return (arg ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

function corto(id: string) {
  return id.slice(0, 8);
}

function listar() {
  const filas = createTopicRepo(db).bandeja();

  if (filas.length === 0) {
    console.log("No hay temas sin calificar. La bandeja está limpia.");
    return;
  }

  console.log(`${filas.length} tema(s) por calificar:\n`);

  let reunion = "";
  for (const f of filas) {
    const tituloReunion = f.meetingTitle ?? "sin reunión";
    if (tituloReunion !== reunion) {
      reunion = tituloReunion;
      const fecha = f.occurredAt ? f.occurredAt.toISOString().slice(0, 10) : "";
      console.log(`── ${reunion}${fecha ? ` · ${fecha}` : ""}`);
    }

    const señal = f.scopeSignal === "likely_scope" ? "alcance" : "idea   ";
    const jev = f.verifyScore != null ? `jev ${f.verifyScore.toFixed(2)}` : "jev  —  ";
    const aviso = f.needsReview ? " ⚠" : "";
    console.log(`  [${corto(f.id)}] ${señal}  ${jev}${aviso}  ${f.title}`);
    if (f.description) console.log(`              ${f.description.slice(0, 120)}`);
    if (f.needsReview) console.log(`              ⚠ Jev duda de que esto se haya hablado`);
  }

  console.log("\nPara calificar:  npm run topics -- select|park|discard <id>");
}

function ideas() {
  const filas = createTopicRepo(db).ideas();
  if (filas.length === 0) {
    console.log("El archivo de ideas está vacío.");
    return;
  }
  console.log(`${filas.length} idea(s) aparcada(s):\n`);
  for (const f of filas) {
    console.log(`  [${corto(f.id)}] ${f.title}`);
    if (f.description) console.log(`              ${f.description.slice(0, 120)}`);
  }
  console.log("\nPara llevarla a una rúbrica:  npm run topics -- promote <id> --rubric <id>");
}

function promover(prefijo: string | undefined, rubricId: string | undefined) {
  if (!prefijo) throw new Error("Falta el id del tema.");
  if (!rubricId) throw new Error("Falta --rubric <id>: una idea se promueve a una rúbrica en borrador.");

  const r = db.select().from(rubric).where(eq(rubric.id, rubricId)).get();
  if (!r) throw new Error(`No existe la rúbrica ${rubricId}.`);
  if (r.status !== "draft") throw new Error(`La rúbrica está en "${r.status}": solo se promueve a una en borrador.`);

  const t = createTopicRepo(db).buscar(prefijo);
  if (t.length !== 1) throw new Error(`"${prefijo}" no identifica un tema solo.`);

  db.update(topic).set({ status: "selected", rubricId, decidedAt: new Date(), decidedBy: "yo" }).where(eq(topic.id, t[0]!.id)).run();
  console.log(`Promovido a la rúbrica ${r.weekStart}: ${t[0]!.title}`);
}

function main() {
  const ctx = { db };

  switch (accion) {
    case "list":
      listar();
      return;

    case "select":
    case "park":
    case "discard":
    case "undo": {
      const mapa = { select: "selected", park: "parked", discard: "discarded", undo: "proposed" } as const;
      const id = resto[0];
      if (!id) throw new Error(`Falta el id. Ej: npm run topics -- ${accion} a1b2`);
      const r = cambiarEstado(ctx, id, mapa[accion]);
      console.log(`${r.title}: ${r.desde} → ${r.hacia}`);
      const quedan = pendientesDeTriaje(ctx).length;
      console.log(quedan === 0 ? "\nBandeja limpia." : `\nQuedan ${quedan} por calificar.`);
      return;
    }

    case "edit": {
      const id = resto[0];
      if (!id) throw new Error("Falta el id.");
      const r = editar(ctx, id, {
        ...(valor("--title") ? { title: valor("--title")! } : {}),
        ...(valor("--description") ? { description: valor("--description")! } : {}),
      });
      console.log(`Editado: ${r.title}`);
      return;
    }

    case "merge": {
      const origenes = idsDe(resto[0]);
      const destino = valor("--into");
      if (origenes.length === 0 || !destino) throw new Error("Uso: merge <id1,id2> --into <id>");
      const r = fusionar(ctx, origenes, destino);
      console.log(`Fusionados en "${r.destino.title}":`);
      for (const a of r.absorbidos) console.log(`  · ${a.title} → descartado`);
      return;
    }

    case "new": {
      const title = valor("--title");
      if (!title) throw new Error('Falta --title "..."');
      const id = crear(ctx, {
        ...(valor("--meeting") ? { meetingId: valor("--meeting")! } : {}),
        title,
        ...(valor("--description") ? { description: valor("--description")! } : {}),
      });
      console.log(`Creado [${corto(id)}] ${title}`);
      return;
    }

    case "ideas":
      ideas();
      return;

    case "promote":
      promover(resto[0], valor("--rubric"));
      return;

    default:
      console.log(`Acción desconocida: "${accion}". Opciones: list, select, park, discard, undo, edit, merge, new, ideas, promote.`);
      process.exit(1);
  }
}

try {
  main();
} catch (e) {
  console.error(`\n${e instanceof Error ? e.message : e}`);
  process.exit(1);
}
