import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { agentRun, llmCall } from "../db/schema.ts";
import type { openDatabase } from "../db/client.ts";
import type { IntentoFallido } from "./types.ts";
import type { ErrorKind } from "./errors.ts";
import { costoUsd } from "./precio.ts";

type DB = ReturnType<typeof openDatabase>["db"];

/** Recorte de seguridad: una respuesta no debería superar esto nunca. */
const MAX_TEXTO = 20_000;

const recortar = (s?: string) => (s ? s.slice(0, MAX_TEXTO) : null);

/* ---------- la operación ---------- */

export interface RunStart {
  kind: "interpret" | "compose" | "verify" | "summary";
  tool: string;
  input: string;
}

/**
 * Abre la operación antes de llamar al modelo, para que las llamadas tengan
 * padre. Si el proceso muere a mitad, la fila queda con `outcome` nulo: eso
 * también es información.
 */
export function startRun(db: DB, run: RunStart): string {
  const id = randomUUID();
  db.insert(agentRun)
    .values({
      id,
      kind: run.kind,
      tool: run.tool,
      inputHash: createHash("sha256").update(run.input).digest("hex").slice(0, 32),
    })
    .run();
  return id;
}

export interface RunEnd {
  tokens?: number;
  durationMs?: number;
  intentos?: number;
  outcome: "ok" | "failed";
  fallos?: IntentoFallido[];
}

export function finishRun(db: DB, runId: string, end: RunEnd): void {
  const fallos = end.fallos ?? [];
  const ultimo = fallos[fallos.length - 1];

  db.update(agentRun)
    .set({
      tokens: end.tokens ?? null,
      durationMs: end.durationMs ?? null,
      attempts: end.intentos ?? null,
      outcome: end.outcome,
      errorKind: ultimo?.kind ?? null,
      errorDetail: fallos.length > 0 ? fallos.map((f) => `#${f.intento} ${f.kind}: ${f.mensaje}`).join(" | ").slice(0, 2000) : null,
    })
    .where(eq(agentRun.id, runId))
    .run();
}

/* ---------- la llamada ---------- */

export interface CallRecord {
  runId: string;
  provider: "deepseek" | "jev" | "openrouter";
  model?: string;
  attempt: number;
  status: "ok" | "failed";
  errorKind?: ErrorKind;
  errorDetail?: string;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  prompt?: string;
  response?: string;
  /** Costo real que informa el proveedor. Si falta, se calcula por tarifa. */
  costUsd?: number;
}

export function recordCall(db: DB, call: CallRecord): void {
  db.insert(llmCall)
    .values({
      id: randomUUID(),
      runId: call.runId,
      provider: call.provider,
      model: call.model ?? null,
      attempt: call.attempt,
      status: call.status,
      errorKind: call.errorKind ?? null,
      errorDetail: recortar(call.errorDetail),
      inputTokens: call.inputTokens ?? null,
      outputTokens: call.outputTokens ?? null,
      durationMs: call.durationMs ?? null,
      prompt: recortar(call.prompt),
      response: recortar(call.response),
      costUsd: call.costUsd ?? costoUsd(call.provider, call.model, call.inputTokens, call.outputTokens),
    })
    .run();
}

/** Callback que reciben los proveedores: sin base, no hace nada. */
export type TraceFn = (call: Omit<CallRecord, "runId">) => void;

/** Arma el callback atado a una operación. Si no hay base, devuelve undefined. */
export function tracerFor(db: DB | undefined, runId: string): TraceFn | undefined {
  if (!db) return undefined;
  return (call) => recordCall(db, { ...call, runId });
}

/* ---------- consultas ---------- */

export function detalleRun(db: DB, runId: string) {
  const run = db.select().from(agentRun).where(eq(agentRun.id, runId)).get();
  const calls = db.select().from(llmCall).where(eq(llmCall.runId, runId)).all();
  return { run, calls };
}

export function resumenTrazas(db: DB) {
  const runs = db.select().from(agentRun).all();
  const calls = db.select().from(llmCall).all();

  const porCausa: Record<string, number> = {};
  for (const c of calls) {
    if (c.errorKind) porCausa[c.errorKind] = (porCausa[c.errorKind] ?? 0) + 1;
  }

  const conReintento = runs.filter((r) => (r.attempts ?? 1) > 1).length;

  return {
    runs: runs.length,
    calls: calls.length,
    fallidas: runs.filter((r) => r.outcome === "failed").length,
    sinCerrar: runs.filter((r) => r.outcome === null).length,
    conReintento,
    tasaReintento: runs.length > 0 ? conReintento / runs.length : 0,
    tokens: calls.reduce((n, c) => n + (c.inputTokens ?? 0) + (c.outputTokens ?? 0), 0),
    porCausa,
    porProveedor: {
      deepseek: calls.filter((c) => c.provider === "deepseek").length,
      jev: calls.filter((c) => c.provider === "jev").length,
      openrouter: calls.filter((c) => c.provider === "openrouter").length,
    },
  };
}
