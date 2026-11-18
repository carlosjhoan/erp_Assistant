import test from "node:test";
import assert from "node:assert/strict";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { openDatabase } from "../src/infra/db/client.ts";
import { meeting, project, repo, rubric, rubricItem, topic, topicRepo } from "../src/infra/db/schema.ts";
import { aceptarPropuestas, conReintentoRed, enParalelo, promptRepo } from "../src/app/broadcast.ts";
import { cambiarEstado } from "../src/app/triage.ts";

/* ---------- concurrencia ---------- */

test("enParalelo respeta el orden de los resultados", async () => {
  const r = await enParalelo([1, 2, 3, 4, 5], 2, async (n) => {
    await new Promise((res) => setTimeout(res, 5 - n));
    return n * 10;
  });
  assert.deepEqual(r, [10, 20, 30, 40, 50]);
});

test("enParalelo nunca supera el tope", async () => {
  let vivos = 0;
  let pico = 0;
  await enParalelo([1, 2, 3, 4, 5, 6], 2, async () => {
    vivos++;
    pico = Math.max(pico, vivos);
    await new Promise((r) => setTimeout(r, 10));
    vivos--;
  });
  assert.ok(pico <= 2, `pico ${pico}`);
});

/* ---------- reintento de red ---------- */

test("reintenta un fetch failed y devuelve el segundo resultado", async () => {
  let n = 0;
  const r = await conReintentoRed(async () => {
    n++;
    if (n === 1) throw new Error("fetch failed");
    return "ok";
  });
  assert.equal(r, "ok");
  assert.equal(n, 2);
});

test("no reintenta un error de contrato", async () => {
  let n = 0;
  await assert.rejects(
    () =>
      conReintentoRed(async () => {
        n++;
        throw new Error("La respuesta no cumplió el contrato");
      }),
    /contrato/
  );
  assert.equal(n, 1);
});

/* ---------- prompt ---------- */

test("el prompt del dependiente incluye lo que propuso el principal", () => {
  const repoBase = {
    id: "aaaaaaaa-1",
    nombre: "Front",
    proyecto: "P",
    description: "el front",
    keywords: [],
    exposes: [],
    consumes: ["Back"],
  };
  const back = { id: "bbbbbbbb-2", nombre: "Back", proyecto: "P", description: "la api", keywords: [], exposes: ["api:/x"], consumes: [] };

  const texto = promptRepo(
    { ...repoBase, papel: "dependiente" },
    { titulo: "Cambiar el contrato", descripcion: null, cita: null, contexto: null, reunion: null },
    [repoBase, back],
    [{ nombre: "Back", approach: "cambio el handler" }]
  );

  assert.match(texto, /LO QUE YA PROPUSO EL REPO PRINCIPAL/);
  assert.match(texto, /cambio el handler/);
  assert.match(texto, /NO MODIFIQUES NINGÚN ARCHIVO/);
});

test("el principal no recibe contexto de otros", () => {
  const r = { id: "aaaaaaaa-1", nombre: "Back", proyecto: "P", description: "la api", keywords: [], exposes: [], consumes: [] };
  const texto = promptRepo({ ...r, papel: "principal" }, { titulo: "X", descripcion: null, cita: null, contexto: null, reunion: null }, [r], []);
  assert.doesNotMatch(texto, /LO QUE YA PROPUSO/);
});

/* ---------- aprobación ---------- */

function entorno() {
  const { db } = openDatabase(":memory:");
  migrate(db, { migrationsFolder: "./drizzle" });

  db.insert(project).values({ id: "p1", name: "P", path: "/p" }).run();
  db.insert(repo).values({ id: "r1", projectId: "p1", name: "Front", path: "/p/front", keywords: [], exposes: [], consumes: [] }).run();
  db.insert(meeting)
    .values({ id: "m1", source: "granola", externalId: "g", title: "M", occurredAt: new Date(), contentHash: "h", summary: "x" })
    .run();
  db.insert(rubric).values({ id: "rb1", weekStart: "2026-11-16", version: 1, status: "draft" }).run();
  db.insert(topic)
    .values({ id: "t1", meetingId: "m1", title: "Alcance", origin: "manual", status: "selected", rubricId: "rb1" })
    .run();

  return { db };
}

const fila = (db: ReturnType<typeof entorno>["db"], over: Partial<typeof topicRepo.$inferInsert> = {}) =>
  db
    .insert(topicRepo)
    .values({
      id: "tr1",
      topicId: "t1",
      repoId: "r1",
      papel: "principal",
      status: "involucrado",
      surfaces: [],
      steps: [{ title: "Hacer algo concreto", acceptanceCriteria: "Documento firmado", surfaces: [] }],
      risks: [],
      ...over,
    })
    .run();

test("aceptar materializa los pasos como ítems vinculados al repo", () => {
  const { db } = entorno();
  fila(db);

  const r = aceptarPropuestas({ db }, "t1");

  assert.equal(r.materializados, 1);
  const item = db.select().from(rubricItem).all()[0];
  assert.equal(item?.repoId, "r1");
  assert.equal(item?.origin, "agent");
  assert.equal(item?.type, "code");
});

test("aceptar no vuelve a materializar lo ya aprobado", () => {
  const { db } = entorno();
  fila(db);
  aceptarPropuestas({ db }, "t1");
  const r = aceptarPropuestas({ db }, "t1");

  assert.equal(r.materializados, 0);
  assert.equal(db.select().from(rubricItem).all().length, 1);
});

test("aceptar omite un repo contaminado", () => {
  const { db } = entorno();
  fila(db, { contaminated: true });
  const r = aceptarPropuestas({ db }, "t1");
  assert.equal(r.materializados, 0);
  assert.match(r.omitidos[0] ?? "", /contaminado/);
});

test("aceptar omite un repo excluido", () => {
  const { db } = entorno();
  fila(db, { status: "excluido", steps: [] });
  assert.equal(aceptarPropuestas({ db }, "t1").materializados, 0);
});

test("aceptar exige que el tema esté seleccionado", () => {
  const { db } = entorno();
  const id = db.select().from(topic).all()[0]!.id;
  cambiarEstado({ db }, id, "parked");
  assert.throws(() => aceptarPropuestas({ db }, "t1"), /solo se materializan los seleccionados/);
});

test("aceptar exige rúbrica en borrador", () => {
  const { db } = entorno();
  fila(db);
  db.update(rubric).set({ status: "approved" }).where(eq(rubric.id, "rb1")).run();
  assert.throws(() => aceptarPropuestas({ db }, "t1"), /rúbrica está en "approved"/);
});

test("aceptar filtra por prefijo de repo", () => {
  const { db } = entorno();
  fila(db);
  const r = aceptarPropuestas({ db }, "t1", { repoPrefijo: "zzz" });
  assert.equal(r.materializados, 0);
  assert.equal(db.select().from(rubricItem).all().length, 0);
});
