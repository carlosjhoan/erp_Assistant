import test from "node:test";
import assert from "node:assert/strict";
import { gradoDeUrgencia, ordenarPorUrgencia } from "../src/web/orden-reuniones.ts";

const d = (iso: string) => new Date(iso);

const REUNIONES = [
  { id: "resuelta-nueva", occurredAt: d("2026-11-13T00:00:00Z") },
  { id: "pendiente-vieja", occurredAt: d("2026-11-09T00:00:00Z") },
  { id: "sin-extraer", occurredAt: d("2026-11-10T00:00:00Z") },
  { id: "pendiente-nueva", occurredAt: d("2026-11-12T00:00:00Z") },
  { id: "resuelta-vieja", occurredAt: d("2026-11-01T00:00:00Z") },
];

const TEMAS = [
  { meetingId: "resuelta-nueva", status: "selected" },
  { meetingId: "pendiente-vieja", status: "proposed" },
  { meetingId: "pendiente-nueva", status: "proposed" },
  { meetingId: "resuelta-vieja", status: "discarded" },
];

test("clasifica el grado de cada reunión", () => {
  assert.equal(gradoDeUrgencia("pendiente-vieja", TEMAS), 2);
  assert.equal(gradoDeUrgencia("sin-extraer", TEMAS), 1);
  assert.equal(gradoDeUrgencia("resuelta-nueva", TEMAS), 0);
});

test("las que piden trabajo van primero, y entre esas la más vieja", () => {
  const orden = ordenarPorUrgencia(REUNIONES, TEMAS).map((r) => r.id);

  assert.deepEqual(orden, [
    "pendiente-vieja", // pendiente, 9 nov
    "pendiente-nueva", // pendiente, 12 nov
    "sin-extraer", // falta extraer
    "resuelta-nueva", // resuelta, más nueva
    "resuelta-vieja", // resuelta, más vieja
  ]);
});

test("una reunión sin temas pide extracción, no cuenta como resuelta", () => {
  const orden = ordenarPorUrgencia(
    [
      { id: "a", occurredAt: d("2026-11-01T00:00:00Z") },
      { id: "b", occurredAt: d("2026-11-02T00:00:00Z") },
    ],
    []
  ).map((r) => r.id);

  assert.deepEqual(orden, ["a", "b"]);
});

test("no muta el arreglo original", () => {
  const copia = [...REUNIONES];
  ordenarPorUrgencia(REUNIONES, TEMAS);
  assert.deepEqual(REUNIONES, copia);
});

test("una fecha nula no rompe el orden", () => {
  const orden = ordenarPorUrgencia(
    [
      { id: "sin-fecha", occurredAt: null },
      { id: "con-fecha", occurredAt: d("2026-11-10T00:00:00Z") },
    ],
    [{ meetingId: "con-fecha", status: "proposed" }]
  ).map((r) => r.id);

  assert.equal(orden[0], "con-fecha");
});
