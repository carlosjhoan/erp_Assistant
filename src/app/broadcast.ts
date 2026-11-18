import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { meeting, project, repo as repoTable, rubric, topic, topicRepo } from "../infra/db/schema.ts";
import { createItemRepo } from "../infra/db/item-repo.ts";
import { extraerJson } from "../infra/opencode/json.ts";
import type { RepoWorker } from "../infra/opencode/types.ts";
import { OpenCodeError } from "../infra/opencode/types.ts";
import { RespuestaRepo, type PasoRepo } from "./contracts.ts";
import { detectarRepos, type RepoDetectado } from "./detect-repos.ts";
import { serializarFronteras, type RepoParaCatalogo } from "./repo-harness.ts";
import type { LlmProvider } from "../infra/llm/types.ts";
import type { openDatabase } from "../infra/db/client.ts";

type DB = ReturnType<typeof openDatabase>["db"];

export interface BroadcastDeps {
  db: DB;
  llm: LlmProvider;
  worker: RepoWorker;
  maxParalelo?: number;
}

export interface ResultadoRepo {
  repoId: string;
  nombre: string;
  papel: "principal" | "dependiente";
  status: "involucrado" | "excluido" | "fallido";
  reason?: string;
  approach?: string;
  surfaces: string[];
  pasos: number;
  risks: string[];
  tokens: number;
  durationMs: number;
  contaminado: boolean;
  error?: string;
}

export interface BroadcastResult {
  topicId: string;
  topicTitle: string;
  repos: ResultadoRepo[];
  dudas: string[];
}

/** Corre tareas con un tope de concurrencia, sin dependencias. */
export async function enParalelo<T, R>(items: T[], limite: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const resultados: R[] = new Array(items.length);
  let siguiente = 0;

  async function trabajador() {
    while (true) {
      const i = siguiente++;
      if (i >= items.length) return;
      resultados[i] = await fn(items[i]!);
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.min(limite, items.length)) }, trabajador));
  return resultados;
}

/**
 * El servidor local a veces corta la conexión bajo carga. Un reintento corto
 * alcanza; no se reintentan errores de contrato ni de contaminación.
 */
