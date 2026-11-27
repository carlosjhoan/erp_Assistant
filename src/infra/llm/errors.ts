/**
 * Clasificación de fallos de un modelo.
 *
 * Regla: no todo se reintenta. Un 401 reintentado es dinero tirado y un error
 * de esquema sí se corrige con feedback. Cada categoría tiene su política.
 */

export const ERROR_KINDS = [
  "schema", // la salida no cumplió el esquema
  "rate_limit", // 429
  "auth", // 401 / 403
  "network", // timeout, DNS, conexión cortada
  "server", // 5xx
  "budget", // contexto o tokens agotados
  "unknown",
] as const;

export type ErrorKind = (typeof ERROR_KINDS)[number];

export interface Diagnostico {
  kind: ErrorKind;
  retriable: boolean;
  /** Código HTTP si lo hubo. Ayuda a leer la traza. */
  status?: number;
}

/** Lee el status HTTP de la cadena de causas, sin atarse a una clase del SDK. */
function statusDe(e: unknown): number | undefined {
  let actual: unknown = e;
  for (let i = 0; i < 5 && actual; i++) {
    const status = (actual as { statusCode?: unknown; status?: unknown }).statusCode ?? (actual as { status?: unknown }).status;
    if (typeof status === "number") return status;
    actual = (actual as { cause?: unknown }).cause;
  }
  return undefined;
}

function pareceDeRed(e: unknown): boolean {
  let actual: unknown = e;
  for (let i = 0; i < 5 && actual; i++) {
    if (actual instanceof Error) {
      const code = (actual as { code?: unknown }).code;
      if (typeof code === "string" && /ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|UND_ERR/i.test(code)) {
        return true;
      }
      if (/fetch failed|socket hang up|timeout|aborted/i.test(actual.message)) return true;
    }
    actual = (actual as { cause?: unknown }).cause;
  }
  return false;
}

export function clasificarError(e: unknown): Diagnostico {
  const nombre = e instanceof Error ? e.constructor.name : "";
  const mensaje = e instanceof Error ? e.message : String(e);
  const status = statusDe(e);

  // Esquema: es el caso que sí se corrige devolviéndole la salida al modelo.
  if (nombre === "NoObjectGeneratedError" || /did not match schema|TypeValidation|invalid_type/i.test(mensaje)) {
    return { kind: "schema", retriable: true };
  }

  if (status === 401 || status === 403) return { kind: "auth", retriable: false, ...(status ? { status } : {}) };
  // 402 Payment Required: OpenRouter sin créditos. Reintentar no lo arregla.
  if (status === 402) return { kind: "budget", retriable: false, status };
  if (status === 429) return { kind: "rate_limit", retriable: true, status };
  if (status === 400 && /context|token|too long|maximum/i.test(mensaje)) return { kind: "budget", retriable: false, status };
  if (status !== undefined && status >= 500) return { kind: "server", retriable: true, status };
  if (status !== undefined && status >= 400) return { kind: "unknown", retriable: false, status };

  if (/maximum context|context length|too many tokens|token limit/i.test(mensaje)) {
    return { kind: "budget", retriable: false };
  }

  if (pareceDeRed(e)) return { kind: "network", retriable: true };

  return { kind: "unknown", retriable: true };
}
