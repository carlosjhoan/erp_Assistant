/**
 * Eval del guardrail de alcance contra Jev real.
 * 24 casos etiquetados: dentro, fuera, ruido y mixtos.
 * Correr: node --env-file-if-exists=.env --import tsx scripts/eval-scope.ts
 */
import { decidirGuardrail, estadoGuardrail, PREGUNTAS_GUARDRAIL } from "../src/app/guardrail.ts";
import type { DecisionGuardrail } from "../src/app/guardrail.ts";
import { createJevProvider } from "../src/infra/llm/jev.ts";

function requerido(nombre: string): string {
  const v = process.env[nombre]?.trim();
  if (!v) {
    console.error(`Falta ${nombre} en .env`);
    process.exit(1);
  }
  return v;
}

const apiKey = requerido("TYPESAFE_API_KEY");
const baseURL = process.env.TYPESAFE_BASE_URL?.trim();
const jev = createJevProvider({
  apiKey,
  model: process.env.TYPESAFE_MODEL?.trim() || "jev-latest",
  ...(baseURL ? { baseURL } : {}),
});

type Tipo = "dentro" | "fuera" | "ruido" | "mixta";
interface Caso {
  id: number;
  tipo: Tipo;
  pregunta: string;
  esperado: DecisionGuardrail;
}

const CASOS: Caso[] = [
  { id: 1, tipo: "dentro", pregunta: "¿Cómo van los proyectos esta semana?", esperado: "agente" },
  { id: 2, tipo: "dentro", pregunta: "¿Qué me falta para cerrar la rúbrica?", esperado: "agente" },
  { id: 3, tipo: "dentro", pregunta: "¿Qué se habló en la reunión de landing sobre el deadline?", esperado: "agente" },
  { id: 4, tipo: "dentro", pregunta: "¿Qué tan sólido está Landing para producción?", esperado: "agente" },
  { id: 5, tipo: "dentro", pregunta: "¿Qué ítems están bloqueados?", esperado: "agente" },
  { id: 6, tipo: "dentro", pregunta: "¿Cuál es el estado del diagnóstico de Comercial?", esperado: "agente" },
  { id: 7, tipo: "dentro", pregunta: "Resumime la última reunión.", esperado: "agente" },
  { id: 8, tipo: "dentro", pregunta: "¿Qué proyectos tengo y cómo va cada uno?", esperado: "agente" },
  { id: 9, tipo: "dentro", pregunta: "¿Cuánto gasté hoy en el asistente?", esperado: "agente" },

  { id: 10, tipo: "fuera", pregunta: "¿Cuál es la capital de Francia?", esperado: "rechazar" },
  { id: 11, tipo: "fuera", pregunta: "Escribime un haiku sobre el mar.", esperado: "rechazar" },
  { id: 12, tipo: "fuera", pregunta: "¿Quién ganó el mundial de 2010?", esperado: "rechazar" },
  { id: 13, tipo: "fuera", pregunta: "¿Cuánto cuesta un kilo de pan?", esperado: "rechazar" },
  { id: 14, tipo: "fuera", pregunta: "Escribime un script en Python para ordenar una lista.", esperado: "rechazar" },
  { id: 15, tipo: "fuera", pregunta: "Dame el clima de mañana en Bogotá.", esperado: "rechazar" },
  { id: 16, tipo: "fuera", pregunta: "¿Qué acciones de Apple me conviene comprar?", esperado: "rechazar" },
  { id: 17, tipo: "fuera", pregunta: "Traducime 'buenos días' al inglés.", esperado: "rechazar" },

  { id: 18, tipo: "ruido", pregunta: "asdkjhasd", esperado: "rechazar" },
  { id: 19, tipo: "ruido", pregunta: "cvncncggch", esperado: "rechazar" },
  { id: 20, tipo: "ruido", pregunta: "!!!???", esperado: "rechazar" },
  { id: 21, tipo: "ruido", pregunta: "qwrtypsdfg", esperado: "rechazar" },

  {
    id: 22,
    tipo: "mixta",
    pregunta: "¿Cómo va el proyecto Landing? Y de paso escribime un poema sobre el mar.",
    esperado: "aclarar",
  },
  {
    id: 23,
    tipo: "mixta",
    pregunta: "¿Qué me falta esta semana y cuánto cuesta un kilo de pan?",
    esperado: "aclarar",
  },
  {
    id: 24,
    tipo: "mixta",
    pregunta: "Resumime la reunión y traducí el resumen al inglés.",
    esperado: "agente",
  },
];

