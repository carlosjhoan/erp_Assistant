import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { openDatabase } from "../infra/db/client.ts";
import { resumenTrazas } from "../infra/llm/agent-run.ts";

const { db } = openDatabase(process.env.DATABASE_PATH ?? "./data/my_erp.db");
migrate(db, { migrationsFolder: "./drizzle" });

const r = resumenTrazas(db);

if (r.total === 0) {
  console.log("Todavía no hay llamadas registradas.");
  process.exit(0);
}

console.log(`${r.total} llamada(s) a modelos`);
console.log(`  fallidas:        ${r.fallidas} (${((r.fallidas / r.total) * 100).toFixed(1)}%)`);
console.log(`  con reintento:   ${r.conReintento} (${(r.tasaReintento * 100).toFixed(1)}%)`);

const causas = Object.entries(r.porCausa).sort((a, b) => b[1] - a[1]);
if (causas.length > 0) {
  console.log("\nCausas de fallo:");
  for (const [kind, n] of causas) console.log(`  ${kind.padEnd(12)} ${n}`);
}
