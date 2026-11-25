/** Topes del loop del asistente. Se leen del entorno, con default sensato. */

const entero = (v: string | undefined, def: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : def;
};

const usd = (v: string | undefined, def: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : def;
};

export const maxSteps = () => entero(process.env.CONSULTA_MAX_STEPS, 6);
export const topeTurno = () => usd(process.env.CONSULTA_MAX_USD_TURNO, 0.05);
export const topeDia = () => usd(process.env.CONSULTA_MAX_USD_DIA, 2);

/** Puro y testeable: el loop corta sin depender de la base. */
export function excedido(gastado: number, tope: number): boolean {
  return gastado > tope;
}
