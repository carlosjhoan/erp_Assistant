import { eq } from "drizzle-orm";
import { rubric, topic } from "../infra/db/schema.ts";
import { createTopicRepo, type EstadoTema } from "../infra/db/topic-repo.ts";
import { canTransitionTopic } from "../domain/status.ts";
import { LlmError } from "../infra/llm/types.ts";
import type { openDatabase } from "../infra/db/client.ts";

type DB = ReturnType<typeof openDatabase>["db"];

export class TriageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TriageError";
  }
}

export interface TriageCtx {
  db: DB;
  actor?: string;
}

function resolver(ctx: TriageCtx, prefijo: string) {
  const repo = createTopicRepo(ctx.db);
  const encontrados = repo.buscar(prefijo);

  if (encontrados.length === 0) throw new TriageError(`No encontré ningún tema con "${prefijo}".`);
  if (encontrados.length > 1) {
    const opciones = encontrados.map((t) => `  ${t.id.slice(0, 8)}  ${t.title}`).join("\n");
    throw new TriageError(`"${prefijo}" coincide con más de un tema. Usá más caracteres:\n${opciones}`);
  }
  return encontrados[0]!;
}

/** Un tema de una rúbrica aprobada no se toca: se abre una versión nueva. */
function assertEditable(ctx: TriageCtx, topicId: string) {
  const t = ctx.db.select().from(topic).where(eq(topic.id, topicId)).get();
  if (!t?.rubricId) return;

  const r = ctx.db.select().from(rubric).where(eq(rubric.id, t.rubricId)).get();
  if (r?.status === "approved" || r?.status === "closed") {
    throw new TriageError(
      `El tema está en una rúbrica ${r.status} y no se puede cambiar. Creá una versión nueva de la rúbrica.`
    );
  }
}

/* ---------- operaciones ---------- */

export function cambiarEstado(ctx: TriageCtx, prefijo: string, destino: EstadoTema) {
  const t = resolver(ctx, prefijo);
  assertEditable(ctx, t.id);

  const desde = t.status as EstadoTema;
  if (desde === destino) return { id: t.id, desde, hacia: destino, sinCambios: true };

  if (!canTransitionTopic(desde, destino)) {
    throw new TriageError(
      `No se puede pasar de "${desde}" a "${destino}". Desde "${desde}" solo se puede ir a: ${transiciones(desde)}.`
    );
  }

  createTopicRepo(ctx.db).cambiarEstado(t.id, destino, {
    ...(ctx.actor ? { decidedBy: ctx.actor } : {}),
    // Descartar o aparcar saca el tema de la rúbrica: no puede seguir en ella.
    ...(destino === "selected" ? {} : { rubricId: null }),
  });

  return { id: t.id, title: t.title, desde, hacia: destino, sinCambios: false };
}

function transiciones(desde: EstadoTema): string {
  const mapa: Record<EstadoTema, string[]> = {
    proposed: ["selected", "parked", "discarded"],
    selected: ["parked", "discarded"],
    parked: ["selected", "discarded"],
    discarded: ["proposed"],
  };
  return mapa[desde].join(", ");
}

export function editar(ctx: TriageCtx, prefijo: string, campos: { title?: string; description?: string }) {
  const t = resolver(ctx, prefijo);
  assertEditable(ctx, t.id);
  if (!campos.title && !campos.description) throw new TriageError("No indicaste qué editar (--title o --description).");

  createTopicRepo(ctx.db).actualizar(t.id, campos);
  return { id: t.id, title: campos.title ?? t.title };
}

export function fusionar(ctx: TriageCtx, origenes: string[], destinoPrefijo: string) {
  const destino = resolver(ctx, destinoPrefijo);
  const absorbidos = origenes.map((o) => resolver(ctx, o)).filter((t) => t.id !== destino.id);

  if (absorbidos.length === 0) throw new TriageError("No hay nada que fusionar: el destino es el único tema.");

  assertEditable(ctx, destino.id);
  for (const a of absorbidos) assertEditable(ctx, a.id);

  createTopicRepo(ctx.db).fusionar(
    absorbidos.map((a) => a.id),
    destino.id
  );

  return { destino, absorbidos };
}

export function crear(
  ctx: TriageCtx,
  datos: { meetingId?: string; title: string; description?: string }
): string {
  if (!datos.title.trim()) throw new TriageError("El título no puede estar vacío.");
  return createTopicRepo(ctx.db).crearManual({
    ...(datos.meetingId ? { meetingId: datos.meetingId } : {}),
    title: datos.title.trim(),
    ...(datos.description ? { description: datos.description } : {}),
  });
}

/**
 * El guard del documento: no se sigue si queda algo sin calificar.
 * Devuelve los pendientes en vez de lanzar, para poder mostrarlos.
 */
export function pendientesDeTriaje(ctx: TriageCtx, meetingId?: string): { id: string; title: string }[] {
  const repo = createTopicRepo(ctx.db);
  const filas = meetingId
    ? repo.porReunion(meetingId, "proposed")
    : repo.bandeja().map((b) => ({ id: b.id, title: b.title }));
  return filas.map((f) => ({ id: f.id, title: f.title }));
}

export function assertTriajeCompleto(ctx: TriageCtx, meetingId?: string): void {
  const pendientes = pendientesDeTriaje(ctx, meetingId);
  if (pendientes.length === 0) return;

  const lista = pendientes.map((p) => `  · ${p.title}`).join("\n");
  throw new LlmError(
    `Te faltan ${pendientes.length} tema(s) por calificar (selected / parked / discarded):\n${lista}`
  );
}
