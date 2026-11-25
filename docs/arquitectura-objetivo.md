# Arquitectura objetivo — de asistente a ERP agéntico

**Proyecto:** my_erp
**Fecha:** 2026-11-24
**Estado:** documento de referencia. No hay código escrito contra este documento todavía.
**Complementa:** `auditoria-prototipo.md` (qué se reutiliza), `analisis-brechas.md` (qué falta en el modelo de datos), `decision-stack.md` (stack elegido).

---

## 1. Tesis

**"ERP autónomo" es una contradicción en los términos, y no por filosofía: por ingeniería.**

Un ERP es un **sistema de registro**: determinista, auditable, idempotente. Un agente es **probabilístico**. Si el agente es dueño del estado, tarde o temprano aparece un número en el reporte semanal que nadie puede explicar, y el sistema muere — no por un crash, sino porque se deja de confiar en él.

La arquitectura correcta no es "más agente". Es **núcleo determinista + capa agéntica delgada encima**.

> **North star:** el ERP no es un chat que sabe de tu trabajo. Es un **registro de tu trabajo con un chat encima**.

Esto coincide con lo que reportan las fuentes de referencia:

- Anthropic: *"the most successful implementations weren't using complex frameworks... simple, composable patterns"*. Distingue **workflows** (rutas de código predefinidas) de **agents** (el LLM dirige su propio proceso), y recomienda el workflow hasta que duela.
- 12-Factor Agents: *"most of the products billing themselves as AI agents are not all that agentic. A lot of them are mostly deterministic code, with LLM steps sprinkled in at just the right points."*

Y ya está codificado en el repo: `src/domain/permissions.ts:13` establece que **el agente sólo puede empujar el trabajo hacia adelante y bloquear; aprobar, devolver o descartar es del humano**. Esa es la decisión de diseño más importante del proyecto y debe extenderse a todo lo demás.

---

## 2. Los tres planos

| Plano | Naturaleza | Qué es | Estado |
|---|---|---|---|
| **1. Registro** | Determinista | schema, reglas de estado, cálculos (`progreso.ts`) | Sólido. Falta el log de eventos |
| **2. Agente** | Probabilístico, acotado | tools tipadas + loop + memoria + trazas | No existe. Es lo que hay que construir |
| **3. Ejecutor** | Externo | OpenCode / T3 escriben código | `RepoWorker` ya es el puerto correcto |

Regla de composición:

- El plano 2 **lee y propone** sobre el plano 1.
- El plano 2 **despacha** al plano 3.
- El plano 2 **nunca** escribe estado directamente ni ejecuta código.

---

## 3. Workflow vs. agente, aplicado al producto

| Tarea | Qué debe ser | Por qué |
|---|---|---|
| "¿Qué dijo Persona_#%& del deadline?" | **Agente** | No se sabe qué consultar de antemano |
| Desglosar un tema en ítems | **Workflow** | Pasos fijos: extraer → verificar cita → proponer. Ya existe |
| Reporte semanal | **Workflow** | Drift, carry-over y capacidades movidas son código |
| Despachar un ítem a OpenCode | **Workflow** | ítem → sesión → guardia git → evidencia → `ready_for_review` |
| Redactar el correo del reporte | **Workflow con un paso LLM** | Los datos ya están; el LLM sólo escribe |
| "¿Qué está trabado y por qué?" | **Agente** | Cruza proyectos, semanas y temas |

**Sólo dos de seis son agente.** Convertir las seis en agente pierde determinismo donde más se necesita y agrega variabilidad donde no aporta.

---

## 4. Escalera de autonomía

| Nivel | Qué hace | Requisito | Cuándo |
|---|---|---|---|
| **L0** | Responde leyendo | tools de lectura | Fase 1 |
| **L1** | Propone (ítems, reporte, plan) | `sideEffect: false` + preview | Fase 2-3 |
| **L2** | Actúa con aprobación humana | gate + idempotencia | Fase 4 |
| **L3** | Actúa dentro de política | presupuesto, caps, kill switch | Sólo acciones reversibles |

Objetivo: vivir en **L1-L2**.

L3 únicamente para acciones **reversibles, idempotentes y acotadas** (ej: cerrar un ítem cuando el test pasó). **Nunca L3** para: enviar correo a externos, mergear código, borrar datos, cambiar el alcance de la semana.

`permissions.ts` implementa esta idea a nivel de estado de ítem. La extensión correcta es hacerla cumplir también a nivel de **tool**, no reinventarla.

---

## 5. Las seis transformaciones

### 5.1 Frontera de tools

Es la **ACI** (agent-computer interface). Anthropic dedica un apéndice entero y confiesa que en su agente de SWE-bench *"spent more time optimizing our tools than the overall prompt"*.

