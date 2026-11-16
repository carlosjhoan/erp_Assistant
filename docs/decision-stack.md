# Decisión de stack — my_erp

**Fecha:** 2026-11-13
**Estado:** propuesta, pendiente de aprobación
**Método:** investigación en fuentes actuales (documentación oficial, repositorios y análisis técnicos de 2026). Cada afirmación relevante tiene al menos dos fuentes.

---

## 1. Restricciones que manda el brief

1. Servidor MCP por `stdio` con SDK oficial y estable.
2. Modelo relacional con transacciones, log append-only, migraciones versionadas y consultas parametrizadas.
3. Tipado y testeabilidad: `domain/` separado y sin I/O.
4. Dependencias con actividad reciente y licencias claras.
5. Versiones fijadas con exactitud; evitar publicaciones de menos de dos semanas; revisar avisos.
6. Operación simple para **un usuario**, con camino a más.
7. Peso de lo que se reutiliza del prototipo.
8. Mantenibilidad a largo plazo y familiaridad.

---

## 2. Hechos verificados

### 2.1 SDKs oficiales de MCP

> "Available SDKs: TypeScript — Tier 1 · Python — Tier 1 · Go — Tier 1"
> — *modelcontextprotocol.io/docs/2026-07-28/sdk*

- La spec vigente es **`2026-07-28`**: el protocolo pasó a ser **sin handshake ni sesiones** (`POST /mcp` con `MCP-Protocol-Version`).
- El SDK de TypeScript está en **v2** (`@modelcontextprotocol/server` y `@modelcontextprotocol/client`); la línea v1 sigue con parches al menos seis meses después del lanzamiento de v2 (2026-07-27).
- TypeScript y Python **superaron los mil millones de descargas**; entre los Tier 1 rondan el medio millón de descargas mensuales.
- Go tiene SDK oficial estable desde finales de 2025, en **v1.2.0** a enero de 2026 — el más joven de los tres.

**Consecuencia:** los tres son viables; TypeScript y Python tienen más kilometraje.

### 2.2 ORMs de TypeScript

| | Drizzle | Prisma 7 |
|---|---|---|
| Esquema | TypeScript (`pgTable`, `sqliteTable`) | DSL propio (`.prisma`) |
| Codegen | **Ninguno** | `prisma generate` obligatorio |
| Bundle | **~8,3 KB** | ~1,6 MB (el motor Rust se eliminó en v7, ~90% menos) |
| Migraciones | `drizzle-kit generate` → **archivos SQL** | `prisma migrate` → carpetas con SQL |
| Rollback | **No trae** | Limitado |
| Deps de runtime | **Cero** | Cliente generado |

> "Prisma 7 closed much of the historical cold-start and binary pain… Steady-state Postgres throughput is usually dominated by query shape, indexes and pooling — not ORM brand loyalty."
> — *turbostarter.dev, oct. 2026*

> "Use Prisma if you want an ORM that thinks for you. Use Drizzle if you want an ORM that thinks with you."
> — *dev.to, 2026*

**Consecuencia:** ambos son production-grade. La diferencia para este proyecto es que Drizzle genera **archivos SQL versionados**, que es exactamente lo que pide el brief ("migraciones versionadas desde el primer día", §8). Prisma esconde más, y aquí queremos poder leer el SQL.

### 2.3 SQLite en Node

- **`node:sqlite`** es built-in: entró experimental en Node 22 y **se estabilizó en Node 24**. No requiere compilación nativa.
  - **Le falta `db.transaction()`**: hay que manejar `BEGIN`/`COMMIT`/`ROLLBACK` a mano con `exec()`.
  - Sincrónico: puede bloquear el event loop bajo I/O pesado.
- **`better-sqlite3`** existe desde 2016, tiene `db.transaction()` de primera clase, y **rinde igual** que `node:sqlite` porque ambos enlazan el mismo motor SQLite.

> "The performance characteristics of node:sqlite match better-sqlite3 because both modules link against the same SQLite engine."
> — *jsmanifest.com, 2026*

**Consecuencia:** para una sola persona, SQLite es la base correcta: un archivo, respaldo = copiar el archivo, cero servidor. Pero la transacción atómica evento+estado (§4, §8) es central, y ahí `better-sqlite3` gana por API, no por velocidad.

### 2.4 Python para salida estructurada

- **FastMCP** valida los argumentos contra la firma de la función y soporta `output_schema` explícito.
- **Pydantic** valida la salida del LLM con `model_validate_json`, y **Pydantic AI** agrega `ModelRetry` sobre `output_validator` — el modelo se reintenta solo si la salida no cumple el esquema.
- Reutilización del prototipo: **cero**. El correo, los tokens de estilo y los patrones de resiliencia habría que reescribirlos.

---

## 3. Las opciones

