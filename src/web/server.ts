import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { openDatabase } from "../infra/db/client.ts";
import { agentRun, llmCall, meeting, project, projectRepository, repo as repoTable, rubric, rubricItem, topic } from "../infra/db/schema.ts";
import { createTopicRepo } from "../infra/db/topic-repo.ts";
import { esc, pagina, type Pagina } from "./render.ts";
import { renderMarkdown, vistaPrevia } from "./markdown.ts";
import { ordenarPorUrgencia } from "./orden-reuniones.ts";
import { alternarProyecto, asignarOwner, cambiarEstado, deshacerDecision, quitarOwner, guardarContexto, proyectosDeTema } from "../app/triage.ts";
import { aprobarRubrica, crearRubricaWeb, temasDeRubrica } from "../app/create-rubric.ts";
import { detectarRepos } from "../app/detect-repos.ts";
import { listarNotas, importarNota, archivarReunion, restaurarReunion } from "../app/granola-browser.ts";
import { extractTopics, contarExtracciones } from "../app/extract-topics.ts";
import { aceptarPropuestas, broadcast } from "../app/broadcast.ts";
import { providersFromEnv } from "../infra/llm/providers.ts";
import { workerFromEnv } from "../infra/opencode/worker.ts";
import { topicRepo } from "../infra/db/schema.ts";

const { db } = openDatabase(process.env.DATABASE_PATH ?? "./data/my_erp.db");
migrate(db, { migrationsFolder: "./drizzle" });

const PUBLICO = join(import.meta.dirname, "public");
const MIME: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const ESTADOS = [
  { valor: "proposed", texto: "Sin calificar" },
  { valor: "selected", texto: "Seleccionar" },
  { valor: "parked", texto: "Postergar" },
  { valor: "discarded", texto: "Descartar" },
] as const;

const DUENOS = [
  { valor: "", texto: "Sin dueño" },
  { valor: "me", texto: "Mío" },
  { valor: "opencode", texto: "Código" },
] as const;

/** Chips de proyecto: un tema puede tener cero, uno o varios. */
/**
 * Multi-selección desplegable de proyectos.
 *
 * `<select multiple>` nativo es un anti-patrón: exige Ctrl+clic y casi nadie
 * lo descubre. Acá es un `<details>` con checkboxes reales, que se puede usar
 * con teclado, se lee con lector de pantalla y no cierra al marcar.
 */
function multiProyectos(topicId: string, activos: string[]): string {
  const proyectos = db.select().from(project).all().sort((a, b) => a.name.localeCompare(b.name));
  if (proyectos.length === 0) return `<span class="nota">No hay proyectos registrados.</span>`;

  const opciones = proyectos
    .map((p) => {
      const activo = activos.includes(p.id);
      return `<label class="opcion-check">
        <input type="checkbox" data-toggle-proyecto="${p.id}" data-tema="${topicId}"${activo ? " checked" : ""}>
        <span>${esc(p.name)}</span>
      </label>`;
    })
    .join("");

  const resumen = activos.length === 0 ? "Sin proyecto" : activos.length === 1 ? "1 proyecto" : `${activos.length} proyectos`;

  return `<details class="multi">
    <summary><span class="multi-resumen">${resumen}</span></summary>
    <div class="multi-lista">${opciones}</div>
  </details>`;
}

function opciones(lista: readonly { valor: string; texto: string }[], actual: string | null | undefined): string {
  return lista
    .map((o) => `<option value="${o.valor}"${(actual ?? "") === o.valor ? " selected" : ""}>${o.texto}</option>`)
    .join("");
}

/* ---------- bandeja ---------- */

/* ---------- rúbrica ---------- */

function vistaRubrica(): Pagina {
  const r = db.select().from(rubric).orderBy(desc(rubric.createdAt)).all()[0];

  if (!r) {
    return {
      titulo: "Rúbrica",
      seccion: "rubrica",
      conteoBandeja: createTopicRepo(db).bandeja().length,
      cuerpo: `<div class="vacio">
  <h2>Todavía no hay rúbrica</h2>
  <p>Se crea con los temas que marcaste como <b>Seleccionar</b> en la bandeja.</p>
  <p style="margin-top:16px"><button class="boton" data-accion="crear-rubrica">Crear rúbrica</button></p>
</div>`,
    };
  }

  const temas = temasDeRubrica(db, r.id);
  const items = db.select().from(rubricItem).where(eq(rubricItem.rubricId, r.id)).orderBy(rubricItem.position).all();
  const repos = new Map(db.select().from(repoTable).all().map((x) => [x.id, x.name]));

  const bloques = temas
    .map((t) => {
      const propios = items.filter((i) => i.topicId === t.id);
      const hechos = propios.filter((i) => i.status === "done").length;

      const filas =
        propios.length === 0
          ? `<div class="item"><div class="numero">—</div><div><h4 style="color:var(--warn)">Sin desglosar</h4><div class="criterio">Este tema todavía no tiene ítems.</div></div></div>`
          : propios
              .map((i) => {
                const marca = i.verifyStatus === "verified" ? "✓" : "⚠";
                const nombreRepo = i.repoId ? repos.get(i.repoId) : undefined;
                const meta = [
                  `<span>${i.type}</span>`,
                  nombreRepo ? `<span>repo: ${esc(nombreRepo)}</span>` : "",
                  i.status !== "pending" ? `<span>${i.status}</span>` : "",
                  i.verifyStatus !== "verified" && i.verifyScore != null
                    ? `<span style="color:var(--warn)">jev ${i.verifyScore.toFixed(2)}</span>`
                    : "",
                ]
                  .filter(Boolean)
                  .join("");

                return `<div class="item">
  <div class="numero">${i.position + 1}</div>
  <div>
    <h4>${marca} ${esc(i.title)}</h4>
    <div class="criterio">${esc(i.acceptanceCriteria)}</div>
    <div class="meta">${meta}</div>
  </div>
</div>`;
              })
              .join("\n");

      return `<section class="tema-bloque">
  <h2>${esc(t.title)} <span class="avance">${hechos}/${propios.length} ✓</span></h2>
  ${filas}
</section>`;
    })
    .join("\n");

  const aprobada = r.status === "approved" || r.status === "closed";
  const accion = aprobada
    ? `<span class="dueno codigo">${r.status}</span>`
    : `<button class="boton" data-accion="aprobar" data-rubrica="${r.id}">Aprobar rúbrica</button>`;

  return {
    titulo: `Rúbrica ${r.weekStart} · v${r.version}`,
    seccion: "rubrica",
    conteoBandeja: createTopicRepo(db).bandeja().length,
    cuerpo: `<div class="resumen">
  <span>${temas.length} tema(s)</span>
  <span>${items.length} ítem(s)</span>
  <span>entrega ${r.deadline ?? "sin fecha"}</span>
  <span>estado: ${r.status}</span>
  <span class="der">${accion}</span>
</div>
${bloques}`,
  };
}

