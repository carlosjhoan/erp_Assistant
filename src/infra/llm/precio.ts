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
  // Jev cobra por token de entrada ($42/Btok = $0.042/Mtok). Salida gratis.
  "jev-latest": { entrada: 0.042, salida: 0 },
  "jev-1.14.0": { entrada: 0.042, salida: 0 },
  "jev-1.13.0": { entrada: 0.042, salida: 0 },
};

/**
 * Tarifa plana opcional por llamada. Solo se usa si se configura con un valor
 * positivo; si no, Jev cae a la tarifa por token.
 */
const POR_LLAMADA: Record<string, number> = {};
const jevPlano = Number(process.env.JEV_USD_PER_CALL);
if (Number.isFinite(jevPlano) && jevPlano > 0) POR_LLAMADA.jev = jevPlano;

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
