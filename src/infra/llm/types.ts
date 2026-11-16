import type { z } from "zod";
import type { ErrorKind } from "./errors.ts";

/** Lo que el dominio necesita de un modelo generativo. */
export interface LlmProvider {
  generate<T>(opts: {
    kind: "compose" | "verify";
    /** Nombre del esquema, ayuda al modelo a saber qué está produciendo. */
    schemaName: string;
    system: string;
    prompt: string;
    schema: z.ZodType<T>;
  }): Promise<GenerateResult<T>>;
}

export interface IntentoFallido {
  intento: number;
  kind: ErrorKind;
  retriable: boolean;
  mensaje: string;
}

export interface GenerateResult<T> {
  data: T;
  model: string;
  tokens: number;
  durationMs: number;
  /** Cuántos intentos hicieron falta (1 = salió a la primera). */
  intentos: number;
  /** Detalle de cada intento fallido, para diagnosticar sin adivinar. */
  fallos: IntentoFallido[];
}

/** Una pregunta binaria para Jev. */
export interface DecisionQuestion {
  name: string;
  instructions: string;
}

export interface DecisionResult {
  /** Confianza por pregunta, 0 a 1. */
  scores: Record<string, number>;
  model: string;
  tokens: number;
  durationMs: number;
}

/**
 * Jev no genera texto: decide. Por eso no pasa por el LlmProvider.
 */
export interface DecisionProvider {
  decide(state: string, questions: DecisionQuestion[]): Promise<DecisionResult>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown
  ) {
    super(message);
    this.name = "LlmError";
  }
}
