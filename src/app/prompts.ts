/**
 * Prompts versionados. Cambiarlos es cambiar el comportamiento del producto,
 * así que viven acá y no escondidos en un servicio.
 */

export const SYSTEM_EXTRACCION = [
  "Convertís el apunte de una reunión en los temas que se hablaron.",
  "Cada tema es un asunto concreto, no una categoría.",
  "Marcá `likely_scope` solo cuando hay señal clara de que se espera para la próxima semana:",
  "compromiso explícito, una fecha, un entregable nombrado o algo asignado a una persona.",
  "Si no hay señal, usá `idea_context`.",
  "Cada tema lleva una cita literal del apunte: copiá la frase tal como aparece, sin parafrasear.",
  "Si algo quedó ambiguo, escribilo en `open_questions` en vez de inventar una decisión.",
  "Fusioná temas casi iguales. No propongas más de diez.",
  "Si la reunión no tuvo nada accionable, devolvé una lista vacía.",
  "Escribí en español neutro de Colombia.",
].join(" ");

export function promptExtraccion(apunte: {
  titulo: string;
  fecha: string;
  participantes: string[];
  summary: string;
}): string {
  return [
    `Reunión: "${apunte.titulo}" — ${apunte.fecha}`,
    `Participantes: ${apunte.participantes.length > 0 ? apunte.participantes.join(", ") : "no registrados"}`,
    "",
    "Apunte:",
    "<summary>",
    apunte.summary,
    "</summary>",
    "",
    "Extraé los temas de esta reunión.",
  ].join("\n");
}

export const SYSTEM_DESGLOSE = [
  "Desglosás un tema en las tareas necesarias para cumplirlo.",
  "Cada tarea es atómica: una sola cosa, que se pueda dar por hecha sin ambigüedad.",
  "El criterio de aceptación dice cómo se comprueba mirando un artefacto concreto",
  "(un commit, un acta, un documento, una medición). Nunca una intención.",
  "Cada tarea lleva una cita literal del apunte que la respalda, sin parafrasear.",
  "Usá solo lo que dice el apunte: no agregues trabajo que no se habló.",
  "Clasificá por tipo: `code` (código o configuración), `contact` (conseguir algo con alguien),",
  "`research` (investigar o medir), `other` (el resto).",
  "Si el tema se resuelve en dos tareas, son dos. No rellenes para llegar a un número.",
  "Escribí en español neutro de Colombia.",
].join(" ");

export function promptDesglose(tema: { titulo: string; descripcion?: string | null; cita?: string | null }, apunte: string): string {
  return [
    `Tema: ${tema.titulo}`,
    tema.descripcion ? `Qué significa: ${tema.descripcion}` : "",
    tema.cita ? `Cita del apunte: "${tema.cita}"` : "",
    "",
    "Apunte completo:",
    "<summary>",
    apunte,
    "</summary>",
    "",
    "Desglosá este tema en las tareas necesarias para cumplirlo.",
  ]
    .filter((l) => l !== "")
    .join("\n");
}
