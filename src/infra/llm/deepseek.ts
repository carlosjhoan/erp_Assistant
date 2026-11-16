import { createDeepSeek } from "@ai-sdk/deepseek";
import { generateText, Output } from "ai";
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
 * Un solo reintento: se le devuelve el error al modelo para que corrija.
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
      prompt = [
        prompt,
        "",
        "Tu respuesta anterior no cumplió el esquema. Error:",
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
      });

      return { ...value, durationMs: Date.now() - started, retries };
    },
  };
}
