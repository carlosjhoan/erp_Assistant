import test from "node:test";
import assert from "node:assert/strict";
import { parseMeetingsXml, decodeEntities } from "../src/infra/granola/parse.ts";

const LOTE = `<meetings_data from="Nov 10, 2026" to="Nov 13, 2026" count="2">
  <meeting id="f49c31b4" title="Landing page activation plan" date="Nov 13, 2026 11:28 AM GMT-5" meeting_at="2026-11-13T11:28:03.000-05:00">
    <known_participants>Carlos Jhoan (carlos@ejemplo.com), Juan P&eacute;rez</known_participants>
    <private_notes status="empty" />
    <transcript available="true">Carlos: hola
Juan: buenas</transcript>
    <summary>### Contexto
El cliente quiere activar la landing.</summary>
  </meeting>
  <meeting id="a1b2c3d4" title="Cotizaci&oacute;n de vanos" date="Nov 10, 2026 09:00 AM GMT-5">
    <private_notes>Acordamos 14 vanos.</private_notes>
    <transcript available="false"></transcript>
    <summary>Precios y plazos.</summary>
  </meeting>
  <pagination next_cursor="abc123" />
</meetings_data>`;

test("extrae ambas reuniones con sus campos", () => {
  const r = parseMeetingsXml(LOTE);
  assert.equal(r.meetings.length, 2);
  assert.equal(r.skipped.length, 0);

  const [primera, segunda] = r.meetings;
  assert.equal(primera?.externalId, "f49c31b4");
  assert.equal(primera?.title, "Landing page activation plan");
  assert.equal(primera?.occurredAt.toISOString(), "2026-11-13T16:28:03.000Z");
  assert.deepEqual(primera?.participants, ["Carlos Jhoan (carlos@ejemplo.com)", "Juan Pérez"]);
  assert.match(primera?.summary ?? "", /### Contexto/);
  assert.match(primera?.summary ?? "", /El cliente quiere activar la landing\./);
  assert.match(primera?.transcript ?? "", /Juan: buenas/);

  assert.equal(segunda?.title, "Cotización de vanos");
  assert.equal(segunda?.privateNotes, "Acordamos 14 vanos.");
  assert.match(segunda?.summary ?? "", /Precios y plazos/);
});

test("private_notes vacío no se guarda como string vacío", () => {
  const [primera] = parseMeetingsXml(LOTE).meetings;
  assert.equal(primera?.privateNotes, undefined);
});

test("transcript no disponible no se guarda", () => {
  const [, segunda] = parseMeetingsXml(LOTE).meetings;
  assert.equal(segunda?.transcript, undefined);
});

test("reunión sin summary no inventa resumen", () => {
  const xml = `<meetings_data><meeting id="x" title="Solo notas" date="Nov 10, 2026 09:00 AM GMT-5"><private_notes>hola</private_notes></meeting></meetings_data>`;
  const [m] = parseMeetingsXml(xml).meetings;
  assert.equal(m?.summary, undefined);
  assert.equal(m?.privateNotes, "hola");
});

test("decodifica entidades del atributo title", () => {
  const [, segunda] = parseMeetingsXml(LOTE).meetings;
  assert.equal(segunda?.title, "Cotización de vanos");
});

test("una reunión sin id se descarta y el resto sigue", () => {
  const xml = `<meetings_data>
    <meeting title="Sin id" date="Nov 10, 2026 09:00 AM GMT-5"><summary>x</summary></meeting>
    <meeting id="ok" title="Buena" date="Nov 10, 2026 09:00 AM GMT-5"><summary>y</summary></meeting>
  </meetings_data>`;
  const r = parseMeetingsXml(xml);
  assert.equal(r.meetings.length, 1);
  assert.equal(r.meetings[0]?.externalId, "ok");
  assert.deepEqual(r.skipped, [{ reason: "sin id", title: "Sin id" }]);
});

test("respuesta sin reuniones devuelve vacío, no rompe", () => {
  const r = parseMeetingsXml(`<meetings_data count="0"></meetings_data>`);
  assert.deepEqual(r.meetings, []);
  assert.deepEqual(r.pagination, {});
});

test("lee el cursor de paginación", () => {
  assert.equal(parseMeetingsXml(LOTE).pagination.nextCursor, "abc123");
});

test("decodeEntities cubre numéricas y nombradas", () => {
  assert.equal(decodeEntities("a &amp; b &#39;c&#39; &#x41;"), "a & b 'c' A");
});
