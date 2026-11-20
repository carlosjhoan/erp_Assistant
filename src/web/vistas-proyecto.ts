/** Pantallas de proyectos y del dashboard de rúbricas por semana. */

import { asc, eq } from "drizzle-orm";
import type { Db } from "../infra/db/client.ts";
import { capacidadesEfectivas, progresoPorProyecto, rango, semanas, veredicto, type SemanaResumen } from "../app/progreso.ts";
import { project, projectCapability, projectRepository, repo as repoTable, rubric, rubricItem } from "../infra/db/schema.ts";
import { esc, type Pagina } from "./render.ts";
import { createTopicRepo } from "../infra/db/topic-repo.ts";

const barra = (pct: number, clase = "") =>
  `<div class="prog ${clase}"><span style="width:${Math.max(0, Math.min(100, pct))}%"></span></div>`;

const tono = (i: number) => ["verde", "tinta", "ambar", "malva"][i % 4];

/** Mini grafico de la serie semanal. Lee de viejo a nuevo. */
function sparkline(puntos: number[]): string {
  if (puntos.length < 2) return "";
  const serie = [...puntos].reverse();
  const w = 260;
  const h = 34;
  const paso = w / (serie.length - 1);
  const xy = serie.map((v, i) => [i * paso, h - (Math.max(0, Math.min(100, v)) / 100) * h] as const);
  const linea = xy.map(([x, y]) => x.toFixed(1) + "," + y.toFixed(1)).join(" ");
  const area = "0," + h + " " + linea + " " + w + "," + h;
  return "<svg class=\"spark\" viewBox=\"0 0 " + w + " " + h + "\" preserveAspectRatio=\"none\" aria-hidden=\"true\"><polygon points=\"" + area + "\" fill=\"currentColor\" opacity=\"0.07\"/><polyline points=\"" + linea + "\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"/></svg>";
}

function conteo(db: Db) {
  return createTopicRepo(db).bandeja().length;
}

/** Descripción de cada proyecto. Por ahora fija; luego vendrá de la ficha. */
const DESCRIPCIONES: Record<string, string> = {
  Comercial: "Activación de leads, pipeline y contenido asistido para el área comercial.",
  "Gerancial-Brain": "Inteligencia financiera: tablero de decisión y seguimiento gerencial.",
  Landing: "Landing comercial: presentación del negocio y captura de demanda.",
  CRM: "Gestión de clientes. Modelo de datos definido y onboarding en curso.",
};

const descripcion = (nombre: string) => DESCRIPCIONES[nombre] ?? "Sin descripción definida.";

export function vistaProyectos(db: Db): Pagina {
  const datos = progresoPorProyecto(db);

  // Nombres de los repos por proyecto, para el pie de la tarjeta.
  const vinculos = db.select().from(projectRepository).all();
  const todosRepos = db.select().from(repoTable).all();
  const reposDe = (id: string) =>
    vinculos
      .filter((v) => v.projectId === id)
      .map((v) => todosRepos.find((r) => r.id === v.repoId)?.name)
      .filter((n): n is string => Boolean(n));

  const fila = (etq: string, pct: number | null, clase: string, nota: string) =>
    [
      '<div class="tp-fila">',
      '<span class="tp-etq">' + etq + "</span>",
      barra(pct ?? 0, clase),
      "<b>" + (pct === null ? "—" : pct + "%") + "</b>",
      '<span class="tp-n">' + nota + "</span>",
      "</div>",
    ].join("");

  const tarjetas = datos
    .map((p, i) => {
      const negocio = p.diagnostico ? p.diagnostico.negocio : null;
      const tecnico = p.diagnostico ? p.diagnostico.tecnico : null;
      const repos = reposDe(p.proyectoId);

      const cuerpo = [
        '<a class="tarjeta-proyecto ' + tono(i) + '" href="/proyecto/' + p.proyectoId + '">',
        '<div class="tp-cabeza">',
        "<strong>" + esc(p.nombre) + "</strong>",
        '<i class="vivo" aria-label="' + esc(p.estado) + '"></i>',
        "</div>",
        '<p class="tp-desc">' + esc(descripcion(p.nombre)) + "</p>",
        '<div class="tp-avance">',
        fila("Semana", p.semana.pct, "verde", p.semana.hechos + " de " + p.semana.total + " ítems"),
        fila("Negocio", negocio, "verde", negocio === null ? "sin diagnóstico" : ""),
        fila("Técnico", tecnico, "tinta", tecnico === null ? "sin diagnóstico" : ""),
        "</div>",
      ];

      if (repos.length > 0) {
        cuerpo.push(
          '<div class="tp-repos">' +
            repos.map((r) => '<span class="repo-badge">' + esc(r) + "</span>").join("") +
            "</div>",
        );
      }

      cuerpo.push("</a>");
      return cuerpo.join("\n");
    })
    .join("\n");

  return {
    titulo: "Proyectos",
    seccion: "proyectos",
    conteoBandeja: conteo(db),
    accion: '<button class="boton" data-abrir="modal-proyecto">+ Nuevo proyecto</button>',
    cuerpo:
      '<p class="nota-linea">Tres medidas por proyecto: el avance de esta semana y los dos ejes del diagnóstico.</p>\n' +
      (tarjetas || '<div class="vacio-mini">Todavía no hay proyectos.</div>') +
      "\n" +
      modalProyecto(),
  };
}

