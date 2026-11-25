/**
 * Enmascara nombres de personas en la respuesta del modelo.
 * Se aplica en la frontera (respuesta al cliente), no en la traza: el modelo
 * necesita los nombres para razonar, el humano no necesita verlos.
 */

import type { Db } from "../infra/db/client.ts";
import { meeting } from "../infra/db/schema.ts";

const TOKENS = ["Persona_#%&", "Persona_%&#", "Persona_&#%"] as const;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Nombres que aparecen como participantes, sin duplicados y sin los muy cortos. */
export function nombresConocidos(db: Db): string[] {
  const nombres = new Set<string>();
  for (const m of db.select({ participants: meeting.participants }).from(meeting).all()) {
    for (const n of m.participants ?? []) {
      const limpio = n.trim();
      if (limpio.length >= 3) nombres.add(limpio);
    }
  }
  return [...nombres];
}

/**
 * Reemplaza cada nombre presente por un patrón estable.
 * Un token por persona; si no aparece, no consume token.
 */
export function anonimizar(texto: string, nombres: string[]): string {
  if (!texto || nombres.length === 0) return texto;

  let salida = texto;
  let i = 0;

  // El más largo primero: "Ana María" antes que "Ana". No depende del orden recibido.
  for (const nombre of [...nombres].sort((a, b) => b.length - a.length)) {
    const re = new RegExp(escape(nombre), "gi");
    const token = TOKENS[i] ?? `Persona_#%&${i + 1}`;
    const antes = salida;
    salida = salida.replace(re, token);
    if (salida !== antes) i++;
  }

  return salida;
}
