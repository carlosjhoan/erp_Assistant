/**
 * Guardrail de alcance con Jev. Decide si una pregunta pertenece al ERP antes
 * de gastar el loop del agente. Es un screen: no responde, clasifica.
 */

import type { DecisionQuestion } from "../infra/llm/types.ts";

export const DOMINIO =
  "ERP personal de gestión de trabajo: proyectos, avance semanal (rúbrica), ítems, " +
  "reuniones importadas, diagnóstico técnico y gasto del asistente.";

export const PREGUNTAS_GUARDRAIL: DecisionQuestion[] = [
  {
    name: "es_consulta",
    instructions:
      "¿La 'pregunta' es una consulta o un pedido real de una persona, dirigido a este sistema?",
    criteria: {
      true: "Tiene un tema y un pedido, aunque esté mal escrita, abreviada o dictada",
      false: "Es ruido de teclado, una cadena sin sentido o texto sin intención comunicativa",
    },
  },
  {
    name: "en_alcance",
    instructions: "¿La 'pregunta' pertenece al dominio de este ERP personal?",
    criteria: {
      true: "Trata sobre proyectos, avance, rúbrica semanal, ítems, reuniones, diagnóstico, qué tan sólido o maduro está un proyecto, o gasto del asistente.",
      false: "Es trivia, conocimiento general, finanzas, clima, recetas o cualquier tema ajeno a la gestión de proyectos del usuario.",
    },
  },
  {
    name: "tarea_ajena",
    instructions: "¿La 'pregunta' pide un entregable que NO es del ERP?",
    criteria: {
      true: "Pide un poema, cuento, chiste, código, la traducción de un texto ajeno, trivia, clima, finanzas personales o una receta.",
      false: "Consulta, evalúa, diagnostica, resume, prioriza o redacta un reporte o correo sobre los proyectos del usuario.",
    },
  },
];

export type DecisionGuardrail = "agente" | "rechazar" | "aclarar";

export interface UmbralesGuardrail {
  consulta: number;
  alcance: number;
  tarea: number;
}

export const UMBRALES: UmbralesGuardrail = { consulta: 0.3, alcance: 0.7, tarea: 0.7 };

/** El proveedor actual recibe `state` como string; se manda el contexto como JSON. */
export function estadoGuardrail(pregunta: string): string {
  return JSON.stringify({ pregunta, dominio: DOMINIO });
}

export function decidirGuardrail(
  scores: Record<string, number>,
  u: UmbralesGuardrail = UMBRALES
): { decision: DecisionGuardrail; motivo: string } {
  const es = scores.es_consulta ?? 1;
  const alcance = scores.en_alcance ?? 0;
  const tarea = scores.tarea_ajena ?? 0;

  if (es <= u.consulta) return { decision: "rechazar", motivo: "no es una consulta" };
  if (alcance <= 0.15) return { decision: "rechazar", motivo: "fuera de alcance claro" };
  if (alcance >= u.alcance && tarea >= u.tarea) {
    return { decision: "aclarar", motivo: "mezcla pedido del ERP con tarea ajena" };
  }
  if (alcance >= u.alcance) return { decision: "agente", motivo: "en alcance" };
  if (tarea >= 0.8 && alcance <= 0.3) return { decision: "rechazar", motivo: "tarea ajena clara" };
  return { decision: "aclarar", motivo: "banda media: conviene preguntar" };
}
