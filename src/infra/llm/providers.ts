import { createDeepSeekProvider } from "./deepseek.ts";
import { createJevProvider } from "./jev.ts";
import { LlmError, type DecisionProvider, type LlmProvider } from "./types.ts";
import { recordCall, type TraceFn } from "./trace.ts";
import type { openDatabase } from "../db/client.ts";

type DB = ReturnType<typeof openDatabase>["db"];

export interface Providers {
  llm: LlmProvider;
  decision: DecisionProvider;
  /** Las llamadas se cuelgan de la operación abierta con este id. */
  setRun(runId: string | undefined): void;
}

/**
 * Los proveedores reportan cada llamada; quien los crea decide a qué operación
 * pertenecen. Sin base de datos, el reporte es un no-op.
 */
export function providersFromEnv(db?: DB): Providers {
  let runActual: string | undefined;

  const trace: TraceFn | undefined = db
    ? (call) => {
        if (runActual) recordCall(db, { ...call, runId: runActual });
      }
    : undefined;

  return {
    llm: createDeepSeekProvider({
      apiKey: requerido("DEEPSEEK_API_KEY"),
      model: process.env.DEEPSEEK_MODEL?.trim() || "deepseek-flash",
      ...(process.env.DEEPSEEK_BASE_URL ? { baseURL: process.env.DEEPSEEK_BASE_URL } : {}),
      thinking: process.env.DEEPSEEK_THINKING === "enabled" ? "enabled" : "disabled",
      maxAttempts: Number(process.env.LLM_MAX_ATTEMPTS ?? 3) || 3,
      ...(trace ? { trace } : {}),
    }),
    decision: createJevProvider({
      apiKey: requerido("TYPESAFE_API_KEY"),
      model: process.env.TYPESAFE_MODEL?.trim() || "jev-latest",
      ...(process.env.TYPESAFE_BASE_URL ? { baseURL: process.env.TYPESAFE_BASE_URL } : {}),
      ...(trace ? { trace } : {}),
    }),
    setRun(runId: string | undefined) {
      runActual = runId;
    },
  };
}

function requerido(nombre: string): string {
  const valor = process.env[nombre]?.trim();
  if (!valor) throw new LlmError(`Falta ${nombre} en .env. Sin eso no se puede llamar a los modelos.`);
  return valor;
}
