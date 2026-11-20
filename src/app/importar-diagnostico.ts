/**
 * Importa un diagnóstico del prototipo y lo deja en `project_capability`.
 *
 * El JSON es la fuente de verdad: si un nodo desaparece del archivo, se borra
 * de la base. Volver a importar reemplaza, no acumula.
 *
 * Uso: npm run diag:importar -- "<ruta.json>" "<nombre del proyecto>"
 */

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { openDatabase } from "../infra/db/client.ts";
import { project, projectCapability } from "../infra/db/schema.ts";

/** implemented → integración. I1 (solo en rama) no viene en el JSON. */
const INTEGRACION: Record<string, "I3" | "I2" | "I0"> = { TRUE: "I3", PARTIAL: "I2", FALSE: "I0" };

/** reliability 2 se mapea a F2, no a F3, para no inflar la cobertura. */
const FUNCIONAMIENTO: Record<string, "F2" | "F1" | "F0"> = { "2": "F2", "1": "F1", "0": "F0" };

const CALIDAD: Record<string, "Q3" | "Q2" | "Q1"> = { solid: "Q3", works_not_best: "Q2", needs_work: "Q1" };

/**
 * Capacidades que el diagnóstico incluye pero que no se le pidieron al
 * proyecto. Vienen del prototipo, no del JSON, porque el JSON no las marca.
 */
const FUERA_DE_RUBRICA: Record<string, string[]> = {
  landing: ["L12", "L13"],
};

interface Nodo {
  id: string;
  title?: string;
  nombre?: string;
  summary?: string;
  stage?: string;
  order?: number;
  alcance?: string;
  futuro?: boolean;
  implemented?: string;
  reliability?: number;
  quality?: string;
  good?: string[];
  improve?: string[];
  evidence?: string[];
  affected?: string[];
}

function main() {
  const [archivo, nombreProyecto] = process.argv.slice(2);
  if (!archivo || !nombreProyecto) {
    console.error('Uso: npm run diag:importar -- "<ruta.json>" "<nombre del proyecto>"');
    process.exit(1);
  }

  const raw = JSON.parse(readFileSync(archivo, "utf8")) as { nodes?: Nodo[]; meta?: { title?: string } };
  const nodos = raw.nodes ?? [];
  if (nodos.length === 0) {
    console.error("El archivo no tiene nodos.");
    process.exit(1);
  }

  const { db, sqlite } = openDatabase();
  const p = db.select().from(project).all().find((x) => x.name.toLowerCase() === nombreProyecto.toLowerCase());

  if (!p) {
    console.error(`No existe el proyecto "${nombreProyecto}".`);
    const nombres = db.select().from(project).all().map((x) => x.name);
    console.error(`Disponibles: ${nombres.join(", ")}`);
    process.exit(1);
  }

  const fuera = new Set(FUERA_DE_RUBRICA[nombreProyecto.toLowerCase()] ?? []);
  const ahora = new Date();

  db.transaction(() => {
    const previos = db.select().from(projectCapability).where(eq(projectCapability.projectId, p.id)).all();
    const porClave = new Map(previos.map((c) => [c.key, c]));

    for (const n of nodos) {
      const alcance = n.alcance ?? (n.futuro ? "Futuro" : "Actual");
      const valor = {
        projectId: p.id,
        key: n.id,
        title: n.title ?? n.nombre ?? n.id,
        summary: n.summary ?? null,
        stage: n.stage ?? null,
        sortOrder: n.order ?? 0,
        scope: alcance.toLowerCase() === "futuro" ? ("futuro" as const) : ("actual" as const),
        integration: INTEGRACION[n.implemented ?? ""] ?? ("I0" as const),
        reliability: FUNCIONAMIENTO[String(n.reliability ?? "")] ?? ("F0" as const),
        quality: CALIDAD[n.quality ?? ""] ?? null,
        outsideRubric: fuera.has(n.id),
        good: n.good ?? [],
        improve: n.improve ?? [],
        evidence: n.evidence ?? [],
        affected: n.affected ?? [],
        importedAt: ahora,
      };

      const previo = porClave.get(n.id);
      if (previo) {
        db.update(projectCapability).set(valor).where(eq(projectCapability.id, previo.id)).run();
        porClave.delete(n.id);
      } else {
        db.insert(projectCapability).values({ id: randomUUID(), ...valor }).run();
      }
    }

    // Lo que ya no está en el archivo deja de existir.
    for (const sobrante of porClave.values()) {
      db.delete(projectCapability).where(eq(projectCapability.id, sobrante.id)).run();
    }
  });

  const importados = db.select().from(projectCapability).where(eq(projectCapability.projectId, p.id)).all();
  console.log(`${raw.meta?.title ?? archivo}`);
  console.log(`${importados.length} capacidades en "${p.name}" (${importados.filter((c) => c.scope === "actual").length} actuales)`);
  sqlite.close();
}

main();
