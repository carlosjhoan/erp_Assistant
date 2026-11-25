/**
 * Smoke del loop de tools contra DeepSeek real.
 * Usa base en memoria: no toca data/my_erp.db.
 * Correr: node --env-file-if-exists=.env --import tsx scripts/smoke-agente.ts
 */
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { z } from "zod";
import type { ToolDef } from "../src/app/tools/tool.ts";
import { openDatabase } from "../src/infra/db/client.ts";
import { llmCall } from "../src/infra/db/schema.ts";
import { createDeepSeekProvider } from "../src/infra/llm/deepseek.ts";
import { clasificarError } from "../src/infra/llm/errors.ts";
import { finishRun, startRun, tracerFor } from "../src/infra/llm/trace.ts";

function requerido(nombre: string): string {
  const valor = process.env[nombre]?.trim();
  if (!valor) {
    console.error(`Falta ${nombre} en .env`);
    process.exit(1);
  }
  return valor;
}

const apiKey = requerido("DEEPSEEK_API_KEY");
const model = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-flash";
const baseURL = process.env.DEEPSEEK_BASE_URL?.trim();

const { db } = openDatabase(":memory:");
migrate(db, { migrationsFolder: "./drizzle" });

const verSemana: ToolDef = {
  name: "ver_semana",
  description:
    "Devuelve la rúbrica de la semana en curso o la próxima, con sus ítems. Usala para saber qué está planificado o qué falta.",
  input: z.strictObject({ cual: z.enum(["actual", "proxima"]).optional() }),
  sideEffect: false,
  execute(input) {
    const cual = (input as { cual?: "actual" | "proxima" }).cual ?? "actual";
    return {
      id: cual === "proxima" ? "sem-prox" : "sem-actual",
      desde: "2026-11-23",
      hasta: "2026-11-29",
      pct: 40,
      total: 5,
      hechos: 2,
      items: [
        { id: "it-1", titulo: "Activar pricing en la landing", estado: "done" },
        { id: "it-2", titulo: "Cerrar contrato con proveedor", estado: "pending" },
      ],
    };
  },
};

const buscarNotas: ToolDef = {
  name: "buscar_notas",
  description:
    "Busca texto en el resumen y las notas privadas de reuniones. Devuelve coincidencias con extracto e id de reunión.",
  input: z.strictObject({ texto: z.string().min(2) }),
  sideEffect: false,
  execute(input) {
    const { texto } = input as { texto: string };
    return {
      items: [
        {
          id: "meet-1",
          titulo: "Landing page activation plan",
          fecha: "2026-11-20",
          participantes: ["Persona_#%&", "Persona_%&#"],
          extracto: `Persona_#%& pidió que el deadline de la landing quede antes del 15 de diciembre. (búsqueda: ${texto})`,
          campo: "summary",
        },
      ],
      total: 1,
      truncado: false,
    };
  },
};

const tools = [verSemana, buscarNotas];

const SYSTEM = [
  "Sos el asistente de un ERP personal de gestión de proyectos.",
  "Respondés en español, breve. Máximo tres frases.",
  "Solo afirmás lo que devolvieron las tools. Si no lo consultaste, no lo sabés.",
  "Citá los ids que devolvieron las tools.",
].join(" ");

interface Resultado {
  nombre: string;
  ok: boolean;
  error?: string;
  steps: number;
  pasos: number;
  pasosOk: boolean;
  tools: string[];
  inputs: unknown[];
  modelosTraza: string[];
  usd: number;
  tokens: number;
  truncado: boolean;
  texto: string;
  trazas: number;
  costoTraza: number;
}

async function correr(nombre: string, pregunta: string, maxSteps: number, topeUsd: number): Promise<Resultado> {
  const runId = startRun(db, { kind: "summary", tool: `smoke-${nombre}`, input: pregunta });
  const trace = tracerFor(db, runId);
  const llm = createDeepSeekProvider({
    apiKey,
    model,
    ...(baseURL ? { baseURL } : {}),
    thinking: "disabled",
    maxAttempts: 1,
    ...(trace ? { trace } : {}),
  });

  try {
    const r = await llm.agent({
      system: SYSTEM,
      messages: [{ role: "user", content: pregunta }],
      tools,
      maxSteps,
      topeUsd,
    });
    finishRun(db, runId, { outcome: "ok", intentos: 1, tokens: r.tokens, durationMs: r.durationMs });
    const calls = db.select().from(llmCall).where(eq(llmCall.runId, runId)).all();
    return {
      nombre,
      ok: true,
      steps: r.steps,
      pasos: r.pasos.length,
      pasosOk: r.pasos.every((p) => p.ok),
      tools: [...new Set(r.pasos.map((p) => p.tool))],
      inputs: r.pasos.map((p) => p.input),
      modelosTraza: calls.map((c) => c.model ?? "(sin modelo)"),
      usd: r.usd,
      tokens: r.tokens,
      truncado: r.truncado,
      texto: r.text,
      trazas: calls.length,
      costoTraza: calls.reduce((a, c) => a + (c.costUsd ?? 0), 0),
    };
  } catch (e) {
    const d = clasificarError(e);
    const mensaje = e instanceof Error ? e.message : String(e);
    finishRun(db, runId, {
      outcome: "failed",
      intentos: 1,
      fallos: [{ intento: 1, kind: d.kind, retriable: d.retriable, mensaje }],
    });
    return {
      nombre,
      ok: false,
      error: `${d.kind}: ${mensaje}`,
      steps: 0,
      pasos: 0,
      pasosOk: false,
      tools: [],
      inputs: [],
      modelosTraza: [],
      usd: 0,
      tokens: 0,
      truncado: false,
      texto: "",
      trazas: 0,
      costoTraza: 0,
    };
  }
}