function descripcionDe(db: Db, id: string): string {
  return db.select().from(project).where(eq(project.id, id)).all()[0]?.description ?? "Sin descripción.";
}

function modalProyecto(): string {
  return `<dialog id="modal-proyecto" class="modal">
  <header><h2>Nuevo proyecto</h2><button class="cerrar" data-cerrar-modal="modal-proyecto" aria-label="Cerrar">✕</button></header>
  <form method="post" action="/proyecto/crear">
    <label>Nombre<input name="nombre" required maxlength="80" placeholder="Comercial"></label>
    <label>Descripción<textarea name="descripcion" rows="2" placeholder="De qué se ocupa este proyecto"></textarea></label>
    <label>Ruta en disco<input name="ruta" required placeholder="d:/MIR/.../Comercial"></label>
    <p class="nota">Los repos y el diagnóstico se agregan después, desde el detalle.</p>
    <div class="modal-pie"><button class="boton" type="submit">Crear proyecto</button></div>
  </form>
</dialog>`;
}

/** Resumen por semana de los items de un proyecto. */
function filasSemanaDe(todos: SemanaResumen[], mios: (typeof rubricItem.$inferSelect)[]) {
  return todos
    .filter((s) => mios.some((i) => i.rubricId === s.id))
    .map((s) => {
      const propios = mios.filter((i) => i.rubricId === s.id && i.status !== "dropped");
      const hechos = propios.filter((i) => i.status === "done").length;
      return {
        id: s.id,
        desde: s.desde,
        hasta: s.hasta,
        pct: propios.length > 0 ? Math.round((hechos / propios.length) * 100) : 0,
        hechos,
        vivos: propios.length,
      };
    });
}