/* ---------- temas ---------- */

function vistaTemas(): Pagina {
  const filas = db.select().from(topic).orderBy(desc(topic.createdAt)).all();
  const orden = ["proposed", "selected", "parked", "discarded"] as const;
  const nombre: Record<string, string> = {
    proposed: "Sin calificar",
    selected: "Seleccionados",
    parked: "Postergados",
    discarded: "Descartados",
  };

  const cuerpo = orden
    .map((s) => {
      const lista = filas.filter((f) => f.status === s);
      if (lista.length === 0) return "";

      const items = lista
        .map(
          (f) => `<article class="fila compacta">
  <div class="titulos"><h3><a class="enlace-tema" href="/tema/${f.id}">${esc(f.title)}</a></h3></div>
  <div class="controles"><span class="dueno ${f.owner === "opencode" ? "codigo" : "mio"}">${f.owner === "opencode" ? "código" : f.owner === "me" ? "mío" : "—"}</span></div>
</article>`
        )
        .join("\n");

      return `<div class="grupo-fecha">${nombre[s]} (${lista.length})</div>${items}`;
    })
    .join("\n");

  return { titulo: "Temas", seccion: "temas", conteoBandeja: createTopicRepo(db).bandeja().length, cuerpo };
}

function vistaTema(id: string): Pagina {
  const t = db.select().from(topic).where(eq(topic.id, id)).get();
  if (!t) {
    return { titulo: "Tema", seccion: "bandeja", cuerpo: `<div class="vacio"><h2>No existe</h2></div>` };
  }

  const propuestas = db.select().from(topicRepo).where(eq(topicRepo.topicId, t.id)).all();
  const repos = new Map(db.select().from(repoTable).all().map((x) => [x.id, x]));

  const etiquetas = [
    `<span class="etiqueta ${t.scopeSignal === "likely_scope" ? "alcance" : "idea"}">${t.scopeSignal === "likely_scope" ? "alcance" : "idea"}</span>`,
    `<span class="etiqueta ${t.owner === "opencode" ? "codigo" : "mio"}">${t.owner === "opencode" ? "código" : t.owner === "me" ? "mío" : "sin dueño"}</span>`,
    t.verifyScore != null ? `<span class="score ${t.verifyScore < 0.6 ? "bajo" : ""}">jev ${t.verifyScore.toFixed(2)}</span>` : "",
  ].filter(Boolean).join(" ");

  const bloqueRepos =
    propuestas.length === 0
      ? `<p class="nota">Todavía no se le preguntó a ningún repo.</p>
         <button class="boton secundario" data-detectar="${t.id}">Detectar repos</button>`
      : propuestas
          .map((p) => {
            const repo = repos.get(p.repoId);
            const marca = p.status === "involucrado" ? "◆" : p.status === "excluido" ? "—" : p.status === "pendiente" ? "·" : "✗";
            const color = p.status === "fallido" ? "var(--bad)" : p.status === "excluido" ? "var(--olive)" : "var(--ok)";
            const pasos = p.steps
              .map(
                (s, i) => `<div class="paso">
  <span class="numero">${i + 1}</span>
  <div>
    <h5>${esc(s.title)}</h5>
    <div class="criterio">${esc(s.acceptanceCriteria)}</div>
  </div>
</div>`
              )
              .join("\n");

            const aceptar =
              p.status === "involucrado" && !p.approvedAt && !p.contaminated
                ? `<button class="boton" data-aceptar="${t.id}" data-repo="${p.repoId}">Aceptar como ítems</button>`
                : p.approvedAt
                  ? `<span class="dueno codigo">ya aprobado</span>`
                  : "";

            return `<section class="propuesta">
  <header>
    <span style="color:${color}">${marca}</span>
    <strong>${esc(repo?.name ?? p.repoId.slice(0, 8))}</strong>
    <span class="papel">${p.papel}</span>
    <span class="estado-prop">${p.status}</span>
    ${p.contaminated ? `<span class="aviso-inline">⚠ el agente modificó el repo</span>` : ""}
    <span class="der">${aceptar}</span>
  </header>
  ${p.reason ? `<p class="nota">${esc(p.reason)}</p>` : ""}
  ${p.approach ? `<p class="enfoque">${esc(p.approach)}</p>` : ""}
  ${p.surfaces.length > 0 ? `<p class="superficies">superficies: ${p.surfaces.map((s) => `<code>${esc(s)}</code>`).join(" ")}</p>` : ""}
  ${pasos ? `<div class="pasos">${pasos}</div>` : ""}
  ${p.error ? `<p class="nota error">${esc(p.error)}</p>` : ""}
</section>`;
          })
          .join("\n");

  const choques = (() => {
    const mapa = new Map<string, string[]>();
    for (const p of propuestas.filter((x) => x.status === "involucrado")) {
      for (const s of p.surfaces) mapa.set(s, [...(mapa.get(s) ?? []), repos.get(p.repoId)?.name ?? "?"]);
    }
    return [...mapa.entries()].filter(([, r]) => r.length > 1);
  })();

  const puedeDifundir = t.owner === "opencode";

  return {
    titulo: t.title,
    seccion: "bandeja",
    conteoBandeja: createTopicRepo(db).bandeja().length,
    cuerpo: `<a class="volver" href="/">← Bandeja</a>

<div class="detalle">
  <div class="etiquetas">${etiquetas}</div>
  ${t.needsReview ? `<div class="aviso">⚠ Jev duda de que esto se haya hablado en la reunión</div>` : ""}

  ${t.sourceExcerpt ? `<blockquote class="cita-detalle">${esc(t.sourceExcerpt)}</blockquote>` : ""}
  ${t.description ? `<p class="descripcion">${esc(t.description)}</p>` : ""}

  <h3>Contexto</h3>
  <textarea data-contexto="${t.id}" rows="4" placeholder="Lo que el sistema no puede saber: qué falta, qué no entra, qué decidiste.">${esc(t.context ?? "")}</textarea>
  <div class="acciones-linea">
    <button class="boton secundario" data-guardar-contexto="${t.id}">Guardar contexto</button>
    ${puedeDifundir ? `<button class="boton" data-difundir="${t.id}">Preguntar a los repos</button>` : `<span class="nota">Marcalo como <b>código</b> para difundir a repos.</span>`}
    <span class="cargando" hidden>trabajando… puede tardar minutos</span>
  </div>

  <h3>Repos y propuestas</h3>
  ${choques.length > 0 ? `<div class="aviso">⚠ Superficie compartida: ${choques.map(([s, r]) => `<code>${esc(s)}</code> (${r.join(", ")})`).join(" · ")}</div>` : ""}
  ${bloqueRepos}
</div>`,
  };
}