const PREGUNTA = "¿Qué pidió Persona_#%& sobre el deadline de la landing? Cita la reunión.";

const resultados = [
  await correr("normal", PREGUNTA, 4, 0.05),
  await correr("tope-pasos", PREGUNTA, 1, 0.05),
  await correr("tope-usd", PREGUNTA, 4, 0),
];

const A = resultados[0]!;
const B = resultados[1]!;
const C = resultados[2]!;

console.log(`\n=== SMOKE AGENTE === modelo: ${model}  base: ${baseURL ?? "(default)"}\n`);
for (const r of resultados) {
  console.log(`--- ${r.nombre} ---`);
  if (!r.ok) {
    console.log(`  ERROR: ${r.error}`);
    continue;
  }
  console.log(`  steps=${r.steps} pasos=${r.pasos} tools=[${r.tools.join(",")}] todosOk=${r.pasosOk}`);
  console.log(`  inputs: ${JSON.stringify(r.inputs).slice(0, 240)}`);
  console.log(`  usd=${r.usd.toFixed(6)} tokens=${r.tokens} truncado=${r.truncado}`);
  console.log(`  trazas=${r.trazas} costoTraza=${r.costoTraza.toFixed(6)} modelos=[${r.modelosTraza.join(",")}]`);
  console.log(`  texto: ${r.texto.replace(/\s+/g, " ").slice(0, 240)}`);
}

type Estado = "PASS" | "WARN" | "FAIL";
const checks: { riesgo: string; estado: Estado; detalle: string }[] = [
  {
    riesgo: "R1 DeepSeek acepta tools",
    estado: A.ok ? "PASS" : "FAIL",
    detalle: A.ok ? "el loop terminó sin error" : A.error ?? "",
  },
  {
    riesgo: "R2 el modelo elige la tool",
    estado: A.pasos >= 1 ? "PASS" : "FAIL",
    detalle: `pasos=${A.pasos} tools=[${A.tools.join(",")}]`,
  },
  {
    riesgo: "R3 multi-paso (tool -> texto)",
    estado: A.steps >= 2 ? "PASS" : "WARN",
    detalle: `steps=${A.steps}`,
  },
  {
    riesgo: "R4 tope de pasos (maxSteps=1)",
    estado: B.ok && B.steps === 1 && B.truncado ? "PASS" : "FAIL",
    detalle: `steps=${B.steps} truncado=${B.truncado}`,
  },
  {
    riesgo: "R5 traza por paso",
    estado: A.trazas === A.steps ? "PASS" : "FAIL",
    detalle: `trazas=${A.trazas} steps=${A.steps}`,
  },
  {
    riesgo: "R5b costo > 0",
    estado: A.costoTraza > 0 ? "PASS" : "WARN",
    detalle: `usd=${A.usd.toFixed(6)} traza=${A.costoTraza.toFixed(6)} (0 = tarifa desconocida)`,
  },
  {
    riesgo: "R6 tope USD (tope=0)",
    estado: C.truncado ? (C.usd > 0 ? "PASS" : "WARN") : "FAIL",
    detalle: `usd=${C.usd.toFixed(6)} truncado=${C.truncado}`,
  },
  {
    riesgo: "R7 schema de entrada de tools",
    estado: A.pasosOk && A.pasos >= 1 ? "PASS" : "WARN",
    detalle: A.pasos >= 1 ? "la tool ejecutó sin error de validación" : "no hubo tool que validar",
  },
];

console.log("\n=== RIESGOS ===\n");
for (const c of checks) {
  console.log(`${c.estado.padEnd(5)} ${c.riesgo}  —  ${c.detalle}`);
}

process.exitCode = checks.some((c) => c.estado === "FAIL") ? 1 : 0;
