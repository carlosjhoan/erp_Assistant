import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, isStepCount, NoObjectGeneratedError, Output, tool as aiTool } from "ai";
import type { z } from "zod";
import { clasificarError } from "./errors.ts";
import { conReintento, describirError, INTENTOS_POR_DEFECTO, SalidaInvalida } from "./deepseek.ts";
import type { TraceFn } from "./trace.ts";
import type {
  AgentOpts,
  AgentResult,
  GenerateResult,
  LlmProvider,
  PasoAgente,
} from "./types.ts";

export interface OpenRouterConfig {
  apiKey: string;
  /** Slug de OpenRouter: proveedor/modelo, por ejemplo deepseek/deepseek-v4.1-flash. */
  model: string;
  /** Preferencia de ruteo. Default: price. */
  sort?: "price" | "throughput" | "latency";
  /** Esfuerzo de razonamiento. Default: none, para JSON predecible. */
  reasoning?: "none" | "low" | "high";
  appName?: string;
  appUrl?: string;
  maxAttempts?: number;
  trace?: TraceFn;
}

type MetaOpenRouter = { openrouter?: { usage?: { cost?: number } } };

/** OpenRouter devuelve el costo real por respuesta; es la fuente de verdad. */
function costoDe(meta: unknown): number | undefined {
  const c = (meta as MetaOpenRouter | undefined)?.openrouter?.usage?.cost;
  return typeof c === "number" ? c : undefined;
}

const costoDePasos = (steps: readonly { providerMetadata?: unknown }[]) =>
  steps.reduce((a, s) => a + (costoDe(s.providerMetadata) ?? 0), 0);

export function createOpenRouterProvider(cfg: OpenRouterConfig): LlmProvider {
  const cliente = createOpenRouter({
    apiKey: cfg.apiKey,
    ...(cfg.appName ? { appName: cfg.appName } : {}),
    ...(cfg.appUrl ? { appUrl: cfg.appUrl } : {}),
  });

  const modelo = cliente(cfg.model, {
    provider: { sort: cfg.sort ?? "price" },
    usage: { include: true },
  });

  const opciones = { openrouter: { reasoning_effort: cfg.reasoning ?? "none" } };

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
            const { output, usage, response, providerMetadata } = await generateText({
              model: modelo,
              system: opts.system,
              prompt,
              output: Output.object({ schema: opts.schema, name: opts.schemaName }),
              providerOptions: opciones,
            });

            const costo = costoDe(providerMetadata);
            cfg.trace?.({
              provider: "openrouter",
              model: cfg.model,
              attempt: intentoActual,
              status: "ok",
              inputTokens: usage.inputTokens ?? 0,
              outputTokens: usage.outputTokens ?? 0,
              durationMs: Date.now() - t0,
              ...(costo !== undefined ? { costUsd: costo } : {}),
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
              provider: "openrouter",
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
        ])
      );

      const r = await generateText({
        model: modelo,
        system: opts.system,
        messages: opts.messages,
        tools,
        maxRetries: 2,
        stopWhen: [isStepCount(opts.maxSteps), ({ steps }) => costoDePasos(steps) > opts.topeUsd],
        providerOptions: opciones,
        onStepFinish: (step) => {
          const ahora = Date.now();
          const costo = costoDe(step.providerMetadata);
          cfg.trace?.({
            provider: "openrouter",
            model: cfg.model,
            attempt: 1,
            status: "ok",
            inputTokens: step.usage.inputTokens ?? 0,
            outputTokens: step.usage.outputTokens ?? 0,
            durationMs: ahora - ultimo,
            ...(costo !== undefined ? { costUsd: costo } : {}),
            response: JSON.stringify({
              text: step.text,
              toolCalls: step.toolCalls.map((c) => ({ tool: c.toolName, input: c.input })),
            }),
          });
          ultimo = ahora;
        },
      });

      const usd = costoDePasos(r.steps);

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
