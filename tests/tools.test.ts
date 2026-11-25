import test from "node:test";
import assert from "node:assert/strict";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { openDatabase } from "../src/infra/db/client.ts";
import {
  meeting,
  project,
  projectCapability,
  projectRepository,
  repo,
  rubric,
  rubricItem,
  topic,
  topicProject,
} from "../src/infra/db/schema.ts";
import { estadoDiagnostico } from "../src/app/tools/diagnostico.ts";
import { listarItems } from "../src/app/tools/items.ts";
import { buscarNotas, verReunion } from "../src/app/tools/notas.ts";
import { listarProyectos, verProyecto } from "../src/app/tools/proyectos.ts";
import { verSemana } from "../src/app/tools/semana.ts";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const enDias = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};

function seed() {
  const { sqlite, db } = openDatabase(":memory:");
  migrate(db, { migrationsFolder: "./drizzle" });

  db.insert(project)
    .values({ id: "p1", name: "Landing", description: "Activación de la landing", path: "/landing", status: "active" })
    .run();
  db.insert(project)
    .values({ id: "p2", name: "Comercial", path: "/comercial", status: "active" })
    .run();

  db.insert(repo).values({ id: "r1", projectId: "p1", name: "landing-web", path: "/landing/web" }).run();
  db.insert(projectRepository).values({ projectId: "p1", repoId: "r1" }).run();

  db.insert(projectCapability)
    .values({
      id: "c1",
      projectId: "p1",
      key: "G01",
      title: "Pricing",
      integration: "I2",
      reliability: "F1",
      quality: "Q2",
      importedAt: new Date(),
    })
    .run();

  db.insert(meeting)
    .values({
      id: "m1",
      source: "granola",
      externalId: "g1",
      title: "Landing page activation plan",
      occurredAt: new Date(),
      participants: ["Persona_#%&", "Persona_%&#"],
      contentHash: "h1",
      summary: "Persona_#%& pidió que el deadline quede antes del 15 de diciembre.",
      privateNotes: "Acordamos revisar pricing el jueves.",
      transcript: "texto basura que no debe aparecer",
    })
    .run();

  db.insert(topic)
    .values({
      id: "t1",
      meetingId: "m1",
      position: 0,
      title: "Pricing",
      description: "Definir el precio antes del cierre.",
      sourceExcerpt: "deadline antes del 15 de diciembre",
      openQuestions: ["¿Quién firma?"],
      origin: "manual",
      status: "selected",
      projectId: "p1",
    })
    .run();
  db.insert(topic)
    .values({ id: "t2", meetingId: "m1", position: 1, title: "Pricing del jueves", origin: "manual" })
    .run();
  db.insert(topicProject).values({ topicId: "t1", projectId: "p1" }).run();

  db.insert(rubric)
    .values({ id: "w1", weekStart: enDias(-1), deadline: enDias(5), status: "draft" })
    .run();
  db.insert(rubric)
    .values({ id: "w2", weekStart: enDias(8), deadline: enDias(14), status: "draft" })
    .run();

  const item = (
    id: string,
    rubricId: string,
    title: string,
    status: "done" | "pending",
    type: "code" | "contact" | "other"
  ) =>
    db
      .insert(rubricItem)
      .values({
        id,
        rubricId,
        projectId: "p1",
        title,
        acceptanceCriteria: `criterio de ${title}`,
        type,
        origin: "manual",
        status,
      })
      .run();

  item("i1", "w1", "Activar pricing", "done", "code");
  item("i2", "w1", "Cerrar contrato", "pending", "contact");
  item("i3", "w2", "Planificar", "pending", "other");

  return { sqlite, db };
}

test("listar_proyectos devuelve avance, repos y diagnóstico", () => {
  const { db } = seed();
  const out = listarProyectos(db).execute({}) as {
    items: {
      id: string;
      repos: number;
      semana: { pct: number };
      acumulado: { pct: number; hechos: number; total: number };
      diagnostico: { negocio: number; tecnico: number } | null;
    }[];
    total: number;
    truncado: boolean;
  };

  assert.equal(out.total, 2);
  assert.equal(out.truncado, false);

  const landing = out.items.find((p) => p.id === "p1")!;
  assert.equal(landing.repos, 1);
  assert.deepEqual(landing.acumulado, { pct: 33, hechos: 1, total: 3 });
  assert.equal(landing.semana.pct, 50);
  assert.deepEqual(landing.diagnostico, { negocio: 50, tecnico: 0 });

  assert.equal(out.items.find((p) => p.id === "p2")!.diagnostico, null);
});

