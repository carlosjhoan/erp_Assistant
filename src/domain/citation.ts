/**
 * ¿La cita que devolvió el modelo existe realmente en el apunte?
 *
 * Primero coincide literal; si no, compara palabra por palabra. La idea es
 * tolerar acentos, mayúsculas y puntuación, y rechazar lo inventado.
 */

/** Minúsculas, sin acentos, sin puntuación, espacios colapsados. */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Palabras con peso: descarta artículos y preposiciones cortas. */
function words(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter((w) => w.length >= 4);
}

/** Por debajo de esto, la cita se considera inventada. */
export const CITA_MIN_RATIO = 0.85;

export interface CitaResult {
  found: boolean;
  /** 1 = aparece entera; 0 = no aparece nada. */
  ratio: number;
  /** Palabras de la cita que no están en el apunte. Sirve para explicar. */
  missing: string[];
}

export function excerptAppearsIn(source: string, excerpt: string): CitaResult {
  const src = normalize(source);
  const cit = normalize(excerpt);

  if (!cit) return { found: false, ratio: 0, missing: [] };
  if (src.includes(cit)) return { found: true, ratio: 1, missing: [] };

  const citWords = [...new Set(words(excerpt))];
  if (citWords.length === 0) {
    // Cita tan corta que no tiene palabras con peso: solo vale el literal.
    return { found: false, ratio: 0, missing: [] };
  }

  const srcWords = new Set(words(source));
  const missing = citWords.filter((w) => !srcWords.has(w));
  const ratio = 1 - missing.length / citWords.length;

  return { found: ratio >= CITA_MIN_RATIO, ratio, missing };
}
