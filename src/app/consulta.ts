/**
 * Consulta libre al ERP.
 *
 * El usuario pregunta en lenguaje natural. El modelo elige qué tools de lectura
 * llamar, el servidor las ejecuta y devuelve una respuesta con los ids que tocó.
 * Nunca inventa datos: si no lo consultó, no lo sabe.
 */

import type { Db } from "../infra/db/client.ts";
import { llmCall } from "../infra/db/schema.ts";
import type { Providers } from "../infra/llm/providers.ts";
import { finishRun, startRun } from "../infra/llm/trace.ts";
import type { PasoAgente } from "../infra/llm/types.ts";
import { maxSteps, topeTurno } from "./presupuesto.ts";
import { promptAsistente } from "./prompts.ts";
import { registro } from "./tools/index.ts";
import type { ToolDef, Vista } from "./tools/tool.ts";

export interface ConsultaResult {
  texto: string;
  pasos: PasoAgente[];
  principal: { vista: Vista; id: string | null } | null;
  usd: number;
  truncado: boolean;
  runId: string;
  ms: number;
  msModelo: number;
  modelo: string;
}

export const FALLBACK_PRESUPUESTO =
  "Corté por presupuesto antes de responder. Probá una pregunta más acotada.";

/** Gasto acumulado del día, para el tope diario. */
export function gastoDelDia(db: Db): number {
  const hoy = new Date().toDateString();
  return db
    .select()
    .from(llmCall)
    .all()
    .filter((c) => new Date(c.createdAt).toDateString() === hoy)
    .reduce((a, c) => a + (c.costUsd ?? 0), 0);
}

export async function consultar(
  db: Db,
  proveedores: Providers,
  pregunta: string
): Promise<ConsultaResult> {
  const runId = startRun(db, { kind: "summary", tool: "consulta", input: pregunta });
  // Las llamadas del proveedor se cuelgan de esta operación.
  proveedores.setRun(runId);
  const t0 = Date.now();

  try {
    const tools = registro(db);
    const porNombre = new Map<string, ToolDef>(tools.map((t) => [t.name, t]));

    const r = await proveedores.llm.agent({
      system: promptAsistente(new Date().toISOString().slice(0, 10)),
      messages: [{ role: "user", content: pregunta }],
      tools,
      maxSteps: maxSteps(),
      topeUsd: topeTurno(),
    });

    // Los pasos no son reintentos: `attempts` queda en 1.
    finishRun(db, runId, { outcome: "ok", intentos: 1, tokens: r.tokens, durationMs: r.durationMs });

    // El detalle más específico que el agente consultó, el último.
    const principal =
      [...r.pasos]
        .reverse()
        .map((p) => porNombre.get(p.tool)?.ref?.(p.input, p.output) ?? null)
        .find((x) => x !== null) ?? null;

    const texto = r.text.trim();

    return {
      texto: texto || (r.truncado ? FALLBACK_PRESUPUESTO : ""),
      pasos: r.pasos,
      principal,
      usd: r.usd,
      truncado: r.truncado,
      runId,
      ms: Date.now() - t0,
      msModelo: r.durationMs,
      modelo: r.modelo,
    };
  } catch (err) {
    finishRun(db, runId, {
      outcome: "failed",
      intentos: 1,
      fallos: [{ intento: 1, kind: "unknown", retriable: false, mensaje: String(err) }],
    });
    throw err;
  } finally {
    proveedores.setRun(undefined);
  }
}
