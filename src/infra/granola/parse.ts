/**
 * Parser del XML que devuelve el MCP de Granola.
 * No es XML estricto (viene de un LLM-friendly server), así que se recorre por
 * bloques en vez de confiar en un parser genérico.
 */

export interface GranolaPagination {
  nextCursor?: string;
}

export interface GranolaParseResult {
  meetings: ParsedMeeting[];
  pagination: GranolaPagination;
  skipped: { reason: string; title?: string }[];
}

export interface ParsedMeeting {
  externalId: string;
  title: string;
  occurredAt: Date;
  participants: string[];
  summary?: string;
  privateNotes?: string;
  transcript?: string;
}

const ENTITIES: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&amp;": "&",
  "&quot;": '"',
  "&apos;": "'",
  "&#39;": "'",
  "&nbsp;": " ",
  // Acentos que aparecen en notas en español.
  "&aacute;": "á",
  "&eacute;": "é",
  "&iacute;": "í",
  "&oacute;": "ó",
  "&uacute;": "ú",
  "&ntilde;": "ñ",
  "&Aacute;": "Á",
  "&Eacute;": "É",
  "&Iacute;": "Í",
  "&Oacute;": "Ó",
  "&Uacute;": "Ú",
  "&Ntilde;": "Ñ",
  "&uuml;": "ü",
  "&iquest;": "¿",
  "&iexcl;": "¡",
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&(lt|gt|amp|quot|apos|nbsp|aacute|eacute|iacute|oacute|uacute|ntilde|Aacute|Eacute|Iacute|Oacute|Uacute|Ntilde|uuml|iquest|iexcl);/g, (m) => ENTITIES[m] ?? m);
}

function parseAttrs(openTag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_][\w-]*)\s*=\s*"([^"]*)"/g;
  for (let m = re.exec(openTag); m; m = re.exec(openTag)) {
    const [, key, value] = m;
    if (key && value !== undefined) attrs[key] = decodeEntities(value);
  }
  return attrs;
}

interface Block {
  attrs: Record<string, string>;
  inner: string;
  selfClosing: boolean;
}

/** Devuelve todos los bloques de primer nivel con ese tag. */
function findBlocks(xml: string, tag: string): Block[] {
  const blocks: Block[] = [];
  const open = new RegExp(`<${tag}(\\s[^>]*?)?(/?)>`, "g");
  let m = open.exec(xml);
  while (m) {
    const attrs = parseAttrs(m[0]);
    if (m[2] === "/") {
      blocks.push({ attrs, inner: "", selfClosing: true });
      m = open.exec(xml);
      continue;
    }
    const start = m.index + m[0].length;
    const end = xml.indexOf(`</${tag}>`, start);
    if (end === -1) break; // bloque truncado: se ignora
    blocks.push({ attrs, inner: xml.slice(start, end), selfClosing: false });
    open.lastIndex = end + `</${tag}>`.length;
    m = open.exec(xml);
  }
  return blocks;
}

function childText(parent: Block, tag: string): { text?: string | undefined; available: boolean } {
  const re = new RegExp(`<${tag}(\\s[^>]*?)?(/?)>`, "g");
  const m = re.exec(parent.inner);
  if (!m) return { available: false };

  const attrs = parseAttrs(m[0]);
  if (m[2] === "/") {
    return { available: attrs.status !== "empty" };
  }
  const start = m.index + m[0].length;
  const end = parent.inner.indexOf(`</${tag}>`, start);
  if (end === -1) return { available: false };

  const raw = decodeEntities(parent.inner.slice(start, end)).trim();
  const flag = attrs.status ?? attrs.available;
  const available = flag === "empty" || flag === "false" ? false : raw.length > 0;
  return { text: available ? raw : undefined, available };
}

function parseDate(attrs: Record<string, string>): Date | undefined {
  for (const key of ["meeting_at", "date"]) {
    const raw = attrs[key];
    if (!raw) continue;
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return undefined;
}

export function parseMeetingsXml(xml: string): GranolaParseResult {
  const meetings: ParsedMeeting[] = [];
  const skipped: { reason: string; title?: string }[] = [];

  for (const block of findBlocks(xml, "meeting")) {
    const externalId = block.attrs.id?.trim();
    const title = block.attrs.title?.trim();

    if (!externalId) {
      skipped.push({ reason: "sin id", ...(title ? { title } : {}) });
      continue;
    }
    if (!title) {
      skipped.push({ reason: "sin título" });
      continue;
    }

    const occurredAt = parseDate(block.attrs);
    if (!occurredAt) {
      skipped.push({ reason: "fecha ilegible", title });
      continue;
    }

    const participantsBlock = childText(block, "known_participants");
    const participants = (participantsBlock.text ?? "")
      .split(/[,\n]/)
      .map((p) => p.trim())
      .filter(Boolean);

    const summary = childText(block, "summary");
    const privateNotes = childText(block, "private_notes");
    const transcript = childText(block, "transcript");

    meetings.push({
      externalId,
      title,
      occurredAt,
      participants,
      ...(summary.text ? { summary: summary.text } : {}),
      ...(privateNotes.text ? { privateNotes: privateNotes.text } : {}),
      ...(transcript.text ? { transcript: transcript.text } : {}),
    });
  }

  const nextCursor = parseAttrs(findBlocks(xml, "pagination")[0] ? xml.match(/<pagination[^>]*>/)![0] : "")["next_cursor"];

  return { meetings, pagination: nextCursor ? { nextCursor } : {}, skipped };
}
