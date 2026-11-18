import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull, like, lte, or } from "drizzle-orm";
import { meeting, topic } from "./schema.ts";
import type { openDatabase } from "./client.ts";
import type { TemaPropuesto } from "../../app/contracts.ts";
import type { TemaVerificado } from "../../app/verify-topics.ts";

type DB = ReturnType<typeof openDatabase>["db"];
export type EstadoTema = "proposed" | "selected" | "parked" | "discarded";

export type TopicRepo = ReturnType<typeof createTopicRepo>;

export function createTopicRepo(db: DB) {
  /* ---------- escritura desde la extracción ---------- */

  function insertar(meetingId: string, verificados: TemaVerificado[]): string[] {
    const ids: string[] = [];
    for (const v of verificados) {
      const id = randomUUID();
      ids.push(id);
      db.insert(topic)
        .values({
          id,
          meetingId,
          title: v.tema.title,
          description: v.tema.description,
          sourceExcerpt: v.tema.sourceExcerpt,
          scopeSignal: v.tema.scopeSignal,
          scopeReason: v.tema.scopeReason,
          openQuestions: v.tema.openQuestions ?? null,
          verifyScore: v.score,
          needsReview: v.needsReview,
          owner: v.clasificacion.owner,
          ownerScore: v.clasificacion.score,
          ownerDetail: v.clasificacion.detalle,
          status: "proposed",
          origin: "agent",
        })
        .run();
    }
    return ids;
  }

  /** Solo los `proposed`: lo que ya decidiste no se toca. */
  function borrarPropuestos(meetingId: string): number {
    const antes = db
      .select({ id: topic.id })
      .from(topic)
      .where(and(eq(topic.meetingId, meetingId), eq(topic.status, "proposed")))
      .all().length;

    db.delete(topic)
      .where(and(eq(topic.meetingId, meetingId), eq(topic.status, "proposed")))
      .run();

    return antes;
  }

  function reemplazarPropuestos(meetingId: string, verificados: TemaVerificado[]) {
    let borrados = 0;
    let ids: string[] = [];

    db.transaction(() => {
      borrados = borrarPropuestos(meetingId);
      ids = insertar(meetingId, verificados);
    });

    return { borrados, ids };
  }

  /* ---------- lectura ---------- */

  function porReunion(meetingId: string, status?: EstadoTema) {
    const base = db.select().from(topic);
    return (status ? base.where(and(eq(topic.meetingId, meetingId), eq(topic.status, status))) : base.where(eq(topic.meetingId, meetingId)))
      .orderBy(desc(topic.createdAt))
      .all();
  }

  function porIds(ids: string[]) {
    if (ids.length === 0) return [];
    return db.select().from(topic).where(inArray(topic.id, ids)).all();
  }

  /**
   * Busca por id completo o por el comienzo del id (los primeros caracteres que
   * imprime el CLI). Un prefijo ambiguo devuelve más de uno y el llamador decide.
   */
  function buscar(prefijo: string) {
    return db
      .select()
      .from(topic)
      .where(or(eq(topic.id, prefijo), like(topic.id, `${prefijo}%`)))
      .all();
  }

  /** Bandeja: temas propuestos, con el título de su reunión. */
  function bandeja(opciones: { desde?: Date; hasta?: Date } = {}) {
    const condiciones = [eq(topic.status, "proposed" as const)];
    if (opciones.desde && opciones.hasta) {
      condiciones.push(gte(meeting.occurredAt, opciones.desde), lte(meeting.occurredAt, opciones.hasta));
    }

    return db
      .select({
        id: topic.id,
        title: topic.title,
        description: topic.description,
        scopeSignal: topic.scopeSignal,
        owner: topic.owner,
        scopeReason: topic.scopeReason,
        needsReview: topic.needsReview,
        verifyScore: topic.verifyScore,
        openQuestions: topic.openQuestions,
        meetingId: topic.meetingId,
        meetingTitle: meeting.title,
        occurredAt: meeting.occurredAt,
      })
      .from(topic)
      .leftJoin(meeting, eq(topic.meetingId, meeting.id))
      .where(and(...condiciones))
      .orderBy(desc(meeting.occurredAt), desc(topic.createdAt))
      .all();
  }

  /** Archivo de ideas: lo aparcado, venga de la semana que venga. */
  function ideas() {
    return db
      .select({
        id: topic.id,
        title: topic.title,
        description: topic.description,
        decidedAt: topic.decidedAt,
        meetingTitle: meeting.title,
      })
      .from(topic)
      .leftJoin(meeting, eq(topic.meetingId, meeting.id))
      .where(eq(topic.status, "parked"))
      .orderBy(desc(topic.decidedAt))
      .all();
  }

  function pendientesDeTriaje(meetingId: string) {
    return porReunion(meetingId, "proposed").length;
  }

  function triajeIncompleto(meetingId: string): string[] {
    return porReunion(meetingId, "proposed").map((t) => t.title);
  }

  /** Temas seleccionados que todavía no entraron a ninguna rúbrica. */
  function seleccionadosSinRubrica(meetingId?: string) {
    const condiciones = [eq(topic.status, "selected" as const), isNull(topic.rubricId)];
    if (meetingId) condiciones.push(eq(topic.meetingId, meetingId));
    return db.select().from(topic).where(and(...condiciones)).all();
  }

  /* ---------- escritura del triaje ---------- */

  function actualizar(id: string, campos: { title?: string; description?: string }) {
    const set: Record<string, string> = {};
    if (campos.title !== undefined) set.title = campos.title;
    if (campos.description !== undefined) set.description = campos.description;
    if (Object.keys(set).length === 0) return;
    db.update(topic).set(set).where(eq(topic.id, id)).run();
  }

  function cambiarEstado(
    id: string,
    status: EstadoTema,
    extra: { rubricId?: string | null; decidedBy?: string } = {}
  ) {
    db.update(topic)
      .set({
        status,
        decidedAt: new Date(),
        decidedBy: extra.decidedBy ?? "yo",
        ...(extra.rubricId !== undefined ? { rubricId: extra.rubricId } : {}),
        ...(status === "proposed" ? { mergedIntoTopicId: null } : {}),
      })
      .where(eq(topic.id, id))
      .run();
  }

  function crearManual(datos: { meetingId?: string; title: string; description?: string; status?: EstadoTema }) {
    const id = randomUUID();
    db.insert(topic)
      .values({
        id,
        meetingId: datos.meetingId ?? null,
        title: datos.title,
        description: datos.description ?? null,
        status: datos.status ?? "proposed",
        origin: "manual",
      })
      .run();
    return id;
  }

  /**
   * Fusionar: el absorbido queda `discarded` apuntando al destino. No se borra:
   * el historial de que existió se conserva.
   */
  function fusionar(origenes: string[], destino: string) {
    db.transaction(() => {
      for (const id of origenes) {
        if (id === destino) continue;
        db.update(topic)
          .set({ status: "discarded", mergedIntoTopicId: destino, decidedAt: new Date(), decidedBy: "yo" })
          .where(eq(topic.id, id))
          .run();
      }
    });
  }

  return {
    insertar,
    borrarPropuestos,
    reemplazarPropuestos,
    porReunion,
    porIds,
    buscar,
    bandeja,
    ideas,
    pendientesDeTriaje,
    triajeIncompleto,
    seleccionadosSinRubrica,
    actualizar,
    cambiarEstado,
    crearManual,
    fusionar,
  };
}

/** Lunes a domingo de la semana de una fecha. */
export function rangoSemana(fecha: Date): { desde: Date; hasta: Date } {
  const d = new Date(fecha);
  const dia = (d.getDay() + 6) % 7; // lunes = 0
  const desde = new Date(d);
  desde.setDate(d.getDate() - dia);
  desde.setHours(0, 0, 0, 0);
  const hasta = new Date(desde);
  hasta.setDate(desde.getDate() + 6);
  hasta.setHours(23, 59, 59, 999);
  return { desde, hasta };
}
