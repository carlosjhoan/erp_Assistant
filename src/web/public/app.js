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
