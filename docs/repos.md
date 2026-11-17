# Repos de Steel & Glass

Fuente de verdad del registro de repos del ERP. Cada entrada describe **qué es
el repo y qué toca**, no cómo está implementado: es lo que el sistema usa para
decidir a qué repos mandarle un alcance.

> El proyecto se llama `Gerancial-Brain` en disco (con "a"). Se respeta el
> nombre real porque de ahí salen las rutas.

---

## Comercial — embudo de precotización

Cuatro repos que convierten planos y fotos en una propuesta técnica con rango de
precio. Se opera desde el panel y recibe envíos anónimos de la landing.

### Cotizador_Backend

```
Comercial/backend/Cotizador_Backend
```

API y dominio de la precotización documental. Conserva la identidad del
proyecto, los archivos, el procesamiento durable, la configuración técnica, los
comparables y las estimaciones históricas. Es la autoridad de persistencia,
autorización y cálculo monetario: AI2 interpreta documentos, este repo decide y
guarda. Recibe además los envíos del intake público de la landing.

- **Stack:** C# / .NET 10, ASP.NET Core con Clean Architecture, PostgreSQL + EF
  Core 10, Google OIDC, worker de jobs durables.
- **Expone:** ~45 controladores REST bajo `/api`. Público:
  `POST /api/public/experience-submissions`. Internos: requirements,
  technical-proposals, prequotes, pricing, catálogos, admin, dashboard,
  proyectos, clientes, documentos.
- **Consume:** Cotizador_AI2 por HTTP; PostgreSQL; corpus histórico en carpeta
  configurable; Google Identity.
- **Dominio:** requirement, prequote, propuesta técnica, sistema/vidrio/acabado/
  tipología, medidas y geometría, evidencia, comparables históricos, rango de
  precio, job durable, catálogo canónico.

### Cotizador_AI2

```
Comercial/cotizador/Cotizador_AI2
```

Motor de IA del embudo. Recibe documentos y devuelve requerimientos extraídos
con evidencia; evalúa qué tan parecido es un proyecto nuevo a los del corpus
histórico. **No emite cotizaciones ni certifica resistencia de vidrio**: eso
queda del lado del backend. Stateless, sin base de datos.

- **Stack:** Python ≥3.14, FastAPI, Pydantic, `google-genai` (Gemini),
  pypdfium2, Pillow, openpyxl.
- **Expone:** `GET /health`, `POST /requirements/extract`, `/chat/respond`,
  `/chat/actions/interpret`, `/similarity/evaluate`,
  `/similarity/evaluate-batch`.
- **Consume:** API de Gemini. Lo consume Cotizador_Backend.
- **Dominio:** requirement/elemento, geometría en mm/m², especificación de
  vidrio, cantidad, evidencia, reconciliación de inventario, similitud técnica.

### SnG_Consulter

```
Comercial/cotizador/SnG_Consulter
```

Herramienta interna de preparación documental y comprensión de planos. Normaliza
PDFs e imágenes, renderiza páginas y orquesta cadenas de IA por página:
descubrimiento de candidatos de vidrio, auditoría de cobertura, consolidación,
identidad, gate y verificación técnica.

**No la consume ningún otro repo: se opera a mano por CLI o por su UI.**
Un alcance solo la involucra si se pide explícitamente.

- **Stack:** Python ≥3.12, FastAPI, PyMuPDF, Pillow, OpenAI SDK, filesystem en
  `runtime/`.
- **Expone:** `GET /health`; UI `/review` (upload, batch, documento, overlays);
  CLIs `python -m sng_consulter.discovery|identity|technical`.
- **Consume:** OpenAI Responses API; documentos locales. Nadie la consume.
- **Dominio:** batch, occurrence, prepared document/page, span de texto,
  candidate/covered candidate, identity, structure, module, glass pane,
  quantity, technical resolution.

### Cotizador_Frontend

```
Comercial/panel/Cotizador_Frontend
```

