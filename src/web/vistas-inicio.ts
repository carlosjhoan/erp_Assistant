/** Asistente: el chat al centro y el estado del portafolio al costado. */

import type { Db } from "../infra/db/client.ts";
import { meeting, projectCapability, rubricItem } from "../infra/db/schema.ts";
import { capacidadesEfectivas, progresoPorProyecto, rango, semanas, veredicto } from "../app/progreso.ts";
import { esc, type Pagina } from "./render.ts";

const CHECK = `<svg class="feed-check" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M3.4 8.4l3 3 6.2-6.6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CIRCULO = `<span class="feed-circulo"></span>`;

export function vistaInicio(db: Db): Pagina {
  const ss = semanas(db);
  const actual = ss[0];

  const proyectos = progresoPorProyecto(db);
  const reuniones = db.select().from(meeting).all();

  const todasCaps = db.select().from(projectCapability).all();
  const todosItems = db.select().from(rubricItem).all();

  const capsDe = (id: string) => todasCaps.filter((c) => c.projectId === id);

  // El diagnóstico es el punto de partida: sin nada de esta semana.
  const base = new Map(proyectos.map((p) => [p.proyectoId, veredicto(capsDe(p.proyectoId))]));

  // El cierre estimado es el estado real de hoy, con todo lo hecho.
  const cierre = new Map(
    proyectos.map((p) => [p.proyectoId, veredicto(capacidadesEfectivas(capsDe(p.proyectoId), todosItems))]),
  );

  // El alta más reciente: ese es el "nuevo".
  const ultimoAlta = proyectos.reduce((max, p) => Math.max(max, new Date(p.creadoEn).getTime()), 0);

  const aro = (proyId: string, pct: number | null, color: string, etiqueta: string, medida: string) => `
        <span class="pm" data-proy="${proyId}" data-medida="${medida}" data-pct="${pct ?? 0}">
          <svg class="pm-ring" viewBox="0 0 32 32" width="20" height="20" aria-hidden="true">
            <circle class="pm-bg" cx="16" cy="16" r="13" />
            <circle class="pm-fg ${color}" cx="16" cy="16" r="13" stroke-dasharray="0 81.7" />
          </svg>
          <b>${pct === null ? "—" : pct + "%"}</b>
          <i>${etiqueta}</i>
        </span>`;

  const filasProyecto = proyectos
    .map((p, i) => {
      const tono = ["verde", "tinta", "ambar", "malva"][i % 4];
      const nuevo = new Date(p.creadoEn).getTime() === ultimoAlta;
      const desde = base.get(p.proyectoId);
      const hasta = cierre.get(p.proyectoId);

      const negocio = p.diagnostico ? (desde?.negocio ?? 0) : null;
      const tecnico = p.diagnostico ? (desde?.produccion ?? 0) : null;

      return `<a class="pcard ${tono}${nuevo ? " es-nuevo" : ""}" href="/proyecto/${p.proyectoId}">
  <div class="pcard-cabeza">
    <i class="vivo" aria-hidden="true"></i>
    <span class="pcard-n">${esc(p.nombre)}</span>
  </div>
  <div class="pcard-metricas">
    ${aro(p.proyectoId, negocio, "verde", "negocio", "negocio")}
    <span class="pm-sep"></span>
    ${aro(p.proyectoId, tecnico, "tinta", "técnico", "tecnico")}
  </div>
  ${
    p.diagnostico
      ? `<div class="pcard-cierre">al cierre <b>${hasta?.negocio ?? 0}%</b> · <b>${hasta?.produccion ?? 0}%</b></div>`
      : ""
  }
  ${nuevo ? '<span class="badge-nuevo">NUEVO</span>' : ""}
