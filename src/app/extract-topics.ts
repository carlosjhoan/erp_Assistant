import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { agentRun, meeting } from "../infra/db/schema.ts";
import { createTopicRepo } from "../infra/db/topic-repo.ts";
import { finishRun, startRun } from "../infra/llm/trace.ts";
import { sincronizarEstadoReunion } from "./meeting-status.ts";
import { LlmError, type DecisionProvider, type LlmProvider } from "../infra/llm/types.ts";
import { ExtraccionTemas, type TemaPropuesto } from "./contracts.ts";
import { promptExtraccion, SYSTEM_EXTRACCION } from "./prompts.ts";
import { verificarTemas } from "./verify-topics.ts";
import type { openDatabase } from "../infra/db/client.ts";

type DB = ReturnType<typeof openDatabase>["db"];

export interface ExtractTopicsResult {
  meetingTitle: string;
  extracted: number;
  replaced: number;
  kept: number;
  needsReview: number;
  /** Cuando no hay temas: por qué, y de qué se habló. */
  empty?: { reason?: string; conversationTopics: string[] };
  model: string;
  tokens: number;
  durationMs: number;
  intentos: number;
  topics: { id: string; title: string; scopeSignal?: string; needsReview: boolean; score: number }[];
}

/** Deduplica por título normalizado: el modelo no siempre fusiona lo que se le pide. */
function sinDuplicados(temas: TemaPropuesto[]): TemaPropuesto[] {
  const vistos = new Set<string>();
  return temas.filter((t) => {
    const clave = t.title.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    if (vistos.has(clave)) return false;
    vistos.add(clave);
    return true;
  });
}

/**
 * Extrae los temas de una reunión y los deja en `proposed` para el triaje.
 *
 * Regla: reejecutar reemplaza SOLO los `proposed`. Lo que ya decidiste
 * (selected / parked / discarded) sobrevive con su id y su historia.
 */
export async function extractTopics(
  deps: { db: DB; llm: LlmProvider; decision: DecisionProvider; setRun?: (id: string | undefined) => void },
  meetingId: string
): Promise<ExtractTopicsResult> {
  const { db, llm, decision } = deps;

  const reunion = db.select().from(meeting).where(eq(meeting.id, meetingId)).get();
  if (!reunion) throw new LlmError(`No existe la reunión ${meetingId}.`);
  if (!reunion.summary?.trim()) {
    throw new LlmError(`La reunión "${reunion.title}" no tiene summary: no hay de dónde extraer temas.`);
  }

  // La operación se abre antes de llamar: las llamadas se cuelgan de ella.
  const runId = startRun(db, { kind: "interpret", tool: "extract_topics", input: reunion.summary });
  deps.setRun?.(runId);

  let resultado;
  try {
    resultado = await llm.generate({
    kind: "compose",
    schemaName: "extraccion_temas",
    system: SYSTEM_EXTRACCION,
    prompt: promptExtraccion({
      titulo: reunion.title,
      fecha: reunion.occurredAt.toISOString().slice(0, 10),
      participantes: reunion.participants,
      summary: reunion.summary,
    }),
      schema: ExtraccionTemas,
    });
  } catch (e) {
    deps.setRun?.(undefined);
    throw e;
  }

  finishRun(db, runId, {
    tokens: resultado.tokens,
    durationMs: resultado.durationMs,
    intentos: resultado.intentos,
    fallos: resultado.fallos,
    outcome: "ok",
  });

  const temas = sinDuplicados(resultado.data.topics);
  const repo = createTopicRepo(db);
  const kept = repo.porReunion(meetingId).filter((t) => t.status !== "proposed").length;

  if (temas.length === 0) {
    // Aunque no haya temas nuevos, los propuestos viejos se van: si no,
    // quedan fantasmas de una corrida anterior.
    deps.setRun?.(undefined);
    const { borrados } = repo.reemplazarPropuestos(meetingId, []);
    sincronizarEstadoReunion(db, meetingId);

    return {
      meetingTitle: reunion.title,
      extracted: 0,
      replaced: borrados,
      kept,
      needsReview: 0,
      empty: {
        ...(resultado.data.emptyReason ? { reason: resultado.data.emptyReason } : {}),
        conversationTopics: resultado.data.conversationTopics ?? [],
      },
      model: resultado.model,
      tokens: resultado.tokens,
      durationMs: resultado.durationMs,
      intentos: resultado.intentos,
      topics: [],
    };
  }

  let verificados: Awaited<ReturnType<typeof verificarTemas>>;
  try {
    verificados = await verificarTemas(decision, reunion.summary, temas);
  } finally {
    deps.setRun?.(undefined);
  }
  const { borrados, ids } = repo.reemplazarPropuestos(meetingId, verificados);
  sincronizarEstadoReunion(db, meetingId);
  const guardados = repo.porIds(ids);

  return {
    meetingTitle: reunion.title,
    extracted: verificados.length,
    replaced: borrados,
    kept,
    needsReview: verificados.filter((v) => v.needsReview).length,
    model: resultado.model,
    tokens: resultado.tokens,
    durationMs: resultado.durationMs,
    intentos: resultado.intentos,
    topics: verificados.map((v, i) => ({
      id: ids[i] ?? "",
      title: v.tema.title,
      ...(v.tema.scopeSignal ? { scopeSignal: v.tema.scopeSignal } : {}),
      needsReview: v.needsReview,
      score: v.score,
    })),
  };
}

/**
 * Cuántas veces se corrió la extracción sobre esta reunión. Se deriva del log
 * de operaciones (mismo hash del apunte), así que no puede desincronizarse.
 */
export function contarExtracciones(db: DB, summary: string): number {
  const hash = createHash("sha256").update(summary).digest("hex").slice(0, 32);
  return db.select().from(agentRun).all().filter((r) => r.tool === "extract_topics" && r.inputHash === hash).length;
}
