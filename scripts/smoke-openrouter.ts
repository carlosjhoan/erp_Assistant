/**
 * Smoke del adaptador OpenRouter contra la API real.
 * Correr: npm run smoke:openrouter
 */
import { z } from "zod";
import { createOpenRouterProvider } from "../src/infra/llm/openrouter.ts";
import type { ToolParaAgente } from "../src/infra/llm/types.ts";

const apiKey = process.env.OPENROUTER_API_KEY?.trim();
if (!apiKey) {
  console.error("Falta OPENROUTER_API_KEY en .env");
  process.exit(1);
}

const sortEnv = process.env.OPENROUTER_SORT?.trim();
const sort = sortEnv === "throughput" || sortEnv === "latency" ? sortEnv : "price";
const reasonEnv = process.env.OPENROUTER_REASONING?.trim();
const reasoning = reasonEnv === "low" || reasonEnv === "high" ? reasonEnv : "none";

const llm = createOpenRouterProvider({
  apiKey,
  model: process.env.OPENROUTER_MODEL?.trim() || "deepseek/deepseek-v4.1-flash",
  sort,
  reasoning,
  appName: "my_erp-smoke",
  trace: (c) => {
    console.log(`  trace ${c.provider} ${c.status} ${c.model ?? ""} usd=${c.costUsd ?? "?"}`);
  },
});

const verSemana: ToolParaAgente = {
  name: "ver_semana",
  description: "Devuelve la rúbrica de la semana en curso con sus ítems.",
  input: z.strictObject({ cual: z.enum(["actual", "proxima"]).optional() }),
  execute(input) {
    const { cual } = input as { cual?: "actual" | "proxima" };
    return { id: "sem-1", cual: cual ?? "actual", total: 3, hechos: 1, items: ["a", "b", "c"] };
  },
};

async function main() {
  console.log("\n=== GENERATE (structured) ===");
  const g = await llm.generate({
    kind: "compose",
    schemaName: "Respuesta",
    system: "Devolvés un objeto JSON válido y nada más.",
    prompt: "Devolvé respuesta='ok' y confianza=0.9",
    schema: z.object({ respuesta: z.string(), confianza: z.number() }),
  });
  console.log("data:", JSON.stringify(g.data), "tokens:", g.tokens, "intentos:", g.intentos);

  console.log("\n=== AGENT (tools) ===");
  const a = await llm.agent({
    system: "Sos el asistente de un ERP. Usá las tools. Respondé en español, breve.",
    messages: [{ role: "user", content: "¿Qué me falta esta semana?" }],
    tools: [verSemana],
    maxSteps: 3,
    topeUsd: 0.05,
  });
  console.log("text:", a.text.replace(/\s+/g, " "));
  console.log("steps:", a.steps, "tools:", a.pasos.map((p) => p.tool).join(",") || "(ninguna)");
  console.log("tokens:", a.tokens, "usd:", a.usd, "truncado:", a.truncado, "modelo:", a.modelo);
}

main().catch((e) => {
  console.error("ERROR:", e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
