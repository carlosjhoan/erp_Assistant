import test from "node:test";
import assert from "node:assert/strict";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { openDatabase } from "../src/infra/db/client.ts";
import { meeting, rubric, rubricItem, itemEvent, topic } from "../src/infra/db/schema.ts";

function baseMigrada() {
  const { sqlite, db } = openDatabase(":memory:");
  migrate(db, { migrationsFolder: "./drizzle" });
  // los inserts de drizzle son perezosos: se ejecutan con .run()
  const ins = (tabla: Parameters<typeof db.insert>[0], valores: unknown) =>
    (db.insert(tabla) as any).values(valores).run();
  return { sqlite, db, ins };
}

const id = (p: string) => `${p}_${Math.random().toString(36).slice(2, 10)}`;

test("la migración crea las dieciocho tablas", () => {
  const { sqlite } = baseMigrada();
  const tablas = (sqlite.prepare("select name from sqlite_master where type='table' order by name").all() as { name: string }[])
    .map((r) => r.name)
    .filter((n) => !n.startsWith("sqlite_") && !n.startsWith("__drizzle"));

  assert.deepEqual(tablas, [
    "agent_run",
    "item_event",
    "llm_call",
    "meeting",
    "project",
    "project_capability",
    "project_diagnosis",
    "project_repository",
    "recipient",
    "repo",
    "report",
    "report_delivery",
    "rubric",
    "rubric_item",
    "rubric_source_meeting",
    "topic",
    "topic_project",
    "topic_repo",
  ]);
});

test("una reunión no se duplica al reimportar", () => {
  const { sqlite, ins } = baseMigrada();
  const ext = id("g");

  const fila = (title: string) => ({
    id: id("m"),
    source: "granola" as const,
    externalId: ext,
    title,
    occurredAt: new Date(),
    contentHash: "hash_x",
  });

  ins(meeting, fila("primera importación"));
  assert.throws(() => ins(meeting, fila("segunda importación")), /UNIQUE|constraint/i);

  assert.equal((sqlite.prepare("select count(*) as n from meeting").get() as { n: number }).n, 1);
});

test("no puede haber dos versiones iguales de la misma semana", () => {
  const { ins } = baseMigrada();
  const semana = "2026-11-09";

  ins(rubric, { id: id("r"), weekStart: semana, version: 1 });
  assert.throws(() => ins(rubric, { id: id("r"), weekStart: semana, version: 1 }), /UNIQUE|constraint/i);
  assert.doesNotThrow(() => ins(rubric, { id: id("r"), weekStart: semana, version: 2 }));
});

test("un evento sin ítem existente es rechazado (clave foránea)", () => {
  const { ins } = baseMigrada();
  assert.throws(
    () => ins(itemEvent, { id: id("e"), itemId: "no-existe", actorType: "human", kind: "note", body: "hola" }),
    /FOREIGN KEY|constraint/i
  );
});

test("una nota guarda de quién se tomó la información", () => {
  const { db, ins } = baseMigrada();
  const r = id("r");
  const i = id("i");

  ins(rubric, { id: r, weekStart: "2026-11-09", version: 1, status: "approved" });
  ins(rubricItem, {
    id: i,
    rubricId: r,
    title: "Levantar proceso de vanos",
    acceptanceCriteria: "Acta firmada y 14 vanos medidos",
    type: "contact",
    origin: "manual",
  });
  ins(itemEvent, {
    id: id("e"),
    itemId: i,
    actorType: "human",
    kind: "note",
    body: "Juan: el acta se firma en obra",
    sourcePerson: "Juan Pérez",
  });

  const notas = db.select().from(itemEvent).all();
  assert.equal(notas.length, 1);
  assert.equal(notas[0]?.sourcePerson, "Juan Pérez");
  assert.equal(notas[0]?.kind, "note");
});

test("los estados por defecto son los esperados", () => {
  const { db, ins } = baseMigrada();
  const i = id("i");
  const r = id("r");

  ins(rubric, { id: r, weekStart: "2026-11-16", version: 1 });
  ins(rubricItem, {
    id: i,
    rubricId: r,
    title: "x",
    acceptanceCriteria: "y",
    type: "code",
    origin: "agent",
  });

  const rubrica = db.select().from(rubric).all()[0];
  const item = db.select().from(rubricItem).all()[0];

  assert.equal(rubrica?.status, "draft");
  assert.equal(item?.status, "pending");
  assert.equal(item?.verifyStatus, "pending");
});

test("existe la tabla topic y un tema manual no necesita reunión", () => {
  const { sqlite, ins } = baseMigrada();
  const tablas = (sqlite.prepare("select name from sqlite_master where type='table'").all() as { name: string }[]).map(
    (r) => r.name
  );
  assert.ok(tablas.includes("topic"), "falta la tabla topic");

  ins(topic, { id: id("t"), title: "Tema a mano", origin: "manual" });

  const fila = sqlite.prepare("select * from topic").get() as { status: string; needs_review: number; meeting_id: string | null };
  assert.equal(fila.status, "proposed");
  assert.equal(fila.needs_review, 0);
  assert.equal(fila.meeting_id, null);
});

test("un tema fusionado apunta al destino y no se borra", () => {
  const { db, ins } = baseMigrada();
  const destino = id("t");
  const absorbido = id("t");
  ins(topic, { id: destino, title: "Destino", origin: "manual" });
  ins(topic, { id: absorbido, title: "Absorbido", origin: "manual", status: "discarded", mergedIntoTopicId: destino });

  const filas = db.select().from(topic).all();
  assert.equal(filas.length, 2);
  assert.equal(filas.find((f) => f.id === absorbido)?.mergedIntoTopicId, destino);
});

test("la rúbrica acepta deadline y el ítem guarda topic_id y human_edited", () => {
  const { db, ins } = baseMigrada();
  const r = id("r");
  const t = id("t");

  ins(rubric, { id: r, weekStart: "2026-11-16", version: 1, deadline: "2026-11-20" });
  ins(topic, { id: t, title: "Tema", origin: "manual", status: "selected", rubricId: r });
  ins(rubricItem, {
    id: id("i"),
    rubricId: r,
    topicId: t,
    title: "x",
    acceptanceCriteria: "y",
    type: "code",
    origin: "agent",
  });

  assert.equal(db.select().from(rubric).all()[0]?.deadline, "2026-11-20");
  const item = db.select().from(rubricItem).all()[0];
  assert.equal(item?.topicId, t);
  assert.equal(item?.humanEdited, false);
});
