import test from "node:test";
import assert from "node:assert/strict";
import { GranolaSource, type ToolCaller } from "../src/infra/granola/source.ts";

const nota = (id: string, title: string) => `<meeting id="${id}" title="${title}" meeting_at="2026-11-13T16:28:03Z">
  <summary>resumen de ${title}</summary>
</meeting>`;

const TITULO = "Landing page activation plan";

/**
 * El listado devuelve solo metadatos; el contenido llega por get_meetings.
 * Este doble imita ese reparto para que los tests reflejen la realidad.
 */
function fakeCaller(pages: string[], calls: Record<string, unknown>[] = [], detalle?: string): ToolCaller {
  let i = 0;
  return {
    async callTool(req) {
      calls.push({ ...(req.arguments ?? {}), _tool: req.name });

      if (req.name === "get_meetings") {
        const ids = (req.arguments?.meeting_ids as string[]) ?? [];
        const xml = detalle ?? `<meetings_data>${ids.map((id) => nota(id, TITULO)).join("")}</meetings_data>`;
        return { content: [{ type: "text", text: xml }] };
      }

      const xml = pages[i++] ?? `<meetings_data count="0"/>`;
      return { content: [{ type: "text", text: xml }] };
    },
  };
}

test("filtra por título y descarta el resto", async () => {
  const caller = fakeCaller([
    `<meetings_data>${nota("g1", TITULO)}${nota("g2", "Pricing strategy")}</meetings_data>`,
  ]);
  const source = new GranolaSource(caller, { titleMatch: "landing page" });

  const r = await source.fetch();
  assert.equal(r.length, 1);
  assert.equal(r[0]?.externalId, "g1");
});

test("sin filtro devuelve todas", async () => {
  const caller = fakeCaller([`<meetings_data>${nota("g1", "A")}${nota("g2", "B")}</meetings_data>`]);
  const r = await new GranolaSource(caller, {}).fetch();
  assert.equal(r.length, 2);
});

test("pagina hasta que no hay cursor", async () => {
  const caller = fakeCaller([
    `<meetings_data>${nota("g1", TITULO)}<pagination next_cursor="c1"/></meetings_data>`,
    `<meetings_data>${nota("g2", TITULO)}<pagination next_cursor="c2"/></meetings_data>`,
    `<meetings_data>${nota("g3", TITULO)}</meetings_data>`,
  ]);
  const r = await new GranolaSource(caller, {}).fetch();
  assert.deepEqual(
    r.map((m) => m.externalId),
    ["g1", "g2", "g3"]
  );
});

test("no repite una reunión que aparece en dos páginas", async () => {
  const caller = fakeCaller([
    `<meetings_data>${nota("g1", TITULO)}<pagination next_cursor="c1"/></meetings_data>`,
    `<meetings_data>${nota("g1", TITULO)}<pagination next_cursor="c2"/></meetings_data>`,
    `<meetings_data>${nota("g1", TITULO)}</meetings_data>`,
  ]);
  const r = await new GranolaSource(caller, {}).fetch();
  assert.equal(r.length, 1);
});

test("un error de la herramienta se propaga con contexto", async () => {
  const caller: ToolCaller = {
    async callTool() {
      return { content: [{ type: "text", text: "rate limited" }], isError: true };
    },
  };
  await assert.rejects(() => new GranolaSource(caller, {}).fetch(), /list_meetings falló: rate limited/);
});

test("pide updated_after cuando hay since, y time_range cuando no", async () => {
  const calls: Record<string, unknown>[] = [];
  await new GranolaSource(fakeCaller([], calls), { since: new Date("2026-11-06T00:00:00Z") }).fetch();
  await new GranolaSource(fakeCaller([], calls), {}).fetch();

  const listados = calls.filter((c) => c._tool === "list_meetings");
  assert.equal(listados[0]?.updated_after, "2026-11-06T00:00:00.000Z");
  assert.equal(listados[0]?.time_range, undefined);
  assert.equal(listados[1]?.time_range, "last_7_days");
});

test("pide el detalle con get_meetings, de a diez ids como máximo", async () => {
  const ids = Array.from({ length: 12 }, (_, n) => `g${n}`);
  const pagina = `<meetings_data>${ids.map((id) => nota(id, TITULO)).join("")}</meetings_data>`;
  const calls: Record<string, unknown>[] = [];

  const r = await new GranolaSource(fakeCaller([pagina], calls), {}).fetch();

  const detalles = calls.filter((c) => c._tool === "get_meetings");
  assert.equal(detalles.length, 2);
  assert.equal((detalles[0]?.meeting_ids as string[]).length, 10);
  assert.equal((detalles[1]?.meeting_ids as string[]).length, 2);
  assert.equal(r.length, 12);
});

test("el contenido del detalle llega a la reunión", async () => {
  const caller = fakeCaller(
    [`<meetings_data>${nota("g1", TITULO)}</meetings_data>`],
    [],
    `<meetings_data><meeting id="g1" title="${TITULO}" meeting_at="2026-11-13T16:28:03Z">
      <summary>### Contexto real</summary>
      <transcript available="true">Carlos: hola</transcript>
    </meeting></meetings_data>`
  );

  const [m] = await new GranolaSource(caller, {}).fetch();
  assert.equal(m?.summary, "### Contexto real");
  assert.equal(m?.transcript, "Carlos: hola");
});
