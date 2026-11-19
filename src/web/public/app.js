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

  /* ---------- bandeja: decisión y dueño ---------- */

  document.querySelectorAll(".fila[data-id]").forEach(function (fila) {
    const id = fila.dataset.id;

    fila.querySelectorAll("select[data-campo]").forEach(function (select) {
      select.dataset.previo = select.value;

      select.addEventListener("change", async function () {
        const campo = select.dataset.campo;
        const valor = select.value;
        const anterior = select.dataset.previo || "";
        select.disabled = true;

        try {
          await pedir("/accion/" + id + "/" + campo + "/" + encodeURIComponent(valor));
          select.dataset.previo = valor;

          if (campo === "estado" && valor !== "proposed") {
            fila.classList.add("saliendo");
            setTimeout(function () {
              fila.remove();
              actualizarConteo();
            }, 200);
          }
        } catch (e) {
          select.value = anterior;
          fallar(e);
        } finally {
          select.disabled = false;
        }
      });
    });
  });

  function actualizarConteo() {
    const restantes = document.querySelectorAll(".fila[data-id]").length;
    const globo = document.querySelector(".nav .conteo");
    if (globo) globo.textContent = String(restantes);

    if (restantes === 0) {
      const cont = document.querySelector(".contenido");
      if (cont) {
        cont.innerHTML =
          '<div class="vacio"><h2>No hay temas por calificar</h2><p>La bandeja está limpia.</p></div>';
      }
    }
  }

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
})();

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

/* ---------- triaje dentro de la reunión: control segmentado ---------- */

document.querySelectorAll("[data-estado-seg]").forEach(function (boton) {
  boton.addEventListener("click", async function () {
    const card = boton.closest(".tema-card");
    const id = boton.dataset.tema;
    const valor = boton.dataset.estadoSeg;
    const anterior = card.classList.contains("estado-selected") ? "selected" : card.classList.contains("estado-parked") ? "parked" : card.classList.contains("estado-discarded") ? "discarded" : "proposed";

    if (valor === anterior) return;

    boton.closest(".segmentado").querySelectorAll("button").forEach(function (b) { b.disabled = true; });

    try {
      await pedir("/accion/" + id + "/estado/" + valor);

      // Actualiza el estado visual sin recargar.
      card.classList.remove("estado-proposed", "estado-selected", "estado-parked", "estado-discarded");
      card.classList.add("estado-" + valor);
      boton.closest(".segmentado").querySelectorAll("button").forEach(function (b) {
        b.classList.toggle("activo", b === boton);
        b.setAttribute("aria-checked", String(b === boton));
      });

      const extra = card.querySelector(".extra");
      if (extra) extra.hidden = valor !== "selected";

      const contenedor = card.closest("[data-tab]");
      if (contenedor && contenedor.dataset.tab === "proposed" && valor !== "proposed") {
        card.classList.add("saliendo");
        setTimeout(function () {
          card.remove();
          ajustarContadores(contenedor, valor);
        }, 200);
      }
    } catch (e) {
      fallar(e);
    } finally {
      boton.closest(".segmentado").querySelectorAll("button").forEach(function (b) { b.disabled = false; });
    }
  });
});

function ajustarContadores(contenedor, destino) {
  const leer = function (id) {
    const el = document.querySelector('[data-conteo="' + id + '"]');
    if (!el) return null;
    const b = el.querySelector("b");
    return b ? b : null;
  };

  const restar = function (id) {
    const b = leer(id);
    if (b) b.textContent = String(Math.max(0, Number(b.textContent) - 1));
  };
  const sumar = function (id) {
    const b = leer(id);
    if (b) b.textContent = String(Number(b.textContent) + 1);
  };

  restar("proposed");
  sumar(destino);

  if (contenedor.querySelectorAll(".fila[data-id]").length === 0) {
    contenedor.innerHTML = '<div class="vacio-mini">No queda nada sin calificar.</div>';
  }
}

/* ---------- progresividad: dueño y proyecto solo al seleccionar ---------- */

document.querySelectorAll(".tema-card").forEach(function (card) {
  const selectEstado = card.querySelector('select[data-campo="estado"]');
  const extra = card.querySelector(".extra");
  if (!selectEstado || !extra) return;

  function sincronizarClase() {
    card.classList.remove("estado-proposed", "estado-selected", "estado-parked", "estado-discarded");
    card.classList.add("estado-" + selectEstado.value);
    extra.hidden = selectEstado.value !== "selected";
  }

  selectEstado.addEventListener("change", sincronizarClase);
  sincronizarClase();
});

/* la descripción se abre con clic o Enter */
document.querySelectorAll(".recortada[data-abrir-modal]").forEach(function (el) {
  function abrir() {
    const dialogo = document.getElementById(el.dataset.abrirModal);
    if (dialogo && dialogo.showModal) dialogo.showModal();
  }
  el.addEventListener("click", abrir);
  el.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      abrir();
    }
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

      // El resumen del desplegable refleja cuantos quedaron marcados.
      const detalle = chip.closest("details.multi");
      const resumen = detalle ? detalle.querySelector(".multi-resumen") : null;
      if (detalle && resumen) {
        const n = detalle.querySelectorAll("input[data-toggle-proyecto]:checked").length;
        resumen.textContent = n === 0 ? "Sin proyecto" : n === 1 ? "1 proyecto" : n + " proyectos";
      }
    } catch (err) {
      fallar(err);
    } finally {
      chip.disabled = false;
    }
  });
});
