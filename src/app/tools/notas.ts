import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../../infra/db/client.ts";
import { meeting, topic } from "../../infra/db/schema.ts";
import { fallo, lista, recorte, type ToolDef } from "./tool.ts";

export function buscarNotas(db: Db): ToolDef {
  return {
    name: "buscar_notas",
    description:
      "Busca texto en el resumen y las notas privadas de las reuniones de Granola. " +
      "Devuelve coincidencias con un extracto y el id de la reunión. " +
      "No devuelve la reunión completa: para eso usá ver_reunion.",
    input: z.strictObject({ texto: z.string().min(2) }),
    sideEffect: false,
    execute(input) {
      const { texto } = input as { texto: string };
      const t = texto.toLowerCase();

      const hits = db
        .select()
        .from(meeting)
        .all()
        .flatMap((m) => {
          // El transcript no entra: es ruido y no se consulta.
          const enResumen = m.summary?.toLowerCase().includes(t) ? recorte(m.summary, texto) : null;
          const enNotas = m.privateNotes?.toLowerCase().includes(t) ? recorte(m.privateNotes, texto) : null;
          if (!enResumen && !enNotas) return [];

          return [
            {
              id: m.id,
              titulo: m.title,
              fecha: m.occurredAt.toISOString().slice(0, 10),
              participantes: m.participants,
              extracto: enResumen ?? enNotas!,
              campo: enResumen ? "summary" : "privateNotes",
            },
          ];
        });

      return lista(hits.slice(0, 20), hits.length);
    },
  };
}

export function verReunion(db: Db): ToolDef {
  return {
    name: "ver_reunion",
    description:
      "Devuelve una reunión con sus temas, citas literales y preguntas abiertas. " +
      "Usala cuando ya tenés el id (por buscar_notas o listar_proyectos) y necesitás el detalle.",
    input: z.strictObject({ id: z.string() }),
    sideEffect: false,
    ref() {
      return { vista: "reuniones", id: null };
    },
    execute(input) {
      const { id } = input as { id: string };
      const m = db.select().from(meeting).where(eq(meeting.id, id)).get();
      if (!m) return fallo(`No existe la reunión ${id}. Usá buscar_notas para encontrar el id.`);

      const temas = db
        .select()
        .from(topic)
        .where(eq(topic.meetingId, id))
        .orderBy(asc(topic.position))
        .all();

      return {
        id: m.id,
        titulo: m.title,
        fecha: m.occurredAt.toISOString().slice(0, 10),
        participantes: m.participants,
        resumen: m.summary,
        notasPrivadas: m.privateNotes,
        temas: temas.map((t) => ({
          id: t.id,
          titulo: t.title,
          descripcion: t.description,
          cita: t.sourceExcerpt,
          estado: t.status,
          owner: t.owner,
          preguntasAbiertas: t.openQuestions ?? [],
          proyectoId: t.projectId,
        })),
      };
    },
  };
}