export function vistaProyecto(db: Db, id: string): Pagina {
  const p = db.select().from(project).where(eq(project.id, id)).all()[0];
  if (!p) return { titulo: "Proyecto", seccion: "proyectos", cuerpo: `<div class="vacio"><h2>No existe</h2></div>` };

  const todos = semanas(db);
  // El diagnóstico se calcula desde las capacidades importadas del prototipo.
  const caps = db
    .select()
    .from(projectCapability)
    .where(eq(projectCapability.projectId, id))
    .all()
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const capsEf = capacidadesEfectivas(caps, db.select().from(rubricItem).all());
  const v = veredicto(capsEf);
  const diag = caps.length > 0 ? v : null;

  const items = db.select().from(rubricItem).all();
  const mios = items.filter((i) => i.projectId === id).sort((a, b) => a.position - b.position);

  const vivos = mios.filter((i) => i.status !== "dropped").length;
  const hechos = mios.filter((i) => i.status === "done").length;
  const pct = vivos > 0 ? Math.round((hechos / vivos) * 100) : 0;

  const filasSemana = todos
    .filter((s) => mios.some((i) => i.rubricId === s.id))
    .map((s) => {
      const propios = mios.filter((i) => i.rubricId === s.id).sort((a, b) => a.position - b.position);
      const v = propios.filter((i) => i.status !== "dropped");
      const h = propios.filter((i) => i.status === "done").length;
      const x = v.length > 0 ? Math.round((h / v.length) * 100) : 0;
      return `<div class="av-fila">
  <span class="av-rango">${rango(s.desde, s.hasta)}</span>
  ${barra(x)}
  <b>${x}%</b>
  <span class="av-n">${h} de ${v.length}</span>
</div>
<div class="grupo-item">
${propios.map((i) => filaItem(i)).join("")}
</div>`;
    })
    .join("");

  const repos = db
    .select()
    .from(projectRepository)
    .where(eq(projectRepository.projectId, id))
    .all()
    .map((v) => db.select().from(repoTable).where(eq(repoTable.id, v.repoId)).all()[0])
    .filter(Boolean);

  const serie = todos
    .filter((x) => mios.some((i) => i.rubricId === x.id))
    .map((x) => {
      const propios = mios.filter((i) => i.rubricId === x.id && i.status !== "dropped");
      const h = propios.filter((i) => i.status === "done").length;
      return propios.length > 0 ? Math.round((h / propios.length) * 100) : 0;
    });

  const semana = filasSemanaDe(todos, mios)[0];

  return {
    titulo: p.name,
    seccion: "proyectos",
    conteoBandeja: conteo(db),
    cuerpo: `<div class="pj-split">

  <aside class="pj-lado">
    <a class="volver" href="/proyectos">← Proyectos</a>
    <div class="pj-titulo">
      <h2>${esc(p.name)}</h2>
      <i class="vivo" aria-label="${esc(p.status)}"></i>
    </div>
    <p class="pj-desc">${esc(descripcion(p.name))}</p>
    <p class="pj-ruta"><code>${esc(p.path)}</code></p>

    <div class="pj-diag">
      ${
        diag
          ? `<div class="diag-fila"><span class="diag-etq">Negocio</span>${barra(diag.negocio, "verde")}<b>${diag.negocio}%</b></div>
             <div class="diag-fila"><span class="diag-etq">Producción</span>${barra(diag.produccion, "tinta")}<b>${diag.produccion}%</b></div>

             <button type="button" class="pill-diag" data-abrir="modal-diag">
               <span class="pd-punto ${diag.estado}"></span>
               Diagnóstico ${diag.estado}
               <span class="pd-n">${diag.completos} de ${diag.base}</span>
             </button>`
          : `<p class="nota">Sin diagnóstico cargado.</p>`
      }
    </div>
  </aside>

  <dialog id="modal-diag" class="modal modal-diag">
    <header>
      <h2>Diagnóstico · ${esc(p.name)}</h2>
      <button class="cerrar" data-cerrar-modal="modal-diag" aria-label="Cerrar">✕</button>
    </header>
    ${
      diag
        ? `<div class="md-resumen">
      <div><span>Negocio</span><b>${diag.negocio}%</b></div>
      <div><span>Producción</span><b>${diag.produccion}%</b></div>
      <div><span>Estado</span><b>${diag.estado}</b></div>
    </div>
    <p class="md-nota">${diag.completos} integradas · ${diag.parciales} parciales · ${diag.ausentes} ausentes de ${diag.base}</p>
    <div class="md-caps">
      ${capsEf
        .filter((c) => c.scope !== "futuro" && !c.outsideRubric)
        .map(
          (c) => `<details class="cap ${c.integration === "I3" ? "ok" : c.integration === "I2" ? "parcial" : "ausente"}">
        <summary>
          <span class="cap-dot"></span>
          <span class="cap-t">${esc(c.title)}</span>
          <span class="cap-e">${c.movidaPorItems ? `${esc(c.base)} → ${esc(c.integration)}` : esc(c.integration)}</span>
        </summary>
        ${(c.good ?? []).map((g) => `<p class="cap-g">${esc(g)}</p>`).join("")}
        ${(c.improve ?? []).map((g) => `<p class="cap-m">${esc(g)}</p>`).join("")}
      </details>`,
        )
        .join("")}
    </div>`
        : `<p class="nota">Este proyecto todavía no tiene diagnóstico.</p>`
    }
  </dialog>

  <section class="pj-lienzo">
    <div class="pj-lienzo-head">
      <h3 class="bloque-t">Avance<span class="bloque-fecha">${pct}% acumulado</span></h3>
      ${serie.length > 1 ? `<div class="spark-caja">${sparkline(serie)}<span class="spark-pie">${serie.length} semanas</span></div>` : ""}
    </div>
    ${filasSemana || `<p class="nota">Todavía no hay ítems imputados a este proyecto.</p>`}
  </section>

</div>`,
  };
}

