import { eq } from "drizzle-orm";
import test from "node:test";
import assert from "node:assert/strict";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { openDatabase } from "../src/infra/db/client.ts";
import { meeting, rubric, rubricItem, rubricSourceMeeting, topic } from "../src/infra/db/schema.ts";
import { createTopicRepo } from "../src/infra/db/topic-repo.ts";
import { aprobarRubrica, createRubric, lunesDe, semanaSiguiente, viernesDe } from "../src/app/create-rubric.ts";
import { generateItems } from "../src/app/generate-items.ts";
import { cambiarEstado, deshacerDecision } from "../src/app/triage.ts";
import { derivarEstado } from "../src/app/meeting-status.ts";
import type { DecisionProvider, LlmProvider } from "../src/infra/llm/types.ts";

const APUNTE =
  "El cliente quiere activar la landing antes de fin de mes. Hay que medir los vanos del nivel 3. Carlos coordina con Manuel.";

function entorno() {
  const { db } = openDatabase(":memory:");
  migrate(db, { migrationsFolder: "./drizzle" });

  db.insert(meeting)
    .values({
      id: "m1",
      source: "granola",
      externalId: "g1",
      title: "Landing",
      occurredAt: new Date("2026-11-13T16:28:03Z"), // viernes
      contentHash: "h",
      summary: APUNTE,
    })
    .run();

  const repo = createTopicRepo(db);
  const tema = (title: string, status: "proposed" | "selected" | "parked" | "discarded" = "proposed") =>
    repo.crearManual({ meetingId: "m1", title, status });

  return { db, repo, tema };
}

const ITEMS = [
  {
    title: "Medir los vanos del nivel 3",
    acceptanceCriteria: "Acta firmada con las 14 medidas",
    suggestedType: "contact" as const,
    sourceExcerpt: "Hay que medir los vanos del nivel 3",
  },
  {
    title: "Publicar la landing",
    acceptanceCriteria: "URL pública respondiendo 200",
    suggestedType: "code" as const,
    sourceExcerpt: "activar la landing antes de fin de mes",
  },
];

function proveedores(items = ITEMS, scores?: Record<string, number>) {
  const llm: LlmProvider = {
    async generate<T>() {
      return {
        data: { items } as unknown as T,
        model: "deepseek-flash",
        tokens: 1000,
        durationMs: 5000,
        intentos: 1,
        fallos: [],
      };
    },
  };
  const decision: DecisionProvider = {
    async decide(_state, questions) {
      const s: Record<string, number> = {};
      for (const q of questions) s[q.name] = scores?.[q.name] ?? 0.9;
      return { scores: s, model: "jev-1.14.0", tokens: 100, durationMs: 150 };
    },
  };
  return { llm, decision };
}

/* ---------- fechas ---------- */

test("la semana de trabajo es la siguiente a la reunión", () => {
  assert.equal(lunesDe(new Date("2026-11-13T12:00:00Z")), "2026-11-09");
  assert.equal(semanaSiguiente(new Date("2026-11-13T12:00:00Z")), "2026-11-16");
});

test("el deadline por defecto es el viernes de esa semana", () => {
  assert.equal(viernesDe("2026-11-16"), "2026-11-20");
});

/* ---------- creación ---------- */

test("crea la rúbrica con los temas seleccionados", () => {
  const { db, tema } = entorno();
  const a = tema("Uno");
  const b = tema("Dos");
  cambiarEstado({ db }, a, "selected");
  cambiarEstado({ db }, b, "selected");

  const r = createRubric({ db });

  assert.equal(r.adjuntos, 2);
  assert.equal(r.weekStart, "2026-11-16");
  assert.equal(r.deadline, "2026-11-20");
  assert.equal(r.status, "draft");
});

test("no crea la rúbrica si queda algo sin calificar", () => {
  const { db, tema } = entorno();
  cambiarEstado({ db }, tema("Uno"), "selected");
  tema("Pendiente");

  assert.throws(() => createRubric({ db }), /Te faltan 1 tema/);
});