test("ver_proyecto resuelve por nombre y arma el detalle", () => {
  const { db } = seed();
  const tool = verProyecto(db);
  const out = tool.execute({ nombre: "landing" }) as {
    id: string;
    repos: { id: string }[];
    capacidades: { integration: string; integrationBase: string; movidaPorItems: boolean }[];
    temas: { id: string }[];
    itemsAbiertos: number;
    avance: { acumulado: { total: number } };
  };

  assert.equal(out.id, "p1");
  assert.equal(out.repos.length, 1);
  assert.equal(out.capacidades.length, 1);
  assert.equal(out.capacidades[0]!.integrationBase, "I2");
  assert.equal(out.capacidades[0]!.movidaPorItems, false);
  assert.equal(out.temas.length, 1);
  assert.equal(out.itemsAbiertos, 2);
  assert.equal(out.avance.acumulado.total, 3);

  assert.deepEqual(tool.ref!({}, out), { vista: "proyecto", id: "p1" });
});

test("ver_proyecto devuelve error, no lanza", () => {
  const { db } = seed();
  const tool = verProyecto(db);

  assert.deepEqual(tool.execute({ nombre: "zzz" }), {
    error: 'No encontré un proyecto que contenga "zzz".',
  });
  assert.deepEqual(tool.execute({}), { error: "Pasá id o nombre de proyecto." });
  assert.equal(tool.ref!({}, { error: "x" }), null);
});

test("ver_proyecto pide el id cuando el nombre es ambiguo", () => {
  const { db } = seed();
  db.insert(project).values({ id: "p3", name: "Landing México", path: "/landing-mx", status: "active" }).run();

  const out = verProyecto(db).execute({ nombre: "landing" }) as { error?: string };
  assert.match(out.error ?? "", /Hay varios/);
});

test("ver_semana trae la actual y la próxima", () => {
  const { db } = seed();
  const tool = verSemana(db);

  const actual = tool.execute({}) as { id: string; items: unknown[]; pct: number };
  assert.equal(actual.id, "w1");
  assert.equal(actual.items.length, 2);
  assert.equal(actual.pct, 50);

  const proxima = tool.execute({ cual: "proxima" }) as { id: string; items: unknown[] };
  assert.equal(proxima.id, "w2");
  assert.equal(proxima.items.length, 1);

  assert.deepEqual(tool.ref!({}, actual), { vista: "semana", id: "w1" });
  assert.deepEqual(tool.execute({ id: "nope" }), { error: "No existe la semana nope." });
});

test("listar_items filtra y no devuelve dropped por defecto", () => {
  const { db } = seed();
  const tool = listarItems(db);

  const todos = tool.execute({}) as { items: { id: string }[]; total: number; truncado: boolean };
  assert.equal(todos.total, 3);
  assert.equal(todos.truncado, false);

  const pendientes = tool.execute({ estado: "pending" }) as { items: { id: string }[] };
  assert.deepEqual(pendientes.items.map((i) => i.id).sort(), ["i2", "i3"]);

  assert.equal((tool.execute({ tipo: "code" }) as { total: number }).total, 1);

  db.insert(rubricItem)
    .values({
      id: "i4",
      rubricId: "w1",
      projectId: "p1",
      title: "Descartado",
      acceptanceCriteria: "x",
      type: "other",
      origin: "manual",
      status: "dropped",
    })
    .run();

  assert.equal((tool.execute({}) as { total: number }).total, 3);
  assert.equal((tool.execute({ estado: "dropped" }) as { total: number }).total, 1);
});

