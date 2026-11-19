import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { desc, eq } from "drizzle-orm";
import { openDatabase } from "../infra/db/client.ts";
import { meeting, topic } from "../infra/db/schema.ts";
import { createTopicRepo } from "../infra/db/topic-repo.ts";
import { esc, pagina, type Pagina } from "./render.ts";
import { cambiarEstado, asignarOwner } from "../app/triage.ts";

const { db } = openDatabase(process.env.DATABASE_PATH ?? "./data/my_erp.db");
migrate(db, { migrationsFolder: "./drizzle" });

const PUBLICO = join(import.meta.dirname, "public");
const MIME: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

/* ---------- vistas ---------- */

function bandeja(): Pagina {
  const filas = createTopicRepo(db).bandeja();
  const total = filas.length;

  const cuerpo =
    total === 0
      ? `<div class="vacio"><h2>No hay temas por calificar</h2><p>La bandeja está limpia. Todo el alcance de las reuniones ya fue decidido.</p></div>`
      : filas
          .map((f) => {
            const cita = f.scopeReason ?? "";
            const score = f.verifyScore;
            const claseScore = score != null && score < 0.6 ? "bajo" : "";
            const aviso = f.needsReview
              ? `<div class="aviso">⚠ Jev duda de que esto se haya hablado en la reunión</div>`
              : "";

            return `<article class="fila" data-id="${f.id}">
  <div class="titulos">
    <div>
      <span class="etiqueta ${f.scopeSignal === "likely_scope" ? "alcance" : "idea"}">${f.scopeSignal === "likely_scope" ? "alcance" : "idea"}</span><span class="etiqueta ${f.owner === "opencode" ? "codigo" : f.owner === "me" ? "mio" : ""}">${f.owner === "opencode" ? "código" : f.owner === "me" ? "mío" : "sin dueño"}</span>
    </div>
    <h3>${esc(f.title)}</h3>
    ${f.description ? `<p class="cita">${esc(f.description)}</p>` : ""}
    ${aviso}
  </div>
  <div class="fila-acciones">
    <span class="score ${claseScore}">jev ${score != null ? score.toFixed(2) : "—"}</span>
    <button class="tecla" data-accion="selected">E</button>
    <button class="tecla" data-accion="parked">P</button>
    <button class="tecla" data-accion="discarded">D</button>
    <button class="tecla" data-accion="opencode">C</button>
    <button class="tecla" data-accion="me">M</button>
  </div>
</article>`;
          })
          .join("\n");

  return {
    titulo: "Bandeja",
    seccion: "bandeja",
    conteoBandeja: total,
    cuerpo:
      (total === 0
        ? ""
        : `<div style="margin-bottom:10px;color:var(--olive);font-size:12px">Elegí con el teclado: <b>E</b> selecciona · <b>P</b> aparca · <b>D</b> descarta · <b>C</b> código · <b>M</b> mío — <b>↑↓</b> navegan</div>`) +
      cuerpo,
  };
}

function rubrica(): Pagina {
  return {
    titulo: "Rúbrica",
    seccion: "rubrica",
    cuerpo: `<div class="vacio"><h2>Vista por construir</h2><p>Los ítems de la rúbrica llegan en la Fase 2.</p></div>`,
  };
}

function temas(): Pagina {
  const filas = db.select().from(topic).orderBy(desc(topic.createdAt)).all();
  const mapa = new Map<string, typeof filas>();

  for (const f of filas) {
    const lista = mapa.get(f.status) ?? [];
    lista.push(f);
    mapa.set(f.status, lista);
  }

  const orden = ["proposed", "selected", "parked", "discarded"] as const;
  const nombre: Record<string, string> = { proposed: "Sin calificar", selected: "Seleccionados", parked: "Archivo de ideas", discarded: "Descartados" };

  const cuerpo = orden
    .map((s) => {
      const lista = mapa.get(s) ?? [];
      if (lista.length === 0) return "";
      return `<div class="grupo-fecha">${nombre[s]} (${lista.length})</div>` + lista.map((f) => `<article class="fila"><div class="titulos"><h3>${esc(f.title)}</h3></div><div class="fila-acciones"><span class="score">${f.owner ?? "—"}</span></div></article>`).join("\n");
    })
    .join("\n");

  return { titulo: "Temas", seccion: "temas", cuerpo };
}

function repos(): Pagina {
  return {
    titulo: "Repos",
    seccion: "repos",
    cuerpo: `<div class="vacio"><h2>Vista por construir</h2><p>Llega en la Fase 4.</p></div>`,
  };
}

function trazas(): Pagina {
  return {
    titulo: "Trazas",
    seccion: "trazas",
    cuerpo: `<div class="vacio"><h2>Vista por construir</h2><p>Llega en la Fase 4.</p></div>`,
  };
}

/* ---------- acciones ---------- */

function responder(res: ServerResponse, codigo: number, cuerpo: string | Buffer, tipo = "text/html; charset=utf-8") {
  res.writeHead(codigo, { "content-type": tipo });
  res.end(cuerpo);
}

async function accion(req: IncomingMessage, res: ServerResponse, id: string, accion2: string) {
  try {
    const mapa: Record<string, "selected" | "parked" | "discarded"> = {
      selected: "selected",
      parked: "parked",
      discarded: "discarded",
    };

    if (mapa[accion2]) {
      const r = cambiarEstado({ db }, id, mapa[accion2] as "selected");
      responder(res, 200, JSON.stringify({ ok: true, estado: r.hacia }), "application/json");
    } else if (accion2 === "opencode" || accion2 === "me") {
      const r = asignarOwner({ db }, id, accion2 === "opencode" ? "opencode" : "me");
      responder(res, 200, JSON.stringify({ ok: true, owner: r.owner }), "application/json");
    } else {
      responder(res, 400, "acción desconocida");
    }
  } catch (e) {
    responder(res, 400, e instanceof Error ? e.message : String(e));
  }
}

/* ---------- servidor ---------- */

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${process.env.WEB_PORT ?? 4599}`);
  const ruta = url.pathname;

  // estáticos
  if (ruta.startsWith("/app.css") || ruta.startsWith("/app.js") || ruta.startsWith("/logo-mark.png")) {
    const archivo = join(PUBLICO, ruta.slice(1));
    if (existsSync(archivo)) {
      responder(res, 200, readFileSync(archivo), MIME[extname(archivo)] ?? "application/octet-stream");
      return;
    }
  }

  // acciones de triaje
  const m = ruta.match(/^\/accion\/([a-f0-9-]+)\/(\w+)$/);
  if (m?.[1] && m[2]) {
    await accion(req, res, m[1], m[2]);
    return;
  }

  // páginas
  if (ruta === "/" ) return responder(res, 200, pagina(bandeja()));
  if (ruta === "/rubrica") return responder(res, 200, pagina(rubrica()));
  if (ruta === "/temas") return responder(res, 200, pagina(temas()));
  if (ruta === "/repos") return responder(res, 200, pagina(repos()));
  if (ruta === "/trazas") return responder(res, 200, pagina(trazas()));

  responder(res, 404, "no encontrado");
});

const PORT = Number(process.env.WEB_PORT ?? 4599);
servidor.listen(PORT, "127.0.0.1", () => {
  console.log(`my_erp web · http://127.0.0.1:${PORT}`);
});