</a>`;
    })
    .join("");

  // Los ítems de la semana, ordenados por proyecto, con el avance que dejan.
  const itemsSemana = actual ? todosItems.filter((i) => i.rubricId === actual.id) : [];
  const nombreProy = new Map(proyectos.map((p) => [p.proyectoId, p.nombre]));
  const ordenProyecto = new Map(proyectos.map((p, i) => [p.proyectoId, i]));

  const itemsOrdenados = [...itemsSemana].sort((a, b) => {
    const pa = ordenProyecto.get(a.projectId ?? "") ?? 99;
    const pb = ordenProyecto.get(b.projectId ?? "") ?? 99;
    return pa - pb || a.position - b.position;
  });

  const aplicados: typeof todosItems = [];
  const acumulado = new Map<string, { negocio: number; produccion: number }>();

  for (const it of itemsOrdenados) {
    aplicados.push(it);
    if (!it.projectId) continue;
    const v = veredicto(capacidadesEfectivas(capsDe(it.projectId), aplicados));
    acumulado.set(it.id, { negocio: v.negocio, produccion: v.produccion });
  }

  const feed = itemsOrdenados
    .map((i, n) => {
      const ac = acumulado.get(i.id);
      const marca = i.status === "done" ? CHECK : CIRCULO;
      return `<div class="feed-fila" data-n="${n}" data-proy="${i.projectId ?? ""}" data-neg="${ac?.negocio ?? ""}" data-tec="${ac?.produccion ?? ""}">
    ${marca}
    <span class="feed-p">${esc(nombreProy.get(i.projectId ?? "") ?? "Sin proyecto")}</span>
    <span class="feed-t">${esc(i.title)}</span>
  </div>`;
    })
    .join("");

  return {
    titulo: "Asistente",
    seccion: "inicio",
    conteoBandeja: 0,
    cuerpo: `<div class="inicio" id="inicio" data-estado="idle">
  <section class="chat" id="chat">
    <div class="chat-hilo" id="hilo" aria-live="polite"></div>

    <form class="chat-caja" id="form-consulta" autocomplete="off">
      <span class="hoja hoja-i" aria-hidden="true"></span>
      <span class="hoja hoja-d" aria-hidden="true"></span>
      <textarea id="pregunta" name="pregunta" rows="1" maxlength="300"
        placeholder="Pregunta lo que quieras: cómo va Comercial, qué falta esta semana, cuánto costó hoy…"></textarea>
      <div class="chat-acciones">
        <button type="button" class="mic" id="mic" aria-label="Dictar" title="Dictar">
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
            <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" fill="currentColor"/>
            <path d="M6 11a6 6 0 0 0 12 0M12 17v4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
        </button>
        <button type="submit" class="agente-enviar" aria-label="Enviar consulta">
          <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
            <path d="M21.5 2.5 2.8 9.9l6.9 3.4 3.4 6.9 8.4-17.7Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M9.7 13.3 21.5 2.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
    </form>

    <div class="chat-estado" id="estado" hidden>
      <span class="paso" data-paso="entendiendo"><i></i>entendiendo</span>
      <span class="flecha">→</span>
      <span class="paso" data-paso="consultando"><i></i>consultando datos</span>
      <span class="flecha">→</span>
      <span class="paso" data-paso="listo"><i></i>listo</span>
      <span class="agente-meta" id="meta"></span>
    </div>
  </section>

  <header class="saludo">
    <img class="perfil" src="/profile.jpg" alt="Carlos" width="96" height="96">
    <h1 class="entrada" id="entrada">
      <span id="maquina" aria-label="Así van las cosas con Carlos ..."></span><i class="caret" aria-hidden="true"></i>
    </h1>
  </header>

  <aside class="panel">
    <div class="panel-bloque">
      <h3 class="bloque-t">Proyectos<span class="bloque-fecha">${proyectos.length}</span></h3>
      <div class="pproy-lista">${filasProyecto}</div>
    </div>

    <div class="panel-bloque">
      <h3 class="bloque-t">En la semana<span class="bloque-fecha">${actual ? rango(actual.desde, actual.hasta) : "sin abrir"}</span></h3>
      ${
        actual
          ? `<div class="feed-prog">
        <div class="feed-prog-barra"><span id="feed-barra"></span></div>
        <span class="feed-prog-n" id="feed-num">0/${itemsSemana.length}</span>
      </div>
      <div class="feed" id="feed">${feed}</div>`
          : `<p class="nota">No hay semana abierta.</p>`
      }
    </div>

    <div class="panel-bloque">
      <h3 class="bloque-t">Reuniones<span class="bloque-fecha">${reuniones.length}</span></h3>
      <div class="reuniones-lista">
        ${reuniones
          .map(
            (m) =>
              `<a class="reunion-fila" href="/reunion/${m.id}">
          <span class="reunion-f">${new Date(m.occurredAt).toLocaleDateString("es-CO", { day: "2-digit", month: "short" })}</span>
          <span class="reunion-a">${new Date(m.occurredAt).getFullYear()}</span>
        </a>`,
          )
          .join("")}
      </div>
    </div>
  </aside>
</div>`,
  };
}
