import { matchesTitle, type MeetingSource, type RawMeeting } from "../../domain/meeting-source.ts";
import { parseMeetingsXml } from "./parse.ts";
import { textOf } from "./mcp.ts";

/** Lo mínimo que necesitamos del cliente MCP. Así los tests no tocan la red. */
export interface ToolCaller {
  callTool(request: { name: string; arguments?: Record<string, unknown> }): Promise<{ content?: unknown; isError?: boolean | undefined }>;
}

export interface GranolaSourceOptions {
  /** Filtro por título. Vacío = todas. */
  titleMatch?: string;
  /** Pide solo notas modificadas después de esta fecha. */
  since?: Date;
  /** `time_range` a usar cuando no hay `since`. */
  timeRange?: "last_7_days" | "this_week" | "last_week" | "last_30_days" | "custom";
  pageLimit?: number;
  /** Tope de páginas para no quedar en un bucle si el cursor no avanza. */
  maxPages?: number;
}

export class GranolaSource implements MeetingSource {
  readonly name = "granola" as const;

  constructor(
    private readonly caller: ToolCaller,
    private readonly opts: GranolaSourceOptions = {}
  ) {}

  async fetch(): Promise<RawMeeting[]> {
    // 1) El listado solo trae metadatos: sirve para filtrar y para juntar ids.
    const candidatas = await this.listar();
    if (candidatas.length === 0) return [];

    // 2) El contenido (summary, transcript, notas) viene por get_meetings, de a 10.
    const detalle: RawMeeting[] = [];
    for (let i = 0; i < candidatas.length; i += 10) {
      const ids = candidatas.slice(i, i + 10).map((c) => c.externalId);
      const result = await this.caller.callTool({
        name: "get_meetings",
        arguments: { meeting_ids: ids, max_participants: 10, attachments: "none" },
      });
      const texto = textOf(result);
      if (result.isError) throw new Error(`get_meetings falló: ${texto.slice(0, 300)}`);
      detalle.push(...parseMeetingsXml(texto).meetings);
    }

    // Si el detalle no llegó para alguna, se conserva al menos el metadato.
    const porId = new Map(detalle.map((m) => [m.externalId, m]));
    return candidatas.map((c) => porId.get(c.externalId) ?? c);
  }

  private async listar(): Promise<RawMeeting[]> {
    const out: RawMeeting[] = [];
    const vistos = new Set<string>();
    let cursor: string | undefined;

    for (let page = 0; page < (this.opts.maxPages ?? 20); page++) {
      const result = await this.caller.callTool({ name: "list_meetings", arguments: this.args(cursor) });
      const texto = textOf(result);
      if (result.isError) throw new Error(`list_meetings falló: ${texto.slice(0, 300)}`);

      const { meetings, pagination } = parseMeetingsXml(texto);
      for (const m of meetings) {
        if (vistos.has(m.externalId)) continue;
        if (!matchesTitle(m.title, this.opts.titleMatch)) continue;
        vistos.add(m.externalId);
        out.push(m);
      }

      const next = pagination.nextCursor;
      if (!next || next === cursor) break;
      cursor = next;
    }

    return out;
  }

  private args(cursor?: string): Record<string, unknown> {
    const base: Record<string, unknown> = {
      limit: this.opts.pageLimit ?? 50,
      max_participants: 10,
    };
    if (this.opts.since) base.updated_after = this.opts.since.toISOString();
    else base.time_range = this.opts.timeRange ?? "last_7_days";
    if (cursor) base.cursor = cursor;
    return base;
  }
}
