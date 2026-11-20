/** Inicio agéntico: el dashboard con el que se abre el ERP. */

import { desc } from "drizzle-orm";
import type { Db } from "../infra/db/client.ts";
import { agentRun, llmCall, meeting, topic } from "../infra/db/schema.ts";
import { rango, semanas } from "../app/progreso.ts";
import { esc, type Pagina } from "./render.ts";

/** Costo de hoy. Se calcula desde las llamadas, no se guarda aparte. */
export function costoHoy(db: Db): { usd: number; llamadas: number } {
  const hoy = new Date().toISOString().slice(0, 10);
  const filas = db.select().from(llmCall).all().filter((c) => new Date(c.createdAt).toISOString().slice(0, 10) === hoy);
  return { usd: filas.reduce((a, c) => a + (c.costUsd ?? 0), 0), llamadas: filas.length };
}

const usd = (v: number) => (v === 0 ? "—" : `$${v.toFixed(4)}`);

const hace = (fecha: Date) => {
  const min = Math.round((Date.now() - fecha.getTime()) / 60000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
};

const ETIQUETA_TOOL: Record<string, string> = {
  consulta: "Consulta",
  extract_topics: "Extracción de temas",
  classify_topic: "Clasificación",
  generate_items: "Desglose de ítems",
  verify_topics: "Verificación",
  verify_items: "Verificación de ítems",
  detect_repos: "Detección de repos",
};

export function vistaInicio(db: Db): Pagina {
  const ss = semanas(db);
  const actual = ss[0];
  const costo = costoHoy(db);
  const proyectos = db.select().from(meeting).all();
  const temas = db.select().from(topic).all();
  const sinCalificar = temas.filter((t) => t.status === "proposed").length;

  const runs = db.select().from(agentRun).orderBy(desc(agentRun.createdAt)).all().slice(0, 6);
  const costos = new Map(db.select().from(llmCall).all().map((c) => [c.runId, c.costUsd ?? 0]));

  const actividad = runs
    .map(
      (r) => `<div class="act-fila">
  <i class="pt ${r.outcome === "ok" ? "verde" : "ambar"}"></i>
  <span class="act-n">${esc(ETIQUETA_TOOL[r.tool] ?? r.tool)}</span>
  <span class="act-d">${esc(r.kind)}</span>
  <span class="act-t">${hace(new Date(r.createdAt))}</span>
  <span class="act-c">${usd(costos.get(r.id) ?? 0)}</span>
</div>`,
    )
    .join("");

  const nProyectos = db.select().from(agentRun).all().length > 0 ? new Set(temas.map((t) => t.projectId).filter(Boolean)).size : 0;

  return {
    titulo: "Inicio",
    seccion: "inicio",
    conteoBandeja: sinCalificar,
    cuerpo: `<section class="agente" id="agente">
  <form class="agente-caja" id="form-consulta" autocomplete="off">
    <div class="agente-fila">
      <input id="pregunta" name="pregunta" placeholder="Preguntá lo que quieras: cómo va Comercial, qué falta esta semana, cuánto costó hoy…" maxlength="300" required>
      <button type="submit" class="agente-enviar" aria-label="Consultar">→</button>
    </div>
    <div class="agente-estado" id="estado" hidden>
      <span class="paso" data-paso="entendiendo"><i></i>entendiendo</span>
      <span class="flecha">→</span>
      <span class="paso" data-paso="consultando"><i></i>consultando datos</span>
      <span class="flecha">→</span>
      <span class="paso" data-paso="listo"><i></i>listo</span>
      <span class="agente-meta" id="meta"></span>
    </div>
  </form>
  <div class="agente-respuesta" id="respuesta" hidden></div>
</section>

<div class="stat-fila">
  <a class="stat-card verde" href="/proyectos">
    <span class="stat-etq">Proyectos</span>
    <b class="stat-num">${nProyectos}</b>
    <span class="stat-nota">con trabajo esta semana</span>
  </a>
  <a class="stat-card tinta" href="/rubrica">
    <span class="stat-etq">Rúbrica</span>
    <b class="stat-num">${actual ? actual.pct + "%" : "—"}</b>
    <span class="stat-nota">${actual ? rango(actual.desde, actual.hasta) : "sin semana abierta"}</span>
  </a>
  <a class="stat-card ambar" href="/reuniones">
    <span class="stat-etq">Reuniones</span>
    <b class="stat-num">${proyectos.length}</b>
    <span class="stat-nota">${sinCalificar} tema(s) sin calificar</span>
  </a>
</div>

<section class="bloque">
  <h3 class="bloque-t">Actividad<span class="bloque-fecha">${usd(costo.usd)} hoy · ${costo.llamadas} llamada(s)</span></h3>
  <div class="act">
    ${actividad || `<p class="nota">Todavía no hay actividad registrada.</p>`}
  </div>
</section>`,
  };
}
