import { test } from "node:test";
import assert from "node:assert/strict";
import { costoUsd } from "../src/infra/llm/precio.ts";

test("el costo crece con los tokens", () => {
  const a = costoUsd("deepseek", "deepseek-flash", 1000, 500);
  const b = costoUsd("deepseek", "deepseek-flash", 2000, 1000);
  assert.ok(a > 0);
  assert.ok(Math.abs(b - a * 2) < 1e-12);
});

test("un modelo desconocido no inventa costo", () => {
  assert.equal(costoUsd("deepseek", "modelo-inventado", 1000, 1000), 0);
});

test("sin tokens no hay costo", () => {
  assert.equal(costoUsd("deepseek", "deepseek-flash", undefined, undefined), 0);
});

test("Jev se tarifa por token de entrada cuando no hay tarifa plana", () => {
  const plano = Number(process.env.JEV_USD_PER_CALL);
  if (Number.isFinite(plano) && plano > 0) return; // configurado a mano
  const c = costoUsd("jev", "jev-1.14.0", 1_000_000, 50);
  assert.ok(Math.abs(c - 0.042) < 1e-9);
});
