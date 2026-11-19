import { eq } from "drizzle-orm";
import { meeting, topic } from "../infra/db/schema.ts";
import type { openDatabase } from "../infra/db/client.ts";

type DB = ReturnType<typeof openDatabase>["db"];
export type EstadoReunion = "imported" | "topics_extracted" | "triaged";

/**
 * El estado de la reunión es derivado: no se escribe a mano.
 *
 * - sin temas                     → imported
 * - con algún tema en proposed    → topics_extracted
 * - con todos los temas decididos → triaged
 */
export function derivarEstado(db: DB, meetingId: string): EstadoReunion {
  const temas = db.select().from(topic).where(eq(topic.meetingId, meetingId)).all();
  if (temas.length === 0) return "imported";
  return temas.some((t) => t.status === "proposed") ? "topics_extracted" : "triaged";
}

/** Vuelve a calcular el estado y lo guarda si cambió. */
export function sincronizarEstadoReunion(db: DB, meetingId: string): EstadoReunion {
  const estado = derivarEstado(db, meetingId);
  const actual = db.select().from(meeting).where(eq(meeting.id, meetingId)).get();
  if (actual && actual.status !== estado) {
    db.update(meeting).set({ status: estado }).where(eq(meeting.id, meetingId)).run();
  }
  return estado;
}