function vistaRepos(): Pagina {
  const proyectos = db.select().from(project).all().sort((a, b) => a.name.localeCompare(b.name));
  const repos = db.select().from(repoTable).all();
  const vinculos = db.select().from(projectRepository).all();
  const faltantes = repos.filter((r) => !existsSync(r.path)).length;

  const cuerpo = proyectos
    .map((p) => {
      const ids = vinculos.filter((v) => v.projectId === p.id).map((v) => v.repoId);
      const propios = repos.filter((r) => ids.includes(r.id)).sort((a, b) => a.name.localeCompare(b.name));

      const filas = propios
        .map((r) => {
          const existe = existsSync(r.path);
          return `<article class="tarjeta-repo">
  <header>
    <strong>${esc(r.name)}</strong>
    ${existe ? "" : `<span class="aviso-inline">ruta inexistente</span>`}
    ${r.opencodeSessionId ? `<span class="sesion">sesión ${esc(r.opencodeSessionId.slice(0, 10))}</span>` : ""}
  </header>
  <p class="descripcion">${esc(r.description ?? "Sin descripción.")}</p>
  <p class="ruta">${esc(r.path)}</p>
  <div class="superficies-linea">
    ${r.exposes.length > 0 ? `<span>expone: ${r.exposes.map((s) => `<code>${esc(s)}</code>`).join(" ")}</span>` : ""}
    ${r.consumes.length > 0 ? `<span>consume: ${r.consumes.map((s) => `<code>${esc(s)}</code>`).join(" ")}</span>` : ""}
  </div>
  ${r.keywords.length > 0 ? `<p class="claves">${r.keywords.map((k) => `<span>${esc(k)}</span>`).join("")}</p>` : ""}
</article>`;
        })
        .join("\n");

      return `<section class="bloque-proyecto">
  <h2>${esc(p.name)} <span class="avance">${propios.length}</span></h2>
  <p class="ruta">${esc(p.path)}</p>
  ${filas}
</section>`;
    })
    .join("\n");

  return {
    titulo: "Repos",
    seccion: "repos",
    conteoBandeja: createTopicRepo(db).bandeja().length,
    cuerpo: `<div class="resumen">
  <span>${repos.length} repo(s) en ${proyectos.length} proyecto(s)</span>
  <span>${repos.length - faltantes}/${repos.length} rutas existen</span>
</div>
${cuerpo}`,
  };
}

function vistaTrazas(): Pagina {
  const runs = db.select().from(agentRun).orderBy(desc(agentRun.createdAt)).limit(25).all();
  const calls = db.select().from(llmCall).all();
  const porRun = new Map<string, typeof calls>();
  for (const c of calls) porRun.set(c.runId, [...(porRun.get(c.runId) ?? []), c]);

  const totalCalls = calls.length;
  const fallidas = runs.filter((r) => r.outcome === "failed").length;
  const conReintento = runs.filter((r) => (r.attempts ?? 1) > 1).length;
  const sinCerrar = runs.filter((r) => r.outcome === null).length;
  const tokens = calls.reduce((n, c) => n + (c.inputTokens ?? 0) + (c.outputTokens ?? 0), 0);

  const lista = runs
    .map((r) => {
      const suyas = (porRun.get(r.id) ?? []).sort((a, b) => (a.attempt ?? 1) - (b.attempt ?? 1));
      const marca = r.outcome === "failed" ? "✗" : r.outcome === null ? "…" : "✓";
      const color = r.outcome === "failed" ? "var(--bad)" : r.outcome === null ? "var(--warn)" : "var(--ok)";

      const lineas = suyas
        .map((c) => {
          const cm = c.status === "ok" ? "✓" : "✗";
          const err = c.errorKind ? ` · ${c.errorKind}` : "";
          return `<div class="linea">
  <span class="nombre">${cm} ${esc(c.provider)} / ${esc(c.model ?? "—")}</span>
  <span>intento ${c.attempt ?? 1}</span>
  <span>${c.inputTokens ?? 0}/${c.outputTokens ?? 0} tok</span>
  <span>${c.durationMs ?? 0} ms</span>
  <span>${err}</span>
</div>`;
        })
        .join("\n");

      return `<article class="run">
  <header>
    <span style="color:${color}">${marca}</span>
    <strong>${esc(r.tool)}</strong>
    <span class="papel">${esc(r.kind)}</span>
    <span>${r.attempts ?? 1} intento(s)</span>
    <span>${r.tokens ?? 0} tok</span>
    <span>${r.durationMs ? (r.durationMs / 1000).toFixed(1) + " s" : "—"}</span>
    ${r.errorKind ? `<span class="aviso-inline">${esc(r.errorKind)}</span>` : ""}
    <span class="der">${r.createdAt ? new Date(r.createdAt).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" }) : ""}</span>
  </header>
  ${lineas}
</article>`;
    })
    .join("\n");

  return {
    titulo: "Trazas",
    seccion: "trazas",
    conteoBandeja: createTopicRepo(db).bandeja().length,
    cuerpo: `<div class="resumen">
  <span>${runs.length} operación(es)</span>
  <span>${totalCalls} llamada(s)</span>
  <span>${tokens.toLocaleString("es-CO")} tok</span>
  <span>fallidas ${fallidas}</span>
  <span>con reintento ${conReintento}</span>
  ${sinCerrar > 0 ? `<span style="color:var(--warn)">sin cerrar ${sinCerrar}</span>` : ""}
</div>
${lista || `<div class="vacio"><h2>Sin llamadas todavía</h2></div>`}`,
  };
}

