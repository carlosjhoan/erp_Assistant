/** Aplica las migraciones versionadas de ./drizzle sobre la base. */
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { openDatabase } from "../src/infra/db/client.ts";

const path = process.env.DATABASE_PATH || "./data/my_erp.db";
const { sqlite, db } = openDatabase(path);

try {
  migrate(db, { migrationsFolder: "./drizzle" });
  console.log(`migraciones aplicadas en ${path}`);
} finally {
  sqlite.close();
}
