import type { DecisionProvider, DecisionQuestion } from "../infra/llm/types.ts";
import type { TemaPropuesto } from "./contracts.ts";
import { umbralJev } from "./verify-topics.ts";

export type Owner = "me" | "opencode";

export interface Clasificacion {
  owner: Owner;
  /** El mínimo de las tres preguntas: para ser un cambio tienen que pasar las tres. */
  score: number;
  detalle: Record<string, number>;
}

/**
 * ¿Este tema es un cambio de código o un entregable de gestión?
 *
 * Tres preguntas binarias, con criterios explícitos. Se pide una por tema y
 * todas viajan en el mismo request que la verificación de grounding.
 *
 * Un entregable ("reunirse con una persona", "armar el plan del 15 de diciembre") no
 * lo puede desglosar ningún repo: preguntarle a los repos es el error que
 * produjo el desglose inventado.
 */
export function preguntasOwner(temas: TemaPropuesto[]): DecisionQuestion[] {
  return temas.flatMap((t, i) => {
    const contexto = `Tema: "${t.title}". ${t.description ?? ""}`.trim();

    return [
      {
        name: `owner_artefacto_${i}`,
        instructions: [
          contexto,
          "¿El tema nombra algo concreto del sistema (una pantalla, un endpoint, un cálculo,",
          "una integración, una base de datos) en vez de una actividad de gestión como reunirse,",
          "planificar, coordinar o liderar?",
        ].join(" "),
        criteria: {
          true: "El tema se refiere a un componente o comportamiento concreto del producto.",
          false: "El tema es una reunión, un plan, una coordinación o una decisión de gestión.",
        },
      },
      {
        name: `owner_comportamiento_${i}`,
        instructions: [
          contexto,
          "¿El tema describe un comportamiento del producto que hoy falta, está mal o hay que cambiar?",
        ].join(" "),
        criteria: {
          true: "Se puede decir qué hace el sistema hoy y qué debería hacer distinto.",
          false: "No describe un comportamiento del producto; describe una meta, un entregable o una actividad.",
        },
      },
      {
        name: `owner_deploy_${i}`,
        instructions: [
          contexto,
          "¿El tema se puede dar por cumplido con un cambio desplegado, sin depender de que",
          "alguien se reúna o escriba un documento?",
        ].join(" "),
        criteria: {
          true: "Se comprueba con un commit, un deploy o un artefacto del sistema en funcionamiento.",
          false: "Se comprueba con una reunión hecha, un acta o un plan escrito.",
        },
      },
    ];
  });
}

/** Interpreta las respuestas de las tres preguntas de un tema. */
export function leerClasificacion(scores: Record<string, number>, i: number): Clasificacion {
  const claves = [`owner_artefacto_${i}`, `owner_comportamiento_${i}`, `owner_deploy_${i}`];
  const valores = claves.map((k) => scores[k]);

  if (valores.some((v) => v === undefined)) {
    // Sin respuesta no se asume código: se manda a gestión y que lo decida el humano.
    return { owner: "me", score: 0, detalle: {} };
  }

  const nums = valores as number[];
  const detalle: Record<string, number> = {
    artefacto: nums[0]!,
    comportamiento: nums[1]!,
    deploy: nums[2]!,
  };
  const score = Math.min(...nums);

  return { owner: score >= umbralJev() ? "opencode" : "me", score, detalle };
}

/**
 * Clasifica temas que ya existen sin dueño (por ejemplo, extraídos antes de
 * que existiera esta distinción). Pide solo las tres preguntas, sin grounding.
 */
export async function clasificarSolo(
  decision: DecisionProvider,
  apunte: string,
  temas: { title: string; description?: string | null }[]
): Promise<Clasificacion[]> {
  if (temas.length === 0) return [];

  const comoPropuesto = temas.map((t) => ({
    title: t.title,
    description: t.description ?? "",
    sourceExcerpt: "",
    scopeSignal: "likely_scope" as const,
    scopeReason: "",
  }));

  const { scores } = await decision.decide(apunte, preguntasOwner(comoPropuesto));
  return temas.map((_, i) => leerClasificacion(scores, i));
}
