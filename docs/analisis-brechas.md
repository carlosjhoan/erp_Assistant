# Análisis de brechas — refactor multi-proyecto

Estado al escribir esto: **14 tablas, 191 tests verdes**, datos reales: 1 reunión, 19 temas, 1 rúbrica, 7 ítems, 8 repos, 3 proyectos, 21 operaciones trazadas.

> Este documento es el entregable **R0**. No se migra nada hasta que esté aprobado.

---

## 1. Qué ya cumple (y en algunos casos va más allá)

| Objetivo del doc | Estado actual | Nota |
|---|---|---|
| `project` | ✅ Existe | Le faltan `description` y `status`. Hoy solo `name` y `path` |
| `repository` con descripción | ✅ `repo` | `path` = `location`. Le falta `default_branch` |
| Idempotencia de reuniones | ✅ Mejor que el doc | `contentHash` detecta cambios de contenido, no solo el id |
| Rúbrica semanal única por semana | ✅ Ya es así | `unique(week_start, version)` |
| Contexto adicional por tema | ✅ Ya existe | Columna `topic.context` |
| Archivo de ideas = `parked` | ✅ | Con vista en `Temas` |
| Clasificar código vs alcance mío | ✅ Pero a nivel **tema** | El doc lo pide por **ítem** |
| Trazabilidad de lo que hace OpenCode | ✅ Parcial | `topic_repo` guarda propuesta, sesión y pasos. Falta la línea de tiempo |
| Fronteras entre repos | ✅ **No lo pide el doc** | `repo.exposes` / `repo.consumes` derivan las superficies compartidas |

**Lo que no está en el documento y ya tenemos:** trazabilidad de cada llamada a modelo (`agent_run` + `llm_call` con prompt y respuesta), clasificación de `owner` por Jev, detección de repos por alcance, y la guardia de git que detecta si el agente modificó un repo.

---

## 2. El conflicto de vocabulario, que es la decisión más importante

Hoy `project` significa **"carpeta que agrupa repos de código"**: Comercial, Gerencial-Brain, Landing.

El documento usa `project` como **"unidad de trabajo a la que pertenecen reuniones, temas e ítems"**, y vincula repositorios por `project_repository`.

**Son conceptos distintos con el mismo nombre.** Hay dos caminos:

**A. Un solo concepto (recomendado).** `project` pasa a ser la unidad de negocio. Los 3 actuales siguen siendo proyectos válidos. Los repos se vinculan por `project_repository` (muchos a muchos). Una reunión y sus temas pertenecen a un proyecto.

**B. Dos conceptos.** `project` (negocio) y `codebase` (carpeta de repos). Más preciso, más tablas, más vocabulario que recordar.

Recomiendo **A** porque:
- Ya tenés exactamente 3 proyectos que son unidades de negocio reales.
- El caso de `my_erp` y `Presentaciones` compartiendo raíz se resuelve con N:M sin inventar una capa.
- Dos conceptos con nombres parecidos es la clase de ambigüedad que después aparece en cada consulta.

---

## 3. Qué cambia

| Entidad | Hoy | Objetivo |
|---|---|---|
| `project` | `name`, `path` | + `description`, `status` (active/paused/done) |
| `repo` → `repository` | `projectId` (1:N) | `project_repository` (N:M) |
| `meeting` | `source`, `externalId`, `summary`, `contentHash` | + `status` (imported → topics_extracted → triaged), + `project_id` opcional |
| `topic` | `context`, `owner` | + `project_id` **obligatorio para `selected`**, + `context_source` |
| `rubric_item` | `topicId`, `repoId` (FK simple), `type` | + `project_id` obligatorio, + `context_note`, + `split_from_item_id`, y `repoId` → `item_repository` |

---

## 4. Qué se agrega

| Entidad nueva | Para qué |
|---|---|
| `project_repository` | Un repo puede servir a varios proyectos |
| `item_repository` | Repos **sugeridos / confirmados / rechazados** por ítem, con motivo. Reemplaza la FK simple |
| `agent_session` | Una sesión de OpenCode por **ítem + repo**, con estado y resumen |
| `session_event` | Línea de tiempo: qué se pidió, qué plan, qué archivos, qué commits |

---

## 5. Qué se retira (con reemplazo)

| Se va | Reemplazado por | Riesgo |
|---|---|---|
| `repo.opencodeSessionId` | `agent_session` (una por ítem) | Bajo: hoy hay 0 sesiones guardadas |
| `rubric_item.repoId` (FK) | `item_repository` | Medio: 7 ítems tienen `repoId` nulo hoy |
| `topic_repo.sessionId` | Se **mantiene** — ver §6 | Ninguno |

---

## 6. La ambigüedad que hay que resolver antes de codificar

El documento define `agent_session` como *"el ERP le pide a OpenCode qué corresponde hacer en ese repo para cumplir el ítem"*.

**Eso ya existe, pero a nivel de tema**: `topic_repo` guarda, por repo, la propuesta con sus pasos, la sesión usada, los tokens y el resultado. De ahí salen los ítems.