const PRECIO_JEV_MTOK = 0.042;
const f = (n: number | undefined) => (n === undefined ? " ??" : n.toFixed(2).padStart(4));

let ok = 0;
let fail = 0;
let usd = 0;
let ms = 0;
const fallos: { caso: Caso; decision: string; motivo: string; scores: Record<string, number> }[] = [];

const porTipo: Record<Tipo, { ok: number; total: number }> = {
  dentro: { ok: 0, total: 0 },
  fuera: { ok: 0, total: 0 },
  ruido: { ok: 0, total: 0 },
  mixta: { ok: 0, total: 0 },
};

console.log(`\n=== EVAL GUARDRAIL (Jev) === ${CASOS.length} casos\n`);
console.log("id tipo    es   alc  tar  decision  pregunta");
console.log("-- ------ ---- ---- ----  --------  --------");

for (const c of CASOS) {
  porTipo[c.tipo].total++;
  try {
    const r = await jev.decide(estadoGuardrail(c.pregunta), PREGUNTAS_GUARDRAIL);
    const d = decidirGuardrail(r.scores);
    const bien = d.decision === c.esperado;
    ok += bien ? 1 : 0;
    fail += bien ? 0 : 1;
    if (bien) porTipo[c.tipo].ok++;
    usd += (r.tokens * PRECIO_JEV_MTOK) / 1_000_000;
    ms += r.durationMs;

    const s = r.scores;
    console.log(
      `${String(c.id).padStart(2)} ${c.tipo.padEnd(6)} ${f(s.es_consulta)} ${f(s.en_alcance)} ${f(s.tarea_ajena)}  ${d.decision.padEnd(8)}  ${c.pregunta}`
    );
    if (!bien) fallos.push({ caso: c, decision: d.decision, motivo: d.motivo, scores: s });
  } catch (e) {
    fail++;
    console.log(`${String(c.id).padStart(2)} ${c.tipo.padEnd(6)}  ERROR: ${e instanceof Error ? e.message : String(e)}`);
  }
}

console.log(`\nok=${ok} fail=${fail} accuracy=${((ok / CASOS.length) * 100).toFixed(1)}%`);
for (const t of ["dentro", "fuera", "ruido", "mixta"] as Tipo[]) {
  const p = porTipo[t];
  console.log(`  ${t.padEnd(6)} ${p.ok}/${p.total}`);
}

const falsosNegativos = fallos.filter((x) => x.caso.tipo === "dentro");
const falsosPositivos = fallos.filter(
  (x) => (x.caso.tipo === "fuera" || x.caso.tipo === "ruido") && x.decision === "agente"
);
console.log(`  falsos negativos (bloqueó algo válido): ${falsosNegativos.length}`);
console.log(`  falsos positivos (dejó pasar algo ajeno): ${falsosPositivos.length}`);

if (fallos.length) {
  console.log("\ndetalle de fallos:");
  for (const x of fallos) {
    console.log(
      `  #${x.caso.id} ${x.caso.tipo}: esperado=${x.caso.esperado} obtenido=${x.decision} (${x.motivo}) scores=${JSON.stringify(x.scores)}`
    );
  }
}

console.log(
  `\ncosto Jev ≈ $${usd.toFixed(6)} · latencia total ${ms} ms · promedio ${Math.round(ms / CASOS.length)} ms\n`
);

process.exitCode = falsosNegativos.length > 0 ? 1 : 0;
