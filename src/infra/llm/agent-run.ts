import { createHash, randomUUID } from "node:crypto";
import { agentRun } from "../db/schema.ts";
import type { openDatabase } from "../db/client.ts";

type DB = ReturnType<typeof openDatabase>["db"];

export interface RunRecord {
  kind: "interpret" | "compose" | "verify" | "summary";
  tool: string;
  input: string;
  outputRef?: string;
  model?: string;
  tokens?: number;
  durationMs?: number;
}

/**
 * Deja constancia de cada llamada a un modelo. Se guardan tokens y duración;
 * el costo se calcula después, porque los precios cambian por ventana horaria.
 */
export function recordRun(db: DB, run: RunRecord): void {
  db.insert(agentRun)
    .values({
      id: randomUUID(),
      kind: run.kind,
      tool: run.tool,
      inputHash: createHash("sha256").update(run.input).digest("hex").slice(0, 32),
      outputRef: run.outputRef ?? null,
      tokens: run.tokens ?? null,
      durationMs: run.durationMs ?? null,
    })
    .run();
}
