import { eq } from "drizzle-orm";
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { openDatabase } from "../src/infra/db/client.ts";
import { project, projectRepository, repo } from "../src/infra/db/schema.ts";
import { catalogo } from "../src/app/detect-repos.ts";
import { leerSeed, sembrar } from "../scripts/seed-repos.ts";

function dbNueva() {
  const { db } = openDatabase(":memory:");
  migrate(db, { migrationsFolder: "./drizzle" });
  return db;
}

const SEED = {
  projects: [{ name: "P1", path: "/tmp/p1" }],
  repos: [
    { project: "P1", name: "Front", path: "/tmp/p1/front", description: "El front", keywords: ["ui"] },
    { project: "P1", name: "Back", path: "/tmp/p1/back", description: "La api", exposes: ["api:/x"] },
  ],
};

test("siembra proyectos y repos", () => {
  const db = dbNueva();
  const r = sembrar(db, SEED);

  assert.equal(r.proyectos, 1);
  assert.equal(r.repos, 2);
  assert.equal(r.creados, 2);
  assert.equal(db.select().from(project).all().length, 1);
  assert.equal(db.select().from(repo).all().length, 2);
});

test("volver a sembrar no duplica", () => {
  const db = dbNueva();
  sembrar(db, SEED);
  const r = sembrar(db, SEED);

  assert.equal(r.creados, 0);
  assert.equal(r.actualizados, 2);
  assert.equal(db.select().from(repo).all().length, 2);
});

test("una ruta que no existe se reporta sin abortar", () => {
  const db = dbNueva();
  const r = sembrar(db, {
    projects: [{ name: "P", path: "/no/existe" }],
    repos: [{ project: "P", name: "R", path: "/no/existe/repo" }],
  });

  assert.equal(r.faltantes.length, 1);
  assert.equal(db.select().from(repo).all().length, 1);
});

test("un repo que apunta a un proyecto inexistente falla", () => {
  const db = dbNueva();
  assert.throws(
    () => sembrar(db, { projects: [], repos: [{ project: "Fantasma", name: "R", path: "/x" }] }),
    /proyecto inexistente/
  );
});

test("las claves y superficies se guardan como listas", () => {
  const db = dbNueva();
  sembrar(db, SEED);
  const back = db.select().from(repo).where(eq(repo.name, "Back")).get();
  const front = db.select().from(repo).where(eq(repo.name, "Front")).get();

  assert.deepEqual(back?.exposes, ["api:/x"]);
  assert.deepEqual(back?.keywords, []);
  assert.deepEqual(front?.keywords, ["ui"]);
});

test("el registro real tiene 3 proyectos y 8 repos, todos con descripción", () => {
  const seed = leerSeed("docs/repos.md");
  assert.equal(seed.projects.length, 3);
  assert.equal(seed.repos.length, 8);
  assert.ok(seed.repos.every((r) => r.description && r.description.length > 30), "todos con descripción");

  const db = dbNueva();
  const r = sembrar(db, seed);
  assert.equal(r.creados, 8);
  assert.deepEqual(r.faltantes, [], "todas las rutas existen en disco");
});

test("las rutas del registro existen en disco", () => {
  const seed = leerSeed("docs/repos.md");
  for (const r of seed.repos) {
    assert.ok(existsSync(r.path), `falta ${r.path}`);
  }
});

test("sembrar crea el vinculo muchos-a-muchos", () => {
  const db = dbNueva();
  sembrar(db, SEED);
  const vinculos = db.select().from(projectRepository).all();
  assert.equal(vinculos.length, 2);
  assert.equal(db.select().from(project).all().length, 1);
});

test("un repo en dos proyectos se presenta con ambos nombres", () => {
  const db = dbNueva();
  sembrar(db, {
    projects: [
      { name: "Alfa", path: "/a" },
      { name: "Beta", path: "/b" },
    ],
    repos: [{ project: "Alfa", name: "Compartido", path: "/a/compartido" }],
  });

  // Se vincula a mano al segundo proyecto.
  const repoId = db.select().from(repo).all()[0]!.id;
  const beta = db.select().from(project).all().find((p) => p.name === "Beta")!;
  db.insert(projectRepository).values({ projectId: beta.id, repoId }).run();

  const c = catalogo(db);
  assert.equal(c.length, 1);
  assert.equal(c[0]?.proyecto, "Alfa + Beta");
});
