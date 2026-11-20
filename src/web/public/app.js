/* my_erp — JavaScript plano. Sin tipos ni genéricos: el navegador no los parsea. */

(function () {
  "use strict";

  /* ---------- utilidades ---------- */

  function escapar(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function pedir(ruta, cuerpo, tipo) {
    const opciones = { method: "POST" };
    if (cuerpo !== undefined) {
      opciones.body = cuerpo;
      opciones.headers = { "content-type": tipo || "text/plain" };
    }

    let respuesta;
    try {
      respuesta = await fetch(ruta, opciones);
    } catch (e) {
      throw new Error("No se pudo llegar al servidor: " + (e && e.message ? e.message : e));
    }

    let datos;
    try {
      datos = await respuesta.json();
    } catch (e) {
      throw new Error("El servidor respondió algo que no es JSON (código " + respuesta.status + ").");
    }

    if (!respuesta.ok || !datos || !datos.ok) {
      throw new Error((datos && datos.error) || "Falló la operación (código " + respuesta.status + ").");
    }
    return datos;
  }

  function mostrarEstado(elemento, texto, tipo) {
    if (!elemento) return;
    elemento.hidden = !texto;
    elemento.textContent = texto || "";
    elemento.className = "estado" + (tipo ? " " + tipo : "");
  }

  function fallar(e) {
    console.error(e);
    alert(e && e.message ? e.message : String(e));
  }

  /* ---------- tarjeta de tema: decision y responsable ---------- */

  document.querySelectorAll(".tema-card select[data-campo]").forEach(function (select) {
    select.dataset.previo = select.value;

    select.addEventListener("change", async function () {
      const card = select.closest(".tema-card");
      const id = card.dataset.id;
      const campo = select.dataset.campo;
      const valor = select.value;
      const anterior = select.dataset.previo || "";
      select.disabled = true;

      try {
        await pedir("/accion/" + id + "/" + campo + "/" + encodeURIComponent(valor));
        select.dataset.previo = valor;

        if (campo === "estado") {
          card.classList.remove("estado-proposed", "estado-selected", "estado-parked", "estado-discarded");
          card.classList.add("estado-" + valor);
        }
      } catch (e) {
        select.value = anterior;
        fallar(e);
      } finally {
        select.disabled = false;
      }
    });
  });

  /* ---------- botones con data-accion ---------- */

  document.querySelectorAll("[data-accion]").forEach(function (boton) {
    boton.addEventListener("click", async function () {
      const accion = boton.dataset.accion;
      boton.disabled = true;

      try {
        if (accion === "crear-rubrica") {
          await pedir("/rubrica/crear");
          location.reload();
          return;
        }
        if (accion === "aprobar") {
          await pedir("/rubrica/aprobar/" + boton.dataset.rubrica);
          location.reload();
          return;
        }
      } catch (e) {
        fallar(e);
      } finally {
        boton.disabled = false;
      }
    });
  });

  /* ---------- detalle del tema ---------- */

  document.querySelectorAll("[data-guardar-contexto]").forEach(function (boton) {
    boton.addEventListener("click", async function () {
      const id = boton.dataset.guardarContexto;
      const area = document.querySelector('textarea[data-contexto="' + id + '"]');
      if (!area) return;

      boton.disabled = true;
      try {
        await pedir("/tema/" + id + "/contexto", area.value);
        boton.textContent = "Guardado ✓";
        setTimeout(function () {
          boton.textContent = "Guardar contexto";
        }, 1600);
      } catch (e) {
        fallar(e);
      } finally {
        boton.disabled = false;
      }
    });
  });

  document.querySelectorAll("[data-detectar]").forEach(function (boton) {
    boton.addEventListener("click", async function () {
      const id = boton.dataset.detectar;
      const estado = boton.parentElement.querySelector(".cargando");

      boton.disabled = true;
      boton.textContent = "Detectando…";
      mostrarEstado(estado, "Consultando el catálogo de repos…");

      try {
        const r = await pedir("/tema/" + id + "/detectar");
        if (r.duda) alert("El modelo pidió aclaración:\n\n" + r.duda);
        location.reload();
      } catch (e) {
        fallar(e);
        boton.disabled = false;
        boton.textContent = "Detectar repos";
        mostrarEstado(estado, "");
      }
    });
  });

  document.querySelectorAll("[data-difundir]").forEach(function (boton) {
    boton.addEventListener("click", async function () {
      const id = boton.dataset.difundir;
      const estado = boton.parentElement.querySelector(".cargando");

      if (!confirm("Se abre una sesión de OpenCode por repo. Puede tardar varios minutos. ¿Seguir?")) return;

      boton.disabled = true;
      mostrarEstado(estado, "OpenCode está analizando los repos… no cierres esta pestaña.");

      try {
        await pedir("/tema/" + id + "/difundir");
        location.reload();
      } catch (e) {
        fallar(e);
        boton.disabled = false;
        mostrarEstado(estado, "");
      }
    });
  });

  document.querySelectorAll("[data-aceptar]").forEach(function (boton) {
    boton.addEventListener("click", async function () {
      boton.disabled = true;
      try {
        const r = await pedir("/tema/" + boton.dataset.aceptar + "/aceptar", boton.dataset.repo);
        alert((r.materializados || 0) + " ítem(s) creados en la rúbrica.");
        location.reload();
      } catch (e) {
        fallar(e);
        boton.disabled = false;
      }
    });
  });

  /* ---------- nueva reunión con Granola ---------- */

  const btnBuscar = document.querySelector("[data-buscar-granola]");
  const resultados = document.getElementById("resultados");
  const estadoGranola = document.getElementById("estado-granola");

  if (btnBuscar && resultados) {
    btnBuscar.addEventListener("click", async function () {
      btnBuscar.disabled = true;
      resultados.innerHTML = "";

      mostrarEstado(estadoGranola, "Conectando con Granola vía MCP…");
      await new Promise(function (r) {
        setTimeout(r, 50);
      });
      mostrarEstado(estadoGranola, "Buscando las últimas notas…");

      try {
        const datos = await pedir("/granola/listar");
        const notas = datos.notas || [];

        const pendientes = notas.filter(function (n) {
          return !n.yaImportada;
        }).length;

        const resumen = notas.length === 0
          ? "No hay notas en los últimos 30 días"
          : notas.length + " nota(s) en los últimos 30 días · " +
            (pendientes === 0 ? "todas ya importadas" : pendientes + " sin importar");

        mostrarEstado(estadoGranola, resumen, pendientes === 0 && notas.length > 0 ? "" : "ok");

        if (notas.length === 0) {
          resultados.innerHTML = '<div class="vacio"><h2>No hay notas recientes</h2></div>';
          return;
        }

        resultados.innerHTML = notas
          .map(function (n) {
            return (
              '<article class="fila"><div class="titulos"><div class="etiquetas">' +
              '<span class="score">' + new Date(n.occurredAt).toLocaleDateString("es-CO") + "</span>" +
              '<span class="score">' + n.participantes + " participante(s)</span>" +
              (n.yaImportada ? '<span class="etiqueta alcance">ya importada</span>' : "") +
              "</div><h3>" + escapar(n.title) + "</h3></div>" +
              '<div class="controles">' +
              (n.yaImportada
                ? '<span class="nota">no se importa de nuevo</span>'
                : '<button class="boton" data-importar="' + escapar(n.externalId) + '">Importar</button>') +
              "</div></article>"
            );
          })
          .join("");

        resultados.querySelectorAll("[data-importar]").forEach(function (b) {
          b.addEventListener("click", async function () {
            b.disabled = true;
            b.textContent = "Importando…";
            mostrarEstado(estadoGranola, "Trayendo la nota completa (notas + transcripción)…");

            try {
              const r = await pedir("/granola/importar", b.dataset.importar);
              mostrarEstado(estadoGranola, "Importada. Abriendo…", "ok");
              location.href = "/reunion/" + r.meetingId;
            } catch (e) {
              fallar(e);
              b.disabled = false;
              b.textContent = "Importar";
              mostrarEstado(estadoGranola, "");
            }
          });
        });
      } catch (e) {
        mostrarEstado(estadoGranola, e.message, "error");
        fallar(e);
      } finally {
        btnBuscar.disabled = false;
      }
    });
  }

  /* ---------- detectar temas de una reunión ---------- */

  document.querySelectorAll("[data-detectar-temas]").forEach(function (boton) {
    boton.addEventListener("click", async function () {
      const id = boton.dataset.detectarTemas;
      const estado = boton.parentElement.querySelector(".cargando");

      if (!confirm("Se extraen los temas de esta reunión. Puede tardar 10-20 segundos. ¿Seguir?")) return;

      boton.disabled = true;
      mostrarEstado(estado, "Extrayendo temas y verificándolos con Jev…");

      try {
        const r = await pedir("/reunion/" + id + "/detectar");
        mostrarEstado(estado, r.extraidos + " tema(s) extraídos. Recargando…", "ok");
        location.reload();
      } catch (e) {
        fallar(e);
        boton.disabled = false;
        mostrarEstado(estado, "");
      }
    });
  });

/* ---------- modal de notas ---------- */

document.querySelectorAll("[data-abrir-modal]").forEach(function (boton) {
  boton.addEventListener("click", function () {
    const dialogo = document.getElementById(boton.dataset.abrirModal);
    if (dialogo && dialogo.showModal) dialogo.showModal();
  });
});

document.querySelectorAll("[data-cerrar-modal]").forEach(function (boton) {
  boton.addEventListener("click", function () {
    const dialogo = document.getElementById(boton.dataset.cerrarModal);
    if (dialogo && dialogo.close) dialogo.close();
  });
});

document.querySelectorAll("dialog.modal").forEach(function (dialogo) {
  // Cerrar al hacer clic fuera del contenido.
  dialogo.addEventListener("click", function (e) {
    if (e.target === dialogo) dialogo.close();
  });
});

/* ---------- eliminar y restaurar reuniones ---------- */

document.querySelectorAll("[data-archivar]").forEach(function (boton) {
  boton.addEventListener("click", async function (e) {
    // El botón vive encima del enlace estirado: hay que cortar la navegación.
    e.preventDefault();
    e.stopPropagation();

    const temas = Number(boton.dataset.temas || 0);
    const detalle =
      temas > 0
        ? "\n\nTiene " + temas + " tema(s) y sus ítems en la rúbrica quedan intactos."
        : "";

    if (!confirm("¿Archivar «" + boton.dataset.titulo + "»?" + detalle + "\n\nDeja de aparecer en la lista. Se puede restaurar desde Archivadas.")) {
      return;
    }

    try {
      await pedir("/reunion/" + boton.dataset.archivar + "/archivar");
      const card = boton.closest(".card-reunion");
      if (card) {
        card.classList.add("saliendo");
        setTimeout(function () {
          card.remove();
        }, 200);
      }
    } catch (err) {
      fallar(err);
    }
  });
});

document.querySelectorAll("[data-restaurar]").forEach(function (boton) {
  boton.addEventListener("click", async function () {
    btnDeshabilitar(boton, true);
    try {
      await pedir("/reunion/" + boton.dataset.restaurar + "/restaurar");
      location.reload();
    } catch (e) {
      fallar(e);
      btnDeshabilitar(boton, false);
    }
  });
});

function btnDeshabilitar(b, si) {
  b.disabled = si;
}

/* ---------- chips de proyecto por tema ---------- */

/* ---------- tablero: responsable y estado desde la tarjeta ---------- */

document.querySelectorAll(".tarjeta-kanban select[data-campo]").forEach(function (select) {
  select.dataset.previo = select.value;

  select.addEventListener("change", async function () {
    const card = select.closest(".tarjeta-kanban");
    const id = card.dataset.id;
    const campo = select.dataset.campo;
    const valor = select.value;
    const anterior = select.dataset.previo || "";
    select.disabled = true;

    try {
      await pedir("/accion/" + id + "/" + campo + "/" + encodeURIComponent(valor));
      select.dataset.previo = valor;

      if (campo === "estado") {
        card.classList.remove("estado-proposed", "estado-selected", "estado-parked", "estado-discarded");
        card.classList.add("estado-" + valor);
      }

      if (campo === "owner") {
        card.querySelectorAll(".dueno").forEach(function (s) {
          s.classList.remove("dueno-me", "dueno-opencode", "dueno-none");
          s.classList.add("dueno-" + (valor || "none"));
        });
      }
    } catch (err) {
      select.value = anterior;
      fallar(err);
    } finally {
      select.disabled = false;
    }
  });
});

/* ---------- resumen de proyectos: siempre en badges ---------- */

function pintarResumen(detalle) {
  const resumen = detalle.querySelector(".multi-resumen");
  if (!resumen) return;

  const marcados = [...detalle.querySelectorAll("input[data-toggle-proyecto]:checked")];
  resumen.textContent = "";

  if (marcados.length === 0) {
    resumen.textContent = "Sin proyecto";
    return;
  }

  marcados.forEach(function (i) {
    const nombre = i.closest("label").querySelector("span");
    const badge = document.createElement("span");
    badge.className = "chip-proyecto";
    badge.textContent = nombre ? nombre.textContent : "";
    resumen.appendChild(badge);
  });
}

document.querySelectorAll("input[data-toggle-proyecto]").forEach(function (chip) {
  chip.addEventListener("click", async function (e) {
    e.preventDefault();
    e.stopPropagation();

    const tema = chip.dataset.tema;
    const proyecto = chip.dataset.toggleProyecto;
    chip.disabled = true;

    try {
      const r = await pedir("/accion/" + tema + "/proyecto/" + proyecto);
      chip.checked = Boolean(r.activo);

      const detalle = chip.closest("details.multi");

      // "Sin proyecto" y cualquier proyecto son excluyentes: si marcás uno,
      // el otro deja de tener sentido.
      if (detalle && r.activo) {
        const ninguno = detalle.querySelector("input[data-sin-proyecto]");
        if (ninguno) ninguno.checked = false;
      }

      // El resumen se repinta con badges, no con un conteo.
      if (detalle) {
        pintarResumen(detalle);

        // Si ya no queda ninguno, "Sin proyecto" vuelve a estar marcado.
        const ninguno = detalle.querySelector("input[data-sin-proyecto]");
        const n = detalle.querySelectorAll("input[data-toggle-proyecto]:checked").length;
        if (ninguno) ninguno.checked = n === 0;
      }
    } catch (err) {
      fallar(err);
    } finally {
      chip.disabled = false;
    }
  });
});

/* ---------- "Sin proyecto" como opcion explicita ---------- */

document.querySelectorAll("[data-sin-proyecto]").forEach(function (chk) {
  chk.addEventListener("click", async function (e) {
    e.preventDefault();
    const tema = chk.dataset.sinProyecto;
    const detalle = chk.closest("details.multi");

    try {
      await pedir("/accion/" + tema + "/proyecto/ninguno");

      detalle.querySelectorAll("input[data-toggle-proyecto]").forEach(function (i) { i.checked = false; });
      chk.checked = true;

      pintarResumen(detalle);
    } catch (err) {
      fallar(err);
    }
  });
});

/* ---------- desplegables de proyecto: se cierran como un menu ---------- */

// Escape cierra primero el desplegable; si no hay ninguno abierto, sigue
// hacia los modales.
document.addEventListener("keydown", function (e) {
  if (e.key !== "Escape") return;
  const abierto = document.querySelector("details.multi[open]");
  if (!abierto) return;
  abierto.open = false;
  e.stopPropagation();
}, true);

// Clic por fuera del desplegable.
document.addEventListener("click", function (e) {
  document.querySelectorAll("details.multi[open]").forEach(function (d) {
    if (!d.contains(e.target)) d.open = false;
  });
});

/* ---------- cerrar modales: Escape y clic por fuera ---------- */

document.querySelectorAll("dialog.modal").forEach(function (dialogo) {
  // Clic sobre el fondo: el evento llega con el propio dialog como target.
  dialogo.addEventListener("click", function (e) {
    if (e.target === dialogo) dialogo.close();
  });
});

// Escape: el navegador ya lo maneja, pero lo dejamos explicito.
document.addEventListener("keydown", function (e) {
  if (e.key !== "Escape") return;
  document.querySelectorAll("dialog.modal[open]").forEach(function (d) { d.close(); });
});


/* ---------- tablero: la tarjeta ocupa su lugar mientras se arrastra ---------- */

let arrastrada = null;
let indiceActual = -1;
// Foto de las posiciones tomada al entrar en la columna, sin la tarjeta movida.
let foto = null;
// Para devolver la tarjeta si se cancela el arrastre.
let origenLista = null;
let origenSiguiente = null;

function limpiarArrastre() {
  indiceActual = -1;
  foto = null;
  origenLista = null;
  origenSiguiente = null;
}

/** Congela las posiciones: la tarjeta en movimiento no altera su propia medicion. */
function tomarFoto(lista) {
  foto = [...lista.querySelectorAll(".tarjeta-kanban")]
    .filter(function (c) { return c !== arrastrada; })
    .map(function (c) {
      const r = c.getBoundingClientRect();
      return { centro: r.top + r.height / 2 };
    });
  indiceActual = -1;
}

function indiceEn(y) {
  if (!foto) return 0;
  for (let i = 0; i < foto.length; i++) {
    if (y < foto[i].centro) return i;
  }
  return foto.length;
}

/** Mueve la tarjeta real al lugar donde va a caer: se ve donde queda. */
function ubicar(lista, indice, el) {
  // Tras el await de un drop, dragend ya limpió arrastrada: se pasa la tarjeta aparte.
  const card = el || arrastrada;
  if (!card) return;
  if (indice === indiceActual && card.parentNode === lista) return;

  // FLIP: medir antes de tocar el DOM.
  const antes = new Map();
  [...lista.children].forEach(function (c) {
    if (c !== card) antes.set(c, c.getBoundingClientRect().top);
  });

  indiceActual = indice;

  const tarjetas = [...lista.querySelectorAll(".tarjeta-kanban")].filter(function (c) { return c !== card; });
  const referencia = tarjetas[indice];
  if (referencia) lista.insertBefore(card, referencia);
  else lista.appendChild(card);

  // FLIP: las tarjetas afectadas viajan desde donde estaban hasta donde quedan.
  [...lista.children].forEach(function (c) {
    if (c === card || !antes.has(c)) return;
    const delta = antes.get(c) - c.getBoundingClientRect().top;
    if (!delta) return;
    c.style.transition = "none";
    c.style.transform = "translateY(" + delta + "px)";
    requestAnimationFrame(function () {
      c.style.transition = "transform 180ms cubic-bezier(0.2, 0, 0.2, 1)";
      c.style.transform = "";
    });
  });
}

document.addEventListener("dragstart", function (e) {
  const card = e.target.closest(".tarjeta-kanban");
  if (!card || card.getAttribute("draggable") !== "true") return;
  arrastrada = card;
  origenLista = card.parentNode;
  origenSiguiente = card.nextElementSibling;
  card.classList.add("arrastrando");
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", card.dataset.id);
});

document.addEventListener("dragend", function () {
  if (arrastrada) arrastrada.classList.remove("arrastrando");
  document.querySelectorAll(".columna-lista.encima").forEach(function (l) { l.classList.remove("encima"); });
  limpiarArrastre();
  arrastrada = null;
});

document.addEventListener("dragenter", function (e) {
  if (!arrastrada) return;
  const lista = e.target.closest(".columna-lista");
  if (!lista) return;
  tomarFoto(lista);
  ubicar(lista, indiceEn(e.clientY));
});

document.addEventListener("dragover", function (e) {
  if (!arrastrada) return;
  const lista = e.target.closest(".columna-lista");
  if (!lista) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";

  if (!foto) tomarFoto(lista);

  document.querySelectorAll(".columna-lista.encima").forEach(function (l) {
    if (l !== lista) l.classList.remove("encima");
  });
  lista.classList.add("encima");

  ubicar(lista, indiceEn(e.clientY));
});

document.addEventListener("drop", async function (e) {
  if (!arrastrada) return;
  const lista = e.target.closest(".columna-lista");
  if (!lista) return;
  e.preventDefault();

  const destino = lista.dataset.drop;
  const card = arrastrada;
  const indice = foto ? indiceEn(e.clientY) : 0;
  const origenFinal = origenLista;

  try {
    await pedir("/accion/" + card.dataset.id + "/mover/" + destino + "-" + indice);

    card.classList.remove("estado-proposed", "estado-selected", "estado-parked", "estado-discarded");
    card.classList.add("estado-" + destino);

    const mover = card.querySelector(".chip-mover");
    if (mover) mover.value = destino;

    ubicar(lista, indice, card);
    card.classList.add("asentando");
    setTimeout(function () { card.classList.remove("asentando"); }, 260);

    contar(lista);
    if (origenFinal && origenFinal !== lista) contar(origenFinal);
  } catch (err) {
    // Si el servidor rechaza, la tarjeta vuelve de donde salio.
    if (origenFinal) {
      if (origenSiguiente && origenSiguiente.parentNode === origenFinal) {
        origenFinal.insertBefore(card, origenSiguiente);
      } else {
        origenFinal.appendChild(card);
      }
    }
    fallar(err);
  } finally {
    limpiarArrastre();
  }
});

function contar(lista) {
  const columna = lista.closest(".columna");
  if (!columna) return;
  const globo = columna.querySelector(".columna-cuenta");
  const n = lista.querySelectorAll(".tarjeta-kanban").length;
  if (globo) globo.textContent = String(n);
}


/* ---------- abrir modales por data-abrir ---------- */
document.querySelectorAll("[data-abrir]").forEach(function (boton) {
  boton.addEventListener("click", function () {
    const d = document.getElementById(boton.dataset.abrir);
    if (d && d.showModal) d.showModal();
  });
});

/* ---------- marcar un item de rubrica como hecho ---------- */
document.querySelectorAll("input[data-item]").forEach(function (chk) {
  chk.addEventListener("change", async function () {
    chk.disabled = true;
    try {
      await pedir("/item/" + chk.dataset.item + "/hecho");
    } catch (err) {
      chk.checked = !chk.checked;
      fallar(err);
    } finally {
      chk.disabled = false;
    }
  });
});


/* ---------- declarar que capacidad mueve un item ---------- */
document.querySelectorAll("select[data-cap]").forEach(function (sel) {
  sel.addEventListener("change", async function () {
    const id = sel.dataset.cap;
    sel.disabled = true;
    try {
      await pedir("/item/" + id + "/capacidad/" + (sel.value || ""));
      // Sin recargar: el avance se recalcula al volver a entrar.
      const fila = sel.closest(".it-fila");
      const efecto = fila ? fila.querySelector(".it-efecto") : null;
      if (!sel.value && efecto) efecto.remove();
    } catch (err) {
      fallar(err);
    } finally {
      sel.disabled = false;
    }
  });
});

document.querySelectorAll("select[data-efecto]").forEach(function (sel) {
  sel.addEventListener("change", async function () {
    sel.disabled = true;
    try {
      await pedir("/item/" + sel.dataset.efecto + "/efecto/" + sel.value);
    } catch (err) {
      fallar(err);
    } finally {
      sel.disabled = false;
    }
  });
});


/* ---------- editar y borrar items de rubrica ---------- */
document.querySelectorAll("[data-editar]").forEach(function (boton) {
  boton.addEventListener("click", function () {
    const fila = boton.closest(".it-fila");
    const texto = fila.querySelector(".it-txt");
    if (!texto || fila.querySelector(".it-input")) return;

    const original = texto.textContent;
    const input = document.createElement("input");
    input.className = "it-input";
    input.value = original;
    texto.replaceWith(input);
    input.focus();
    input.select();

    let guardando = false;

    async function guardar() {
      if (guardando) return;
      const valor = input.value.trim();
      if (!valor || valor === original) { cancelar(); return; }
      guardando = true;
      try {
        await pedir(
          "/item/" + boton.dataset.editar + "/editar",
          "titulo=" + encodeURIComponent(valor),
          "application/x-www-form-urlencoded",
        );
        location.reload();
      } catch (err) {
        guardando = false;
        fallar(err);
      }
    }

    function cancelar() {
      const span = document.createElement("span");
      span.className = "it-txt";
      span.textContent = original;
      input.replaceWith(span);
    }

    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); guardar(); }
      if (e.key === "Escape") { e.preventDefault(); cancelar(); }
    });
    input.addEventListener("blur", guardar);
  });
});

