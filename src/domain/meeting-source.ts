import { createHash } from "node:crypto";

/** Lo que un origen de reuniones entrega. Sin ids de base, sin fechas de importación. */
export interface RawMeeting {
  externalId: string;
  title: string;
  occurredAt: Date;
  participants: string[];
  summary?: string;
  privateNotes?: string;
  transcript?: string;
}

export interface MeetingSource {
  readonly name: "granola" | "manual";
  fetch(options?: { since?: Date; titleMatch?: string }): Promise<RawMeeting[]>;
}

/**
 * Huella del contenido: cambia si la nota cambió, no si se reimporta igual.
 * Normaliza saltos de línea y espacios de borde para que un CRLF no cuente como cambio.
 *
 * El transcript queda fuera a propósito: es ruido y no entra al modelo, así que
 * tampoco debe provocar una reimportación.
 */
export function contentHash(m: Pick<RawMeeting, "summary" | "privateNotes">): string {
  const normalizar = (s?: string) => (s ?? "").replace(/\r\n/g, "\n").trim();
  return createHash("sha256")
    .update([normalizar(m.summary), normalizar(m.privateNotes)].join("\u0000"))
    .digest("hex");
}

export function matchesTitle(title: string, pattern?: string): boolean {
  if (!pattern?.trim()) return true;
  return title.toLowerCase().includes(pattern.trim().toLowerCase());
}
