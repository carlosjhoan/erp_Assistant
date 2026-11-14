import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as schema from "./schema.ts";

export const PRAGMAS = [
  "PRAGMA journal_mode = WAL",
  "PRAGMA synchronous = NORMAL",
  "PRAGMA foreign_keys = ON",
  "PRAGMA busy_timeout = 5000",
] as const;

/** Abre la base y aplica los pragmas. Un archivo, un proceso. */
export function openDatabase(path = process.env.DATABASE_PATH || "./data/my_erp.db") {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });

  const sqlite = new Database(path);
  for (const pragma of PRAGMAS) sqlite.exec(pragma);

  return { sqlite, db: drizzle(sqlite, { schema }) };
}

export type Db = ReturnType<typeof openDatabase>["db"];
export { schema };
