/**
 * Siembra el registro de proyectos y repos leyendo el bloque JSON de
 * docs/repos.md. Es idempotente: se puede correr las veces que haga falta.
 *
 *   node --import tsx scripts/seed-repos.ts
 */
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { openDatabase } from "../src/infra/db/client.ts";
import { project, repo } from "../src/infra/db/schema.ts";

interface RepoSeed {
  project: string;
  name: string;
  path: string;
  description?: string;
  keywords?: string[];
  exposes?: string[];
  consumes?: string[];
}

interface Seed {
  projects: { name: string; path: string }[];
  repos: RepoSeed[];
}

export function leerSeed(ruta = "docs/repos.md"): Seed {
  const md = readFileSync(ruta, "utf8");
  const bloque = md.match(/```json\n([\s\S]*?)\n```/);
  if (!bloque?.[1]) throw new Error(`No encontré el bloque json en ${ruta}.`);
  return JSON.parse(bloque[1]) as Seed;
}

export function sembrar(db: ReturnType<typeof openDatabase>["db"], seed: Seed) {
  const resultado = { proyectos: 0, repos: 0, creados: 0, actualizados: 0, faltantes: [] as string[] };

  db.transaction(() => {
    const idPorNombre = new Map<string, string>();

    for (const p of seed.projects) {
      const existente = db.select().from(project).where(eq(project.name, p.name)).get();
      if (existente) {
        db.update(project).set({ path: p.path }).where(eq(project.id, existente.id)).run();
        idPorNombre.set(p.name, existente.id);
        resultado.proyectos++;
        continue;
      }
      const id = randomUUID();
      db.insert(project).values({ id, name: p.name, path: p.path }).run();
      idPorNombre.set(p.name, id);
      resultado.proyectos++;
    }

    for (const r of seed.repos) {
      const projectId = idPorNombre.get(r.project);
      if (!projectId) throw new Error(`El repo ${r.name} apunta a un proyecto inexistente: ${r.project}.`);

      if (!existsSync(r.path)) resultado.faltantes.push(r.path);

      const existente = db
        .select()
        .from(repo)
        .where(eq(repo.name, r.name))
        .all()
        .find((x) => x.projectId === projectId);

      const valores = {
        projectId,
        name: r.name,
        path: r.path,
        description: r.description ?? null,
        keywords: r.keywords ?? [],
        exposes: r.exposes ?? [],
        consumes: r.consumes ?? [],
      };

      if (existente) {
        db.update(repo).set(valores).where(eq(repo.id, existente.id)).run();
        resultado.actualizados++;
      } else {
        db.insert(repo).values({ id: randomUUID(), ...valores }).run();
        resultado.creados++;
      }
      resultado.repos++;
    }
  });

  return resultado;
}

if (process.argv[1]?.endsWith("seed-repos.ts")) {
  const { db } = openDatabase(process.env.DATABASE_PATH ?? "./data/my_erp.db");
  migrate(db, { migrationsFolder: "./drizzle" });

  const r = sembrar(db, leerSeed());
  console.log(`${r.proyectos} proyecto(s) · ${r.repos} repo(s) (${r.creados} nuevos, ${r.actualizados} actualizados)`);
  if (r.faltantes.length > 0) {
    console.log("\n⚠ Rutas que no existen en disco:");
    for (const f of r.faltantes) console.log(`  ${f}`);
  }
}
