import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { openDatabase } from "../infra/db/client.ts";
import { createMeetingRepo } from "../infra/db/meeting-repo.ts";

const { db } = openDatabase(process.env.DATABASE_PATH ?? "./data/my_erp.db");
migrate(db, { migrationsFolder: "./drizzle" });

const filas = createMeetingRepo(db).list();

if (filas.length === 0) {
  console.log("No hay reuniones guardadas. Corré: npm run ingest");
  process.exit(0);
}

console.log(`${filas.length} reunión(es) guardada(s):\n`);
for (const f of filas) {
  const fecha = f.occurredAt.toISOString().slice(0, 10);
  const bloques = [
    f.summaryAvailable ? `summary ${f.summary?.length ?? 0}` : "sin summary",
    f.transcriptAvailable ? `transcript ${f.transcript?.length ?? 0}` : "sin transcript",
    f.privateNotesAvailable ? "notas privadas" : "sin notas privadas",
  ].join(" · ");
  console.log(`  ${fecha}  ${f.title}`);
  console.log(`            ${bloques} · hash ${f.contentHash.slice(0, 8)}`);
}