/** Iconos en línea: no dependen de la fuente del sistema. */
function icono(nombre: "fecha" | "temas" | "pendiente" | "seleccionada" | "postergada" | "descartada"): string {
  const trazos: Record<string, string> = {
    fecha: `<rect x="2" y="3.5" width="12" height="10.5" rx="1.5"/><path d="M2 6.5h12M5.5 2v3M10.5 2v3"/>`,
    temas: `<path d="M2 4h12M2 8h12M2 12h8"/>`,
    pendiente: `<circle cx="8" cy="8" r="5.6"/><path d="M8 5v3.2l2 1.4"/>`,
    seleccionada: `<circle cx="8" cy="8" r="5.6"/><path d="M5.5 8.2l1.8 1.8 3.4-3.6"/>`,
    postergada: `<circle cx="8" cy="8" r="5.6"/><path d="M6.5 5.8v4.4M9.5 5.8v4.4"/>`,
    descartada: `<circle cx="8" cy="8" r="5.6"/><path d="M6 6l4 4M10 6l-4 4"/>`,
  };
  return `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">${trazos[nombre] ?? ""}</svg>`;
}

function vistaReuniones(): Pagina {
  const todas = db.select().from(meeting).all();
  const reuniones = todas.filter((m) => !m.archivedAt);
  const temas = db.select().from(topic).all();

  const ordenadas = ordenarPorUrgencia(reuniones, temas);

  const tarjetas = ordenadas
    .map((m) => {
      const propios = temas.filter((t) => t.meetingId === m.id);
      const cuenta = {
        total: propios.length,
        proposed: propios.filter((t) => t.status === "proposed").length,
        selected: propios.filter((t) => t.status === "selected").length,
        parked: propios.filter((t) => t.status === "parked").length,
        discarded: propios.filter((t) => t.status === "discarded").length,
      };

      const extraidos = cuenta.total > 0;
      const fecha = m.occurredAt
        ? new Date(m.occurredAt).toLocaleDateString("es-CO", { weekday: "short", day: "numeric", month: "short", year: "numeric" })
        : "sin fecha";

      const metricas = [
        `<span class="metrica total">${icono("temas")} ${cuenta.total} ${cuenta.total === 1 ? "tema" : "temas"}</span>`,
        cuenta.proposed > 0 ? `<span class="metrica pendiente">${icono("pendiente")} ${cuenta.proposed} sin clasificar</span>` : "",
        cuenta.selected > 0 ? `<span class="metrica seleccionada">${icono("seleccionada")} ${cuenta.selected} seleccionada${cuenta.selected === 1 ? "" : "s"}</span>` : "",
        cuenta.parked > 0 ? `<span class="metrica postergada">${icono("postergada")} ${cuenta.parked} postergada${cuenta.parked === 1 ? "" : "s"}</span>` : "",
        cuenta.discarded > 0 ? `<span class="metrica descartada">${icono("descartada")} ${cuenta.discarded} descartada${cuenta.discarded === 1 ? "" : "s"}</span>` : "",
      ]
        .filter(Boolean)
        .join("");

      return `<article class="card-reunion ${extraidos ? "extraida" : "sin-extraer"}">
  <a class="card-link" href="/reunion/${m.id}"><span class="sr-only">Abrir ${esc(m.title)}</span></a>
  <button class="card-archivar" data-archivar="${m.id}" data-titulo="${esc(m.title)}" data-temas="${cuenta.total}" aria-label="Archivar reunión" title="Archivar">${iconoArchivar()}</button>
  <div class="card-top">
    <span class="card-fecha">${icono("fecha")} ${esc(fecha)}</span>
    <span class="card-estado ${extraidos ? "ok" : "pendiente"}">${extraidos ? "Temas extraídos" : "Pendiente por extracción"}</span>
  </div>
  <h3>${esc(m.title)}</h3>
  ${extraidos ? `<div class="metricas">${metricas}</div>` : `<p class="card-hint">Todavía no se le pidió a la IA que detecte los temas.</p>`}
</article>`;
    })
    .join("\n");

  const archivadas = todas
    .filter((m) => m.archivedAt)
    .map(
      (m) => `<div class="archivada-fila">
  <span>${esc(m.title)}</span>
  <span class="score">${m.occurredAt ? new Date(m.occurredAt).toLocaleDateString("es-CO") : ""}</span>
  <button class="boton secundario" data-restaurar="${m.id}">Restaurar</button>
</div>`
    )
    .join("\n");

  return {
    titulo: "Reuniones",
    seccion: "reuniones",
    conteoBandeja: reuniones.length,
    accion: `<a class="boton" href="/reuniones/nueva">Nueva reunión</a>`,
    cuerpo: `${tarjetas ? `<div class="grid-reuniones">${tarjetas}</div>` : `<div class="vacio"><h2>Sin reuniones</h2><p>Importá una desde Granola.</p></div>`}
<section class="seccion-archivadas">
  <h2>Archivadas <span class="avance">${archivadas ? archivadas.split("</div>").length - 1 : 0}</span></h2>
  <p class="nota">No participan de la rúbrica ni de la detección de repos. Se pueden restaurar.</p>
  ${archivadas || `<p class="vacio-mini">No hay reuniones archivadas.</p>`}
</section>`,
  };
}

