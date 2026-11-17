import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { openDatabase } from "../infra/db/client.ts";
import { resumenTrazas } from "../infra/llm/trace.ts";

const { db } = openDatabase(process.env.DATABASE_PATH ?? "./data/my_erp.db");
migrate(db, { migrationsFolder: "./drizzle" });

const r = resumenTrazas(db);

if (r.runs === 0) {
  console.log("Todavía no hay operaciones registradas.");
  process.exit(0);
}

const pct = (n: number, d: number) => (d > 0 ? ((n / d) * 100).toFixed(1) : "0.0") + "%";

console.log(`${r.runs} operación(es) · ${r.calls} llamada(s) a modelos`);
console.log(`  deepseek:        ${r.porProveedor.deepseek}`);
console.log(`  jev:             ${r.porProveedor.jev}`);
console.log(`  tokens totales:  ${r.tokens}`);
console.log(`  fallidas:        ${r.fallidas} (${pct(r.fallidas, r.runs)})`);
console.log(`  con reintento:   ${r.conReintento} (${pct(r.conReintento, r.runs)})`);
if (r.sinCerrar > 0) console.log(`  sin cerrar:      ${r.sinCerrar} (proceso interrumpido)`);

const causas = Object.entries(r.porCausa).sort((a, b) => b[1] - a[1]);
if (causas.length > 0) {
  console.log("\nCausas de fallo:");
  for (const [kind, n] of causas) console.log(`  ${kind.padEnd(12)} ${n}`);
}
