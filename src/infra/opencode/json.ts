/**
 * Los agentes de código responden en prosa con JSON adentro. Esto lo saca.
 *
 * Orden: bloque ```json``` → primer objeto balanceado → falla.
 */

/** Devuelve el contenido de un bloque cercado, si lo hay. */
function bloqueCercado(texto: string): string | undefined {
  const re = /```(?:json)?\s*\n([\s\S]*?)```/i;
  const m = re.exec(texto);
  return m?.[1]?.trim();
}

/** Primer objeto `{...}` con llaves balanceadas, respetando strings y escapes. */
export function primerObjeto(texto: string): string | undefined {
  const inicio = texto.indexOf("{");
  if (inicio === -1) return undefined;

  let profundidad = 0;
  let enString = false;
  let escape = false;

  for (let i = inicio; i < texto.length; i++) {
    const c = texto[i];

    if (escape) {
      escape = false;
      continue;
    }
    if (c === "\\") {
      escape = true;
      continue;
    }
    if (c === '"') {
      enString = !enString;
      continue;
    }
    if (enString) continue;

    if (c === "{") profundidad++;
    if (c === "}") {
      profundidad--;
      if (profundidad === 0) return texto.slice(inicio, i + 1);
    }
  }

  return undefined;
}

export class JsonNoEncontrado extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = "JsonNoEncontrado";
  }
}

/** Extrae y parsea el JSON de la respuesta de un agente. */
export function extraerJson<T>(texto: string): T {
  const candidatos = [bloqueCercado(texto), primerObjeto(texto)].filter((c): c is string => Boolean(c));

  if (candidatos.length === 0) {
    throw new JsonNoEncontrado("La respuesta no contiene ningún objeto JSON.");
  }

  let ultimoError = "";
  for (const c of candidatos) {
    try {
      return JSON.parse(c) as T;
    } catch (e) {
      ultimoError = e instanceof Error ? e.message : String(e);
    }
  }

  throw new JsonNoEncontrado(`El JSON encontrado no se pudo parsear: ${ultimoError}`);
}
