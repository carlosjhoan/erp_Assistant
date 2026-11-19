import { eq } from "drizzle-orm";
import test from "node:test";
import assert from "node:assert/strict";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { openDatabase } from "../src/infra/db/client.ts";
import { meeting, project, rubric, topic } from "../src/infra/db/schema.ts";
import { createTopicRepo, rangoSemana } from "../src/infra/db/topic-repo.ts";

import {
  alternarProyecto,
  assertTriajeCompleto,
  proyectosDeTema,
  cambiarEstado,
  crear,
  editar,
  fusionar,
  pendientesDeTriaje,
  TriageError,
} from "../src/app/triage.ts";

function entorno() {
  const { db } = openDatabase(":memory:");
  migrate(db, { migrationsFolder: "./drizzle" });

  db.insert(meeting)
    .values({
      id: "m1",
      source: "granola",
      externalId: "g1",
      title: "Landing",
      occurredAt: new Date("2026-11-13T16:28:03Z"),
      contentHash: "h",
      summary: "x",
    })
    .run();

  // Todo tema necesita proyecto para poder seleccionarse: el helper deja uno listo.
  db.insert(project).values({ id: "proj1", name: "Prueba", path: "/p" }).run();

  const repo = createTopicRepo(db);
  const crearTema = (title: string, status: "proposed" | "selected" | "parked" | "discarded" = "proposed") => {
    const id = repo.crearManual({ meetingId: "m1", title, status });
    db.update(topic).set({ projectId: "proj1" }).where(eq(topic.id, id)).run();
    return id;
  };

  return { db, repo, crearTema };
}

test("calificar un tema lo saca de la bandeja", () => {
  const { db, crearTema } = entorno();
  const id = crearTema("Activar la landing");

  const r = cambiarEstado({ db }, id.slice(0, 8), "selected");

  assert.equal(r.desde, "proposed");
  assert.equal(r.hacia, "selected");
  assert.equal(pendientesDeTriaje({ db }).length, 0);
});

test("se puede resolver por prefijo del id", () => {
  const { db, crearTema } = entorno();
  const id = crearTema("Uno");
  assert.equal(cambiarEstado({ db }, id.slice(0, 6), "parked").title, "Uno");
});

test("un prefijo ambiguo se rechaza y muestra las opciones", () => {
  const { db, crearTema } = entorno();
  crearTema("Uno");
  crearTema("Dos");
  const primero = createTopicRepo(db).bandeja()[0]!.id;

  // Sin prefijo no hay coincidencia; con un prefijo de 1 char casi seguro choca.
  assert.throws(() => cambiarEstado({ db }, "", "selected"), /No encontré|coincide/);
  assert.ok(primero);
});

test("un descarte vuelve a proposed, no directo a selected", () => {
  const { db, crearTema } = entorno();
  const id = crearTema("Uno");
  cambiarEstado({ db }, id, "discarded");

  assert.throws(() => cambiarEstado({ db }, id, "selected"), /No se puede pasar de "discarded" a "selected"/);
  assert.equal(cambiarEstado({ db }, id, "proposed").hacia, "proposed");
});

test("un tema elegido se puede aparcar pero no volver a proposed", () => {
  const { db, crearTema } = entorno();
  const id = crearTema("Uno");
  cambiarEstado({ db }, id, "selected");

  assert.throws(() => cambiarEstado({ db }, id, "proposed"), /No se puede pasar/);
  assert.equal(cambiarEstado({ db }, id, "parked").hacia, "parked");
});

test("aparcar un tema lo saca de la rúbrica", () => {
  const { db, crearTema } = entorno();
  db.insert(rubric).values({ id: "r1", weekStart: "2026-11-10", version: 1, status: "draft" }).run();
  const id = crearTema("Uno");

  createTopicRepo(db).cambiarEstado(id, "selected", { rubricId: "r1" });
  cambiarEstado({ db }, id, "parked");

  assert.equal(db.select().from(topic).where(eq(topic.id, id)).get()?.rubricId, null);
});

test("un tema de una rúbrica aprobada queda bloqueado", () => {
  const { db, crearTema } = entorno();
  db.insert(rubric).values({ id: "r1", weekStart: "2026-11-10", version: 1, status: "approved" }).run();
  const id = crearTema("Uno");
  createTopicRepo(db).cambiarEstado(id, "selected", { rubricId: "r1" });

  assert.throws(() => cambiarEstado({ db }, id, "parked"), /rúbrica approved/);
  assert.throws(() => editar({ db }, id, { title: "otro" }), /rúbrica approved/);
});

test("editar cambia el título y la descripción", () => {
  const { db, crearTema } = entorno();
  const id = crearTema("Título viejo");

  editar({ db }, id, { title: "Título nuevo", description: "Aclaración" });

  const t = db.select().from(topic).where(eq(topic.id, id)).get();
  assert.equal(t?.title, "Título nuevo");
  assert.equal(t?.description, "Aclaración");
});