/** Caja de archivo: se entiende sin leyenda. */
function iconoArchivar(): string {
  return `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true"><rect x="1.8" y="2.6" width="12.4" height="3" rx="0.8"/><path d="M3 5.6v6.9a0.9 0.9 0 0 0 .9.9h8.2a0.9 0.9 0 0 0 .9-.9V5.6"/><path d="M5.9 8.7h4.2"/></svg>`;
}

function iconoTemas(): string {
  return `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M2 4h12M2 8h12M2 12h8"/></svg>`;
}

function iconoExtracciones(): string {
  return `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M13.5 8a5.5 5.5 0 1 1-1.7-4"/><path d="M13.8 2v3.2h-3.2"/></svg>`;
}

function filaTema(
  t: {
    id: string;
    title: string;
    description: string | null;
    scopeSignal: string | null;
    verifyScore: number | null;
    needsReview: boolean;
    owner: string | null;
    projectId: string | null;
    status: string;
  },
  editable: boolean
): string {
  const confianza = t.verifyScore != null ? Math.round(t.verifyScore * 100) : null;
  const baja = confianza != null && confianza < 60;
  const esAlcance = t.scopeSignal === "likely_scope";
  const idModal = `desc-${t.id.slice(0, 8)}`;
  const seleccionado = t.status === "selected";

  const segmentos: { valor: string; texto: string }[] = [
    { valor: "proposed", texto: "Por calificar" },
    { valor: "selected", texto: "Elegir" },
    { valor: "parked", texto: "Postergar" },
    { valor: "discarded", texto: "Descartar" },
  ];

  // Radios nativos disfrazados de segmentos: el navegador maneja el estado,
  // no nuestro JavaScript. Es lo que hace que siempre responda.
  const control = editable
    ? `<div class="segmentado" role="radiogroup" aria-label="Decisión del tema">${segmentos
        .map(
          (s) => `<label class="seg${t.status === s.valor ? " activo" : ""}">
        <input type="radio" name="estado-${t.id}" value="${s.valor}" data-estado-radio="${t.id}"${t.status === s.valor ? " checked" : ""}>
        <span>${s.texto}</span>
      </label>`
        )
        .join("")}</div>`
    : "";

  const estadoChip = editable
    ? ""
    : `<span class="estado-chip">${segmentos.find((s) => s.valor === t.status)?.texto ?? t.status}</span>`;

  const dialog = `<dialog id="${idModal}" class="modal modal-desc">
  <header>
    <h2>${esc(t.title)}</h2>
    <button class="cerrar" data-cerrar-modal="${idModal}" aria-label="Cerrar">✕</button>
  </header>
  ${t.description ? `<div class="markdown"><p>${esc(t.description)}</p></div>` : `<div class="markdown"><p class="nota">Sin descripción.</p></div>`}
  <footer class="modal-pie">
    <a class="boton secundario" href="/tema/${t.id}">Abrir tema</a>
  </footer>
</dialog>`;

  return `<article class="fila tema-card estado-${t.status}${editable ? "" : " solo-lectura"}" data-id="${t.id}">
  <header class="tema-head">
    <div class="tema-marcas">
      <span class="marca ${esAlcance ? "alcance" : "idea"}">${esAlcance ? "ALCANCE" : "IDEA"}</span>
      ${
        confianza != null
          ? `<span class="jev${baja ? " baja" : ""}" title="Qué tan seguro está Jev de que este tema se habló en la reunión">Jev ${confianza}%</span>`
          : `<span class="jev" title="Jev no pudo evaluar este tema">Jev sin dato</span>`
      }
      ${t.needsReview ? `<span class="revisar" title="Jev duda de que se haya hablado">a revisar</span>` : ""}
      ${estadoChip}
    </div>

    <h3>${esc(t.title)}</h3>

    ${t.description ? `<p class="tema-desc">${esc(t.description)}</p>` : ""}
    <button type="button" class="ver-mas" data-abrir-modal="${idModal}">ver más</button>
  </header>

  ${editable ? `<div class="tema-decision">
    <span class="campo-label">Decisión</span>
    ${control}
  </div>` : ""}

  ${editable && seleccionado
    ? `<div class="extra">
    <div class="campo">
      <span class="campo-label">Responsable</span>
      <select data-campo="owner">${opciones(DUENOS, t.owner ?? "")}</select>
    </div>
    <div class="campo">
      <span class="campo-label">Proyectos</span>
      ${multiProyectos(t.id, proyectosDeTema({ db }, t.id))}
    </div>
  </div>`
    : ""}

  ${!editable && seleccionado
    ? `<div class="extra estatico">
    <div class="campo"><span class="campo-label">Responsable</span><span class="valor">${t.owner === "opencode" ? "Código" : t.owner === "me" ? "Mío" : "Sin asignar"}</span></div>
    <div class="campo"><span class="campo-label">Proyectos</span><span class="valor">${
      proyectosDeTema({ db }, t.id)
        .map((id) => db.select().from(project).all().find((p) => p.id === id)?.name)
        .filter(Boolean)
        .join(", ") || "Sin proyecto"
    }</span></div>
  </div>`
    : ""}
</article>
${dialog}`;
}

