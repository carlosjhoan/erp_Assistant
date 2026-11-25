import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { openDatabase } from "../src/infra/db/client.ts";
import { meeting, topic } from "../src/infra/db/schema.ts";
import { createTopicRepo } from "../src/infra/db/topic-repo.ts";
import { extractTopics } from "../src/app/extract-topics.ts";
import type { LlmProvider, DecisionProvider } from "../src/infra/llm/types.ts";
import type { ExtraccionTemas } from "../src/app/contracts.ts";

type Tema = ExtraccionTemas["topics"][number];

const APUNTE = "El cliente quiere activar la landing antes de fin de mes. Hay que medir los vanos del nivel 3.";

const tema = (title: string, over: Partial<Tema> = {}): Tema => ({
  title,
  description: "Descripción del tema que se habló en la reunión con el cliente.",
  sourceExcerpt: "El cliente quiere activar la landing antes de fin de mes",
  scopeSignal: "likely_scope",
  scopeReason: "Hay una fecha comprometida",
  ...over,
});

function entorno(respuesta: Partial<ExtraccionTemas> = {}, scores: Record<string, number> = {}) {
  const { db } = openDatabase(":memory:");
  migrate(db, { migrationsFolder: "./drizzle" });

  db.insert(meeting)
    .values({
      id: "m1",
      source: "granola",
      externalId: "g1",
      title: "Landing page activation plan",
      occurredAt: new Date("2026-11-13T16:28:03Z"),
      contentHash: "h1",
      summary: APUNTE,
    })
    .run();

  let llamadas = 0;
  const llm: LlmProvider = {
    async generate<T>(): Promise<{ data: T; model: string; tokens: number; durationMs: number; intentos: number; fallos: [] }> {
      llamadas++;
      return {
        data: { topics: [], ...respuesta } as unknown as T,
        model: "deepseek-flash",
        tokens: 1200,
        durationMs: 8000,
        intentos: 1,
        fallos: [],
      };
    },
    async agent() {
      throw new Error("agent no implementado en el fake");
    },
  };

  let preguntasHechas: string[] = [];
  const decision: DecisionProvider = {
    async decide(_state, questions) {
      preguntasHechas = questions.map((q) => q.name);
      return { scores, model: "jev-1.14.0", tokens: 300, durationMs: 150 };
    },
  };

  return {
    db,
    llm,
    decision,
    repo: createTopicRepo(db),
    llamadas: () => llamadas,
    preguntas: () => preguntasHechas,
  };
}

test("extrae los temas y los deja todos en proposed", async () => {
  const e = entorno(
    { topics: [tema("Activar la landing"), tema("Medir los vanos")] },
    { tema_0: 0.95, tema_1: 0.9 }
  );

  const r = await extractTopics(e, "m1");

  assert.equal(r.extracted, 2);
  assert.equal(r.needsReview, 0);
  const filas = e.db.select().from(topic).all();
  assert.equal(filas.length, 2);
  assert.ok(filas.every((f) => f.status === "proposed"));
  assert.ok(filas.every((f) => f.origin === "agent"));
});

test("Jev recibe una pregunta por tema, en una sola llamada", async () => {
  const e = entorno(
    { topics: [tema("Uno"), tema("Dos"), tema("Tres")] },
    { tema_0: 0.9, tema_1: 0.9, tema_2: 0.9 }
  );
  await extractTopics(e, "m1");
  // grounding + tres preguntas de dueño por tema
  assert.equal(e.preguntas().filter((p) => p.startsWith("tema_")).length, 3);
  assert.equal(e.preguntas().length, 12);
});

test("un tema que la reunión no trató queda en revisión, pero se guarda", async () => {
  const e = entorno({ topics: [tema("Activar la landing"), tema("Contratar agencia")] }, { tema_0: 0.92, tema_1: 0.08 });

  const r = await extractTopics(e, "m1");

  assert.equal(r.needsReview, 1);
  const filas = e.db.select().from(topic).all();
  assert.equal(filas.length, 2, "no se descarta en silencio");
  const sospechoso = filas.find((f) => f.title === "Contratar agencia");
  assert.equal(sospechoso?.needsReview, true);
  assert.equal(sospechoso?.verifyScore, 0.08);
});

test("si Jev no responde un tema, va a revisión", async () => {
  const e = entorno({ topics: [tema("Uno"), tema("Dos")] }, { tema_0: 0.99 });
  const r = await extractTopics(e, "m1");
  assert.equal(r.needsReview, 1);
  assert.equal(r.topics.find((t) => t.title === "Dos")?.score, 0);
});

test("reejecutar reemplaza los proposed y no duplica", async () => {
  const e = entorno({ topics: [tema("Uno"), tema("Dos")] }, { tema_0: 0.9, tema_1: 0.9 });
  await extractTopics(e, "m1");
  const r = await extractTopics(e, "m1");

  assert.equal(r.extracted, 2);
  assert.equal(r.replaced, 2);
  assert.equal(e.db.select().from(topic).all().length, 2);
});

test("un tema ya decidido sobrevive a la reextracción", async () => {
  const e = entorno({ topics: [tema("Uno"), tema("Dos")] }, { tema_0: 0.9, tema_1: 0.9 });
  await extractTopics(e, "m1");

  const elegido = e.db.select().from(topic).all().find((t) => t.title === "Uno")!;
  e.db.update(topic).set({ status: "selected" }).where(eq(topic.id, elegido.id)).run();

  const r = await extractTopics(e, "m1");

  assert.equal(r.kept, 1);
  const filas = e.db.select().from(topic).all();
  assert.equal(filas.filter((f) => f.status === "selected").length, 1, "el decidido sigue ahí");
  assert.equal(filas.filter((f) => f.status === "proposed").length, 2, "los demás se regeneraron");
});

test("cero temas: borra los proposed viejos y devuelve la razón", async () => {
  const e = entorno({ topics: [tema("Uno")] }, { tema_0: 0.9 });
  await extractTopics(e, "m1");
  assert.equal(e.db.select().from(topic).all().length, 1);

  const e2 = entorno({
    topics: [],
    emptyReason: "La charla giró en torno a temas cotidianos.",
    conversationTopics: ["Leads del mes pasado", "Reunión del miércoles"],
  });
  const r = await extractTopics(e2, "m1");

  assert.equal(r.extracted, 0);
  assert.equal(r.empty?.reason, "La charla giró en torno a temas cotidianos.");
  assert.deepEqual(r.empty?.conversationTopics, ["Leads del mes pasado", "Reunión del miércoles"]);
  assert.equal(e2.db.select().from(topic).all().length, 0);
});

test("una reunión sin summary falla sin llamar al modelo", async () => {
  const e = entorno();
  e.db.update(meeting).set({ summary: null }).where(eq(meeting.id, "m1")).run();

  await assert.rejects(() => extractTopics(e, "m1"), /no tiene summary/);
  assert.equal(e.llamadas(), 0);
});

test("títulos repetidos quedan en uno", async () => {
  const e = entorno({ topics: [tema("Activar la landing"), tema("ACTIVAR LA LANDING")] }, { tema_0: 0.9 });
  const r = await extractTopics(e, "m1");
  assert.equal(r.extracted, 1);
});

test("el triaje incompleto se puede consultar por título", async () => {
  const e = entorno({ topics: [tema("Uno"), tema("Dos")] }, { tema_0: 0.9, tema_1: 0.9 });
  await extractTopics(e, "m1");

  assert.deepEqual(
    e.repo.triajeIncompleto("m1").sort(),
    ["Dos", "Uno"]
  );
});
