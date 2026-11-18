import type { repo as tablaRepo, project as tablaProject } from "../infra/db/schema.ts";

export type RepoFila = typeof tablaRepo.$inferSelect;
export type ProjectFila = typeof tablaProject.$inferSelect;

export interface RepoParaCatalogo {
  id: string;
  nombre: string;
  proyecto: string;
  description: string | null;
  keywords: string[];
  exposes: string[];
  consumes: string[];
}

export const idCorto = (id: string) => id.slice(0, 8);

/**
 * El harness. Cómo se le presenta un repo al modelo.
 *
 * Es el mismo formato para detección y para broadcast: si un repo se ve
 * distinto en cada paso, el modelo razona distinto sobre él.
 */
export function serializarRepos(repos: RepoParaCatalogo[]): string {
  return repos
    .map((r) => {
      const lineas = [
        `[${idCorto(r.id)}] ${r.proyecto}/${r.nombre}`,
        `    qué es: ${r.description?.trim() || "(sin descripción)"}`,
      ];
      if (r.keywords.length > 0) lineas.push(`    claves: ${r.keywords.join(", ")}`);
      if (r.exposes.length > 0) lineas.push(`    expone: ${r.exposes.join(", ")}`);
      if (r.consumes.length > 0) lineas.push(`    consume: ${r.consumes.join(", ")}`);
      return lineas.join("\n");
    })
    .join("\n\n");
}

/**
 * Las fronteras se derivan del registro, no se escriben a mano: si mañana un
 * repo empieza a consumir a otro, la lista cambia sola.
 */
export function serializarFronteras(repos: RepoParaCatalogo[]): string {
  const porNombre = new Map(repos.map((r) => [r.nombre, r]));
  const lineas: string[] = [];

  for (const r of repos) {
    for (const destino of r.consumes) {
      const consumido = porNombre.get(destino);
      if (!consumido) continue;
      const superficie = consumido.exposes.length > 0 ? consumido.exposes.join(", ") : "(superficie no declarada)";
      lineas.push(`  ${r.nombre} → ${destino} : ${superficie}`);
    }
  }

  const sueltos = repos.filter((r) => r.consumes.length === 0 && !repos.some((o) => o.consumes.includes(r.nombre)));
  if (sueltos.length > 0) {
    lineas.push(`  Sin acoplamiento declarado: ${sueltos.map((r) => r.nombre).join(", ")}`);
  }

  return lineas.length > 0 ? lineas.join("\n") : "  (ninguno declarado)";
}

export interface AlcanceParaDeteccion {
  titulo: string;
  descripcion?: string | null;
  cita?: string | null;
  contexto?: string | null;
  reunion?: string | null;
}

export function promptDeteccion(alcance: AlcanceParaDeteccion, repos: RepoParaCatalogo[]): string {
  return [
    "ALCANCE",
    `  Título: ${alcance.titulo}`,
    alcance.descripcion ? `  Descripción: ${alcance.descripcion}` : "",
    alcance.cita ? `  Cita del apunte: "${alcance.cita}"` : "",
    alcance.contexto ? `  Contexto del usuario: ${alcance.contexto}` : "",
    alcance.reunion ? `  Reunión: ${alcance.reunion}` : "",
    "",
    "REPOS DISPONIBLES",
    serializarRepos(repos),
    "",
    "ACOPLAMIENTOS CONOCIDOS",
    serializarFronteras(repos),
    "",
    "Elegí a qué repos les corresponde este alcance.",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export const SYSTEM_DETECCION = [
  "Elegís a qué repositorios de código les corresponde un alcance de trabajo.",
  "Recibís el alcance y un catálogo de repos con qué hace cada uno y qué expone o consume.",
  "Para cada repo que corresponda, indicá el id de 8 caracteres, el papel y el motivo.",
  "`principal` es el repo donde nace el cambio: si no cambia, el alcance no existe.",
  "`dependiente` es el que solo hay que ajustar porque otro cambió.",
  "Marcá como principal solo aquel que de verdad es dueño del cambio; ante la duda, dependiente.",
  "Si evaluaste un repo y lo descartaste, ponelo en `excluidos` con el motivo.",
  "Si el alcance es ambiguo y no podés decidir, no inventes repos: escribí la pregunta en `duda`.",
  "Si el alcance no toca código de ningún repo, devolvé la lista vacía y explicá por qué en `duda`.",
  "Escribí en español neutro de Colombia.",
].join(" ");
