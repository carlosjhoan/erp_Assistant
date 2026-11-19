import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { desc, eq } from "drizzle-orm";
import { openDatabase } from "../infra/db/client.ts";
import { repo as repoTable, rubric, rubricItem, topic } from "../infra/db/schema.ts";
import { createTopicRepo } from "../infra/db/topic-repo.ts";
import { esc, pagina, type Pagina } from "./render.ts";
import { asignarOwner, cambiarEstado, deshacerDecision, quitarOwner } from "../app/triage.ts";
import { aprobarRubrica, crearRubricaWeb, temasDeRubrica } from "../app/create-rubric.ts";

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
    <h3>${esc(f.title)}</h3>
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
  <div class="titulos"><h3>${esc(f.title)}</h3></div>
  <div class="controles"><span class="dueno ${f.owner === "opencode" ? "codigo" : "mio"}">${f.owner === "opencode" ? "código" : f.owner === "me" ? "mío" : "—"}</span></div>
</article>`
        )
        .join("\n");

      return `<div class="grupo-fecha">${nombre[s]} (${lista.length})</div>${items}`;
    })
    .join("\n");

  return { titulo: "Temas", seccion: "temas", conteoBandeja: createTopicRepo(db).bandeja().length, cuerpo };
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

function accionTema(res: ServerResponse, id: string, campo: string, valor: string) {
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

const servidor = createServer((req: IncomingMessage, res: ServerResponse) => {
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

  const rub = ruta.match(/^\/rubrica\/(\w+)(?:\/([a-f0-9-]+))?$/);
  if (rub?.[1]) {
    accionRubrica(res, rub[1], rub[2] ?? "");
    return;
  }

  if (ruta === "/") return responder(res, 200, pagina(bandeja()));
  if (ruta === "/temas") return responder(res, 200, pagina(vistaTemas()));
  if (ruta === "/rubrica") return responder(res, 200, pagina(vistaRubrica()));
  if (ruta === "/repos") return responder(res, 200, pagina(marcador("Repos", "repos", "Fase 4")));
  if (ruta === "/trazas") return responder(res, 200, pagina(marcador("Trazas", "trazas", "Fase 4")));

  responder(res, 404, "no encontrado");
});

const PORT = Number(process.env.WEB_PORT ?? 4599);
servidor.listen(PORT, "127.0.0.1", () => console.log(`my_erp web · http://127.0.0.1:${PORT}`));
