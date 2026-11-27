/**
 * Captura el flujo completo de un turno: pregunta, system, salidas del modelo
 * por paso, ejecuciones de tools y respuesta final. Escribe data/flujo.json.
 * Correr: node --env-file-if-exists=.env --import tsx scripts/flujo.ts
 */
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { consultar } from "../src/app/consulta.ts";
import { promptAsistente } from "../src/app/prompts.ts";
import { openDatabase } from "../src/infra/db/client.ts";
import { llmCall } from "../src/infra/db/schema.ts";
import { providersFromEnv } from "../src/infra/llm/providers.ts";
import { writeFileSync } from "node:fs";

const { db } = openDatabase(process.env.DATABASE_PATH ?? "./data/my_erp.db");
migrate(db, { migrationsFolder: "./drizzle" });

const PREGUNTAS = [
  "¿Qué proyectos tengo y cómo va cada uno?",
  "¿Qué me falta esta semana?",
  "¿De qué se habló en la reunión de landing? Dame las citas.",
  "¿Qué tan sólido está Landing para producción?",
  "¿Cuál es la capital de Francia?",
  "Escribime un haiku sobre el mar.",
];

function podar(v: unknown): unknown {
  if (Array.isArray(v)) return { total: v.length, muestra: v.slice(0, 2).map(podar) };
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (k === "participantes" && Array.isArray(val)) {
        out[k] = val.map(() => "Persona_#%&");
      } else if (typeof val === "string") {
        out[k] = val.length > 180 ? `${val.slice(0, 180)}…` : val;
      } else {
        out[k] = podar(val);
      }
    }
    return out;
  }
  return v;
}

const fecha = new Date().toISOString().slice(0, 10);
const sistema = promptAsistente(fecha);
const turnos: unknown[] = [];

console.log(`\n=== FLUJO === ${PREGUNTAS.length} preguntas\n`);

for (const pregunta of PREGUNTAS) {
  try {
    const r = await consultar(db, providersFromEnv(db), pregunta);
    const calls = db
      .select()
      .from(llmCall)
      .where(eq(llmCall.runId, r.runId))
      .orderBy(sql`rowid`)
      .all();

    const turno = {
      pregunta,
      sistema,
      modelo: calls.map((c) => ({
        tokens: { entrada: c.inputTokens ?? 0, salida: c.outputTokens ?? 0 },
        usd: c.costUsd ?? 0,
        salida: JSON.parse(c.response ?? "{}") as unknown,
      })),
      tools: r.pasos.map((p) => ({
        tool: p.tool,
        input: p.input,
        output: podar(p.output),
        bytes: JSON.stringify(p.output).length,
        ok: p.ok,
      })),
      respuesta: r.texto,
      principal: r.principal,
      tokens: calls.reduce((a, c) => a + (c.inputTokens ?? 0) + (c.outputTokens ?? 0), 0),
      usd: r.usd,
      ms: r.ms,
      truncado: r.truncado,
    };

    turnos.push(turno);
    console.log(
      `ok  tools=[${r.pasos.map((p) => p.tool).join(",") || "ninguna"}] tokens=${turno.tokens} usd=${r.usd.toFixed(6)} ms=${r.ms}`
    );
    console.log(`    ${pregunta}`);
  } catch (e) {
    console.log(`ERR ${pregunta}: ${e instanceof Error ? e.message : String(e)}`);
    turnos.push({ pregunta, error: e instanceof Error ? e.message : String(e) });
  }
}

writeFileSync("./data/flujo.json", JSON.stringify({ fecha, sistema, turnos }, null, 2));
console.log(`\nEscrito ./data/flujo.json (${turnos.length} turnos)\n`);
