import type { Db } from "../../infra/db/client.ts";
import { estadoDiagnostico } from "./diagnostico.ts";
import { listarItems } from "./items.ts";
import { buscarNotas, verReunion } from "./notas.ts";
import { listarProyectos, verProyecto } from "./proyectos.ts";
import { verSemana } from "./semana.ts";
import type { ToolDef } from "./tool.ts";

/** Las tools que el asistente puede llamar. Cada una se ata a la base por closure. */
export function registro(db: Db): ToolDef[] {
  return [
    listarProyectos(db),
    verProyecto(db),
    verSemana(db),
    listarItems(db),
    buscarNotas(db),
    verReunion(db),
    estadoDiagnostico(db),
  ];
}