Panel interno del equipo comercial. Gestión de clientes y proyectos, carga de
documentación, revisión de la extracción técnica, ajuste de configuración y
consulta de la precotización. Incluye administración y catálogos.

**Sin BFF: el navegador llama la API de .NET directamente.**

- **Stack:** TypeScript, Next.js 16, React 19, Tailwind v4, pnpm, Google OAuth.
- **Expone:** solo UI (login, dashboard, clientes, proyectos, propuestas,
  catálogos, admin, búsqueda).
- **Consume:** Cotizador_Backend vía `NEXT_PUBLIC_API_BASE_URL`; Google Identity.
- **Dominio:** cliente, proyecto, precotización, ítem de propuesta, sistema, tipo
  de vidrio, catálogo canónico, usuario/rol.

---

## Gerancial-Brain — operación post-venta

Tres repos que registran y consultan la ejecución desde que el cliente aprueba
hasta la liberación de vanos y la orden de producción.

### SnG-Control-Backend

```
Gerancial-Brain/Backend/SnG-Control-Backend
```

Sistema de registro de la operación post-venta. Gobierna clientes, proyectos,
tareas por área, rondas de cotización, cotización comercial, decisión del
cliente, verificación del anticipo, toma de medidas, Acta de Vanos, radicación y
preparaciones de Operaciones. **Es la única fuente de verdad operacional.**

- **Stack:** C# / .NET 10, ASP.NET Core, Clean Architecture, PostgreSQL + EF Core
  10, JWT Bearer Google OIDC, worker en background. Base `sng_control`.
- **Expone:** REST `/api` — auth, clients, projects (+tasks, documents,
  notifications), budget/commercial-quotation, client-quotation-decision,
  requotation, deposit-verifications, measurements, engineering,
  opening-records, opening-filings, management, operations/preparations,
  production-reviews.
- **Consume:** PostgreSQL, Google OIDC, XLSX del cliente, procesador externo de
  extracción documental. **No consume Intelligence ni AI2.**
- **Dominio:** cliente, proyecto, tarea por área (comercial, presupuestos,
  contabilidad, instalación, ingeniería, gerencia, operaciones), ronda de
  cotización, medida en mm, ficha técnica, croquis, Acta de Vanos, anticipo,
  OP, radicación.

### SnG-Control-Frontend

```
Gerancial-Brain/Front/SnG-Control-Frontend
```

BFF y aplicación web del sistema gerencial. Única puerta de entrada del
navegador: autentica con Google y reenvía al backend .NET y a Intelligence.
Ofrece experiencias por rol sobre el mismo expediente de proyecto, más el panel
flotante de Intelligence con chat y voz.

- **Stack:** TypeScript, Next.js 16 (App Router con Route Handlers como BFF),
  React 19, Tailwind v4, pnpm, Vitest. Sin base de datos.
- **Expone:** UI por rol; BFF `/api/backend/[...path]`,
  `/api/intelligence/[...path]`, `/api/auth/me`.
- **Consume:** SnG-Control-Backend, SnG_Intelligence, Google OAuth.
- **Dominio:** proyecto, tarea, cotización, medida, Acta de Vanos, radicación,
  OP, dashboard gerencial, conversación.

### SnG_Intelligence

```
Gerancial-Brain/Intelligence/SnG_Intelligence
```

Capa conversacional **de solo lectura** para gerencia. Responde preguntas sobre
proyectos, tareas, documentos y actividad consultando el backend con
herramientas de lectura y un LLM. Añade voz (STT/TTS y tiempo real). Guarda el
hilo en su propio PostgreSQL, sin copiar datos operacionales.

**Nunca escribe en el negocio ni es autoridad de datos.**

- **Stack:** Python ≥3.12, FastAPI, Pydantic, httpx, OpenAI SDK, psycopg
  (PostgreSQL propio), mypy strict.