test("sin temas seleccionados no hay rúbrica", () => {
  const { db, tema } = entorno();
  cambiarEstado({ db }, tema("Uno"), "parked");
  assert.throws(() => createRubric({ db }), /No hay temas seleccionados/);
});

test("los temas quedan enlazados y la reunión de origen registrada", () => {
  const { db, tema } = entorno();
  cambiarEstado({ db }, tema("Uno"), "selected");

  const r = createRubric({ db });

  const t = db.select().from(topic).all()[0];
  assert.equal(t?.rubricId, r.rubricId);
  assert.equal(db.select().from(rubricSourceMeeting).all().length, 1);
});

test("si ya hay borrador, se le adjuntan los temas nuevos", () => {
  const { db, tema } = entorno();
  const a = tema("Uno");
  cambiarEstado({ db }, a, "selected");

  const primera = createRubric({ db });
  assert.equal(primera.reutilizada, false);
  assert.equal(primera.adjuntos, 1);

  const b = tema("Dos");
  cambiarEstado({ db }, b, "selected");
  const segunda = createRubric({ db });

  assert.equal(segunda.reutilizada, true);
  assert.equal(segunda.rubricId, primera.rubricId);
  assert.equal(segunda.adjuntos, 1);
  assert.equal(db.select().from(rubric).all().length, 1);
});

test("una rúbrica aprobada ya no recibe temas: se crea otra versión", () => {
  const { db, tema } = entorno();
  const a = tema("Uno");
  cambiarEstado({ db }, a, "selected");
  const primera = createRubric({ db });

  db.update(rubric).set({ status: "approved" }).where(eq(rubric.id, primera.rubricId)).run();

  const b = tema("Dos");
  cambiarEstado({ db }, b, "selected");
  const segunda = createRubric({ db });

  assert.notEqual(segunda.rubricId, primera.rubricId);
  assert.equal(segunda.version, 2);

  const nueva = db.select().from(rubric).where(eq(rubric.id, segunda.rubricId)).get();
  assert.equal(nueva?.parentRubricId, primera.rubricId);
});

test("se puede fijar la semana y el deadline", () => {
  const { db, tema } = entorno();
  cambiarEstado({ db }, tema("Uno"), "selected");
  const r = createRubric({ db }, { weekStart: "2026-12-07", deadline: "2026-12-11" });
  assert.equal(r.weekStart, "2026-12-07");
  assert.equal(r.deadline, "2026-12-11");
});

/* ---------- desglose ---------- */

test("desglosa un tema seleccionado en ítems", async () => {
  const { db, tema } = entorno();
  const id = tema("Uno");
  cambiarEstado({ db }, id, "selected");
  createRubric({ db });

  const r = await generateItems({ db, ...proveedores() }, id);

  assert.equal(r.generated, 2);
  assert.equal(r.needsReview, 0);
  const filas = db.select().from(rubricItem).all();
  assert.ok(filas.every((f) => f.topicId === id));
  assert.ok(filas.every((f) => f.origin === "agent"));
});

test("no desglosa un tema que no está seleccionado", async () => {
  const { db, tema } = entorno();
  const id = tema("Uno");
  await assert.rejects(() => generateItems({ db, ...proveedores() }, id), /solo se desglosan los temas seleccionados/);
});

test("un ítem sin respaldo en el apunte queda en revisión", async () => {
  const { db, tema } = entorno();
  const id = tema("Uno");
  cambiarEstado({ db }, id, "selected");
  createRubric({ db });

  const r = await generateItems({ db, ...proveedores(ITEMS, { respaldado_0: 0.1 }) }, id);

  assert.equal(r.needsReview, 1);
  const malo = db.select().from(rubricItem).all().find((f) => f.title === ITEMS[0]!.title);
  assert.equal(malo?.verifyStatus, "needs_review");
});

