# Refactorización: de un solo conjunto de notas a múltiples proyectos y reuniones

> Este documento es un **delta sobre lo que ya está construido**, no un reinicio. Complementa `erp-brief-opencode.md` y `fase-temas-triaje-desglose.md`. Lee primero el código actual y sigue la sección 0 antes de cambiar nada.

## 0. Reglas de trabajo para OpenCode

1. **Primero un análisis de brechas.** Compara lo construido con el objetivo de este documento y escribe `docs/analisis-brechas.md`: qué ya cumple, qué cambia, qué se elimina, riesgos. **Espera mi aprobación** antes de migrar.
2. Migra **por pasos** (sección 9), con tests en cada uno. No avances si el paso anterior no cumple su criterio de aceptación.
3. **No se pierde ningún dato existente.** Las migraciones son reversibles y se verifica con conteos antes y después.
4. No registres contenido de notas ni transcripciones en logs. No pongas secretos en el repo.
5. Si algo no se puede verificar (por ejemplo una capacidad de OpenCode o de Granola), dilo y repórtalo; no lo supongas.

## 1. Problema

Hoy el sistema funciona como si existiera **un único conjunto de notas**: una bandeja, una rúbrica, una vista de repositorios. Voy a tener muchas reuniones, varios proyectos y varios repositorios por proyecto. Además, la trazabilidad de lo que hace OpenCode por cada ítem está desordenada.

## 2. Principios

- **El Proyecto es la raíz.** Reuniones, temas, ítems y repositorios se entienden dentro de un proyecto.
- **La reunión es la unidad de entrada.** Todo nace de una reunión concreta, identificada y persistida.
- **Nada global ni implícito.** Ninguna función asume "la reunión actual" o "la rúbrica actual"; todo se resuelve por identificadores.
- **El avance se calcula, no se escribe.** Sale de los ítems, no de un campo manual.
- **Todo direccionable y consultable.** Cada entidad se puede leer por id y filtrar (esto prepara el asistente con contexto, sección 8).

## 3. Modelo objetivo

Entidades **nuevas**:

| Entidad | Campos principales |
|---|---|
| `project` | `id`, `name`, `description`, `status` (`active`/`paused`/`done`), `created_at` |
| `repository` | `id`, `name`, `location`, `description` (qué contiene; sirve para sugerir repos por ítem), `default_branch` |
| `project_repository` | `project_id`, `repository_id` (un repo puede servir a varios proyectos) |
| `item_repository` | `item_id`, `repository_id`, `status` (`suggested`/`confirmed`/`rejected`), `reason` |
| `agent_session` | `id`, `item_id`, `repository_id`, `opencode_session_ref`, `status` (`queued`/`running`/`awaiting_input`/`completed`/`failed`/`cancelled`), `started_at`, `ended_at`, `summary`, `plan_md` |
| `session_event` | `id`, `session_id`, `kind` (`request`/`plan`/`tool_summary`/`file_touched`/`commit`/`message`/`error`), `body`, `ref`, `created_at` |

Entidades **modificadas**:

| Entidad | Cambio |
|---|---|
| `meeting` | `granola_note_id` (único), `notes` (lo principal), `transcript` (se guarda, opcional), `has_transcript`, `status` (`imported` → `topics_extracted` → `triaged`), `project_id` opcional (proyecto por defecto) |
| `topic` | `project_id` (la IA lo sugiere, yo lo confirmo; obligatorio para pasar a `selected`), `context_note` (contexto adicional que escribo o dicto), `context_source` (`text`/`voice`) |
| `rubric` | Pasa a ser **semanal** y única por semana y versión (`week_start`, `version`); puede contener ítems de varios proyectos |
| `rubric_item` | `project_id` obligatorio, `context_note`, `split_from_item_id` (ver siguiente punto) |

Reglas del modelo:

- **Ítems mixtos (código + alcance mío):** se parten en **dos ítems enlazados** (`split_from_item_id`). No existe un tipo mixto.
- **Archivo de ideas:** sigue siendo la vista de temas `parked`, ahora filtrable por proyecto.
- **Avance** (por proyecto, por semana y acumulado) = ítems `done` sobre total, desglosado por tipo. Es una **vista derivada**, no una tabla editable.

## 4. Módulos y navegación

1. **Proyectos:** lista de proyectos, repositorios de cada uno, avance y qué falta para completarlo.
2. **Reuniones:** lista con filtros (proyecto, estado, fecha). Cada reunión abre su detalle: notas, temas, estado.
3. **Rúbrica semanal:** ítems agrupados por proyecto y por tema.
4. **Ideas:** el archivo de temas postergados.
5. **Ítem:** contexto adicional, repos sugeridos, sesiones de OpenCode y su línea de tiempo.

## 5. Flujo de "Nueva reunión" con Granola

El ERP actúa como **cliente MCP** y se conecta al MCP de Granola de mi usuario.

