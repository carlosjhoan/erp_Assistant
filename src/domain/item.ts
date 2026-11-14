/** Reglas de un ítem: transiciones, permisos y evidencia. Sin I/O. */

import type { ItemStatus, RubricStatus } from "./status.ts";
import { canTransitionItem } from "./status.ts";
import type { Actor } from "./permissions.ts";
import { isAllowed } from "./permissions.ts";
import {
  EvidenceRequiredError,
  ForbiddenActorError,
  InvalidTransitionError,
  RubricNotApprovedError,
} from "./errors.ts";

export interface EvidenceRef {
  readonly commit?: string;
  readonly pr?: string;
  readonly link?: string;
  readonly [key: string]: string | undefined;
}

export interface TransitionRequest {
  readonly actor: Actor;
  readonly from: ItemStatus;
  readonly to: ItemStatus;
  readonly rubricStatus: RubricStatus;
  readonly evidence?: readonly EvidenceRef[];
  readonly summary?: string;
}

/**
 * Valida una transición y lanza un error tipado si no procede.
 * No toca la base: la atomicidad la resuelve el servicio.
 */
export function assertItemTransition(request: TransitionRequest): void {
  const { actor, from, to, rubricStatus, evidence = [], summary } = request;

  if (rubricStatus !== "approved") throw new RubricNotApprovedError(rubricStatus);
  if (!canTransitionItem(from, to)) throw new InvalidTransitionError("item", from, to);
  if (!isAllowed(actor, from, to)) throw new ForbiddenActorError(actor, from, to);

  if (to === "ready_for_review") {
    const conEvidencia = evidence.filter((e) => Object.values(e).some((v) => Boolean(v && v.trim())));
    if (conEvidencia.length === 0 || !summary || !summary.trim()) throw new EvidenceRequiredError();
  }
}

/** ¿Se puede agregar una nota a un ítem de esta rúbrica? */
export function assertNoteAllowed(rubricStatus: RubricStatus): void {
  if (rubricStatus !== "approved") throw new RubricNotApprovedError(rubricStatus);
}