Contrato propuesto en `src/app/tools/tool.ts`:

```ts
export interface ToolDef {
  name: string;
  description: string;   // cuándo usarla + qué NO devuelve
  input: z.ZodType<unknown>;
  sideEffect: boolean;   // false = lee; true = propone y espera aprobación
  execute(input: unknown): Promise<unknown> | unknown;
  ref?(input: unknown, output: unknown):
    { vista: "proyecto" | "semana" | "reuniones"; id: string | null } | null;
}
```

Reglas de diseño:

1. Devuelven **datos, no prosa**. `{ pct: 40, hechos: 2, total: 5 }`, no `"semana 40% (2/5)"`.
2. Envoltura de lista explícita: `{ items, total, truncado }`. Mata el `slice(40)` silencioso de `consulta.ts:84`.
3. Error **devuelto**, no lanzado: un `throw` corta el loop; un `{ error }` deja que el modelo corrija el id.
4. `id` siempre presente: es la moneda para citar y encadenar.
5. Poka-yoke: `proyectoId` obligatorio en tools de escritura, nunca opcional.

Primer set (sólo lectura): `listar_proyectos`, `ver_proyecto`, `ver_semana`, `listar_items`, `buscar_notas`, `ver_reunion`, `estado_diagnostico`.

### 5.2 Log de eventos como fuente de verdad

`itemEvent` existe (`src/infra/db/schema.ts:252`) con `actor`, `kind`, `body`, `evidenceRefs`… y **nadie lo escribe**.

Para un *manager* de trabajo, "por qué cambió esto" **es el producto**. Sin eventos:

- el reporte semanal no es auditable;
- no se puede responder "qué pasó esta semana" sin alucinar;
- no hay carry-over confiable.

Event-sourcing **lite**: los eventos se appendean; el estado actual se deriva o se cachea. No hace falta event sourcing completo; hace falta que cada cambio deje rastro.

**Regla dura (D4):** todo cambio de estado pasa por una función que escribe el estado y el evento **en la misma transacción**. El estado actual sigue siendo la fuente de verdad de lectura; el evento es la fuente de verdad del *por qué*.

### 5.3 Unificar ejecución y negocio en un mismo spine

`topicRepo` (planificación) y el futuro `agent_session` (ejecución) se mantienen separados en propósito pero unificados en identificadores. Una sola cadena:

```
reunión → tema → ítem → sesión → commit/PR → evidencia
```

Eso es lo que un ERP tiene y un chat no: **trazabilidad**. Cuando un número del reporte se pueda clickear y llegar al commit, hay ERP.

### 5.4 Outbox transaccional para el correo

`report` (`schema.ts:278`), `recipient` (`:288`) y `reportDelivery` (`:296`) ya existen. El patrón correcto:

```
transacción: escribir report (draft) + N deliveries (pending)
sender:      drena pending → envía → marca sent/failed
```

Con `DRY_RUN=1` por defecto (ya está en `.env.example`) e idempotency key por delivery. Sin outbox, un reintento manda el reporte dos veces. Con outbox, el ERP puede probar qué mandó, cuándo y a quién.

**D1:** el reporte vive **in-app primero**. Se genera, se guarda y se ve en la app; el correo es un efecto externo opcional que sale por el outbox. Si el SMTP falla, el reporte existe igual.

### 5.5 Loop proactivo — lo que convierte un ERP en un *manager*

La diferencia entre "ERP" y "manager" es la **proactividad**.

Semanal, determinista, sin LLM en el control:

- planificado vs. hecho → **drift**;
- ítems que se arrastran → **carry-over**;
- ítems sin movimiento en N días → **stale**;
- capacidades que se movieron → **progreso técnico**.

El núcleo determinista calcula **qué cambió**. El LLM sólo **lo redacta**. Es 12-Factor #8 ("own your control flow"): el agente no decide *si* mirar; mira porque el cron lo despertó.

### 5.6 Superficie MCP

Exponer **el mismo registro de tools** por `stdio`. Cero código duplicado. Es lo que permite consultar el ERP desde T3, desde OpenCode o desde cualquier cliente MCP. 12-Factor #11: *"trigger from anywhere, meet users where they are."*

---

## 6. Datos que no entran al modelo

**El transcript de Granola queda fuera.** Decisión tomada: es ruido, no dato. No entra al contexto del modelo ni como texto no confiable.

Estado verificado del código:

- `extract-topics.ts` usa `meeting.summary`, no `transcript`.
- `foto()` (`consulta.ts:84`) no lee `transcript`.
- Únicos lectores: `cli/meetings.ts` (imprime el largo) y `contentHash` (`meeting-source.ts:23`).

