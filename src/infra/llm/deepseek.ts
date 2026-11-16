import { createDeepSeek } from "@ai-sdk/deepseek";
import { generateText, NoObjectGeneratedError, Output } from "ai";
import type { z } from "zod";
import { LlmError, type GenerateResult, type LlmProvider } from "./types.ts";

export interface DeepSeekConfig {
  apiKey: string;
  model: string;
  baseURL?: string;
  /** `disabled` para salida estructurada predecible. */
  thinking?: "enabled" | "disabled";
}

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
 * Un solo reintento: se le devuelve al modelo su salida anterior y el error.
 * Si vuelve a fallar, se aborta con el motivo. Nunca se "arregla" la salida
 * a mano: una salida inventada es peor que un error visible.
 */
export async function conReintento<T>(
  prompt: string,
  intentar: (prompt: string) => Promise<T>
): Promise<{ value: T; retries: number }> {
  let ultimoError = "";

  for (let attempt = 0; attempt <= 1; attempt++) {
    try {
      return { value: await intentar(prompt), retries: attempt };
    } catch (e) {
      ultimoError = e instanceof Error ? e.message : String(e);
      if (attempt === 1) break;

      const salida = e instanceof SalidaInvalida ? e.salida : undefined;
      prompt = [
        prompt,
        "",
        ...(salida ? ["Tu respuesta anterior fue:", salida.slice(0, 4000), ""] : []),
        "No cumplió el esquema. Error:",
        ultimoError,
        "Devolvé la salida corregida.",
      ].join("\n");
    }
  }

  throw new LlmError(`La salida del modelo no validó tras un reintento: ${ultimoError}`);
}

/**
 * Modelo generativo detrás del wrapper del AI SDK: cambiar de proveedor es
 * cambiar este archivo, no los servicios.
 */
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

      const { value, retries } = await conReintento(opts.prompt, async (prompt) => {
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
          // El SDK puede envolver el error: se busca en el cause también.
          const generado =
            e instanceof NoObjectGeneratedError
              ? e
              : e instanceof Error && e.cause instanceof NoObjectGeneratedError
                ? e.cause
                : undefined;

          throw new SalidaInvalida(
            e instanceof Error ? e.message : String(e),
            generado?.text ?? undefined
          );
        }
      });

      return { ...value, durationMs: Date.now() - started, retries };
    },
  };
}
