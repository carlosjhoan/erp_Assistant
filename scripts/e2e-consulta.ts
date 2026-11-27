/**
 * E2E del asistente contra la base real y DeepSeek real.
 * Escribe trazas en la base de desarrollo (agent_run / llm_call).
 * Correr: node --env-file-if-exists=.env --import tsx scripts/e2e-consulta.ts
 */
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { consultar, gastoDelDia } from "../src/app/consulta.ts";
import { openDatabase } from "../src/infra/db/client.ts";
import { llmCall } from "../src/infra/db/schema.ts";
import { providersFromEnv } from "../src/infra/llm/providers.ts";

const { db } = openDatabase(process.env.DATABASE_PATH ?? "./data/my_erp.db");
migrate(db, { migrationsFolder: "./drizzle" });

const PREGUNTAS = [
  "¿Qué proyectos tengo y cómo va cada uno?",
  "¿Qué me falta esta semana?",
  "¿De qué se habló en la reunión de landing? Dame las citas.",
  "¿Qué tan sólido está Landing para producción?",
];

const kb = (v: unknown) => `${Math.round(JSON.stringify(v).length / 1024 * 10) / 10}KB`;

const antes = gastoDelDia(db);
console.log(`\n=== E2E CONSULTA === db: ${process.env.DATABASE_PATH ?? "./data/my_erp.db"}\n`);

for (const pregunta of PREGUNTAS) {
  console.log(`\n--- ${pregunta}`);
  try {
    const r = await consultar(db, providersFromEnv(db), pregunta);
    const calls = db.select().from(llmCall).where(eq(llmCall.runId, r.runId)).all();
    const costoTraza = calls.reduce((a, c) => a + (c.costUsd ?? 0), 0);

    console.log(
      `  tools: ${r.pasos.map((p) => `${p.tool}(${kb(p.output)})`).join(" -> ") || "(ninguna)"}`
    );
    console.log(
      `  steps=${r.pasos.length} trazas=${calls.length} tokens=${calls.reduce(
        (a, c) => a + (c.inputTokens ?? 0) + (c.outputTokens ?? 0),
        0
      )}`
    );
    console.log(`  usd=${r.usd.toFixed(6)} costoTraza=${costoTraza.toFixed(6)} truncado=${r.truncado}`);
    console.log(
      `  principal: ${r.principal ? `${r.principal.vista}/${r.principal.id ?? "-"}` : "null"}  ms=${r.ms}`
    );
    console.log(`  respuesta: ${r.texto.replace(/\s+/g, " ")}`);
  } catch (e) {
    console.log(`  ERROR: ${e instanceof Error ? e.message : String(e)}`);
  }
}

console.log(`\nGasto del día: antes $${antes.toFixed(6)} -> después $${gastoDelDia(db).toFixed(6)}\n`);