Cambios pendientes, ninguno de modelo:

```ts
// meeting-source.ts — el hash mide lo que sí se usa
[normalizar(m.summary), normalizar(m.privateNotes)].join("\u0000")

// meeting-repo.ts — dejar de escribir la columna
// quitar `transcript: raw.transcript ?? null` de `fila`
```

La columna permanece (borrarla es migración con pérdida). Nadie la lee. Si molesta en `SELECT *`, se dropea en la migración siguiente.

Regla permanente: **el transcript no entra al contexto del modelo.** Eso reduce la superficie de inyección a `summary` y `privateNotes`, que son los campos que escribe el humano.

---

## 7. Lo que NO se transforma

| Tentación | Por qué no |
|---|---|
| Reescribir `server.ts` (54 KB) | No es el problema. Extraer sólo lo que las tools necesitan |
| LangChain / LangGraph / CrewAI | Los frameworks llevan al 80% y después obligan a reescribir. `ai@7` ya tiene tools + steps |
| Que el agente cambie estados | `permissions.ts` ya dice que no. Es correcto |
| Vector DB / embeddings | LIKE hoy, FTS5 cuando las notas crezcan |
| Multi-agente / orquestación | 12-Factor #10: *small, focused agents*. Uno + tools |
| Autonomía total | El valor está en el rastro, no en que decida solo |

---

## 8. Los tres modos de fracaso

1. **El agente es dueño del estado** → corrupción que no se puede explicar.
   *Mitigación:* plano 1 determinista, `permissions.ts`, tools de escritura gated.
2. **Contexto sin límite** → costo y deriva.
   *Mitigación:* tools, `maxSteps`, presupuesto por turno (`llmCall.costUsd` ya es el medidor).
3. **Autonomía sin auditoría** → no se confía en el reporte y se deja de usar.
   *Mitigación:* trazas por turno, eventos, registro de entregas. **Éste es el que mata proyectos: no es un crash, es abandono.**

---

## 9. Definición de "ERP terminado"

Cinco checks medibles:

1. Cada número de un reporte **traza a filas** (click → fuente).
2. Cada efecto externo tiene un **registro de entrega** con estado.
3. Cada turno del agente tiene una **traza con las tools que llamó**.
4. El agente **no puede** hacer una acción irreversible sin una fila de aprobación humana.
5. Una semana se puede **reconstruir desde los eventos**, sola.

---

## 10. Gasto por turno y por herramienta (D5)

El gasto no se estima: se registra en el punto de la llamada. `llmCall` ya guarda `runId`, `provider`, `model`, `inputTokens`, `outputTokens` y `costUsd` (`trace.ts`, `precio.ts`). Falta atribuir cada llamada a un **paso** y a una **herramienta**.

### Cambio de esquema

Dos columnas nuevas en `llmCall`:

| Columna | Tipo | Qué |
|---|---|---|
| `step_index` | integer, nullable | Paso del loop (1..maxSteps) |
| `tool_name` | text, nullable | Tool que el modelo invocó en ese paso; `null` en el paso de respuesta final |

`agentRun` no necesita un total: se deriva con `SUM(costUsd) GROUP BY runId`.

### Qué responde el sistema

`GET /gasto?runId=`:

```json
{
  "turno": { "runId": "...", "pasos": 3, "tokens": 4820, "usd": 0.0042 },
  "porProveedor": [
    { "provider": "deepseek", "model": "deepseek-flash", "llamadas": 3, "tokens": 4820, "usd": 0.0042 }
  ],
  "porHerramienta": [
    { "tool": "buscar_notas", "llamadas": 1, "usd": 0.0011 },
    { "tool": "ver_reunion", "llamadas": 1, "usd": 0.0013 },
    { "tool": null, "llamadas": 1, "usd": 0.0018 }
  ]
}
```

- **porProveedor** es el pedido explícito: JEV y DeepSeek en la misma tabla, cada uno con su tarifa.
- **porHerramienta** atribuye el costo de *decidir y leer* cada tool. Una llamada a JEV hecha dentro de `buscar_notas` cae en `tool: "buscar_notas", provider: "jev"`.
- **porPaso** es la misma data sin agrupar, para el modal de etapas del chat.

Vista global `/gasto` (hoy / semana / mes) por proveedor y por tool, más el tope diario leyendo el mismo `SUM`.

### Dos agujeros de `precio.ts` que hay que tapar

1. `TARIFAS` está indexado por nombre de modelo (`deepseek-flash`). Un modelo con prefijo o con otro nombre devuelve **0 en silencio**. La vista debe marcar la fila como *tarifa desconocida* cuando `costUsd = 0 && tokens > 0`.
2. JEV cobra por llamada y `JEV_USD_PER_CALL` arranca en **0**. Si no se configura, JEV aparece gratis y el desglose miente. Se documenta y se exige en `.env` cuando JEV esté en uso.

