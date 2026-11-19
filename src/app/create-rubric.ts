import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { meeting, rubric, rubricItem, rubricSourceMeeting, topic } from "../infra/db/schema.ts";
import { createTopicRepo } from "../infra/db/topic-repo.ts";
import { assertTriajeCompleto } from "./triage.ts";
import type { openDatabase } from "../infra/db/client.ts";

type DB = ReturnType<typeof openDatabase>["db"];

export class RubricError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RubricError";
  }
}

export interface CreateRubricOpts {
  /** Lunes de la semana de trabajo. Si falta, se deduce del apunte. */
  weekStart?: string;
  /** Fecha de entrega. Si falta, el viernes de esa semana. */
  deadline?: string;
}

export interface CreateRubricResult {
  rubricId: string;
  weekStart: string;
  deadline: string;
  version: number;
  status: string;
  adjuntos: number;
  topics: { id: string; title: string }[];
  reutilizada: boolean;
}

/* ---------- fechas ---------- */

const aFecha = (iso: string) => new Date(`${iso}T00:00:00`);

export function lunesDe(fecha: Date): string {
  const d = new Date(fecha);
  d.setHours(0, 0, 0, 0);
  const offset = (d.getDay() + 6) % 7; // lunes = 0
  d.setDate(d.getDate() - offset);
  return d.toISOString().slice(0, 10);
}

export function viernesDe(lunesIso: string): string {
  const d = aFecha(lunesIso);
  d.setDate(d.getDate() + 4);
  return d.toISOString().slice(0, 10);
}

/**
 * La semana de trabajo que sigue al apunte: si la reunión fue el viernes 13,
 * la rúbrica es la del lunes 16, no la de esa misma semana.
 */
export function semanaSiguiente(fechaReunion: Date): string {
  const d = new Date(fechaReunion);
  d.setDate(d.getDate() + 7);
  return lunesDe(d);
}

/* ---------- el servicio ---------- */

/**
 * Crea la rúbrica con los temas que ya calificaste como `selected`.
 *
 * - Exige que el triaje esté cerrado: no se avanza con temas sin calificar.
 * - Si ya hay un borrador para esa semana, se le adjuntan los temas nuevos en
 *   vez de crear otra versión. Solo una rúbrica aprobada o cerrada fuerza
 *   versión nueva.
 */
function fechaDeReunion(db: DB, seleccionados: { meetingId: string | null }[]): Date {
  const ids = seleccionados.map((t) => t.meetingId).filter((id): id is string => Boolean(id));
  if (ids.length === 0) return new Date();

  const reuniones = ids
    .map((id) => db.select().from(meeting).where(eq(meeting.id, id)).get())
    .filter((m): m is NonNullable<typeof m> => Boolean(m));

  if (reuniones.length === 0) return new Date();
  return reuniones.reduce((masNueva, m) => (m.occurredAt > masNueva ? m.occurredAt : masNueva), reuniones[0]!.occurredAt);
}