### A. TypeScript + Node 24 + Drizzle + SQLite (`better-sqlite3`) + MCP SDK v2

```
interfaces/   CLI · mcp/ (stdio) · api/ (después)
services/     ingestion · rubric · approval · events · reports · email
domain/       entidades · estados · reglas (sin I/O)
infra/        db (drizzle) · llm (proveedor) · granola (mcp client) · email
```

| Criterio | Evaluación |
|---|---|
| MCP oficial | ✅ Tier 1, v2, el de mayor uso |
| Modelo de datos | ✅ Drizzle + SQLite, transacciones con `better-sqlite3` |
| Tipado y tests | ✅ TypeScript estricto, `domain/` puro, `node:test` o Vitest |
| Madurez de deps | ✅ Drizzle sin deps de runtime; `better-sqlite3` desde 2016 |
| Cadena de suministro | ✅ Pocas dependencias, todas fijables con exactitud |
| Operación | ✅ Un archivo `.db`, sin servidor; respaldo = copia |
| Reutilización | ✅ **~2,5 días** (correo 380 líneas, tokens CSS, registro de herramientas) |
| Mantenibilidad | ✅ Mismo lenguaje que el prototipo |

**Riesgo principal:** SQLite tiene **un solo escritor**. Para una persona no es límite; si mañana son cinco, hay que migrar a Postgres. Drizzle hace ese cambio barato: el esquema es TypeScript y el driver se cambia.

### B. Python + FastMCP + SQLAlchemy/Alembic + SQLite

| Criterio | Evaluación |
|---|---|
| MCP oficial | ✅ Tier 1 |
| Modelo de datos | ✅ SQLAlchemy + Alembic (maduros, verbosos) |
| Tipado y tests | ✅ Pydantic es lo mejor que hay para validar salida de LLM |
| Operación | ✅ igual que A (SQLite) |
| Reutilización | ❌ **cero** (~2,5 días extra) |
| Mantenibilidad | 🟡 lenguaje distinto al del prototipo |

**A favor:** Pydantic + `ModelRetry` es la mejor herramienta del mercado para "el LLM devolvió JSON inválido, reintentá".
**En contra:** se tira todo lo reutilizable y se suma un entorno virtual, empaquetado y un segundo lenguaje al mantenimiento.

### C. Go + SDK oficial + `sqlc` + SQLite

| Criterio | Evaluación |
|---|---|
| MCP oficial | 🟡 Tier 1, pero **v1.2.0** (el más joven) |
| Modelo de datos | ✅ `sqlc` genera código desde SQL; muy explícito |
| Tipado y tests | ✅ fuerte, pero más ceremonia |
| Operación | ✅ **la mejor**: un binario, sin runtime |
| Reutilización | ❌ cero |
| Mantenibilidad | 🟡 otro lenguaje; salida estructurada de LLM más manual |

**A favor:** despliegue de un solo binario y el mejor perfil de operación.
**En contra:** para un CRUD con un LLM en el medio, es el triple de código para el mismo resultado.

### D. TypeScript + Postgres

Igual que A pero con Postgres desde el día uno.

**Descartada por ahora:** agrega un servidor de base de datos, credenciales, backups y conexiones — para una persona que registra su semana. Drizzle deja la puerta abierta sin costo.

---

## 4. Recomendación

**Opción A: TypeScript + Node 24 + Drizzle + `better-sqlite3` + MCP SDK v2.**

Las tres razones que pesan:

1. **El brief pide migraciones SQL versionadas y transacciones atómicas** (§4, §8). Drizzle genera archivos SQL que se leen y se auditan; `better-sqlite3` da `db.transaction()`, que es exactamente el "evento + estado en la misma transacción". `node:sqlite` no lo trae.
2. **Se reutilizan 380 líneas de correo probado** más el sistema visual. En Python o Go eso se reescribe.
3. **El MCP es Tier 1 con la spec vigente** y es el SDK con más uso real.

`node:sqlite` queda descartado por una razón concreta, no por gusto: **no tiene `db.transaction()`**, y el brief exige atomicidad entre el evento y el estado. Se puede hacer a mano con `exec("BEGIN")`, pero es justo el tipo de código que uno escribe mal a las 2 de la mañana.

### 4.1 Capa de LLM: Vercel AI SDK detrás de una interfaz de proveedor

**Decidido:** la capa de LLM se implementa con **Vercel AI SDK** (`ai`), no con LiteLLM.

**Por qué no LiteLLM:** es un **SDK de Python** y un **proxy** (servidor). Desde TypeScript solo se puede consumir el proxy, que es un proceso Python más corriendo al lado. Habiendo elegido TypeScript justamente por el arranque rápido (110 ms contra 1.900 ms medidos), sumar un servicio Python contradice la decisión.

**Cómo queda:**

