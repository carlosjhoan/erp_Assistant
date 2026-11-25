import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../../infra/db/client.ts";
import { project, projectCapability, rubricItem } from "../../infra/db/schema.ts";
import { capacidadesEfectivas, veredicto } from "../progreso.ts";
import { fallo, type ToolDef } from "./tool.ts";

export function estadoDiagnostico(db: Db): ToolDef {
  return {
    name: "estado_diagnostico",
    description:
      "Detalle del diagnóstico de un proyecto: negocio, técnico, robustez y las capacidades que lo explican. " +
      "Usala cuando la pregunta es 'qué tan sólido está' o 'qué falta para producción'. " +
      "No devuelve ítems ni temas.",
    input: z.strictObject({ proyectoId: z.string() }),
    sideEffect: false,
    ref(_input, output) {
      const o = output as { proyectoId?: string } | null;
      return o?.proyectoId ? { vista: "proyecto", id: o.proyectoId } : null;
    },
    execute(input) {
      const { proyectoId } = input as { proyectoId: string };
      const p = db.select().from(project).where(eq(project.id, proyectoId)).get();
      if (!p) return fallo(`No existe el proyecto ${proyectoId}. Usá listar_proyectos para ver los ids.`);

      const caps = db
        .select()
        .from(projectCapability)
        .where(eq(projectCapability.projectId, proyectoId))
        .all();

      if (caps.length === 0) {
        return {
          proyectoId,
          proyecto: p.name,
          negocio: 0,
          tecnico: 0,
          robustez: 0,
          estado: "sin-diagnostico",
          base: 0,
          resumen: { completos: 0, parciales: 0, ausentes: 0, confiables: 0 },
          capacidades: [],
          faltantes: [],
        };
      }

      const items = db.select().from(rubricItem).all();
      const efectivas = capacidadesEfectivas(caps, items);
      const v = veredicto(efectivas);

      return {
        proyectoId,
        proyecto: p.name,
        negocio: v.negocio,
        tecnico: v.produccion,
        robustez: v.robustez,
        estado: v.estado,
        base: v.base,
        resumen: {
          completos: v.completos,
          parciales: v.parciales,
          ausentes: v.ausentes,
          confiables: v.confiables,
        },
        capacidades: efectivas.map((c) => ({
          key: c.key,
          title: c.title,
          integration: c.integration,
          integrationBase: c.base,
          reliability: c.reliability,
          quality: c.quality,
          movidaPorItems: c.movidaPorItems,
        })),
        faltantes: efectivas
          .filter((c) => c.scope !== "futuro" && !c.outsideRubric)
          .filter((c) => c.integration === "I0" || c.integration === "I1")
          .map((c) => c.title),
      };
    },
  };
}
