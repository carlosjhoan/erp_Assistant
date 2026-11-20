import { test } from "node:test";
import assert from "node:assert/strict";
import { capacidadesEfectivas, efectiva, veredicto } from "../src/app/progreso.ts";

const cap = (integration: string, reliability = "F2") => ({
  scope: "actual",
  outsideRubric: false,
  integration,
  reliability,
  quality: "Q3",
});

test("sin items, la capacidad vale lo que dice el diagnostico", () => {
  assert.equal(efectiva("I2", [], "c1").actual, "I2");
});

test("un item que cierra la sube a integrada", () => {
  const items = [{ capabilityId: "c1", capabilityEffect: "cierra", status: "done" }];
  const r = efectiva("I2", items, "c1");
  assert.equal(r.actual, "I3");
  assert.equal(r.porItems, true);
});

test("un item que avanza la deja como minimo parcial", () => {
  const items = [{ capabilityId: "c1", capabilityEffect: "avanza", status: "done" }];
  assert.equal(efectiva("I0", items, "c1").actual, "I2");
});

test("un item pendiente no mueve nada", () => {
  const items = [{ capabilityId: "c1", capabilityEffect: "cierra", status: "pending" }];
  assert.equal(efectiva("I0", items, "c1").actual, "I0");
});

test("la base manda si ya era mas alta que el aporte", () => {
  const items = [{ capabilityId: "c1", capabilityEffect: "avanza", status: "done" }];
  assert.equal(efectiva("I3", items, "c1").actual, "I3");
  assert.equal(efectiva("I3", items, "c1").porItems, false);
});

test("el item solo mueve su propia capacidad", () => {
  const items = [{ capabilityId: "c1", capabilityEffect: "cierra", status: "done" }];
  assert.equal(efectiva("I0", items, "c2").actual, "I0");
});

test("negocio sale del promedio ponderado; produccion exige confiabilidad", () => {
  // I3 confiable = 1, I2 = 0,5, I0 = 0  → (1 + 0.5 + 0) / 3 = 50%
  const v = veredicto([cap("I3"), cap("I2"), cap("I0")]);
  assert.equal(v.negocio, 50);
  // Solo una es I3 y confiable.
  assert.equal(v.produccion, 33);
  assert.equal(v.base, 3);
});

test("integrada pero no confiable no cuenta como produccion", () => {
  const v = veredicto([cap("I3", "F1")]);
  assert.equal(v.negocio, 100);
  assert.equal(v.produccion, 0);
});

test("futuro y propuestas quedan fuera del denominador", () => {
  const v = veredicto([
    cap("I3"),
    { ...cap("I0"), scope: "futuro" },
    { ...cap("I0"), outsideRubric: true },
  ]);
  assert.equal(v.base, 1);
  assert.equal(v.negocio, 100);
});

test("cerrar un item sube el negocio del proyecto", () => {
  const caps = [
    { id: "c1", integration: "I2" },
    { id: "c2", integration: "I0" },
    { id: "c3", integration: "I0" },
    { id: "c4", integration: "I0" },
  ];
  const conDatos = caps.map((c) => ({ ...c, ...cap(c.integration) }));
  const antes = veredicto(conDatos);
  const items = [{ capabilityId: "c1", capabilityEffect: "cierra", status: "done" }];
  const despues = veredicto(capacidadesEfectivas(conDatos, items));
  assert.equal(antes.negocio, 13); // 0.5 / 4
  assert.equal(despues.negocio, 25); // 1 / 4
});
