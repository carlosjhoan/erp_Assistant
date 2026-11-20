/**
 * Importa una semana del cronograma HTML al ERP.
 *
 * Lee el `<dialog id="wN">` que tiene el desglose técnico: decisiones, tareas
 * por frente con su criterio de terminado, deuda y criterios de salida. El
 * estado sale de `avance.js`, que el propio HTML exporta.
 *
 * Es aditivo: si un ítem con la misma clave ya existe, no lo pisa. Lo que
 * edites en el ERP sobrevive a la reimportación.
 *
 * Uso: npm run plan:importar -- "<cronograma.html>" w1 "<proyecto>"
 */

import { readFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { and, eq } from "drizzle-orm";
import { openDatabase } from "../infra/db/client.ts";
import { project, rubric, rubricItem } from "../infra/db/schema.ts";

const MESES: Record<string, string> = {
  enero: "01", febrero: "02", marzo: "03", abril: "04", mayo: "05", junio: "06",
  julio: "07", agosto: "08", septiembre: "09", setiembre: "09", octubre: "10",
  noviembre: "11", diciembre: "12",
};

const limpiar = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/** "17 al 20 de noviembre" → [2026-11-17, 2026-11-20] */
function rangoDe(texto: string, anio: number): [string, string] | null {
  // Formatos vistos: "17–20 de noviembre", "17 al 20 de noviembre", "27 de noviembre al 4 de diciembre".
  const m =
    texto.match(/(\d{1,2})\s*(?:al|[–-])\s*(\d{1,2})\s+de\s+([a-záéíóú]+)/i) ??
    texto.match(/(\d{1,2})\s+de\s+([a-záéíóú]+)\s+(?:al|[–-])\s+(\d{1,2})/i);
  if (!m) return null;
  const mes = MESES[(m[3] ?? "").toLowerCase()] ?? "11";
  const d1 = String(m[1]).padStart(2, "0");
  const d2 = String(m[2]).padStart(2, "0");
  return [`${anio}-${mes}-${d1}`, `${anio}-${mes}-${d2}`];
}

interface Item {
  key: string;
  kind: "decision" | "task" | "debt" | "exit";
  title: string;
  criterio: string;
  tipo: "code" | "contact" | "research" | "other";
}

function parsear(html: string, semana: string): { titulo: string; desde: string; hasta: string; items: Item[] } {
  const ini = html.indexOf(`<dialog class="modal" id="${semana}"`);
  if (ini < 0) throw new Error(`No encontré el bloque técnico de ${semana}.`);
  const fin = html.indexOf("</dialog>", ini);
  const w = html.slice(ini, fin);

  const titulo = limpiar((w.match(/<h3[^>]*>([\s\S]*?)<\/h3>/) ?? [])[1] ?? semana).replace(/^Semana\s*\d+\s*·\s*/, "");
  const fechas = limpiar((w.match(/<div class="modal-head">[\s\S]*?<p>([\s\S]*?)<\/p>/) ?? [])[1] ?? "");
  const anio = Number((html.match(/al\s+\d{1,2}\s+de\s+\w+\s+de\s+(\d{4})/) ?? [])[1] ?? new Date().getFullYear());
  const rango = rangoDe(fechas, anio);
  if (!rango) throw new Error(`No pude leer las fechas de ${semana}: "${fechas}"`);
  const [desde, hasta] = rango;

  const items: Item[] = [];

  // Tareas: filas de tabla con ID, título y "Terminado cuando".
  const filas = [...w.matchAll(/data-key="([^"]+)" data-kind="task"[\s\S]*?<td class="id">([\s\S]*?)<\/td><td>([\s\S]*?)<\/td><td>([\s\S]*?)<\/td><td>([\s\S]*?)<\/td>/g)];
  for (const f of filas) {
    items.push({
      key: f[1]!,
      kind: "task",
      title: limpiar(f[3]!),
      criterio: limpiar(f[5]!) || "Terminado y verificado.",
      tipo: "code",
    });
  }

  // Decisiones y criterios de salida: checkbox con el texto en el span.
  const conTexto = [...w.matchAll(/data-key="([^"]+)" data-kind="(decision|exit)"[\s\S]{0,60}?<span>([\s\S]*?)<\/span>/g)];
  for (const c of conTexto) {
    items.push({
      key: c[1]!,
      kind: c[2] as "decision" | "exit",
      title: limpiar(c[3]!),
      criterio: c[2] === "decision" ? "Decisión tomada y documentada." : "Criterio de salida cumplido.",
      tipo: "other",
    });
  }

  // Deuda: chips que solo traen la clave.
  const deuda = [...w.matchAll(/data-key="([^"]+)" data-kind="debt"/g)];
  for (const d of deuda) {
    items.push({
      key: d[1]!,
      kind: "debt",
      title: `Deuda ${d[1]}`,
      criterio: `Deuda técnica ${d[1]} cerrada. Detalle en BACKLOG_ENDURECIMIENTO.md`,
      tipo: "code",
    });
  }

  return { titulo, desde, hasta, items };
}

function leerAvance(html: string, htmlPath: string): Set<string> {
  const ruta = join(dirname(htmlPath), "avance.js");
  if (!existsSync(ruta)) return new Set();

  const txt = readFileSync(ruta, "utf8");
  const cuerpo = txt.slice(txt.indexOf("PLAN_PROGRESS"), txt.lastIndexOf("}"));
  const claves = [...cuerpo.matchAll(/"([^"]+)"\s*:\s*true/g)].map((m) => m[1]!);
  return new Set(claves);
}

function main() {
  const [archivo, semana, nombreProyecto] = process.argv.slice(2);
  if (!archivo || !semana || !nombreProyecto) {
    console.error('Uso: npm run plan:importar -- "<cronograma.html>" w1 "<proyecto>"');
    process.exit(1);
  }

  const html = readFileSync(archivo, "utf8");
  const datos = parsear(html, semana);
  const hechos = leerAvance(html, archivo);

  const { db, sqlite } = openDatabase();
  const p = db.select().from(project).all().find((x) => x.name.toLowerCase() === nombreProyecto.toLowerCase());
  if (!p) {
    console.error(`No existe el proyecto "${nombreProyecto}".`);
    process.exit(1);
  }

  let rubricId = "";

  db.transaction(() => {
    const existente = db.select().from(rubric).all().find((r) => r.weekStart === datos.desde);
    if (existente) {
      rubricId = existente.id;
      db.update(rubric).set({ deadline: datos.hasta }).where(eq(rubric.id, existente.id)).run();
    } else {
      rubricId = randomUUID();
      db.insert(rubric)
        .values({ id: rubricId, weekStart: datos.desde, deadline: datos.hasta, version: 1, status: "approved", approvedAt: new Date(), approvedBy: "plan" })
        .run();
    }

    let nuevos = 0;
    let saltados = 0;
    let hechosNuevos = 0;

    datos.items.forEach((it, i) => {
      const ya = db
        .select()
        .from(rubricItem)
        .where(and(eq(rubricItem.rubricId, rubricId), eq(rubricItem.externalKey, it.key)))
        .all()[0];

      if (ya) {
        // Ya existe: solo se completa el estado si el plan lo da por hecho.
        if (hechos.has(it.key) && ya.status !== "done") {
          db.update(rubricItem).set({ status: "done" }).where(eq(rubricItem.id, ya.id)).run();
          hechosNuevos++;
        }
        saltados++;
        return;
      }

      db.insert(rubricItem)
        .values({
          id: randomUUID(),
          rubricId,
          projectId: p.id,
          externalKey: it.key,
          title: it.title,
          acceptanceCriteria: it.criterio,
          type: it.tipo,
          status: hechos.has(it.key) ? "done" : "pending",
          origin: "markdown",
          humanEdited: false,
          position: i,
        })
        .run();
      if (hechos.has(it.key)) hechosNuevos++;
      nuevos++;
    });

    console.log(`Semana: ${datos.titulo} · ${datos.desde} → ${datos.hasta}`);
    console.log(`Items: ${datos.items.length} — ${nuevos} nuevos, ${saltados} ya existian, ${hechosNuevos} con estado hecho`);
  });

  sqlite.close();
}

main();
