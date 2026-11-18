import { createOpencodeClient } from "@opencode-ai/sdk";
import { compararSnapshots, estaContaminado, snapshot } from "./git-guard.ts";
import { OpenCodeError, type RepoWorker, type WorkerMode, type WorkerRequest, type WorkerResult } from "./types.ts";

export interface OpenCodeConfig {
  baseUrl: string;
  provider: string;
  model: string;
  /** Agente de solo lectura. Obligatorio. */
  agentExplore: string;
  /** Agente con permiso de escritura. No se usa en modo explore. */
  agentEdit: string;
  timeoutMs: number;
}

/**
 * Validación previa: confundir los dos agentes mandaría el broadcast a un
 * agente con permiso de escritura. Se corta antes de llamar.
 */
export function resolverAgente(cfg: OpenCodeConfig, mode: WorkerMode): string {
  const agente = mode === "explore" ? cfg.agentExplore : cfg.agentEdit;

  if (!agente?.trim()) {
    throw new OpenCodeError(
      mode === "explore"
        ? "Falta OPENCODE_AGENT_TO_EXPLORE. El broadcast no corre sin un agente de solo lectura."
        : "Falta OPENCODE_AGENT_TO_EDIT."
    );
  }
  if (mode === "explore" && agente === cfg.agentEdit) {
    throw new OpenCodeError(
      `OPENCODE_AGENT_TO_EXPLORE vale "${agente}", el mismo que el de edición. El broadcast exige un agente de solo lectura distinto.`
    );
  }

  return agente;
}

interface Parte {
  type: string;
  text?: string;
}

interface RespuestaPrompt {
  info?: {
    error?: unknown;
    providerID?: string;
    modelID?: string;
    tokens?: { input?: number; output?: number };
  };
  parts?: Parte[];
}

interface ErrorEnvelope {
  name?: string;
  data?: { message?: string; ref?: string };
}

/**
 * Se declara solo lo que usamos. Los tipos generados del SDK cambian entre
 * versiones (v1 sin prefijo, v2 con /api); esto se apoya en lo que verificamos
 * contra el servidor real.
 */
interface ClienteLaxo {
  session: {
    create(input: { title?: string }): Promise<{ data?: { id: string }; error?: ErrorEnvelope }>;
    prompt(input: {
      path: { id: string };
      body: { agent: string; model: { providerID: string; modelID: string }; parts: Parte[] };
    }): Promise<{ data?: RespuestaPrompt; error?: ErrorEnvelope }>;
  };
}

export function createOpenCodeWorker(cfg: OpenCodeConfig): RepoWorker {
  return {
    async run(req: WorkerRequest): Promise<WorkerResult> {
      const agente = resolverAgente(cfg, req.mode);

      // El directory va en el cliente: el servidor lo toma de ahí, no de create().
      const client = createOpencodeClient({
        baseUrl: cfg.baseUrl,
        directory: req.repoPath,
      }) as unknown as ClienteLaxo;

      const antes = req.mode === "explore" ? snapshot(req.repoPath) : undefined;
      const started = Date.now();

      let sessionId = req.sessionId;
      if (!sessionId) {
        const creada = await client.session.create({ title: "ERP · desglose" });
        if (creada.error || !creada.data?.id) {
          throw new OpenCodeError(
            `No se pudo crear la sesión de OpenCode: ${creada.error?.data?.message ?? "sin id"}`,
            creada.error?.data?.ref
          );
        }
        sessionId = creada.data.id;
      }

      const res = await client.session.prompt({
        path: { id: sessionId },
        body: {
          agent: agente,
          model: { providerID: cfg.provider, modelID: cfg.model },
          parts: [{ type: "text", text: req.prompt }],
        },
      });

      // El SDK no lanza en error: devuelve el envelope. Se mira primero.
      if (res.error) {
        throw new OpenCodeError(
          `OpenCode falló con el agente "${agente}": ${res.error.data?.message ?? res.error.name ?? "error desconocido"}`,
          res.error.data?.ref
        );
      }

      const data = res.data;
      if (!data) throw new OpenCodeError("OpenCode devolvió una respuesta vacía.");
      if (data.info?.error) {
        throw new OpenCodeError(`El modelo falló: ${JSON.stringify(data.info.error).slice(0, 300)}`);
      }

      const texto = (data.parts ?? [])
        .filter((p) => p.type === "text" && typeof p.text === "string")
        .map((p) => p.text)
        .join("\n")
        .trim();

      if (!texto) {
        throw new OpenCodeError(
          `El agente "${agente}" no devolvió texto. Se trata como fallo, nunca como respuesta vacía válida.`
        );
      }

      const result: WorkerResult = {
        text: texto,
        sessionId,
        model: `${data.info?.providerID ?? cfg.provider}/${data.info?.modelID ?? cfg.model}`,
        tokens: { input: data.info?.tokens?.input ?? 0, output: data.info?.tokens?.output ?? 0 },
        durationMs: Date.now() - started,
      };

      if (antes) {
        const cambio = compararSnapshots(antes, snapshot(req.repoPath));
        if (estaContaminado(cambio)) result.contaminado = cambio;
      }

      return result;
    },
  };
}

/** Arma el worker desde el entorno. Un solo lugar que lee las variables. */
export function workerFromEnv(): RepoWorker {
  const baseUrl = process.env.OPENCODE_URL?.trim();
  if (!baseUrl) throw new OpenCodeError("Falta OPENCODE_URL en .env (ej: http://127.0.0.1:4096).");

  return createOpenCodeWorker({
    baseUrl,
    provider: process.env.OPENCODE_PROVIDER?.trim() || "opencode-go",
    model: process.env.OPENCODE_MODEL?.trim() || "deepseek-v4.1-flash",
    agentExplore: process.env.OPENCODE_AGENT_TO_EXPLORE?.trim() || "explore",
    agentEdit: process.env.OPENCODE_AGENT_TO_EDIT?.trim() || "build",
    timeoutMs: Number(process.env.OPENCODE_TIMEOUT_MS ?? 300_000) || 300_000,
  });
}
