import type { DecisionProvider, DecisionQuestion } from "../infra/llm/types.ts";
import type { TemaPropuesto } from "./contracts.ts";

/** Por debajo de esto, el tema va a revisión humana. */
export function umbralJev(): number {
  const v = Number(process.env.JEV_THRESHOLD ?? 0.6);
  return Number.isFinite(v) ? v : 0.6;
}

export interface TemaVerificado {
  tema: TemaPropuesto;
  score: number;
  needsReview: boolean;
}

/**
 * Pregunta si la reunión trató realmente cada tema.
 *
 * Una pregunta por tema, todas en un solo request: el `state` se manda una vez
 * y Jev evalúa las preguntas en paralelo. Preguntar "¿se habló de estos 10
 * temas?" en una sola pregunta es lo que la documentación desaconseja.
 *
 * La cita puede estar parafraseada: no se exige coincidencia literal porque lo
 * que importa es si el tema existió en la conversación, no cómo se escribió.
 */
export async function verificarTemas(
  decision: DecisionProvider,
  apunte: string,
  temas: TemaPropuesto[]
): Promise<TemaVerificado[]> {
  if (temas.length === 0) return [];

  const questions: DecisionQuestion[] = temas.map((t, i) => ({
    name: `tema_${i}`,
    instructions: [
      `¿La reunión trató este tema?`,
      `Tema: "${t.title}".`,
      t.description ? `De qué se trata: ${t.description}` : "",
      "El tema puede estar dicho con otras palabras; no hace falta que aparezca esa frase.",
    ]
      .filter(Boolean)
      .join(" "),
  }));

  const { scores } = await decision.decide(apunte, questions);
  const umbral = umbralJev();

  return temas.map((tema, i) => {
    const score = scores[`tema_${i}`];
    // Sin respuesta no se asume bueno: se marca para revisar.
    if (score === undefined) return { tema, score: 0, needsReview: true };
    return { tema, score, needsReview: score < umbral };
  });
}
