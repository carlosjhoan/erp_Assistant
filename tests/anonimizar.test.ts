import test from "node:test";
import assert from "node:assert/strict";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { openDatabase } from "../src/infra/db/client.ts";
import { meeting } from "../src/infra/db/schema.ts";
import { anonimizar, nombresConocidos } from "../src/app/anonimizar.ts";

test("anonimizar reemplaza el nombre por un patrón estable, sin importar mayúsculas", () => {
  assert.equal(
    anonimizar("Ana Gómez pidió el deadline y ana gómez confirmó.", ["Ana Gómez"]),
    "Persona_#%& pidió el deadline y Persona_#%& confirmó."
  );
});

test("anonimizar usa un patrón distinto por persona y respeta el nombre más largo", () => {
  assert.equal(
    anonimizar("Ana María habló; Ana escuchó.", ["Ana", "Ana María"]),
    "Persona_#%& habló; Persona_%&# escuchó."
  );
});

test("anonimizar no toca el texto si no hay nombres o no aparecen", () => {
  assert.equal(anonimizar("sin nombres", []), "sin nombres");
  assert.equal(anonimizar("sin nombres", ["Otro"]), "sin nombres");
});

test("nombresConocidos junta participantes sin duplicar y descarta los muy cortos", () => {
  const { db } = openDatabase(":memory:");
  migrate(db, { migrationsFolder: "./drizzle" });
  db.insert(meeting)
    .values({
      id: "m1",
      source: "manual",
      externalId: "e1",
      title: "t",
      occurredAt: new Date(),
      participants: ["Ana Gómez", "Bo", "Ana Gómez"],
      contentHash: "h",
    })
    .run();

  assert.deepEqual(nombresConocidos(db).sort(), ["Ana Gómez"]);
});