- **Expone:** `GET /health`, `/api/intelligence/session`, `/chat`,
  `/voice/transcribe`, `/voice`, `/voice/speech`, `/live/session`, `/live/close`.
- **Consume:** SnG-Control-Backend **solo GET**; OpenAI (chat, transcripción,
  TTS, Realtime).
- **Dominio:** management brief, estado de proyecto, comparación, referencias
  verificadas, conversación durable, voz.

---

## Landing — captación

### SnG-Experience-Frontend

```
Landing/SnG-Experience-Frontend
```

Sitio público de Steel & Glass. Landing de marca en una página más una
experiencia guiada de 6 escenas y 37 preguntas que captura el proyecto del
visitante, lo envía al cotizador y opcionalmente agenda una reunión. Puerta de
entrada de leads al embudo comercial.

- **Stack:** TypeScript, Next.js 16, React 19, Tailwind v4 + CSS Modules, pnpm,
  assets en Cloudflare R2. Sin base de datos.
- **Expone:** UI `/` y `/experiencia`; Route Handlers
  `/api/scheduling/availability` y `/api/scheduling/bookings`.
- **Consume:** `POST /api/public/experience-submissions` de Cotizador_Backend
  vía `NEXT_PUBLIC_COTIZADOR_API_URL`; media en R2. El calendario real no está
  implementado (devuelve 503 en producción).
- **Dominio:** escena/pregunta de la experiencia, proyecto del visitante,
  solicitud, disponibilidad y reserva.

---

## Fronteras conocidas

Las superficies compartidas **reales** entre repos. Cualquier alcance que las
toque puede chocar; todo lo demás es independiente.

| # | Desde | Hacia | Superficie |
|---|---|---|---|
| 1 | SnG-Experience-Frontend | Cotizador_Backend | `api:/api/public/experience-submissions` |
| 2 | Cotizador_Frontend | Cotizador_Backend | `api:/api/*` (sin BFF, navegador directo) |
| 3 | Cotizador_Backend | Cotizador_AI2 | `api:/requirements/extract`, `/similarity/evaluate`, `/similarity/evaluate-batch`, `/chat/*` |
| 4 | SnG-Control-Frontend | SnG-Control-Backend | `api:/api/*` vía BFF `/api/backend/[...path]` |
| 5 | SnG-Control-Frontend | SnG_Intelligence | `api:/api/intelligence/*` vía BFF |
| 6 | SnG_Intelligence | SnG-Control-Backend | `api:GET /api/*` (solo lectura) |

### Sin acoplamiento

| Repo | Por qué |
|---|---|
| **SnG_Consulter** | Nadie la consume; se opera a mano. Solo entra si se pide. |
| **Comercial ↔ Gerencial-Brain** | No existe ningún vínculo entre ambos proyectos. |

### Reglas que salen de esto

1. **Intelligence es de solo lectura.** No puede chocar con nada que escriba.
2. **Tocar `experience-submissions` es tocar dos proyectos.** Es la única
   frontera que cruza proyecto: landing y comercial.
3. **Un alcance que toque Cosulter no es un alcance de producto**, salvo que se
   pida explícitamente.

---

## Datos para el registro