export async function conReintentoRed<T>(fn: () => Promise<T>, intentos = 2): Promise<T> {
  let ultimo: unknown;
  for (let i = 0; i < intentos; i++) {
    try {
      return await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const transitorio = /fetch failed|ECONNRESET|socket hang up|ECONNREFUSED|ETIMEDOUT/i.test(msg);
      if (!transitorio || i === intentos - 1) throw e;
      ultimo = e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw ultimo;
}

/* ---------- el harness por repo ---------- */

export interface AlcanceRepo {
  titulo: string;
  descripcion?: string | null;
  cita?: string | null;
  contexto?: string | null;
  reunion?: string | null;
}

export function promptRepo(
  repo: RepoParaCatalogo & { papel: "principal" | "dependiente" },
  alcance: AlcanceRepo,
  catalogo: RepoParaCatalogo[],
  principales: { nombre: string; approach?: string }[]
): string {
  return [
    `Sos el agente del repositorio ${repo.proyecto}/${repo.nombre}.`,
    `Qué es: ${repo.description ?? "(sin descripción)"}`,
    repo.exposes.length > 0 ? `Expone: ${repo.exposes.join(", ")}` : "",
    repo.consumes.length > 0 ? `Consume: ${repo.consumes.join(", ")}` : "",
    "",
    "ALCANCE",
    `  Título: ${alcance.titulo}`,
    alcance.descripcion ? `  Descripción: ${alcance.descripcion}` : "",
    alcance.cita ? `  Cita del apunte: "${alcance.cita}"` : "",
    alcance.contexto ? `  Contexto: ${alcance.contexto}` : "",
    alcance.reunion ? `  Reunión: ${alcance.reunion}` : "",
    "",
    "ACOPLAMIENTOS CONOCIDOS",
    serializarFronteras(catalogo),
    "",
    ...(repo.papel === "dependiente" && principales.length > 0
      ? [
          "LO QUE YA PROPUSO EL REPO PRINCIPAL",
          ...principales.map((p) => `  ${p.nombre}: ${p.approach ?? "(sin enfoque declarado)"}`),
          "",
        ]
      : []),
    "TAREA",
    "  Leé el código de este repo y determiná si el alcance requiere trabajo acá.",
    "  Si no hace falta nada, devolvé needed=false y explicá por qué.",
    "  Si hace falta, describí tu enfoque y desglosá los pasos, uno por tarea atómica.",
    "  Cada paso: qué se hace, cómo se comprueba, y qué superficie toca.",
    "  Declará las superficies compartidas: api:/ruta, schema:nombre, db:tabla.",
    "",
    "NO MODIFIQUES NINGÚN ARCHIVO. Solo leé y respondé.",
    "",
    "Devolvé SOLO este JSON, sin texto antes ni después:",
    '{"needed":true,"reason":"...","approach":"...","surfaces":["api:/x"],"steps":[{"title":"...","description":"...","acceptanceCriteria":"...","surfaces":["api:/x"]}],"risks":["..."]}',
  ]
    .filter((l) => l !== "")
    .join("\n");
}

/* ---------- el servicio ---------- */

function catalogoDe(db: DB): (RepoParaCatalogo & { path: string })[] {
  return db
    .select({ r: repoTable, p: project })
    .from(repoTable)
    .innerJoin(project, eq(repoTable.projectId, project.id))
    .all()
    .map(({ r, p }) => ({
      id: r.id,
      nombre: r.name,
      proyecto: p.name,
      description: r.description,
      keywords: r.keywords,
      exposes: r.exposes,
      consumes: r.consumes,
      path: r.path,
    }));
}

export async function broadcast(deps: BroadcastDeps, topicId: string): Promise<BroadcastResult> {
  const { db, llm, worker } = deps;
  const maxParalelo = deps.maxParalelo ?? (Number(process.env.OPENCODE_MAX_PARALLEL ?? 2) || 2);

  const tema = db.select().from(topic).where(eq(topic.id, topicId)).get();
  if (!tema) throw new Error(`No existe el tema ${topicId}.`);

  if (tema.owner !== "opencode") {
    throw new Error(
      tema.owner === "me"
        ? "Este tema es un entregable de gestión, no un cambio de código. No se difunde a repos. Si te equivocaste: npm run topics -- code " + tema.id.slice(0, 8)
        : "El tema no está clasificado. Marcá si es tuyo o de código: npm run topics -- mine|code " + tema.id.slice(0, 8)
    );
  }

  const reunion = tema.meetingId ? db.select().from(meeting).where(eq(meeting.id, tema.meetingId)).get() : undefined;

  // Cada difusión parte de cero: se borran las propuestas viejas no aprobadas,
  // si no el listado mezcla fallos de corridas anteriores con los de hoy.
  db.delete(topicRepo)
    .where(and(eq(topicRepo.topicId, topicId), isNull(topicRepo.approvedAt)))
    .run();

  const deteccion = await detectarRepos({ db, llm }, topicId);
  const catalogo = catalogoDe(db);
  const porId = new Map(catalogo.map((c) => [c.id, c]));

  const alcance: AlcanceRepo = {
    titulo: tema.title,
    descripcion: tema.description,
    cita: tema.sourceExcerpt,
    contexto: null,
    reunion: reunion?.title ?? null,
  };

  const dudas: string[] = [];
  if (deteccion.duda) dudas.push(deteccion.duda);

  type RepoConPapel = RepoParaCatalogo & { path: string; papel: "principal" | "dependiente"; motivo: string };
  const conRepo: RepoConPapel[] = [];
  for (const d of deteccion.repos) {
    const c = porId.get(d.repoId);
    if (c) conRepo.push({ ...c, papel: d.papel, motivo: d.motivo });
  }

  const principales = conRepo.filter((r) => r.papel === "principal");
  const dependientes = conRepo.filter((r) => r.papel === "dependiente");

  const resultados: ResultadoRepo[] = [];

  async function ejecutar(repo: RepoConPapel, previos: { nombre: string; approach?: string }[]) {
    const prompt = promptRepo(repo, alcance, catalogo, previos);
    const previa = db
      .select()
      .from(topicRepo)
      .where(and(eq(topicRepo.topicId, tema!.id), eq(topicRepo.repoId, repo.id)))
      .get();

    try {
      const r = await conReintentoRed(() => worker.run({
        repoPath: repo.path,
        prompt,
        mode: "explore",
        ...(previa?.sessionId ? { sessionId: previa.sessionId } : {}),
      }));

      if (r.contaminado) {
        const detalle = r.contaminado.headCambio ? "HEAD cambió" : "archivos modificados";
        throw new OpenCodeError(`El agente modificó el repo durante el broadcast (${detalle}): ${r.contaminado.archivos.join(", ")}`);
      }

      const bruto = extraerJson<unknown>(r.text);
      const parsed = RespuestaRepo.safeParse(bruto);
      if (!parsed.success) {
        throw new OpenCodeError(`La respuesta no cumplió el contrato: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
      }

      const resp = parsed.data;
      const status = resp.needed ? "involucrado" : "excluido";

      guardar({
        topicId: tema!.id,
        repoId: repo.id,
        papel: repo.papel,
        status,
        reason: resp.reason,
        approach: resp.approach ?? null,
        surfaces: resp.surfaces,
        steps: resp.steps,
        risks: resp.risks,
        sessionId: r.sessionId,
        model: r.model,
        tokens: r.tokens.input + r.tokens.output,
        durationMs: r.durationMs,
      });

      return {
        repoId: repo.id,
        nombre: repo.nombre,
        papel: repo.papel,
        status,
        reason: resp.reason,
        ...(resp.approach ? { approach: resp.approach } : {}),
        surfaces: resp.surfaces,
        pasos: resp.steps.length,
        risks: resp.risks,
        tokens: r.tokens.input + r.tokens.output,
        durationMs: r.durationMs,
        contaminado: false,
      } satisfies ResultadoRepo;
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : String(e);
      guardar({
        topicId: tema!.id,
        repoId: repo.id,
        papel: repo.papel,
        status: "fallido",
        reason: null,
        approach: null,
        surfaces: [],
        steps: [],
        risks: [],
        sessionId: null,
        model: null,
        tokens: 0,
        durationMs: 0,
        error: mensaje,
      });

      return {
        repoId: repo.id,
        nombre: repo.nombre,
        papel: repo.papel,
        status: "fallido" as const,
        surfaces: [],
        pasos: 0,
        risks: [],
        tokens: 0,
        durationMs: 0,
        contaminado: mensaje.includes("modificó el repo"),
        error: mensaje,
      };
    }
  }

  function guardar(datos: {
    topicId: string;
    repoId: string;
    papel: "principal" | "dependiente";
    status: "involucrado" | "excluido" | "fallido";
    reason: string | null;
    approach: string | null;
    surfaces: string[];
    steps: PasoRepo[];
    risks: string[];
    sessionId: string | null;
    model: string | null;
    tokens: number;
    durationMs: number;
    error?: string;
  }) {
    const existente = db
      .select()
      .from(topicRepo)
      .where(and(eq(topicRepo.topicId, datos.topicId), eq(topicRepo.repoId, datos.repoId)))
      .get();

    const valores = {
      topicId: datos.topicId,
      repoId: datos.repoId,
      papel: datos.papel,
      status: datos.status,
      reason: datos.reason,
      approach: datos.approach,
      surfaces: datos.surfaces,
      steps: datos.steps,
      risks: datos.risks,
      sessionId: datos.sessionId,
      model: datos.model,
      tokens: datos.tokens,
      durationMs: datos.durationMs,
      contaminated: datos.status === "fallido" && Boolean(datos.error?.includes("modificó el repo")),
      error: datos.error ?? null,
      approvedAt: null,
    };

    if (existente) {
      db.update(topicRepo).set(valores).where(eq(topicRepo.id, existente.id)).run();
    } else {
      db.insert(topicRepo).values({ id: randomUUID(), ...valores }).run();
    }
  }

  // Ronda 1: principales en paralelo.
  const hechosPrincipales = await enParalelo(principales, maxParalelo, (r) => ejecutar(r, []));
  resultados.push(...hechosPrincipales);

  // Ronda 2: dependientes, con lo que ya propusieron los principales como contexto.
  const contextoPrincipales = hechosPrincipales
    .filter((p) => p.status === "involucrado")
    .map((p) => {
      const item: { nombre: string; approach?: string } = { nombre: p.nombre };
      if ("approach" in p && p.approach) item.approach = p.approach;
      return item;
    });

  const hechosDependientes = await enParalelo(dependientes, maxParalelo, (r) => ejecutar(r, contextoPrincipales));
  resultados.push(...hechosDependientes);

  return { topicId: tema.id, topicTitle: tema.title, repos: resultados, dudas };
}

/* ---------- aprobación ---------- */

export interface AceptarResult {
  materializados: number;
  repos: { nombre: string; items: number }[];
  omitidos: string[];
}

/**
 * Convierte los pasos aprobados en ítems de la rúbrica. Solo toca los repos
 * involucrados, sin fallo, sin contaminación y sin aprobar todavía.
 */
export function aceptarPropuestas(
  deps: { db: DB },
  topicId: string,
  opciones: { repoPrefijo?: string } = {}
): AceptarResult {
  const { db } = deps;

  const tema = db.select().from(topic).where(eq(topic.id, topicId)).get();
  if (!tema) throw new Error(`No existe el tema ${topicId}.`);
  if (tema.status !== "selected") throw new Error(`El tema está en "${tema.status}": solo se materializan los seleccionados.`);
  if (!tema.rubricId) throw new Error("El tema no está en ninguna rúbrica. Creá la rúbrica antes de aceptar.");

  const rubrica = db.select().from(rubric).where(eq(rubric.id, tema.rubricId)).get();
  if (!rubrica) throw new Error(`No existe la rúbrica ${tema.rubricId}.`);
  if (rubrica.status !== "draft") throw new Error(`La rúbrica está en "${rubrica.status}": creá una versión nueva.`);

  const filas = db.select().from(topicRepo).where(eq(topicRepo.topicId, topicId)).all();
  const repo = createItemRepo(db);

  const elegidas = filas.filter((f) => {
    if (opciones.repoPrefijo && !f.repoId.startsWith(opciones.repoPrefijo)) return false;
    return f.status === "involucrado" && !f.approvedAt && !f.contaminated && f.steps.length > 0;
  });

  const omitidos = filas
    .filter((f) => !elegidas.includes(f))
    .map((f) => `${f.repoId.slice(0, 8)} (${f.status}${f.contaminated ? ", contaminado" : ""}${f.approvedAt ? ", ya aprobado" : ""})`);

  if (elegidas.length === 0) {
    return { materializados: 0, repos: [], omitidos };
  }

  const repos: { nombre: string; items: number }[] = [];

  db.transaction(() => {
    for (const f of elegidas) {
      repo.insertar(
        rubrica.id,
        f.steps.map((p) => ({
          title: p.title,
          ...(p.description ? { description: p.description } : {}),
          acceptanceCriteria: p.acceptanceCriteria,
          type: "code" as const,
          topicId: tema.id,
          sourceMeetingId: tema.meetingId,
          sourceExcerpt: tema.sourceExcerpt ?? "",
          verifyStatus: "verified" as const,
          verifyScore: 1,
          repoId: f.repoId,
        }))
      );
      db.update(topicRepo).set({ approvedAt: new Date() }).where(eq(topicRepo.id, f.id)).run();
      repos.push({ nombre: f.repoId.slice(0, 8), items: f.steps.length });
    }
    repo.renumerar(rubrica.id);
  });

  return {
    materializados: repos.reduce((n, r) => n + r.items, 0),
    repos,
    omitidos,
  };
}
