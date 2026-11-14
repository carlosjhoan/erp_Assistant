/** Quién puede hacer qué. Se hace cumplir acá, no en la interfaz. */

import type { ItemStatus } from "./status.ts";
import { ITEM_STATUSES } from "./status.ts";

export const ACTORS = ["human", "opencode", "agent"] as const;
export type Actor = (typeof ACTORS)[number];

/**
 * El agente sólo puede empujar el trabajo hacia adelante y bloquear.
 * Aprobar (`ready_for_review → done`), devolver o descartar es del humano.
 */
const AGENT_ALLOWED: Record<ItemStatus, readonly ItemStatus[]> = {
  pending: ["in_progress", "blocked"],
  in_progress: ["ready_for_review", "blocked"],
  ready_for_review: [],
  done: [],
  blocked: [],
  dropped: [],
};

const isHuman = (actor: Actor) => actor === "human";

/** Un bloqueo lo puede declarar cualquiera: significa "no puedo seguir". */
const canBlock = (to: ItemStatus) => to === "blocked";

export function isAllowed(actor: Actor, from: ItemStatus, to: ItemStatus): boolean {
  if (isHuman(actor)) return true; // el humano puede todo lo que la máquina permita
  if (canBlock(to)) return true;
  return AGENT_ALLOWED[from].includes(to);
}

export const actorCanApprove = (actor: Actor): boolean => isHuman(actor);

export const isValidStatus = (value: string): value is ItemStatus =>
  (ITEM_STATUSES as readonly string[]).includes(value);
