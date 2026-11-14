import { Client, StreamableHTTPClientTransport, UnauthorizedError } from "@modelcontextprotocol/client";
import { FileOAuthProvider } from "./oauth.ts";

export const GRANOLA_MCP_URL = "https://mcp.granola.ai/mcp";

export interface GranolaConnection {
  client: Client;
  transport: StreamableHTTPClientTransport;
  close(): Promise<void>;
}

export function nuevaConexion(provider: FileOAuthProvider): GranolaConnection {
  const transport = new StreamableHTTPClientTransport(new URL(GRANOLA_MCP_URL), { authProvider: provider });
  const client = new Client({ name: "my_erp", version: "0.1.0" }, { capabilities: {} });
  return {
    client,
    transport,
    async close() {
      await client.close().catch(() => {});
    },
  };
}

/** Conecta; si no hay credencial válida lanza `UnauthorizedError` con la URL para autorizar. */
export async function conectar(provider: FileOAuthProvider): Promise<GranolaConnection> {
  const conn = nuevaConexion(provider);
  try {
    await conn.client.connect(conn.transport);
    return conn;
  } catch (e) {
    await conn.close();
    throw e;
  }
}

export { UnauthorizedError };

/** Junta el texto de un resultado de tool, sin importar si vino en uno o varios bloques. */
export function textOf(result: { content?: unknown }): string {
  const blocks = (result.content ?? []) as { type: string; text?: string }[];
  return blocks
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
}
