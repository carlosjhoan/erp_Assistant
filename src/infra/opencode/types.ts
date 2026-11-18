/**
 * El ERP le habla a OpenCode por su API local.
 *
 * Regla dura: el modo `explore` nunca puede usar un agente con permiso de
 * escritura. Si la configuración los confunde, se rechaza antes de llamar.
 */

export type WorkerMode = "explore" | "edit";

export interface WorkerRequest {
  repoPath: string;
  /** Sesión reusada del repo. Si falta, se crea una. */
  sessionId?: string;
  prompt: string;
  mode: WorkerMode;
}

export interface WorkerResult {
  text: string;
  sessionId: string;
  model: string;
  tokens: { input: number; output: number };
  durationMs: number;
  /**
   * Solo en modo explore: qué cambió en el repo mientras el agente trabajaba.
   * Si hay algo acá, el resultado NO se acepta.
   */
  contaminado?: { headCambio: boolean; archivos: string[] };
}

export interface RepoWorker {
  run(req: WorkerRequest): Promise<WorkerResult>;
}

export class OpenCodeError extends Error {
  constructor(
    message: string,
    readonly ref?: string
  ) {
    super(message);
    this.name = "OpenCodeError";
  }
}
