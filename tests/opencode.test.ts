import test from "node:test";
import assert from "node:assert/strict";
import { extraerJson, JsonNoEncontrado, primerObjeto } from "../src/infra/opencode/json.ts";
import { compararSnapshots, snapshot } from "../src/infra/opencode/git-guard.ts";
import { resolverAgente, type OpenCodeConfig } from "../src/infra/opencode/worker.ts";
import { OpenCodeError } from "../src/infra/opencode/types.ts";

/* ---------- extracción de JSON ---------- */

test("toma el JSON de un bloque cercado", () => {
  const texto = 'Listo, acá va:\n```json\n{"needed":true,"steps":[]}\n```\nCualquier cosa avisame.';
  assert.deepEqual(extraerJson(texto), { needed: true, steps: [] });
});

test("toma el JSON aunque el bloque no diga json", () => {
  const texto = "```\n{\"a\":1}\n```";
  assert.deepEqual(extraerJson(texto), { a: 1 });
});

test("si no hay bloque, busca el primer objeto balanceado", () => {
  const texto = 'Mi análisis: {"needed":false,"reason":"no aplica"} eso es todo.';
  assert.deepEqual(extraerJson(texto), { needed: false, reason: "no aplica" });
});

test("no se confunde con llaves dentro de strings", () => {
  const texto = '{"reason":"usa { y } en el texto","ok":true}';
  assert.deepEqual(extraerJson(texto), { reason: "usa { y } en el texto", ok: true });
});

test("soporta llaves escapadas", () => {
  const texto = '{"reason":"dijo \\"no toques\\" y listo"}';
  assert.equal((extraerJson<{ reason: string }>(texto)).reason, 'dijo "no toques" y listo');
});

test("sin JSON falla con nombre propio", () => {
  assert.throws(() => extraerJson("no hay nada acá"), JsonNoEncontrado);
});

test("un JSON mal formado falla", () => {
  assert.throws(() => extraerJson('{"a": }'), JsonNoEncontrado);
});

test("primerObjeto devuelve undefined si no hay llaves", () => {
  assert.equal(primerObjeto("texto plano"), undefined);
});

/* ---------- guardia de git ---------- */

test("sin cambios, el snapshot es igual", () => {
  const a = { head: "abc", archivos: [], sinGit: false };
  const b = { head: "abc", archivos: [], sinGit: false };
  assert.deepEqual(compararSnapshots(a, b), { headCambio: false, archivos: [] });
});

test("detecta un archivo nuevo", () => {
  const a = { head: "abc", archivos: [], sinGit: false };
  const b = { head: "abc", archivos: ["?? nuevo.txt"], sinGit: false };
  assert.deepEqual(compararSnapshots(a, b), { headCambio: false, archivos: ["?? nuevo.txt"] });
});

test("detecta un archivo que desapareció", () => {
  const a = { head: "abc", archivos: [" M viejo.txt"], sinGit: false };
  const b = { head: "abc", archivos: [], sinGit: false };
  assert.deepEqual(compararSnapshots(a, b).archivos, [" M viejo.txt"]);
});

test("detecta un commit nuevo", () => {
  const a = { head: "abc", archivos: [], sinGit: false };
  const b = { head: "def", archivos: [], sinGit: false };
  assert.equal(compararSnapshots(a, b).headCambio, true);
});

test("en una carpeta sin git no se reporta contaminación", () => {
  const a = { head: null, archivos: [], sinGit: true };
  const b = { head: null, archivos: [], sinGit: true };
  assert.deepEqual(compararSnapshots(a, b), { headCambio: false, archivos: [] });
});

test("snapshot de un repo real devuelve HEAD", () => {
  const s = snapshot(".");
  assert.equal(s.sinGit, false);
  assert.match(s.head ?? "", /^[0-9a-f]{7,40}$/);
});

test("snapshot de una ruta inexistente se marca sinGit", () => {
  assert.equal(snapshot("D:/ruta/que/no/existe").sinGit, true);
});

/* ---------- resolución de agente ---------- */

const CFG: OpenCodeConfig = {
  baseUrl: "http://127.0.0.1:4096",
  provider: "opencode-go",
  model: "deepseek-v4.1-flash",
  agentExplore: "explore",
  agentEdit: "build",
  timeoutMs: 1000,
};

test("explore usa el agente de solo lectura", () => {
  assert.equal(resolverAgente(CFG, "explore"), "explore");
});

test("edit usa el agente de escritura", () => {
  assert.equal(resolverAgente(CFG, "edit"), "build");
});

test("si los dos agentes son el mismo, explore se rechaza", () => {
  assert.throws(() => resolverAgente({ ...CFG, agentEdit: "explore" }, "explore"), OpenCodeError);
});

test("sin agente de explore configurado, se rechaza", () => {
  assert.throws(() => resolverAgente({ ...CFG, agentExplore: "" }, "explore"), /OPENCODE_AGENT_TO_EXPLORE/);
});

test("sin agente de edición configurado, se rechaza", () => {
  assert.throws(() => resolverAgente({ ...CFG, agentEdit: "  " }, "edit"), /OPENCODE_AGENT_TO_EDIT/);
});