export function createRubric(
  ctx: { db: DB; meetingId?: string; actor?: string },
  opts: CreateRubricOpts = {}
): CreateRubricResult {
  const { db } = ctx;

  assertTriajeCompleto(ctx, ctx.meetingId);

  const repo = createTopicRepo(db);
  const seleccionados = repo.seleccionadosSinRubrica(ctx.meetingId);

  if (seleccionados.length === 0) {
    throw new RubricError(
      "No hay temas seleccionados sin rúbrica. Calificá algún tema como `selected` antes de crear la rúbrica."
    );
  }

  // La fecha de la reunión define la semana por defecto, no la de extracción.
  const semana = opts.weekStart ?? semanaSiguiente(fechaDeReunion(db, seleccionados));

  const deadline = opts.deadline ?? viernesDe(semana);

  // ¿Ya hay un borrador de esa semana?
  const existentes = db.select().from(rubric).where(eq(rubric.weekStart, semana)).all();
  const borrador = existentes.find((r) => r.status === "draft");

  let rubricId: string;
  let version: number;
  let reutilizada = false;

  if (borrador) {
    rubricId = borrador.id;
    version = borrador.version;
    reutilizada = true;
    if (opts.deadline) {
      db.update(rubric).set({ deadline }).where(eq(rubric.id, rubricId)).run();
    }
  } else {
    version = existentes.reduce((max, r) => Math.max(max, r.version), 0) + 1;
    rubricId = randomUUID();
    db.insert(rubric)
      .values({
        id: rubricId,
        weekStart: semana,
        version,
        deadline,
        status: "draft",
        ...(existentes.length > 0 ? { parentRubricId: existentes.sort((a, b) => b.version - a.version)[0]!.id } : {}),
      })
      .run();
  }

  db.transaction(() => {
    for (const t of seleccionados) {
      db.update(topic).set({ rubricId }).where(eq(topic.id, t.id)).run();

      if (t.meetingId) {
        db.insert(rubricSourceMeeting).values({ rubricId, meetingId: t.meetingId }).onConflictDoNothing().run();
      }
    }
  });

  const fila = db.select().from(rubric).where(eq(rubric.id, rubricId)).get()!;

  return {
    rubricId,
    weekStart: fila.weekStart,
    deadline: fila.deadline ?? deadline,
    version: fila.version,
    status: fila.status,
    adjuntos: seleccionados.length,
    topics: seleccionados.map((t) => ({ id: t.id, title: t.title })),
    reutilizada,
  };
}

/** Los temas que ya están dentro de una rúbrica, ordenados. */
export function temasDeRubrica(db: DB, rubricId: string) {
  return db
    .select()
    .from(topic)
    .where(and(eq(topic.rubricId, rubricId), eq(topic.status, "selected")))
    .all();
}

export interface AprobarResult {
  rubricId: string;
  weekStart: string;
  version: number;
  items: number;
  temas: number;
}

/**
 * Aprueba la rúbrica. Es el único momento en que se congela.
 *
 * Guard: no se aprueba si hay un tema `selected` sin ningún ítem. Una rúbrica
 * con un tema vacío promete algo que nadie desglosó.
 */
export function aprobarRubrica(ctx: { db: DB; actor?: string }, rubricId: string): AprobarResult {
  const { db } = ctx;

  const r = db.select().from(rubric).where(eq(rubric.id, rubricId)).get();
  if (!r) throw new RubricError(`No existe la rúbrica ${rubricId}.`);
  if (r.status === "approved" || r.status === "closed") {
    throw new RubricError(`La rúbrica ya está en "${r.status}".`);
  }
  if (r.status !== "draft" && r.status !== "in_review") {
    throw new RubricError(`No se aprueba una rúbrica en "${r.status}".`);
  }

  const temas = temasDeRubrica(db, rubricId);
  if (temas.length === 0) throw new RubricError("La rúbrica no tiene ningún tema seleccionado.");

  const items = db.select().from(rubricItem).where(eq(rubricItem.rubricId, rubricId)).all();
  const sinItems = temas.filter((t) => !items.some((i) => i.topicId === t.id));

  if (sinItems.length > 0) {
    const lista = sinItems.map((t) => `  · ${t.title}`).join("\n");
    throw new RubricError(
      `Faltan desglosar ${sinItems.length} tema(s) antes de aprobar:\n${lista}\n\nDesglosá con: npm run items -- --topic <id>`
    );
  }

  db.update(rubric)
    .set({ status: "approved", approvedAt: new Date(), approvedBy: ctx.actor ?? "yo" })
    .where(eq(rubric.id, rubricId))
    .run();

  return { rubricId, weekStart: r.weekStart, version: r.version, items: items.length, temas: temas.length };
}

/** Envoltorio para el botón de la UI: crea con la semana sugerida. */
export function crearRubricaWeb(ctx: { db: DB }): { rubricId: string; adjuntos: number } {
  const r = createRubric(ctx);
  return { rubricId: r.rubricId, adjuntos: r.adjuntos };
}