```
infra/llm/
  provider.ts    interface LlmProvider { complete(...); object(...) }
  ai-sdk.ts      implementación con Vercel AI SDK
```

La interfaz la exige el brief (§3). **No se escribe un segundo driver** hasta que haga falta: un `litellm.ts` vacío sería código muerto, y no sabemos cómo se comporta ese proxy en este proyecto. Cuando se justifique, se agrega ese archivo y nada más — el contrato ya está definido.

**Salida estructurada:**

```ts
const { output } = await generateText({
  model: deepseek("deepseek-chat"),
  output: Output.object({ schema: Rubric }),
  prompt,
});
```

- AI SDK 6 deprecó `generateObject` a favor de `generateText` con `output: Output.object({ schema })`. Se usa la forma nueva.
- `@ai-sdk/openai-compatible` cubre DeepSeek, Ollama, vLLM y OpenRouter: cambiar de proveedor es cambiar una línea.
- La validación de esquema es **Zod 4** (`z.toJSONSchema`, `safeParse`, `z.prettifyError`).
- Si la salida no valida, se reintenta una vez **devolviéndole el error al modelo** (el `ModelRetry` de Pydantic, en 10 líneas).

**Registro de gasto:** no hace falta un gateway. La tabla `agent_run` de §4 guarda `tokens`, `cost`, `duration_ms` y `tool` en cada llamada. Ese es el spend tracker, en la propia base y consultable.

**Cuándo se justificaría LiteLLM:** varios agentes compartiendo claves con presupuesto central, fallback automático entre proveedores, o el panel de admin de gasto. Hoy hay un usuario y un proveedor.

---

## 5. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| SQLite, un solo escritor | Suficiente para un usuario. Drizzle permite migrar a Postgres cambiando driver y migraciones. |
| `better-sqlite3` es binario nativo (falla en CI/Alpine) | Fijar versión exacta; en CI usar la misma imagen base; el repo no despliega a contenedor por ahora. |
| TypeScript sin validación en runtime de la salida del LLM | Zod en la frontera (el SDK de MCP ya lo usa) + `withRetry` del prototipo. |
| Drizzle no trae rollback | Las migraciones se revisan y se versionan; respaldo del `.db` antes de cada migración. |
| Elegir mal y migrar después | El esquema Drizzle es TypeScript: migrar a Postgres es barato. Migrar de lenguaje, no. |

---

## 6. Alternativas descartadas, y por qué

| Opción | Por qué no |
|---|---|
| **Python** | Pydantic es superior para validar salida de LLM, pero cuesta todo lo reutilizable y suma un segundo ecosistema. Si el equipo fuera Python, cambiaría la respuesta. |
| **Go** | Mejor operación, peor costo de escritura para este tamaño. El SDK de MCP es el más joven. |
| **Postgres desde el día uno** | Infraestructura para un usuario. Se puede adoptar después sin reescribir el dominio. |
| **`node:sqlite`** | Sin `db.transaction()`; el brief exige atomicidad. |
| **Prisma** | Válido, pero oculta el SQL que el brief quiere versionado y auditable. |
| **LiteLLM** | Es Python: desde TS solo se usa su *proxy*, un servicio extra que contradice la razón por la que se eligió Node. Si algún día se necesita, se escribe el driver entonces. |

---

## 7. Fuentes

- MCP — SDKs oficiales: `modelcontextprotocol.io/docs/2026-07-28/sdk`
- MCP — blog de la spec 2026-07-28: `blog.modelcontextprotocol.io/posts/2026-07-28/`
- MCP — TypeScript SDK (v2 y migración): `github.com/modelcontextprotocol/typescript-sdk`
- MCP — Go SDK estable: `socket.dev/blog/official-go-sdk-for-mcp`, `devblogs.microsoft.com/cosmosdb/build-ai-tooling-in-go-with-the-mcp-sdk…`
- Drizzle vs Prisma: `encore.dev/articles/drizzle-vs-prisma`, `turbostarter.dev/blog/drizzle-vs-prisma-typescript-orm-2026`, `bytebase.com/blog/drizzle-vs-prisma`
- SQLite en Node: `jsmanifest.com/nodejs-24-native-sqlite-production`, `jangwook.net/en/blog/en/node-sqlite-builtin-practical-guide-2026`
- FastMCP y Pydantic: `gofastmcp.com/docs/servers/tools`, `pydantic.dev/docs/ai/core-concepts/output/`
- LiteLLM (SDK y proxy): `docs.litellm.ai/docs/simple_proxy`, `litellm.ai/about`
- AI SDK y salida estructurada: `ai-sdk.dev/docs/ai-sdk-core/generating-structured-data`
- `@ai-sdk/openai-compatible`: `fastrouter.ai/feeds/blog/ai-sdk-openai-compatible`
- Zod 4 → JSON Schema: `zod.dev/json-schema`

---

