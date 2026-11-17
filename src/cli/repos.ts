/**
 * Registro de repos.
 *
 *   npm run repos                        lista proyectos y repos
 *   npm run repos -- check               verifica que las rutas existan
 *   npm run repos -- edit <id|prefijo> --description "..." --keywords "a,b"
 *   npm run repos -- seed                vuelve a leer docs/repos.md
 */
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { existsSync } from "node:fs";
import { desc, eq } from "drizzle-orm";
import { openDatabase } from "../infra/db/client.ts";
import { project, repo } from "../infra/db/schema.ts";
import { leerSeed, sembrar } from "../../scripts/seed-repos.ts";

const { db } = openDatabase(process.env.DATABASE_PATH ?? "./data/my_erp.db");
migrate(db, { migrationsFolder: "./drizzle" });

const args = process.argv.slice(2);
const accion = args[0] ?? "list";
const valor = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};

function corto(id: string) {
  return id.slice(0, 8);
}

function listar() {
  const proyectos = db.select().from(project).orderBy(project.name).all();
  if (proyectos.length === 0) {
    console.log("No hay repos registrados. Corré: npm run repos -- seed");
    return;
  }

  for (const p of proyectos) {
    const repos = db.select().from(repo).where(eq(repo.projectId, p.id)).orderBy(repo.name).all();
    console.log(`\n${p.name}  (${repos.length})`);
    for (const r of repos) {
      const existe = existsSync(r.path) ? "" : "  ⚠ ruta inexistente";
      console.log(`  [${corto(r.id)}] ${r.name}${existe}`);
      console.log(`              ${r.description ?? "(sin descripción)"}`);
      if (r.keywords.length > 0) console.log(`              claves: ${r.keywords.slice(0, 8).join(", ")}`);
    }
  }
  console.log("\nDetectar repos para un tema: npm run plan -- --topic <id>");
}

function check() {
  const filas = db.select().from(repo).all();
  let ok = 0;
  const faltan: string[] = [];
  const sinDescripcion: string[] = [];

  for (const r of filas) {
    if (existsSync(r.path)) ok++;
    else faltan.push(`${r.name}: ${r.path}`);
    if (!r.description?.trim()) sinDescripcion.push(r.name);
  }

  console.log(`${ok}/${filas.length} rutas existen`);
  if (faltan.length > 0) {
    console.log("\n⚠ No existen:");
    for (const f of faltan) console.log(`  ${f}`);
  }
  if (sinDescripcion.length > 0) {
    console.log("\n⚠ Sin descripción (la detección no puede usarlos):");
    for (const s of sinDescripcion) console.log(`  ${s}`);
  }
  if (faltan.length === 0 && sinDescripcion.length === 0) console.log("Todo en orden.");
}

function editar(prefijo: string | undefined) {
  if (!prefijo) throw new Error("Falta el id o prefijo del repo.");

  const encontrados = db.select().from(repo).all().filter((r) => r.id.startsWith(prefijo) || r.name === prefijo);
  if (encontrados.length === 0) throw new Error(`No encontré el repo "${prefijo}".`);
  if (encontrados.length > 1) throw new Error(`"${prefijo}" coincide con varios repos. Usá más caracteres.`);

  const r = encontrados[0]!;
  const cambios: Record<string, unknown> = {};

  const desc = valor("--description");
  if (desc !== undefined) cambios.description = desc;

  const kw = valor("--keywords");
  if (kw !== undefined) cambios.keywords = kw.split(",").map((k) => k.trim()).filter(Boolean);

  const path = valor("--path");
  if (path !== undefined) cambios.path = path;

  if (Object.keys(cambios).length === 0) {
    throw new Error("No indicaste qué cambiar (--description, --keywords o --path).");
  }

  db.update(repo).set(cambios).where(eq(repo.id, r.id)).run();
  console.log(`Actualizado: ${r.name}`);
}

function siguienteSesion() {
  const filas = db
    .select({ name: repo.name, sesion: repo.opencodeSessionId })
    .from(repo)
    .orderBy(desc(repo.name))
    .all();
  const conSesion = filas.filter((f) => f.sesion);
  console.log(`${conSesion.length} repo(s) con sesión de OpenCode asignada`);
  for (const f of conSesion) console.log(`  ${f.name} → ${f.sesion}`);
}

switch (accion) {
  case "list":
    listar();
    break;
  case "check":
    check();
    break;
  case "edit":
    editar(args[1]);
    break;
  case "seed": {
    const r = sembrar(db, leerSeed());
    console.log(`${r.proyectos} proyecto(s) · ${r.repos} repo(s) (${r.creados} nuevos, ${r.actualizados} actualizados)`);
    if (r.faltantes.length > 0) {
      console.log("\n⚠ Rutas que no existen:");
      for (const f of r.faltantes) console.log(`  ${f}`);
    }
    break;
  }
  case "sessions":
    siguienteSesion();
    break;
  default:
    console.log(`Acción desconocida: "${accion}". Opciones: list, check, edit, seed, sessions.`);
    process.exit(1);
}