document.querySelectorAll("[data-borrar]").forEach(function (boton) {
  boton.addEventListener("click", async function () {
    const fila = boton.closest(".it-fila");
    const texto = fila ? fila.querySelector(".it-txt") : null;
    const nombre = texto ? texto.textContent : "este ítem";
    if (!confirm("¿Borrar \"" + nombre + "\"? No se puede deshacer.")) return;

    boton.disabled = true;
    try {
      await pedir("/item/" + boton.dataset.borrar + "/borrar");
      // Recargar: los porcentajes del grupo tienen que decir la verdad.
      location.reload();
    } catch (err) {
      boton.disabled = false;
      fallar(err);
    }
  });
});


/* ---------- chat agéntico del inicio ---------- */

const formConsulta = document.getElementById("form-consulta");
if (formConsulta) {
  const entrada = document.getElementById("pregunta");
  const hilo = document.getElementById("hilo");
  const estado = document.getElementById("estado");
  const meta = document.getElementById("meta");
  const boton = formConsulta.querySelector(".agente-enviar");
  const micro = document.getElementById("mic");

  // La sesión arranca vacía siempre: nada de localStorage.
  const turnos = [];

  const pasos = {
    entendiendo: estado.querySelector('[data-paso="entendiendo"]'),
    consultando: estado.querySelector('[data-paso="consultando"]'),
    listo: estado.querySelector('[data-paso="listo"]'),
  };

  function marcar(nombre, clase) {
    const el = pasos[nombre];
    if (!el) return;
    el.classList.remove("activo", "hecho");
    if (clase) el.classList.add(clase);
  }

  function reiniciarPasos() {
    Object.keys(pasos).forEach(function (k) {
      if (pasos[k]) pasos[k].className = "paso";
    });
  }

  function tarjetaTurno(t) {
    const fila = document.createElement("div");
    fila.className = "turno";

    const preg = document.createElement("div");
    preg.className = "turno-preg";
    preg.textContent = t.pregunta;

    const resp = document.createElement("div");
    resp.className = "turno-resp" + (t.error ? " error" : "");
    resp.textContent = t.respuesta || t.error || "";

    const pie = document.createElement("div");
    pie.className = "turno-pie";

    const icono = {
      reloj: '<svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M8 4.6V8l2.2 1.4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
      calendario: '<svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><rect x="2.5" y="3.5" width="11" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
      moneda: '<svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M8 4.8v6.4M6.4 6.2h2.4a1.2 1.2 0 0 1 0 2.4H6.4" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
    };

    const cuando = t.at ? new Date(t.at) : new Date();
    const fecha = cuando.toLocaleDateString("es-CO", { day: "2-digit", month: "short" });
    const hora = cuando.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", hour12: false });

    const trozos = [];
    trozos.push('<span class="u">' + icono.calendario + fecha + " · " + hora + "</span>");
    if (t.ms) trozos.push('<span class="u">' + icono.reloj + (t.ms / 1000).toFixed(2) + " s</span>");
    if (typeof t.costo === "number") trozos.push('<span class="u">' + icono.moneda + "$" + t.costo.toFixed(5) + "</span>");
    pie.innerHTML = trozos.join("");

    if (t.siguiente) {
      const sig = document.createElement("div");
      sig.className = "turno-sig";
      sig.textContent = t.siguiente;
      resp.appendChild(sig);
    }

    if (t.ruta) {
      const a = document.createElement("a");
      a.className = "turno-link";
      a.href = t.ruta;
      a.textContent = "ver detalle →";
      resp.appendChild(a);
    }

    fila.appendChild(preg);
    fila.appendChild(resp);
    if (pie.textContent) fila.appendChild(pie);
    return fila;
  }

  function pintar() {
    hilo.textContent = "";
    turnos.forEach(function (t) { hilo.appendChild(tarjetaTurno(t)); });
    hilo.scrollTop = hilo.scrollHeight;
  }

  async function preguntar(texto) {
    const pregunta = String(texto || "").trim();
    if (!pregunta) return;

    boton.disabled = true;
    entrada.disabled = true;
    reiniciarPasos();
    estado.hidden = false;
    meta.textContent = "";
    marcar("entendiendo", "activo");

    const t0 = performance.now();
    setTimeout(function () {
      if (pasos.entendiendo && pasos.entendiendo.classList.contains("activo")) {
        marcar("entendiendo", "hecho");
        marcar("consultando", "activo");
      }
    }, 260);

    try {
      const r = await fetch("/consulta", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pregunta: pregunta }),
      });
      const datos = await r.json();
      const ms = Math.round(performance.now() - t0);

      marcar("consultando", "hecho");
      marcar("listo", "hecho");
      meta.textContent = ms + " ms";

      const turno = {
        pregunta: pregunta,
        respuesta: datos.ok ? datos.respuesta : "",
        error: datos.ok ? "" : datos.error || "sin respuesta",
        ruta: datos.ruta || "",
        siguiente: datos.siguiente || "",
        ms: ms,
        costo: typeof datos.costo === "number" ? datos.costo : null,
        modelo: datos.modelo || "",
        at: Date.now(),
      };

      turnos.push(turno);
      pintar();
      entrada.value = "";
      ajustarAlto();
    } catch (err) {
      console.error(err);
      turnos.push({ pregunta: pregunta, error: "no pude conectar con el modelo", ms: Math.round(performance.now() - t0), at: Date.now() });
      pintar();
    } finally {
      boton.disabled = false;
      entrada.disabled = false;
      entrada.focus();
    }
  }

  formConsulta.addEventListener("submit", function (e) {
    e.preventDefault();
    preguntar(entrada.value);
  });

  entrada.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      preguntar(entrada.value);
    }
  });

  function ajustarAlto() {
    entrada.style.height = "auto";
    entrada.style.height = Math.min(120, entrada.scrollHeight) + "px";
  }
  entrada.addEventListener("input", ajustarAlto);

  /* ---------- dictado ---------- */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (micro && SR) {
    const rec = new SR();
    rec.lang = "es-CO";
    rec.continuous = true;
    rec.interimResults = true;
    let escuchando = false;
    let base = "";

    rec.onstart = function () { escuchando = true; micro.classList.add("escuchando"); };
    rec.onend = function () {
      escuchando = false;
      micro.classList.remove("escuchando");
    };
    rec.onerror = function () {
      escuchando = false;
      micro.classList.remove("escuchando");
    };
    rec.onresult = function (ev) {
      let texto = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) texto += ev.results[i][0].transcript;
      entrada.value = (base + " " + texto).trim();
      ajustarAlto();
    };

    micro.addEventListener("click", function () {
      if (escuchando) { rec.stop(); return; }
      base = entrada.value.trim();
      try { rec.start(); } catch {}
    });
  } else if (micro) {
    micro.hidden = true;
  }

  pintar();
  entrada.focus();
}


/* ---------- los aros de cada proyecto se llenan de a poco ---------- */
document.querySelectorAll(".pm").forEach(function (caja) {
  const anillo = caja.querySelector(".pm-fg");
  if (!anillo) return;
  const C = 2 * Math.PI * 13;
  const pct = Math.max(0, Math.min(100, Number(caja.dataset.pct || 0)));
  const dash = ((pct / 100) * C).toFixed(1);
  const i = [...document.querySelectorAll(".pm")].indexOf(caja);
  setTimeout(function () {
    anillo.setAttribute("stroke-dasharray", dash + " " + C.toFixed(1));
  }, 140 + i * 90);
});
})();
