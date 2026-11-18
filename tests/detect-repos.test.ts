import test from "node:test";
import assert from "node:assert/strict";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { openDatabase } from "../src/infra/db/client.ts";
import { agentRun, meeting, project, repo, topic } from "../src/infra/db/schema.ts";
import { detectarRepos, porKeywords, catalogo, DeteccionError } from "../src/app/detect-repos.ts";
import { serializarRepos } from "../src/app/repo-harness.ts";
import type { LlmProvider } from "../src/infra/llm/types.ts";

function entorno() {
  const { db } = openDatabase(":memory:");
  migrate(db, { migrationsFolder: "./drizzle" });

  db.insert(project).values({ id: "p1", name: "Comercial", path: "/x/comercial" }).run();

  const rep = (id: string, name: string, kw: string[], consumes: string[] = [], exposes: string[] = []) =>
    db
      .insert(repo)
      .values({
        id,
        projectId: "p1",
        name,
        path: `/x/comercial/${name}`,
        description: `${name} hace cosas de ${kw.join(" y ")}`,
        keywords: kw,
        consumes,
        exposes,
      })
      .run();

  rep("aaaaaaaa-1", "Cotizador_Backend", ["backend", "precotizacion", "precio"], [], ["api:/api/public/experience-submissions"]);
  rep("bbbbbbbb-2", "Cotizador_AI2", ["ia", "similitud", "documento"], ["Cotizador_Backend"]);
  rep("cccccccc-3", "SnG_Consulter", ["consulter", "plano"], []);

  db.insert(meeting)
    .values({ id: "m1", source: "granola", externalId: "g", title: "Landing", occurredAt: new Date(), contentHash: "h", summary: "x" })
    .run();

  db.insert(topic)
    .values({ id: "t1", meetingId: "m1", title: "Cambiar el contrato de precios", description: "Ajustar la precotizacion", origin: "manual", status: "selected" })
    .run();

  return { db };
}

function llmFalso(respuesta: unknown): LlmProvider {
  return {
    async generate<T>() {
      return {
        data: respuesta as T,
        model: "deepseek-flash",
        tokens: 800,
        durationMs: 3000,
        intentos: 1,
        fallos: [],
      };
    },
  };
}

const OK = {
  repos: [
    { repoId: "aaaaaaaa", papel: "principal", motivo: "El contrato nace acá" },
    { repoId: "bbbbbbbb", papel: "dependiente", motivo: "Consume el contrato" },
  ],
  excluidos: [{ repoId: "cccccccc", motivo: "Herramienta interna sin acoplamiento" }],
};

test("conserva los repos elegidos y su papel", async () => {
  const { db } = entorno();
  const r = await detectarRepos({ db, llm: llmFalso(OK) }, "t1");

  assert.equal(r.repos.length, 2);
  assert.equal(r.repos[0]?.papel, "principal");
  assert.equal(r.repos[1]?.papel, "dependiente");
  assert.equal(r.fallback, false);
});

test("mapea los excluidos con nombre legible", async () => {
  const { db } = entorno();
  const r = await detectarRepos({ db, llm: llmFalso(OK) }, "t1");
  assert.equal(r.excluidos.length, 1);
  assert.equal(r.excluidos[0]?.nombre, "SnG_Consulter");
});

test("descarta ids inventados y conserva los válidos", async () => {
  const { db } = entorno();
  const r = await detectarRepos(
    {
      db,
      llm: llmFalso({
        repos: [
          { repoId: "aaaaaaaa", papel: "principal", motivo: "ok" },
          { repoId: "zzzzzzzz", papel: "principal", motivo: "inventado" },
        ],
      }),
    },
    "t1"
  );

  assert.equal(r.repos.length, 1);
  assert.deepEqual(r.invalidos, ["zzzzzzzz"]);
});

test("no repite un repo que viene dos veces", async () => {
  const { db } = entorno();
  const r = await detectarRepos(
    {
      db,
      llm: llmFalso({
        repos: [
          { repoId: "aaaaaaaa", papel: "principal", motivo: "primero" },
          { repoId: "aaaaaaaa", papel: "dependiente", motivo: "repetido" },
        ],
      }),
    },
    "t1"
  );
  assert.equal(r.repos.length, 1);
  assert.equal(r.repos[0]?.papel, "principal");
});

test("si todos los ids son inválidos, cae a palabras clave y lo declara", async () => {
  const { db } = entorno();
  const r = await detectarRepos(
    { db, llm: llmFalso({ repos: [{ repoId: "zzzzzzzz", papel: "principal", motivo: "x" }] }) },
    "t1"
  );

  assert.equal(r.fallback, true);
  assert.ok(r.repos.length > 0, "las keywords encontraron algo");
  assert.ok(r.repos.some((x) => x.nombre === "Cotizador_Backend"));
});

test("cero repos con duda se devuelve como duda, no como fallo", async () => {
  const { db } = entorno();
  const r = await detectarRepos({ db, llm: llmFalso({ repos: [], duda: "¿Es front o backend?" }) }, "t1");

  assert.equal(r.repos.length, 0);
  assert.equal(r.duda, "¿Es front o backend?");
});

test("cero repos sin duda y sin keywords usables falla", async () => {
  const { db } = entorno();
  db.update(topic).set({ title: "zzz", description: null }).run();
  await assert.rejects(() => detectarRepos({ db, llm: llmFalso({ repos: [] }) }, "t1"), DeteccionError);
});

test("la detección queda registrada en agent_run", async () => {
  const { db } = entorno();
  await detectarRepos({ db, llm: llmFalso(OK) }, "t1");
  const runs = db.select().from(agentRun).all();
  assert.ok(runs.some((r) => r.tool === "detectar_repos"));
});

test("las fronteras se derivan de consumes/exposes", () => {
  const { db } = entorno();
  const c = catalogo(db);
  const texto = serializarRepos(c);
  assert.match(texto, /consume: Cotizador_Backend/);
  assert.match(texto, /api:\/api\/public\/experience-submissions/);
});

test("porKeywords puntúa y devuelve hasta tres", () => {
  const { db } = entorno();
  const c = catalogo(db);
  const r = porKeywords("necesitamos cambiar la precotizacion y el precio", c);
  assert.ok(r.length >= 1);
  assert.ok(r.length <= 3);
  assert.equal(r[0]?.nombre, "Cotizador_Backend");
});
