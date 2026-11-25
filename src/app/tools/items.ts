import { z } from "zod";
import type { Db } from "../../infra/db/client.ts";
import { project, rubric, rubricItem } from "../../infra/db/schema.ts";
import { lista, type ToolDef } from "./tool.ts";

const ESTADOS = ["pending", "in_progress", "ready_for_review", "done", "blocked", "dropped"] as const;
const TIPOS = ["code", "contact", "research", "other"] as const;

export function listarItems(db: Db): ToolDef {
  return {
    name: "listar_items",
    description:
      "Lista ítems de la rúbrica con filtros. Es la tool para 'qué me falta' o 'qué está bloqueado'. " +
      "Devuelve hasta 50; si truncado=true, afiná los filtros. " +
      "No devuelve el detalle de la reunión de origen.",
    input: z.strictObject({
      estado: z.enum(ESTADOS).optional(),
      proyectoId: z.string().optional(),
      semanaId: z.string().optional(),
      tipo: z.enum(TIPOS).optional(),
    }),
    sideEffect: false,
    execute(input) {
      const { estado, proyectoId, semanaId, tipo } = input as {
        estado?: (typeof ESTADOS)[number];
        proyectoId?: string;
        semanaId?: string;
        tipo?: (typeof TIPOS)[number];
      };

      const proyectos = new Map(db.select().from(project).all().map((p) => [p.id, p.name]));
      const semanas = new Map(db.select().from(rubric).all().map((r) => [r.id, r.weekStart]));

      const filtrados = db
        .select()
        .from(rubricItem)
        .all()
        .filter((i) => {
          if (estado) {
            if (i.status !== estado) return false;
          } else if (i.status === "dropped") {
            return false;
          }
          if (proyectoId && i.projectId !== proyectoId) return false;
          if (semanaId && i.rubricId !== semanaId) return false;
          if (tipo && i.type !== tipo) return false;
          return true;
        });

      const items = filtrados.slice(0, 50).map((i) => ({
        id: i.id,
        titulo: i.title,
        estado: i.status,
        proyecto: i.projectId ? proyectos.get(i.projectId) ?? null : null,
        tipo: i.type,
        criterio: i.acceptanceCriteria,
        semana: semanas.get(i.rubricId) ?? null,
      }));

      return lista(items, filtrados.length);
    },
  };
}