function vistaReunion(id: string, tab?: string): Pagina {
  const m = db.select().from(meeting).where(eq(meeting.id, id)).get();
  if (!m) return { titulo: "Reunión", seccion: "reuniones", cuerpo: `<div class="vacio"><h2>No existe</h2></div>` };

  const temas = db.select().from(topic).where(eq(topic.meetingId, m.id)).all();
  const notas = m.summary ?? "";
  const corridas = notas ? contarExtracciones(db, notas) : 0;

  const cuenta = {
    todas: temas.length,
    proposed: temas.filter((t) => t.status === "proposed").length,
    selected: temas.filter((t) => t.status === "selected").length,
    parked: temas.filter((t) => t.status === "parked").length,
    discarded: temas.filter((t) => t.status === "discarded").length,
  };

  // Por defecto, la pestaña donde hay trabajo: sin calificar si queda algo.
  const activa = tab ?? "todas";

  const pestañas: { id: string; texto: string; n: number }[] = [
    { id: "todas", texto: "Todas", n: cuenta.todas },
    { id: "selected", texto: "Seleccionadas", n: cuenta.selected },
    { id: "parked", texto: "Postergadas", n: cuenta.parked },
    { id: "discarded", texto: "Descartadas", n: cuenta.discarded },
    { id: "proposed", texto: "Sin calificar", n: cuenta.proposed },
  ];

  const navegacion = pestañas
    .map(
      (p) =>
        `<a class="pestana estado-${p.id}${activa === p.id ? " activa" : ""}" href="/reunion/${m.id}?tab=${p.id}" data-conteo="${p.id}">${p.texto} <b>${p.n}</b></a>`
    )
    .join("");

  const visibles = activa === "todas" ? temas : temas.filter((t) => t.status === activa);
  const editable = activa === "todas";

  const lista =
    visibles.length > 0
      ? visibles.map((t) => filaTema(t, editable)).join("\n")
      : `<div class="vacio-mini">${
          activa === "proposed"
            ? "No queda nada sin calificar."
            : activa === "todas"
              ? "Esta reunión no tiene temas todavía."
              : "No hay temas en este estado."
        }</div>`;

  const modal = notas
    ? `<dialog id="modal-notas" class="modal">
  <header>
    <h2>${esc(m.title)}</h2>
    <button class="cerrar" data-cerrar-modal="modal-notas" aria-label="Cerrar">✕</button>
  </header>
  <div class="markdown">${renderMarkdown(notas)}</div>
</dialog>`
    : "";


  const fecha = m.occurredAt
    ? new Date(m.occurredAt).toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : "fecha desconocida";

  return {
    titulo: `Reunión de ${fecha}`,
    seccion: "reuniones",
    conteoBandeja: createTopicRepo(db).bandeja().length,
    cuerpo: `<a class="volver" href="/reuniones">← Reuniones</a>

<div class="detalle">
  <h2 class="titulo-reunion">${esc(m.title)}</h2>
  ${m.archivedAt ? `<p class="badge-archivada">Reunión archivada · no participa de la rúbrica</p>` : ""}
  <p class="meta-reunion">
    <span>${temas.length} tema(s)</span>
    ${cuenta.proposed > 0 ? `<span>· ${cuenta.proposed} sin calificar</span>` : `<span>· todo calificado</span>`}
  </p>

  <h3>Notas</h3>
  ${
    notas
      ? `<div class="vistazo">
    <p>${esc(vistaPrevia(notas, 4))}</p>
    <button class="boton secundario" data-abrir-modal="modal-notas">Ver notas completas</button>
  </div>`
      : `<p class="nota">Sin notas guardadas.</p>`
  }

  <section class="bloque-temas">
    <header class="bloque-head">
      <div>
        <h3>Temas de esta reunión</h3>
        <p class="bloque-meta">
          <span class="badge">${iconoTemas()} ${temas.length} ${temas.length === 1 ? "tema" : "temas"}</span>
          ${corridas > 0 ? `<span class="badge">${iconoExtracciones()} ${corridas} ${corridas === 1 ? "extracción" : "extracciones"}</span>` : ""}
        </p>
      </div>
      <div class="bloque-accion">
        <button class="boton" data-detectar-temas="${m.id}">Detectar temas</button>
        <span class="cargando" hidden>extrayendo… puede tardar</span>
      </div>
    </header>

    <nav class="pestanas">${navegacion}</nav>

    <div class="lista-temas" data-tab="${activa}">
      ${lista}
    </div>
  </section>
</div>
${modal}`,
  };
}
function vistaNuevaReunion(): Pagina {
  return {
    titulo: "Nueva reunión",
    seccion: "reuniones",
    conteoBandeja: createTopicRepo(db).bandeja().length,
    cuerpo: `<a class="volver" href="/reuniones">← Reuniones</a>

<div class="detalle">
  <p class="nota">Se buscan las últimas notas en Granola. Las que ya están importadas aparecen marcadas.</p>
  <p style="margin:14px 0"><button class="boton" data-buscar-granola>Buscar en Granola</button>
  <span class="cargando" hidden>consultando…</span></p>

  <p id="estado-granola" class="estado" hidden></p>
  <div id="resultados"></div>
</div>`,
  };
}