type CapOpcion = { id: string; title: string; key: string };

/**
 * Una fila de ítem. Si el proyecto tiene diagnóstico, aparece el selector que
 * declara qué capacidad mueve: sin eso, cerrar el ítem no cambia nada.
 */
function filaItem(i: typeof rubricItem.$inferSelect, caps: CapOpcion[] = []): string {
  const opciones = [
    '<option value="">— sin capacidad —</option>',
    ...caps.map(
      (c) =>
        `<option value="${c.id}"${i.capabilityId === c.id ? " selected" : ""}>${esc(c.key)} · ${esc(c.title.slice(0, 38))}</option>`,
    ),
  ].join("");

  const efecto = i.capabilityId
    ? `<select class="it-efecto" data-efecto="${i.id}">
        <option value="avanza"${i.capabilityEffect === "avanza" ? " selected" : ""}>avanza</option>
        <option value="cierra"${i.capabilityEffect === "cierra" ? " selected" : ""}>cierra</option>
      </select>`
    : "";

  return `<div class="it-fila" data-fila="${i.id}">
  <label class="it">
    <input type="checkbox" data-item="${i.id}"${i.status === "done" ? " checked" : ""}>
    <span class="it-txt">${esc(i.title)}</span>
    <span class="it-tipo">${esc(i.type)}</span>
  </label>
  <button type="button" class="it-accion" data-editar="${i.id}" title="Editar">editar</button>
  <button type="button" class="it-accion peligro" data-borrar="${i.id}" title="Borrar">borrar</button>
  ${caps.length > 0 ? `<select class="it-cap" data-cap="${i.id}" aria-label="Capacidad que mueve">${opciones}</select>` : ""}
  ${efecto}
</div>`;
}

export function vistaRubricas(db: Db): Pagina {
  const todas = semanas(db);
  if (todas.length === 0) {
    return {
      titulo: "Rúbricas",
      seccion: "rubrica",
      conteoBandeja: conteo(db),
      cuerpo: `<div class="vacio"><h2>Todavía no hay semanas</h2><p>Se crean al aprobar una rúbrica desde una reunión.</p></div>`,
    };
  }

  const [actual, ...anteriores] = todas as [SemanaResumen, ...SemanaResumen[]];

  const detalle = (s: SemanaResumen) =>
    s.porProyecto
      .map(
        (x, i) =>
          `<span class="mini-stat"><i class="pt ${tono(i)}"></i>${esc(x.nombre)} <b>${x.pct}%</b></span>`,
      )
      .join("");

  const cardActual = `<a class="semana-card actual" href="/rubrica/${actual.id}">
  <div class="sc-cabeza"><strong>${rango(actual.desde, actual.hasta)}</strong><span class="pill ink">actual</span></div>
  <div class="sc-grande">
    ${barra(actual.pct, "verde")}
    <b class="sc-pct">${actual.pct}%</b>
  </div>
  <p class="sc-n">${actual.hechos} de ${actual.total} ítems</p>
  <div class="sc-minis">${detalle(actual)}</div>
  <span class="sc-abrir">abrir semana →</span>
</a>`;

  const cards = anteriores
    .map(
      (s) => `<a class="semana-card" href="/rubrica/${s.id}">
  <div class="sc-cabeza"><strong>${rango(s.desde, s.hasta)}</strong><span class="pill">${esc(s.estado)}</span></div>
  <div class="sc-mini-fila">${barra(s.pct, "tinta")}<b>${s.pct}%</b><span class="sc-n">${s.hechos} de ${s.total} ítems</span></div>
</a>`,
    )
    .join("\n");

  return {
    titulo: "Rúbricas",
    seccion: "rubrica",
    conteoBandeja: conteo(db),
    cuerpo: `<p class="nota-linea">Todo se organiza por rango de fechas, no por número de semana.</p>
${cardActual}
<div class="semanas-grid">${cards}</div>`,
  };
}