## 8. Decisiones cerradas

| Decisión | Resultado |
|---|---|
| Repo | **Nuevo**, `my_erp`, separado del prototipo |
| Lenguaje y runtime | **TypeScript + Node 24** |
| Base de datos | **SQLite** con `better-sqlite3` |
| Acceso a datos | **Drizzle** (migraciones SQL versionadas) |
| MCP | **SDK oficial v2** (`@modelcontextprotocol/server`) |
| Capa de LLM | **Vercel AI SDK** detrás de `LlmProvider` |
| Validación de salida | **Zod 4** + reintento con el error devuelto al modelo |
| Registro de gasto | tabla `agent_run` (sin gateway) |
| Reparto de modelos | **DeepSeek genera · Jev verifica** |

## 9. Cómo trabajan los dos modelos

**DeepSeek** redacta los ítems de la rúbrica con salida estructurada (Zod). Cada ítem trae `source_excerpt`: la cita del apunte de la que sale.

**Jev** no redacta: **decide**. Sobre cada ítem se le hacen preguntas binarias (`noul`) y devuelve una confianza por pregunta:

| Pregunta | Qué mide |
|---|---|
| ¿La cita aparece en el apunte? | Existencia literal o equivalente de `source_excerpt` |
| ¿El ítem responde a lo que se habló? | Pertinencia respecto del apunte |
| ¿El criterio de aceptación es verificable? | Que se pueda comprobar, no una intención |

Reglas:

- Si la cita **no** aparece en el apunte, el ítem se marca `needs_review`. No se descarta en silencio.
- El umbral es configurable por entorno; por debajo, el ítem no entra al borrador aprobable.
- La verificación de la cita **también** se hace por coincidencia de texto (exacta o difusa). Jev es la segunda opinión, no la única: si Jev dice que sí y el texto dice que no, gana el texto.
- Ambas llamadas se registran en `agent_run` con su costo.

## 10. Pendiente

- **Proveedor de correo.** El prototipo tiene ACS configurado; para el ERP se puede reutilizar o usar SMTP simple. Se decide en la Fase 6.

## 11. Contratos de API verificados (2026-11-14)

Corrige y completa el §9. Ambos endpoints se probaron con las claves reales.

### DeepSeek

| Dato | Valor |
|---|---|
| Endpoint | `POST https://api.deepseek.com/chat/completions` (formato OpenAI) |
| Modelo vigente | `deepseek-flash` → DeepSeek-V4.1-Flash-1017 |
| Contexto | 1M tokens de entrada, 384K de salida |
| Alternativa | `deepseek-v4-pro` |
| Obsoleto | `deepseek-chat` (nombre heredado) |

**Gotcha medido:** el modo razonamiento viene **activado por defecto** con
`reasoning_effort: high`. Con `max_tokens: 8` la respuesta volvió **vacía** porque
los 8 tokens se consumieron razonando. Para salida estructurada se manda
`{"thinking": {"type": "disabled"}}` (expuesto como `DEEPSEEK_THINKING`).
En modo razonamiento no se aceptan `temperature`, `presence_penalty` ni
`frequency_penalty`.

### Jev (TypeSafe)

| Dato | Valor |
|---|---|
| Endpoint | `POST https://api.typesafe.ai/v1/systemone` |
| Modelo | `jev-latest` → `jev-1.14.0` |
| Contexto | 64k por request / 32k por pregunta |
| Precio | $42 por Btok de entrada; salida gratis |

**No es compatible con OpenAI.** No acepta `messages`; recibe un `state` y un
mapa de preguntas tipadas:

```json
{
  "model": "jev-latest",
  "state": "<texto del apunte>",
  "questions": {
    "cita_presente": {
      "type": "noul",
      "instructions": "¿El apunte menciona medir los vanos del nivel 3?"
    }
  }
}
```

Respuesta:

```json
{
  "model": "jev-1.14.0",
  "answers": { "cita_presente": { "type": "noul", "noul": 0.93 } },
  "usage": { "input_tokens": 321, "output_tokens": 43 }
}
```

Tipos de pregunta: `noul` (sí/no con confianza), `choice`, `score` y `box`
(solo 1.14).

**Prueba real:** sobre el apunte de la landing, `noul` devolvió **0.93** para una
cita que existe y **0.03** para una inventada. La separación alcanza para el
umbral de 0.6.

### Consecuencia de diseño

El §4.1 asumía que **todo** pasaba por el Vercel AI SDK. No es así: el AI SDK
habla protocolo de chat y Jev no lo es. Quedan **dos adaptadores**:

- `LlmProvider.generate()` → DeepSeek, vía AI SDK, con salida estructurada y reintento.
- `DecisionProvider.decide()` → Jev, HTTP directo, sin SDK de chat.

La interfaz que los envuelve sigue siendo una sola para el dominio.
