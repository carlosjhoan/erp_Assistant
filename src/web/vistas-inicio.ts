/** Asistente: el chat al centro y el estado del portafolio al costado. */

import type { Db } from "../infra/db/client.ts";
import { llmCall, meeting, projectCapability, rubricItem, topic } from "../infra/db/schema.ts";
import { capacidadesEfectivas, progresoPorProyecto, rango, semanas, veredicto } from "../app/progreso.ts";
import { esc, type Pagina } from "./render.ts";

const CHECK = `<svg class="feed-check" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M3.4 8.4l3 3 6.2-6.6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CIRCULO = `<span class="feed-circulo"></span>`;

/**
 * Barra de dos tramos: el diagnostico en su color y el avance de la semana
 * en azul claro, igual que los aros del dashboard.
 */
function barraDoble(desde: number | undefined, hasta: number | undefined, color: string): string {
  const base = Math.max(0, Math.min(100, desde ?? 0));
  const fin = Math.max(base, Math.min(100, hasta ?? base));
  const avance = fin - base;
  return `<div class="prog doble ${color}">
    <span class="t-base" style="width:${base}%"></span>
    <span class="t-avance" style="left:${base}%; width:${avance}%"></span>
  </div>`;
}

const TASA = Number(process.env.USD_COP ?? 4000);

/** Consumo de hoy por tecnología, para el panel de costo. */
function consumo(db: Db) {
  const hoy = new Date().toDateString();
  const filas = db.select().from(llmCall).all().filter((c) => new Date(c.createdAt).toDateString() === hoy);

  const porTecnologia = new Map<string, { llamadas: number; usd: number; tokens: number; modelo: string }>();
  for (const c of filas) {
    const k = c.provider;
    const acc = porTecnologia.get(k) ?? { llamadas: 0, usd: 0, tokens: 0, modelo: c.model ?? k };
    acc.llamadas += 1;
    acc.usd += c.costUsd ?? 0;
    acc.tokens += c.inputTokens ?? 0;
    porTecnologia.set(k, acc);
  }

  return {
    llamadas: filas.length,
    usd: filas.reduce((a, c) => a + (c.costUsd ?? 0), 0),
    tecnologias: [...porTecnologia.entries()].sort((a, b) => b[1].usd - a[1].usd),
  };
}

const dinero = (usd: number, moneda: "usd" | "cop") =>
  moneda === "usd" ? `${usd.toFixed(4)}` : `${Math.round(usd * TASA).toLocaleString("es-CO")}`;

const ICONO_TEC: Record<string, string> = {
  deepseek: '<img src="/deepseek.svg" alt="DeepSeek" class="tec-logo">',
  jev: '<img src="/typesafe.png" alt="Jev" class="tec-logo">',
};

const NOMBRE_TEC: Record<string, string> = { deepseek: "DeepSeek", jev: "Jev · TypeSafe" };

export function vistaInicio(db: Db): Pagina {
  const ss = semanas(db);
  const actual = ss[0];

  const proyectos = progresoPorProyecto(db);
  const reuniones = db.select().from(meeting).all();
  const temas = db.select().from(topic).all();
  const temasDe = (id: string) => temas.filter((t) => t.meetingId === id).length;

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
          <svg class="pm-ring" viewBox="0 0 32 32" width="44" height="44" aria-hidden="true">
            <circle class="pm-bg" cx="16" cy="16" r="13" />
            <circle class="pm-fg ${color}" cx="16" cy="16" r="13" stroke-dasharray="0 81.7" />
            <circle class="pm-avance" cx="16" cy="16" r="13" stroke-dasharray="0 81.7" />
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
  <div class="pcard-barras">
    <div class="bf"><span>negocio</span>${barraDoble(desde?.negocio, hasta?.negocio, "verde")}<b>${p.diagnostico ? (hasta?.negocio ?? 0) + "%" : "—"}</b></div>
    <div class="bf"><span>técnico</span>${barraDoble(desde?.produccion, hasta?.produccion, "tinta")}<b>${p.diagnostico ? (hasta?.produccion ?? 0) + "%" : "—"}</b></div>
  </div>
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

  // El avance se reparte entre los items del proyecto: rampa continua
  // que arranca en el diagnostico y termina exactamente en el cierre.
  const totalPorProyecto = new Map<string, number>();
  for (const it of itemsOrdenados) {
    if (!it.projectId) continue;
    totalPorProyecto.set(it.projectId, (totalPorProyecto.get(it.projectId) ?? 0) + 1);
  }

  const vistos = new Map<string, number>();
  const acumulado = new Map<string, { negocio: number; produccion: number }>();

  for (const it of itemsOrdenados) {
    if (!it.projectId) continue;
    const total = totalPorProyecto.get(it.projectId) ?? 1;
    const n = (vistos.get(it.projectId) ?? 0) + 1;
    vistos.set(it.projectId, n);

    const b = base.get(it.projectId);
    const f = cierre.get(it.projectId);
    // Sin diagnostico no hay rampa: el proyecto no tiene linea base.
    if (!b || !f || b.base === 0) continue;

    const t = n / total;
    acumulado.set(it.id, {
      negocio: Math.round(b.negocio + (f.negocio - b.negocio) * t),
      produccion: Math.round(b.produccion + (f.produccion - b.produccion) * t),
    });
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

  const uso = consumo(db);

  // El head muestra el costo de la sesion y abre el desglose.
  const accion = `<button type="button" class="uso" id="uso" aria-haspopup="dialog">
    <span class="uso-n">sesión ${uso.llamadas} · <b data-moneda="usd" data-usd="${uso.usd}">${dinero(uso.usd, "usd")}</b></span>
  </button>`;

  const modalUso = `<dialog id="modal-uso" class="modal modal-uso">
  <header><h2>Costo de la sesión</h2><button class="cerrar" data-cerrar-modal="modal-uso" aria-label="Cerrar">✕</button></header>
  <div class="uso-total">
    <span>Total hoy</span>
    <b id="uso-total" data-usd="${uso.usd}">${dinero(uso.usd, "usd")}</b>
  </div>
  <div class="uso-moneda">
    <button type="button" class="moneda activa" data-moneda-sel="usd">USD</button>
    <button type="button" class="moneda" data-moneda-sel="cop">COP</button>
  </div>
  <p class="uso-sub">Desglose por tecnología</p>
  <div class="uso-tecs">
    ${uso.tecnologias
      .map(
        ([k, v]) => `<div class="tec">
      <span class="tec-ico">${ICONO_TEC[k] ?? ""}</span>
      <span class="tec-n">${NOMBRE_TEC[k] ?? k}<i>${v.modelo}</i></span>
      <span class="tec-c">${v.llamadas} llamada(s) · ${(v.tokens / 1000).toFixed(1)}k tok</span>
      <b class="tec-usd" data-usd="${v.usd}">${dinero(v.usd, "usd")}</b>
    </div>`,
      )
      .join("")}
  </div>