export function vistaSemana(db: Db, id: string): Pagina {
  const r = db.select().from(rubric).where(eq(rubric.id, id)).all()[0];
  if (!r) return { titulo: "Semana", seccion: "rubrica", cuerpo: `<div class="vacio"><h2>No existe</h2></div>` };

  const items = db.select().from(rubricItem).where(eq(rubricItem.rubricId, id)).all();
  const proyectos = db.select().from(project).all().sort((a, b) => a.name.localeCompare(b.name));
  const todasCaps = db.select().from(projectCapability).all();
  const capsDe = (projectId: string | null) =>
    projectId
      ? todasCaps
          .filter((c) => c.projectId === projectId && c.scope !== "futuro" && !c.outsideRubric)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((c) => ({ id: c.id, title: c.title, key: c.key }))
      : [];

  // Un ítem sin proyecto se agrupa aparte y no suma a ningún porcentaje.
  const grupos = [
    ...proyectos.map((p) => ({ id: p.id as string | null, nombre: p.name })),
    { id: null as string | null, nombre: "Sin proyecto" },
  ];

  const secciones = grupos
    .map((g, i) => {
      const propios = items
        .filter((it) => (g.id ? it.projectId === g.id : !it.projectId))
        .sort((a, b) => a.position - b.position);
      if (propios.length === 0) return "";

      const vivos = propios.filter((it) => it.status !== "dropped").length;
      const hechos = propios.filter((it) => it.status === "done").length;
      const pct = vivos > 0 ? Math.round((hechos / vivos) * 100) : 0;

      return `<section class="grupo ${g.id ? tono(i) : "ambar"}">
  <header class="grupo-h">
    <span class="grupo-n">${esc(g.nombre)}</span>
    <span class="grupo-m">${
      g.id
        ? `${barra(pct)}<b>${pct}%</b><span class="grupo-c">${hechos} de ${vivos}</span>`
        : `<span class="grupo-c">no suma al %</span>`
    }</span>
  </header>
${propios.map((it) => filaItem(it, capsDe(it.projectId))).join("")}
</section>`;
    })
    .join("\n");

  const validos = items.filter((i) => i.status !== "dropped").length;
  const done = items.filter((i) => i.status === "done").length;

  return {
    titulo: rango(r.weekStart, r.deadline),
    seccion: "rubrica",
    conteoBandeja: conteo(db),
    accion: `<button class="boton" data-abrir="modal-item">+ Ítem</button>`,
    cuerpo: `<a class="volver" href="/rubrica">← Rúbricas</a>
<div class="pj-cabeza">
  <h2>${rango(r.weekStart, r.deadline)}</h2>
  <p class="tp-meta">${done} de ${validos} ítems · ${validos > 0 ? Math.round((done / validos) * 100) : 0}%</p>
</div>
${secciones || `<p class="nota">Esta semana no tiene ítems todavía.</p>`}
${modalItem(db, r.id)}`,
  };
}

function modalItem(db: Db, rubricId: string): string {
  const proyectos = db.select().from(project).all().sort((a, b) => a.name.localeCompare(b.name));
  const opciones = [
    `<option value="">Sin proyecto</option>`,
    ...proyectos.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`),
  ].join("");

  return `<dialog id="modal-item" class="modal">
  <header><h2>Nuevo ítem</h2><button class="cerrar" data-cerrar-modal="modal-item" aria-label="Cerrar">✕</button></header>
  <form method="post" action="/rubrica/${rubricId}/item">
    <label>Título<input name="titulo" required maxlength="160" placeholder="Configurar dominio verificado"></label>
    <label>Criterio de aceptación<textarea name="criterio" rows="2" required placeholder="Cómo se sabe que está hecho"></textarea></label>
    <label>Proyecto<select name="proyecto">${opciones}</select></label>
    <label>Justificación<textarea name="justificacion" rows="2" placeholder="Obligatoria si no tiene proyecto"></textarea></label>
    <div class="modal-pie"><button class="boton" type="submit">Crear ítem</button></div>
  </form>
</dialog>`;
}
