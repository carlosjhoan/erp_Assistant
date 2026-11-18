import type { DecisionProvider, DecisionQuestion } from "../infra/llm/types.ts";
import type { TemaPropuesto } from "./contracts.ts";
import { leerClasificacion, preguntasOwner, type Clasificacion } from "./classify-topic.ts";

/** Por debajo de esto, el tema va a revisión humana. */
export function umbralJev(): number {
  const v = Number(process.env.JEV_THRESHOLD ?? 0.6);
  return Number.isFinite(v) ? v : 0.6;
}

export interface TemaVerificado {
  tema: TemaPropuesto;
  score: number;
  needsReview: boolean;
  clasificacion: Clasificacion;
}

/**
 * Verifica los temas en UNA sola llamada a Jev, con cuatro preguntas por tema:
 *
 *  - `tema_i`: ¿la reunión lo trató? (grounding; la cita puede estar parafraseada)
 *  - `owner_*_i`: ¿es un cambio de código o un entregable de gestión?
 *
 * El `state` se manda una vez y Jev evalúa todas las preguntas en paralelo.
 * Preguntar "¿se habló de estos 10 temas?" en una sola pregunta es lo que la
 * documentación desaconseja: se degrada cuando hay varios juicios adentro.
 */
export async function verificarTemas(
  decision: DecisionProvider,
  apunte: string,
  temas: TemaPropuesto[]
): Promise<TemaVerificado[]> {
  if (temas.length === 0) return [];

  const grounding: DecisionQuestion[] = temas.map((t, i) => ({
    name: `tema_${i}`,
    instructions: [
      "¿La reunión trató este tema?",
      `Tema: "${t.title}".`,
      t.description ? `De qué se trata: ${t.description}` : "",
      "El tema puede estar dicho con otras palabras; no hace falta que aparezca esa frase.",
    ]
      .filter(Boolean)
      .join(" "),
  }));

  const { scores } = await decision.decide(apunte, [...grounding, ...preguntasOwner(temas)]);
  const umbral = umbralJev();

  return temas.map((tema, i) => {
    const clasificacion = leerClasificacion(scores, i);
    const score = scores[`tema_${i}`];

    // Sin respuesta no se asume bueno: se marca para revisar.
    if (score === undefined) return { tema, score: 0, needsReview: true, clasificacion };

    return { tema, score, needsReview: score < umbral, clasificacion };
  });
}
