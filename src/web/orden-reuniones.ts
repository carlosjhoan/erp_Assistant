/**
 * Orden de las reuniones por urgencia, no por fecha.
 *
 * 1. Las que piden trabajo (temas sin clasificar, o sin extraer).
 * 2. Dentro de esas, las más viejas primero: llevan más tiempo esperando.
 * 3. Las resueltas, las más recientes primero.
 */
export interface ReunionOrdenable {
  id: string;
  occurredAt: Date | null;
}

export interface TemaOrdenable {
  meetingId: string | null;
  status: string;
}

export type Grado = 0 | 1 | 2;

export function gradoDeUrgencia(reunionId: string, temas: TemaOrdenable[]): Grado {
  const propios = temas.filter((t) => t.meetingId === reunionId);
  if (propios.some((t) => t.status === "proposed")) return 2; // tiene trabajo pendiente
  if (propios.length === 0) return 1; // falta extraer
  return 0; // resuelta
}

export function ordenarPorUrgencia<T extends ReunionOrdenable>(reuniones: T[], temas: TemaOrdenable[]): T[] {
  return [...reuniones].sort((a, b) => {
    const ua = gradoDeUrgencia(a.id, temas);
    const ub = gradoDeUrgencia(b.id, temas);
    if (ua !== ub) return ub - ua;

    const fa = a.occurredAt?.getTime() ?? 0;
    const fb = b.occurredAt?.getTime() ?? 0;
    return ua > 0 ? fa - fb : fb - fa;
  });
}
