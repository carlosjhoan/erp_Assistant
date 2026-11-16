import type { z } from "zod";

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

export interface GenerateResult<T> {
  data: T;
  model: string;
  tokens: number;
  durationMs: number;
  /** Cuántas veces hubo que reintentar por salida inválida. */
  retries: number;
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