test("buscar_notas busca en summary y privateNotes, nunca en transcript", () => {
  const { db } = seed();
  const tool = buscarNotas(db);

  const porPersona = tool.execute({ texto: "Persona_#%&" }) as {
    items: { id: string; campo: string; extracto: string }[];
    total: number;
  };
  assert.equal(porPersona.total, 1);
  assert.equal(porPersona.items[0]!.campo, "summary");
  assert.match(porPersona.items[0]!.extracto, /Persona_#%&/);

  const porPricing = tool.execute({ texto: "pricing" }) as { items: { campo: string }[] };
  assert.equal(porPricing.items[0]!.campo, "privateNotes");

  assert.equal((tool.execute({ texto: "basura" }) as { total: number }).total, 0);

  assert.equal(tool.input.safeParse({ texto: "a" }).success, false);
  assert.equal(tool.input.safeParse({ texto: "Persona_#%&", extra: 1 }).success, false);
});

test("ver_reunion devuelve temas, citas y preguntas, sin transcript", () => {
  const { db } = seed();
  const tool = verReunion(db);

  const out = tool.execute({ id: "m1" }) as {
    titulo: string;
    participantes: string[];
    resumen: string | null;
    temas: { id: string; cita: string | null; preguntasAbiertas: string[] }[];
  };

  assert.equal(out.titulo, "Landing page activation plan");
  assert.equal(out.participantes.length, 2);
  assert.equal(out.temas.length, 2);
  assert.equal(out.temas[0]!.id, "t1");
  assert.equal(out.temas[0]!.cita, "deadline antes del 15 de diciembre");
  assert.deepEqual(out.temas[0]!.preguntasAbiertas, ["¿Quién firma?"]);
  assert.equal("transcript" in out, false);

  assert.deepEqual(tool.ref!({}, out), { vista: "reuniones", id: null });
  assert.deepEqual(tool.execute({ id: "nope" }), {
    error: "No existe la reunión nope. Usá buscar_notas para encontrar el id.",
  });
});

test("estado_diagnostico separa negocio, técnico y faltantes", () => {
  const { db } = seed();
  const tool = estadoDiagnostico(db);

  const conUna = tool.execute({ proyectoId: "p1" }) as {
    negocio: number;
    tecnico: number;
    robustez: number;
    estado: string;
    base: number;
    resumen: { completos: number; parciales: number; ausentes: number; confiables: number };
    faltantes: string[];
  };
  assert.equal(conUna.base, 1);
  assert.equal(conUna.negocio, 50);
  assert.equal(conUna.tecnico, 0);
  assert.equal(conUna.robustez, 67);
  assert.equal(conUna.estado, "aceptable");
  assert.deepEqual(conUna.resumen, { completos: 0, parciales: 1, ausentes: 0, confiables: 0 });
  assert.deepEqual(conUna.faltantes, []);

  db.insert(projectCapability)
    .values({ id: "c2", projectId: "p1", key: "G02", title: "Reportes", integration: "I0", importedAt: new Date() })
    .run();
  db.insert(projectCapability)
    .values({
      id: "c3",
      projectId: "p1",
      key: "G03",
      title: "Futuro",
      integration: "I0",
      scope: "futuro",
      importedAt: new Date(),
    })
    .run();

  const conFaltante = tool.execute({ proyectoId: "p1" }) as {
    negocio: number;
    base: number;
    faltantes: string[];
  };
  assert.equal(conFaltante.base, 2);
  assert.equal(conFaltante.negocio, 25);
  assert.deepEqual(conFaltante.faltantes, ["Reportes"]);

  const sin = tool.execute({ proyectoId: "p2" }) as { estado: string; base: number };
  assert.equal(sin.estado, "sin-diagnostico");
  assert.equal(sin.base, 0);

  assert.deepEqual(tool.ref!({}, conUna), { vista: "proyecto", id: "p1" });
  assert.match((tool.execute({ proyectoId: "nope" }) as { error?: string }).error ?? "", /No existe el proyecto/);
});

test("las tools de lectura no escriben", () => {
  const { sqlite, db } = seed();
  const cambios = () => (sqlite.prepare("select total_changes() as n").get() as { n: number }).n;
  const antes = cambios();

  listarProyectos(db).execute({});
  verProyecto(db).execute({ id: "p1" });
  verSemana(db).execute({});
  verSemana(db).execute({ cual: "proxima" });
  listarItems(db).execute({});
  buscarNotas(db).execute({ texto: "Persona_#%&" });
  verReunion(db).execute({ id: "m1" });
  estadoDiagnostico(db).execute({ proyectoId: "p1" });

  assert.equal(cambios(), antes);
});
