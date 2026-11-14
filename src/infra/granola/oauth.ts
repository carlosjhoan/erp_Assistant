import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { OAuthClientMetadata, OAuthClientProvider, StoredOAuthClientInformation, StoredOAuthTokens } from "@modelcontextprotocol/client";

interface Store {
  clientInformation?: StoredOAuthClientInformation;
  tokens?: StoredOAuthTokens;
  codeVerifier?: string;
  state?: string;
}

/**
 * Credencial propia del ERP. Nada de leer el token de OpenCode: este archivo es
 * el que manda y se puede borrar para reautenticar desde cero.
 */
export class FileOAuthProvider implements OAuthClientProvider {
  private store: Store;
  private authorizationUrl?: URL;

  constructor(
    private readonly path: string,
    private readonly callbackUrl: string
  ) {
    this.store = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Store) : {};
  }

  get redirectUrl(): string {
    return this.callbackUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "my_erp",
      client_uri: "https://github.com/carlosjhoan/my_erp",
      redirect_uris: [this.callbackUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "mcp offline_access",
    };
  }

  /** URL a la que hay que mandar al usuario. La lee el comando `auth`. */
  get pendingAuthorizationUrl(): URL | undefined {
    return this.authorizationUrl;
  }

  get isRegistered(): boolean {
    return Boolean(this.store.clientInformation);
  }

  clientInformation(): StoredOAuthClientInformation | undefined {
    return this.store.clientInformation;
  }

  saveClientInformation(info: StoredOAuthClientInformation): void {
    this.store.clientInformation = info;
    this.persist();
  }

  tokens(): StoredOAuthTokens | undefined {
    return this.store.tokens;
  }

  saveTokens(tokens: StoredOAuthTokens): void {
    this.store.tokens = tokens;
    this.persist();
  }

  saveCodeVerifier(verifier: string): void {
    this.store.codeVerifier = verifier;
    this.persist();
  }

  state(): string {
    const s = randomUUID();
    this.store.state = s;
    this.persist();
    return s;
  }

  /** Compara el `state` que volvió con el que mandamos. */
  matchesState(returned: string | null): boolean {
    return Boolean(this.store.state) && returned === this.store.state;
  }

  codeVerifier(): string {
    if (!this.store.codeVerifier) throw new Error("No hay code_verifier: se llamó codeVerifier() antes de autorizar.");
    return this.store.codeVerifier;
  }

  redirectToAuthorization(url: URL): void {
    this.authorizationUrl = url;
  }

  /** Huella corta del token, para logs sin filtrar la credencial. */
  tokenFingerprint(): string | undefined {
    const t = this.store.tokens?.access_token;
    return t ? createHash("sha256").update(t).digest("hex").slice(0, 8) : undefined;
  }

  private persist(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.store, null, 2), { mode: 0o600 });
  }
}