1. Pulso **Nueva reunión** → **Buscar en Granola**. Aparece un estado de carga con tiempo límite.
2. Se listan las últimas notas (por ejemplo las 10 más recientes), marcando las **ya importadas** para no duplicar.
3. Elijo una. El sistema guarda **notas y transcripción** (si el plan no ofrece transcripción, se guardan solo las notas y se marca `has_transcript = false`).
4. La reunión queda `imported`. Pulso **Detectar temas** (bajo demanda, nunca automático) → `topics_extracted`.
5. Triaje: `selected` (con proyecto asignado), `parked` o `discarded`. Al terminar → `triaged`.
6. Por cada tema seleccionado, el sistema me **pide contexto adicional** (escrito o dictado) y con eso genera los ítems.

Reglas: idempotencia por `granola_note_id`; error claro si la autenticación con Granola expiró (con acción para reconectar); si falla la conexión, puedo importar pegando el texto a mano.

## 6. Ítems, repositorios y sesiones de OpenCode

1. Cada ítem se clasifica como **código** o **alcance mío** (la IA sugiere, yo confirmo).
2. En un ítem de código abro el detalle y agrego contexto. El sistema **sugiere repositorios** entre los del proyecto (usando `repository.description`); yo confirmo o rechazo cada uno.
3. Por cada repo confirmado se crea una `agent_session`: el ERP le pide a OpenCode, por MCP, qué corresponde hacer en ese repo para cumplir el ítem.
4. **Trazabilidad:** cada sesión muestra su estado y una **línea de tiempo de eventos estructurados** (qué se le pidió, qué plan propuso, qué archivos tocó, qué commits dejó). El log crudo queda como enlace aparte, solo para depurar.
5. **A investigar (y reportar antes de decidir):** si OpenCode permite que el ERP **lance y observe** sus sesiones (por ejemplo con un modo servidor o un SDK con eventos) o solo recibe lo que OpenCode reporte por MCP. Con lo primero la visibilidad es mucho mayor. Documenta la opción elegida con fuentes en `docs/decision-sesiones.md`.
6. La regla del brief principal se mantiene: OpenCode solo puede dejar un ítem en `ready_for_review`; el `done` es mío.

## 7. Migración de lo existente

- Crear un proyecto "General" y asignarle todos los temas, ítems, rúbricas y repositorios actuales.
- Migraciones reversibles y script de verificación (conteos por entidad antes y después).
- Mantener funcionando los flujos actuales durante la transición; no se retiran hasta que los nuevos cumplan su criterio.

## 8. Preparación para el asistente con contexto (fuera de esta refactorización)

El asistente (chat y dashboard) se diseñará aparte, pero esta refactorización debe dejarle el terreno listo:

- Una **capa de consulta de solo lectura**: funciones para proyectos, avance, reuniones, temas, rúbricas, ítems y sesiones, con filtros. Sin SQL libre.
- Que el asistente arme el contexto **por pregunta** (trae solo lo que hace falta), no volcando todo.
- Cada respuesta debe poder citar de qué entidades salió.

## 9. Pasos y criterios de aceptación

| Paso | Entregable | Aceptación |
|---|---|---|
| R0 | `docs/analisis-brechas.md` | Documento aprobado por mí |
| R1 | `project`, `repository`, `project_repository` + migración a "General" | Conteos iguales antes y después; flujos actuales intactos |
| R2 | Módulo Reuniones multi-reunión (lista, filtros, estados, detalle) | Puedo tener varias reuniones sin que se mezclen sus temas |
| R3 | Flujo "Nueva reunión" con Granola | Importa sin duplicar; maneja autenticación expirada y falta de transcripción |
| R4 | Temas con proyecto y contexto adicional; ideas por proyecto | No puedo seleccionar un tema sin proyecto; el contexto se guarda |
| R5 | Rúbrica semanal multi-proyecto; ítems con repos sugeridos | Un ítem mixto se parte en dos enlazados; repos confirmados por mí |
| R6 | `agent_session` + `session_event` + línea de tiempo | Veo estado y eventos de cada sesión; decisión documentada |
| R7 | Avance por proyecto (vista derivada) | El avance coincide con el conteo de ítems `done` |

## 10. Fuera de alcance

- Chat, dashboard con UI generativa y el asistente con contexto (sección 8 solo prepara el terreno).
- Multiusuario y permisos por rol.
- Priorización automática y deduplicación semántica de temas.

## 11. Decisiones abiertas

1. **Rúbrica:** propuesta actual = una rúbrica **semanal única** con ítems de varios proyectos (porque es la que reviso con mis jefes). Alternativa: una rúbrica por proyecto y semana.
2. **Reunión con varios proyectos:** propuesta = el proyecto se asigna **por tema**, no por reunión (la reunión solo tiene un proyecto por defecto opcional).
3. **Dictado por voz:** si basta el dictado del navegador o se requiere un servicio de transcripción.
4. **Repositorios compartidos** entre proyectos (propuesto como muchos a muchos).
