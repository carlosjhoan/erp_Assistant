import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { rubricItem } from "./schema.ts";
import type { openDatabase } from "./client.ts";

type DB = ReturnType<typeof openDatabase>["db"];
export type TipoItem = "code" | "contact" | "research" | "other";

export type ItemRepo = ReturnType<typeof createItemRepo>;

export interface ItemParaInsertar {
  title: string;
  description?: string;
  acceptanceCriteria: string;
  type: TipoItem;
  topicId: string;
  sourceMeetingId: string | null;
  sourceExcerpt: string;
  verifyStatus: "verified" | "needs_review";
  verifyScore: number;
  verifyDetail?: Record<string, number>;
  repoId?: string | null;
}

export function createItemRepo(db: DB) {
  /** La posición es global dentro de la rúbrica: la lista se lee corrida. */
  function siguientePosicion(rubricId: string): number {
    const fila = db
      .select({ max: sql<number | null>`max(${rubricItem.position})` })
      .from(rubricItem)
      .where(eq(rubricItem.rubricId, rubricId))
      .get();
    return (fila?.max ?? -1) + 1;
  }

  function insertar(rubricId: string, items: ItemParaInsertar[]): string[] {
    const ids: string[] = [];
    db.transaction(() => {
      let posicion = siguientePosicion(rubricId);
      for (const i of items) {
        const id = randomUUID();
        ids.push(id);
        db.insert(rubricItem)
          .values({
            id,
            rubricId,
            topicId: i.topicId,
            title: i.title,
            description: i.description ?? null,
            acceptanceCriteria: i.acceptanceCriteria,
            type: i.type,
            origin: "agent",
            humanEdited: false,
            sourceMeetingId: i.sourceMeetingId,
            sourceExcerpt: i.sourceExcerpt,
            position: posicion++,
            verifyStatus: i.verifyStatus,
            verifyScore: i.verifyScore,
            verifyDetail: i.verifyDetail ?? null,
            repoId: i.repoId ?? null,
          })
          .run();
      }
    });
    return ids;
  }

  /**
   * Regenerar solo reemplaza lo que el agente generó y vos no tocaste.
   * Un ítem editado a mano o creado a mano sobrevive.
   */
  function borrarGeneradosIntactos(topicId: string): number {
    const antes = db
      .select({ id: rubricItem.id })
      .from(rubricItem)
      .where(and(eq(rubricItem.topicId, topicId), eq(rubricItem.origin, "agent"), eq(rubricItem.humanEdited, false)))
      .all().length;

    db.delete(rubricItem)
      .where(and(eq(rubricItem.topicId, topicId), eq(rubricItem.origin, "agent"), eq(rubricItem.humanEdited, false)))
      .run();

    return antes;
  }

  /**
   * Después de regenerar, las posiciones quedan con huecos. Se renumeran para
   * que la rúbrica se lea como una lista corrida, que es lo que es.
   */
  function renumerar(rubricId: string) {
    const filas = db
      .select({ id: rubricItem.id })
      .from(rubricItem)
      .where(eq(rubricItem.rubricId, rubricId))
      .orderBy(asc(rubricItem.position))
      .all();

    db.transaction(() => {
      filas.forEach((f, i) => {
        db.update(rubricItem).set({ position: i }).where(eq(rubricItem.id, f.id)).run();
      });
    });
  }

  function porTema(topicId: string) {
    return db.select().from(rubricItem).where(eq(rubricItem.topicId, topicId)).orderBy(asc(rubricItem.position)).all();
  }

  function porRubrica(rubricId: string) {
    return db.select().from(rubricItem).where(eq(rubricItem.rubricId, rubricId)).orderBy(asc(rubricItem.position)).all();
  }

  return { siguientePosicion, insertar, borrarGeneradosIntactos, renumerar, porTema, porRubrica };
}
