import test from "node:test";
import assert from "node:assert/strict";
import { DesgloseTema, ExtraccionTemas } from "../src/app/contracts.ts";

const tema = (over: Record<string, unknown> = {}) => ({
  title: "Activar la landing page",
  description: "El cliente quiere publicar la landing antes de fin de mes con el copy ajustado.",
  sourceExcerpt: "El cliente quiere activar la landing antes de fin de mes",
  scopeSignal: "likely_scope",
  scopeReason: "Hay compromiso explícito con fecha",
  ...over,
});

const item = (over: Record<string, unknown> = {}) => ({
  title: "Medir los vanos del nivel 3",
  acceptanceCriteria: "Acta firmada con las 14 medidas registradas",
  suggestedType: "contact",
  sourceExcerpt: "hay que medir los vanos del nivel 3",
  ...over,
});

test("una extracción válida pasa", () => {
  assert.equal(ExtraccionTemas.safeParse({ topics: [tema()] }).success, true);
});

test("cero temas es válido (reunión sin nada accionable)", () => {
  assert.equal(ExtraccionTemas.safeParse({ topics: [] }).success, true);
});

test("más de diez temas se rechaza", () => {
  const topics = Array.from({ length: 11 }, () => tema());
  assert.equal(ExtraccionTemas.safeParse({ topics }).success, false);
});

test("una señal de alcance inventada se rechaza", () => {
  assert.equal(ExtraccionTemas.safeParse({ topics: [tema({ scopeSignal: "urgente" })] }).success, false);
});

test("un tema sin cita se rechaza", () => {
  assert.equal(ExtraccionTemas.safeParse({ topics: [tema({ sourceExcerpt: "" })] }).success, false);
});

test("un desglose de un solo ítem es válido", () => {
  assert.equal(DesgloseTema.safeParse({ items: [item()] }).success, true);
});

test("un desglose vacío se rechaza", () => {
  assert.equal(DesgloseTema.safeParse({ items: [] }).success, false);
});

test("más de doce ítems se rechaza", () => {
  const items = Array.from({ length: 13 }, () => item());
  assert.equal(DesgloseTema.safeParse({ items }).success, false);
});

test("un tipo no previsto se rechaza", () => {
  assert.equal(DesgloseTema.safeParse({ items: [item({ suggestedType: "meeting" })] }).success, false);
});

test("un criterio demasiado corto se rechaza", () => {
  assert.equal(DesgloseTema.safeParse({ items: [item({ acceptanceCriteria: "listo" })] }).success, false);
});
