/**
 * Contratos de salida del modelo. Nada de texto libre: si no valida, se
 * reintenta una vez devolviéndole el error, y si vuelve a fallar, se aborta.
 */
import { z } from "zod";

const ReglasComunes = {
  sourceExcerpt: z
    .string()
    .min(10)
    .max(500)
    .describe("Cita literal del apunte que respalda esto. Sin parafrasear."),
};

/* ---------- extracción de temas ---------- */

export const TemaPropuesto = z.object({
  title: z.string().min(5).max(80).describe("Título corto del tema"),
  description: z.string().min(20).max(600).describe("De 2 a 4 frases"),
  ...ReglasComunes,
  scopeSignal: z
    .enum(["likely_scope", "idea_context"])
    .describe(
      "likely_scope solo con señal clara: compromiso explícito, fecha, entregable nombrado o algo asignado a mí. Si no, idea_context."
    ),
  scopeReason: z.string().max(200).describe("Una frase que justifica la señal"),
  openQuestions: z.array(z.string().max(200)).max(5).optional().describe("Lo que quedó ambiguo"),
});

export const ExtraccionTemas = z.object({
  // Cero temas es un caso válido: la reunión no tenía nada accionable.
  topics: z.array(TemaPropuesto).max(10),
  // Solo se llenan cuando topics está vacío. El CLI arma el mensaje con esto.
  emptyReason: z
    .string()
    .max(300)
    .optional()
    .describe("Solo si no hay temas: en una frase, por qué no hay nada accionable"),
  conversationTopics: z
    .array(z.string().max(80))
    .max(10)
    .optional()
    .describe("Solo si no hay temas: de qué se habló, en etiquetas cortas"),
});

export type TemaPropuesto = z.infer<typeof TemaPropuesto>;
export type ExtraccionTemas = z.infer<typeof ExtraccionTemas>;

/* ---------- desglose en ítems ---------- */

export const ItemPropuesto = z.object({
  title: z.string().min(8).max(120).describe("Verbo + objeto concreto"),
  description: z.string().max(600).optional(),
  acceptanceCriteria: z
    .string()
    .min(15)
    .max(400)
    .describe("Cómo se comprueba que está hecho, mirando un artefacto. Nunca una intención."),
  suggestedType: z.enum(["code", "contact", "research", "other"]),
  ...ReglasComunes,
});

export const DesgloseTema = z.object({
  // Sin mínimo forzado: si el tema se resuelve en dos tareas, son dos.
  items: z.array(ItemPropuesto).min(1).max(12),
});

export type ItemPropuesto = z.infer<typeof ItemPropuesto>;
export type DesgloseTema = z.infer<typeof DesgloseTema>;

/* ---------- detección de repos ---------- */

export const RepoElegido = z.object({
  repoId: z.string().length(8).describe("El id de 8 caracteres del catálogo, nunca el nombre"),
  papel: z
    .enum(["principal", "dependiente"])
    .describe("principal si el cambio nace ahí; dependiente si solo hay que ajustarlo porque otro cambió"),
  motivo: z.string().max(200).describe("Por qué este repo queda involucrado, en una frase"),
});

export const DeteccionRepos = z.object({
  repos: z.array(RepoElegido).max(8),
  excluidos: z
    .array(z.object({ repoId: z.string().length(8), motivo: z.string().max(160) }))
    .optional()
    .describe("Los que evaluaste y descartaste, con el motivo. Silencio no es lo mismo que 'no aplica'."),
  duda: z
    .string()
    .max(300)
    .optional()
    .describe("Solo si el alcance es ambiguo y no podés decidir a quién corresponde sin preguntarme"),
});

export type RepoElegido = z.infer<typeof RepoElegido>;
export type DeteccionRepos = z.infer<typeof DeteccionRepos>;
