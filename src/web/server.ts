import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { openDatabase } from "../infra/db/client.ts";
import { repo as repoTable, rubric, rubricItem, topic } from "../infra/db/schema.ts";
import { createTopicRepo } from "../infra/db/topic-repo.ts";
import { esc, pagina, type Pagina } from "./render.ts";
import { asignarOwner, cambiarEstado, deshacerDecision, quitarOwner, guardarContexto } from "../app/triage.ts";
import { aprobarRubrica, crearRubricaWeb, temasDeRubrica } from "../app/create-rubric.ts";
import { detectarRepos } from "../app/detect-repos.ts";
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

function opciones(lista: readonly { valor: string; texto: string }[], actual: string | null | undefined): string {
  return lista
    .map((o) => `<option value="${o.valor}"${(actual ?? "") === o.valor ? " selected" : ""}>${o.texto}</option>`)
    .join("");
}

/* ---------- bandeja ---------- */

function bandeja(): Pagina {
  const filas = createTopicRepo(db).bandeja();
  const total = filas.length;

  if (total === 0) {
    return {
      titulo: "Bandeja",
      seccion: "bandeja",
      conteoBandeja: 0,
      cuerpo: `<div class="vacio"><h2>No hay temas por calificar</h2><p>La bandeja está limpia. Todo el alcance de las reuniones ya fue decidido.</p></div>`,
    };
  }

  const cuerpo = filas
    .map((f) => {
      const score = f.verifyScore;
      const claseScore = score != null && score < 0.6 ? "bajo" : "";
      const aviso = f.needsReview ? `<div class="aviso">⚠ Jev duda de que esto se haya hablado</div>` : "";

      return `<article class="fila" data-id="${f.id}">
  <div class="titulos">
    <div class="etiquetas">
      <span class="etiqueta ${f.scopeSignal === "likely_scope" ? "alcance" : "idea"}">${f.scopeSignal === "likely_scope" ? "alcance" : "idea"}</span>
      <span class="score ${claseScore}">jev ${score != null ? score.toFixed(2) : "—"}</span>
    </div>
    <h3><a class="enlace-tema" href="/tema/${f.id}">${esc(f.title)}</a></h3>
    ${f.description ? `<p class="cita">${esc(f.description)}</p>` : ""}
    ${aviso}
  </div>
  <div class="controles">
    <label>Decisión
      <select data-campo="estado">${opciones(ESTADOS, "proposed")}</select>
    </label>
    <label>Dueño
      <select data-campo="owner">${opciones(DUENOS, f.owner ?? "")}</select>
    </label>
  </div>
</article>`;
    })
    .join("\n");

  return { titulo: "Bandeja", seccion: "bandeja", conteoBandeja: total, cuerpo };
}

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

    json(res, 400, { error: "campo desconocido" });
  } catch (e) {
    json(res, 400, { error: e instanceof Error ? e.message : String(e) });
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

  const tema = ruta.match(/^\/accion\/([a-f0-9-]+)\/(\w+)\/(\w*)$/);
  if (tema?.[1] && tema[2]) {
    accionTema(res, tema[1], tema[2], tema[3] ?? "");
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

  if (ruta === "/") return responder(res, 200, pagina(bandeja()));
  if (ruta === "/temas") return responder(res, 200, pagina(vistaTemas()));
  if (ruta === "/rubrica") return responder(res, 200, pagina(vistaRubrica()));
  if (ruta === "/repos") return responder(res, 200, pagina(marcador("Repos", "repos", "Fase 4")));
  if (ruta === "/trazas") return responder(res, 200, pagina(marcador("Trazas", "trazas", "Fase 4")));

  responder(res, 404, "no encontrado");
});

const PORT = Number(process.env.WEB_PORT ?? 4599);
servidor.listen(PORT, "127.0.0.1", () => console.log(`my_erp web · http://127.0.0.1:${PORT}`));
