import type { DecisionProvider, DecisionQuestion } from "../infra/llm/types.ts";
import type { ItemPropuesto } from "./contracts.ts";
import { umbralJev } from "./verify-topics.ts";

export interface ItemVerificado {
  item: ItemPropuesto;
  score: number;
  needsReview: boolean;
  detalle: Record<string, number>;
}

/**
 * Verifica los ítems de un tema. Dos preguntas por ítem, todas en una llamada:
 *
 *  - `hablado`: ¿la reunión trató esto? Mide grounding, no coincidencia literal.
 *  - `criterio`: ¿el criterio se comprueba mirando un artefacto?
 *
 * El puntaje del ítem es el **mínimo**, no el promedio: alcanza con que una
 * falle para que valga la pena revisarlo.
 */
export async function verificarItems(
  decision: DecisionProvider,
  apunte: string,
  items: ItemPropuesto[]
): Promise<ItemVerificado[]> {
  if (items.length === 0) return [];

  const questions: DecisionQuestion[] = items.flatMap((item, i) => [
    {
      // Un ítem es una ACCIÓN, no algo que se conversó. Preguntar "¿se habló de
      // esto?" da falsos negativos: la reunión habla de metas, el ítem es el paso.
      // La pregunta correcta es si el apunte lo respalda.
      name: `respaldado_${i}`,
      instructions: [
        `¿El apunte respalda esta tarea?`,
        `Tarea: "${item.title}".`,
        `Criterio de aceptación: ${item.acceptanceCriteria}.`,
        "Respondé que sí si la tarea se deriva de un compromiso, un entregable, un problema o una",
        "responsabilidad que aparece en el apunte, aunque esté dicha con otras palabras.",
        "Respondé que no si la tarea introduce trabajo que nadie mencionó.",
      ].join(" "),
      criteria: {
        true: "La tarea es una consecuencia razonable de algo que se habló en la reunión.",
        false: "La tarea introduce trabajo, alcance o detalle que el apunte no respalda.",
      },
    },
    {
      name: `criterio_${i}`,
      instructions: [
        "¿El criterio de aceptación se puede comprobar mirando un artefacto concreto",
        "(commit, acta, documento, medición, agenda)?",
        `Criterio: ${item.acceptanceCriteria}.`,
      ].join(" "),
      criteria: {
        true: "Alguien puede mirar un artefacto y decir si está hecho o no.",
        false: "El criterio depende de una intención, una opinión o algo que no deja rastro.",
      },
    },
  ]);

  const { scores } = await decision.decide(apunte, questions);
  const umbral = umbralJev();

  return items.map((item, i) => {
    const hablado = scores[`respaldado_${i}`];
    const criterio = scores[`criterio_${i}`];

    // Sin respuesta no se asume bueno.
    if (hablado === undefined || criterio === undefined) {
      const detalle: Record<string, number> = {};
      if (hablado !== undefined) detalle.respaldado = hablado;
      if (criterio !== undefined) detalle.criterio = criterio;
      return { item, score: 0, needsReview: true, detalle };
    }

    const score = Math.min(hablado, criterio);
    return {
      item,
      score,
      needsReview: score < umbral,
      detalle: { respaldado: hablado, criterio },
    };
  });
}
