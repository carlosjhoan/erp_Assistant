/**
 * Esquema de la base. Una sola fuente de verdad para las tablas.
 *
 * Regla del proyecto: `item_event` es append-only. Nunca se actualiza ni se
 * borra una fila; corregir algo es agregar otra fila.
 */

import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real, index, uniqueIndex, primaryKey, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";

// Por defecto, el reloj de la base: asi un insert sin fecha no rompe.
const now = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`);

/* ---------- reuniones ---------- */

export const meeting = sqliteTable(
  "meeting",
  {
    id: text("id").primaryKey(),
    source: text("source", { enum: ["granola", "manual"] }).notNull(),
    externalId: text("external_id").notNull(),
    title: text("title").notNull(),
    occurredAt: integer("occurred_at", { mode: "timestamp_ms" }).notNull(),
    participants: text("participants", { mode: "json" }).$type<string[]>().notNull().default([]),

    // Identidad estable = externalId. Cuando la nota cambia (Granola regenera el
    // summary), cambia el hash y la fila se actualiza en vez de duplicarse.
    contentHash: text("content_hash").notNull(),

    // Los tres bloques que entrega Granola, guardados por separado.
    summary: text("summary"),
    privateNotes: text("private_notes"),
    transcript: text("transcript"),
    summaryAvailable: integer("summary_available", { mode: "boolean" }).notNull().default(false),
    privateNotesAvailable: integer("private_notes_available", { mode: "boolean" }).notNull().default(false),
    transcriptAvailable: integer("transcript_available", { mode: "boolean" }).notNull().default(false),

    /**
     * Como va la reunion: importada, con temas extraidos, o con el triaje cerrado.
     * Se deriva de los temas, salvo imported que es el estado inicial.
     */
    status: text("status", { enum: ["imported", "topics_extracted", "triaged"] })
      .notNull()
      .default("imported"),
    /** Proyecto por defecto de la reunion; los temas pueden cambiarlo. */
    projectId: text("project_id").references(() => project.id),

    importedAt: now(),
  },
  (t) => [uniqueIndex("meeting_source_external").on(t.source, t.externalId), index("meeting_occurred").on(t.occurredAt)]
);

/* ---------- rúbricas ---------- */

export const rubric = sqliteTable(
  "rubric",
  {
    id: text("id").primaryKey(),
    weekStart: text("week_start").notNull(), // YYYY-MM-DD, ancla de la versión
    // Fecha previsible de entrega. A diferencia de weekStart, esta sí se ajusta.
    deadline: text("deadline"), // YYYY-MM-DD
    version: integer("version").notNull().default(1),
    status: text("status", { enum: ["draft", "in_review", "approved", "closed"] }).notNull().default("draft"),
    approvedAt: integer("approved_at", { mode: "timestamp_ms" }),
    approvedBy: text("approved_by"),
    parentRubricId: text("parent_rubric_id").references((): AnySQLiteColumn => rubric.id),
    createdAt: now(),
  },
  (t) => [uniqueIndex("rubric_week_version").on(t.weekStart, t.version), index("rubric_week_status").on(t.weekStart, t.status)]
);

export const rubricSourceMeeting = sqliteTable(
  "rubric_source_meeting",
  {
    rubricId: text("rubric_id")
      .notNull()
      .references(() => rubric.id),
    meetingId: text("meeting_id")
      .notNull()
      .references(() => meeting.id),
  },
  (t) => [primaryKey({ columns: [t.rubricId, t.meetingId] })]
);

/* ---------- temas (candidatos a alcance de la semana) ---------- */

/**
 * Un tema sale de un apunte y espera el triaje humano. Solo lo que se marca
 * `selected` entra a una rúbrica y se desglosa en ítems. Un tema manual puede
 * no tener reunión ni cita.
 */
export const topic = sqliteTable(
  "topic",
  {
    id: text("id").primaryKey(),
    meetingId: text("meeting_id").references(() => meeting.id),
    title: text("title").notNull(),
    description: text("description"),
    sourceExcerpt: text("source_excerpt"),
    // Sugerencia del agente: alcance probable o contexto de idea.
    scopeSignal: text("scope_signal", { enum: ["likely_scope", "idea_context"] }),
    scopeReason: text("scope_reason"),
    openQuestions: text("open_questions", { mode: "json" }).$type<string[]>(),
    /** Proyecto al que pertenece el tema. Obligatorio para poder seleccionarlo. */
    projectId: text("project_id").references(() => project.id),

    /** Lo que agregás vos para que el desglose no adivine. */
    context: text("context"),
    /** De dónde salió el contexto: escrito o dictado. */
    contextSource: text("context_source", { enum: ["text", "voice"] }),

    // A quién le corresponde: a mí (entregable) o a un repo (cambio de código).
    owner: text("owner", { enum: ["me", "opencode"] }),
    ownerScore: real("owner_score"),
    ownerDetail: text("owner_detail", { mode: "json" }).$type<Record<string, number> | null>(),

    // Veredicto de Jev sobre si la reunión trató realmente este tema.
    // Se guarda para poder medir su confiabilidad después.
    verifyScore: real("verify_score"),
    needsReview: integer("needs_review", { mode: "boolean" }).notNull().default(false),
    status: text("status", { enum: ["proposed", "selected", "parked", "discarded"] })
      .notNull()
      .default("proposed"),
    origin: text("origin", { enum: ["agent", "manual"] }).notNull(),
    rubricId: text("rubric_id").references(() => rubric.id),
    mergedIntoTopicId: text("merged_into_topic_id").references((): AnySQLiteColumn => topic.id),
    decidedAt: integer("decided_at", { mode: "timestamp_ms" }),
    decidedBy: text("decided_by"),
    createdAt: now(),
  },
  (t) => [index("topic_status").on(t.status), index("topic_rubric").on(t.rubricId), index("topic_meeting").on(t.meetingId)]
);

export const rubricItem = sqliteTable(
  "rubric_item",
  {
    id: text("id").primaryKey(),
    rubricId: text("rubric_id")
      .notNull()
      .references(() => rubric.id),
    // Tema del que sale el ítem. Nulo cuando el ítem se crea a mano sin tema.
    topicId: text("topic_id").references((): AnySQLiteColumn => topic.id),
    // Repo al que pertenece el ítem cuando lo propuso OpenCode.
    repoId: text("repo_id").references(() => repo.id),
    // Si lo editaste vos, regenerar los ítems del agente no lo puede pisar.
    humanEdited: integer("human_edited", { mode: "boolean" }).notNull().default(false),
    title: text("title").notNull(),
    description: text("description"),
    acceptanceCriteria: text("acceptance_criteria").notNull(),
    type: text("type", { enum: ["code", "contact", "research", "other"] }).notNull(),
    status: text("status", {
      enum: ["pending", "in_progress", "ready_for_review", "done", "blocked", "dropped"],
    })
      .notNull()
      .default("pending"),
    dueDate: text("due_date"),
    origin: text("origin", { enum: ["agent", "manual"] }).notNull(),
    sourceMeetingId: text("source_meeting_id").references(() => meeting.id),
    sourceExcerpt: text("source_excerpt"),
    carriedFromItemId: text("carried_from_item_id"),
    position: integer("position").notNull().default(0),

    // Veredicto de Jev: se guarda para poder medir su confiabilidad después.
    verifyStatus: text("verify_status", { enum: ["pending", "verified", "needs_review"] })
      .notNull()
      .default("pending"),
    verifyScore: real("verify_score"),
    verifyDetail: text("verify_detail", { mode: "json" }).$type<Record<string, number> | null>(),

    createdAt: now(),
  },
  (t) => [
    index("item_rubric_type_status").on(t.rubricId, t.type, t.status),
    index("item_status").on(t.status),
  ]
);

/* ---------- log append-only ---------- */

export const itemEvent = sqliteTable(
  "item_event",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id")
      .notNull()
      .references(() => rubricItem.id),
    actorType: text("actor_type", { enum: ["human", "opencode", "agent"] }).notNull(),
    actorId: text("actor_id"),
    kind: text("kind", {
      enum: ["plan", "progress", "evidence", "feedback", "note", "status_change", "verification"],
    }).notNull(),
    body: text("body").notNull(),
    // Sólo en las notas: de quién se tomó la información.
    sourcePerson: text("source_person"),
    evidenceRefs: text("evidence_refs", { mode: "json" }).$type<Record<string, string> | null>(),
    createdAt: now(),
  },
  (t) => [
    index("event_item_created").on(t.itemId, t.createdAt),
    index("event_person").on(t.sourcePerson),
  ]
);

/* ---------- reportes ---------- */

export const report = sqliteTable("report", {
  id: text("id").primaryKey(),
  template: text("template", { enum: ["weekly_progress", "by_type", "carry_over"] }).notNull(),
  params: text("params", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  contentMd: text("content_md").notNull(),
  dataSnapshot: text("data_snapshot", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  status: text("status", { enum: ["draft", "approved", "sent"] }).notNull().default("draft"),
  createdAt: now(),
});

export const recipient = sqliteTable("recipient", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  role: text("role"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const reportDelivery = sqliteTable(
  "report_delivery",
  {
    id: text("id").primaryKey(),
    reportId: text("report_id")
      .notNull()
      .references(() => report.id),
    recipientId: text("recipient_id")
      .notNull()
      .references(() => recipient.id),
    status: text("status", { enum: ["pending", "sent", "failed"] }).notNull().default("pending"),
    sentAt: integer("sent_at", { mode: "timestamp_ms" }),
    error: text("error"),
  },
  (t) => [index("delivery_report").on(t.reportId)]
);

/* ---------- costo de cada llamada al modelo ---------- */

export const agentRun = sqliteTable(
  "agent_run",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: ["interpret", "compose", "verify", "summary"] }).notNull(),
    tool: text("tool").notNull(),
    inputHash: text("input_hash"),
    outputRef: text("output_ref"),
    tokens: integer("tokens"),
    cost: real("cost"),
    durationMs: integer("duration_ms"),
    // Trazabilidad de fallos: cuantos intentos, si termino bien y por que no.
    attempts: integer("attempts"),
    outcome: text("outcome", { enum: ["ok", "failed"] }),
    errorKind: text("error_kind"),
    errorDetail: text("error_detail"),
    createdAt: now(),
  },
  (t) => [index("run_created").on(t.createdAt)]
);

/* ---------- trazas por llamada ---------- */

/**
 * Una fila por cada llamada HTTP a un modelo, sea generativo o de decisión.
 * Guarda el prompt y la respuesta para poder reconstruir qué pasó sin adivinar.
 */
export const llmCall = sqliteTable(
  "llm_call",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => agentRun.id),
    provider: text("provider", { enum: ["deepseek", "jev"] }).notNull(),
    model: text("model"),
    attempt: integer("attempt").notNull().default(1),
    status: text("status", { enum: ["ok", "failed"] }).notNull(),
    errorKind: text("error_kind"),
    errorDetail: text("error_detail"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    durationMs: integer("duration_ms"),
    prompt: text("prompt"),
    response: text("response"),
    createdAt: now(),
  },
  (t) => [index("call_run").on(t.runId), index("call_created").on(t.createdAt)]
);

/* ---------- proyectos y repos ---------- */

/**
 * Un proyecto agrupa varios repos. Un repo es la unidad de codigo a la que se
 * le manda un alcance; no requiere ser un repo git, alcanza con una carpeta.
 */
export const project = sqliteTable("project", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  /** Que es este proyecto y de que se ocupa. */
  description: text("description"),
  path: text("path").notNull(),
  status: text("status", { enum: ["active", "paused", "done"] }).notNull().default("active"),
  createdAt: now(),
});

export const repo = sqliteTable(
  "repo",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id),
    name: text("name").notNull(),
    path: text("path").notNull(),
    /** Que es y para que sirve. Es lo que usa la deteccion para elegir repos. */
    description: text("description"),
    keywords: text("keywords", { mode: "json" }).$type<string[]>().notNull().default([]),
    /** Superficies que ofrece a otros repos. */
    exposes: text("exposes", { mode: "json" }).$type<string[]>().notNull().default([]),
    /** Repos de los que depende. */
    consumes: text("consumes", { mode: "json" }).$type<string[]>().notNull().default([]),
    /** Sesion de OpenCode reusada para este repo. Se descarta si se cuelga. */
    opencodeSessionId: text("opencode_session_id"),
    createdAt: now(),
  },
  (t) => [uniqueIndex("repo_project_name").on(t.projectId, t.name), index("repo_project").on(t.projectId)]
);

/* ---------- propuestas de los repos ---------- */

export interface PasoPropuestoJson {
  title: string;
  description?: string | undefined;
  acceptanceCriteria: string;
  surfaces: string[];
}

/**
 * Lo que cada repo respondió sobre un tema. Es la instancia de aprobación:
 * acá queda la propuesta completa y recién al aprobar se materializa en
 * `rubric_item`.
 */
export const topicRepo = sqliteTable(
  "topic_repo",
  {
    id: text("id").primaryKey(),
    topicId: text("topic_id")
      .notNull()
      .references(() => topic.id),
    repoId: text("repo_id")
      .notNull()
      .references(() => repo.id),
    papel: text("papel", { enum: ["principal", "dependiente"] }).notNull(),
    status: text("status", { enum: ["pendiente", "involucrado", "excluido", "fallido"] })
      .notNull()
      .default("pendiente"),
    reason: text("reason"),
    approach: text("approach"),
    surfaces: text("surfaces", { mode: "json" }).$type<string[]>().notNull().default([]),
    steps: text("steps", { mode: "json" }).$type<PasoPropuestoJson[]>().notNull().default([]),
    risks: text("risks", { mode: "json" }).$type<string[]>().notNull().default([]),
    sessionId: text("session_id"),
    model: text("model"),
    tokens: integer("tokens"),
    durationMs: integer("duration_ms"),
    contaminated: integer("contaminated", { mode: "boolean" }).notNull().default(false),
    error: text("error"),
    approvedAt: integer("approved_at", { mode: "timestamp_ms" }),
    evaluatedAt: integer("evaluated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  },
  (t) => [uniqueIndex("topic_repo_unique").on(t.topicId, t.repoId), index("topic_repo_status").on(t.status)]
);

/**
 * Un repo puede servir a varios proyectos. Es la relacion real: dos carpetas
 * distintas comparten raiz, y un repo puede entrar en dos frentes comerciales.
 */
export const projectRepository = sqliteTable(
  "project_repository",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => project.id),
    repoId: text("repo_id")
      .notNull()
      .references(() => repo.id),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.repoId] })]
);
