import test from "node:test";
import assert from "node:assert/strict";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { openDatabase } from "../src/infra/db/client.ts";
import { createMeetingRepo } from "../src/infra/db/meeting-repo.ts";
import { contentHash, matchesTitle, type RawMeeting } from "../src/domain/meeting-source.ts";

function repo() {
  const { sqlite, db } = openDatabase(":memory:");
  migrate(db, { migrationsFolder: "./drizzle" });
  return { sqlite, db, r: createMeetingRepo(db) };
}

const base = (over: Partial<RawMeeting> = {}): RawMeeting => ({
  externalId: "g_1",
  title: "Landing page activation plan",
  occurredAt: new Date("2026-11-13T16:28:03Z"),
  participants: ["Carlos"],
  summary: "### Contexto\nEl cliente quiere activar la landing.",
  ...over,
});

test("importar una vez crea una fila", () => {
  const { sqlite, r } = repo();
  assert.equal(r.save(base(), "granola"), "created");
  assert.equal((sqlite.prepare("select count(*) n from meeting").get() as { n: number }).n, 1);
});

test("reimportar sin cambios no toca nada", () => {
  const { sqlite, r } = repo();
  r.save(base(), "granola");
  assert.equal(r.save(base(), "granola"), "unchanged");
  assert.equal((sqlite.prepare("select count(*) n from meeting").get() as { n: number }).n, 1);
});

test("si la nota cambió, actualiza la MISMA fila", () => {
  const { sqlite, r } = repo();
  r.save(base(), "granola");
  const idOriginal = r.list()[0]!.id;

  const cambiada = base({ summary: "### Contexto\nEl cliente quiere activar la landing.\n### Nuevo\nSe sumó pricing." });
  assert.equal(r.save(cambiada, "granola"), "updated");

  const filas = r.list();
  assert.equal(filas.length, 1, "no debe aparecer una reunión nueva");
  assert.equal(filas[0]!.id, idOriginal);
  assert.match(filas[0]!.summary ?? "", /Se sumó pricing/);
  assert.equal((sqlite.prepare("select count(*) n from meeting").get() as { n: number }).n, 1);
});

test("la misma nota desde otra fuente es otra reunión", () => {
  const { sqlite, r } = repo();
  r.save(base(), "granola");
  r.save(base(), "manual");
  assert.equal((sqlite.prepare("select count(*) n from meeting").get() as { n: number }).n, 2);
});

test("saveMany resume creadas, actualizadas e iguales", () => {
  const { r } = repo();
  const primera = r.saveMany([base(), base({ externalId: "g_2", title: "Otra" })], "granola");
  assert.deepEqual(primera, { created: 2, updated: 0, unchanged: 0 });

  const segunda = r.saveMany([base(), base({ externalId: "g_2", title: "Otra", summary: "cambió" })], "granola");
  assert.deepEqual(segunda, { created: 0, updated: 1, unchanged: 1 });
});

test("no persiste el transcript: sólo resumen y notas privadas", () => {
  const { r } = repo();
  r.save(base({ transcript: "Carlos: hola" }), "granola");
  const fila = r.list()[0]!;
  assert.equal(fila.summaryAvailable, true);
  assert.equal(fila.transcriptAvailable, false);
  assert.equal(fila.transcript, null);
  assert.equal(fila.privateNotesAvailable, false);
  assert.equal(fila.privateNotes, null);
});

test("un cambio sólo en el transcript no actualiza la reunión", () => {
  const { r } = repo();
  r.save(base({ transcript: "A" }), "granola");
  assert.equal(r.save(base({ transcript: "B distinto" }), "granola"), "unchanged");
});

test("contentHash cambia con el contenido y no con el formato de salto de línea", () => {
  const a = contentHash({ summary: "hola\nmundo" });
  const b = contentHash({ summary: "hola\r\nmundo" });
  const c = contentHash({ summary: "hola\nmundo!" });
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test("matchesTitle filtra por contenido sin distinguir mayúsculas", () => {
  assert.equal(matchesTitle("Landing page activation plan", "landing page"), true);
  assert.equal(matchesTitle("Landing page activation plan", "  ACTIVATION PLAN "), true);
  assert.equal(matchesTitle("Otra reunión", "landing page"), false);
  assert.equal(matchesTitle("Otra reunión", ""), true);
  assert.equal(matchesTitle("Otra reunión", undefined), true);
});
