import { eq } from "drizzle-orm";
import { meeting } from "../infra/db/schema.ts";
import { conectar, UnauthorizedError, type GranolaConnection } from "../infra/granola/mcp.ts";
import { FileOAuthProvider } from "../infra/granola/oauth.ts";
import { parseMeetingsXml } from "../infra/granola/parse.ts";
import { textOf } from "../infra/granola/mcp.ts";
import { createMeetingRepo } from "../infra/db/meeting-repo.ts";
import type { openDatabase } from "../infra/db/client.ts";

type DB = ReturnType<typeof openDatabase>["db"];

export class GranolaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GranolaError";
  }
}

export interface NotaReciente {
  externalId: string;
  title: string;
  occurredAt: Date;
  participantes: number;
  yaImportada: boolean;
}

function provider(puerto = process.env.GRANOLA_OAUTH_PORT ?? "19876") {
  return new FileOAuthProvider(
    process.env.GRANOLA_OAUTH_STORE ?? "./data/granola-oauth.json",
    `http://127.0.0.1:${puerto}/callback`
  );
}

async function conectarOBien(): Promise<GranolaConnection> {
  try {
    return await conectar(provider());
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      throw new GranolaError("La autorización de Granola venció. Corré: npm run auth:granola");
    }
    throw new GranolaError(`No se pudo conectar con Granola: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Las últimas notas de los últimos 30 días, sin guardar nada. */
export async function listarNotas(db: DB, limite = 10): Promise<NotaReciente[]> {
  const conn = await conectarOBien();

  try {
    const res = await conn.client.callTool({
      name: "list_meetings",
      // El rango por defecto de Granola es la última semana; 30 dias trae el historial util.
      arguments: { time_range: "last_30_days", limit: limite, max_participants: 10 },
    });

    const texto = textOf(res as { content?: unknown });
    if ((res as { isError?: boolean }).isError) {
      throw new GranolaError(`Granola devolvió un error: ${texto.slice(0, 200)}`);
    }

    const { meetings } = parseMeetingsXml(texto);
    const importadas = new Set(db.select().from(meeting).all().map((m) => m.externalId));

    return meetings.map((m) => ({
      externalId: m.externalId,
      title: m.title,
      occurredAt: m.occurredAt,
      participantes: m.participants.length,
      yaImportada: importadas.has(m.externalId),
    }));
  } finally {
    await conn.close();
  }
}

/**
 * Trae una nota concreta y la guarda. Idempotente: si ya existe y cambió, la
 * actualiza; si no cambió, no hace nada.
 */
export async function importarNota(
  db: DB,
  externalId: string
): Promise<{ meetingId: string; resultado: "created" | "updated" | "unchanged"; title: string }> {
  const conn = await conectarOBien();

  try {
    const res = await conn.client.callTool({
      name: "get_meetings",
      arguments: { meeting_ids: [externalId], max_participants: 20, attachments: "none" },
    });

    const texto = textOf(res as { content?: unknown });
    if ((res as { isError?: boolean }).isError) {
      throw new GranolaError(`No se pudo leer la nota: ${texto.slice(0, 200)}`);
    }

    const { meetings } = parseMeetingsXml(texto);
    const nota = meetings.find((m) => m.externalId === externalId) ?? meetings[0];

    if (!nota) throw new GranolaError("La nota no vino en la respuesta de Granola.");

    const repo = createMeetingRepo(db);
    const resultado = repo.save(nota, "granola");
    const fila = repo.findByExternal("granola", nota.externalId);

    if (!fila) throw new GranolaError("La nota no se pudo guardar.");

    return { meetingId: fila.id, resultado, title: nota.title };
  } finally {
    await conn.close();
  }
}

/** ¿Ya está importada esta nota? */
export function yaImportada(db: DB, externalId: string): boolean {
  return Boolean(db.select().from(meeting).where(eq(meeting.externalId, externalId)).get());
}
