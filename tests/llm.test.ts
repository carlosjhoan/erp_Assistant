import test from "node:test";
import assert from "node:assert/strict";
import { conReintento, SalidaInvalida } from "../src/infra/llm/deepseek.ts";
import { clasificarError } from "../src/infra/llm/errors.ts";
import { construirPeticion, leerRespuesta } from "../src/infra/llm/jev.ts";

/* ---------- reintento del generativo ---------- */

test("si la primera salida valida, no reintenta", async () => {
  let llamadas = 0;
  const r = await conReintento("prompt", async () => {
    llamadas++;
    return { ok: true };
  });
  assert.deepEqual(r, { value: { ok: true }, intentos: 1, fallos: [] });
  assert.equal(llamadas, 1);
});

test("si falla una vez, reintenta y devuelve el segundo resultado", async () => {
  let llamadas = 0;
  const r = await conReintento("prompt", async () => {
    llamadas++;
    if (llamadas === 1) throw new Error("campo faltante");
    return { ok: true };
  });
  assert.equal(r.intentos, 2);
  assert.equal(r.fallos[0]?.kind, "unknown");
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

test("si agota los tres intentos, aborta con el último motivo", async () => {
  let llamadas = 0;
  await assert.rejects(
    () =>
      conReintento("prompt", async () => {
        llamadas++;
        throw new Error("sigue mal");
      }),
    (e: Error) => {
      assert.match(e.message, /Falló tras 3 intento\(s\)/);
      assert.match(e.message, /sigue mal/);
      return true;
    }
  );
  assert.equal(llamadas, 3, "tres intentos, no dos");
});

test("un error de autenticación NO se reintenta", async () => {
  let llamadas = 0;
  await assert.rejects(
    () =>
      conReintento("prompt", async () => {
        llamadas++;
        const e = new Error("Unauthorized") as Error & { statusCode: number };
        e.statusCode = 401;
        throw e;
      }),
    /\[auth\]/
  );
  assert.equal(llamadas, 1, "reintentar un 401 es plata tirada");
});

test("un 429 sí se reintenta", async () => {
  let llamadas = 0;
  const r = await conReintento("prompt", async () => {
    llamadas++;
    if (llamadas === 1) {
      const e = new Error("rate limited") as Error & { statusCode: number };
      e.statusCode = 429;
      throw e;
    }
    return "ok";
  });
  assert.equal(r.value, "ok");
  assert.equal(llamadas, 2);
  assert.equal(r.fallos[0]?.kind, "rate_limit");
});

test("sabe cuál de los tres intentos se agotó", async () => {
  let llamadas = 0;
  const r = await conReintento("p", async () => {
    llamadas++;
    if (llamadas <= 2) throw new Error("boom");
    return 1;
  });
  assert.equal(r.intentos, 3);
  assert.equal(r.fallos.length, 2);
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

/* ---------- clasificación de fallos ---------- */

test("clasifica por tipo y decide si reintentar", () => {
  const maestro = (msg: string, status?: number) => {
    const e = new Error(msg) as Error & { statusCode?: number };
    if (status) e.statusCode = status;
    return e;
  };

  assert.deepEqual(clasificarError(maestro("x", 401)), { kind: "auth", retriable: false, status: 401 });
  assert.deepEqual(clasificarError(maestro("x", 403)), { kind: "auth", retriable: false, status: 403 });
  assert.deepEqual(clasificarError(maestro("x", 429)), { kind: "rate_limit", retriable: true, status: 429 });
  assert.deepEqual(clasificarError(maestro("x", 503)), { kind: "server", retriable: true, status: 503 });
  assert.equal(clasificarError(maestro("maximum context length exceeded")).kind, "budget");
  assert.equal(clasificarError(maestro("maximum context length exceeded")).retriable, false);
});

test("un fallo de esquema es reintentable y se reconoce por el mensaje", () => {
  const e = new Error("No object generated: response did not match schema");
  assert.deepEqual(clasificarError(e), { kind: "schema", retriable: true });
});

test("un error de red se reconoce por el código", () => {
  const e = new Error("fetch failed") as Error & { cause?: unknown };
  e.cause = Object.assign(new Error("read"), { code: "ECONNRESET" });
  assert.equal(clasificarError(e).kind, "network");
  assert.equal(clasificarError(e).retriable, true);
});