</dialog>`;

  return {
    titulo: "Asistente",
    seccion: "inicio",
    conteoBandeja: 0,
    accion,
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

  <div class="autor" aria-label="Steel and Glass — Carlos">
    <img class="marca" src="/logo-mark.png" alt="Steel and Glass">
    <img class="perfil" src="/profile.jpg" alt="Carlos" width="64" height="64">
  </div>

  <h1 class="entrada" id="entrada">
    <span id="maquina" aria-label="Así van las cosas con Carlos ..."></span><i class="caret" aria-hidden="true"></i>
  </h1>

  <aside class="panel">
    <header class="rail-cabeza">
      <img class="rail-logo" src="/logo-mark.png" alt="Steel and Glass">
      <img class="rail-perfil" src="/profile.jpg" alt="Carlos" width="38" height="38">
    </header>

    <div class="panel-bloque">
      <h3 class="bloque-t">Proyectos<span class="bloque-fecha">${proyectos.length}</span></h3>
      <div class="pproy-lista">${filasProyecto}</div>
    </div>

    <div class="panel-bloque">
      <h3 class="bloque-t">En la semana<span class="bloque-fecha">${actual ? rango(actual.desde, actual.hasta) : "sin abrir"}</span></h3>
      ${
        actual
          ? `<div class="semana-h">
        <div class="sh-fila">
          <span class="sh-rango">${rango(actual.desde, actual.hasta)}</span>
          <b class="sh-pct">${actual.pct}%</b>
        </div>
        <div class="prog verde"><span style="width:${actual.pct}%"></span></div>
        <span class="sh-n">${actual.hechos} de ${actual.total} ítems</span>
      </div>
      <div class="feed-prog">
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
              `<a class="reunion-card" href="/reunion/${m.id}">
          <span class="reunion-cabeza">
            <span class="reunion-f">${new Date(m.occurredAt).toLocaleDateString("es-CO", { day: "2-digit", month: "short" })}</span>
            <span class="reunion-a">${new Date(m.occurredAt).getFullYear()}</span>
          </span>
          <span class="reunion-fuente">
            <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path d="M3.5 2.5h6l3 3v8h-9z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M5.5 7h5M5.5 9.5h3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
            1 nota de Granola
          </span>
          <span class="reunion-temas"><i></i>${temasDe(m.id)} temas detectados</span>
        </a>`,
          )
          .join("")}
      </div>
    </div>
  </aside>
  ${modalUso}
</div>`,
  };
}
