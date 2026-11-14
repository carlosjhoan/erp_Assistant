import test from "node:test";
import assert from "node:assert/strict";

import { canTransitionItem, canTransitionRubric, nextItemStatuses } from "../src/domain/status.ts";
import { isAllowed, actorCanApprove } from "../src/domain/permissions.ts";
import { assertItemTransition } from "../src/domain/item.ts";
import { statusFromEvents, detectDrift } from "../src/domain/rebuild.ts";
import {
  DomainError,
  EvidenceRequiredError,
  ForbiddenActorError,
  InvalidTransitionError,
  RubricNotApprovedError,
} from "../src/domain/errors.ts";

const aprobada = "approved" as const;

/* ---------- máquina de estados de la rúbrica ---------- */

test("la rúbrica avanza draft → in_review → approved → closed", () => {
  assert.equal(canTransitionRubric("draft", "in_review"), true);
  assert.equal(canTransitionRubric("in_review", "approved"), true);
  assert.equal(canTransitionRubric("approved", "closed"), true);
});

test("una rúbrica aprobada no vuelve atrás", () => {
  assert.equal(canTransitionRubric("approved", "draft"), false);
  assert.equal(canTransitionRubric("approved", "in_review"), false);
});

test("de in_review se puede volver a borrador", () => {
  assert.equal(canTransitionRubric("in_review", "draft"), true);
});

test("cerrada es terminal", () => {
  assert.deepEqual(nextItemStatuses("closed" as never) ?? [], []);
  assert.equal(canTransitionRubric("closed", "draft"), false);
});

/* ---------- máquina de estados del ítem ---------- */

test("el ítem avanza pending → in_progress → ready_for_review → done", () => {
  assert.equal(canTransitionItem("pending", "in_progress"), true);
  assert.equal(canTransitionItem("in_progress", "ready_for_review"), true);
  assert.equal(canTransitionItem("ready_for_review", "done"), true);
});

test("done y dropped son terminales", () => {
  assert.deepEqual(nextItemStatuses("done"), []);
  assert.deepEqual(nextItemStatuses("dropped"), []);
});

test("no se salta de pending a done", () => {
  assert.equal(canTransitionItem("pending", "done"), false);
});

/* ---------- permisos por actor ---------- */

test("el agente no aprueba su propio trabajo", () => {
  assert.equal(isAllowed("opencode", "ready_for_review", "done"), false);
  assert.equal(isAllowed("human", "ready_for_review", "done"), true);
  assert.equal(actorCanApprove("opencode"), false);
  assert.equal(actorCanApprove("agent"), false);
});

test("el agente no devuelve ni descarta", () => {
  assert.equal(isAllowed("opencode", "ready_for_review", "in_progress"), false);
  assert.equal(isAllowed("opencode", "pending", "dropped"), false);
});

test("cualquiera puede bloquear", () => {
  assert.equal(isAllowed("opencode", "in_progress", "blocked"), true);
  assert.equal(isAllowed("agent", "pending", "blocked"), true);
});

/* ---------- validación completa ---------- */

test("ready_for_review exige evidencia y resumen", () => {
  assert.throws(
    () =>
      assertItemTransition({
        actor: "opencode",
        from: "in_progress",
        to: "ready_for_review",
        rubricStatus: aprobada,
      }),
    (e: unknown) => e instanceof EvidenceRequiredError && e.code === "evidence_required"
  );

  assert.throws(
    () =>
      assertItemTransition({
        actor: "opencode",
        from: "in_progress",
        to: "ready_for_review",
        rubricStatus: aprobada,
        evidence: [{ commit: "abc123" }],
      }),
    EvidenceRequiredError
  );

  assert.doesNotThrow(() =>
    assertItemTransition({
      actor: "opencode",
      from: "in_progress",
      to: "ready_for_review",
      rubricStatus: aprobada,
      evidence: [{ commit: "abc123" }],
      summary: "Listo para revisar",
    })
  );
});

test("una evidencia vacía no cuenta", () => {
  assert.throws(
    () =>
      assertItemTransition({
        actor: "opencode",
        from: "in_progress",
        to: "ready_for_review",
        rubricStatus: aprobada,
        evidence: [{ commit: "   " }],
        summary: "algo",
      }),
    EvidenceRequiredError
  );
});

test("no se opera sobre una rúbrica sin aprobar", () => {
  assert.throws(
    () =>
      assertItemTransition({
        actor: "human",
        from: "pending",
        to: "in_progress",
        rubricStatus: "draft",
      }),
    RubricNotApprovedError
  );
});

test("un actor prohibido falla con código", () => {
  assert.throws(
    () =>
      assertItemTransition({
        actor: "opencode",
        from: "ready_for_review",
        to: "done",
        rubricStatus: aprobada,
      }),
    (e: unknown) => e instanceof ForbiddenActorError && e.code === "forbidden_actor"
  );
});

test("una transición imposible falla con código", () => {
  assert.throws(
    () =>
      assertItemTransition({
        actor: "human",
        from: "pending",
        to: "done",
        rubricStatus: aprobada,
      }),
    (e: unknown) => e instanceof InvalidTransitionError
  );
});

test("todos los errores de dominio comparten base", () => {
  const error = new EvidenceRequiredError();
  assert.ok(error instanceof DomainError);
  assert.equal(error.name, "EvidenceRequiredError");
});

/* ---------- reconstrucción desde el log ---------- */

const evento = (kind: string, body: string, min: number) => ({
  kind,
  body,
  createdAt: new Date(`2026-11-13T10:${String(min).padStart(2, "0")}:00Z`),
});

test("el estado se reconstruye del log", () => {
  const eventos = [
    evento("plan", "voy a revisar", 0),
    evento("status_change", "in_progress", 5),
    evento("progress", "a medias", 10),
    evento("status_change", "ready_for_review", 15),
  ];
  assert.equal(statusFromEvents(eventos), "ready_for_review");
});

test("los eventos que no cambian estado se ignoran", () => {
  const eventos = [evento("note", "Juan dijo algo", 1), evento("evidence", "commit", 2)];
  assert.equal(statusFromEvents(eventos), "pending");
});

test("el orden se respeta por fecha, no por llegada", () => {
  const eventos = [evento("status_change", "in_progress", 20), evento("status_change", "pending", 5)];
  assert.equal(statusFromEvents(eventos), "in_progress");
});

test("se detecta el drift entre columna y log", () => {
  const eventos = [evento("status_change", "in_progress", 1)];
  assert.deepEqual(detectDrift("pending", eventos), { drifted: true, expected: "in_progress" });
  assert.deepEqual(detectDrift("in_progress", eventos), { drifted: false, expected: "in_progress" });
});
