/**
 * npm run plan -- --topic <id|prefijo>
 *
 * Por ahora hace solo el primer paso: detectar a qué repos corresponde el
 * alcance. El broadcast va después.
 */
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { openDatabase } from "../infra/db/client.ts";
import { topic } from "../infra/db/schema.ts";
import { providersFromEnv } from "../infra/llm/providers.ts";
import { detectarRepos } from "../app/detect-repos.ts";

const { db } = openDatabase(process.env.DATABASE_PATH ?? "./data/my_erp.db");
migrate(db, { migrationsFolder: "./drizzle" });

const args = process.argv.slice(2);
const valor = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};

function resolverTema(prefijo: string) {
  const todos = db.select().from(topic).all();
  const encontrados = todos.filter((t) => t.id.startsWith(prefijo));
  if (encontrados.length === 0) throw new Error(`No encontré el tema "${prefijo}".`);
  if (encontrados.length > 1) {
    const lista = encontrados.map((t) => `  ${t.id.slice(0, 8)}  ${t.title}`).join("\n");
    throw new Error(`"${prefijo}" coincide con varios temas:\n${lista}`);
  }
  return encontrados[0]!;
}

async function main() {
  const idPedido = valor("--topic");
  if (!idPedido) throw new Error("Indicá --topic <id>. Listá con: npm run topics");

  const tema = resolverTema(idPedido);
  if (tema.status !== "selected") {
    console.log(`Aviso: el tema está en "${tema.status}". La detección funciona igual, pero solo se desglosan los seleccionados.\n`);
  }

  console.log(`Detectando repos para: ${tema.title}\n`);

  const r = await detectarRepos({ db, ...providersFromEnv(db) }, tema.id);

  if (r.duda) {
    console.log(`⚠ El modelo no pudo decidir: ${r.duda}\n`);
  }

  if (r.repos.length === 0) {
    console.log("Ningún repo corresponde a este alcance.");
  } else {
    const principales = r.repos.filter((x) => x.papel === "principal");
    const dependientes = r.repos.filter((x) => x.papel === "dependiente");

    if (principales.length > 1) {
      console.log(`⚠ ${principales.length} repos marcados como principal. Revisá si el alcance está bien cortado.\n`);
    }

    for (const rep of r.repos) {
      const marca = rep.papel === "principal" ? "◆ principal " : "◇ dependiente";
      console.log(`${marca}  ${rep.proyecto}/${rep.nombre}`);
      console.log(`             ${rep.motivo}`);
    }

    if (dependientes.length > 0 && principales.length > 0) {
      console.log(`\nOrden sugerido: ${[...principales, ...dependientes].map((x) => x.nombre).join(" → ")}`);
    }
  }

  if (r.excluidos.length > 0) {
    console.log("\nEvaluados y descartados:");
    for (const e of r.excluidos) console.log(`  · ${e.nombre}: ${e.motivo}`);
  }

  if (r.invalidos.length > 0) {
    console.log(`\n⚠ El modelo devolvió ${r.invalidos.length} id(s) que no existen en el catálogo: ${r.invalidos.join(", ")}`);
  }
  if (r.fallback) {
    console.log("\n⚠ El modelo no devolvió repos usables: se usó coincidencia de palabras clave.");
  }

  console.log(`\n${r.model} · ${r.tokens} tok · ${(r.durationMs / 1000).toFixed(1)} s · ${r.intentos} intento(s)`);
}

main().catch((e) => {
  console.error(`\n${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
