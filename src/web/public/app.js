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

})();
