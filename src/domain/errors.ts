/** Errores de dominio: tipados, con código, nunca silenciosos. */

export type DomainErrorCode =
  | "invalid_transition"
  | "forbidden_actor"
  | "evidence_required"
  | "rubric_not_approved"
  | "immutable_rubric";

export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}

export class InvalidTransitionError extends DomainError {
  constructor(
    readonly entity: "rubric" | "item",
    readonly from: string,
    readonly to: string
  ) {
    super("invalid_transition", `Un ${entity} no puede pasar de "${from}" a "${to}"`);
    this.name = "InvalidTransitionError";
  }
}

export class ForbiddenActorError extends DomainError {
  constructor(
    readonly actor: string,
    readonly from: string,
    readonly to: string
  ) {
    super("forbidden_actor", `El actor "${actor}" no puede mover un ítem de "${from}" a "${to}"`);
    this.name = "ForbiddenActorError";
  }
}

export class EvidenceRequiredError extends DomainError {
  constructor() {
    super("evidence_required", "Para pasar a revisión hace falta al menos una evidencia y un resumen");
    this.name = "EvidenceRequiredError";
  }
}

export class RubricNotApprovedError extends DomainError {
  constructor(readonly rubricStatus: string) {
    super("rubric_not_approved", `Sólo se opera sobre rúbricas aprobadas; esta está en "${rubricStatus}"`);
    this.name = "RubricNotApprovedError";
  }
}

export class ImmutableRubricError extends DomainError {
  constructor(readonly rubricId: string) {
    super("immutable_rubric", `La rúbrica "${rubricId}" está aprobada: se cambia creando una versión nueva`);
    this.name = "ImmutableRubricError";
  }
}
