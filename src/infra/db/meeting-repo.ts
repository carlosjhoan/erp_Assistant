import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { meeting } from "./schema.ts";
import { openDatabase } from "./client.ts";
import { contentHash, type RawMeeting } from "../../domain/meeting-source.ts";

export type SaveOutcome = "created" | "updated" | "unchanged";

export interface MeetingRow {
  id: string;
  source: "granola" | "manual";
  externalId: string;
  title: string;
  occurredAt: Date;
  contentHash: string;
  summary?: string | null;
  transcript?: string | null;
}

export type MeetingRepo = ReturnType<typeof createMeetingRepo>;

type DB = ReturnType<typeof openDatabase>["db"];

export function createMeetingRepo(db: DB) {
  function save(raw: RawMeeting, source: "granola" | "manual"): SaveOutcome {
    const hash = contentHash(raw);
    const existing = db
      .select()
      .from(meeting)
      .where(and(eq(meeting.source, source), eq(meeting.externalId, raw.externalId)))
      .get();

    const fila = {
      title: raw.title,
      occurredAt: raw.occurredAt,
      participants: raw.participants,
      summary: raw.summary ?? null,
      privateNotes: raw.privateNotes ?? null,
      transcript: raw.transcript ?? null,
      summaryAvailable: Boolean(raw.summary),
      privateNotesAvailable: Boolean(raw.privateNotes),
      transcriptAvailable: Boolean(raw.transcript),
      contentHash: hash,
    };

    if (!existing) {
      db.insert(meeting)
        .values({ id: randomUUID(), source, externalId: raw.externalId, ...fila })
        .run();
      return "created";
    }

    // Misma nota reimportada: no se toca nada, ni siquiera importedAt.
    if (existing.contentHash === hash) return "unchanged";

    db.update(meeting).set(fila).where(eq(meeting.id, existing.id)).run();
    return "updated";
  }

  function saveMany(raws: RawMeeting[], source: "granola" | "manual") {
    const resumen = { created: 0, updated: 0, unchanged: 0 };
    db.transaction(() => {
      for (const raw of raws) resumen[save(raw, source)]++;
    });
    return resumen;
  }

  function list() {
    return db.select().from(meeting).orderBy(desc(meeting.occurredAt)).all();
  }

  function findByExternal(source: "granola" | "manual", externalId: string) {
    return db
      .select()
      .from(meeting)
      .where(and(eq(meeting.source, source), eq(meeting.externalId, externalId)))
      .get();
  }

  return { save, saveMany, list, findByExternal };
}
