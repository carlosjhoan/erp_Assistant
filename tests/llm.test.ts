import test from "node:test";
import assert from "node:assert/strict";
import { conReintento, SalidaInvalida } from "../src/infra/llm/deepseek.ts";
import { construirPeticion, leerRespuesta } from "../src/infra/llm/jev.ts";

/* ---------- reintento del generativo ---------- */

test("si la primera salida valida, no reintenta", async () => {
  let llamadas = 0;
  const r = await conReintento("prompt", async () => {
    llamadas++;
    return { ok: true };
  });
  assert.deepEqual(r, { value: { ok: true }, retries: 0 });
  assert.equal(llamadas, 1);
});

test("si falla una vez, reintenta y devuelve el segundo resultado", async () => {
  let llamadas = 0;
  const r = await conReintento("prompt", async () => {
    llamadas++;
    if (llamadas === 1) throw new Error("campo faltante");
    return { ok: true };
  });
  assert.deepEqual(r, { value: { ok: true }, retries: 1 });
  assert.equal(llamadas, 2);
});

test("el segundo intento recibe el error en el prompt", async () => {
  const prompts: string[] = [];
  await conReintento("base", async (p) => {
    prompts.push(p);
    if (prompts.length === 1) throw new Error("aceptanceCriteria inválido");
    return 1;
  });
  assert.equal(prompts[0], "base");
  assert.match(prompts[1] ?? "", /aceptanceCriteria inválido/);
  assert.match(prompts[1] ?? "", /Devolvé la salida corregida/);
});

test("si falla dos veces, aborta con el motivo", async () => {
  await assert.rejects(
    () =>
      conReintento("prompt", async () => {
        throw new Error("sigue mal");
      }),
    /no validó tras un reintento: sigue mal/
  );
});

/* ---------- contrato de Jev ---------- */

const PREGUNTAS = [
  { name: "cita_presente", instructions: "¿menciona medir los vanos?" },
  { name: "cita_inventada", instructions: "¿menciona contratar una agencia?" },
];

test("la petición usa el shape de systemone, no de chat", () => {
  const body = construirPeticion("jev-latest", "el apunte", PREGUNTAS);
  assert.equal(body.model, "jev-latest");
  assert.equal(body.state, "el apunte");
  assert.deepEqual(body.questions, {
    cita_presente: { type: "noul", instructions: "¿menciona medir los vanos?" },
    cita_inventada: { type: "noul", instructions: "¿menciona contratar una agencia?" },
  });
});

test("lee la respuesta real que devolvió el servidor", () => {
  const r = leerRespuesta(
    {
      model: "jev-1.14.0",
      answers: { cita_presente: { type: "noul", noul: 0.93 }, cita_inventada: { type: "noul", noul: 0.03 } },
      usage: { input_tokens: 321, output_tokens: 43 },
    },
    PREGUNTAS,
    "jev-latest"
  );
  assert.deepEqual(r.scores, { cita_presente: 0.93, cita_inventada: 0.03 });
  assert.equal(r.model, "jev-1.14.0");
  assert.equal(r.tokens, 321);
  assert.deepEqual(r.faltantes, []);
});

test("una pregunta sin respuesta se reporta, no se asume aprobada", () => {
  const r = leerRespuesta(
    { answers: { cita_presente: { type: "noul", noul: 0.9 } }, usage: { input_tokens: 10 } },
    PREGUNTAS,
    "jev-latest"
  );
  assert.deepEqual(r.faltantes, ["cita_inventada"]);
  assert.deepEqual(r.scores, { cita_presente: 0.9 });
});

test("una respuesta con forma rara no rompe: se marca faltante", () => {
  const r = leerRespuesta(
    { answers: { cita_presente: { noul: "alto" } } as unknown as Record<string, { noul?: unknown }> },
    PREGUNTAS,
    "jev-latest"
  );
  assert.deepEqual(r.faltantes, ["cita_presente", "cita_inventada"]);
});

test("si el servidor no manda modelo, se usa el pedido", () => {
  const r = leerRespuesta({ answers: {} }, [], "jev-latest");
  assert.equal(r.model, "jev-latest");
  assert.equal(r.tokens, 0);
});

test("el reintento le devuelve al modelo su propia salida inválida", async () => {
  const prompts: string[] = [];
  await conReintento("base", async (p) => {
    prompts.push(p);
    if (prompts.length === 1) {
      throw new SalidaInvalida("expected object, received array", '[{"title":"x"}]');
    }
    return 1;
  });

  assert.match(prompts[1] ?? "", /Tu respuesta anterior fue:/);
  assert.match(prompts[1] ?? "", /received array/);
  assert.match(prompts[1] ?? "", /"title":"x"/);
});

test("si el error no trae salida, el reintento solo lleva el mensaje", async () => {
  const prompts: string[] = [];
  await conReintento("base", async (p) => {
    prompts.push(p);
    if (prompts.length === 1) throw new Error("timeout del proveedor");
    return 1;
  });

  assert.doesNotMatch(prompts[1] ?? "", /Tu respuesta anterior fue:/);
  assert.match(prompts[1] ?? "", /timeout del proveedor/);
});