```json
{
  "projects": [
    { "name": "Comercial", "path": "D:/MIR/Control Projects/Steel_And_Glass/Proyectos/Comercial" },
    { "name": "Gerancial-Brain", "path": "D:/MIR/Control Projects/Steel_And_Glass/Proyectos/Gerancial-Brain" },
    { "name": "Landing", "path": "D:/MIR/Control Projects/Steel_And_Glass/Proyectos/Landing" }
  ],
  "repos": [
    {
      "project": "Comercial",
      "name": "Cotizador_Backend",
      "path": "D:/MIR/Control Projects/Steel_And_Glass/Proyectos/Comercial/backend/Cotizador_Backend",
      "keywords": ["backend", "api", "precotizacion", "prequote", "price", "rango de precio", "medidas", "documento", "job", "catalogo", "submission", "experience"],
      "exposes": ["api:/api/public/experience-submissions", "api:/api/requirements", "api:/api/technical-proposals", "api:/api/prequotes", "api:/api/pricing"],
      "consumes": ["Cotizador_AI2"]
    },
    {
      "project": "Comercial",
      "name": "Cotizador_AI2",
      "path": "D:/MIR/Control Projects/Steel_And_Glass/Proyectos/Comercial/cotizador/Cotizador_AI2",
      "keywords": ["ia", "gemini", "extraccion", "documento", "plano", "similitud", "chat", "interpretacion"],
      "exposes": ["api:/requirements/extract", "api:/similarity/evaluate", "api:/similarity/evaluate-batch", "api:/chat/respond", "api:/chat/actions/interpret"],
      "consumes": []
    },
    {
      "project": "Comercial",
      "name": "SnG_Consulter",
      "path": "D:/MIR/Control Projects/Steel_And_Glass/Proyectos/Comercial/cotizador/SnG_Consulter",
      "keywords": ["consulter", "pdf", "plano", "preparacion documental", "coverage", "identity", "herramienta interna"],
      "exposes": ["ui:/review"],
      "consumes": []
    },
    {
      "project": "Comercial",
      "name": "Cotizador_Frontend",
      "path": "D:/MIR/Control Projects/Steel_And_Glass/Proyectos/Comercial/panel/Cotizador_Frontend",
      "keywords": ["panel", "frontend", "comercial", "clientes", "proyectos", "catalogos", "admin", "propuesta"],
      "exposes": ["ui:/"],
      "consumes": ["Cotizador_Backend"]
    },
    {
      "project": "Gerancial-Brain",
      "name": "SnG-Control-Backend",
      "path": "D:/MIR/Control Projects/Steel_And_Glass/Proyectos/Gerancial-Brain/Backend/SnG-Control-Backend",
      "keywords": ["gerencial", "operacion", "post-venta", "cotizacion", "anticipo", "medidas", "vano", "acta", "radicacion", "op", "tarea", "proyecto"],
      "exposes": ["api:/api/clients", "api:/api/projects", "api:/api/measurements", "api:/api/opening-records", "api:/api/management"],
      "consumes": []
    },
    {
      "project": "Gerancial-Brain",
      "name": "SnG-Control-Frontend",
      "path": "D:/MIR/Control Projects/Steel_And_Glass/Proyectos/Gerancial-Brain/Front/SnG-Control-Frontend",
      "keywords": ["frontend", "bff", "dashboard", "roles", "asesor", "presupuestos", "contabilidad", "instalacion", "ingenieria", "gerencia"],
      "exposes": ["ui:/", "api:/api/backend/[...path]", "api:/api/intelligence/[...path]"],
      "consumes": ["SnG-Control-Backend", "SnG_Intelligence"]
    },
    {
      "project": "Gerancial-Brain",
      "name": "SnG_Intelligence",
      "path": "D:/MIR/Control Projects/Steel_And_Glass/Proyectos/Gerancial-Brain/Intelligence/SnG_Intelligence",
      "keywords": ["intelligence", "chat", "voz", "consulta", "gerencia", "conversacional", "read-only"],
      "exposes": ["api:/api/intelligence/chat", "api:/api/intelligence/voice", "api:/api/intelligence/live"],
      "consumes": ["SnG-Control-Backend"]
    },
    {
      "project": "Landing",
      "name": "SnG-Experience-Frontend",
      "path": "D:/MIR/Control Projects/Steel_And_Glass/Proyectos/Landing/SnG-Experience-Frontend",
      "keywords": ["landing", "sitio publico", "experiencia", "leads", "formulario", "agenda", "reserva", "seo", "cms"],
      "exposes": ["ui:/", "ui:/experiencia", "api:/api/scheduling"],
      "consumes": ["Cotizador_Backend"]
    }
  ]
}
```
