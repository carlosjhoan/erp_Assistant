import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { openDatabase } from "../src/infra/db/client.ts";
import { agentRun, meeting } from "../src/infra/db/schema.ts";
import { consultar, gastoDelDia } from "../src/app/consulta.ts";
import { registro } from "../src/app/tools/index.ts";
import type { Providers } from "../src/infra/llm/providers.ts";
import type { AgentOpts, AgentResult, LlmProvider } from "../src/infra/llm/types.ts";

function dbConReunion() {
  const { db } = openDatabase(":memory:");
  migrate(db, { migrationsFolder: "./drizzle" });
  db.insert(meeting)
    .values({
      id: "m1",
      source: "manual",
      externalId: "e1",
      title: "t",
      occurredAt: new Date(),
      participants: ["Ana Gómez"],
      contentHash: "h",
    })
    .run();
  return db;
}

function proveedores(llm: LlmProvider): Providers {
  return {
    llm,
    decision: {
      async decide() {
        return { scores: {}, model: "jev", tokens: 0, durationMs: 0 };
      },
    },
    setRun() {},
  };
}

function agente(resultado: Partial<AgentResult>, capturar?: (opts: AgentOpts) => void): LlmProvider {
  return {
    async generate() {
      throw new Error("no usado");
    },
    async agent(opts: AgentOpts): Promise<AgentResult> {
      capturar?.(opts);
      return {
        text: resultado.text ?? "",
        pasos: resultado.pasos ?? [],
        steps: resultado.steps ?? 0,
        tokens: resultado.tokens ?? 10,
        usd: resultado.usd ?? 0,
        durationMs: 1,
        modelo: "fake",
        truncado: resultado.truncado ?? false,
      };
    },
  };
}

test("consultar delega en las tools, enmascara nombres y deja traza", async () => {
  const db = dbConReunion();
  let vistos = 0;

  const r = await consultar(
    db,
    proveedores(
      agente(
        {
          text: "Ana Gómez pidió el deadline.",
          pasos: [{ tool: "ver_reunion", input: { id: "m1" }, output: { id: "m1" }, ok: true }],
          steps: 1,
        },
        (opts) => {
          vistos = opts.tools.length;
        }
      )
    ),
    "¿qué pidió?"
  );

  assert.equal(vistos, 7);
  assert.equal(r.texto, "Persona_#%& pidió el deadline.");
  assert.deepEqual(r.principal, { vista: "reuniones", id: null });

  const run = db.select().from(agentRun).where(eq(agentRun.id, r.runId)).get();
  assert.equal(run?.outcome, "ok");
  assert.equal(run?.attempts, 1);
});

test("consultar no inventa una vista si no hubo tool de detalle", async () => {
  const db = dbConReunion();
  const r = await consultar(db, proveedores(agente({ text: "No lo sé.", pasos: [], steps: 1 })), "¿?");
  assert.equal(r.principal, null);
});

test("consultar devuelve fallback cuando corta por presupuesto sin texto", async () => {
  const db = dbConReunion();
  const r = await consultar(
    db,
    proveedores(agente({ text: "", pasos: [], steps: 1, truncado: true })),
    "¿?"
  );
  assert.match(r.texto, /presupuesto/);
});

test("gastoDelDia arranca en cero sin llamadas", () => {
  assert.equal(gastoDelDia(dbConReunion()), 0);
});

test("el registro expone las 7 tools de lectura", () => {
  assert.deepEqual(registro(dbConReunion()).map((t) => t.name).sort(), [
    "buscar_notas",
    "estado_diagnostico",
    "listar_items",
    "listar_proyectos",
    "ver_proyecto",
    "ver_reunion",
    "ver_semana",
  ]);
});
