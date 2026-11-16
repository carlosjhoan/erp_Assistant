import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { topic } from "./schema.ts";
import type { openDatabase } from "./client.ts";
import type { TemaPropuesto } from "../../app/contracts.ts";
import type { TemaVerificado } from "../../app/verify-topics.ts";

type DB = ReturnType<typeof openDatabase>["db"];
type Estado = "proposed" | "selected" | "parked" | "discarded";

export type TopicRepo = ReturnType<typeof createTopicRepo>;

export function createTopicRepo(db: DB) {
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

  /**
   * Reemplaza los propuestos por la nueva extracción, en una transacción.
   * Si la transacción falla, quedan los anteriores: nunca una reunión sin temas.
   */
  function reemplazarPropuestos(meetingId: string, verificados: TemaVerificado[]) {
    let borrados = 0;
    let ids: string[] = [];

    db.transaction(() => {
      borrados = borrarPropuestos(meetingId);
      ids = insertar(meetingId, verificados);
    });

    return { borrados, ids };
  }

  function porReunion(meetingId: string, status?: Estado) {
    const base = db.select().from(topic);
    return (
      status
        ? base.where(and(eq(topic.meetingId, meetingId), eq(topic.status, status)))
        : base.where(eq(topic.meetingId, meetingId))
    )
      .orderBy(desc(topic.createdAt))
      .all();
  }

  function pendientesDeTriaje(meetingId: string) {
    return porReunion(meetingId, "proposed").length;
  }

  function porIds(ids: string[]) {
    if (ids.length === 0) return [];
    return db.select().from(topic).where(inArray(topic.id, ids)).all();
  }

  /**
   * Guard de triaje: no se avanza mientras algo siga en `proposed`.
   * Devuelve los títulos pendientes para poder decir cuáles son.
   */
  function triajeIncompleto(meetingId: string): string[] {
    return porReunion(meetingId, "proposed").map((t) => t.title);
  }

  return { insertar, borrarPropuestos, reemplazarPropuestos, porReunion, pendientesDeTriaje, porIds, triajeIncompleto };
}
