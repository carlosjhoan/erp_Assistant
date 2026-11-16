import { LlmError, type DecisionProvider, type DecisionQuestion, type DecisionResult } from "./types.ts";

export interface JevConfig {
  apiKey: string;
  model: string;
  baseURL?: string;
  timeoutMs?: number;
}

/** Cuerpo exacto que espera POST /v1/systemone. */
export function construirPeticion(model: string, state: string, questions: DecisionQuestion[]) {
  return {
    model,
    state,
    questions: Object.fromEntries(
      questions.map((q) => [q.name, { type: "noul" as const, instructions: q.instructions }])
    ),
  };
}

interface RespuestaJev {
  model?: unknown;
  answers?: unknown;
  usage?: { input_tokens?: unknown; output_tokens?: unknown };
}

/**
 * Extrae la confianza por pregunta. Se queda solo con las preguntas que se
 * hicieron: si el modelo devuelve una de más, se ignora.
 */
export function leerRespuesta(
  body: RespuestaJev,
  questions: DecisionQuestion[],
  modelEsperado: string
): { scores: Record<string, number>; model: string; tokens: number; faltantes: string[] } {
  const answers = (body.answers ?? {}) as Record<string, { noul?: unknown } | undefined>;
  const scores: Record<string, number> = {};
  const faltantes: string[] = [];

  for (const q of questions) {
    const noul = answers[q.name]?.noul;
    if (typeof noul === "number" && Number.isFinite(noul)) scores[q.name] = noul;
    else faltantes.push(q.name);
  }

  return {
    scores,
    model: typeof body.model === "string" ? body.model : modelEsperado,
    tokens: typeof body.usage?.input_tokens === "number" ? body.usage.input_tokens : 0,
    faltantes,
  };
}

/**
 * Jev no es compatible con OpenAI ni genera texto: recibe un `state` y un mapa
 * de preguntas tipadas. Por eso va por HTTP directo y no por el AI SDK.
 */
export function createJevProvider(cfg: JevConfig): DecisionProvider {
  const baseURL = (cfg.baseURL ?? "https://api.typesafe.ai").replace(/\/$/, "");

  return {
    async decide(state: string, questions: DecisionQuestion[]): Promise<DecisionResult> {
      if (questions.length === 0) return { scores: {}, model: cfg.model, tokens: 0, durationMs: 0 };

      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 30_000);

      try {
        const res = await fetch(`${baseURL}/v1/systemone`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
          signal: controller.signal,
          body: JSON.stringify(construirPeticion(cfg.model, state, questions)),
        });

        if (!res.ok) {
          const texto = await res.text().catch(() => "");
          throw new LlmError(`Jev devolvió ${res.status}: ${texto.slice(0, 300)}`);
        }

        const body = (await res.json()) as RespuestaJev;
        const leida = leerRespuesta(body, questions, cfg.model);

        if (leida.faltantes.length > 0) {
          throw new LlmError(`Jev no respondió: ${leida.faltantes.join(", ")}`);
        }

        return { ...leida, durationMs: Date.now() - started };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
