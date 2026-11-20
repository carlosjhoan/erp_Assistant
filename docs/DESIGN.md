# DESIGN.md — my_erp

Sistema de diseño del ERP. Es la fuente de verdad visual para el código y para
las referencias generadas en Stitch.

---

## 1. Personalidad

Herramienta de trabajo personal, no un dashboard corporativo genérico.
Sobria, densa en información, con un acento **agéntico**: se siente viva sin
distraer. Nada de gradientes llamativos ni tarjetas flotantes sin razón.

Tres reglas que mandan sobre todo lo demás:

1. **La información manda.** La decoración nunca compite con un dato.
2. **El movimiento explica.** Cada transición dice qué cambió y de dónde vino.
3. **Una jerarquía por pantalla.** Si todo resalta, nada resalta.

---

## 2. Color

Paleta heredada de la identidad de Steel & Glass.

| Rol | Hex | Uso |
|---|---|---|
| `ink` | `#19233e` | Texto principal, CTA |
| `stone` | `#3b4661` | Texto secundario |
| `olive` | `#5a6a8c` | Etiquetas, metadatos |
| `paper` | `#f5f7fb` | Fondo de la app |
| `surface` | `#ffffff` | Superficie de tarjetas |
| `line` | `#d8dde9` | Bordes, separadores |
| `soft` | `#e9edf5` | Rellenos suaves, chips |
| `ok` | `#2f6b4f` | Éxito, seleccionado |
| `warn` | `#96620f` | Atención, pendiente |
| `bad` | `#a83a2a` | Descarte, error |

**Regla de acento:** un solo color de acento por pantalla. El resto es neutro.
El azul de marca aparece en: CTA primario, elemento activo, y nada más.

---

## 3. Glass

El glass es **sutil y funcional**, no un efecto decorativo.

```css
background-color: #ffffff;                          /* base opaca siempre */
background-image: linear-gradient(140deg,
  rgba(25, 35, 62, 0.055),
  rgba(139, 158, 190, 0.045) 55%,
  rgba(255, 255, 255, 0));
border: 1px solid #d8dde9;
border-radius: 14px;
```

**Nunca transparente puro.** Siempre hay un blanco sólido debajo: así el
degradado compone contra un fondo conocido y no se rompe en modo oscuro forzado.
Sin `backdrop-filter`: no aporta con fondo casi opaco.

Variantes de estado sobre la misma receta:

| Estado | Borde | Degradado |
|---|---|---|
| Seleccionada | `#b3c0d8` | azul tenue |
| Postergada | `#bccbe0` | azul frío |
| Descartada | `#e2c3bd` | rojo tenue |
| Pendiente | `#dde2ea` punteado | ninguno, gris `#f4f6f9` |

---

## 4. Tipografía

| Nivel | Tamaño | Peso | Uso |
|---|---|---|---|
| Título de página | 15 px | 650 | Encabezado de la vista |
| Título de tarjeta | 14.5 px | 620 | Tema, reunión |
| Cuerpo | 12.5–13 px | 400 | Descripción, criterios |
| Etiqueta | 10–11 px | 600 + tracking | Campos, estados |
| Dato monoespaciado | 11 px | 400 | Tokens, porcentajes, IDs |

**Sin itálica en cuerpo.** La serif itálica queda reservada para citas textuales
del apunte, que es lo único que realmente lo amerita.

---

## 5. Espacio

Escala de 4: `4 · 8 · 12 · 16 · 20 · 24 · 32 · 48`.

- Dentro de una tarjeta: 16–18 px
- Entre tarjetas: 10–12 px
- Entre secciones: 28–32 px
- Etiqueta → campo: 5 px

**Regla de proximidad:** lo que va junto se separa 12 px; lo que va separado, 28+.
Nada en el medio: esa ambigüedad es lo que hace que una pantalla se lea como ruido.

---

## 6. Movimiento y storytelling

Cada transición debe responder: **¿qué cambió?**

| Evento | Animación | Duración |
|---|---|---|
| Se decide un tema que sale de la lista | Desvanece + desplaza 8 px a la derecha | 200 ms |
| Aparece un bloque condicional | Alto de 0 → auto + fundido | 180 ms |
| Elegir una opción | Relleno del control, sin desplazamiento | 120 ms |
| Abrir un modal | Escala 0.98 → 1 + fundido | 160 ms |
| Actualizar un contador | Sin animación: el número cambia | 0 ms |

**Nunca animar lo que no cambió.** Nada de pulsos decorativos ni carga infinita.

Easing: `cubic-bezier(0.2, 0, 0.2, 1)` para todo.

Accesibilidad: `@media (prefers-reduced-motion)` desactiva todo salvo el fundido.

---

## 7. Jerarquía de información

Cada tarjeta responde tres preguntas, en este orden:

1. **¿Qué es?** — tipo (ALCANCE/IDEA), título
2. **¿Qué dice?** — descripción de dos líneas, con "ver más"
3. **¿Qué hago?** — decisión, responsable, proyectos

Las señales de confianza (Jev) van pegadas al tipo, no en el pie: pertenecen a
la clasificación, no a la acción.

---

## 8. Pantallas

| Pantalla | Elemento protagonista |
|---|---|
| **Proyectos** | Tarjeta con barra de avance y repos del proyecto |
| **Reuniones** | Tarjeta glass con estado y métricas por color |
| **Reunión · Temas** | Tarjeta de tema con decisión en el pie |
| **Reunión · Rúbrica** | Lista numerada agrupada por tema |
| **Tema** | Contexto editable + propuestas de repos |

---

## 9. Lo que nunca

- Emojis en la interfaz
- Gradientes de más de dos paradas que no sean de marca
- Sombras duras o de más de 12 px de blur
- Animaciones de más de 250 ms
- Más de un color de acento por pantalla
- Texto de menos de 10 px
