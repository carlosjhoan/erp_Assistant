/**
 * Costo por llamada, en dólares.
 *
 * Los valores por defecto son de referencia y se pueden pisar por entorno:
 * si el proveedor cambia la tarifa, esto no debe requerir tocar código.
 * Jev no informa tokens: se cobra por llamada, así que va tarifa plana.
 */

const num = (v: string | undefined, porDefecto: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : porDefecto;
};

const TARIFAS: Record<string, { entrada: number; salida: number }> = {
  // USD por millón de tokens.
  "deepseek-flash": {
    entrada: num(process.env.DEEPSEEK_INPUT_USD_PER_M, 0.28),
    salida: num(process.env.DEEPSEEK_OUTPUT_USD_PER_M, 0.42),
  },
};

/** Jev cobra por llamada, no por token. */
const POR_LLAMADA: Record<string, number> = {
  jev: num(process.env.JEV_USD_PER_CALL, 0),
};

export function costoUsd(
  provider: string,
  model: string | undefined,
  entrada: number | undefined,
  salida: number | undefined,
): number {
  const fija = POR_LLAMADA[provider];
  if (fija !== undefined) return fija;

  const tarifa = model ? TARIFAS[model] : undefined;
  if (!tarifa) return 0;

  return ((entrada ?? 0) / 1_000_000) * tarifa.entrada + ((salida ?? 0) / 1_000_000) * tarifa.salida;
}
