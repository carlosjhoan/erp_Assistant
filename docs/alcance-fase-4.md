# Fase: extracción de temas, triaje y desglose en ítems

> Documento de alcance **solo de esta fase**, para evaluarla rápido. Se inserta entre la ingesta de apuntes y la aprobación de la rúbrica del brief principal (`erp-brief-opencode.md`). No depende de un stack concreto.

## 1. Problema y objetivo

En una reunión se hablan varios temas, pero solo uno o pocos son el alcance de la semana siguiente. Generar la rúbrica directamente desde las notas mezcla alcance con ideas sueltas.

**Objetivo:** que el sistema proponga los temas centrales de la reunión, que yo decida cuáles son alcance de la semana y cuáles van al archivo de ideas, y que solo sobre los elegidos se proponga el desglose en ítems para revisar la rúbrica.

## 2. Flujo

1. **Apuntes → temas propuestos.** La IA extrae los temas centrales (título + descripción).
2. **Triaje (humano).** Cada tema se marca `selected` (alcance de la semana), `parked` (archivo de ideas) o `discarded`.
3. **Temas seleccionados → ítems propuestos.** La IA desglosa cada tema en ítems con criterio de aceptación.
4. **Revisión y aprobación de la rúbrica** (ya definida en el brief principal).

Hay tres compuertas humanas (triaje, edición de ítems, aprobación). La IA propone y ordena; nunca decide el alcance.

## 3. Modelo de datos

### Entidad nueva: `topic`

| Campo | Descripción |
|---|---|
| `id`, `created_at` | Identificador y fecha |
| `meeting_id` | Reunión de origen |
| `title`, `description` | Título corto y descripción de 2 a 4 frases |
| `source_excerpt` | Cita literal del apunte que respalda el tema |
| `scope_signal` | `likely_scope` o `idea_context` (sugerencia de la IA) |
| `scope_reason` | Una frase que justifica la sugerencia |
| `open_questions` | Preguntas por resolver con mis jefes (opcional) |
| `needs_review` | `true` si la cita no se pudo verificar en el texto |
| `status` | `proposed`, `selected`, `parked`, `discarded` |
| `origin` | `agent` o `manual` |
| `rubric_id` | Rúbrica a la que pertenece; nulo hasta que se selecciona |
| `merged_into_topic_id` | Si se fusionó en otro tema |
| `decided_at`, `decided_by` | Cuándo y quién decidió el estado |

### Cambio en `rubric_item`

Se añade `topic_id` (tema del que sale el ítem) y `human_edited` (booleano). Jerarquía resultante: **rúbrica → tema → ítems**.

### Archivo de ideas

No tiene tabla propia: es la vista de los temas con `status = parked`.

## 4. Estados y reglas

```
proposed ──► selected ──► (rúbrica aprobada: bloqueado)
   │            │
   ├──► parked ◄┘          parked ──► selected  (promoción a otra semana)
   └──► discarded          discarded ──► proposed (deshacer)
```

- Seleccionar un tema exige indicar la `rubric_id` (borrador) a la que entra.
- Mientras la rúbrica esté en `draft` se puede mover un tema entre `selected` y `parked`.
- Con la rúbrica `approved`, sus temas quedan bloqueados (misma regla de inmutabilidad del brief principal; los cambios van en una versión nueva).
- **Promover una idea** (`parked → selected`) la asigna a la rúbrica en borrador de otra semana. Se conserva su reunión de origen.
- **Fusionar** temas: el tema absorbido pasa a `discarded` con `merged_into_topic_id` apuntando al destino.
- Una rúbrica **no se puede aprobar** si tiene un tema `selected` sin ningún ítem.

## 5. Contratos de salida de la IA

La IA debe devolver **salida estructurada validada contra un esquema** (no texto libre).

### 5.1 Extracción de temas (por reunión)

Por cada tema: `title` (hasta 80 caracteres), `description`, `source_excerpt`, `scope_signal`, `scope_reason`, `open_questions`.

