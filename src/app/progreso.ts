import { asc, eq } from "drizzle-orm";
import type { Db } from "../infra/db/client.ts";
import { project, projectDiagnosis, rubric, rubricItem, topic, topicProject } from "../infra/db/schema.ts";

/**
 * Un ítem cuenta como hecho si su estado es `done`. Los `dropped` salen del
 * denominador porque no se debían hacer; los `blocked` quedan adentro porque
 * están trabados, no resueltos.
 */
export function contar(items: { status: string }[]) {
  const vivos = items.filter((i) => i.status !== "dropped");
  const hechos = vivos.filter((i) => i.status === "done").length;
  return { total: vivos.length, hechos, pct: vivos.length > 0 ? Math.round((hechos / vivos.length) * 100) : 0 };
}

export interface ProgresoProyecto {
  proyectoId: string;
  nombre: string;
  estado: string;
  total: number;
  hechos: number;
  pct: number;
  diagnostico: { negocio: number | null; tecnico: number | null; desde: Date } | null;
  repos: number;
  semana: { total: number; hechos: number; pct: number };
}

/** Estado de todos los proyectos, con su avance de la semana indicada. */
export function progresoPorProyecto(db: Db, semanaId?: string): ProgresoProyecto[] {
  const proyectos = db.select().from(project).all();
  const vinculos = db.select().from(topicProject).all();
  const temas = db.select().from(topic).all();
  const items = db.select().from(rubricItem).all();
  const rubricas = db.select().from(rubric).all();

  // La semana por defecto es la rúbrica más reciente.
  const semana = semanaId
    ? rubricas.find((r) => r.id === semanaId)
    : rubricas.sort((a, b) => b.weekStart.localeCompare(a.weekStart))[0];

  const deLaSemana = semana ? items.filter((i) => i.rubricId === semana.id) : [];

  return proyectos
    .map((p) => {
      const misTemas = temas.filter(
        (t) => t.projectId === p.id || vinculos.some((v) => v.topicId === t.id && v.projectId === p.id),
      );
      const idsTemas = new Set(misTemas.map((t) => t.id));
      // El proyecto del ítem manda; si no lo tiene, se hereda del tema.
      const mios = items.filter((i) => i.projectId === p.id || (!i.projectId && i.topicId && idsTemas.has(i.topicId)));

      const diag = db
        .select()
        .from(projectDiagnosis)
        .where(eq(projectDiagnosis.projectId, p.id))
        .orderBy(asc(projectDiagnosis.measuredAt))
        .all()
        .at(-1);

      return {
        proyectoId: p.id,
        nombre: p.name,
        estado: p.status,
        ...contar(mios),
        diagnostico: diag
          ? {
              negocio: diag.businessPct,
              tecnico: diag.technicalPct,
              desde: new Date(diag.measuredAt),
            }
          : null,
        repos: vinculos.filter((v) => v.projectId === p.id).length,
        semana: contar(deLaSemana.filter((i) => i.projectId === p.id || (!i.projectId && i.topicId && idsTemas.has(i.topicId)))),
      };
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

export interface SemanaResumen {
  id: string;
  desde: string;
  hasta: string | null;
  estado: string;
  total: number;
  hechos: number;
  pct: number;
  porProyecto: { nombre: string; pct: number; total: number; hechos: number }[];
}

/** Todas las semanas, de la más nueva a la más vieja. */
export function semanas(db: Db): SemanaResumen[] {
  const rubricas = db.select().from(rubric).all();
  const items = db.select().from(rubricItem).all();
  const proyectos = new Map(db.select().from(project).all().map((p) => [p.id, p.name]));

  return rubricas
    .map((r) => {
      const propios = items.filter((i) => i.rubricId === r.id);
      const nombres = [...new Set(propios.map((i) => i.projectId).filter(Boolean))] as string[];

      return {
        id: r.id,
        desde: r.weekStart,
        hasta: r.deadline,
        estado: r.status,
        ...contar(propios),
        porProyecto: nombres.map((id) => ({
          nombre: proyectos.get(id) ?? "Sin proyecto",
          ...contar(propios.filter((i) => i.projectId === id)),
        })),
      };
    })
    .sort((a, b) => b.desde.localeCompare(a.desde));
}

/** Rango legible: "12 – 18 nov" o "29 oct – 04 nov". */
export function rango(desde: string, hasta: string | null): string {
  const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const d = new Date(`${desde}T12:00:00`);
  const inicio = `${d.getDate()} ${MESES[d.getMonth()]}`;
  if (!hasta) return inicio;
  const h = new Date(`${hasta}T12:00:00`);
  return `${inicio} – ${h.getDate()} ${MESES[h.getMonth()]}`;
}