function vistaProyectos(): Pagina {
  const proyectos = db.select().from(project).all().sort((a, b) => {
    if (a.status !== b.status) return a.status === "active" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const vinculos = db.select().from(projectRepository).all();
  const repos = db.select().from(repoTable).all();
  const temas = db.select().from(topic).all();
  const items = db.select().from(rubricItem).all();

  const tarjetas = proyectos
    .map((p) => {
      const misRepos = repos.filter((r) => vinculos.some((v) => v.projectId === p.id && v.repoId === r.id));
      const misTemas = temas.filter((t) => t.projectId === p.id);
      const itemsPorTema = new Map(items.map((i) => [i.topicId, i]));
      const misItems = misTemas.flatMap((t) => items.filter((i) => i.topicId === t.id));
      const hechos = misItems.filter((i) => i.status === "done").length;
      const pct = misItems.length > 0 ? Math.round((hechos / misItems.length) * 100) : 0;

      const sinCalificar = misTemas.filter((t) => t.status === "proposed").length;
      const seleccionados = misTemas.filter((t) => t.status === "selected").length;

      return `<article class="tarjeta-proyecto">
  <header>
    <strong>${esc(p.name)}</strong>
    <span class="dueno ${p.status === "active" ? "mio" : "codigo"}">${p.status}</span>
    <span class="der">${misRepos.length} repo(s)</span>
  </header>
  <p class="descripcion">${esc(p.description ?? "Sin descripción.")}</p>

  <div class="progreso" title="${hechos} de ${misItems.length} ítems hechos">
    <div class="barra" style="width:${pct}%"></div>
  </div>
  <p class="cifras">
    <span><b>${misItems.length}</b> ítem(s)</span>
    <span><b>${hechos}</b> hechos</span>
    <span><b>${seleccionados}</b> en la rúbrica</span>
    ${sinCalificar > 0 ? `<span style="color:var(--warn)"><b>${sinCalificar}</b> sin calificar</span>` : ""}
  </p>

  ${misRepos.length > 0 ? `<p class="repos-lista">${misRepos.map((r) => `<code>${esc(r.name)}</code>`).join(" ")}</p>` : ""}
</article>`;
    })
    .join("\n");

  const activos = proyectos.filter((p) => p.status === "active").length;

  return {
    titulo: "Proyectos",
    seccion: "proyectos",
    conteoBandeja: createTopicRepo(db).bandeja().length,
    cuerpo: `<div class="resumen">
  <span>${proyectos.length} proyecto(s)</span>
  <span>${activos} activo(s)</span>
  <span>${repos.length} repo(s) en total</span>
</div>
${tarjetas || `<div class="vacio"><h2>Sin proyectos</h2><p>Corré <code>npm run repos:seed</code>.</p></div>`}`,
  };
}

function marcador(titulo: string, seccion: string, fase: string): Pagina {
  return {
    titulo,
    seccion,
    conteoBandeja: createTopicRepo(db).bandeja().length,
    cuerpo: `<div class="vacio"><h2>Vista por construir</h2><p>Llega en la ${fase}.</p></div>`,
  };
}

/* ---------- acciones ---------- */

function responder(res: ServerResponse, codigo: number, cuerpo: string | Buffer, tipo = "text/html; charset=utf-8") {
  res.writeHead(codigo, { "content-type": tipo });
  res.end(cuerpo);
}

function redirect(destino: string) {
  return `<meta http-equiv="refresh" content="0; url=${destino}">`;
}

function json(res: ServerResponse, codigo: number, datos: unknown) {
  responder(res, codigo, JSON.stringify(datos), "application/json");
}

async function accionTema(res: ServerResponse, id: string, campo: string, valor: string) {
  try {
    if (campo === "estado") {
      if (valor === "proposed") {
        const r = deshacerDecision({ db }, id);
        return json(res, 200, { ok: true, titulo: r.title, estado: "proposed" });
      }
      if (!["selected", "parked", "discarded"].includes(valor)) return json(res, 400, { error: "estado inválido" });
      const r = cambiarEstado({ db }, id, valor as "selected");
      return json(res, 200, { ok: true, titulo: r.title, estado: r.hacia });
    }

    if (campo === "owner") {
      if (valor === "") {
        const r = quitarOwner({ db }, id);
        return json(res, 200, { ok: true, titulo: r.title, owner: null });
      }
      if (!["me", "opencode"].includes(valor)) return json(res, 400, { error: "dueño inválido" });
      const r = asignarOwner({ db }, id, valor as "me");
      return json(res, 200, { ok: true, titulo: r.title, owner: r.owner });
    }

    if (campo === "proyecto") {
      if (!valor) return json(res, 400, { error: "Falta el proyecto." });
      const r = alternarProyecto({ db }, id, valor);
      return json(res, 200, { ok: true, titulo: r.title, projectId: r.projectId, activo: r.activo });
    }

    json(res, 400, { error: "campo desconocido" });
  } catch (e) {
    json(res, 400, { error: e instanceof Error ? e.message : String(e) });
  }
}

/** Acciones de Granola y de reuniones. */
async function accionGranola(res: ServerResponse, accion: string, cuerpo: string) {
  try {
    if (accion === "listar") {
      const notas = await listarNotas(db, 10);
      return json(res, 200, { ok: true, notas });
    }

    if (accion === "importar") {
      const id = cuerpo.trim();
      if (!id) return json(res, 400, { error: "Falta el id de la nota." });
      const r = await importarNota(db, id);
      return json(res, 200, { ok: true, ...r });
    }

    json(res, 400, { error: "acción desconocida" });
  } catch (e) {
    json(res, 500, { error: e instanceof Error ? e.message : String(e) });
  }
}

async function accionReunion(res: ServerResponse, id: string, accion: string) {
  try {
    if (accion === "archivar") {
      archivarReunion(db, id);
      return json(res, 200, { ok: true });
    }

    if (accion === "restaurar") {
      restaurarReunion(db, id);
      return json(res, 200, { ok: true });
    }

    if (accion === "detectar") {
      const r = await extractTopics({ db, ...providersFromEnv(db) }, id);
      return json(res, 200, { ok: true, extraidos: r.extracted, needsReview: r.needsReview });
    }
    json(res, 400, { error: "acción desconocida" });
  } catch (e) {
    json(res, 500, { error: e instanceof Error ? e.message : String(e) });
  }
}

/** Acciones del detalle: contexto, detectar, difundir y aceptar. */
async function accionDetalle(res: ServerResponse, id: string, accion: string, cuerpo: string) {
  try {
    if (accion === "contexto") {
      const r = guardarContexto({ db }, id, cuerpo);
      return json(res, 200, { ok: true, titulo: r.title });
    }

    if (accion === "detectar") {
      const r = await detectarRepos({ db, ...providersFromEnv(db) }, id);

      // Se guardan como `pendiente` para que el detalle las muestre aunque
      // todavía no se le haya preguntado a ningún repo.
      db.delete(topicRepo).where(eq(topicRepo.topicId, id)).run();
      for (const repo of r.repos) {
        db.insert(topicRepo)
          .values({
            id: randomUUID(),
            topicId: id,
            repoId: repo.repoId,
            papel: repo.papel,
            status: "pendiente",
            reason: repo.motivo,
            surfaces: [],
            steps: [],
            risks: [],
          })
          .run();
      }

      return json(res, 200, { ok: true, repos: r.repos, duda: r.duda ?? null });
    }

    if (accion === "difundir") {
      const r = await broadcast({ db, ...providersFromEnv(db), worker: workerFromEnv() }, id);
      return json(res, 200, { ok: true, repos: r.repos.length });
    }

    if (accion === "aceptar") {
      const r = aceptarPropuestas({ db }, id, { repoPrefijo: cuerpo });
      return json(res, 200, { ok: true, materializados: r.materializados });
    }

    json(res, 400, { error: "acción desconocida" });
  } catch (e) {
    json(res, 500, { error: e instanceof Error ? e.message : String(e) });
  }
}

function accionRubrica(res: ServerResponse, accion: string, valor: string) {
  try {
    if (accion === "aprobar") {
      const r = aprobarRubrica({ db }, valor);
      return json(res, 200, { ok: true, ...r });
    }
    if (accion === "crear") {
      const r = crearRubricaWeb({ db });
      return json(res, 200, { ok: true, ...r });
    }
    json(res, 400, { error: "acción desconocida" });
  } catch (e) {
    json(res, 400, { error: e instanceof Error ? e.message : String(e) });
  }
}

/* ---------- servidor ---------- */

const servidor = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${process.env.WEB_PORT ?? 4599}`);
  const ruta = url.pathname;

  if (/^\/(app\.css|app\.js|logo-mark\.png)$/.test(ruta)) {
    const archivo = join(PUBLICO, ruta.slice(1));
    if (existsSync(archivo)) {
      responder(res, 200, readFileSync(archivo), MIME[extname(archivo)] ?? "application/octet-stream");
      return;
    }
  }

  const tema = ruta.match(/^\/accion\/([a-f0-9-]+)\/(\w+)\/([a-zA-Z0-9-]*)$/);
  if (tema?.[1] && tema[2]) {
    accionTema(res, tema[1], tema[2], tema[3] ?? "");
    return;
  }

  // Granola: el cuerpo trae el id de la nota.
  if (ruta === "/granola/listar" || ruta === "/granola/importar") {
    let cuerpo = "";
    if (req.method === "POST") {
      const partes: Buffer[] = [];
      for await (const chunk of req) partes.push(chunk as Buffer);
      cuerpo = Buffer.concat(partes).toString("utf8");
    }
    await accionGranola(res, ruta === "/granola/listar" ? "listar" : "importar", cuerpo);
    return;
  }

  const verReunionAccion = ruta.match(/^\/reunion\/([a-f0-9-]+)\/(\w+)$/);
  if (verReunionAccion?.[1] && verReunionAccion[2]) {
    await accionReunion(res, verReunionAccion[1], verReunionAccion[2]);
    return;
  }

  // Acciones del detalle: el cuerpo llega como texto plano (contexto) o vacío.
  const detalle = ruta.match(/^\/tema\/([a-f0-9-]+)\/(\w+)$/);
  if (detalle?.[1] && detalle[2]) {
    let cuerpo = "";
    if (req.method === "POST") {
      const partes: Buffer[] = [];
      for await (const chunk of req) partes.push(chunk as Buffer);
      cuerpo = Buffer.concat(partes).toString("utf8");
    }
    await accionDetalle(res, detalle[1], detalle[2], cuerpo);
    return;
  }

  const rub = ruta.match(/^\/rubrica\/(\w+)(?:\/([a-f0-9-]+))?$/);
  if (rub?.[1]) {
    accionRubrica(res, rub[1], rub[2] ?? "");
    return;
  }

  const verTema = ruta.match(/^\/tema\/([a-f0-9-]+)$/);
  if (verTema?.[1]) return responder(res, 200, pagina(vistaTema(verTema[1])));

  if (ruta === "/") return responder(res, 200, pagina(vistaProyectos()));
  if (ruta === "/temas") return responder(res, 200, pagina(vistaTemas()));
  if (ruta === "/proyectos") return responder(res, 200, redirect("/"));
  if (ruta === "/reuniones/nueva") return responder(res, 200, pagina(vistaNuevaReunion()));
  if (ruta === "/reuniones") return responder(res, 200, pagina(vistaReuniones()));

  const verReunion = ruta.match(/^\/reunion\/([a-f0-9-]+)$/);
  if (verReunion?.[1]) return responder(res, 200, pagina(vistaReunion(verReunion[1], url.searchParams.get("tab") ?? undefined)));
  if (ruta === "/rubrica") return responder(res, 200, pagina(vistaRubrica()));
  if (ruta === "/repos") return responder(res, 200, pagina(vistaRepos()));
  if (ruta === "/trazas") return responder(res, 200, pagina(vistaTrazas()));

  responder(res, 404, "no encontrado");
});

const PORT = Number(process.env.WEB_PORT ?? 4599);
servidor.listen(PORT, "127.0.0.1", () => console.log(`my_erp web · http://127.0.0.1:${PORT}`));
