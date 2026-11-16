import test from "node:test";
import assert from "node:assert/strict";
import { excerptAppearsIn, normalize, CITA_MIN_RATIO } from "../src/domain/citation.ts";

const APUNTE = `### Contexto
El cliente quiere activar la landing antes de fin de mes.
Hay que medir los vanos del nivel 3 y firmar el acta con la interventoría.
El copy del hero no convence a nadie según el equipo de marketing.`;

test("una cita literal se encuentra", () => {
  const r = excerptAppearsIn(APUNTE, "Hay que medir los vanos del nivel 3");
  assert.equal(r.found, true);
  assert.equal(r.ratio, 1);
});

test("acentos y mayúsculas no afectan", () => {
  const r = excerptAppearsIn(APUNTE, "EL COPY DEL HÉRO NO CONVENCE");
  assert.equal(r.found, true);
});

test("la puntuación no afecta", () => {
  const r = excerptAppearsIn(APUNTE, "medir los vanos, del nivel 3.");
  assert.equal(r.found, true);
});

test("una cita cortada a la mitad se acepta", () => {
  const r = excerptAppearsIn(APUNTE, "medir los vanos del nivel");
  assert.equal(r.found, true);
});

test("una cita inventada se rechaza", () => {
  const r = excerptAppearsIn(APUNTE, "acordamos contratar una agencia de branding en Bogotá");
  assert.equal(r.found, false);
  assert.ok(r.missing.length > 0, "debe explicar qué palabras no aparecen");
});

test("una paráfrasis que cambia el sentido se rechaza", () => {
  const r = excerptAppearsIn(APUNTE, "el cliente rechazó activar la landing este mes");
  assert.equal(r.found, false);
});

test("una cita vacía no se acepta", () => {
  assert.equal(excerptAppearsIn(APUNTE, "   ").found, false);
});

test("el umbral está declarado y es razonable", () => {
  assert.ok(CITA_MIN_RATIO > 0.5 && CITA_MIN_RATIO <= 1);
});

test("normalize quita acentos, mayúsculas y signos", () => {
  assert.equal(normalize("¡Héroe, NIVEL 3!"), "heroe nivel 3");
});
