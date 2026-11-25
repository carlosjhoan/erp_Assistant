import type { ToolParaAgente } from "../../infra/llm/types.ts";

export type Vista = "proyecto" | "semana" | "reuniones";

export interface ToolDef extends ToolParaAgente {
  /** false = lectura pura. true = propone y espera aprobación (F4). */
  sideEffect: boolean;
  /** Vista que conviene mostrar si esta tool fue la principal del turno. */
  ref?(input: unknown, output: unknown): { vista: Vista; id: string | null } | null;
}

/** Envoltura de lista: `total` es el real, `items` puede venir recortado. */
export interface Lista<T> {
  items: T[];
  total: number;
  truncado: boolean;
}

export const lista = <T>(items: T[], total = items.length): Lista<T> => ({
  items,
  total,
  truncado: items.length < total,
});

/** Error devuelto, no lanzado: deja que el modelo corrija el id. */
export const fallo = (error: string) => ({ error });

/** Extracto alrededor de la coincidencia, para que el modelo cite. */
export function recorte(texto: string, termino: string, ancho = 200): string {
  const i = texto.toLowerCase().indexOf(termino.toLowerCase());
  if (i < 0) return texto.slice(0, ancho);
  const desde = Math.max(0, i - Math.floor(ancho / 3));
  const hasta = desde + ancho;
  return `${desde > 0 ? "…" : ""}${texto.slice(desde, hasta)}${hasta < texto.length ? "…" : ""}`;
}
