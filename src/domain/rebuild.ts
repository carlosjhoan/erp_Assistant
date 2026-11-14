/**
 * El estado de un ítem es derivable de su log.
 * Esto existe para detectar drift: si la columna y el log no coinciden, algo
 * escribió fuera de la transacción.
 */

import type { ItemStatus } from "./status.ts";

export interface StoredEvent {
  readonly kind: string;
  readonly body: string;
  readonly createdAt: Date | number;
}

export interface StatusChangeEvent extends StoredEvent {
  readonly kind: "status_change";
}

const isStatusChange = (e: StoredEvent): e is StatusChangeEvent => e.kind === "status_change";

/**
 * Reconstruye el estado aplicando sólo los eventos de cambio, en orden.
 * Arranca en `pending`. Los eventos que no cambian estado se ignoran.
 */
export function statusFromEvents(events: readonly StoredEvent[], initial: ItemStatus = "pending"): ItemStatus {
  const ordenados = [...events].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));

  let current: ItemStatus = initial;
  for (const event of ordenados) {
    if (!isStatusChange(event)) continue;
    const next = event.body.trim() as ItemStatus;
    if (next) current = next;
  }
  return current;
}

/** Compara lo guardado contra lo reconstruido. */
export function detectDrift(
  stored: ItemStatus,
  events: readonly StoredEvent[]
): { drifted: boolean; expected: ItemStatus } {
  const expected = statusFromEvents(events);
  return { drifted: expected !== stored, expected };
}