Reglas:
- Máximo **10 temas**. Fusionar duplicados y temas casi idénticos.
- Marcar `likely_scope` solo con señales claras: compromiso explícito, fecha ("para la próxima semana"), entregable nombrado o algo asignado a mí. Si no hay señal, `idea_context`.
- Cada tema lleva `source_excerpt`; el servicio **verifica que exista** en el texto (coincidencia exacta o difusa con umbral). Si no, `needs_review = true`; no se descarta en silencio.
- Si el alcance es ambiguo, la IA lo dice en `open_questions`.

### 5.2 Desglose en ítems (por tema seleccionado)

Por cada ítem: `title`, `description`, `acceptance_criteria`, `suggested_type` (`code`, `contact`, `research`, `other`), `too_large` (booleano) y `source_excerpt`.

Reglas:
- De **3 a 7 ítems** por tema.
- Cada ítem debe poder hacerse dentro de la semana; si parece demasiado grande, se marca `too_large` para que yo lo parta.
- Los ítems se crean en la rúbrica en `draft` con `origin = agent`.

## 6. Operaciones que debe exponer el sistema

(Sirven igual por CLI, API o MCP; el stack lo decide la Fase de investigación.)

| Operación | Descripción |
|---|---|
| `extract_topics(meeting_id)` | Genera temas `proposed`. Reejecutarla reemplaza solo los `proposed`; no toca los ya decididos |
| `list_topics(week?, status?)` | Bandeja de triaje: temas de **todas** las reuniones de la semana |
| `update_topic(id, title?, description?)` | Editar antes de decidir |
| `set_topic_status(id, status, rubric_id?)` | Seleccionar, aparcar, descartar o deshacer |
| `merge_topics(source_ids, target_id)` | Fusionar duplicados |
| `create_topic(meeting_id?, title, description)` | Agregar un tema a mano (`origin = manual`) |
| `list_ideas()` | Archivo de ideas (`parked`) |
| `promote_idea(topic_id, rubric_id)` | Llevar una idea a la rúbrica de otra semana |
| `generate_items(topic_id)` | Propone los ítems del tema |

Regenerar ítems (`generate_items`) solo reemplaza los ítems `origin = agent` con `human_edited = false`. Nunca pisa lo que edité o agregué.

## 7. Casos borde

- **Reunión sin temas claros:** 0 temas propuestos, aviso claro y opción de crear uno a mano.
- **Solo hay resumen, sin transcripción:** se extrae igual y se marca el tema como de menor confianza.
- **Varias reuniones en la semana:** una sola bandeja de triaje con duplicados fusionables.
- **Reimportar o reextraer:** no duplica temas ni pisa mis decisiones.
- **Tema `selected` sin ítems:** bloquea la aprobación de la rúbrica.
- **Respuesta de la IA que no cumple el esquema:** se reintenta una vez; si falla, error claro y el sistema sigue usable (puedo crear temas e ítems a mano).

## 8. Criterios de aceptación

1. Dada una reunión de prueba, se generan hasta 10 temas con título, descripción y cita verificada.
2. Un tema con cita que no existe en el texto queda con `needs_review = true`.
3. Puedo marcar temas como `selected`, `parked` o `discarded`, y deshacer un descarte.
4. `list_ideas()` devuelve exactamente los temas `parked`, y `promote_idea` los mueve a otra rúbrica.
5. Solo los temas `selected` generan ítems; cada ítem queda enlazado a su `topic_id`.
6. Reejecutar la extracción no duplica temas ni altera los ya decididos.
7. Regenerar ítems no pisa los que edité a mano.
8. No se puede aprobar una rúbrica con un tema seleccionado sin ítems.
9. Los permisos y estados tienen tests automáticos.

## 9. Fuera de alcance (por agilidad)

- Puntuación automática de prioridad y deduplicación semántica entre semanas.
- Historial detallado de las promociones de ideas (solo se guarda `decided_at` y `decided_by`).
- Interfaz elaborada: basta una lista con selección (CLI o vista simple).
- Que el agente resurja ideas relevantes por su cuenta al planear una semana nueva (ver decisión abierta).

## 10. Decisión abierta

**Archivo de ideas:** por defecto, en el MVP es **solo consultable** y promover una idea es una acción manual mía. La alternativa es que, al iniciar la planeación de una semana, el agente me sugiera ideas aparcadas relacionadas con los temas nuevos.