Son dos momentos distintos:

```
TEMA ──► topic_repo   (planificación: qué corresponde hacer)
              │
              ▼  vos aprobás
         rubric_item  (los pasos se vuelven ítems)
              │
              ▼  el ítem se implementa
         agent_session  (ejecución: qué hizo OpenCode)
```

**Recomiendo mantener las dos y nombrarlas distinto**, porque miden cosas distintas: una planifica, la otra ejecuta. Fusionarlas obligaría a que el ítem exista antes de saber qué hacer, que es el orden inverso al que ya funciona.

---

## 7. Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| **Vocabulario `project`** | Alto: toca cada consulta | Decidir A o B antes de escribir la migración |
| Migrar `repo.projectId` → N:M | Medio | Script con conteos; los 8 repos conservan su proyecto actual como vínculo |
| `meeting.status` | Bajo | Solo 1 reunión; se calcula a partir de los temas existentes |
| `topic.project_id` obligatorio | Medio | 19 temas: asignar por reunión y dejar "General" como fallback |
| Sesiones huérfanas de OpenCode | Bajo | Hoy 0 registradas |
| **Doble fuente de sesiones** | Medio | Decidir §6 antes de R6 |

---

## 8. Decisiones abiertas (§11 del doc), con mi recomendación

| # | Pregunta | Recomendación | Por qué |
|---|---|---|---|
| 1 | ¿Rúbrica semanal única o una por proyecto? | **Única, multi-proyecto** | Es la que revisás con tus jefes. Ya es así |
| 2 | ¿Proyecto por reunión o por tema? | **Por tema**, con la reunión como default | Coincide con `owner` y con el triaje que ya existe |
| 3 | ¿Voz: navegador o servicio? | **Navegador primero** (`SpeechRecognition`), Whisper después si no alcanza | Cero costo, cero dependencia, y el campo ya es texto |
| 4 | ¿Repos compartidos N:M? | **Sí** | Ya hay un caso real: `my_erp` y `Presentaciones` bajo la misma raíz |

---

## 9. Plan de migración y verificación

Conteos **antes** (verificados ahora):

```
meeting 1 · topic 19 · rubric 1 · rubric_item 7
project 3 · repo 8 · topic_repo 5
agent_run 21 · llm_call 21
```

| Paso | Qué | Verificación |
|---|---|---|
| R1 | `project` + descripción/estado; `project_repository`; vincular los 8 repos | 8 vínculos, 3 proyectos, 0 repos huérfanos |
| R2 | `meeting.status` y `meeting.project_id` | 1 reunión con estado derivado de sus temas |
| R3 | Flujo "Nueva reunión" en la UI (Granola) | Importa sin duplicar; maneja token vencido |
| R4 | `topic.project_id` + `context_source`; ideas por proyecto | 19 temas con proyecto; 0 `selected` sin proyecto |
| R5 | `rubric_item.project_id` + `item_repository`; partir mixtos | 7 ítems con proyecto; `split_from_item_id` probado |
| R6 | `agent_session` + `session_event` | Una sesión por ítem/repo con línea de tiempo |
| R7 | Vista de avance por proyecto | Avance = `done` / total, coincide con el conteo |

Cada paso: migración reversible, conteo antes/después, y los 191 tests actuales en verde.

---

## 10. Lo que cambiaría en la UI

Hoy: Bandeja · Rúbrica · Temas · Repos · Trazas.

Objetivo del doc: **Proyectos · Reuniones · Rúbrica · Ideas · Ítem**.

```
HOY                          OBJETIVO
Bandeja    (todo junto)  →   Proyectos   (raíz: avance y qué falta)
Rúbrica                  →   Reuniones   (lista + detalle + importar)
Temas      (por estado)  →   Rúbrica     (por proyecto y por tema)
Repos                    →   Ideas       (postergados por proyecto)
Trazas                   →   Ítem        (contexto, repos, sesiones)
```

La **Bandeja desaparece como pantalla raíz**: el triaje pasa a ser una etapa dentro del detalle de cada reunión. Eso es lo que el documento llama "nada global ni implícito".

`Repos` y `Trazas` no se pierden: bajan a configuración y a la línea de tiempo de cada ítem.

---

## 11. Lo que no haría todavía

- **Partir ítems mixtos** (R5): hoy no hay ninguno, y el campo `split_from_item_id` sin casos reales es especulación.
- **Migrar el front a Proyectos** (R7) antes de tener datos de más de una reunión: con una sola reunión, la pantalla de Proyectos mostraría un solo registro y no diría nada.
- **La capa de consulta del asistente** (§8): sin chat, es código sin consumidor.

---

## 12. Lo que necesito de vos

1. **§2: ¿un solo `project` (A) o dos conceptos (B)?**
2. **§6: ¿`topic_repo` (planificación) y `agent_session` (ejecución) conviven, o se unifican?**
3. ¿Empezamos por **R1** (proyectos y repos N:M) o preferís R2 (reuniones) primero?
