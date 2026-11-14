import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { openDatabase } from "../infra/db/client.ts";
import { createMeetingRepo } from "../infra/db/meeting-repo.ts";
import { conectar, UnauthorizedError } from "../infra/granola/mcp.ts";
import { FileOAuthProvider } from "../infra/granola/oauth.ts";
import { GranolaSource } from "../infra/granola/source.ts";

export interface IngestOptions {
  dbPath?: string;
  titleMatch?: string;
  since?: Date;
  timeRange?: "last_7_days" | "this_week" | "last_week" | "last_30_days";
  oauthStore?: string;
  oauthCallback?: string;
}

export interface IngestResult {
  found: number;
  created: number;
  updated: number;
  unchanged: number;
  titles: string[];
}

/**
 * La capacidad que va a invocar el chat del ERP:
 * "buscá las notas recién generadas en Granola y persistelas".
 */
export async function ingestGranola(opts: IngestOptions = {}): Promise<IngestResult> {
  const provider = new FileOAuthProvider(
    opts.oauthStore ?? "./data/granola-oauth.json",
    opts.oauthCallback ?? `http://127.0.0.1:${process.env.GRANOLA_OAUTH_PORT ?? 19876}/callback`
  );

  let conn;
  try {
    conn = await conectar(provider);
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      throw new Error("Granola necesita autorización. Corré: npm run auth:granola");
    }
    throw e;
  }

  try {
    const source = new GranolaSource(conn.client, {
      ...(opts.titleMatch !== undefined ? { titleMatch: opts.titleMatch } : {}),
      ...(opts.since ? { since: opts.since } : {}),
      ...(opts.timeRange ? { timeRange: opts.timeRange } : {}),
    });

    const raws = await source.fetch();

    const { db } = openDatabase(opts.dbPath ?? process.env.DATABASE_PATH ?? "./data/my_erp.db");
    migrate(db, { migrationsFolder: "./drizzle" });

    const repo = createMeetingRepo(db);
    const guardadas = repo.saveMany(raws, "granola");

    return { found: raws.length, ...guardadas, titles: raws.map((m) => m.title) };
  } finally {
    await Promise.resolve(conn.close());
  }
}