test("regenerar no pisa lo editado a mano", async () => {
  const { db, tema } = entorno();
  const id = tema("Uno");
  cambiarEstado({ db }, id, "selected");
  createRubric({ db });

  await generateItems({ db, ...proveedores() }, id);
  const mio = db.select().from(rubricItem).all()[0]!;
  db.update(rubricItem).set({ humanEdited: true, title: "Editado por mí" }).where(eq(rubricItem.id, mio.id)).run();

  const r = await generateItems({ db, ...proveedores() }, id);

  const filas = db.select().from(rubricItem).all();
  assert.ok(filas.some((f) => f.id === mio.id), "el ítem editado sobrevive");
  assert.equal(r.replaced, 1, "solo se reemplazó el otro");
});

test("las posiciones quedan corridas después de regenerar", async () => {
  const { db, tema } = entorno();
  const a = tema("Uno");
  const b = tema("Dos");
  cambiarEstado({ db }, a, "selected");
  cambiarEstado({ db }, b, "selected");
  const r = createRubric({ db });

  await generateItems({ db, ...proveedores() }, a);
  await generateItems({ db, ...proveedores() }, b);
  await generateItems({ db, ...proveedores() }, a);

  const filas = db.select().from(rubricItem).all();
  const posiciones = filas.map((f) => f.position).sort((x, y) => x - y);
  assert.deepEqual(posiciones, [0, 1, 2, 3]);
  assert.ok(r.rubricId);
});

test("la corrida queda registrada en agent_run", async () => {
  const { db, tema } = entorno();
  const id = tema("Uno");
  cambiarEstado({ db }, id, "selected");
  createRubric({ db });
  await generateItems({ db, ...proveedores() }, id);

  const runs = db.select().from(rubricItem).all();
  assert.ok(runs.length > 0);
});

test("no se aprueba una rúbrica con un tema sin ítems", () => {
  const { db, tema } = entorno();
  const a = tema("Con ítems");
  const b = tema("Sin ítems");
  cambiarEstado({ db }, a, "selected");
  cambiarEstado({ db }, b, "selected");

  const r = createRubric({ db });
  // se desglosa solo el primero
  const i = db.select().from(rubricItem).all();
  assert.equal(i.length, 0);

  assert.throws(
    () => aprobarRubrica({ db }, r.rubricId),
    (e: Error) => {
      assert.match(e.message, /Faltan desglosar 2 tema/);
      return true;
    }
  );
});

test("con todos los temas desglosados, aprueba", async () => {
  const { db, tema } = entorno();
  const id = tema("Uno");
  cambiarEstado({ db }, id, "selected");
  const r = createRubric({ db });
  await generateItems({ db, ...proveedores() }, id);

  const a = aprobarRubrica({ db }, r.rubricId);

  assert.equal(a.items, 2);
  assert.equal(db.select().from(rubric).where(eq(rubric.id, r.rubricId)).get()?.status, "approved");
});

test("una rúbrica aprobada no se aprueba dos veces", async () => {
  const { db, tema } = entorno();
  const id = tema("Uno");
  cambiarEstado({ db }, id, "selected");
  const r = createRubric({ db });
  await generateItems({ db, ...proveedores() }, id);
  aprobarRubrica({ db }, r.rubricId);

  assert.throws(() => aprobarRubrica({ db }, r.rubricId), /ya está en "approved"/);
});

/* ---------- estado de la reunión ---------- */

test("el estado de la reunión se deriva de sus temas", () => {
  const { db, tema } = entorno();
  assert.equal(derivarEstado(db, "m1"), "imported");

  const a = tema("Uno");
  assert.equal(derivarEstado(db, "m1"), "topics_extracted");

  cambiarEstado({ db }, a, "selected");
  assert.equal(derivarEstado(db, "m1"), "triaged");
});

test("deshacer una decisión devuelve la reunión a topics_extracted", () => {
  const { db, tema } = entorno();
  const a = tema("Uno");
  cambiarEstado({ db }, a, "selected");
  assert.equal(derivarEstado(db, "m1"), "triaged");

  deshacerDecision({ db }, a);
  assert.equal(derivarEstado(db, "m1"), "topics_extracted");
});
