import test from "node:test";
import assert from "node:assert/strict";
import { excedido, maxSteps, topeDia, topeTurno } from "../src/app/presupuesto.ts";

test("excedido corta sólo por encima del tope", () => {
  assert.equal(excedido(0, 0.05), false);
  assert.equal(excedido(0.05, 0.05), false);
  assert.equal(excedido(0.051, 0.05), true);
});

test("los topes usan default ante valores inválidos y respetan cero en USD", () => {
  const previos = {
    steps: process.env.CONSULTA_MAX_STEPS,
    turno: process.env.CONSULTA_MAX_USD_TURNO,
    dia: process.env.CONSULTA_MAX_USD_DIA,
  };

  process.env.CONSULTA_MAX_STEPS = "abc";
  process.env.CONSULTA_MAX_USD_TURNO = "0";
  process.env.CONSULTA_MAX_USD_DIA = "-1";

  try {
    assert.equal(maxSteps(), 6);
    assert.equal(topeTurno(), 0);
    assert.equal(topeDia(), 2);
  } finally {
    const claves = [
      ["CONSULTA_MAX_STEPS", previos.steps],
      ["CONSULTA_MAX_USD_TURNO", previos.turno],
      ["CONSULTA_MAX_USD_DIA", previos.dia],
    ] as const;
    for (const [k, v] of claves) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
