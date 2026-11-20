/**
 * Consulta libre al ERP.
 *
 * El usuario pregunta en lenguaje natural; se arma una foto compacta del estado
 * real y el modelo responde. Nunca inventa datos: si no está en la foto, dice
 * que no lo sabe. La ruta sugerida permite saltar a la vista que lo explica.
 */

import { z } from "zod";
import type { Db } from "../infra/db/client.ts";
import { meeting, project, rubricItem, topic } from "../infra/db/schema.ts";
import { progresoPorProyecto, rango, semanaEnCurso, semanaProxima, semanas } from "./progreso.ts";
import { startRun, finishRun } from "../infra/llm/trace.ts";
import type { Providers } from "../infra/llm/providers.ts";

const Respuesta = z.object({
  /** Dos o tres frases. Concreto, sin relleno. */
  respuesta: z.string(),
  /** A dónde mandar al usuario, si aplica. */
  ruta: z.enum(["/proyectos", "/reuniones", "/rubrica"]).nullable(),
  /** Qué mirar primero, en una línea. */
  siguiente: z.string().nullable(),
  /**
   * Vista que conviene mostrar debajo de la respuesta. El servidor la
   * renderiza con la misma funcion que usa la pantalla completa.
   */
  mostrar: z
    .object({
      vista: z.enum(["proyecto", "semana", "reuniones"]),
      id: z.string().nullable(),
    })
    .nullable(),
  /** Enlace externo para abrir en otra pestaña. Solo si la pregunta lo pide. */
  enlace: z
    .object({
      texto: z.string(),
      url: z.string(),
    })
    .nullable(),
});

export type Consulta = z.infer<typeof Respuesta>;

const RUTAS = ["/proyectos", "/reuniones", "/rubrica"] as const;

/**
 * Hechos del catálogo de cotizaciones. No viven en la base: son el resultado
 * de la ingesta y se citan tal cual. El visor corre aparte.
 */
const CATALOGO = {
  ingeridas: 64,
  validas: 61,
  conError: 3,
  proyectos: 55,
  visor: "http://localhost:5080/",
};

/**
 * Reportes de inventario desde SIIGO. Tampoco vive en la base: es estado del
 * proyecto y de lo que pidió el área contable.
 */
const SIIGO = {
  visor: "http://localhost:8501/",
};

const resumenSiigo = () =>
  [
    "REPORTES DE INVENTARIO DESDE SIIGO:",
    "- Con credenciales, el sistema se conecta a la API de SIIGO y descarga los reportes de inventario indicando una fecha de corte.",
    "- A pedido de Leonardo, esa información se consolida en un reporte por categoría, con saldo y valor, para agilizar sus cierres.",
    `- El visor del reporte está en ${SIIGO.visor} (abre en otra pestaña).`,
  ].join(String.fromCharCode(10));

const resumenCatalogo = () =>
  [
    "CATÁLOGO DE COTIZACIONES:",
    `- Se hizo una ingesta de ${CATALOGO.ingeridas} cotizaciones.`,
    `- ${CATALOGO.validas} fueron reconocidas como válidas y ${CATALOGO.conError} dieron error.`,
    `- En total son ${CATALOGO.proyectos} proyectos diferentes.`,
    `- El visor del catálogo está en ${CATALOGO.visor} (abre en otra pestaña).`,
  ].join(String.fromCharCode(10));