### Presupuesto

- `maxSteps = 6` (duro, en el loop).
- Tope por turno: `SUM(costUsd)` del run > USD 0.05 → corta.
- Tope diario: `SUM(costUsd)` de hoy > USD 2 → rechaza turnos nuevos.
- Los tres leen `llmCall`. No hay contador aparte: una sola fuente de verdad para el dinero.

---

## 11. El ejecutor: OpenCode y T3 (D3 = A)

El ERP no embebe el loop de ninguno. `RepoWorker` (`src/infra/opencode/types.ts:31`) es el puerto y tendrá **dos implementaciones**:

```ts
run({ repoPath, prompt, mode }) → { text, sessionId, tokens, contaminado }
```

| Adaptador | Implementación | `sessionId` |
|---|---|---|
| OpenCode | `createOpenCodeWorker` (ya existe) | sesión de OpenCode |
| T3 | `createT3Worker` (nuevo) | hilo de T3 |

Tres consecuencias de tener dos:

1. **`git-guard.ts` sube a `src/infra/executor/`.** Es snapshot-based, no confía en el adaptador. Si viviera dentro de OpenCode, T3 quedaría sin guardia.
2. **`RepoWorker` gana `capabilities()`** con `readOnly: boolean`. La regla `explore ≠ edit` deja de ser un chequeo de nombres de agente y pasa a ser: *el adaptador que corre en `mode: "explore"` debe declarar `readOnly: true`*. `resolverAgente` (`worker.ts:20`) queda como validación específica de OpenCode.
3. **Ruteo por repo:** columna `repo.executor` (`'opencode' | 't3'`), default por entorno. Así `my_erp` puede ir a T3 y `Landing` a OpenCode sin tocar código.

Flujo (igual para los dos):

```
ítem → dispatch (RepoWorker) → sesión → resultado → evidencia → ready_for_review → [humano aprueba] → done
```

Ya existe para `broadcast` a nivel de tema; se generaliza por ítem.

---

## 12. Orden de fases

| Fase | Qué | Prueba de que sirvió |
|---|---|---|
| **F1** | Tools de lectura + loop. Borrar `foto()`, `CATALOGO` (`consulta.ts:50`), `SIIGO` (`:62`). `maxSteps` y tope USD desde el primer commit | Una pregunta que la foto no podía responder ("¿qué dijo Persona_#%& del deadline?") se responde con `buscar_notas` + `ver_reunion` |
| **F2** | Memoria de conversación (`conversation`, `conversation_message`) | "Y de ese proyecto, ¿qué falta?" funciona |
| **F3** | Log de eventos (`itemEvent`) + `step_index`/`tool_name` en `llmCall` + `toolCall` | El gasto de un turno se desglosa por proveedor y por herramienta |
| **F4** | Write-tools gated (emiten eventos) | El agente no puede cambiar estado sin aprobación |
| **F5** | Outbox + correo (`report` → `reportDelivery`) | Un reintento no duplica el envío |
| **F6** | Loop proactivo semanal | El lunes hay un reporte de drift sin que lo pidas |
| **F7** | MCP + skills | El ERP se consulta desde T3/OpenCode |

Dependencias: F1 no bloquea nada; F3 va antes de F4 para que las escrituras emitan eventos; F5 depende de F3 (el reporte se arma desde eventos y estado); F6 depende de F5.

Fuera de alcance por ahora: vector search, multi-agente, event sourcing completo, migración R1-R7 de `analisis-brechas.md` (es deuda paralela, no bloqueante).

---

## 13. Decisiones cerradas

Cerradas el 2026-11-24.

| # | Decisión | Elegido | Consecuencia |
|---|---|---|---|
| D1 | Entrega del reporte | In-app siempre; correo opcional por outbox | F5 agrega vista de reporte; el envío es un efecto externo |
| D2 | Ítems del agente | L1 dentro de `draft`; L2 fuera de `draft` | La regla vive en `permissions.ts`, no en cada tool |
| D3 | Ejecutores | OpenCode **y** T3 | `git-guard` a capa compartida, `capabilities()`, `repo.executor` |
| D4 | Estado y eventos | Log append-only + estado como verdad de lectura | Una transacción escribe ambos |
| D5 | Presupuesto y gasto | `maxSteps` + tope USD turno/día + gasto por proveedor y por tool | `step_index` y `tool_name` en `llmCall` |

---

## Fuentes

- Anthropic, [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) (2024).
- HumanLayer, [12-Factor Agents](https://github.com/humanlayer/12-factor-agents).
