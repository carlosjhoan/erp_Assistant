import { eq } from "drizzle-orm";
import { meeting, rubric, topic } from "../infra/db/schema.ts";
import { createItemRepo } from "../infra/db/item-repo.ts";
import { finishRun, startRun } from "../infra/llm/trace.ts";
import { LlmError, type DecisionProvider, type LlmProvider } from "../infra/llm/types.ts";
import { DesgloseTema, type ItemPropuesto } from "./contracts.ts";
import { promptDesglose, SYSTEM_DESGLOSE } from "./prompts.ts";
import { verificarItems } from "./verify-items.ts";
import { umbralJev } from "./verify-topics.ts";
import type { openDatabase } from "../infra/db/client.ts";

type DB = ReturnType<typeof openDatabase>["db"];

export class ItemError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ItemError";
  }
}

export interface GenerateItemsResult {
  topicId: string;
  topicTitle: string;
  rubricId: string;
  generated: number;
  replaced: number;
  needsReview: number;
  model: string;
  tokens: number;
  durationMs: number;
  intentos: number;
  items: { id: string; position: number; title: string; type: string; score: number; needsReview: boolean }[];
}

function sinDuplicados(items: ItemPropuesto[]): ItemPropuesto[] {
  const vistos = new Set<string>();
  return items.filter((i) => {
    const clave = i.title.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    if (vistos.has(clave)) return false;
    vistos.add(clave);
    return true;
  });
}

/**
 * Desglosa un tema en ítems.
 *
 * - Solo sobre temas `selected` cuya rúbrica siga en `draft`.
 * - Regenerar reemplaza únicamente los ítems del agente que no editaste.
 */
export async function generateItems(
  deps: { db: DB; llm: LlmProvider; decision: DecisionProvider; setRun?: (id: string | undefined) => void },
  topicId: string
): Promise<GenerateItemsResult> {
  const { db, llm, decision } = deps;

  const tema = db.select().from(topic).where(eq(topic.id, topicId)).get();
  if (!tema) throw new ItemError(`No existe el tema ${topicId}.`);
  if (tema.status !== "selected") {
    throw new ItemError(`El tema está en "${tema.status}": solo se desglosan los temas seleccionados.`);
  }
  if (!tema.rubricId) {
    throw new ItemError("El tema no está en ninguna rúbrica. Creá la rúbrica antes de desglosar.");
  }

  const rubrica = db.select().from(rubric).where(eq(rubric.id, tema.rubricId)).get();
  if (!rubrica) throw new ItemError(`No existe la rúbrica ${tema.rubricId}.`);
  if (rubrica.status !== "draft") {
    throw new ItemError(`La rúbrica está en "${rubrica.status}": no se le agregan ítems. Creá una versión nueva.`);
  }

  const apunte = tema.meetingId
    ? (db.select().from(meeting).where(eq(meeting.id, tema.meetingId)).get()?.summary ?? "")
    : "";
  if (!apunte.trim()) throw new ItemError("No hay apunte del que sacar los ítems.");

  const runId = startRun(db, { kind: "compose", tool: "generate_items", input: `${tema.title}\n${apunte}` });
  deps.setRun?.(runId);

  let resultado;
  try {
    resultado = await llm.generate({
      kind: "compose",
      schemaName: "desglose_tema",
      system: SYSTEM_DESGLOSE,
      prompt: promptDesglose({ titulo: tema.title, descripcion: tema.description, cita: tema.sourceExcerpt }, apunte),
      schema: DesgloseTema,
    });
  } catch (e) {
    deps.setRun?.(undefined);
    finishRun(db, runId, { outcome: "failed" });
    throw e;
  }

  const items = sinDuplicados(resultado.data.items);

  let verificados;
  try {
    verificados = await verificarItems(decision, apunte, items);
  } finally {
    deps.setRun?.(undefined);
  }

  const repo = createItemRepo(db);
  const borrados = repo.borrarGeneradosIntactos(tema.id);

  const ids = repo.insertar(
    rubrica.id,
    verificados.map((v) => ({
      title: v.item.title,
      ...(v.item.description ? { description: v.item.description } : {}),
      acceptanceCriteria: v.item.acceptanceCriteria,
      type: v.item.suggestedType,
      topicId: tema.id,
      sourceMeetingId: tema.meetingId,
      sourceExcerpt: v.item.sourceExcerpt,
      verifyStatus: v.needsReview ? ("needs_review" as const) : ("verified" as const),
      verifyScore: v.score,
      verifyDetail: v.detalle,
    }))
  );

  finishRun(db, runId, {
    tokens: resultado.tokens,
    durationMs: resultado.durationMs,
    intentos: resultado.intentos,
    fallos: resultado.fallos,
    outcome: "ok",
  });

  repo.renumerar(rubrica.id);

  const guardados = ids.map((id) => repo.porTema(tema.id).find((i) => i.id === id)!).filter(Boolean);

  return {
    topicId: tema.id,
    topicTitle: tema.title,
    rubricId: rubrica.id,
    generated: ids.length,
    replaced: borrados,
    needsReview: verificados.filter((v) => v.needsReview).length,
    model: resultado.model,
    tokens: resultado.tokens,
    durationMs: resultado.durationMs,
    intentos: resultado.intentos,
    items: guardados.map((i) => ({
      id: i.id,
      position: i.position,
      title: i.title,
      type: i.type,
      score: i.verifyScore ?? 0,
      needsReview: i.verifyStatus === "needs_review",
    })),
  };
}

export function assertUmbral(): number {
  return umbralJev();
}