/** Foto compacta del estado. Es todo lo que el modelo puede afirmar. */
export function foto(db: Db): string {
  const proyectos = progresoPorProyecto(db);
  const ss = semanas(db);
  const actual = semanaEnCurso(ss);
  const proxima = semanaProxima(ss);

  const pendientes = actual
    ? db
        .select()
        .from(rubricItem)
        .all()
        .filter((i) => i.rubricId === actual.id && i.status !== "done")
        .map((i) => i.title)
    : [];

  const reuniones = db.select().from(meeting).all();
  const temas = db.select().from(topic).all();
  const sinCalificar = temas.filter((t) => t.status === "proposed").length;

  const lineas = [
    `Fecha: ${new Date().toISOString().slice(0, 10)}`,
    "",
    "PROYECTOS (avance de la semana en curso y acumulado):",
    ...proyectos.map(
      (p) =>
        `- ${p.nombre} [id ${p.proyectoId}]: semana ${p.semana.pct}% (${p.semana.hechos}/${p.semana.total}), acumulado ${p.pct}% (${p.hechos}/${p.total}), ${p.repos} repos, diagnóstico ${p.diagnostico ? `${p.diagnostico.negocio}% negocio / ${p.diagnostico.tecnico}% producción` : "sin cargar"}`,
    ),
    "",
    actual
      ? `RÚBRICA DE LA SEMANA EN CURSO [id ${actual.id}]: ${rango(actual.desde, actual.hasta)} — ${actual.pct}% (${actual.hechos}/${actual.total} ítems hechos)`
      : "RÚBRICA DE LA SEMANA EN CURSO: no hay ninguna abierta",
    `Semanas de rúbrica registradas: ${ss.length}`,
    proxima
      ? `PRÓXIMA SEMANA [id ${proxima.id}]: ${rango(proxima.desde, proxima.hasta)} — ${proxima.total} ítems planificados, ${proxima.pct}% hecho`
      : "PRÓXIMA SEMANA: no hay una planificada",
    ...(proxima
      ? db
          .select()
          .from(rubricItem)
          .all()
          .filter((i) => i.rubricId === proxima.id)
          .map((i) => `  - ${i.projectId ? (proyectos.find((p) => p.proyectoId === i.projectId)?.nombre ?? "sin proyecto") : "sin proyecto"}: ${i.title}`)
      : []),
    "",
    `REUNIONES: ${reuniones.length} · temas sin calificar: ${sinCalificar}`,
    "",
    pendientes.length > 0 ? `ÍTEMS PENDIENTES (${pendientes.length}):` : "ÍTEMS PENDIENTES: ninguno",
    ...pendientes.slice(0, 40).map((t) => `- ${t}`),
    "",
    resumenCatalogo(),
    "",
    resumenSiigo(),
  ];

  return lineas.join("\n");
}

export async function consultar(
  db: Db,
  proveedores: Providers,
  pregunta: string,
): Promise<{ datos: Consulta; runId: string; ms: number; modelo: string; msDatos: number; msModelo: number }> {
  const runId = startRun(db, { kind: "summary", tool: "consulta", input: pregunta });
  // Las llamadas del proveedor se cuelgan de esta operacion.
  proveedores.setRun(runId);
  const desde = Date.now();
  // Se mide la foto aparte: es trabajo del servidor, no del modelo.
  const fotoArmada = foto(db);
  const msDatos = Date.now() - desde;
  const tModelo = Date.now();

  try {
    const r = await proveedores.llm.generate({
      kind: "compose",
      schemaName: "RespuestaConsulta",
      system:
        "Sos el asistente de un ERP personal de gestión de proyectos. Respondés en español neutro, breve y concreto. " +
        "Solo podés afirmar lo que dice la foto de datos que recibís; si algo no está, decilo. " +
        "No inventes cifras. Máximo tres frases. Si conviene, indicá una ruta para ver el detalle. " +
        "Cuando la pregunta sea sobre un proyecto, la semana o las reuniones, llena 'mostrar' con la vista y el id exacto de la foto, " +
        "para que el usuario vea el detalle renderizado. Si la pregunta es general, deja 'mostrar' en null. " +
        "Si habla de la próxima semana, la otra semana o lo que viene, usa la sección PRÓXIMA SEMANA y su id. " +
        "Si la pregunta trata del catálogo de cotizaciones, cita las cifras de la foto y llena 'enlace' con " +
        '{texto: "Abrir el catálogo", url: "' +
        CATALOGO.visor +
        '"} . Si la pregunta trata de SIIGO o de los reportes de inventario, usa las cifras y el alcance de la foto ' +
        'y llena enlace con {texto: "Abrir el reporte", url: "' +
        SIIGO.visor +
        '"}. En cualquier otro caso deja enlace en null.',
      prompt: `PREGUNTA: ${pregunta}\n\nFOTO DEL ESTADO:\n${fotoArmada}`,
      schema: Respuesta,
    });

    finishRun(db, runId, { outcome: "ok", intentos: r.intentos, tokens: r.tokens, durationMs: r.durationMs });
    return { datos: r.data, runId, ms: Date.now() - desde, modelo: r.model, msDatos, msModelo: Date.now() - tModelo };
  } catch (err) {
    finishRun(db, runId, {
      outcome: "failed",
      intentos: 1,
      fallos: [{ intento: 1, kind: "unknown", retriable: false, mensaje: String(err) }],
    });
    throw err;
  } finally {
    proveedores.setRun(undefined);
  }
}

export const rutasValidas = RUTAS;
