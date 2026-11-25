import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../../infra/db/client.ts";
import {
  projectCapability,
  projectRepository,
  repo as repoTable,
  rubricItem,
  topic,
  topicProject,
} from "../../infra/db/schema.ts";
import { capacidadesEfectivas, progresoPorProyecto } from "../progreso.ts";
import { fallo, lista, type ToolDef } from "./tool.ts";

/** Repos del proyecto por N:M y por la FK histórica, sin duplicar. */
export function reposDeProyecto(db: Db, projectId: string) {
  const porNexo = db
    .select()
    .from(projectRepository)
    .where(eq(projectRepository.projectId, projectId))
    .all()
    .map((v) => v.repoId);
  const directos = db
    .select()
    .from(repoTable)
    .where(eq(repoTable.projectId, projectId))
    .all()
    .map((r) => r.id);
  const ids = new Set([...porNexo, ...directos]);

  return db
    .select()
    .from(repoTable)
    .all()
    .filter((r) => ids.has(r.id))
    .map((r) => ({ id: r.id, nombre: r.name, path: r.path }));
}

export function listarProyectos(db: Db): ToolDef {
  return {
    name: "listar_proyectos",
    description:
      "Lista todos los proyectos con su avance de la semana, el acumulado y el diagnóstico. " +
      "Usala para saber qué proyectos existen o para comparar su estado. " +
      "No devuelve capacidades, temas ni ítems: para eso usá ver_proyecto.",
    input: z.strictObject({}),
    sideEffect: false,
    execute() {
      const filas = progresoPorProyecto(db);
      return lista(
        filas.map((p) => ({
          id: p.proyectoId,
          nombre: p.nombre,
          estado: p.estado,
          semana: p.semana,
          acumulado: { pct: p.pct, hechos: p.hechos, total: p.total },
          repos: reposDeProyecto(db, p.proyectoId).length,
          diagnostico: p.diagnostico
            ? { negocio: p.diagnostico.negocio, tecnico: p.diagnostico.tecnico }
            : null,
        }))
      );
    },
  };
}

export function verProyecto(db: Db): ToolDef {
  return {
    name: "ver_proyecto",
    description:
      "Abre un proyecto por id o nombre. Devuelve avance, diagnóstico, sus capacidades y sus repos. " +
      "No devuelve la lista de ítems (solo el conteo de abiertos): para eso usá listar_items con proyectoId.",
    input: z.strictObject({ id: z.string().optional(), nombre: z.string().optional() }),
    sideEffect: false,
    ref(_input, output) {
      const o = output as { id?: string } | null;
      return o?.id ? { vista: "proyecto", id: o.id } : null;
    },
    execute(input) {
      const { id, nombre } = input as { id?: string; nombre?: string };
      const filas = progresoPorProyecto(db);

      let encontrado = id ? filas.find((f) => f.proyectoId === id) : undefined;

      if (!encontrado && nombre) {
        const t = nombre.trim().toLowerCase();
        const hits = filas.filter((f) => f.nombre.toLowerCase().includes(t));
        if (hits.length === 0) return fallo(`No encontré un proyecto que contenga "${nombre}".`);
        if (hits.length > 1) {
          return fallo(
            `Hay varios: ${hits.map((h) => `${h.nombre} (${h.proyectoId})`).join(", ")}. Usá el id.`
          );
        }
        encontrado = hits[0];
      }

      if (!encontrado) return fallo("Pasá id o nombre de proyecto.");

      const proyecto = encontrado;
      const items = db.select().from(rubricItem).all();

      const caps = db
        .select()
        .from(projectCapability)
        .where(eq(projectCapability.projectId, proyecto.proyectoId))
        .all();

      const idsTemas = new Set(
        db
          .select()
          .from(topicProject)
          .where(eq(topicProject.projectId, proyecto.proyectoId))
          .all()
          .map((v) => v.topicId)
      );

      const temas = db
        .select()
        .from(topic)
        .all()
        .filter((t) => t.projectId === proyecto.proyectoId || idsTemas.has(t.id));

      const abiertos = items.filter(
        (i) =>
          (i.projectId === proyecto.proyectoId ||
            (!i.projectId && i.topicId && idsTemas.has(i.topicId))) &&
          i.status !== "done" &&
          i.status !== "dropped"
      ).length;

      return {
        id: proyecto.proyectoId,
        nombre: proyecto.nombre,
        descripcion: proyecto.descripcion,
        estado: proyecto.estado,
        avance: {
          semana: proyecto.semana,
          acumulado: { pct: proyecto.pct, hechos: proyecto.hechos, total: proyecto.total },
        },
        diagnostico: proyecto.diagnostico,
        capacidades: capacidadesEfectivas(caps, items).map((c) => ({
          key: c.key,
          title: c.title,
          integration: c.integration,
          integrationBase: c.base,
          reliability: c.reliability,
          quality: c.quality,
          movidaPorItems: c.movidaPorItems,
        })),
        repos: reposDeProyecto(db, proyecto.proyectoId),
        temas: temas.map((t) => ({
          id: t.id,
          titulo: t.title,
          estado: t.status,
          owner: t.owner,
        })),
        itemsAbiertos: abiertos,
      };
    },
  };
}
