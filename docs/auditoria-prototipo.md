# Auditoría del prototipo existente

**Proyecto:** `my_erp` — ERP personal de trabajo
**Fecha:** 2026-11-13
**Objeto auditado:** `Presentaciones/prototipo-diagnostico`
**Conclusión previa:** `my_erp` es un repo nuevo. **No hay refactor ni migración de código de producto.** Solo se reutilizan piezas de infraestructura y el sistema visual.

---

## 1. Qué es el prototipo auditado

Un **presentador de diagnósticos** para tres sistemas de la empresa (Landing, Comercial, Gerencial Brain). Servidor Node sin dependencias, interfaz en un solo canvas con chat, dashboard de tarjetas y exploración por etapas.

**No comparte dominio con el ERP.** El ERP registra trabajo semanal propio contra una rúbrica acordada; el prototipo muestra el estado de tres repositorios ajenos. Comparten lenguaje visual y patrones de infraestructura, nada más.

| | Prototipo | my_erp |
|---|---|---|
| Usuario | Gerencia, en una demo | Una sola persona, a diario |
| Dato | Diagnósticos estáticos en JSON | Eventos append-only en base de datos |
| Estado | Sin estado, se re-lee el JSON | Transaccional, con versiones |
| Salida | Vista HTML efímera | Rúbrica y reportes auditables |

---

## 2. Qué se reutiliza

### 2.1 Correo (alto valor, ~380 líneas)

| Archivo | Líneas | Qué aporta |
|---|---|---|
| `server/mailer.mjs` | 89 | Drivers `dry` y `smtp`, remitente atado al entorno, `.eml` en disco para inspección |
| `server/email-check.mjs` | 56 | Validación con **MX real** (`dns.resolveMx`), caché de 10 min, fallback a registro A |
| `public/email.mjs` | 79 | Validación pura compartida: sintaxis, typo con sugerencia, dominios descartables, buzones de rol |
| `server/report.mjs` | 233 | Spec → **HTML email-safe** (tablas e inline, sin flex ni variables CSS) |

**Por qué importa:** el brief exige `draft → aprobación → envío` con `dry_run` por defecto y validación de destinatarios. Ese circuito ya está construido y probado; solo hay que cambiarle la entrada (hoy recibe el spec de un turno del chat, deberá recibir un `report` de la base).

**Qué falta para el ERP:** plantillas de reporte nuevas y la tabla `report_delivery`. El transporte no se toca.

### 2.2 Proveedor de LLM con resiliencia (~120 líneas útiles)

`models.mjs` tiene tres piezas que sirven tal cual:

- `withRetry()` con backoff y `onRetry` para trazar reintentos.
- `env()` para leer configuración sin hardcodear.
- El patrón de **llamada con salida estructurada validada**: si el JSON no valida, se reintenta o se degrada, nunca se acepta a medias.

**Qué no se reutiliza:** los prompts. Son del dominio de diagnóstico.

### 2.3 Patrón de registro de herramientas (~193 líneas)

`server/tools.mjs` resuelve el problema que el brief plantea en §6:

- Registro declarativo: nombre, cuándo usarla, parámetros, `sideEffect`.
- Un validador por herramienta que normaliza y rechaza con error tipado.
- Generación del bloque de prompt **desde el registro**, no a mano.
- Distinción entre herramienta con efecto secundario (pide confirmación) y sin efecto (se ejecuta).

**Ajuste necesario:** hoy el validador vive en JS plano. En `my_erp` los esquemas deben ser tipados (§6: "valida sus entradas con esquemas tipados").

### 2.4 Sistema visual (~1.100 líneas aprovechables de 4.256)

De `public/styles.css` interesa el **token set**, no las 4.256 líneas:

- Paleta derivada de la marca: `--ink #19233e`, `--olive #5a6a8c`, `--paper #f5f7fb`, semánticos `--ok/--high/--critical`.
- Tipografía: Georgia para títulos, ui-monospace para datos, sans para el resto.
- Las dos recetas de vidrio (tarjeta completa y píldora de métricas), con el `::before` enmascarado para el canto.
- Barras de progreso, medidores, badges de estado y el patrón de "anotación al margen" (regla de 2px).

**Lo que NO se lleva:** el layout del deck con rail, el canvas de chat, la animación de cortina, el modal de nodos. Son del producto viejo.

### 2.5 Detalles pequeños que ahorran tiempo

| Archivo | Qué aporta |
|---|---|
| `public/sse.mjs` | Parser de frames SSE (15 líneas, testeado) |
| `public/steps.mjs` | Máquina de estados de etapas + `replay` desde eventos |
| `tests/` | 286 tests: sirven como referencia de estilo de test (sin frameworks, `node:test`) |

---

## 3. Qué NO se reutiliza

| Pieza | Motivo |
|---|---|
| `pipeline.mjs`, `facets.mjs`, `explore.mjs` | Dominio de diagnóstico |
| `public/data/*.json` | Datos de la empresa, no del ERP |
| Layout del deck, chat, rail, modales | Producto distinto |
| `server.mjs` (servidor HTTP a mano) | El ERP necesita MCP por `stdio` y, más adelante, API; conviene el framework del stack elegido |
| Estilos de la apertura de ventana | Narrativa de la demo, no de una herramienta diaria |

---

## 4. Ahorro estimado

| Área | Sin reutilizar | Reutilizando |
|---|---|---|
| Correo (envío + validación + HTML) | 3–4 días | **medio día** (adaptar plantillas) |
| Resiliencia LLM | 1 día | **2 horas** |
| Registro de herramientas | 2 días | **1 día** (tipar esquemas) |
| Sistema visual | 3 días | **1 día** (portar tokens) |
| **Total** | **~9 días** | **~2,5 días** |

---

## 5. Riesgos de la reutilización

1. **Arrastrar decisiones del prototipo que no aplican.** El correo es "fuego y olvido" con un spec efímero; en el ERP hay que ligar cada envío a un `report` persistido y a `report_delivery`.
2. **Copiar el CSS completo.** Son 4.256 líneas de un producto distinto. Se copian **solo los tokens y las cuatro recetas**, no el archivo.
3. **El sistema visual depende del navegador del prototipo.** `backdrop-filter` y `mask-composite` no son gratuitos; medir en el equipo donde se va a usar a diario.
4. **Los tests no se heredan.** La referencia de estilo sirve; los casos son otros.

---

## 6. Consecuencia para la Fase 1

El entregable `docs/decision-stack.md` ya no compara "refactor vs reescritura": evalúa el stack **desde cero** con criterio de repo nuevo, usando este inventario como criterio de peso (lo que se reutiliza es JS/ESM; ese es un punto a favor de un stack JS, pero **no una obligación**).
