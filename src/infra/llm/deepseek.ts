import { createDeepSeek } from "@ai-sdk/deepseek";
import { generateText, NoObjectGeneratedError, Output } from "ai";
import type { z } from "zod";
import { clasificarError, type ErrorKind } from "./errors.ts";
import { LlmError, type GenerateResult, type IntentoFallido, type LlmProvider } from "./types.ts";

export interface DeepSeekConfig {
  apiKey: string;
  model: string;
  baseURL?: string;
  thinking?: "enabled" | "disabled";
  /** Intentos totales. 3 = el original + 2 correcciones. */
  maxAttempts?: number;
}

export const INTENTOS_POR_DEFECTO = 3;

/**
 * Error de salida que conserva lo que el modelo escribió. Devolverle su propia
 * respuesta inválida, además del mensaje de error, es lo que hace que corrija
 * rápido: sin eso, el modelo adivina qué falló.
 */
export class SalidaInvalida extends LlmError {
  constructor(
    message: string,
    readonly salida?: string
  ) {
    super(message);
  }
}

/**
 * El error del SDK es genérico ("response did not match schema"): acá se arma
 * con la cadena de causas y los primeros campos que fallaron.
 */
export function describirError(e: unknown): string {
  const partes: string[] = [];
  let actual: unknown = e;

  for (let i = 0; i < 4 && actual; i++) {
    if (actual instanceof Error && actual.message) partes.push(actual.message);
    const issues = (actual as { issues?: { path?: unknown[]; message?: string }[] }).issues;
    if (Array.isArray(issues) && issues.length > 0) {
      for (const issue of issues.slice(0, 4)) {
        partes.push(`${(issue.path ?? []).join(".") || "(raíz)"}: ${issue.message}`);
      }
      break;
    }
    actual = (actual as { cause?: unknown }).cause;
  }

  return [...new Set(partes)].join(" — ") || "error desconocido";
}

/**
 * Reintenta solo lo que se puede arreglar. Un fallo de autenticación o de
 * presupuesto aborta de una: reintentarlo gasta dos veces sin chance.
 *
 * Cuando el fallo es de esquema se le devuelve al modelo su salida anterior.
 */
export async function conReintento<T>(
  prompt: string,
  intentar: (prompt: string) => Promise<T>,
  maxAttempts = INTENTOS_POR_DEFECTO
): Promise<{ value: T; intentos: number; fallos: IntentoFallido[] }> {
  const fallos: IntentoFallido[] = [];
  let promptActual = prompt;

  for (let intento = 1; intento <= maxAttempts; intento++) {
    try {
      return { value: await intentar(promptActual), intentos: intento, fallos };
    } catch (e) {
      const { kind, retriable, status } = clasificarError(e);
      const mensaje = describirError(e);
      fallos.push({ intento, kind, retriable, mensaje });

      if (!retriable || intento === maxAttempts) break;

      const salida = e instanceof SalidaInvalida ? e.salida : undefined;
      promptActual = [
        promptActual,
        "",
        ...(salida ? ["Tu respuesta anterior fue:", salida.slice(0, 4000), ""] : []),
        `No cumplió el esquema (intento ${intento} de ${maxAttempts}). Error:`,
        status ? `[HTTP ${status}] ${mensaje}` : mensaje,
        "Devolvé la salida corregida.",
      ].join("\n");
    }
  }

  const ultimo = fallos[fallos.length - 1];
  throw new LlmError(
    `Falló tras ${fallos.length} intento(s) [${ultimo?.kind ?? "unknown"}]: ${ultimo?.mensaje ?? ""}`
  );
}

export function createDeepSeekProvider(cfg: DeepSeekConfig): LlmProvider {
  const client = createDeepSeek({
    apiKey: cfg.apiKey,
    ...(cfg.baseURL ? { baseURL: cfg.baseURL } : {}),
  });

  return {
    async generate<T>(opts: {
      kind: "compose" | "verify";
      schemaName: string;
      system: string;
      prompt: string;
      schema: z.ZodType<T>;
    }): Promise<GenerateResult<T>> {
      const started = Date.now();

      const { value, intentos, fallos } = await conReintento(
        opts.prompt,
        async (prompt) => {
          try {
            const { output, usage, response } = await generateText({
              model: client(cfg.model),
              system: opts.system,
              prompt,
              output: Output.object({ schema: opts.schema, name: opts.schemaName }),
              providerOptions: {
                deepseek: { thinking: { type: cfg.thinking ?? "disabled" } },
              },
            });
            return {
              data: output as T,
              model: response.modelId ?? cfg.model,
              tokens: usage.totalTokens ?? 0,
            };
          } catch (e) {
            const generado =
              e instanceof NoObjectGeneratedError
                ? e
                : e instanceof Error && e.cause instanceof NoObjectGeneratedError
                  ? e.cause
                  : undefined;

            throw new SalidaInvalida(describirError(e), generado?.text ?? undefined);
          }
        },
        cfg.maxAttempts ?? INTENTOS_POR_DEFECTO
      );

      return { ...value, durationMs: Date.now() - started, intentos, fallos };
    },
  };
}