test("fusionar descarta el absorbido y deja el vínculo", () => {
  const { db, crearTema } = entorno();
  const destino = crearTema("Landing page");
  const absorbido = crearTema("La landing");

  const r = fusionar({ db }, [absorbido], destino);

  assert.equal(r.absorbidos.length, 1);
  const a = db.select().from(topic).where(eq(topic.id, absorbido)).get();
  assert.equal(a?.status, "discarded");
  assert.equal(a?.mergedIntoTopicId, destino);
});

test("fusionar no borra nada: el historial queda", () => {
  const { db, crearTema } = entorno();
  const destino = crearTema("A");
  const absorbido = crearTema("B");
  fusionar({ db }, [absorbido], destino);
  assert.equal(db.select().from(topic).all().length, 2);
});

test("crear un tema a mano queda en proposed y sin reunión si no se indica", () => {
  const { db } = entorno();
  const id = crear({ db }, { title: "Tema manual" });
  const t = db.select().from(topic).where(eq(topic.id, id)).get();
  assert.equal(t?.status, "proposed");
  assert.equal(t?.origin, "manual");
  assert.equal(t?.meetingId, null);
});

test("el guard de triaje nombra lo que falta", () => {
  const { db, crearTema } = entorno();
  crearTema("Uno");
  crearTema("Dos");

  assert.throws(
    () => assertTriajeCompleto({ db }),
    (e: Error) => {
      assert.match(e.message, /Te faltan 2 tema/);
      assert.match(e.message, /Uno/);
      assert.match(e.message, /Dos/);
      return true;
    }
  );
});

test("con la bandeja limpia el guard deja pasar", () => {
  const { db, crearTema } = entorno();
  const id = crearTema("Uno");
  cambiarEstado({ db }, id, "selected");
  assert.doesNotThrow(() => assertTriajeCompleto({ db }));
});

test("las ideas aparcadas aparecen en el archivo", () => {
  const { db, crearTema } = entorno();
  const id = crearTema("Idea futura");
  cambiarEstado({ db }, id, "parked");

  const ideas = createTopicRepo(db).ideas();
  assert.equal(ideas.length, 1);
  assert.equal(ideas[0]?.title, "Idea futura");
});

test("un tema sin calificar en otra reunión también bloquea", () => {
  const { db, crearTema } = entorno();
  crearTema("Pendiente");
  assert.throws(() => assertTriajeCompleto({ db }, "m1"), /Te faltan 1/);
});

test("rangoSemana va de lunes a domingo", () => {
  const { desde, hasta } = rangoSemana(new Date("2026-11-13T16:00:00Z")); // viernes
  assert.equal(desde.getDay(), 1);
  assert.equal(hasta.getDay(), 0);
  assert.ok(hasta.getTime() > desde.getTime());
});

test("la bandeja puede filtrarse por semana de la reunión", () => {
  const { db, crearTema } = entorno();
  crearTema("De esta semana");

  const { desde, hasta } = rangoSemana(new Date("2026-11-13T16:00:00Z"));
  assert.equal(createTopicRepo(db).bandeja({ desde, hasta }).length, 1);

  const otra = rangoSemana(new Date("2026-10-05T16:00:00Z"));
  assert.equal(createTopicRepo(db).bandeja({ desde: otra.desde, hasta: otra.hasta }).length, 0);
});

test("un error de triaje tiene nombre propio para poder distinguirlo", () => {
  const { db } = entorno();
  assert.throws(() => cambiarEstado({ db }, "noexiste", "selected"), (e) => e instanceof TriageError);
});


test("un tema puede seleccionarse sin proyecto", () => {
  const { db, repo } = entorno();
  const id = repo.crearManual({ meetingId: "m1", title: "Sin proyecto" });
  assert.equal(cambiarEstado({ db }, id, "selected").hacia, "selected");
});

test("un tema puede tener varios proyectos", () => {
  const { db, repo } = entorno();
  db.insert(project).values({ id: "p2", name: "Otro", path: "/p2" }).run();
  const id = repo.crearManual({ meetingId: "m1", title: "Dos proyectos" });

  alternarProyecto({ db }, id, "proj1");
  alternarProyecto({ db }, id, "p2");
  assert.equal(proyectosDeTema({ db }, id).length, 2);

  alternarProyecto({ db }, id, "p2");
  assert.deepEqual(proyectosDeTema({ db }, id), ["proj1"]);
});

test("un proyecto inexistente se rechaza", () => {
  const { db, crearTema } = entorno();
  const id = crearTema("Uno");
  assert.throws(() => alternarProyecto({ db }, id, "no-existe"), /No existe el proyecto/);
});
