import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../../infra/db/client.ts";
import { project, rubricItem } from "../../infra/db/schema.ts";
import { rango, semanaEnCurso, semanaProxima, semanas } from "../progreso.ts";
import { fallo, type ToolDef } from "./tool.ts";

export function verSemana(db: Db): ToolDef {
  return {
    name: "ver_semana",
    description:
      "Devuelve una semana de la rúbrica con sus ítems. Sin argumentos trae la semana en curso; " +
      'usá cual="proxima" para lo que viene. No devuelve notas de reuniones.',
    input: z.strictObject({ id: z.string().optional(), cual: z.enum(["actual", "proxima"]).optional() }),
    sideEffect: false,
    ref(_input, output) {
      const o = output as { id?: string } | null;
      return o?.id ? { vista: "semana", id: o.id } : null;
    },
    execute(input) {
      const { id, cual } = input as { id?: string; cual?: "actual" | "proxima" };
      const todas = semanas(db);
      const hallada = id
        ? todas.find((s) => s.id === id)
        : cual === "proxima"
          ? semanaProxima(todas)
          : semanaEnCurso(todas);

      if (!hallada) {
        return fallo(id ? `No existe la semana ${id}.` : "No hay una semana registrada para ese criterio.");
      }

      const semana = hallada;
      const nombres = new Map(db.select().from(project).all().map((p) => [p.id, p.name]));
      const items = db
        .select()
        .from(rubricItem)
        .where(eq(rubricItem.rubricId, semana.id))
        .all()
        .map((i) => ({
          id: i.id,
          titulo: i.title,
          estado: i.status,
          proyecto: i.projectId ? nombres.get(i.projectId) ?? null : null,
          tipo: i.type,
        }));

      return {
        id: semana.id,
        desde: semana.desde,
        hasta: semana.hasta,
        rango: rango(semana.desde, semana.hasta),
        estado: semana.estado,
        total: semana.total,
        hechos: semana.hechos,
        pct: semana.pct,
        porProyecto: semana.porProyecto,
        items,
      };
    },
  };
}
