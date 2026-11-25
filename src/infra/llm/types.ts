import type { z } from "zod";
import type { ErrorKind } from "./errors.ts";

/**
 * Lo mínimo que el proveedor necesita saber de una tool.
 * El contrato completo (sideEffect, ref) vive en `app/tools/tool.ts`: así infra
 * no depende de app.
 */
export interface ToolParaAgente {
  name: string;
  description: string;
  input: z.ZodType<unknown>;
  execute(input: unknown): unknown | Promise<unknown>;
}

export interface AgentOpts {
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  tools: ToolParaAgente[];
  /** Tope duro de pasos del loop. */
  maxSteps: number;
  /** Tope de gasto del turno, en dólares. */
  topeUsd: number;
}

export interface PasoAgente {
  tool: string;
  input: unknown;
  output: unknown;
  ok: boolean;
}

export interface AgentResult {
  text: string;
  pasos: PasoAgente[];
  steps: number;
  tokens: number;
  usd: number;
  durationMs: number;
  modelo: string;
  /** true si cortó por `maxSteps` o por `topeUsd` antes de la respuesta final. */
  truncado: boolean;
}

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

  /** Loop de tools con presupuesto. */
  agent(opts: AgentOpts): Promise<AgentResult>;
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
  /** Qué cuenta como sí y qué como no. Afina la respuesta del modelo. */
  criteria?: { true: string; false: string };
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
