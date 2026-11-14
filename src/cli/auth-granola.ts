/**
 * Autorización OAuth del ERP contra Granola.
 *
 *   node --import tsx src/cli/auth-granola.ts
 *
 * Abre el navegador, espera el callback en localhost y guarda la credencial en
 * data/granola-oauth.json. Se corre una vez; el refresh es automático después.
 */
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { exec } from "node:child_process";
import { conectar, UnauthorizedError, textOf } from "../infra/granola/mcp.ts";
import { FileOAuthProvider } from "../infra/granola/oauth.ts";

const PORT = Number(process.env.GRANOLA_OAUTH_PORT ?? 19876);
const CALLBACK = `http://127.0.0.1:${PORT}/callback`;
const STORE = process.env.GRANOLA_OAUTH_STORE ?? "./data/granola-oauth.json";

function abrirNavegador(url: string) {
  const cmd =
    process.platform === "win32" ? `start "" "${url}"`
    : process.platform === "darwin" ? `open "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

function esperarCodigo(provider: FileOAuthProvider): Promise<URLSearchParams> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", CALLBACK);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const error = url.searchParams.get("error");
      if (error) {
        res.writeHead(400, { "content-type": "text/plain; charset=utf-8" }).end(`Error: ${error}`);
        server.close();
        reject(new Error(`OAuth devolvió ${error}: ${url.searchParams.get("error_description") ?? ""}`));
        return;
      }
      if (!url.searchParams.get("code")) {
        res.writeHead(400).end("Falta el código");
        return;
      }
      if (!provider.matchesState(url.searchParams.get("state"))) {
        res.writeHead(400).end("state inválido");
        server.close();
        reject(new Error("El parámetro state no coincide. Se aborta por seguridad."));
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(
        "<html><body style=\"font-family:system-ui;padding:3rem\"><h2>Listo</h2><p>Ya podés cerrar esta pestaña y volver a la terminal.</p></body></html>"
      );
      server.close();
      resolve(url.searchParams);
    });
    server.on("error", reject);
    server.listen(PORT, "127.0.0.1");
  });
}

async function main() {
  const provider = new FileOAuthProvider(STORE, CALLBACK);
  console.log("Autorizando contra Granola…");

  try {
    const conn = await conectar(provider);
    console.log("Ya había una credencial válida. No hace falta autorizar de nuevo.");
    await conn.close();
    return;
  } catch (e) {
    if (!(e instanceof UnauthorizedError)) throw e;
  }

  const url = provider.pendingAuthorizationUrl;
  if (!url) throw new Error("El servidor no devolvió una URL de autorización.");

  console.log("\nAbrí este enlace para autorizar:\n");
  console.log(`  ${url.toString()}\n`);
  abrirNavegador(url.toString());

  const callbackParams = await esperarCodigo(provider);
  console.log("Código recibido. Canjeando…");

  // Un transporte nuevo hace el canje del código y guarda los tokens.
  const { transport, close } = (await import("../infra/granola/mcp.ts")).nuevaConexion(provider);
  await transport.finishAuth(callbackParams);
  await close();

  const conn = await conectar(provider);
  const { tools } = await conn.client.listTools();
  console.log(`\nAutorizado. ${tools.length} herramientas disponibles.`);
  console.log(`Huella del token: ${provider.tokenFingerprint()}`);

  writeFileSync("./data/granola-tools.json", JSON.stringify(tools, null, 2));
  console.log("Esquema de herramientas guardado en data/granola-tools.json");

  const list = tools.find((t) => t.name === "list_meetings");
  if (list) console.log("\nlist_meetings acepta:\n" + JSON.stringify(list.inputSchema, null, 1));

  await conn.close();
}

main().catch((e) => {
  console.error("\nFalló la autorización:", e instanceof Error ? e.message : e);
  process.exit(1);
});
