import { createDeepSeek } from "@ai-sdk/deepseek";
import { generateText, isStepCount, NoObjectGeneratedError, Output, tool as aiTool } from "ai";
import type { z } from "zod";
import { clasificarError } from "./errors.ts";
import { costoUsd } from "./precio.ts";
import type { TraceFn } from "./trace.ts";
import {
  LlmError,
  type AgentOpts,
  type AgentResult,
  type GenerateResult,
  type IntentoFallido,
  type LlmProvider,
  type PasoAgente,
} from "./types.ts";

export interface DeepSeekConfig {
  apiKey: string;
  model: string;
  baseURL?: string;
  thinking?: "enabled" | "disabled";
  /** Intentos totales. 3 = el original + 2 correcciones. */
  maxAttempts?: number;
  /** Se llama una vez por intento, haya salido bien o mal. */
  trace?: TraceFn;
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
      let intentoActual = 0;

      const { value, intentos, fallos } = await conReintento(
        opts.prompt,
        async (prompt) => {
          intentoActual++;
          const t0 = Date.now();

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

            cfg.trace?.({
              provider: "deepseek",
              // Se tarifa con el modelo configurado: el id servido no está en TARIFAS.
              model: cfg.model,
              attempt: intentoActual,
              status: "ok",
              inputTokens: usage.inputTokens ?? 0,
              outputTokens: usage.outputTokens ?? 0,
              durationMs: Date.now() - t0,
              prompt,
              response: JSON.stringify(output),
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

            const diagnostico = clasificarError(e);
            cfg.trace?.({
              provider: "deepseek",
              model: cfg.model,
              attempt: intentoActual,
              status: "failed",
              errorKind: diagnostico.kind,
              errorDetail: describirError(e),
              durationMs: Date.now() - t0,
              prompt,
              ...(generado?.text ? { response: generado.text } : {}),
            });

            throw new SalidaInvalida(describirError(e), generado?.text ?? undefined);
          }
        },
        cfg.maxAttempts ?? INTENTOS_POR_DEFECTO
      );

      return { ...value, durationMs: Date.now() - started, intentos, fallos };
    },

    async agent(opts: AgentOpts): Promise<AgentResult> {
      const started = Date.now();
      let ultimo = started;

      const tools = Object.fromEntries(
        opts.tools.map((t) => [
          t.name,
          aiTool({
            description: t.description,
            inputSchema: t.input,
            execute: (input: unknown) => t.execute(input),
          }),
        ]),
      );

      const acumulado = (
        steps: readonly { usage: { inputTokens?: number | undefined; outputTokens?: number | undefined } }[]
      ) =>
        steps.reduce(
          (a, s) =>
            a + costoUsd("deepseek", cfg.model, s.usage.inputTokens ?? 0, s.usage.outputTokens ?? 0),
          0
        );

      const r = await generateText({
        model: client(cfg.model),
        system: opts.system,
        messages: opts.messages,
        tools,
        maxRetries: 2,
        stopWhen: [isStepCount(opts.maxSteps), ({ steps }) => acumulado(steps) > opts.topeUsd],
        onStepFinish: (step) => {
          const ahora = Date.now();
          cfg.trace?.({
            provider: "deepseek",
            // Se tarifa con el modelo configurado: el id servido no está en TARIFAS.
            model: cfg.model,
            attempt: 1,
            status: "ok",
            inputTokens: step.usage.inputTokens ?? 0,
            outputTokens: step.usage.outputTokens ?? 0,
            durationMs: ahora - ultimo,
            response: JSON.stringify({
              text: step.text,
              toolCalls: step.toolCalls.map((c) => ({ tool: c.toolName, input: c.input })),
            }),
          });
          ultimo = ahora;
        },
      });

      const usd = acumulado(r.steps);

      const pasos: PasoAgente[] = r.steps.flatMap((s) =>
        s.toolCalls.map((c) => {
          const res = s.toolResults.find((t) => t.toolCallId === c.toolCallId);
          return { tool: c.toolName, input: c.input, output: res?.output, ok: res !== undefined };
        })
      );

      return {
        text: r.text,
        pasos,
        steps: r.steps.length,
        tokens: r.totalUsage.totalTokens ?? 0,
        usd,
        durationMs: Date.now() - started,
        modelo: cfg.model,
        truncado: r.steps.length >= opts.maxSteps || usd > opts.topeUsd,
      };
    },
  };
}
