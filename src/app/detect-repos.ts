import { eq } from "drizzle-orm";
import { meeting, project, projectRepository, repo, topic } from "../infra/db/schema.ts";
import { finishRun, startRun } from "../infra/llm/trace.ts";
import { LlmError, type LlmProvider } from "../infra/llm/types.ts";
import { DeteccionRepos, type RepoElegido } from "./contracts.ts";
import { idCorto, promptDeteccion, SYSTEM_DETECCION, type RepoParaCatalogo } from "./repo-harness.ts";
import type { openDatabase } from "../infra/db/client.ts";

type DB = ReturnType<typeof openDatabase>["db"];

export interface RepoDetectado {
  repoId: string;
  nombre: string;
  proyecto: string;
  papel: "principal" | "dependiente";
  motivo: string;
}

export interface DeteccionResult {
  topicId: string;
  topicTitle: string;
  repos: RepoDetectado[];
  excluidos: { repoId: string; nombre: string; motivo: string }[];
  duda?: string;
  /** true si el modelo no sirvió y se usó coincidencia de palabras clave. */
  fallback: boolean;
  invalidos: string[];
  model: string;
  tokens: number;
  durationMs: number;
  intentos: number;
}

export class DeteccionError extends LlmError {
  constructor(message: string) {
    super(message);
    this.name = "DeteccionError";
  }
}

/** Carga el catálogo con el nombre de su proyecto. */
export function catalogo(db: DB): RepoParaCatalogo[] {
  const filas = db
    .select({ r: repo, proyecto: project.name })
    .from(repo)
    .leftJoin(projectRepository, eq(projectRepository.repoId, repo.id))
    .leftJoin(project, eq(project.id, projectRepository.projectId))
    .all();

  // Un repo puede estar en varios proyectos: se presenta con todos sus nombres.
  const porRepo = new Map<string, { fila: (typeof filas)[number]["r"]; proyectos: string[] }>();
  for (const f of filas) {
    const actual = porRepo.get(f.r.id) ?? { fila: f.r, proyectos: [] };
    if (f.proyecto && !actual.proyectos.includes(f.proyecto)) actual.proyectos.push(f.proyecto);
    porRepo.set(f.r.id, actual);
  }

  return [...porRepo.values()]
    .map(({ fila, proyectos }) => ({
      id: fila.id,
      nombre: fila.name,
      proyecto: proyectos.sort().join(" + ") || "(sin proyecto)",
      description: fila.description,
      keywords: fila.keywords,
      exposes: fila.exposes,
      consumes: fila.consumes,
    }))
    .sort((a, b) => a.proyecto.localeCompare(b.proyecto) || a.nombre.localeCompare(b.nombre));
}

/**
 * Último recurso si el modelo no sirve: coincidencia de palabras clave.
 * Es determinista y explicable, y se marca en el resultado para que se sepa.
 */
export function porKeywords(texto: string, repos: RepoParaCatalogo[]): RepoDetectado[] {
  const palabras = texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3);

  const puntaje = repos.map((r) => {
    const claves = r.keywords.map((k) => k.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
    const aciertos = claves.filter((k) => palabras.some((w) => k.includes(w) || w.includes(k)));
    return { repo: r, aciertos: aciertos.length, muestra: aciertos };
  });

  return puntaje
    .filter((p) => p.aciertos > 0)
    .sort((a, b) => b.aciertos - a.aciertos)
    .slice(0, 3)
    .map((p) => ({
      repoId: p.repo.id,
      nombre: p.repo.nombre,
      proyecto: p.repo.proyecto,
      papel: "principal" as const,
      motivo: `Coincidencia de palabras clave: ${p.muestra.join(", ")}`,
    }));
}

export async function detectarRepos(
  deps: { db: DB; llm: LlmProvider; setRun?: (id: string | undefined) => void },
  topicId: string
): Promise<DeteccionResult> {
  const { db, llm } = deps;

  const tema = db.select().from(topic).where(eq(topic.id, topicId)).get();
  if (!tema) throw new DeteccionError(`No existe el tema ${topicId}.`);

  const repos = catalogo(db);
  if (repos.length === 0) {
    throw new DeteccionError("No hay repos registrados. Corré: npm run repos:seed");
  }

  const reunion = tema.meetingId
    ? db.select().from(meeting).where(eq(meeting.id, tema.meetingId)).get()
    : undefined;

  const runId = startRun(db, { kind: "interpret", tool: "detectar_repos", input: `${tema.title}\n${tema.description ?? ""}` });
  deps.setRun?.(runId);

  let resultado;
  try {
    resultado = await llm.generate({
      kind: "compose",
      schemaName: "deteccion_repos",
      system: SYSTEM_DETECCION,
      prompt: promptDeteccion(
        {
          titulo: tema.title,
          descripcion: tema.description,
          cita: tema.sourceExcerpt,
          contexto: null,
          reunion: reunion?.title ?? null,
        },
        repos
      ),
      schema: DeteccionRepos,
    });
  } catch (e) {
    finishRun(db, runId, { outcome: "failed" });
    deps.setRun?.(undefined);
    throw e;
  } finally {
    deps.setRun?.(undefined);
  }

  const porId = new Map(repos.map((r) => [idCorto(r.id), r]));
  const invalidos: string[] = [];

  const validos: RepoDetectado[] = [];
  for (const e of resultado.data.repos as RepoElegido[]) {
    const r = porId.get(e.repoId);
    if (!r) {
      invalidos.push(e.repoId);
      continue;
    }
    if (validos.some((v) => v.repoId === r.id)) continue;
    validos.push({ repoId: r.id, nombre: r.nombre, proyecto: r.proyecto, papel: e.papel, motivo: e.motivo });
  }

  const excluidos = (resultado.data.excluidos ?? [])
    .map((e) => {
      const r = porId.get(e.repoId);
      return r ? { repoId: r.id, nombre: r.nombre, motivo: e.motivo } : undefined;
    })
    .filter((x): x is { repoId: string; nombre: string; motivo: string } => Boolean(x));

  // El modelo no devolvió ningún repo usable: se cae a keywords, y se dice.
  // Excepción: si pidió aclaración, esa es su respuesta, no un fallo.
  let fallback = false;
  let finales = validos;

  if (validos.length === 0 && !resultado.data.duda) {
    const texto = [tema.title, tema.description, tema.sourceExcerpt].filter(Boolean).join(" ");
    finales = porKeywords(texto, repos);
    fallback = true;

    if (finales.length === 0 && !resultado.data.duda) {
      finishRun(db, runId, { outcome: "failed", tokens: resultado.tokens, durationMs: resultado.durationMs, intentos: resultado.intentos, fallos: resultado.fallos });
      throw new DeteccionError(
        "No se pudo determinar a qué repos corresponde el alcance. Marcá el tema como `me` o indicá los repos a mano."
      );
    }
  }

  finishRun(db, runId, {
    tokens: resultado.tokens,
    durationMs: resultado.durationMs,
    intentos: resultado.intentos,
    fallos: resultado.fallos,
    outcome: "ok",
  });

  return {
    topicId: tema.id,
    topicTitle: tema.title,
    repos: finales,
    excluidos,
    ...(resultado.data.duda ? { duda: resultado.data.duda } : {}),
    fallback,
    invalidos,
    model: resultado.model,
    tokens: resultado.tokens,
    durationMs: resultado.durationMs,
    intentos: resultado.intentos,
  };
}
