import { asc, eq } from "drizzle-orm";
import type { Db } from "../infra/db/client.ts";
import { project, projectCapability, rubric, rubricItem, topic, topicProject } from "../infra/db/schema.ts";

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
  diagnostico: { negocio: number; tecnico: number; estado: string; base: number } | null;
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

      // El diagnóstico se calcula desde las capacidades importadas, más lo
      // que hayan avanzado los ítems cerrados de este proyecto.
      const caps = db.select().from(projectCapability).where(eq(projectCapability.projectId, p.id)).all();
      const diag = caps.length > 0 ? veredicto(capacidadesEfectivas(caps, items)) : null;

      return {
        proyectoId: p.id,
        nombre: p.name,
        estado: p.status,
        ...contar(mios),
        diagnostico: diag
          ? { negocio: diag.negocio, tecnico: diag.produccion, estado: diag.estado, base: diag.base }
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

/* ---------- diagnóstico: mismas fórmulas que el prototipo ---------- */

export interface Veredicto {
  negocio: number;
  produccion: number;
  robustez: number;
  estado: "solido" | "aceptable" | "atencion" | "critico" | "sin-diagnostico";
  base: number;
  completos: number;
  parciales: number;
  ausentes: number;
  confiables: number;
}

type Cap = {
  scope: string;
  outsideRubric: boolean;
  integration: string;
  reliability: string;
  quality: string | null;
};

/** Solo lo pedido entra al denominador. */
const enRubrica = (cs: Cap[]) => cs.filter((c) => c.scope !== "futuro" && !c.outsideRubric);

/**
 * Negocio: cuánto puede usar el área hoy. Integrado vale 1, parcial 0,5.
 * Producción: cuánto además aguanta fallos (I3 y F2 o F3).
 */
export function veredicto(capacidades: Cap[]): Veredicto {
  const base = enRubrica(capacidades);
  if (base.length === 0) {
    return {
      negocio: 0,
      produccion: 0,
      robustez: 0,
      estado: "sin-diagnostico",
      base: 0,
      completos: 0,
      parciales: 0,
      ausentes: 0,
      confiables: 0,
    };
  }

  const puntos = base.reduce((a, c) => a + (c.integration === "I3" ? 1 : c.integration === "I2" ? 0.5 : 0), 0);
  const confiables = base.filter((c) => c.integration === "I3" && (c.reliability === "F2" || c.reliability === "F3"));

  const Q: Record<string, number> = { Q3: 3, Q2: 2, Q1: 1 };
  const conCalidad = base.filter((c) => c.quality && c.quality in Q);
  const suma = conCalidad.reduce((a, c) => a + (Q[c.quality as string] ?? 0), 0);
  const escala = conCalidad.length > 0 ? suma / conCalidad.length / 3 : 0;

  const estado = escala >= 0.8 ? "solido" : escala >= 0.55 ? "aceptable" : escala >= 0.34 ? "atencion" : "critico";

  return {
    negocio: Math.round((puntos / base.length) * 100),
    produccion: Math.round((confiables.length / base.length) * 100),
    robustez: Math.round(escala * 100),
    estado,
    base: base.length,
    completos: base.filter((c) => c.integration === "I3").length,
    parciales: base.filter((c) => c.integration === "I2").length,
    ausentes: base.filter((c) => c.integration === "I0").length,
    confiables: confiables.length,
  };
}

/* ---------- estado efectivo de una capacidad ---------- */

const RANGO: Record<string, number> = { I0: 0, I1: 1, I2: 2, I3: 3 };
const NOMBRE = ["I0", "I1", "I2", "I3"] as const;

type ItemAporte = { capabilityId: string | null; capabilityEffect: string; status: string };

/**
 * Una capacidad vale lo que dice el diagnóstico, o más si hay ítems cerrados
 * que la empujan. Se calcula al leer: desmarcar un ítem revierte el avance
 * solo, sin tocar la capacidad.
 */
export function efectiva(base: string, items: ItemAporte[], capabilityId: string): { actual: string; porItems: boolean } {
  const aportes = items
    .filter((i) => i.capabilityId === capabilityId && i.status === "done" && i.capabilityEffect !== "none")
    .map((i) => (i.capabilityEffect === "cierra" ? 3 : 2));

  const desdeItems = aportes.length > 0 ? Math.max(...aportes) : -1;
  const desdeBase = RANGO[base] ?? 0;
  const mejor = Math.max(desdeBase, desdeItems);

  return { actual: NOMBRE[mejor] ?? base, porItems: desdeItems > desdeBase };
}

/** Aplica el avance de los ítems a todas las capacidades de un proyecto. */
export function capacidadesEfectivas<T extends { id: string; integration: string }>(caps: T[], items: ItemAporte[]) {
  return caps.map((c) => {
    const e = efectiva(c.integration, items, c.id);
    return { ...c, integration: e.actual, base: c.integration, movidaPorItems: e.porItems };
  });
}
