/** Inicio agéntico: el chat al centro y el estado del portafolio al costado. */

import { desc } from "drizzle-orm";
import type { Db } from "../infra/db/client.ts";
import { agentRun, llmCall, meeting, topic } from "../infra/db/schema.ts";
import { progresoPorProyecto, rango, semanas } from "../app/progreso.ts";
import { esc, type Pagina } from "./render.ts";

/** Costo de hoy. Se calcula desde las llamadas, no se guarda aparte. */
export function costoHoy(db: Db): { usd: number; llamadas: number } {
  const hoy = new Date().toDateString();
  const filas = db.select().from(llmCall).all().filter((c) => new Date(c.createdAt).toDateString() === hoy);
  return { usd: filas.reduce((a, c) => a + (c.costUsd ?? 0), 0), llamadas: filas.length };
}

const usd = (v: number) => (v === 0 ? "—" : `$${v.toFixed(4)}`);

const hace = (fecha: Date) => {
  const min = Math.round((Date.now() - fecha.getTime()) / 60000);
  if (min < 1) return "ahora";
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h`;
  return `${Math.round(h / 24)} d`;
};

export function vistaInicio(db: Db): Pagina {
  const ss = semanas(db);
  const actual = ss[0];
  const costo = costoHoy(db);

  const proyectos = progresoPorProyecto(db);
  const reuniones = db.select().from(meeting).all();
  const temas = db.select().from(topic).all();
  const sinCalificar = temas.filter((t) => t.status === "proposed").length;

  const runs = db.select().from(agentRun).orderBy(desc(agentRun.createdAt)).all().slice(0, 5);
  const costos = new Map(db.select().from(llmCall).all().map((c) => [c.runId, c.costUsd ?? 0]));

  const filasProyecto = proyectos
    .map((p, i) => {
      const tono = ["verde", "tinta", "ambar", "malva"][i % 4];
      return `<a class="pproy ${tono}" href="/proyecto/${p.proyectoId}">
  <span class="pproy-n">${esc(p.nombre)}</span>
  <span class="pproy-p">${p.semana.pct}%</span>
  <span class="pproy-b">${p.semana.hechos}/${p.semana.total}</span>
</a>`;
    })
    .join("");

  const actividad = runs
    .map((r) => {
      const etq = r.tool === "consulta" ? "Consulta" : r.tool.replaceAll("_", " ");
      return `<div class="act-fila">
  <i class="pt ${r.outcome === "ok" ? "verde" : "ambar"}"></i>
  <span class="act-n">${esc(etq)}</span>
  <span class="act-t">${hace(new Date(r.createdAt))}</span>
  <span class="act-c">${usd(costos.get(r.id) ?? 0)}</span>
</div>`;
    })
    .join("");

  return {
    titulo: "Inicio",
    seccion: "inicio",
    conteoBandeja: sinCalificar,
    cuerpo: `<div class="inicio">
  <section class="chat" id="chat">
    <div class="chat-hilo" id="hilo" aria-live="polite"></div>

    <form class="chat-caja" id="form-consulta" autocomplete="off">
      <textarea id="pregunta" name="pregunta" rows="1" maxlength="300"
        placeholder="Preguntá lo que quieras: cómo va Comercial, qué falta esta semana, cuánto costó hoy…"></textarea>
      <div class="chat-acciones">
        <button type="button" class="mic" id="mic" aria-label="Dictar" title="Dictar">
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
            <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" fill="currentColor"/>
            <path d="M6 11a6 6 0 0 0 12 0M12 17v4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
        </button>
        <button type="submit" class="agente-enviar" aria-label="Enviar">→</button>
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

  <aside class="panel">
    <div class="panel-bloque">
      <h3 class="bloque-t">Proyectos<span class="bloque-fecha">${proyectos.length}</span></h3>
      <div class="pproy-lista">${filasProyecto}</div>
    </div>

    <div class="panel-bloque">
      <h3 class="bloque-t">Rúbrica<span class="bloque-fecha">${actual ? rango(actual.desde, actual.hasta) : "sin abrir"}</span></h3>
      ${
        actual
          ? `<a class="rub-mini" href="/rubrica/${actual.id}">
        <span class="rub-mini-p">${actual.pct}%</span>
        <span class="rub-mini-n">${actual.hechos} de ${actual.total} ítems</span>
        <div class="prog verde"><span style="width:${actual.pct}%"></span></div>
      </a>`
          : `<p class="nota">No hay semana abierta.</p>`
      }
    </div>

    <div class="panel-bloque">
      <h3 class="bloque-t">Reuniones<span class="bloque-fecha">${reuniones.length}</span></h3>
      <a class="mini-fila" href="/reuniones">
        <span>${sinCalificar} tema(s) sin calificar</span>
        <span class="mini-flecha">→</span>
      </a>
    </div>

    <div class="panel-bloque">
      <h3 class="bloque-t">Actividad<span class="bloque-fecha">${usd(costo.usd)} hoy</span></h3>
      ${actividad || `<p class="nota">Sin actividad registrada.</p>`}
    </div>
  </aside>
</div>`,
  };
}
