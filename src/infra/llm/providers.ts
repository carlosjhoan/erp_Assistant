import { createDeepSeekProvider } from "./deepseek.ts";
import { createJevProvider } from "./jev.ts";
import { LlmError, type DecisionProvider, type LlmProvider } from "./types.ts";

export interface Providers {
  llm: LlmProvider;
  decision: DecisionProvider;
}

function requerido(nombre: string): string {
  const valor = process.env[nombre]?.trim();
  if (!valor) throw new LlmError(`Falta ${nombre} en .env. Sin eso no se puede llamar a los modelos.`);
  return valor;
}

/** Arma los proveedores desde el entorno. Un solo lugar que lee claves. */
export function providersFromEnv(): Providers {
  return {
    llm: createDeepSeekProvider({
      apiKey: requerido("DEEPSEEK_API_KEY"),
      model: process.env.DEEPSEEK_MODEL?.trim() || "deepseek-flash",
      ...(process.env.DEEPSEEK_BASE_URL ? { baseURL: process.env.DEEPSEEK_BASE_URL } : {}),
      thinking: process.env.DEEPSEEK_THINKING === "enabled" ? "enabled" : "disabled",
    }),
    decision: createJevProvider({
      apiKey: requerido("TYPESAFE_API_KEY"),
      model: process.env.TYPESAFE_MODEL?.trim() || "jev-latest",
      ...(process.env.TYPESAFE_BASE_URL ? { baseURL: process.env.TYPESAFE_BASE_URL } : {}),
    }),
  };
}
