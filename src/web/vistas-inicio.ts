/** Asistente: el chat al centro y el estado del portafolio al costado. */

import type { Db } from "../infra/db/client.ts";
import { meeting, rubricItem } from "../infra/db/schema.ts";
import { progresoPorProyecto, rango, semanas } from "../app/progreso.ts";
import { esc, type Pagina } from "./render.ts";

export function vistaInicio(db: Db): Pagina {
  const ss = semanas(db);
  const actual = ss[0];

  const proyectos = progresoPorProyecto(db);
  const reuniones = db.select().from(meeting).all();

  // Los items de la semana, agrupados por proyecto: el feed del panel.
  const itemsSemana = actual ? db.select().from(rubricItem).all().filter((i) => i.rubricId === actual.id) : [];
  const nombreProy = new Map(proyectos.map((p) => [p.proyectoId, p.nombre]));
  const ordenProyecto = new Map(proyectos.map((p, i) => [p.proyectoId, i]));

  const feed = [...itemsSemana]
    .sort((a, b) => {
      const pa = ordenProyecto.get(a.projectId ?? "") ?? 99;
      const pb = ordenProyecto.get(b.projectId ?? "") ?? 99;
      return pa - pb || a.position - b.position;
    })
    .map(
      (i, n) => `<div class="feed-fila" data-n="${n}">
    ${
      i.status === "done"
        ? '<svg class="feed-check" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M3.4 8.4l3 3 6.2-6.6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        : '<span class="feed-circulo"></span>'
    }
    <span class="feed-p">${esc(nombreProy.get(i.projectId ?? "") ?? "Sin proyecto")}</span>
    <span class="feed-t">${esc(i.title)}</span>
  </div>`,
    )
    .join("");

  // Cada proyecto con su descripción y los dos aros del diagnóstico.
  const filasProyecto = proyectos
    .map((p, i) => {
      const tono = ["verde", "tinta", "ambar", "malva"][i % 4];
      const negocio = p.diagnostico ? p.diagnostico.negocio : null;
      const tecnico = p.diagnostico ? p.diagnostico.tecnico : null;

      const aro = (pct: number | null, color: string, etiqueta: string) => `
        <span class="pm" data-pct="${pct ?? 0}">
          <svg class="pm-ring" viewBox="0 0 32 32" width="20" height="20" aria-hidden="true">
            <circle class="pm-bg" cx="16" cy="16" r="13" />
            <circle class="pm-fg ${color}" cx="16" cy="16" r="13" stroke-dasharray="0 81.7" />
          </svg>
          <b>${pct === null ? "—" : pct + "%"}</b>
          <i>${etiqueta}</i>
        </span>`;

      return `<a class="pcard ${tono}" href="/proyecto/${p.proyectoId}">
  <div class="pcard-cabeza">
    <span class="pcard-n">${esc(p.nombre)}</span>
    <span class="badge-estado ${p.estado}">${esc(p.estado)}</span>
  </div>
  <p class="pcard-d">${esc(p.descripcion ?? "Sin descripción.")}</p>
  <div class="pcard-metricas">
    ${aro(negocio, "verde", "negocio")}
    <span class="pm-sep"></span>
    ${aro(tecnico, "tinta", "técnico")}
  </div>
  <div class="pcard-pie">${p.repos} repo(s) · semana ${p.semana.pct}%</div>
</a>`;
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
    <img class="perfil" src="/profile.jpg" alt="Carlos" width="46" height="46">
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
