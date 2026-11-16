import { createHash, randomUUID } from "node:crypto";
import { agentRun } from "../db/schema.ts";
import type { openDatabase } from "../db/client.ts";
import type { IntentoFallido } from "./types.ts";

type DB = ReturnType<typeof openDatabase>["db"];

export interface RunRecord {
  kind: "interpret" | "compose" | "verify" | "summary";
  tool: string;
  input: string;
  outputRef?: string;
  model?: string;
  tokens?: number;
  durationMs?: number;
  /** Cuántos intentos hicieron falta. 1 = salió a la primera. */
  intentos?: number;
  /** Si terminó bien o no. */
  outcome?: "ok" | "failed";
  /** Los intentos fallidos, con su categoría. */
  fallos?: IntentoFallido[];
}

/**
 * Deja constancia de cada llamada a un modelo. Se guardan tokens, duración e
 * intentos; el costo se calcula después, porque los precios cambian por ventana.
 *
 * Con `attempts` y `error_kind` se puede responder qué porcentaje de llamadas
 * necesita reintento y cuál es la causa dominante.
 */
export function recordRun(db: DB, run: RunRecord): string {
  const id = randomUUID();
  const fallos = run.fallos ?? [];
  const ultimoFallo = fallos[fallos.length - 1];

  db.insert(agentRun)
    .values({
      id,
      kind: run.kind,
      tool: run.tool,
      inputHash: createHash("sha256").update(run.input).digest("hex").slice(0, 32),
      outputRef: run.outputRef ?? null,
      tokens: run.tokens ?? null,
      durationMs: run.durationMs ?? null,
      attempts: run.intentos ?? null,
      outcome: run.outcome ?? "ok",
      errorKind: ultimoFallo?.kind ?? null,
      errorDetail: fallos.length > 0 ? fallos.map((f) => `#${f.intento} ${f.kind}: ${f.mensaje}`).join(" | ").slice(0, 1000) : null,
    })
    .run();

  return id;
}

/** Resumen de salud de las llamadas a modelos. Alimenta el reporte. */
export function resumenTrazas(db: DB) {
  const filas = db.select().from(agentRun).all();
  if (filas.length === 0) {
    return { total: 0, fallidas: 0, conReintento: 0, tasaReintento: 0, porCausa: {} as Record<string, number> };
  }

  const conReintento = filas.filter((f) => (f.attempts ?? 1) > 1).length;
  const porCausa: Record<string, number> = {};
  for (const f of filas) {
    if (f.errorKind) porCausa[f.errorKind] = (porCausa[f.errorKind] ?? 0) + 1;
  }

  return {
    total: filas.length,
    fallidas: filas.filter((f) => f.outcome === "failed").length,
    conReintento,
    tasaReintento: conReintento / filas.length,
    porCausa,
  };
}
